// scripts/agents/telegram-bot.mjs — Telegram bot polling + command router
//
// Roda como systemd service no VPS (long-poll Telegram getUpdates).
// Comandos:
//   /status          — pipeline.mjs status
//   /brief           — daily-brief.mjs roda agora + push
//   /insights        — ig-insights-scraper --ranking
//   /queue           — lista runs por estado
//   /publish <id>    — fires publish.ts (requer confirmação)
//   /confirm <id>    — confirma publish após /publish
//   /cancel <id>     — set run to blocked
//   /run <id>        — pipeline.mjs run --run X
//   /help            — lista comandos
//
// Plus: ouve reply messages contendo "posta <id>" como atalho pra /publish
//
// Princípio Tan: long-poll deterministic, LLM zero. Sub-process pros agentes.

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync, spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");

// .env loader
const ENV_PATH = path.join(ROOT, ".env");
if (fs.existsSync(ENV_PATH)) {
  for (const line of fs.readFileSync(ENV_PATH, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const STATE_PATH = path.join(ROOT, "runs", "_telegram-bot-state.json");
const AUDIT_LOG = path.join(ROOT, "runs", "_audit-log.jsonl");
const PUBLISH_PENDING_PATH = path.join(ROOT, "runs", "_publish-pending.json");

if (!TOKEN || !CHAT_ID) {
  console.error("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing in .env");
  process.exit(1);
}

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { last_update_id: 0 };
  return JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
}
function saveState(s) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

function audit(event) {
  fs.mkdirSync(path.dirname(AUDIT_LOG), { recursive: true });
  fs.appendFileSync(AUDIT_LOG, JSON.stringify({ ts: new Date().toISOString(), agent: "telegram-bot", ...event }) + "\n");
}

async function send(text, replyToMessageId = null) {
  // Telegram has 4096 char limit
  const chunks = [];
  let s = text;
  while (s.length > 0) {
    let end = Math.min(s.length, 4000);
    if (end < s.length) {
      const nl = s.lastIndexOf("\n", end);
      if (nl > end * 0.7) end = nl;
    }
    chunks.push(s.slice(0, end));
    s = s.slice(end);
  }
  for (const chunk of chunks) {
    try {
      await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: chunk,
          parse_mode: "Markdown",
          disable_web_page_preview: true,
          reply_to_message_id: replyToMessageId || undefined,
        }),
      });
    } catch (e) { console.error("send failed", e.message); }
  }
}

// ─── Commands ─────────────────────────────────────────────────────────────────
const commands = {
  async help() {
    return `🤖 *Longevify Bot · comandos*

\`/status\` — pipeline state + próximos slots
\`/brief\` — daily brief agora
\`/insights\` — ranking IG insights
\`/queue\` — lista runs por estado
\`/publish <id>\` — solicita publish (vai pedir /confirm)
\`/confirm\` — confirma último /publish
\`/cancel <id>\` — bloqueia run
\`/run <id>\` — força pipeline.mjs run no id
\`/help\` — esta mensagem

*Atalho:* qualquer mensagem com "posta <id>" = mesmo que /publish.`;
  },

  async status() {
    try {
      const out = execSync(`node ${path.join(ROOT, "scripts", "pipeline.mjs")} status`, { encoding: "utf-8", timeout: 30000 });
      return "📊 *Pipeline status*\n```\n" + out.trim() + "\n```";
    } catch (e) { return "❌ status falhou: " + e.message.slice(0, 200); }
  },

  async brief() {
    await send("⏳ Gerando brief...");
    try {
      execSync(`node ${path.join(ROOT, "scripts", "agents", "daily-brief.mjs")}`, { stdio: "ignore", timeout: 120000 });
      return "✅ Brief gerado + enviado (mensagem separada acima)";
    } catch (e) { return "❌ brief falhou: " + e.message.slice(0, 200); }
  },

  async insights() {
    try {
      const out = execSync(`node ${path.join(ROOT, "scripts", "agents", "ig-insights-scraper.mjs")} --ranking`, { encoding: "utf-8", timeout: 30000 });
      return "📈 *Insights ranking*\n```\n" + out.trim().slice(0, 3500) + "\n```";
    } catch (e) { return "❌ insights falhou: " + e.message.slice(0, 200); }
  },

  async queue() {
    try {
      const queuePath = path.join(ROOT, "runs", "_queue.json");
      if (!fs.existsSync(queuePath)) return "Queue vazia (nenhum run em _queue.json)";
      const q = JSON.parse(fs.readFileSync(queuePath, "utf-8"));
      const grouped = {};
      for (const it of q.items || []) {
        grouped[it.status || "?"] = (grouped[it.status || "?"] || []);
        grouped[it.status].push(`${it.slot || "(no slot)"} ${it.id}`);
      }
      let md = "📋 *Queue (last 10 per state)*\n\n";
      for (const [state, items] of Object.entries(grouped)) {
        md += `*${state}* (${items.length})\n`;
        for (const i of items.slice(-10)) md += `  · ${i}\n`;
        md += "\n";
      }
      return md;
    } catch (e) { return "❌ queue falhou: " + e.message.slice(0, 200); }
  },

  async publish(runId) {
    if (!runId) return "❌ uso: `/publish <run-id>`";
    // Verifica run existe + está em state apropriado
    const coPath = path.join(ROOT, "runs", runId, "content-object.md");
    if (!fs.existsSync(coPath)) return `❌ run \`${runId}\` não encontrado`;
    // Salva pending pra /confirm
    fs.writeFileSync(PUBLISH_PENDING_PATH, JSON.stringify({ run_id: runId, requested_at: new Date().toISOString() }, null, 2));
    audit({ event: "publish_requested", run_id: runId });
    return `📤 *Confirma publish de \`${runId}\`?*\n\nResponde \`/confirm\` em até 5min ou clique aqui pra ver detalhes.\n\nReply \`/cancel\` pra abortar.`;
  },

  async confirm() {
    if (!fs.existsSync(PUBLISH_PENDING_PATH)) return "❌ nenhum publish pendente";
    const pending = JSON.parse(fs.readFileSync(PUBLISH_PENDING_PATH, "utf-8"));
    const ageMin = (Date.now() - new Date(pending.requested_at).getTime()) / 60000;
    if (ageMin > 5) {
      fs.unlinkSync(PUBLISH_PENDING_PATH);
      return `⌛ pending expirou (${ageMin.toFixed(1)}min > 5min). Refaça /publish.`;
    }
    audit({ event: "publish_confirmed", run_id: pending.run_id });
    await send(`📤 Publicando \`${pending.run_id}\`...`);
    try {
      const out = execSync(`cd ${ROOT} && npm run publish -- --run ${pending.run_id} 2>&1`, { encoding: "utf-8", timeout: 300000 });
      const mediaId = (out.match(/media_id:\s*(\S+)/) ?? [, "?"])[1];
      fs.unlinkSync(PUBLISH_PENDING_PATH);
      audit({ event: "published", run_id: pending.run_id, media_id: mediaId });
      return `✅ Publicado!\nmedia_id: \`${mediaId}\`\nrun: \`${pending.run_id}\``;
    } catch (e) {
      audit({ event: "publish_failed", run_id: pending.run_id, error: e.message });
      return `❌ publish falhou:\n\`\`\`\n${e.message.slice(0, 500)}\n\`\`\``;
    }
  },

  async cancel(runId) {
    if (fs.existsSync(PUBLISH_PENDING_PATH)) {
      const pending = JSON.parse(fs.readFileSync(PUBLISH_PENDING_PATH, "utf-8"));
      if (!runId || runId === pending.run_id) {
        fs.unlinkSync(PUBLISH_PENDING_PATH);
        audit({ event: "publish_cancelled", run_id: pending.run_id });
        return `🚫 Publish de \`${pending.run_id}\` cancelado`;
      }
    }
    return runId ? `🚫 nenhum pending pra \`${runId}\`` : "🚫 nenhum publish pending";
  },

  async run(runId) {
    if (!runId) return "❌ uso: `/run <run-id>`";
    try {
      const out = execSync(`node ${path.join(ROOT, "scripts", "pipeline.mjs")} run --run ${runId}`, { encoding: "utf-8", timeout: 180000 });
      return "▶ *Pipeline run output*\n```\n" + out.trim().slice(0, 3500) + "\n```";
    } catch (e) { return "❌ run falhou: " + e.message.slice(0, 200); }
  },
};

