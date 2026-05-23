// scripts/templates/biomarker-gap.mjs — Biomarker gap carrossel (5 slides) genérico
//
// Pattern Ferritina: cover blur editorial + chart comparativo + sintomas + alavancas + bloqueadores
//
// Data schema (data/<id>.json):
// {
//   "palette": "warm_taupe",
//   "cover_filename": "cover-raw.png",  // (externo, deve estar em assets/)
//   "cover_headline_1": "Você pode ter ferritina baixa",
//   "cover_headline_2_italic": "com ferro perfeito.",
//   "cover_sub": "Investigue além do hemograma básico.",
//
//   "s2_headline_1": "Ferro ≠ Ferritina",
//   "s2_sub": "Dois marcadores diferentes da mesma rota.",
//   "s2_bar_left":  { "label": "FERRO",     "value": "120 µg/dL", "unit": "no sangue",    "height_pct": 0.85 },
//   "s2_bar_right": { "label": "FERRITINA", "value": "22 ng/mL",  "unit": "no estoque",   "height_pct": 0.18 },
//   "s2_body_1": "O ferro mostra o que circula agora.",
//   "s2_body_2": "A ferritina mostra o que você tem guardado.",
//   "s2_closing_italic": "Sem estoque, o circulante é só miragem.",
//
//   "s3_headline_1": "Ferritina baixa,",
//   "s3_headline_2_italic": "mais que cansaço.",
//   "s3_sub": "Sintomas que poucos médicos conectam.",
//   "s3_items": [{ "title": "Névoa mental", "body": "...", "icon": "icon-brain.png" }, ...],
//
//   "s4_headline_1": "Como elevar",
//   "s4_headline_2_italic": "sua ferritina.",
//   "s4_sub": "Quatro alavancas que mudam o estoque.",
//   "s4_items": [{ "n": "01", "t": "Ferro heme", "b": "...", "icon": "icon-redmeat.png" }, ...],
//
//   "s5_headline_1": "Bloqueadores",
//   "s5_headline_2_italic": "silenciosos.",
//   "s5_sub": "Hábitos que mantêm sua ferritina no chão.",
//   "s5_items": [{ "title": "Café e chá nas refeições", "body": "..." }, ...]
// }

import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";
import { W, H, ROOT, PALETTES, esc, svgWrap, compositeLogo, headlineXml, loadData, ensureRunDir } from "./_shared.mjs";

const ICONS_DIR = path.join(ROOT, "assets", "icons");
const SCALE = 1440 / 1080;

async function makeCircleIcon(srcPath, diameter) {
  const src = await sharp(srcPath).resize(diameter, diameter, { fit: "cover", position: "center" }).toBuffer();
  const mask = Buffer.from(`<svg width="${diameter}" height="${diameter}"><circle cx="${diameter/2}" cy="${diameter/2}" r="${diameter/2}" fill="white"/></svg>`);
  return sharp(src).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
}

const { runId, data } = loadData();
const paletteKey = data.palette || "warm_taupe";
const P = PALETTES[paletteKey] || PALETTES.warm_taupe;

const runDir = ensureRunDir(runId);

