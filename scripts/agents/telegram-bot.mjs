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
import Database from "better-sqlite3";
import { composeStatus } from "./formatTelegram.mjs";
import { detectUrls, ingestUrl, getIdea, setIdeaStatus, listBacklog, countBacklog } from "./idea-ingester.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");
const PIPELINE_DB = path.join(ROOT, "runs", "_pipeline.db");

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
const PENDING_EDIT_PATH = path.join(ROOT, "runs", "_telegram-pending-edit.json");
const APPROVAL_NOTIF_PATH = path.join(ROOT, "runs", "_approval-notifications.json");
const PENDING_EDIT_TTL_MIN = 10;

// Reviewer map: TELEGRAM_REVIEWERS=chatid1:founder,chatid2:lucas
const REVIEWERS = (() => {
  const m = {};
  for (const pair of (process.env.TELEGRAM_REVIEWERS || "").split(",")) {
    const [id, name] = pair.split(":").map(s => s?.trim());
    if (id && name) m[id] = name;
  }
  // Default: founder = TELEGRAM_CHAT_ID
  if (!Object.keys(m).length && CHAT_ID) m[CHAT_ID] = "founder";
  return m;
})();
const reviewerOf = (chatId) => REVIEWERS[String(chatId)] || `unknown-${chatId}`;

if (!TOKEN || !CHAT_ID) {
  console.error("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing in .env");
  process.exit(1);
}

// Pending edit state ({ chat_id: { run_id, requested_at } })
function loadPendingEdit() {
  if (!fs.existsSync(PENDING_EDIT_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(PENDING_EDIT_PATH, "utf-8")); } catch { return {}; }
}
function savePendingEdit(s) {
  fs.mkdirSync(path.dirname(PENDING_EDIT_PATH), { recursive: true });
  fs.writeFileSync(PENDING_EDIT_PATH, JSON.stringify(s, null, 2));
}
function pendingEditFresh(entry) {
  if (!entry?.requested_at) return false;
  const age = (Date.now() - new Date(entry.requested_at).getTime()) / 60000;
  return age < PENDING_EDIT_TTL_MIN;
}

