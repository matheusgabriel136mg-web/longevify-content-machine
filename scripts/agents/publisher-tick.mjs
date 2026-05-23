// scripts/agents/publisher-tick.mjs — Sweep state='approved' runs and publish when slot due.
//
// Runs every 5min via systemd timer longevify-publisher.timer.
// Selection criteria:
//   state = 'approved'
//   AND scheduled_for <= now + 1min (small grace so we don't miss the boundary)
//
// For each:
//   1. Run npm run publish -- --run <id>
//   2. On success: state='published', audit, Telegram confirmation
//   3. On failure: state='failed', audit, Telegram alert
//
// Idempotent — sets state='published'/'failed' so the same row won't be retried.

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import Database from "better-sqlite3";
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

const PIPELINE_DB = path.join(ROOT, "runs", "_pipeline.db");
const AUDIT_LOG = path.join(ROOT, "runs", "_audit-log.jsonl");

function audit(entry) {
  fs.mkdirSync(path.dirname(AUDIT_LOG), { recursive: true });
  fs.appendFileSync(AUDIT_LOG, JSON.stringify({ ts: new Date().toISOString(), agent: "publisher-tick", ...entry }) + "\n");
}

if (!fs.existsSync(PIPELINE_DB)) {
  console.log("pipeline.db missing — nothing to do");
  process.exit(0);
}

const db = new Database(PIPELINE_DB);
const nowIso = new Date().toISOString();
const cutoffIso = new Date(Date.now() + 60 * 1000).toISOString();

const due = db.prepare(`
  SELECT run_id, scheduled_for FROM runs
  WHERE state = 'approved'
    AND scheduled_for IS NOT NULL
    AND scheduled_for <= ?
  ORDER BY scheduled_for ASC
`).all(cutoffIso);

console.log(`publisher-tick: ${due.length} run(s) due (cutoff ${cutoffIso})`);

for (const r of due) {
  console.log(`\n→ publishing ${r.run_id} (slot ${r.scheduled_for})...`);
  try {
    const out = execSync(`cd ${ROOT} && npm run publish -- --run ${r.run_id} 2>&1`, { encoding: "utf-8", timeout: 300000 });
    const mediaId = (out.match(/media_id:\s*(\S+)/) ?? [, "?"])[1];
    db.prepare(`UPDATE runs SET state='published', updated_at=? WHERE run_id=?`).run(nowIso, r.run_id);
    audit({ event: "publisher_tick_published", run_id: r.run_id, media_id: mediaId, scheduled_for: r.scheduled_for });
    await sendTelegram(`📤 *Publicado* \`${r.run_id}\`\nmedia_id: \`${mediaId}\`\nslot: ${r.scheduled_for}`);
    console.log(`  ✅ media_id ${mediaId}`);
  } catch (e) {
    db.prepare(`UPDATE runs SET state='failed', failure_reason=?, updated_at=? WHERE run_id=?`)
      .run(`publisher-tick: ${e.message.slice(0, 400)}`, nowIso, r.run_id);
    audit({ event: "publisher_tick_failed", run_id: r.run_id, error: e.message?.slice(0, 300) });
    await sendTelegram(`🚨 *Publish FAILED* \`${r.run_id}\`\n\n\`\`\`\n${e.message.slice(0, 500)}\n\`\`\``);
    console.error(`  ✗ ${e.message.slice(0, 200)}`);
  }
}

db.close();
console.log(`\npublisher-tick done.`);
