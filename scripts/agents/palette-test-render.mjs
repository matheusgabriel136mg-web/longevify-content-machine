// scripts/agents/palette-test-render.mjs — Generates 8 sample slides, 1 per palette.
//
// Each slide shows: BG + headline + sub + body + closing + status badges.
// Visual check tool: founder approves the palette set before any real run uses it.
//
// Output: /tmp/palette-test/<palette>.png

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import { W, H, OUT_W, OUT_H, PALETTES, STATUS_LEVELS, esc, svgWrap, compositeLogo, svgWrappedCentered } from "../templates/_shared.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = "/tmp/palette-test";

fs.mkdirSync(OUT_DIR, { recursive: true });

// 8 canonical palettes only (skip legacy).
const PALETTE_IDS = ["P1-sage", "P2-amber", "P3-concrete", "P4-sunset", "P5-olive", "P6-cool", "P7-white", "P8-nightfall"];

async function renderSamplePalette(paletteId) {
  const P = PALETTES[paletteId];
  if (!P) throw new Error(`palette ${paletteId} missing`);

  // Background
  let svg = `<rect width="${W}" height="${H}" fill="${P.BG}"/>`;

  // Label tracked uppercase top (test multi-word spacing)
  svg += `<text x="${W/2}" y="120" font-family="Inter, sans-serif" font-size="14" font-weight="500" fill="${P.WHITE_FAINT}" letter-spacing="2.5" text-anchor="middle" xml:space="preserve">${esc("PAINEL · " + paletteId.toUpperCase())}</text>`;

  // Hero headline
  const h1 = svgWrappedCentered("Cada cor carrega a química do tópico.", {
    startY: 240, fontSize: 56, family: "Inter, 'Helvetica Neue', Arial, sans-serif",
    weight: "300", fill: P.WHITE, letterSpacing: "-0.5", maxChars: 22, lineHeight: 64,
  });
  svg += h1.svg;

  // Italic serif sub (test serif fallback)
  const h2 = svgWrappedCentered("não é decoração.", {
    startY: h1.endY + 70, fontSize: 56, family: "Georgia, 'Liberation Serif', serif",
    italic: true, fill: P.ACCENT || P.WHITE, maxChars: 22, lineHeight: 64,
  });
  svg += h2.svg;

  // Body paragraph (test word-space integrity)
  const body = svgWrappedCentered("Microbioma sage. Ômega amber. Prostata concrete. Vitamina D sunset. Cortisol olive. Ferritina cool. Manifesto nightfall.", {
    startY: h2.endY + 100, fontSize: 22, family: "Inter, 'Helvetica Neue', Arial, sans-serif",
    fill: P.WHITE_SOFT, maxChars: 50, lineHeight: 32,
  });
  svg += body.svg;

  // Status badge row (test status vocabulary visual §4)
  const badgeY = body.endY + 80;
  const levels = Object.keys(STATUS_LEVELS);
  const badgeW = 150, badgeGap = 18;
  const totalW = levels.length * badgeW + (levels.length - 1) * badgeGap;
  let bx = (W - totalW) / 2;
  for (const lv of levels) {
    const s = STATUS_LEVELS[lv];
    svg += `<rect x="${bx}" y="${badgeY}" width="${badgeW}" height="36" fill="${s.color}" rx="4"/>`;
    svg += `<text x="${bx + badgeW/2}" y="${badgeY + 24}" font-family="Inter, 'Helvetica Neue', Arial, sans-serif" font-size="13" font-weight="600" fill="#FAFAF7" letter-spacing="1.5" text-anchor="middle" xml:space="preserve">${esc(s.label)}</text>`;
    bx += badgeW + badgeGap;
  }

  // Closing italic
  const closing = svgWrappedCentered("Source: Cryan et al · Nature 2019 · n=2400", {
    startY: badgeY + 90, fontSize: 16, family: "Inter, 'Helvetica Neue', Arial, sans-serif",
    fill: P.WHITE_FAINT, letterSpacing: "2", maxChars: 60, lineHeight: 22,
  });
  svg += closing.svg;

  // Render
  const base = await sharp(Buffer.from(svgWrap(svg))).png().toBuffer();
  // Logo composite with palette-aware tint
  const isLightBg = paletteId === "P7-white";
  const withLogo = await compositeLogo(base, { paletteKey: isLightBg ? "cream_clay" : "dark_cedar" });
  const outPath = path.join(OUT_DIR, `${paletteId}.png`);
  fs.writeFileSync(outPath, withLogo);
  console.log(`  ✓ ${paletteId}.png (${(fs.statSync(outPath).size / 1024).toFixed(0)}KB)`);
}

console.log(`\n🎨 Palette test render · 8 canonical paletas\n`);
for (const id of PALETTE_IDS) {
  await renderSamplePalette(id);
}
console.log(`\n8 PNGs em ${OUT_DIR}/\n`);