// Approval notifications log ({ run_id: { notified_at, decided_at, decision, reviewer, reason } })
function loadApprovalNotifs() {
  if (!fs.existsSync(APPROVAL_NOTIF_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(APPROVAL_NOTIF_PATH, "utf-8")); } catch { return {}; }
}
function saveApprovalNotifs(s) {
  fs.mkdirSync(path.dirname(APPROVAL_NOTIF_PATH), { recursive: true });
  fs.writeFileSync(APPROVAL_NOTIF_PATH, JSON.stringify(s, null, 2));
}
function markApprovalDecision(runId, decision, reviewer, reason = null) {
  const all = loadApprovalNotifs();
  all[runId] = { ...(all[runId] || {}), decided_at: new Date().toISOString(), decision, reviewer, reason };
  saveApprovalNotifs(all);
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

*Pipeline*
\`/status\` — pipeline state + próximos slots
\`/brief\` — daily brief agora
\`/insights\` — ranking IG insights
\`/queue\` — lista runs por estado

*Approval / Publish*
\`/publish <id>\` — solicita publish (pede /confirm)
\`/confirm\` — confirma último /publish
\`/cancel <id>\` — bloqueia run
\`/run <id>\` — força pipeline.mjs run no id

*Ideas (ingester)*
\`/backlog\` — lista ideas guardadas no backlog
\`/reproduce <idea_id>\` — 🚀 reproduzir agora (preserva estrutura)
\`/concept <idea_id>\` — 💡 só a ideia (Longevify-native do zero)
\`/discard_idea <idea_id>\` — 🗑️ descartar

\`/help\` — esta mensagem

*Atalhos:*
• "posta <id>" = /publish
• Cola URL no chat → bot detecta + ingere com 4 botões`;
  },

  async status() {
    try {
      if (!fs.existsSync(PIPELINE_DB)) return "📊 *Pipeline*\n_(banco vazio — rode `pipeline.mjs tick` 1x)_";
      const db = new Database(PIPELINE_DB, { readonly: true });
      const counts = db.prepare(`SELECT state, COUNT(*) as n FROM runs GROUP BY state ORDER BY n DESC`).all();
      const upcoming = db.prepare(`SELECT * FROM runs WHERE state NOT IN ('published','failed') ORDER BY scheduled_for IS NULL, scheduled_for ASC LIMIT 5`).all();
      db.close();
      // Editor decisions last 16h
      const cutoff = Date.now() - 16 * 3600 * 1000;
      let decisions = [];
      if (fs.existsSync(AUDIT_LOG)) {
        decisions = fs.readFileSync(AUDIT_LOG, "utf-8").split("\n").filter(Boolean)
          .map(l => { try { return JSON.parse(l); } catch { return null; } })
          .filter(e => e && e.event === "editor_decision" && new Date(e.ts).getTime() > cutoff);
      }
      return composeStatus({ counts, upcoming, decisions, hoursWindow: 16 });
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

  async backlog() {
    try {
      const items = listBacklog(15);
      if (!items.length) return "📋 Backlog vazio. Cola URL no chat pra adicionar.";
      let out = `📋 *Backlog · ${items.length} ideias*\n\n`;
      for (const it of items.slice(0, 10)) {
        const date = it.ingested_at?.slice(5, 10) || "?";
        const captionPreview = (it.original_caption || "").slice(0, 70).replace(/\n/g, " ").trim();
        out += `*#${it.id}* ${date} · ${it.source_brand} · P${it.pillar_suggested} · ${it.persona_suggested}\n`;
        out += `_${captionPreview}${(it.original_caption?.length || 0) > 70 ? "…" : ""}_\n\n`;
      }
      if (items.length > 10) out += `_(+${items.length - 10} mais)_\n\n`;
      out += `Pra acionar uma: /reproduce <id> ou /concept <id> ou /discard_idea <id>`;
      return out;
    } catch (e) { return "❌ backlog falhou: " + e.message.slice(0, 200); }
  },

  async reproduce(arg) {
    if (!arg) return "❌ uso: `/reproduce <idea_id>`";
    const ideaId = parseInt(arg);
    const idea = getIdea(ideaId);
    if (!idea) return `❌ idea #${ideaId} não existe`;
    await send(`🚀 Reproduzindo idea #${ideaId}...`);
    try {
      execSync(`node ${path.join(ROOT, "scripts", "agents", "remix-mode.mjs")} --idea ${ideaId} 2>&1`, { cwd: ROOT, encoding: "utf-8", timeout: 360000 });
      setIdeaStatus(ideaId, "remixed", { remix_decision: "remix", use_mode: "remix" });
      return `✅ Idea #${ideaId} reproduzida. Approval card chegando.`;
    } catch (e) { return `❌ remix falhou: ${e.message.slice(0, 300)}`; }
  },

  async concept(arg) {
    if (!arg) return "❌ uso: `/concept <idea_id>`";
    const ideaId = parseInt(arg);
    const idea = getIdea(ideaId);
    if (!idea) return `❌ idea #${ideaId} não existe`;
    await send(`💡 Concept-mode idea #${ideaId}...`);
    try {
      execSync(`node ${path.join(ROOT, "scripts", "agents", "concept-mode.mjs")} --idea ${ideaId} 2>&1`, { cwd: ROOT, encoding: "utf-8", timeout: 360000 });
      setIdeaStatus(ideaId, "remixed", { remix_decision: "concept", use_mode: "concept-only" });
      return `✅ Idea #${ideaId} concept-generated. Approval card chegando.`;
    } catch (e) { return `❌ concept falhou: ${e.message.slice(0, 300)}`; }
  },

  async discard_idea(arg) {
    if (!arg) return "❌ uso: `/discard_idea <idea_id>`";
    const ideaId = parseInt(arg);
    setIdeaStatus(ideaId, "discarded", { remix_decision: "discard", use_mode: "discarded" });
    return `🗑️ Idea #${ideaId} descartada.`;
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

async function answerCallbackQuery(callbackQueryId, text = "") {
  try {
    await fetch(`https://api.telegram.org/bot${TOKEN}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    });
  } catch {}
}

async function handleCallbackQuery(cq) {
  const chatId = cq.message.chat.id;
  if (!REVIEWERS[String(chatId)] && String(chatId) !== String(CHAT_ID)) {
    audit({ event: "unauthorized_callback", chat_id: chatId, data: cq.data });
    return;
  }
  const data = cq.data || "";  // formato: "<action>:<runId>"
  const [action, runId] = data.split(":");
  const reviewer = reviewerOf(chatId);
  audit({ event: "callback_received", action, run_id: runId, reviewer });
  await answerCallbackQuery(cq.id, `processando ${action}...`);

  try {
    let reply;

    // ─── New approval-v2 actions (canonical flow) ─────────────────────────────
    if (action === "approve_v2") {
      // Approve = transition to state='approved' + queue for scheduled_for slot.
      // publisher-tick (every 5min) actually publishes when slot is due.
      // NEVER publish immediately on tap — explicit founder rule 2026-05-23.
      if (!fs.existsSync(PIPELINE_DB)) { reply = "❌ pipeline.db missing"; }
      else {
        const db = new Database(PIPELINE_DB);
        try {
          const row = db.prepare(`SELECT state, scheduled_for FROM runs WHERE run_id = ?`).get(runId);
          if (!row) { reply = `❌ run \`${runId}\` not in pipeline DB`; }
          else if (!row.scheduled_for) {
            // CASE 3 — no slot: prompt with inline keyboard for scheduling decision.
            db.prepare(`UPDATE runs SET state='approved', updated_at=? WHERE run_id=?`).run(new Date().toISOString(), runId);
            markApprovalDecision(runId, "approve_v2_no_slot", reviewer);
            audit({ event: "approve_v2_no_slot", run_id: runId, reviewer, prev_state: row.state });
            await send(`✅ Aprovado por *${reviewer}*\n\`${runId}\`\n\n⚠️ *Sem slot agendado.* Escolhe quando publicar:`, cq.message.message_id);
            // Send inline-keyboard-only message for scheduling.
            try {
              await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: CHAT_ID,
                  text: `🗓 Quando publica \`${runId}\`?`,
                  parse_mode: "Markdown",
                  reply_markup: { inline_keyboard: [[
                    { text: "▶️ Publicar agora", callback_data: `schedule_v2:now:${runId}` },
                    { text: "+30min", callback_data: `schedule_v2:30:${runId}` },
                  ], [
                    { text: "+1h", callback_data: `schedule_v2:60:${runId}` },
                    { text: "+3h", callback_data: `schedule_v2:180:${runId}` },
                    { text: "amanhã 10h BRT", callback_data: `schedule_v2:tomorrow10:${runId}` },
                  ]] },
                }),
              });
            } catch (e) { console.error("schedule prompt failed:", e.message); }
            return;  // suppress further reply
          } else {
            // Slot exists — compute time-to-slot.
            const slotMs = new Date(row.scheduled_for).getTime();
            const now = Date.now();
            const minsToSlot = Math.round((slotMs - now) / 60000);
            let effectiveScheduledFor = row.scheduled_for;
            let msg;
            if (minsToSlot < 0) {
              // CASE 2 — slot passed: reschedule to now+5min buffer.
              const newSlot = new Date(now + 5 * 60 * 1000).toISOString();
              db.prepare(`UPDATE runs SET state='approved', scheduled_for=?, updated_at=? WHERE run_id=?`)
                .run(newSlot, new Date().toISOString(), runId);
              effectiveScheduledFor = newSlot;
              msg = `✅ Aprovado por *${reviewer}*\n\`${runId}\`\n\n_Slot original ${row.scheduled_for} já passou. Publicando em 5min._`;
            } else {
              // CASE 1 — slot in future: simple transition.
              db.prepare(`UPDATE runs SET state='approved', updated_at=? WHERE run_id=?`).run(new Date().toISOString(), runId);
              const inHours = minsToSlot / 60;
              const when = inHours < 1 ? `em ${minsToSlot}min`
                          : inHours < 24 ? `em ${inHours.toFixed(1)}h`
                          : `em ${(inHours/24).toFixed(1)} dias`;
              msg = `✅ Aprovado por *${reviewer}*\n\`${runId}\`\n\n🗓 Publica \`${row.scheduled_for}\` (${when}).`;
            }
            markApprovalDecision(runId, "approve_v2", reviewer);
            audit({ event: "approve_v2", run_id: runId, reviewer, prev_state: row.state, scheduled_for: effectiveScheduledFor, mins_to_slot: minsToSlot });
            reply = msg;
          }
        } finally { db.close(); }
      }
    }
    // ─── Idea ingester callbacks (4 use modes) ───────────────────────────────
    else if (action === "ingest_remix") {
      // 🚀 Reproduzir agora — preserves original structure, generates Longevify-native draft.
      const ideaId = parseInt(runId);
      const idea = getIdea(ideaId);
      if (!idea) { reply = `❌ idea #${ideaId} não existe`; }
      else {
        await send(`🚀 Reproduzindo idea #${ideaId} (${idea.source_brand} · ${idea.persona_suggested} · P${idea.pillar_suggested})...\n\n_~$0.05 + ~2min. Approval card chega quando terminar._`, cq.message.message_id);
        try {
          execSync(`node ${path.join(ROOT, "scripts", "agents", "remix-mode.mjs")} --idea ${ideaId} 2>&1`, { cwd: ROOT, encoding: "utf-8", timeout: 360000 });
          setIdeaStatus(ideaId, "remixed", { remix_decision: "remix", use_mode: "remix" });
          audit({ event: "ingest_remix_ok", idea_id: ideaId, reviewer });
          // remix-mode dispatches telegram-approval --notify itself.
          return;
        } catch (e) {
          audit({ event: "ingest_remix_failed", idea_id: ideaId, reviewer, error: e.message?.slice(0, 200) });
          reply = `❌ remix falhou: ${e.message.slice(0, 400)}`;
        }
      }
    }
    else if (action === "ingest_concept") {
      // 💡 Só a ideia — ignores original structure, generates 100% Longevify-native from topic.
      const ideaId = parseInt(runId);
      const idea = getIdea(ideaId);
      if (!idea) { reply = `❌ idea #${ideaId} não existe`; }
      else {
        await send(`💡 Só a ideia da #${ideaId} — gerando Longevify-native do zero (~$0.05 + ~2min). Approval card depois.`, cq.message.message_id);
        try {
          execSync(`node ${path.join(ROOT, "scripts", "agents", "concept-mode.mjs")} --idea ${ideaId} 2>&1`, { cwd: ROOT, encoding: "utf-8", timeout: 360000 });
          setIdeaStatus(ideaId, "remixed", { remix_decision: "concept", use_mode: "concept-only" });
          audit({ event: "ingest_concept_ok", idea_id: ideaId, reviewer });
          return;
        } catch (e) {
          audit({ event: "ingest_concept_failed", idea_id: ideaId, reviewer, error: e.message?.slice(0, 200) });
          reply = `❌ concept falhou: ${e.message.slice(0, 400)}`;
        }
      }
    }
    else if (action === "ingest_backlog") {
      // 📋 Backlog — save for later. No generation. Listable via /backlog.
      const ideaId = parseInt(runId);
      setIdeaStatus(ideaId, "saved-for-remix", { remix_decision: "save", use_mode: "backlog" });
      const total = countBacklog();
      audit({ event: "ingest_backlog", idea_id: ideaId, reviewer, total });
      reply = `📋 Idea #${ideaId} no backlog. *${total}* ideias aguardando.\n\nVer/acionar: /backlog`;
    }
    else if (action === "ingest_discard") {
      const ideaId = parseInt(runId);
      setIdeaStatus(ideaId, "discarded", { remix_decision: "discard", use_mode: "discarded" });
      audit({ event: "ingest_discard", idea_id: ideaId, reviewer });
      reply = `🗑️ Idea #${ideaId} descartada.`;
    }
    else if (action === "schedule_v2") {
      // Callback data: schedule_v2:<choice>:<runId>
      // Note: parseCommand already split on first colon. Need to re-parse data manually.
      const parts = data.split(":");
      const choice = parts[1];
      const realRunId = parts.slice(2).join(":");  // run IDs may contain colons (defensive)
      let newSlot;
      const now = Date.now();
      if (choice === "now") newSlot = new Date(now + 5 * 60_000).toISOString();
      else if (choice === "30") newSlot = new Date(now + 30 * 60_000).toISOString();
      else if (choice === "60") newSlot = new Date(now + 60 * 60_000).toISOString();
      else if (choice === "180") newSlot = new Date(now + 180 * 60_000).toISOString();
      else if (choice === "tomorrow10") {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() + 1);
        d.setUTCHours(13, 0, 0, 0);  // 10h BRT = 13h UTC
        newSlot = d.toISOString();
      } else { reply = `❓ choice desconhecido: ${choice}`; }

      if (newSlot && fs.existsSync(PIPELINE_DB)) {
        const db = new Database(PIPELINE_DB);
        try {
          db.prepare(`UPDATE runs SET scheduled_for=?, updated_at=? WHERE run_id=?`).run(newSlot, new Date().toISOString(), realRunId);
        } finally { db.close(); }
        audit({ event: "schedule_v2", run_id: realRunId, reviewer, choice, new_slot: newSlot });
        reply = `🗓 \`${realRunId}\` agendado pra \`${newSlot}\` por *${reviewer}*.`;
      }
    }
    else if (action === "edit_v2") {
      // Set pending edit state — next text message from this chat is captured as hint.
      const pending = loadPendingEdit();
      pending[String(chatId)] = { run_id: runId, requested_at: new Date().toISOString() };
      savePendingEdit(pending);
      audit({ event: "edit_v2_requested", run_id: runId, reviewer });
      reply = `✏️ *Editar \`${runId}\`*\n\nResponde nesta conversa com o ajuste (ex: "reduz em-dash" / "mais punch no hook" / "troca exemplo da Julia por Ana").\n\n_Você tem ${PENDING_EDIT_TTL_MIN}min. Qualquer /comando cancela._`;
    }
    else if (action === "regen_v2") {
      await send(`🔄 Regenerando \`${runId}\`... (~$0.06 + ~2min)`, cq.message.message_id);
      try {
        execSync(`node ${path.join(ROOT, "scripts", "agents", "content-generator.mjs")} --run ${runId} 2>&1`, { cwd: ROOT, encoding: "utf-8", timeout: 240000 });
        audit({ event: "regen_v2", run_id: runId, reviewer });
        // Auto re-notify with --force: deletes previous approval card + sends fresh one.
        try {
          execSync(`node ${path.join(ROOT, "scripts", "agents", "telegram-approval.mjs")} --notify ${runId} --force 2>&1`, { cwd: ROOT, encoding: "utf-8", timeout: 60000 });
        } catch (e) { console.error("re-notify failed:", e.message); }
        // Suppress legacy reply text — the new approval card is the canonical reply.
        return;
      } catch (e) {
        audit({ event: "regen_v2_failed", run_id: runId, reviewer, error: e.message?.slice(0, 200) });
        reply = `❌ regen falhou: ${e.message.slice(0, 300)}`;
      }
    }
    else if (action === "discard_v2") {
      const target = path.join(ROOT, "runs", runId);
      try {
        execSync(`DESTRUCTIVE_CONFIRMED=1 node ${path.join(ROOT, "scripts", "agents", "safe-rm.mjs")} --path "${target}" --agent telegram-approval-v2 --reason "discarded by ${reviewer}"`, { cwd: ROOT });
        markApprovalDecision(runId, "discard_v2", reviewer);
        audit({ event: "discard_v2", run_id: runId, reviewer });
        reply = `🗑️ Descartado por *${reviewer}*\n\`${runId}\` movido pra _archived`;
      } catch (e) {
        reply = `❌ discard falhou: ${e.message.slice(0, 300)}`;
      }
    }

    // ─── Legacy actions (kept for T-15min prepublish-alerts compatibility) ───
    else if (action === "publish") {
      const out = execSync(`cd ${ROOT} && npm run publish -- --run ${runId} 2>&1`, { encoding: "utf-8", timeout: 300000 });
      const mediaId = (out.match(/media_id:\s*(\S+)/) ?? [, "?"])[1];
      audit({ event: "published_via_button", run_id: runId, media_id: mediaId, reviewer });
      reply = `✅ Publicado!\nmedia_id: \`${mediaId}\``;
    } else if (action === "cancel") {
      reply = `🚫 \`${runId}\` cancelado pra este slot`;
      audit({ event: "cancelled_via_button", run_id: runId, reviewer });
    } else if (action === "reedit") {
      const out = execSync(`node ${path.join(ROOT, "scripts", "agents", "editor-agent.mjs")} --run ${runId}`, { encoding: "utf-8", timeout: 60000 });
      reply = "🔄 *Re-edit result*\n```\n" + out.trim().slice(-1500) + "\n```";
    } else if (action === "discard") {
      const target = path.join(ROOT, "runs", runId);
      execSync(`DESTRUCTIVE_CONFIRMED=1 node ${path.join(ROOT, "scripts", "agents", "safe-rm.mjs")} --path "${target}" --agent telegram-button --reason "user discard button"`, { cwd: ROOT });
      reply = `🗑 \`${runId}\` archived`;
    }

    else {
      reply = `❓ ação desconhecida: ${action}`;
    }
    await send(reply, cq.message.message_id);
  } catch (e) {
    await send(`❌ erro processando ${action}: ${e.message.slice(0, 300)}`, cq.message.message_id);
    audit({ event: "callback_error", action, run_id: runId, error: e.message, reviewer });
  }
}

