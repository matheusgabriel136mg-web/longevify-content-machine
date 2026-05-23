// scripts/agents/pipeline-helpers.mjs — shared end-to-end pipeline orchestration.
//
// Used by: remix-mode, concept-mode, Big 3 auto-watcher, manual content-gen.
// Single source of truth for the "full pipeline" sequence:
//   1. content-generator.mjs (text/data/caption via LLM)
//   2. generator.mjs (visual render via templates)
//   3. assertHasMedia (≥1 slide PNG produced)
//   4. telegram-approval.mjs --notify --force (approval card with media group)
//
// If ANY step fails, state='failed' in pipeline.db + Telegram alert to founder +
// audit log entry. Approval card is NEVER sent on a half-rendered run.

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import Database from "better-sqlite3";
import { sendTelegram } from "./telegram-notify.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");

const PIPELINE_DB = path.join(ROOT, "runs", "_pipeline.db");
const AUDIT_LOG = path.join(ROOT, "runs", "_audit-log.jsonl");

function audit(entry) {
  fs.mkdirSync(path.dirname(AUDIT_LOG), { recursive: true });
  fs.appendFileSync(AUDIT_LOG, JSON.stringify({ ts: new Date().toISOString(), agent: "pipeline-helpers", ...entry }) + "\n");
}

function markFailed(runId, reason) {
  if (!fs.existsSync(PIPELINE_DB)) return;
  const db = new Database(PIPELINE_DB);
  try {
    db.prepare(`UPDATE runs SET state='failed', failure_reason=?, updated_at=? WHERE run_id=?`)
      .run(String(reason).slice(0, 500), new Date().toISOString(), runId);
  } finally { db.close(); }
}

// Counts rendered slide PNGs in runs/<id>/assets/.
export function countSlideAssets(runId) {
  const assetsDir = path.join(ROOT, "runs", runId, "assets");
  if (!fs.existsSync(assetsDir)) return 0;
  return fs.readdirSync(assetsDir).filter(f => /^slide-\d+.*\.(png|jpg|jpeg|webp)$/i.test(f)).length;
}

// True if at least one slide PNG exists. Reels: also accept .mp4 in assets.
export function hasMediaAssets(runId) {
  const assetsDir = path.join(ROOT, "runs", runId, "assets");
  if (!fs.existsSync(assetsDir)) return false;
  const files = fs.readdirSync(assetsDir);
  return files.some(f => /^slide-\d+.*\.(png|jpg|jpeg|webp)$/i.test(f))
      || files.some(f => /\.(mp4|mov|webm)$/i.test(f));
}

// Run a single step, log, return { ok, output, error }.
function runStep(name, cmd, opts = {}) {
  const timeout = opts.timeout || 240000;
  try {
    const out = execSync(cmd, { cwd: ROOT, encoding: "utf-8", timeout });
    return { ok: true, output: out };
  } catch (e) {
    const errMsg = (e.stderr?.toString?.() || e.message || "").slice(0, 600);
    return { ok: false, error: errMsg, name };
  }
}

// Main entrypoint. Caller provides runId + (optional) sourceLabel for audit.
// Returns { ok, run_id, failed_at?: "content-generator"|"generator"|"no_media"|"notify" }
export async function runFullPipeline(runId, opts = {}) {
  const { source = "manual", reviewer = "system", skipNotify = false } = opts;
  audit({ event: "pipeline_start", run_id: runId, source });

  // ─── Step 1: content-generator (LLM text/data/caption) ──────────────────────
  console.log(`  ⏳ [1/3] content-generator...`);
  const r1 = runStep("content-generator", `node ${path.join(__dirname, "content-generator.mjs")} --run ${runId} 2>&1`);
  if (!r1.ok) {
    markFailed(runId, `content-generator: ${r1.error}`);
    audit({ event: "pipeline_step_failed", run_id: runId, step: "content-generator", error: r1.error });
    try { await sendTelegram(`🚨 *Pipeline FAILED* \`${runId}\`\n\nstep: *content-generator*\n\`\`\`\n${r1.error.slice(0, 400)}\n\`\`\``); } catch {}
    return { ok: false, run_id: runId, failed_at: "content-generator", error: r1.error };
  }
  console.log(`  ✓ content-generator done`);

  // ─── Step 2: generator (visual render) ──────────────────────────────────────
  console.log(`  ⏳ [2/3] generator (visual)...`);
  const r2 = runStep("generator", `node ${path.join(__dirname, "generator.mjs")} --run ${runId} 2>&1`);
  if (!r2.ok) {
    markFailed(runId, `generator: ${r2.error}`);
    audit({ event: "pipeline_step_failed", run_id: runId, step: "generator", error: r2.error });
    try { await sendTelegram(`🚨 *Pipeline FAILED* \`${runId}\`\n\nstep: *generator (visual)*\n\`\`\`\n${r2.error.slice(0, 400)}\n\`\`\``); } catch {}
    return { ok: false, run_id: runId, failed_at: "generator", error: r2.error };
  }
  console.log(`  ✓ generator done`);

  // ─── Step 3: assert media exists ────────────────────────────────────────────
  const assetCount = countSlideAssets(runId);
  if (!hasMediaAssets(runId)) {
    const msg = `No media (slide-*.png or *.mp4) found in runs/${runId}/assets/. generator ran but produced nothing.`;
    markFailed(runId, `no_media: ${msg}`);
    audit({ event: "pipeline_step_failed", run_id: runId, step: "no_media", error: msg });
    try { await sendTelegram(`🚨 *Pipeline FAILED* \`${runId}\`\n\nstep: *asset check*\n${msg}`); } catch {}
    return { ok: false, run_id: runId, failed_at: "no_media", error: msg };
  }
  console.log(`  ✓ assets verified (${assetCount} slide(s))`);

  // ─── Step 4: notify approval (unless skipped) ───────────────────────────────
  if (skipNotify) {
    audit({ event: "pipeline_done_no_notify", run_id: runId, source });
    return { ok: true, run_id: runId, skipped_notify: true };
  }
  console.log(`  ⏳ [3/3] telegram-approval --notify --force...`);
  const r3 = runStep("notify", `node ${path.join(__dirname, "telegram-approval.mjs")} --notify ${runId} --force 2>&1`);
  if (!r3.ok) {
    audit({ event: "pipeline_step_failed", run_id: runId, step: "notify", error: r3.error });
    try { await sendTelegram(`⚠️ Run \`${runId}\` rendered OK mas notify falhou: ${r3.error.slice(0, 300)}`); } catch {}
    return { ok: false, run_id: runId, failed_at: "notify", error: r3.error };
  }
  console.log(`  ✓ approval card sent`);

  audit({ event: "pipeline_complete", run_id: runId, source, asset_count: assetCount });
  return { ok: true, run_id: runId, asset_count: assetCount };
}
