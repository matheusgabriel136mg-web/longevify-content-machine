// scripts/agents/telegram-approval.mjs — Telegram approval orchestrator.
//
// Modes:
//   --notify <runId>       Send the approval request to the founder chat (idempotent).
//   --reminder-check       Periodic sweep: 24h reminder + 48h stale → blocked.
//
// Triggered from pipeline.mjs handleApproving() on first entry, AND from systemd
// timer (longevify-approval-reminder, hourly) as fallback + reminder/stale ticker.
//
// State file: runs/_approval-notifications.json
//   { "<run_id>": { notified_at, message_id, reminder_sent_at, decided_at, decision, reviewer, reason } }

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import Database from "better-sqlite3";
import { summarizeDraft } from "./dashboard-helpers.mjs";
import { sendTelegram, sendPhotoAlbum, sendWithApproveButtons, deleteTelegramMessage } from "./telegram-notify.mjs";
import { composePrepublishAlert, formatRelativeDate, humanizeRunId, formatStatusEmoji } from "./formatTelegram.mjs";

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

const PIPELINE_DB = path.join(ROOT, "runs", "_pipeline.db");
const STATE_PATH = path.join(ROOT, "runs", "_approval-notifications.json");
const AUDIT_LOG = path.join(ROOT, "runs", "_audit-log.jsonl");

const REMINDER_AFTER_H = 24;
const STALE_AFTER_H = 48;

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf-8")); } catch { return {}; }
}
function saveState(s) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}
function audit(entry) {
  fs.mkdirSync(path.dirname(AUDIT_LOG), { recursive: true });
  fs.appendFileSync(AUDIT_LOG, JSON.stringify({ ts: new Date().toISOString(), agent: "telegram-approval", ...entry }) + "\n");
}

// ─── Compose the approval message ─────────────────────────────────────────────
function composeApprovalText(summary, opts = {}) {
  const { regenCount = 0 } = opts;
  const f = summary.flags;
  const title = humanizeRunId(summary.run_id);
  const when = f.scheduled_for ? formatRelativeDate(f.scheduled_for) : "📌 sem slot (publica imediato)";
  const persona = f.persona || "?";
  const pillar = f.pillar ? `P${f.pillar}` : "P?";
  const fmt = f.format || "?";

  const emPill = f.em_dash_count >= 4 ? "❌ — × " + f.em_dash_count
              : f.em_dash_count >= 2 ? "⚠️ — × " + f.em_dash_count
              : "✓ — × " + f.em_dash_count;
  const slopPill = f.slop ? (
    f.slop.action === "reject" ? "❌ slop reject"
    : f.slop.action === "deduct" ? "⚠️ slop revise"
    : "✓ slop ok"
  ) : "";
  const scorePill = f.editor_score != null
    ? `📊 ${f.editor_score}/12${f.editor_decision ? " " + f.editor_decision : ""}`
    : "";

  const captionPreview = summary.caption
    ? (summary.caption.length > 200 ? summary.caption.slice(0, 200).trim() + "…" : summary.caption.trim())
    : "_(sem caption)_";

  const nowBRT = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  const versionTag = regenCount > 0 ? `🔄 *regen #${regenCount}* · ${nowBRT}` : `🕐 ${nowBRT} BRT`;

  return [
    `📝 *Approval · ${title}*`,
    versionTag,
    "",
    `\`${summary.run_id}\``,
    `${when} · ${pillar} · ${persona} · ${fmt}`,
    "",
    `${emPill}${slopPill ? "  ·  " + slopPill : ""}${scorePill ? "  ·  " + scorePill : ""}`,
    "",
    captionPreview,
  ].join("\n");
}

