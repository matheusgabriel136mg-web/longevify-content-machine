// scripts/agents/daily-digest.mjs — Daily digest of big3-watcher auto-ingested posts.
//
// Runs 6:30am BRT via systemd (after big3-watcher at 6:00am).
// Queries ideas_backlog WHERE auto_ingested=1 AND ingested_at >= last 26h AND status='new'.
// Ranks by engagement_score, sends Telegram with top 3 as inline-button cards.

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { listAutoIngestedRecent, countBacklog } from "./idea-ingester.mjs";
import { sendTelegram } from "./telegram-notify.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");

const ENV_PATH = path.join(ROOT, ".env");
if (fs.existsSync(ENV_PATH)) {
  for (const line of fs.readFileSync(ENV_PATH, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const AUDIT_LOG = path.join(ROOT, "runs", "_audit-log.jsonl");
function audit(entry) {
  fs.mkdirSync(path.dirname(AUDIT_LOG), { recursive: true });
  fs.appendFileSync(AUDIT_LOG, JSON.stringify({ ts: new Date().toISOString(), agent: "daily-digest", ...entry }) + "\n");
}

function summarizeIdea(idea) {
  const headline = (idea.original_caption || "").split(/[.!?\n]/)[0]?.trim() || "(sem headline)";
  return headline.length > 60 ? headline.slice(0, 60) + "…" : headline;
}

async function sendPostCard(idea, rank) {
  if (!TOKEN || !CHAT_ID) return null;
  const headline = summarizeIdea(idea);
  const engagement = idea.engagement_score?.toFixed(2) ?? "—";
  const text = [
    `*${rank}. ${idea.source_brand}* · _${headline}_`,
    `engagement: ${engagement} · suggested: ${idea.persona_suggested}/P${idea.pillar_suggested}`,
    `\`${idea.source_url}\``,
  ].join("\n");
  try {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: false,
        reply_markup: { inline_keyboard: [[
          { text: "🚀 Reproduzir", callback_data: `ingest_remix:${idea.id}` },
          { text: "💡 Só a ideia", callback_data: `ingest_concept:${idea.id}` },
        ], [
          { text: "📋 Backlog", callback_data: `ingest_backlog:${idea.id}` },
          { text: "🗑️ Descartar", callback_data: `ingest_discard:${idea.id}` },
        ]] },
      }),
    });
    return await r.json();
  } catch (e) { console.error("card send failed:", e.message); return null; }
}

async function main() {
  console.log(`\n🌅 daily-digest · ${new Date().toISOString()}\n`);
  const recent = listAutoIngestedRecent(26);
  const high = recent.filter(r => (r.engagement_score || 0) >= 1.0);  // arbitrary threshold
  const top3 = recent.slice(0, 3);
  const backlogTotal = countBacklog();

  console.log(`  ${recent.length} novos (auto) · ${high.length} high-engagement · backlog total ${backlogTotal}`);

  if (recent.length === 0) {
    console.log("  (sem novidades — pulando digest)\n");
    audit({ event: "digest_empty" });
    return;
  }

  const header = [
    `🌅 *Big 3 digest* · ${new Date().toLocaleDateString("pt-BR")}`,
    "",
    `${recent.length} novos posts · ${high.length} high-engagement`,
    `📋 backlog total: ${backlogTotal} · /backlog pra navegar`,
    "",
    `🔥 *Top ${Math.min(top3.length, 3)} de hoje:*`,
  ].join("\n");
  await sendTelegram(header);

  for (let i = 0; i < top3.length; i++) {
    await sendPostCard(top3[i], i + 1);
  }

  audit({ event: "digest_sent", new_count: recent.length, top_count: top3.length, backlog_total: backlogTotal });
  console.log(`\n✅ Digest sent (${top3.length} cards).\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
