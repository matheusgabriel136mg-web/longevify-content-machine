// render-vitd-brasil.mjs — Single image "dado punch" estilo Bryan Johnson 5am
//
// Formato:
//   - 1 número GIGANTE central ("73%")
//   - Linha curta acima (kicker letterspaced)
//   - Linha curta abaixo (sub explicação)
//   - Footer monospace pequeno (fonte)
//   - Logo branca bottom-center
//   - Bg dark warm (mas variant: pode ser dark ou cream — testando dark)
//
// Output: runs/2026-05-26-001-vit-d-brasil-dado/assets/slide-1-cover.png

import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const W = 1080, H = 1350;
const OUT_W = 1440, OUT_H = 1800;
const SCALE = OUT_W / W;

// Dark warm palette (parecido com Julia internos)
const BG = "#1A1916";
const WHITE = "#F5EFE3";
const WHITE_SOFT = "#F5EFE3CC";
const WHITE_FAINT = "#F5EFE388";
const ACCENT = "#D4A053";  // amber warm low-sat pra o número

const RUN_DIR = path.join(ROOT, "runs", "2026-05-26-001-vit-d-brasil-dado", "assets");
const LOGO_PATH = path.join(ROOT, "assets", "logo-horizontal-white.png");

const sc = (n) => Math.round(n * SCALE);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function svgWrap(inner) {
  return `<svg width="${OUT_W}" height="${OUT_H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

async function compositeLogo(buf) {
  const trimmed = await sharp(LOGO_PATH).trim().toBuffer({ resolveWithObject: true });
  const cropH = Math.round(trimmed.info.height * 0.78);
  const wordmark = await sharp(trimmed.data).extract({ left: 0, top: 0, width: trimmed.info.width, height: cropH }).toBuffer();
  const logoW = Math.round(OUT_W * 0.25);
  const logoBuf = await sharp(wordmark).resize(logoW).toBuffer();
  const meta = await sharp(logoBuf).metadata();
  const x = Math.round((OUT_W - logoW) / 2);
  const y = Math.round(OUT_H - (meta.height ?? 60) - sc(50));
  return sharp(buf).composite([{ input: logoBuf, left: x, top: y }]).png().toBuffer();
}

let svg = `<rect width="${W}" height="${H}" fill="${BG}"/>`;

// Kicker pequeno topo
svg += `<text x="${W/2}" y="${330}" font-family="Inter, sans-serif" font-size="20" font-weight="500" fill="${WHITE_FAINT}" text-anchor="middle" letter-spacing="4">VITAMINA D · BRASIL</text>`;

// Número GIGANTE central
svg += `<text x="${W/2}" y="${600}" font-family="Inter, sans-serif" font-size="320" font-weight="200" fill="${ACCENT}" text-anchor="middle" letter-spacing="-12">73%</text>`;

// Frase principal abaixo
svg += `<text x="${W/2}" y="${740}" font-family="Inter, sans-serif" font-size="32" font-weight="400" fill="${WHITE}" text-anchor="middle" letter-spacing="-0.5">dos brasileiros têm vitamina D</text>`;
svg += `<text x="${W/2}" y="${782}" font-family="Georgia, serif" font-style="italic" font-size="32" font-weight="400" fill="${WHITE}" text-anchor="middle">abaixo da faixa funcional.</text>`;

// Body explicação 3 linhas
svg += `<text x="${W/2}" y="${890}" font-family="Inter, sans-serif" font-size="20" font-weight="400" fill="${WHITE_SOFT}" text-anchor="middle">Faixa populacional aceita 20 ng/mL. Faixa funcional pede 40–60.</text>`;
svg += `<text x="${W/2}" y="${920}" font-family="Inter, sans-serif" font-size="20" font-weight="400" fill="${WHITE_SOFT}" text-anchor="middle">Entre uma e outra mora a fadiga, o sono picado, a queda imune.</text>`;

// Fechamento italic editorial
svg += `<text x="${W/2}" y="${1010}" font-family="Georgia, serif" font-style="italic" font-size="22" font-weight="400" fill="${WHITE}" text-anchor="middle">No país do sol, vitamina D virou marcador silencioso.</text>`;

// Footer monospace fonte
svg += `<text x="${W/2}" y="${1110}" font-family="Courier New, monospace" font-size="13" font-weight="500" fill="${WHITE_FAINT}" text-anchor="middle" letter-spacing="2.5">FONTE  ·  ESTUDO BRAZOS  ·  2024 N=22.000</text>`;

const base = await sharp(Buffer.from(svgWrap(svg))).png().toBuffer();
const withLogo = await compositeLogo(base);
fs.writeFileSync(path.join(RUN_DIR, "slide-1-cover.png"), withLogo);
console.log("✓ slide-1-cover.png");
