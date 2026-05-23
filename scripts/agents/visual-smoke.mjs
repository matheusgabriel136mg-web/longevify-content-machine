// scripts/agents/visual-smoke.mjs — Post-deploy visual regression check.
//
// For each renderable pattern, validates an existing reference run's slides:
//   1. PNG file exists
//   2. Dimensions correct (1440x1800 nominal, allow ±5% slack)
//   3. Size > 30KB (smaller = likely empty/broken)
//   4. Luminance std-dev > 8 (not solid color / not empty canvas)
//
// Run in CI / bootstrap post-deploy. Exits 1 if any reference slide fails.
//
// CLI: node scripts/agents/visual-smoke.mjs [--verbose]

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");

// One reference run per pattern. If the reference changes, update here.
// Each entry: required slide files + the pattern name (for reporting).
const REFERENCES = [
  {
    pattern: "persona-bio-case-study",
    runId: "2026-05-26-001-julia-persona",
    slides: ["slide-2-sintomas.png", "slide-3-painel.png", "slide-4-protocolo.png", "slide-5-resultado.png", "slide-6-manifesto.png"],
  },
  {
    pattern: "dado-punch-bryan-style",
    runId: "2026-05-26-001-vit-d-brasil-dado",
    slides: ["slide-1-cover.png"],
  },
  {
    pattern: "brand-manifesto",
    runId: "2026-05-23-241-function-concept-maria-p2",
    slides: ["slide-2-painel.png", "slide-3-diferenca.png", "slide-4-como-funciona.png", "slide-5-manifesto.png"],
  },
  // biomarker-gap reference: ferritin run if has slides; otherwise skip
  // (founder will add new reference once a clean biomarker-gap run lands)
];

const MIN_SIZE_BYTES = 30 * 1024;
const MIN_LUM_STD = 5;          // accommodates editorial minimal-design slides
const MIN_WIDTH = 1000;
const TARGET_ASPECT = 4 / 5;     // 0.8 — IG portrait
const ASPECT_SLACK = 0.05;

async function checkSlide(slidePath) {
  if (!fs.existsSync(slidePath)) return { ok: false, reason: "file missing" };
  const stat = fs.statSync(slidePath);
  if (stat.size < MIN_SIZE_BYTES) return { ok: false, reason: `tiny (${(stat.size/1024).toFixed(0)}KB < ${MIN_SIZE_BYTES/1024}KB)`, size: stat.size };

  const meta = await sharp(slidePath).metadata();
  const aspect = meta.width / meta.height;
  const aspectOk = Math.abs(aspect - TARGET_ASPECT) < ASPECT_SLACK;
  const widthOk = meta.width >= MIN_WIDTH;
  if (!aspectOk || !widthOk) return { ok: false, reason: `bad dims ${meta.width}×${meta.height} (aspect ${aspect.toFixed(3)}, want ~0.8 + width ≥${MIN_WIDTH})`, size: stat.size };

  // Sample pixels for content detection.
  const raw = await sharp(slidePath).resize(40, 50, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const lums = [];
  for (let i = 0; i < raw.length; i += 3) {
    lums.push(0.299 * raw[i] + 0.587 * raw[i + 1] + 0.114 * raw[i + 2]);
  }
  const mean = lums.reduce((a, b) => a + b, 0) / lums.length;
  const variance = lums.reduce((a, b) => a + (b - mean) ** 2, 0) / lums.length;
  const lumStd = Math.sqrt(variance);

  if (lumStd < MIN_LUM_STD) return { ok: false, reason: `solid/empty canvas (lum_std=${lumStd.toFixed(2)} < ${MIN_LUM_STD})`, size: stat.size, lum_std: +lumStd.toFixed(2) };

  return { ok: true, size: stat.size, dims: `${meta.width}×${meta.height}`, lum_std: +lumStd.toFixed(2) };
}

async function main() {
  const verbose = process.argv.includes("--verbose");
  console.log(`\n🎨 visual-smoke · checking ${REFERENCES.length} reference patterns\n`);
  let totalChecked = 0, totalPass = 0, totalFail = 0;
  const failures = [];

  for (const ref of REFERENCES) {
    console.log(`  ── ${ref.pattern} (${ref.runId})`);
    for (const slide of ref.slides) {
      const slidePath = path.join(ROOT, "runs", ref.runId, "assets", slide);
      const r = await checkSlide(slidePath);
      totalChecked++;
      if (r.ok) {
        totalPass++;
        if (verbose) console.log(`     ✓ ${slide} (${(r.size/1024).toFixed(0)}KB, ${r.dims}, lum_std=${r.lum_std})`);
        else console.log(`     ✓ ${slide}`);
      } else {
        totalFail++;
        failures.push({ pattern: ref.pattern, slide, ...r });
        console.log(`     ✗ ${slide} — ${r.reason}`);
      }
    }
  }

  console.log(`\n${totalPass}/${totalChecked} passed${totalFail ? ` · ${totalFail} failed` : ""}.\n`);
  if (totalFail > 0) {
    console.log("Failures:");
    for (const f of failures) console.log(`  ✗ ${f.pattern}/${f.slide}: ${f.reason}`);
  }
  process.exit(totalFail > 0 ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
