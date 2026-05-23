// scripts/agents/telegram-notify.mjs — Push notification via Telegram Bot API
//
// Use cases:
//   - Daily Content Brief 7am (Diarization #1)
//   - Publish trigger 15min before scheduled slot
//   - Hard blocker / circuit breaker alert
//   - Editor escalations (CFM risk, quality flag)
//
// Setup:
//   1. Telegram → @BotFather → /newbot → save BOT_TOKEN
//   2. Send msg to your bot → curl getUpdates → save CHAT_ID
//   3. Add to .env: TELEGRAM_BOT_TOKEN=... + TELEGRAM_CHAT_ID=...
//
// CLI:
//   node scripts/agents/telegram-notify.mjs --text "Brief 7am pronto"
//   node scripts/agents/telegram-notify.mjs --file path/to/brief.md
//   node scripts/agents/telegram-notify.mjs --alert "Cost circuit breaker: gasto R$210/dia"

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");

// Manual .env loader
const ENV_PATH = path.join(ROOT, ".env");
if (fs.existsSync(ENV_PATH)) {
  for (const line of fs.readFileSync(ENV_PATH, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export async function sendTelegram(text, opts = {}) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.error("⚠ TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing in .env. Setup pending.");
    return { ok: false, reason: "missing_env" };
  }

  const { parseMode = "Markdown", silent = false, replyMarkup = null, replyToMessageId = null } = opts;

  // Telegram limit: 4096 chars per message
  const chunks = chunkText(text, 4000);
  const results = [];

  for (const chunk of chunks) {
    try {
      const body = {
        chat_id: CHAT_ID,
        text: chunk,
        parse_mode: parseMode,
        disable_notification: silent,
        disable_web_page_preview: true,
      };
      if (replyToMessageId && chunks.indexOf(chunk) === 0) {
        body.reply_to_message_id = replyToMessageId;
      }
      // Inline keyboard (callback_data buttons) — só na última chunk
      if (replyMarkup && chunks.indexOf(chunk) === chunks.length - 1) {
        body.reply_markup = replyMarkup;
      }
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) {
        console.error("Telegram API error:", json);
        results.push({ ok: false, error: json });
      } else {
        results.push({ ok: true, message_id: json.result.message_id });
      }
    } catch (e) {
      console.error("Telegram fetch failed:", e.message);
      results.push({ ok: false, error: e.message });
    }
  }

  return { ok: results.every(r => r.ok), chunks: results.length, results };
}

export async function sendAlert(text, severity = "info") {
  // severity: info | warn | critical
  const prefix = { info: "ℹ️", warn: "⚠️", critical: "🚨" }[severity] || "ℹ️";
  const formatted = `${prefix} *Longevify alert · ${severity.toUpperCase()}*\n\n${text}`;
  return sendTelegram(formatted, { silent: severity === "info" });
}

export async function sendDailyBrief(briefMarkdown) {
  const header = `📋 *Daily Content Brief · ${new Date().toLocaleDateString("pt-BR")}*\n\n`;
  return sendTelegram(header + briefMarkdown, { silent: false });
}

