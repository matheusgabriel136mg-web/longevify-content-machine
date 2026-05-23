// scripts/templates/dado-punch.mjs — Single image "dado punch" template genérico
//
// Data schema (data/<id>.json):
// {
//   "kicker": "VITAMINA D · BRASIL",
//   "number": "73%",
//   "number_color": "amber" | "sage" | "warm",
//   "headline_1": "dos brasileiros têm vitamina D",
//   "headline_2_italic": "abaixo da faixa funcional.",
//   "body": [
//     "Faixa populacional aceita 20 ng/mL.",
//     "Faixa funcional pede 40–60."
//   ],
//   "closing_italic": "No país do sol, vitamina D virou marcador silencioso.",
//   "footer_source": "FONTE · ESTUDO BRAZOS · 2024 N=22.000",
//   "palette": "dark_cedar" | "warm_taupe" | "cream_clay"
// }
//
// Output: runs/<id>/assets/slide-1-cover.png (1440x1800)

import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";
import { W, H, ROOT, PALETTES, esc, svgWrap, compositeLogo, loadData, ensureRunDir } from "./_shared.mjs";

const { runId, data } = loadData();
const paletteKey = data.palette || "dark_cedar";
const P = PALETTES[paletteKey] || PALETTES.dark_cedar;
const accentColors = { amber: P.STATUS_WARM, sage: P.STATUS_GOOD, warm: P.STATUS_WARM };
const accent = accentColors[data.number_color || "amber"];

let svg = `<rect width="${W}" height="${H}" fill="${P.BG}"/>`;

// Kicker
if (data.kicker) {
  svg += `<text x="${W/2}" y="${330}" font-family="Inter, sans-serif" font-size="20" font-weight="500" fill="${P.WHITE_FAINT}" text-anchor="middle" letter-spacing="4">${esc(data.kicker)}</text>`;
}

// Número GIGANTE
svg += `<text x="${W/2}" y="${600}" font-family="Inter, sans-serif" font-size="320" font-weight="200" fill="${accent}" text-anchor="middle" letter-spacing="-12">${esc(data.number || "—")}</text>`;

// Headlines (Inter Light + Georgia Italic)
if (data.headline_1) {
  svg += `<text x="${W/2}" y="${740}" font-family="Inter, sans-serif" font-size="32" font-weight="400" fill="${P.WHITE}" text-anchor="middle" letter-spacing="-0.5">${esc(data.headline_1)}</text>`;
}
if (data.headline_2_italic) {
  svg += `<text x="${W/2}" y="${782}" font-family="Georgia, serif" font-style="italic" font-size="32" font-weight="400" fill="${P.WHITE}" text-anchor="middle">${esc(data.headline_2_italic)}</text>`;
}

// Body lines
const bodyLines = data.body || [];
bodyLines.forEach((ln, i) => {
  svg += `<text x="${W/2}" y="${890 + i * 30}" font-family="Inter, sans-serif" font-size="20" font-weight="400" fill="${P.WHITE_SOFT}" text-anchor="middle">${esc(ln)}</text>`;
});

// Closing italic
if (data.closing_italic) {
  const closingY = 890 + bodyLines.length * 30 + 50;
  svg += `<text x="${W/2}" y="${closingY}" font-family="Georgia, serif" font-style="italic" font-size="22" font-weight="400" fill="${P.WHITE}" text-anchor="middle">${esc(data.closing_italic)}</text>`;
}

// Footer monospace fonte
if (data.footer_source) {
  svg += `<text x="${W/2}" y="${1110}" font-family="Courier New, monospace" font-size="13" font-weight="500" fill="${P.WHITE_FAINT}" text-anchor="middle" letter-spacing="2.5">${esc(data.footer_source)}</text>`;
}

const runDir = ensureRunDir(runId);
const outPath = path.join(runDir, "slide-1-cover.png");
const base = await sharp(Buffer.from(svgWrap(svg))).png().toBuffer();
const withLogo = await compositeLogo(base, { paletteKey });
fs.writeFileSync(outPath, withLogo);
console.log(`✓ ${path.relative(ROOT, outPath)} (dado-punch, palette=${paletteKey})`);
