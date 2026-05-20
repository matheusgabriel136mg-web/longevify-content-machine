/**
 * generate-story-saude.ts
 * Story 9:16 "A Saúde Está Quebrada" — Longevify x Superpower style
 *
 * Etapa 1: NB2 → macro mushroom gills (bottom half)
 * Etapa 2: sharp → fundo preto puro top + texto + stats + logo
 */

import { fal } from "@fal-ai/client";
import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
fal.config({ credentials: process.env.FAL_KEY });

const W = 1080;
const H = 1920;
const OUT_DIR  = path.join(__dirname, "output/stories");
const LOGO_PATH = path.join(__dirname, "assets/logo-horizontal-white.png");

fs.mkdirSync(OUT_DIR, { recursive: true });

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function download(url: string, dest: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Download failed: ${r.status}`);
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}

// ── Etapa 1: NB2 mushroom ────────────────────────────────────────────────────
async function generateMushroom(): Promise<string> {
  console.log("\n🍄 Etapa 1 — Macro cogumelo via NB2...");
  const dest = path.join(OUT_DIR, "story-saude-mushroom-raw.jpg");

  const r = await fal.subscribe("fal-ai/nano-banana-2", {
    input: {
      prompt: "Extreme macro mushroom gills texture, dark dramatic lighting, pure black background, organic radial pattern, monochromatic deep shadows, cinematic close-up, bottom half composition, 9:16 vertical",
      aspect_ratio:    "9:16",
      num_images:      1,
      output_format:   "jpeg",
      safety_tolerance: "2",
      resolution:      "2K",
      thinking_level:  "minimal",
    },
    logs: false,
  }) as { data: { images: Array<{ url: string }> } };

  const url = r.data.images[0]?.url;
  if (!url) throw new Error("NB2 sem resultado");
  await download(url, dest);
  console.log("  ✅ mushroom gerado");
  return dest;
}

// ── Etapa 2: composite ────────────────────────────────────────────────────────
async function composite(mushroomPath: string): Promise<string> {
  console.log("\n🎨 Etapa 2 — Compositing...");

  // Split: top 55% black, bottom 45% mushroom
  const SPLIT   = Math.round(H * 0.52);   // y onde começa a foto
  const FADE    = 220;                     // altura do fade preto→foto

  // Resize mushroom to full width, crop to bottom portion
  const mushroomFull = await sharp(mushroomPath)
    .resize(W, H, { fit: "cover", position: "top" })
    .toBuffer();

  // Base canvas: pure black
  const base = await sharp({
    create: { width: W, height: H, channels: 3, background: { r: 0, g: 0, b: 0 } }
  }).png().toBuffer();

  const overlays: sharp.OverlayOptions[] = [];

  // Mushroom image (bottom portion)
  overlays.push({
    input: mushroomFull,
    top: 0,
    left: 0,
    blend: "over",
  });

  // Black mask: covers top SPLIT px + gradient fade into mushroom
  const maskSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="#000000" stop-opacity="1"/>
        <stop offset="${Math.round(SPLIT / H * 100)}%" stop-color="#000000" stop-opacity="1"/>
        <stop offset="${Math.round((SPLIT + FADE) / H * 100)}%" stop-color="#000000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#fade)"/>
  </svg>`;
  overlays.push({ input: Buffer.from(maskSvg), blend: "over" });

  // ── Text overlay ────────────────────────────────────────────────────────────
  const PAD = 64;

  const STATS = [
    "A expectativa de vida do brasileiro parou de crescer pela primeira vez em décadas.",
    "1 em cada 4 brasileiros tem hipertensão sem saber.",
    "7 em cada 10 adultos têm ao menos uma condição crônica.",
    "73% dos brasileiros nunca fizeram um painel completo de biomarcadores.",
    "O diagnóstico médio demora 4 anos após os primeiros sintomas.",
  ];

  // Font sizes (relative to 1080px canvas)
  const LABEL_SIZE    = 21;
  const HEAD_SIZE     = 82;
  const STAT_SIZE     = 28;
  const BRACKET_SIZE  = 28;

  const LABEL_Y  = 118;
  const HEAD_Y   = 200;   // baseline of first headline word
  const STATS_Y  = 560;   // first stat top
  const STAT_GAP = 96;

  const statRows = STATS.map((text, i) => {
    const y = STATS_Y + i * STAT_GAP;
    // Wrap text at ~42 chars
    const words = text.split(" ");
    let lines: string[] = [];
    let line = "";
    for (const w of words) {
      if ((line + " " + w).length > 44 && line) { lines.push(line.trim()); line = w; }
      else line += " " + w;
    }
    if (line.trim()) lines.push(line.trim());

    const bracketX = PAD;
    const textX    = PAD + 60;

    // Bracket
    let svgLines = `<text x="${bracketX}" y="${y + BRACKET_SIZE}"
      font-family="DM Sans,Helvetica Neue,Helvetica,Arial,sans-serif"
      font-size="${BRACKET_SIZE}" font-weight="300" fill="#ffffff" fill-opacity="0.40"
    >[${i + 1}]</text>`;

    // Text lines
    lines.forEach((l, li) => {
      const lineY = y + STAT_SIZE + li * (STAT_SIZE + 6);
      svgLines += `<text x="${textX}" y="${lineY}"
        font-family="DM Sans,Helvetica Neue,Helvetica,Arial,sans-serif"
        font-size="${STAT_SIZE}" font-weight="400" fill="#ffffff" fill-opacity="0.90"
      >${esc(l)}</text>`;
    });

    return svgLines;
  }).join("\n");

  const textSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">

    <!-- Label -->
    <text x="${PAD}" y="${LABEL_Y}"
      font-family="DM Sans,Helvetica Neue,Helvetica,Arial,sans-serif"
      font-size="${LABEL_SIZE}" font-weight="300" letter-spacing="8"
      fill="#7ab5a0"
    >A SAÚDE ESTÁ QUEBRADA</text>

    <!-- Headline — 3 lines -->
    <text x="${PAD}" y="${HEAD_Y + HEAD_SIZE * 1.0}"
      font-family="DM Sans,Helvetica Neue,Helvetica,Arial,sans-serif"
      font-size="${HEAD_SIZE}" font-weight="700" fill="#ffffff"
    >Estamos mais</text>
    <text x="${PAD}" y="${HEAD_Y + HEAD_SIZE * 2.1}"
      font-family="DM Sans,Helvetica Neue,Helvetica,Arial,sans-serif"
      font-size="${HEAD_SIZE}" font-weight="700" fill="#ffffff"
    >doentes do</text>
    <text x="${PAD}" y="${HEAD_Y + HEAD_SIZE * 3.2}"
      font-family="DM Sans,Helvetica Neue,Helvetica,Arial,sans-serif"
      font-size="${HEAD_SIZE}" font-weight="700" fill="#ffffff"
    >que nunca.</text>

    <!-- Divider -->
    <rect x="${PAD}" y="${STATS_Y - 28}" width="80" height="1.5"
      fill="#7ab5a0" fill-opacity="0.60"/>

    <!-- Stats -->
    ${statRows}

  </svg>`;

  // overlays.push({ input: Buffer.from(textSvg), blend: "over" }); // texto removido

  // ── Logo ─────────────────────────────────────────────────────────────────
  if (fs.existsSync(LOGO_PATH)) {
    const logoW   = Math.round(220 * 1.3); // +30%
    const logoBuf = await sharp(LOGO_PATH)
      .resize(logoW, null, { fit: "inside" })
      .png()
      .toBuffer();
    const { height: logoH = 50 } = await sharp(logoBuf).metadata();
    overlays.push({
      input: logoBuf,
      top:   H - 90 - Math.round(logoH / 2),
      left:  Math.round((W - logoW) / 2),
      blend: "over",
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const outPath = path.join(OUT_DIR, "story-saude-quebrada.png");
  await sharp(base)
    .composite(overlays)
    .png({ compressionLevel: 8 })
    .toFile(outPath);

  console.log(`  ✅ ${outPath}`);
  return outPath;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n🚀 Story — A Saúde Está Quebrada");
  console.log("─".repeat(50));
  const mushroomPath = await generateMushroom();
  await composite(mushroomPath);
  console.log("\n✅ output/stories/story-saude-quebrada.png");
}

main().catch(e => { console.error("\n❌", e.message); process.exit(1); });