async function handleIngestUrls(chatId, urls) {
  for (const url of urls) {
    const r = await ingestUrl(url, chatId);
    if (!r.ok) {
      await send(`⚠️ Não consegui ingerir \`${url}\`\n_${r.error || "scrape vazio"}_${r.hint ? `\n${r.hint}` : ""}`);
      continue;
    }
    if (r.dup) {
      await send(`📌 Já tava na backlog (idea #${r.idea_id}, status ${r.status}).`);
      continue;
    }
    const previewCaption = (r.caption || "").slice(0, 280).trim() + (r.caption.length > 280 ? "…" : "");
    const text = [
      `✅ *Salvo* idea #${r.idea_id}`,
      `🌐 *${r.brand}* via ${r.platform}${r.author ? ` · ${r.author}` : ""}`,
      "",
      `> ${previewCaption.replace(/\n/g, "\n> ")}`,
      "",
      `_Sugestão:_ persona *${r.persona}* · pillar *P${r.pillar}*`,
    ].join("\n");
    try {
      await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "Markdown",
          disable_web_page_preview: true,
          reply_markup: { inline_keyboard: [[
            { text: "🚀 Reproduzir agora", callback_data: `ingest_remix:${r.idea_id}` },
            { text: "💡 Só a ideia", callback_data: `ingest_concept:${r.idea_id}` },
          ], [
            { text: "📋 Backlog", callback_data: `ingest_backlog:${r.idea_id}` },
            { text: "🗑️ Descartar", callback_data: `ingest_discard:${r.idea_id}` },
          ]] },
        }),
      });
    } catch (e) { console.error("ingest preview send failed:", e.message); }
  }
  return true;
}

