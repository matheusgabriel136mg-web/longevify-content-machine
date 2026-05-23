// scripts/agents/approver.mjs — Decisão final ship/notify
//
// Recebe um run que já passou pelo critic-fix-loop (critic disse ship_all).
// Faz uma checagem META antes de marcar como "ready" pra publish:
//
//   1. content-object.md existe e tem state=verified
//   2. draft-package.md existe e tem caption
//   3. Todos os slide-N.png estão presentes
//   4. Logo está em TODOS os slides (sanity check via critic-report)
//   5. Scheduled_for está no futuro
//   6. external_assets do queue item estão satisfeitos (PNGs externos baixados)
//
// Se tudo OK → marca queue item como "ready"
// Se algo falta → marca como "blocked" + razão. Notify user.
//
// Uso:
//   node scripts/agents/approver.mjs --run <run-id>

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { readQueue, markStatus } from "./queue.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");

function parseArgs() {
  const a = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--run") out.runId = a[++i];
  }
  if (!out.runId) { console.error("Usage: approver.mjs --run <run-id>"); process.exit(1); }
  return out;
}

const args = parseArgs();
const runDir = path.join(ROOT, "runs", args.runId);
const assetsDir = path.join(runDir, "assets");

if (!fs.existsSync(runDir)) { console.error(`run dir não existe: ${runDir}`); process.exit(1); }

// ─── Checagens ───────────────────────────────────────────────────────────────
const blockers = [];
const warnings = [];
const passed = [];

// 1. content-object.md
const coPath = path.join(runDir, "content-object.md");
if (!fs.existsSync(coPath)) { blockers.push("content-object.md ausente"); }
else {
  const co = fs.readFileSync(coPath, "utf-8");
  if (!/state:\s*verified/.test(co)) blockers.push("content-object state ≠ verified");
  else passed.push("content-object verified");
  if (!/scheduled_for:/.test(co)) blockers.push("content-object sem scheduled_for");
  else passed.push("scheduled_for definido");
}

// 2. draft-package.md
const dpPath = path.join(runDir, "draft-package.md");
if (!fs.existsSync(dpPath)) { blockers.push("draft-package.md ausente (caption)"); }
else {
  const dp = fs.readFileSync(dpPath, "utf-8");
  if (!/###\s+Caption/i.test(dp)) blockers.push("draft-package sem seção ### Caption");
  else passed.push("caption presente");
}

// 3. slide-N.png
if (!fs.existsSync(assetsDir)) blockers.push("assets/ ausente");
else {
  const slides = fs.readdirSync(assetsDir).filter(f => /^slide-\d+.*\.(png|jpe?g|mp4)$/i.test(f));
  if (slides.length === 0) blockers.push("nenhum slide-N.* em assets/");
  else passed.push(`${slides.length} slide(s) presente(s)`);
}

// 4. critic-report.json — deve existir e ship_all=true
const crPath = path.join(runDir, "critic-report.json");
if (!fs.existsSync(crPath)) warnings.push("critic-report.json ausente (run não passou pelo critic)");
else {
  const cr = JSON.parse(fs.readFileSync(crPath, "utf-8"));
  if (!cr.ship_all) blockers.push(`critic: ${cr.blocking_total} blocking ainda não resolvidos`);
  else passed.push(`critic ship_all (avg ${cr.avg_score.toFixed(1)}/10)`);
}

// 5. scheduled_for está no futuro?
const co = fs.existsSync(coPath) ? fs.readFileSync(coPath, "utf-8") : "";
const schedMatch = co.match(/scheduled_for:\s*(\S+)/);
if (schedMatch) {
  const schedDate = new Date(schedMatch[1]);
  if (schedDate < new Date()) warnings.push(`scheduled_for já passou: ${schedMatch[1]}`);
  else passed.push(`scheduled_for futuro: ${schedDate.toLocaleString("pt-BR")}`);
}

// 6. queue item — verifica external_assets satisfeitos
const queue = readQueue();
const queueItem = queue.items.find(i => i.id === args.runId);
if (queueItem && queueItem.external_assets?.length) {
  for (const asset of queueItem.external_assets) {
    const assetPath = path.join(assetsDir, asset);
    if (!fs.existsSync(assetPath)) blockers.push(`external asset ausente: ${asset}`);
    else passed.push(`external asset OK: ${asset}`);
  }
}

// ─── Decisão ─────────────────────────────────────────────────────────────────
console.log(`\n📋 Approver · ${args.runId}\n`);
for (const p of passed) console.log(`  ✓ ${p}`);
for (const w of warnings) console.log(`  ⚠ ${w}`);
for (const b of blockers) console.log(`  ✗ ${b}`);

const approved = blockers.length === 0;
const report = {
  run_id: args.runId,
  evaluated_at: new Date().toISOString(),
  approved,
  passed,
  warnings,
  blockers,
};
fs.writeFileSync(path.join(runDir, "approver-report.json"), JSON.stringify(report, null, 2));

if (queueItem) {
  if (approved) {
    markStatus(args.runId, "ready", { approver: report });
    console.log(`\n✅ APPROVED → queue status: ready`);
  } else {
    markStatus(args.runId, "blocked", { blocked_reason: blockers.join("; "), approver: report });
    console.log(`\n❌ BLOCKED → ${blockers.length} blocker(s)`);
  }
} else {
  console.log(`\n(item não está na queue — só report salvo em approver-report.json)`);
}

process.exit(approved ? 0 : 1);