// ─── notify ────────────────────────────────────────────────────────────────────
// 1-card-per-runId. Deletes previous media + buttons message before sending new.
// State tracks: notified_at, regen_count, media_message_ids[], buttons_message_id.
export async function notifyApproval(runId, opts = {}) {
  const { force = false } = opts;
  const state = loadState();
  const prev = state[runId] || {};

  if (prev.notified_at && !prev.decided_at && !force) {
    console.log(`(already notified ${runId} at ${prev.notified_at})`);
    return { ok: true, skipped: true };
  }

  const summary = summarizeDraft(runId);
  if (!summary) {
    audit({ event: "notify_skipped_missing", run_id: runId });
    return { ok: false, reason: "summarize failed" };
  }

  // ─── Asset gate (last line of defense — never send media-less approval) ───
  // 2026-05-23: founder approved blindly on concept-mode card without slides.
  // This gate blocks any notify where assets/ has no slide-*.png and no video.
  const hasSlides = (summary.slides?.length || 0) > 0;
  const hasVideos = (summary.videos?.length || 0) > 0;
  if (!hasSlides && !hasVideos) {
    audit({ event: "notify_aborted_no_media", run_id: runId });
    console.error(`✗ notify aborted: run ${runId} has no slide-*.png or *.mp4 in assets/`);
    try { await sendTelegram(`🚨 \`${runId}\` notify abortado — sem media renderizado.\nRoda \`generator.mjs --run ${runId}\` antes de tentar de novo.`); } catch {}
    return { ok: false, reason: "no_media_in_assets" };
  }

  // ─── Step 1: delete previous approval card (1-card-per-runId rule) ──────────
  if (prev.media_message_ids?.length) {
    for (const mid of prev.media_message_ids) {
      await deleteTelegramMessage(mid);
    }
  }
  if (prev.buttons_message_id) {
    await deleteTelegramMessage(prev.buttons_message_id);
  }

  // ─── Step 2: send media (photo album OR video) ──────────────────────────────
  const assetsDir = path.join(ROOT, "runs", runId, "assets");
  let mediaMessageIds = [];
  let mediaTopMsgId = null;
  if (fs.existsSync(assetsDir) && (summary.slides?.length || summary.videos?.length)) {
    try {
      if (summary.videos?.length) {
        const vid = path.join(assetsDir, summary.videos[0]);
        const r = await sendVideo(vid, "");
        if (r?.result?.message_id) { mediaMessageIds = [r.result.message_id]; mediaTopMsgId = r.result.message_id; }
      } else {
        const slides = summary.slides.slice(0, 10).map(f => path.join(assetsDir, f));
        const r = await sendPhotoAlbum(slides, "");
        mediaMessageIds = r?.message_ids || [];
        mediaTopMsgId = mediaMessageIds[0] || null;
      }
    } catch (e) {
      console.error("media send failed:", e.message);
    }
  }

  // ─── Step 3: send text + inline buttons, replying to the media group ────────
  const regenCount = (prev.regen_count || 0) + (force && prev.notified_at ? 1 : 0);
  const text = composeApprovalText(summary, { regenCount });
  const buttonsResult = await sendWithApproveButtons(text, runId, {
    replyToMessageId: mediaTopMsgId || undefined,
  });
  const buttonsMessageId = buttonsResult?.results?.[0]?.message_id || null;

  state[runId] = {
    ...prev,
    notified_at: new Date().toISOString(),
    notified_force: force,
    regen_count: regenCount,
    media_message_ids: mediaMessageIds,
    buttons_message_id: buttonsMessageId,
    decided_at: null,         // reset on re-notify (regen case)
    reminder_sent_at: null,   // reset on re-notify
  };
  saveState(state);
  audit({ event: "approval_notified", run_id: runId, regen_count: regenCount, buttons_message_id: buttonsMessageId });
  return { ok: !!buttonsResult?.ok, runId, buttons_message_id: buttonsMessageId };
}

// Native sendVideo (telegram-notify doesn't have one yet).
async function sendVideo(videoPath, caption = "") {
  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  if (!TOKEN || !CHAT_ID) return { ok: false };
  const FormData = globalThis.FormData;
  const form = new FormData();
  form.append("chat_id", CHAT_ID);
  if (caption) form.append("caption", caption);
  const buf = fs.readFileSync(videoPath);
  form.append("video", new Blob([buf], { type: "video/mp4" }), path.basename(videoPath));
  try {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendVideo`, { method: "POST", body: form });
    return await r.json();
  } catch (e) { return { ok: false, error: e.message }; }
}

// ─── reminder + stale check ───────────────────────────────────────────────────
export async function reminderCheck() {
  const state = loadState();
  const now = Date.now();
  let remindersSent = 0;
  let staleMoved = 0;

  for (const [runId, entry] of Object.entries(state)) {
    if (entry.decided_at) continue;          // already decided, skip
    if (!entry.notified_at) continue;        // somehow no notification timestamp
    const ageH = (now - new Date(entry.notified_at).getTime()) / 3_600_000;

    if (ageH > STALE_AFTER_H) {
      // Move to blocked + audit.
      if (fs.existsSync(PIPELINE_DB)) {
        const db = new Database(PIPELINE_DB);
        try {
          db.prepare(`UPDATE runs SET state='blocked', failure_reason='stale_no_approval_48h', updated_at=? WHERE run_id=?`)
            .run(new Date().toISOString(), runId);
        } finally { db.close(); }
      }
      await sendTelegram(`🪦 *Stale* \`${runId}\` — 48h sem decisão. Movido pra backlog (state=blocked).`);
      audit({ event: "stale_marked", run_id: runId, age_hours: ageH.toFixed(1) });
      state[runId].decided_at = new Date().toISOString();
      state[runId].decision = "stale_blocked";
      state[runId].reviewer = "auto-staler";
      staleMoved++;
    }
    else if (ageH > REMINDER_AFTER_H && !entry.reminder_sent_at) {
      await sendTelegram(`⏰ *Lembrete* \`${runId}\` — ${ageH.toFixed(0)}h sem decisão. Aprova, edita, refaz ou descarta no thread original.\n\n_Stale em ${(STALE_AFTER_H - ageH).toFixed(0)}h._`);
      state[runId].reminder_sent_at = new Date().toISOString();
      audit({ event: "reminder_sent", run_id: runId, age_hours: ageH.toFixed(1) });
      remindersSent++;
    }
  }
  saveState(state);
  console.log(`reminder-check: ${remindersSent} reminders, ${staleMoved} stale moved.`);
  return { remindersSent, staleMoved };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs() {
  const a = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--notify") out.notify = a[++i];
    else if (a[i] === "--reminder-check") out.reminderCheck = true;
    else if (a[i] === "--force") out.force = true;
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs();
  if (args.notify) {
    const r = await notifyApproval(args.notify, { force: args.force });
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  } else if (args.reminderCheck) {
    const r = await reminderCheck();
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
  } else {
    console.error("Usage: telegram-approval.mjs --notify <runId> [--force] | --reminder-check");
    process.exit(1);
  }
}