async function consumePendingEditIfAny(chatId, text) {
  // Returns true if this text was consumed as an edit hint (next regen with hint).
  const all = loadPendingEdit();
  const entry = all[String(chatId)];
  if (!entry || !pendingEditFresh(entry)) {
    if (entry) { delete all[String(chatId)]; savePendingEdit(all); }
    return false;
  }
  // Text is the edit hint. Consume + clear.
  const { run_id } = entry;
  const hint = text.trim();
  delete all[String(chatId)];
  savePendingEdit(all);
  const reviewer = reviewerOf(chatId);

  audit({ event: "edit_v2_hint_received", run_id, reviewer, hint });
  await send(`✏️ Editando \`${run_id}\` com hint:\n> ${hint.slice(0, 200)}\n\n_Regenerando..._`);

  // First, mark current draft as blocked with reason (so reject is audit-recorded).
  if (fs.existsSync(PIPELINE_DB)) {
    const db = new Database(PIPELINE_DB);
    try {
      db.prepare(`UPDATE runs SET state='blocked', failure_reason=?, updated_at=? WHERE run_id=?`)
        .run(`edit_v2 hint: ${hint.slice(0, 400)}`, new Date().toISOString(), run_id);
    } finally { db.close(); }
  }

  // Save hint to a file so content-generator can pick it up.
  const hintPath = path.join(ROOT, "runs", run_id, "regen-hint.txt");
  try {
    fs.mkdirSync(path.dirname(hintPath), { recursive: true });
    fs.writeFileSync(hintPath, hint);
  } catch (e) { console.error("hint write failed", e.message); }

  // Regen.
  try {
    execSync(`node ${path.join(ROOT, "scripts", "agents", "content-generator.mjs")} --run ${run_id} 2>&1`, { cwd: ROOT, encoding: "utf-8", timeout: 240000 });
    audit({ event: "edit_v2_regen_ok", run_id, reviewer });
    // Auto re-notify (deletes prev approval card + sends fresh).
    try {
      execSync(`node ${path.join(ROOT, "scripts", "agents", "telegram-approval.mjs")} --notify ${run_id} --force 2>&1`, { cwd: ROOT, encoding: "utf-8", timeout: 60000 });
    } catch (e) { console.error("re-notify failed:", e.message); }
    // Cleanup hint file so subsequent regens (without hint) don't reuse it.
    try { fs.unlinkSync(hintPath); } catch {}
  } catch (e) {
    audit({ event: "edit_v2_regen_failed", run_id, reviewer, error: e.message?.slice(0, 200) });
    await send(`❌ regen falhou: ${e.message.slice(0, 400)}`);
  }
  return true;
}

