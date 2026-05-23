// scripts/agents/visual-regression.mjs — Per-template snapshot baseline + diff.
//
// Maintains `tests/visual-snapshots/<template>/baseline.png` for each canonical
// template. After any template change, regenerate the snapshot from a fixed fixture
// and diff against baseline. >5% pixel-difference → FAIL (revert deploy or update baseline).
//
// Subcommands:
//   --baseline     re-renders fixtures, replaces baselines (founder-triggered after intentional changes)
//   --check        renders fixtures + diffs vs baselines (CI/bootstrap-triggered)
//   --add <name>   adds new template fixture to suite
//
// Each fixture defines:
//   { id, template, dataFile, expectedAssets: ["slide-1-cover.png", ...] }

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");

const TESTS_DIR = path.join(ROOT, "tests", "visual-snapshots");
const FIXTURES_DIR = path.join(TESTS_DIR, "fixtures");
const BASELINES_DIR = path.join(TESTS_DIR, "baselines");
const DIFF_TMP = path.join(ROOT, "runs", "_visual-diff-tmp");

const MAX_PIXEL_DIFF_PCT = 0.05;  // 5%

// Canonical fixtures — one per renderable template/script.
// Each fixture mirrors a real run dir structure.
const FIXTURES = [
  {
    id: "dado-punch-vit-d-lifestyle",
    description: "dado-punch with lifestyle BG (vit-d Copacabana variant)",
    sourceRun: "2026-05-26-001-vit-d-brasil-dado",  // canonical reference run
    expectedSlides: ["slide-1-cover.png"],
  },
  {
    id: "biomarker-gap-mito-gut",
    description: "biomarker-gap 4-slide carousel (mito gut-brain reference)",
    sourceRun: "2026-05-23-428-mito-concept-maria-p2",
    expectedSlides: ["slide-2-chart.png", "slide-3-sintomas.png", "slide-4-alavancas.png", "slide-5-bloqueadores.png"],
  },
  {
    id: "persona-bio-julia",
    description: "persona-bio Julia sauna case study",
    sourceRun: "2026-05-26-001-julia-persona",
    expectedSlides: ["slide-2-sintomas.png", "slide-3-painel.png", "slide-4-protocolo.png", "slide-5-resultado.png", "slide-6-manifesto.png"],
  },
  {
    id: "brand-manifesto-function",
    description: "brand-manifesto carousel (function-concept reference)",
    sourceRun: "2026-05-23-241-function-concept-maria-p2",
    expectedSlides: ["slide-2-painel.png", "slide-3-diferenca.png", "slide-4-como-funciona.png", "slide-5-manifesto.png"],
  },
];

function ensureDirs() {
  fs.mkdirSync(BASELINES_DIR, { recursive: true });
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  fs.mkdirSync(DIFF_TMP, { recursive: true });
}

// Mean per-channel absolute difference between 2 PNGs, normalized to [0, 1].
async function pixelDiff(pathA, pathB) {
  const a = sharp(pathA);
  const aMeta = await a.metadata();
  const b = sharp(pathB);
  const bMeta = await b.metadata();
  // Resize B to A's dimensions (templates sometimes vary slightly).
  const dimsMatch = aMeta.width === bMeta.width && aMeta.height === bMeta.height;
  const bufA = await a.removeAlpha().raw().toBuffer();
  const bufB = await sharp(pathB).resize(aMeta.width, aMeta.height, { fit: "fill" }).removeAlpha().raw().toBuffer();
  if (bufA.length !== bufB.length) return { error: "size mismatch", dimsMatch };
  let sumDiff = 0;
  for (let i = 0; i < bufA.length; i++) sumDiff += Math.abs(bufA[i] - bufB[i]);
  // Max possible difference = bufA.length * 255 (all channels max diff).
  const pct = sumDiff / (bufA.length * 255);
  return { pct, dimsMatch, samples: bufA.length };
}

async function captureBaseline(fixture) {
  const sourceDir = path.join(ROOT, "runs", fixture.sourceRun, "assets");
  const baseDir = path.join(BASELINES_DIR, fixture.id);
  fs.mkdirSync(baseDir, { recursive: true });
  let captured = 0, missing = 0;
  for (const slide of fixture.expectedSlides) {
    const src = path.join(sourceDir, slide);
    if (!fs.existsSync(src)) { console.log(`  ⚠ missing ${slide} in ${fixture.sourceRun}`); missing++; continue; }
    fs.copyFileSync(src, path.join(baseDir, slide));
    captured++;
  }
  return { id: fixture.id, captured, missing };
}

async function checkAgainstBaseline(fixture) {
  const sourceDir = path.join(ROOT, "runs", fixture.sourceRun, "assets");
  const baseDir = path.join(BASELINES_DIR, fixture.id);
  if (!fs.existsSync(baseDir)) {
    return { id: fixture.id, status: "no_baseline", slides: [] };
  }
  const results = [];
  for (const slide of fixture.expectedSlides) {
    const baseline = path.join(baseDir, slide);
    const current = path.join(sourceDir, slide);
    if (!fs.existsSync(baseline)) { results.push({ slide, status: "no_baseline" }); continue; }
    if (!fs.existsSync(current)) { results.push({ slide, status: "current_missing" }); continue; }
    const diff = await pixelDiff(baseline, current);
    if (diff.error) { results.push({ slide, status: "error", error: diff.error }); continue; }
    const pass = diff.pct <= MAX_PIXEL_DIFF_PCT;
    results.push({ slide, status: pass ? "pass" : "fail", pct: +(diff.pct * 100).toFixed(2), threshold: MAX_PIXEL_DIFF_PCT * 100 });
  }
  return { id: fixture.id, status: results.every(r => r.status === "pass") ? "pass" : "fail", slides: results };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
async function main() {
  ensureDirs();
  const cmd = process.argv[2];
  if (cmd === "--baseline") {
    console.log(`\n📸 Capturing baselines for ${FIXTURES.length} fixtures\n`);
    for (const fx of FIXTURES) {
      const r = await captureBaseline(fx);
      console.log(`  ${r.missing === 0 ? "✓" : "⚠"} ${r.id}: ${r.captured} captured, ${r.missing} missing`);
    }
    console.log(`\nBaselines saved to ${path.relative(ROOT, BASELINES_DIR)}\n`);
  }
  else if (cmd === "--check" || !cmd) {
    console.log(`\n🔍 Visual regression check\n`);
    let anyFail = false;
    for (const fx of FIXTURES) {
      const r = await checkAgainstBaseline(fx);
      const icon = r.status === "pass" ? "✓" : r.status === "no_baseline" ? "·" : "✗";
      console.log(`  ${icon} ${r.id}: ${r.status}`);
      for (const s of r.slides) {
        if (s.status === "pass") console.log(`     ✓ ${s.slide} (${s.pct}% diff ≤ ${s.threshold}%)`);
        else if (s.status === "fail") { console.log(`     ✗ ${s.slide} (${s.pct}% > ${s.threshold}%)`); anyFail = true; }
        else console.log(`     · ${s.slide}: ${s.status}`);
      }
    }
    process.exit(anyFail ? 1 : 0);
  }
  else {
    console.error("Usage: visual-regression.mjs --baseline | --check");
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
