// scripts/agents/measure-text-bbox.mjs — Measure text bounding-box per slide.
//
// Strategy: text pixels create sharp horizontal luminance transitions vs the smooth
// bg (gradient/photo). Detect rows where edge-density spans the canvas width past
// the safe margin (5% each side). False-positives possible on photo edges, but
// flags clear overflow cases like founder caught.
//
// CLI:
//   node scripts/agents/measure-text-bbox.mjs <slide1.png> [<slide2.png> ...]
//   Exit 1 if any slide has text reaching past margins.

import * as fs from "fs";
import sharp from "sharp";

const SAFE_MARGIN_FRACTION = 0.05;
const MIN_STREAK_PX = 4;

function detectTextSpan(row, W) {
  let leftX = -1, rightX = -1;
  // Pre-compute edge map: pixel where |Δluminance| with neighbor > 30.
  const isEdge = new Uint8Array(W);
  for (let x = 1; x < W - 1; x++) {
    const i = x * 3, iL = (x - 1) * 3, iR = (x + 1) * 3;
    const lumC = row[i] * 0.299 + row[i + 1] * 0.587 + row[i + 2] * 0.114;
    const lumL = row[iL] * 0.299 + row[iL + 1] * 0.587 + row[iL + 2] * 0.114;
    const lumR = row[iR] * 0.299 + row[iR + 1] * 0.587 + row[iR + 2] * 0.114;
    if (Math.abs(lumC - lumL) > 30 || Math.abs(lumC - lumR) > 30) isEdge[x] = 1;
  }
  for (let x = 0; x < W; x++) {
    let count = 0;
    for (let k = -6; k <= 6; k++) {
      const xx = x + k;
      if (xx >= 0 && xx < W && isEdge[xx]) count++;
    }
    if (count >= MIN_STREAK_PX) {
      if (leftX < 0) leftX = x;
      rightX = x;
    }
  }
  return leftX < 0 ? null : { leftX, rightX };
}

async function measure(filePath) {
  const meta = await sharp(filePath).metadata();
  const W = meta.width, H = meta.height;
  const raw = await sharp(filePath).removeAlpha().raw().toBuffer();
  const safeMargin = Math.round(W * SAFE_MARGIN_FRACTION);

  const offenders = [];
  let textRows = 0;
  for (let y = 0; y < H; y += 6) {
    const row = raw.subarray(y * W * 3, (y + 1) * W * 3);
    const span = detectTextSpan(row, W);
    if (!span) continue;
    textRows++;
    if (span.leftX < safeMargin || span.rightX > W - safeMargin) {
      offenders.push({ y, leftX: span.leftX, rightX: span.rightX });
    }
  }
  return {
    file: filePath,
    canvas: `${W}×${H}`,
    safe_margin_px: safeMargin,
    rows_with_text: textRows,
    rows_overflowing: offenders.length,
    overflowing_sample: offenders.slice(0, 6),
    ok: offenders.length === 0,
  };
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: measure-text-bbox.mjs <file1.png> [<file2.png> ...]");
  process.exit(1);
}

let anyFail = false;
for (const f of files) {
  if (!fs.existsSync(f)) { console.error(`✗ ${f} missing`); anyFail = true; continue; }
  const r = await measure(f);
  console.log(JSON.stringify(r, null, 2));
  if (!r.ok) anyFail = true;
}
process.exit(anyFail ? 1 : 0);