// ─── Parse incoming message ───────────────────────────────────────────────────
function parseCommand(text) {
  text = (text || "").trim();
  // "/cmd args"
  if (text.startsWith("/")) {
    const m = text.match(/^\/(\w+)(?:@\w+)?(?:\s+(.+))?$/);
    if (!m) return null;
    return { cmd: m[1].toLowerCase(), args: m[2]?.trim() || null };
  }
  // Shortcut: "posta <id>" → publish
  const postaMatch = text.match(/^posta\s+(\S+)/i);
  if (postaMatch) return { cmd: "publish", args: postaMatch[1] };
  return null;
}

async function handleUpdate(update) {
  const msg = update.message;
  if (!msg || !msg.text) return;
  if (String(msg.chat.id) !== String(CHAT_ID)) {
    audit({ event: "unauthorized_chat", chat_id: msg.chat.id, text: msg.text.slice(0, 50) });
    return; // ignore non-authorized chats
  }
  const parsed = parseCommand(msg.text);
  if (!parsed) return;
  audit({ event: "command_received", cmd: parsed.cmd, args: parsed.args });
  const handler = commands[parsed.cmd];
  if (!handler) {
    await send(`❓ comando desconhecido: \`/${parsed.cmd}\`\nUse \`/help\``, msg.message_id);
    return;
  }
  try {
    const reply = await handler(parsed.args);
    await send(reply, msg.message_id);
  } catch (e) {
    await send(`❌ erro: ${e.message.slice(0, 300)}`, msg.message_id);
    audit({ event: "command_error", cmd: parsed.cmd, error: e.message });
  }
}

// ─── Long-poll loop ───────────────────────────────────────────────────────────
async function pollLoop() {
  console.log(`🤖 Telegram bot polling started · chat ${CHAT_ID}`);
  audit({ event: "bot_started" });
  while (true) {
    const state = loadState();
    try {
      const res = await fetch(`https://api.telegram.org/bot${TOKEN}/getUpdates?offset=${state.last_update_id + 1}&timeout=30`);
      const json = await res.json();
      if (!json.ok) {
        console.error("getUpdates failed", json);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      for (const update of json.result || []) {
        try { await handleUpdate(update); } catch (e) { console.error("handleUpdate", e.message); }
        state.last_update_id = update.update_id;
        saveState(state);
      }
    } catch (e) {
      console.error("poll loop error", e.message);
      audit({ event: "poll_error", error: e.message });
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

await pollLoop();
