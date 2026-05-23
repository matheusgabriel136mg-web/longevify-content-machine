// scripts/agents/cleanup-stale-approvals.mjs — One-shot retro cleanup.
//
// Pre-fix, every regen left an orphan approval card in the chat. The state file
// (_approval-notifications.json) only stores the LAST card's message_id, but
// older cards may still be visible (and clickable, with stale callback_data).
//
// This script can't enumerate full chat history (Telegram getUpdates is bounded),
// but it CAN scan _approval-notifications.json for any tracked previous IDs and
// delete them. For deeper history we'd need a per-runId message_id log — out of scope.
//
// Use: node scripts/agents/cleanup-stale-approvals.mjs [--dry-run]
//
// Practical effect on existing fleet:
//   - For each runId in state file with decided_at set: deletes the buttons_message_id
//     and media_message_ids (no longer needed; founder already decided)
//   - For each runId without decided_at: leaves alone (those are the live cards)

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { deleteTelegramMessage } from "./telegram-notify.mjs";

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

const STATE_PATH = path.join(ROOT, "runs", "_approval-notifications.json");
const dryRun = process.argv.includes("--dry-run");

if (!fs.existsSync(STATE_PATH)) {
  console.log("No approval state file. Nothing to clean.");
  process.exit(0);
}

const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
let deleted = 0, skipped = 0;
const updated = { ...state };

for (const [runId, entry] of Object.entries(state)) {
  if (!entry.decided_at) {
    console.log(`· ${runId} — live (no decision yet), skipping`);
    skipped++;
    continue;
  }
  const targets = [
    ...(entry.media_message_ids || []),
    entry.buttons_message_id,
  ].filter(Boolean);
  if (!targets.length) continue;

  console.log(`✗ ${runId} (decided ${entry.decided_at}) — deleting ${targets.length} msg${targets.length > 1 ? "s" : ""}`);
  if (!dryRun) {
    for (const mid of targets) {
      const r = await deleteTelegramMessage(mid);
      if (r?.ok) deleted++;
    }
    updated[runId] = { ...entry, media_message_ids: [], buttons_message_id: null, cleaned_at: new Date().toISOString() };
  } else {
    deleted += targets.length;  // count what would have been deleted
  }
}

if (!dryRun) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(updated, null, 2));
}

console.log(`\nDone. ${dryRun ? "[DRY RUN] would have deleted" : "Deleted"} ${deleted} message${deleted !== 1 ? "s" : ""}, ${skipped} live cards left alone.`);