// S1 cover from external file
async function renderSlide1() {
  const coverPath = path.join(runDir, data.cover_filename || "cover-raw.png");
  if (!fs.existsSync(coverPath)) { console.warn(`  ⚠ cover ${coverPath} ausente, skip S1`); return; }
  const bg = await sharp(coverPath).resize(1440, 1800, { fit: "cover", position: "center" }).toBuffer();
  const dim = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="0.5" stop-color="#000" stop-opacity="0.05"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/></svg>`);
  const wrappedDim = `<svg width="1440" height="1800" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${dim.toString().match(/<svg[^>]*>([\s\S]*)<\/svg>/)[1]}</svg>`;
  const dimmed = await sharp(bg).composite([{ input: Buffer.from(wrappedDim), top: 0, left: 0 }]).png().toBuffer();
  let svg = "";
  const headY = 880;
  svg += `<text x="${W/2}" y="${headY}" font-family="Inter, Helvetica, sans-serif" font-size="76" font-weight="300" fill="${P.WHITE}" text-anchor="middle" letter-spacing="-2">${esc(data.cover_headline_1)}</text>`;
  if (data.cover_headline_2_italic) {
    svg += `<text x="${W/2}" y="${headY + 84}" font-family="Georgia, serif" font-style="italic" font-size="76" font-weight="400" fill="${P.WHITE}" text-anchor="middle">${esc(data.cover_headline_2_italic)}</text>`;
  }
  if (data.cover_sub) {
    svg += `<text x="${W/2}" y="${headY + 180}" font-family="Inter, Helvetica, sans-serif" font-size="28" font-weight="400" fill="${P.WHITE_SOFT}" text-anchor="middle">${esc(data.cover_sub)}</text>`;
  }
  const composed = await sharp(dimmed).composite([{ input: Buffer.from(svgWrap(svg)), top: 0, left: 0 }]).png().toBuffer();
  const withLogo = await compositeLogo(composed, { paletteKey: "dark_cedar", bottomMargin: 35 });
  fs.writeFileSync(path.join(runDir, "slide-1-cover.png"), withLogo);
  console.log("  ✓ slide-1-cover.png");
}

async function renderSlide2() {
  let svg = `<rect width="${W}" height="${H}" fill="${P.BG}"/>`;
  svg += headlineXml(data.s2_headline_1, null, data.s2_sub, P, { y: 130, fontSize: 68 });
  const chartY = 290, chartH = 380, barW = 140, barGap = 120;
  const totalChartW = barW * 2 + barGap;
  const chartX = (W - totalChartW) / 2;
  const left = data.s2_bar_left || {};
  const right = data.s2_bar_right || {};
  // Left bar
  const bar1H = chartH * (left.height_pct || 0.85);
  const bar1Y = chartY + chartH - bar1H;
  svg += `<rect x="${chartX}" y="${bar1Y}" width="${barW}" height="${bar1H}" fill="${P.WHITE}" opacity="0.95" rx="2"/>`;
  svg += `<text x="${chartX + barW/2}" y="${bar1Y - 20}" font-family="Inter, sans-serif" font-size="22" font-weight="500" fill="${P.WHITE}" text-anchor="middle">${esc(left.value)}</text>`;
  svg += `<text x="${chartX + barW/2}" y="${chartY + chartH + 40}" font-family="Inter, sans-serif" font-size="20" font-weight="500" fill="${P.WHITE}" text-anchor="middle" letter-spacing="2">${esc(left.label)}</text>`;
  svg += `<text x="${chartX + barW/2}" y="${chartY + chartH + 68}" font-family="Inter, sans-serif" font-size="16" font-weight="400" fill="${P.WHITE_SOFT}" text-anchor="middle">${esc(left.unit)}</text>`;
  // Right bar
  const bar2H = chartH * (right.height_pct || 0.18);
  const bar2Y = chartY + chartH - bar2H;
  const bar2X = chartX + barW + barGap;
  svg += `<rect x="${bar2X}" y="${bar2Y}" width="${barW}" height="${bar2H}" fill="${P.WHITE}" opacity="0.95" rx="2"/>`;
  svg += `<text x="${bar2X + barW/2}" y="${bar2Y - 20}" font-family="Inter, sans-serif" font-size="22" font-weight="500" fill="${P.WHITE}" text-anchor="middle">${esc(right.value)}</text>`;
  svg += `<text x="${bar2X + barW/2}" y="${chartY + chartH + 40}" font-family="Inter, sans-serif" font-size="20" font-weight="500" fill="${P.WHITE}" text-anchor="middle" letter-spacing="2">${esc(right.label)}</text>`;
  svg += `<text x="${bar2X + barW/2}" y="${chartY + chartH + 68}" font-family="Inter, sans-serif" font-size="16" font-weight="400" fill="${P.WHITE_SOFT}" text-anchor="middle">${esc(right.unit)}</text>`;
  const explY = chartY + chartH + 150;
  if (data.s2_body_1) svg += `<text x="${W/2}" y="${explY}" font-family="Inter, sans-serif" font-size="22" font-weight="400" fill="${P.WHITE}" text-anchor="middle">${esc(data.s2_body_1)}</text>`;
  if (data.s2_body_2) svg += `<text x="${W/2}" y="${explY + 32}" font-family="Inter, sans-serif" font-size="22" font-weight="400" fill="${P.WHITE}" text-anchor="middle">${esc(data.s2_body_2)}</text>`;
  if (data.s2_closing_italic) svg += `<text x="${W/2}" y="${explY + 90}" font-family="Georgia, serif" font-style="italic" font-size="24" font-weight="400" fill="${P.WHITE}" text-anchor="middle">${esc(data.s2_closing_italic)}</text>`;
  const base = await sharp(Buffer.from(svgWrap(svg))).png().toBuffer();
  const withLogo = await compositeLogo(base, { paletteKey });
  fs.writeFileSync(path.join(runDir, "slide-2-chart.png"), withLogo);
  console.log("  ✓ slide-2-chart.png");
}

async function renderCardListSlide({ outName, headLine1, headLine2Italic, sub, items, numbered = false }) {
  let svg = `<rect width="${W}" height="${H}" fill="${P.BG}"/>`;
  svg += headlineXml(headLine1, headLine2Italic, sub, P);
  const iconSize = 130, iconGap = 44, textBlockW = 460;
  const groupW = iconSize + iconGap + textBlockW;
  const groupX = (W - groupW) / 2;
  const textX = groupX + iconSize + iconGap;
  const cardStartY = 330, cardH = 170, cardGap = 22;
  const composites = [];
  items.forEach((it, i) => {
    const y = cardStartY + i * (cardH + cardGap);
    if (i > 0) svg += `<line x1="${groupX}" y1="${y - cardGap/2}" x2="${groupX + groupW}" y2="${y - cardGap/2}" stroke="${P.WHITE}" stroke-width="0.5" opacity="0.2"/>`;
    const title = numbered ? `${it.n || (i+1).toString().padStart(2,"0")}  ·  ${it.t || it.title}` : (it.title || it.t);
    svg += `<text x="${textX}" y="${y + 60}" font-family="Inter, sans-serif" font-size="30" font-weight="500" fill="${P.WHITE}" letter-spacing="-0.5">${esc(title)}</text>`;
    const bodyLines = (it.body || it.b || "").split("\n");
    bodyLines.forEach((ln, k) => {
      svg += `<text x="${textX}" y="${y + 102 + k * 30}" font-family="Inter, sans-serif" font-size="21" font-weight="400" fill="${P.WHITE_SOFT}">${esc(ln)}</text>`;
    });
  });
  const base = await sharp(Buffer.from(svgWrap(svg))).png().toBuffer();
  for (let i = 0; i < items.length; i++) {
    const y = cardStartY + i * (cardH + cardGap);
    const iconName = items[i].icon || "icon-painel.png";
    const iconPath = path.join(ICONS_DIR, iconName);
    if (!fs.existsSync(iconPath)) continue;
    const iconBuf = await makeCircleIcon(iconPath, Math.round(iconSize * SCALE));
    composites.push({ input: iconBuf, left: Math.round(groupX * SCALE), top: Math.round((y + (cardH - iconSize) / 2) * SCALE) });
  }
  const withIcons = await sharp(base).composite(composites).png().toBuffer();
  const withLogo = await compositeLogo(withIcons, { paletteKey });
  fs.writeFileSync(path.join(runDir, outName), withLogo);
  console.log(`  ✓ ${outName}`);
}

async function renderSlide5XMark() {
  let svg = `<rect width="${W}" height="${H}" fill="${P.BG}"/>`;
  svg += headlineXml(data.s5_headline_1, data.s5_headline_2_italic, data.s5_sub, P);
  const items = data.s5_items || [];
  const circleD = 130, xInnerSize = 64, iconGap = 44, textBlockW = 530;
  const groupW = circleD + iconGap + textBlockW;
  const groupX = (W - groupW) / 2;
  const circleX = groupX;
  const textX = groupX + circleD + iconGap;
  const startY = 330, itemH = 195, gap = 28;
  items.forEach((it, i) => {
    const y = startY + i * (itemH + gap);
    const cx = circleX + circleD/2;
    const cy = y + circleD/2;
    svg += `<circle cx="${cx}" cy="${cy}" r="${circleD/2}" fill="none" stroke="${P.WHITE}" stroke-width="1.5" opacity="0.85"/>`;
    const half = xInnerSize/2;
    svg += `<line x1="${cx - half}" y1="${cy - half}" x2="${cx + half}" y2="${cy + half}" stroke="${P.WHITE}" stroke-width="4" stroke-linecap="round"/>`;
    svg += `<line x1="${cx + half}" y1="${cy - half}" x2="${cx - half}" y2="${cy + half}" stroke="${P.WHITE}" stroke-width="4" stroke-linecap="round"/>`;
    const titleY = cy - 12;
    svg += `<text x="${textX}" y="${titleY}" font-family="Inter, sans-serif" font-size="32" font-weight="500" fill="${P.WHITE}" letter-spacing="-0.5">${esc(it.title)}</text>`;
    (it.body || "").split("\n").forEach((ln, k) => {
      svg += `<text x="${textX}" y="${titleY + 36 + k * 30}" font-family="Inter, sans-serif" font-size="22" font-weight="400" fill="${P.WHITE_SOFT}">${esc(ln)}</text>`;
    });
    if (i < items.length - 1) {
      const dy = y + itemH + gap/2;
      svg += `<line x1="${groupX}" y1="${dy}" x2="${groupX + groupW}" y2="${dy}" stroke="${P.WHITE}" stroke-width="0.5" opacity="0.2"/>`;
    }
  });
  const base = await sharp(Buffer.from(svgWrap(svg))).png().toBuffer();
  const withLogo = await compositeLogo(base, { paletteKey });
  fs.writeFileSync(path.join(runDir, "slide-5-bloqueadores.png"), withLogo);
  console.log("  ✓ slide-5-bloqueadores.png");
}

console.log(`\n🎨 biomarker-gap · ${runId} · palette ${paletteKey}\n`);
await renderSlide1();
await renderSlide2();
await renderCardListSlide({
  outName: "slide-3-sintomas.png",
  headLine1: data.s3_headline_1, headLine2Italic: data.s3_headline_2_italic, sub: data.s3_sub,
  items: data.s3_items || [], numbered: false,
});
await renderCardListSlide({
  outName: "slide-4-alavancas.png",
  headLine1: data.s4_headline_1, headLine2Italic: data.s4_headline_2_italic, sub: data.s4_sub,
  items: data.s4_items || [], numbered: true,
});
await renderSlide5XMark();
console.log(`\n✓ 5 slides prontos em ${path.relative(ROOT, runDir)}\n`);