// Send photo album (up to 10 PNGs as media group)
export async function sendPhotoAlbum(photoPaths, caption = "") {
  if (!BOT_TOKEN || !CHAT_ID) return { ok: false, reason: "missing_env" };
  if (!photoPaths.length) return { ok: false, reason: "no_photos" };
  // Native FormData (Node 18+); legacy fallback only if globalThis.FormData missing.
  let FormDataCtor = globalThis.FormData;
  if (!FormDataCtor) {
    try { FormDataCtor = (await import("formdata-node")).FormData; }
    catch { return { ok: false, reason: "no_formdata_available" }; }
  }
  const form = new FormDataCtor();
  form.append("chat_id", CHAT_ID);
  const media = photoPaths.slice(0, 10).map((p, i) => ({
    type: "photo",
    media: `attach://photo${i}`,
    caption: i === 0 ? caption : undefined,
    parse_mode: i === 0 ? "Markdown" : undefined,
  }));
  form.append("media", JSON.stringify(media));
  for (let i = 0; i < photoPaths.slice(0, 10).length; i++) {
    const buf = fs.readFileSync(photoPaths[i]);
    form.append(`photo${i}`, new Blob([buf], { type: "image/png" }), path.basename(photoPaths[i]));
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMediaGroup`, {
      method: "POST",
      body: form,
    });
    const json = await res.json();
    const message_ids = Array.isArray(json.result) ? json.result.map(m => m.message_id) : [];
    return { ok: json.ok, json, message_ids };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Delete a message (single message_id). Silent on failure (e.g. message gone, too old).
export async function deleteTelegramMessage(messageId) {
  if (!BOT_TOKEN || !CHAT_ID || !messageId) return { ok: false };
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, message_id: messageId }),
    });
    return await res.json();
  } catch { return { ok: false }; }
}

// Send approve/cancel inline buttons attached to text.
// Default = "approval-v2" flow buttons (matches the bot's new handlers + dashboard endpoints).
// Pass `kind: "legacy"` to get the old publish-direct buttons (used by prepublish-alerts T-15min).
export async function sendWithApproveButtons(text, runId, opts = {}) {
  const kind = opts.kind || "approval-v2";
  const replyMarkup = kind === "legacy"
    ? {
        inline_keyboard: [[
          { text: "✅ Approve + Publish", callback_data: `publish:${runId}` },
          { text: "🚫 Cancel", callback_data: `cancel:${runId}` },
        ], [
          { text: "🔄 Re-edit", callback_data: `reedit:${runId}` },
          { text: "🗑 Discard", callback_data: `discard:${runId}` },
        ]],
      }
    : {
        inline_keyboard: [[
          { text: "✅ Aprovar", callback_data: `approve_v2:${runId}` },
          { text: "✏️ Editar", callback_data: `edit_v2:${runId}` },
        ], [
          { text: "🔄 Refazer", callback_data: `regen_v2:${runId}` },
          { text: "🗑️ Descartar", callback_data: `discard_v2:${runId}` },
        ]],
      };
  return sendTelegram(text, { ...opts, replyMarkup });
}

function chunkText(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + maxLen, text.length);
    if (end < text.length) {
      // Break on newline near end
      const lastNL = text.lastIndexOf("\n", end);
      if (lastNL > i + maxLen * 0.7) end = lastNL;
    }
    chunks.push(text.slice(i, end));
    i = end;
  }
  return chunks;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs() {
  const a = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--text") out.text = a[++i];
    else if (a[i] === "--file") out.file = a[++i];
    else if (a[i] === "--alert") { out.alert = a[++i]; out.severity = a[i+1] && !a[i+1].startsWith("--") ? a[++i] : "info"; }
    else if (a[i] === "--brief") out.brief = a[++i];
    else if (a[i] === "--silent") out.silent = true;
    else if (a[i] === "--test") out.test = true;
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs();

  if (args.test) {
    const r = await sendTelegram("🤖 Test message from content-machine. Setup OK.", { silent: true });
    console.log(r.ok ? "✓ Telegram setup funcionando" : `✗ Falhou: ${JSON.stringify(r)}`);
    process.exit(r.ok ? 0 : 1);
  }

  let text;
  if (args.alert) {
    const r = await sendAlert(args.alert, args.severity);
    console.log(r.ok ? "✓ alert enviado" : `✗ ${JSON.stringify(r)}`);
    process.exit(r.ok ? 0 : 1);
  }

  if (args.brief) {
    const briefText = fs.readFileSync(args.brief, "utf-8");
    const r = await sendDailyBrief(briefText);
    console.log(r.ok ? `✓ brief enviado (${r.chunks} chunks)` : `✗ ${JSON.stringify(r)}`);
    process.exit(r.ok ? 0 : 1);
  }

  if (args.text) text = args.text;
  else if (args.file) text = fs.readFileSync(args.file, "utf-8");
  else {
    console.error("Usage: telegram-notify.mjs --text <s> | --file <path> | --alert <msg> [severity] | --brief <md-file> | --test");
    process.exit(1);
  }

  const r = await sendTelegram(text, { silent: args.silent });
  console.log(r.ok ? `✓ enviado (${r.chunks} chunks)` : `✗ ${JSON.stringify(r)}`);
  process.exit(r.ok ? 0 : 1);
}
