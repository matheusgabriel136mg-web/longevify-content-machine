/**
 * generate-story.ts — Story 9:16 Instagram "O Que Está Incluído" — Longevify
 *
 * Etapa 1: Copia 6 melhores mockups de UI para assets/mockups/cards/
 * Etapa 2: Gera background via NB2 (fal-ai/nano-banana-2) 9:16
 * Etapa 3: Composita tudo via sharp — label, headline, bullets, cards, logo
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

const LONGEVIFY_ROOT = path.resolve(__dirname, "..");
const ARTIFACTS     = path.join(LONGEVIFY_ROOT, "artifacts/longevify/dist/public/assets");
const CARDS_DIR     = path.join(__dirname, "assets/mockups/cards");
const OUT_DIR       = path.join(__dirname, "output/stories");
const LOGO_PATH     = path.join(ARTIFACTS, "logo_horizontal_white_1773668692240-D4MR8RRG.png");

// ── 6 melhores assets de UI encontrados no projeto ───────────────────────────
const SOURCE_MOCKUPS = [
  path.join(LONGEVIFY_ROOT, "phone_mockup.png"),
  path.join(LONGEVIFY_ROOT, "bento_section.png"),
  path.join(ARTIFACTS,      "image_1773668253532-oMW2ow_S.png"),  // phone 102 biomark
  path.join(ARTIFACTS,      "image_1773698239133-CxuFd-xe.png"),  // plano imunológico
  path.join(ARTIFACTS,      "image_1773698592467-C-Fwrzyz.png"),  // coleta sangue
  path.join(LONGEVIFY_ROOT, "hero_section.png"),
];

const FEATURES = [
  "100+ biomarcadores testados por ano",
  "Idade biológica",
  "Todos os seus dados em um lugar",
  "Plano de saúde personalizado",
  "Time médico 24h 7 dias",
  "Descontos em produtos de saúde",
];

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function download(url: string, dest: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Download falhou: ${r.status}`);
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}

// ── Etapa 1 ───────────────────────────────────────────────────────────────────
async function etapa1_copyMockups(): Promise<string[]> {
  console.log("\n📋 Etapa 1 — Copiando 6 mockups para assets/mockups/cards/");
  const out: string[] = [];
  for (let i = 0; i < SOURCE_MOCKUPS.length; i++) {
    const src  = SOURCE_MOCKUPS[i];
    const ext  = path.extname(src);
    const dest = path.join(CARDS_DIR, `card-${i + 1}${ext}`);
    fs.copyFileSync(src, dest);
    out.push(dest);
    console.log(`  ✅ card-${i + 1}${ext}`);
  }
  return out;
}

// ── Etapa 2 ───────────────────────────────────────────────────────────────────
async function etapa2_generateBackground(): Promise<string> {
  console.log("\n🖼  Etapa 2 — Background NB2 (9:16)...");
  const bgPath = path.join(OUT_DIR, "story-bg-raw.jpg");

  const r = await fal.subscribe("fal-ai/nano-banana-2", {
    input: {
      prompt:
        "Human shoulder and upper arm close-up, warm amber studio lighting from the right side, soft natural bokeh blur, dark background fading to near-black on left edge, terracotta and warm brown skin tones, cinematic portrait photography, 9:16 vertical",
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
  if (!url) throw new Error("NB2 não retornou imagem");
  await download(url, bgPath);
  console.log("  ✅ background gerado");
  return bgPath;
}

// ── Etapa 3 ───────────────────────────────────────────────────────────────────
async function etapa3_composite(bgPath: string, cardPaths: string[]): Promise<string> {
  console.log("\n🎨 Etapa 3 — Compositing...");

  const overlays: sharp.OverlayOptions[] = [];

  // Layout constants
  const PAD_L       = 60;
  const RIGHT_X     = 588;
  const CARD_W      = W - RIGHT_X - 24;   // ~468px
  const LABEL_Y     = 108;
  const HEAD_Y      = 156;                // top of headline block
  const FEAT_Y      = 390;               // first feature row baseline
  const FEAT_GAP    = 94;
  const LOGO_Y      = H - 100;

  // Card layout — 6 cards from FEAT_Y to LOGO_Y - 40
  const CARD_AREA_H = LOGO_Y - 40 - FEAT_Y;
  const CARD_GAP    = 20;
  const CARD_H      = Math.floor((CARD_AREA_H - CARD_GAP * 5) / 6);

  // ── Dark overlay for readability ──────────────────────────────────────────
  const darkSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="#060d0a" stop-opacity="0.68"/>
        <stop offset="50%"  stop-color="#060d0a" stop-opacity="0.52"/>
        <stop offset="100%" stop-color="#060d0a" stop-opacity="0.78"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
  </svg>`;
  overlays.push({ input: Buffer.from(darkSvg), blend: "over" });

  // ── Text SVG ─────────────────────────────────────────────────────────────
  const featRows = FEATURES.map((f, i) => {
    const cy = FEAT_Y + i * FEAT_GAP + 4;
    return `
    <circle cx="${PAD_L + 14}" cy="${cy}" r="7" fill="#006070"/>
    <text x="${PAD_L + 36}" y="${cy + 10}"
      font-family="DM Sans,Helvetica Neue,Helvetica,Arial,sans-serif"
      font-size="28" font-weight="400" fill="#ffffff" fill-opacity="0.93"
    >${esc(f)}</text>`;
  }).join("\n");

  const textSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <!-- Label -->
    <text x="${PAD_L}" y="${LABEL_Y}"
      font-family="DM Sans,Helvetica Neue,Helvetica,Arial,sans-serif"
      font-size="20" font-weight="300" letter-spacing="7"
      fill="#7ab5a0"
    >LONGEVIFY</text>

    <!-- Headline line 1 -->
    <text x="${PAD_L}" y="${HEAD_Y + 78}"
      font-family="DM Sans,Helvetica Neue,Helvetica,Arial,sans-serif"
      font-size="68" font-weight="700" fill="#ffffff"
    >O Que Está</text>

    <!-- Headline line 2 -->
    <text x="${PAD_L}" y="${HEAD_Y + 162}"
      font-family="DM Sans,Helvetica Neue,Helvetica,Arial,sans-serif"
      font-size="68" font-weight="700" fill="#ffffff"
    >Incluído</text>

    <!-- Divider -->
    <rect x="${PAD_L}" y="${FEAT_Y - 32}" width="120" height="2" fill="#7ab5a0" fill-opacity="0.50"/>

    ${featRows}
  </svg>`;
  overlays.push({ input: Buffer.from(textSvg), blend: "over" });

  // ── Mockup cards ─────────────────────────────────────────────────────────
  for (let i = 0; i < cardPaths.length; i++) {
    const top = FEAT_Y - 8 + i * (CARD_H + CARD_GAP);

    // Resize with cover crop
    const cardBuf = await sharp(cardPaths[i])
      .resize(CARD_W, CARD_H, { fit: "cover", position: "center" })
      .png()
      .toBuffer();

    // Rounded corners via dest-in mask
    const mask = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}">
        <rect width="${CARD_W}" height="${CARD_H}" rx="14" ry="14" fill="white"/>
      </svg>`
    );
    const rounded = await sharp(cardBuf)
      .composite([{ input: mask, blend: "dest-in" }])
      .png()
      .toBuffer();

    overlays.push({ input: rounded, top, left: RIGHT_X, blend: "over" });
  }

  // ── Logo ─────────────────────────────────────────────────────────────────
  const logoW   = 240;
  const logoBuf = await sharp(LOGO_PATH)
    .resize(logoW, null, { fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer();
  const { height: logoH = 56 } = await sharp(logoBuf).metadata();
  overlays.push({
    input: logoBuf,
    top:  LOGO_Y - Math.round(logoH / 2),
    left: PAD_L,
    blend: "over",
  });

  // ── Compose ───────────────────────────────────────────────────────────────
  const outPath = path.join(OUT_DIR, "story-o-que-esta-incluido.png");
  await sharp(bgPath)
    .resize(W, H, { fit: "cover", position: "center" })
    .composite(overlays)
    .png({ compressionLevel: 8 })
    .toFile(outPath);

  console.log(`  ✅ ${outPath}`);
  return outPath;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n🚀 Story Instagram 9:16 — Longevify");
  console.log("─".repeat(50));

  const cardPaths = await etapa1_copyMockups();
  const bgPath    = await etapa2_generateBackground();
  await etapa3_composite(bgPath, cardPaths);

  console.log("\n✅ Concluído!");
  console.log("📁 output/stories/story-o-que-esta-incluido.png");
}

main().catch(e => { console.error("\n❌", e.message); process.exit(1); });
