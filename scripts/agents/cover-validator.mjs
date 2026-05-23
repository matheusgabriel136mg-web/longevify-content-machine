// scripts/agents/cover-validator.mjs — Deterministic check for cover compliance.
//
// Brand rule (refined 2026-05-23):
//   Capa = imagem editorial com cena ou objeto fotográfico em contexto premium BR.
//   NÃO PODE: cor sólida + texto/número grande sozinho.
//
// This validator catches "cor sólida + texto" covers by analyzing pixel variance:
//   - Sample a grid of pixels (skip top/bottom 12% — text + logo zones)
//   - Compute std deviation of luminance
//   - Compute % of pixels within ±30 RGB of the modal color
//   - Verdict:
//       std < 18 AND solid_pct > 0.65  → "fail: solid color"
//       std < 28 AND solid_pct > 0.75  → "warn: low-content"
//       else                            → "pass: photographic content"
//
// CLI:
//   node scripts/agents/cover-validator.mjs --file path/to/cover.png
//   node scripts/agents/cover-validator.mjs --run <run-id>           (reads runs/<id>/assets/slide-1*.png)

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");

const SAMPLE_GRID = 40;          // 40×40 = 1600 sample points across image (excl. top/bottom 12%)
const SKIP_TOP_PCT = 0.12;
const SKIP_BOTTOM_PCT = 0.12;
const SOLID_TOLERANCE_RGB = 30;  // ±30 per channel from modal color

export async function validateCover(filePath) {
  if (!fs.existsSync(filePath)) {
    return { ok: false, error: "file not found" };
  }
  const img = sharp(filePath);
  const meta = await img.metadata();
  const { width, height } = meta;
  // Get raw RGB buffer (downscaled for speed).
  const sampleW = SAMPLE_GRID, sampleH = SAMPLE_GRID;
  const raw = await img
    .resize(sampleW, sampleH, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer();
  // Walk pixels skipping top + bottom zones
  const skipTop = Math.floor(sampleH * SKIP_TOP_PCT);
  const skipBottom = Math.floor(sampleH * SKIP_BOTTOM_PCT);
  const rs = [], gs = [], bs = [], lums = [];
  for (let y = skipTop; y < sampleH - skipBottom; y++) {
    for (let x = 0; x < sampleW; x++) {
      const idx = (y * sampleW + x) * 3;
      const r = raw[idx], g = raw[idx + 1], b = raw[idx + 2];
      rs.push(r); gs.push(g); bs.push(b);
      lums.push(0.299 * r + 0.587 * g + 0.114 * b);
    }
  }
  // Modal color: take medians as proxy.
  const median = arr => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const stdDev = arr => {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const v = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
    return Math.sqrt(v);
  };
  const modalR = median(rs), modalG = median(gs), modalB = median(bs);
  let solidCount = 0;
  for (let i = 0; i < rs.length; i++) {
    if (Math.abs(rs[i] - modalR) <= SOLID_TOLERANCE_RGB
     && Math.abs(gs[i] - modalG) <= SOLID_TOLERANCE_RGB
     && Math.abs(bs[i] - modalB) <= SOLID_TOLERANCE_RGB) {
      solidCount++;
    }
  }
  const solid_pct = solidCount / rs.length;
  const lum_std = stdDev(lums);

  let verdict, reason;
  if (lum_std < 18 && solid_pct > 0.65) {
    verdict = "fail";
    reason = `Solid color dominant (lum_std=${lum_std.toFixed(1)}, modal pct=${(solid_pct*100).toFixed(0)}%). Cover needs scene/object/person photographic content.`;
  } else if (lum_std < 28 && solid_pct > 0.75) {
    verdict = "warn";
    reason = `Low photographic content (lum_std=${lum_std.toFixed(1)}, modal pct=${(solid_pct*100).toFixed(0)}%). Marginal — verify visually.`;
  } else {
    verdict = "pass";
    reason = `Photographic content detected (lum_std=${lum_std.toFixed(1)}, modal pct=${(solid_pct*100).toFixed(0)}%).`;
  }
  return {
    ok: verdict !== "fail",
    verdict,
    reason,
    metrics: { width, height, lum_std: +lum_std.toFixed(2), solid_pct: +solid_pct.toFixed(3), modal_rgb: [modalR, modalG, modalB] },
  };
}

// Palette diversity check (bible §11): compares this cover's modal RGB against
// the last N covers. Returns { diverse, similar_to } so callers can FAIL on convergence.
// modalDistance: Euclidean RGB distance. <40 = "very similar"; <80 = "similar"; ≥80 = "diverse".
export function comparePalettes(currentRgb, recentRgbs, threshold = 60) {
  if (!recentRgbs?.length) return { diverse: true, distances: [] };
  const distances = recentRgbs.map(rgb => {
    if (!rgb || rgb.length !== 3) return Infinity;
    return Math.sqrt(
      (currentRgb[0] - rgb[0]) ** 2 +
      (currentRgb[1] - rgb[1]) ** 2 +
      (currentRgb[2] - rgb[2]) ** 2
    );
  });
  const minDist = Math.min(...distances);
  const similarIdx = distances.indexOf(minDist);
  return {
    diverse: minDist >= threshold,
    minDistance: +minDist.toFixed(1),
    similar_to_index: minDist < threshold ? similarIdx : null,
    distances: distances.map(d => +d.toFixed(1)),
  };
}

// Validates current cover AND checks diversity against last N published runs.
// Returns combined result. Pass `pipelineDbPath` + `lastN` for diversity check.
export async function validateCoverWithDiversity(filePath, opts = {}) {
  const { recentModalRgbs = [], threshold = 60 } = opts;
  const baseResult = await validateCover(filePath);
  if (!baseResult.ok) return baseResult;  // already failed on content
  const diversity = comparePalettes(baseResult.metrics.modal_rgb, recentModalRgbs, threshold);
  if (!diversity.diverse) {
    return {
      ...baseResult,
      ok: false,
      verdict: "fail_diversity",
      reason: `Palette too similar to recent post (RGB distance ${diversity.minDistance} < ${threshold}). Bible §11: feed nunca monótono.`,
      diversity,
    };
  }
  return { ...baseResult, diversity };
}

// CLI
async function main() {
  const a = process.argv.slice(2);
  let file = null, runId = null;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--file") file = a[++i];
    else if (a[i] === "--run") runId = a[++i];
  }
  if (!file && !runId) {
    console.error("Usage: cover-validator.mjs --file <path> | --run <run-id>");
    process.exit(1);
  }
  if (runId) {
    const assetsDir = path.join(ROOT, "runs", runId, "assets");
    if (!fs.existsSync(assetsDir)) { console.error(`assets dir missing: ${assetsDir}`); process.exit(1); }
    const candidates = fs.readdirSync(assetsDir).filter(f => /^slide-1.*\.(png|jpg|jpeg|webp)$/i.test(f));
    if (!candidates.length) { console.error("no slide-1*.png in assets"); process.exit(1); }
    file = path.join(assetsDir, candidates[0]);
  }
  const r = await validateCover(file);
  console.log(`\n🖼  Cover validator · ${path.basename(file)}\n`);
  const icon = r.verdict === "pass" ? "✓" : r.verdict === "warn" ? "⚠" : "✗";
  console.log(`  ${icon} ${r.verdict.toUpperCase()} — ${r.reason}`);
  console.log(`  Metrics: ${JSON.stringify(r.metrics)}\n`);
  process.exit(r.verdict === "fail" ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
