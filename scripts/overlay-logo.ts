/**
 * overlay-logo.ts — Overlay Longevify logo on bottom-right of carousel slides.
 *
 * Uso: node --import tsx/esm scripts/overlay-logo.ts <run-id> [slides...]
 *   Default: slides 2-6 (cover skipped per brief).
 */
import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const LOGO = path.join(ROOT, "assets/logos/longevify-horizontal-white.png");
const LOGO_WIDTH_RATIO = 0.18; // 18% of slide width
const PADDING_RATIO = 0.05;    // 5% padding from edges

async function overlayOne(srcPath: string, dstPath: string) {
  const src = sharp(srcPath);
  const meta = await src.metadata();
  const W = meta.width!;
  const H = meta.height!;

  const logoTargetW = Math.round(W * LOGO_WIDTH_RATIO);
  const logo = await sharp(LOGO).resize({ width: logoTargetW }).png().toBuffer();
  const logoMeta = await sharp(logo).metadata();
  const logoH = logoMeta.height!;

  const padX = Math.round(W * PADDING_RATIO);
  const padY = Math.round(H * PADDING_RATIO);
  const left = W - logoTargetW - padX;
  const top = H - logoH - padY;

  await src
    .composite([{ input: logo, left, top }])
    .png()
    .toFile(dstPath);

  return { logoTargetW, logoH, left, top, W, H };
}

async function main() {
  const runId = process.argv[2];
  if (!runId) {
    console.error("Usage: overlay-logo.ts <run-id> [slide-names...]");
    process.exit(1);
  }
  const assetsDir = path.join(ROOT, "runs", runId, "assets");
  if (!fs.existsSync(assetsDir)) {
    console.error(`assets dir not found: ${assetsDir}`);
    process.exit(1);
  }

  // Default: all slides except cover
  const explicit = process.argv.slice(3);
  const targets = explicit.length
    ? explicit
    : fs
        .readdirSync(assetsDir)
        .filter((f) => f.endsWith(".png") && !f.includes("cover") && !f.includes("-final"));

  console.log(`▶ Overlaying logo on ${targets.length} slide(s)...`);
  for (const fname of targets) {
    const src = path.join(assetsDir, fname);
    const dst = src.replace(/\.png$/, "-final.png");
    const info = await overlayOne(src, dst);
    console.log(`  ✓ ${fname} → ${path.basename(dst)} (logo ${info.logoTargetW}px @ ${info.left},${info.top})`);
  }

  console.log("\n✓ Done.");
}

main().catch((e) => {
  console.error("✗", e);
  process.exit(1);
});