async function handleUpdate(update) {
  if (update.callback_query) return handleCallbackQuery(update.callback_query);
  const msg = update.message;
  if (!msg || !msg.text) return;
  if (!REVIEWERS[String(msg.chat.id)] && String(msg.chat.id) !== String(CHAT_ID)) {
    audit({ event: "unauthorized_chat", chat_id: msg.chat.id, text: msg.text.slice(0, 50) });
    return; // ignore non-authorized chats
  }

  // First: if this text is a /command, clear any pending edit + handle as command.
  const isCommand = msg.text.trim().startsWith("/");
  if (isCommand) {
    const all = loadPendingEdit();
    if (all[String(msg.chat.id)]) { delete all[String(msg.chat.id)]; savePendingEdit(all); }
  } else {
    // Non-command text: (1) URL middleware first (ingest if any URL detected),
    //                   (2) then pending-edit consumer.
    const urls = detectUrls(msg.text);
    if (urls.length) {
      const consumed = await handleIngestUrls(msg.chat.id, urls);
      if (consumed) return;
    }
    const consumed = await consumePendingEditIfAny(msg.chat.id, msg.text);
    if (consumed) return;
  }

  const parsed = parseCommand(msg.text);
  if (!parsed) return;
  audit({ event: "command_received", cmd: parsed.cmd, args: parsed.args, reviewer: reviewerOf(msg.chat.id) });
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
