// add-logo-to-cover.mjs — Adiciona logo Longevify branca 25% bottom-center
// em qualquer PNG. Funciona pra capas geradas externamente (GPT, Higgsfield, etc).
//
// Uso:
//   node scripts/add-logo-to-cover.mjs --in <input.png> [--out <output.png>] [--bottom 50] [--width 0.25] [--dark]
//   node scripts/add-logo-to-cover.mjs --in runs/X/assets/cover-raw.png
//     → escreve runs/X/assets/slide-1-cover.png

import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

function parseArgs() {
  const a = process.argv.slice(2);
  const out = { bottomPct: 0.04, widthPct: 0.25, dark: false };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--in") out.input = a[++i];
    else if (a[i] === "--out") out.output = a[++i];
    else if (a[i] === "--bottom") out.bottomPct = parseFloat(a[++i]);
    else if (a[i] === "--width") out.widthPct = parseFloat(a[++i]);
    else if (a[i] === "--dark") out.dark = true;
  }
  if (!out.input) {
    console.error("Usage: node add-logo-to-cover.mjs --in <png> [--out <png>] [--bottom 0.04] [--width 0.25] [--dark]");
    process.exit(1);
  }
  if (!out.output) {
    // Default output: same dir, slide-1-cover.png
    const dir = path.dirname(out.input);
    out.output = path.join(dir, "slide-1-cover.png");
  }
  return out;
}

const args = parseArgs();
const LOGO_WHITE = path.join(ROOT, "assets", "logo-horizontal-white.png");

const inputBuf = fs.readFileSync(args.input);
const meta = await sharp(inputBuf).metadata();
const W = meta.width, H = meta.height;

// Logo: trim + 78% top crop + resize pra widthPct%
const trimmed = await sharp(LOGO_WHITE).trim().toBuffer({ resolveWithObject: true });
const cropH = Math.round(trimmed.info.height * 0.78);
let wordmark = await sharp(trimmed.data)
  .extract({ left: 0, top: 0, width: trimmed.info.width, height: cropH })
  .toBuffer();

// Se --dark, inverte logo
if (args.dark) {
  wordmark = await sharp(wordmark).negate({ alpha: false }).toBuffer();
}

const logoW = Math.round(W * args.widthPct);
const logoBuf = await sharp(wordmark).resize(logoW).toBuffer();
const logoMeta = await sharp(logoBuf).metadata();

const logoX = Math.round((W - logoW) / 2);
const logoY = Math.round(H - logoMeta.height - H * args.bottomPct);

await sharp(inputBuf)
  .composite([{ input: logoBuf, left: logoX, top: logoY }])
  .png()
  .toFile(args.output);

console.log(`✓ ${path.relative(ROOT, args.output)}  ·  ${W}x${H}  ·  logo ${logoW}px (${(args.widthPct*100).toFixed(0)}%) ${args.dark ? "DARK" : "WHITE"} bottom ${(args.bottomPct*100).toFixed(1)}%`);
