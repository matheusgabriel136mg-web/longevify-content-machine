// scripts/templates/brand-manifesto.mjs — Brand manifesto carrossel (5 slides) genérico
//
// Slides:
//   S1: Cover externa (Matheus GPT) — render só adiciona logo
//   S2: Painel/dimensões (5 grupos com tracks horizontais + dots sage)
//   S3: Diferença (2 colunas: convencional vs Longevify)
//   S4: Como funciona (4 passos numerados com icons)
//   S5: Manifesto closing (headline grande + body + italic Aesop)
//
// Data schema (data/<id>.json):
// {
//   "palette": "cream_clay",
//   "s2_headline_1": "Longevidade",
//   "s2_headline_2_italic": "é números.",
//   "s2_sub": "O painel completo lê em N dimensões.",
//   "s2_groups": [
//     { "label": "METABÓLICO", "markers": ["Glicose", "HbA1c", ...] },
//     ...
//   ],
//   "s2_legend": "CADA PONTO · UM MARCADOR LIDO",
//   "s3_headline_1": "Não somos",
//   "s3_headline_2_italic": "diagnóstico.",
//   "s3_sub": "Somos leitura, contexto, protocolo.",
//   "s3_col_left_header": "CONVENCIONAL",
//   "s3_col_right_header": "LONGEVIFY",
//   "s3_pairs": [{ "left": "...", "right": "..." }, ...],
//   "s3_closing_italic": "Onde a média termina, a leitura começa.",
//   "s4_headline_1": "Como começa",
//   "s4_headline_2_italic": "o seu protocolo.",
//   "s4_sub": "Quatro passos.",
//   "s4_steps": [{ "n": "01", "t": "Painel completo", "b": "...", "icon": "icon-painel.png" }, ...],
//   "s5_headline_1": "Sua biologia merece",
//   "s5_headline_2_italic": "leitura, não palpite.",
//   "s5_body": ["linha 1", "linha 2"],
//   "s5_closing_italic": "É por isso que existimos."
// }

import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";
import { W, H, ROOT, PALETTES, esc, svgWrap, compositeLogo, headlineXml, loadData, ensureRunDir } from "./_shared.mjs";

const ICONS_DIR = path.join(ROOT, "assets", "icons");

async function makeCircleIcon(srcPath, diameter) {
  const src = await sharp(srcPath).resize(diameter, diameter, { fit: "cover", position: "center" }).toBuffer();
  const mask = Buffer.from(`<svg width="${diameter}" height="${diameter}"><circle cx="${diameter/2}" cy="${diameter/2}" r="${diameter/2}" fill="white"/></svg>`);
  return sharp(src).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
}

const { runId, data } = loadData();
const paletteKey = data.palette || "cream_clay";
const P = PALETTES[paletteKey] || PALETTES.cream_clay;
const ACCENT_CLAY = paletteKey === "cream_clay" ? "#A8623A" : P.STATUS_WARM;
const ACCENT_SAGE = P.STATUS_GOOD;

const runDir = ensureRunDir(runId);

// ═══════════════════════════════════════════════════════════════════════════
// S2 — Painel / dimensões (tracks + dots)
// ═══════════════════════════════════════════════════════════════════════════
async function renderSlide2() {
  let svg = `<rect width="${W}" height="${H}" fill="${P.BG}"/>`;
  svg += headlineXml(data.s2_headline_1, data.s2_headline_2_italic, data.s2_sub, P);

  const groups = data.s2_groups || [];
  const startY = 410;
  const rowH = 120;
  const blockW = 880;
  const blockX = (W - blockW) / 2;
  const trackX = blockX + 220;
  const trackW = blockW - 220;

  groups.forEach((g, i) => {
    const y = startY + i * rowH;
    if (i > 0) svg += `<line x1="${blockX}" y1="${y - 14}" x2="${blockX + blockW}" y2="${y - 14}" stroke="${P.WHITE}" stroke-width="0.5" opacity="0.12"/>`;
    const centerY = y + 50;
    // Label kicker clay
    svg += `<text x="${blockX}" y="${centerY + 6}" font-family="Inter, sans-serif" font-size="16" font-weight="500" fill="${ACCENT_CLAY}" letter-spacing="3">${esc(g.label)}</text>`;
    // Track base
    svg += `<line x1="${trackX}" y1="${centerY}" x2="${trackX + trackW}" y2="${centerY}" stroke="${P.WHITE}" stroke-width="1.5" opacity="0.18"/>`;
    // Sage segment (faixa funcional)
    const segStart = trackX + trackW * 0.10;
    const segEnd = trackX + trackW * 0.90;
    svg += `<line x1="${segStart}" y1="${centerY}" x2="${segEnd}" y2="${centerY}" stroke="${ACCENT_SAGE}" stroke-width="5" opacity="0.55" stroke-linecap="round"/>`;
    // Dots + labels
    const markers = g.markers || [];
    const n = markers.length;
    const segW = segEnd - segStart;
    for (let j = 0; j < n; j++) {
      const dotX = segStart + (segW * (j + 0.5) / n);
      svg += `<circle cx="${dotX}" cy="${centerY}" r="9" fill="${ACCENT_SAGE}"/>`;
      svg += `<circle cx="${dotX}" cy="${centerY}" r="14" fill="none" stroke="${ACCENT_SAGE}" stroke-width="1.2" opacity="0.5"/>`;
      svg += `<text x="${dotX}" y="${centerY + 38}" font-family="Inter, sans-serif" font-size="15" font-weight="500" fill="${P.WHITE}" text-anchor="middle" letter-spacing="-0.2">${esc(markers[j])}</text>`;
    }
  });

  if (data.s2_legend) {
    svg += `<text x="${W/2}" y="${1080}" font-family="Inter, sans-serif" font-size="13" font-weight="500" fill="${P.WHITE_FAINT}" text-anchor="middle" letter-spacing="3">${esc(data.s2_legend)}</text>`;
  }

  const base = await sharp(Buffer.from(svgWrap(svg))).png().toBuffer();
  const withLogo = await compositeLogo(base, { paletteKey });
  fs.writeFileSync(path.join(runDir, "slide-2-painel.png"), withLogo);
  console.log("  ✓ slide-2-painel.png");
}

// ═══════════════════════════════════════════════════════════════════════════
// S3 — Diferença (2 colunas comparativas)
// ═══════════════════════════════════════════════════════════════════════════
async function renderSlide3() {
  let svg = `<rect width="${W}" height="${H}" fill="${P.BG}"/>`;
  svg += headlineXml(data.s3_headline_1, data.s3_headline_2_italic, data.s3_sub, P);

  const startY = 430;
  const rowH = 110;
  const colGap = 50;
  const colW = 420;
  const blockW = colW * 2 + colGap;
  const blockX = (W - blockW) / 2;
  const col1X = blockX;
  const col2X = blockX + colW + colGap;

  // Headers
  svg += `<text x="${col1X + colW/2}" y="${startY - 26}" font-family="Inter, sans-serif" font-size="13" font-weight="500" fill="${P.WHITE_FAINT}" text-anchor="middle" letter-spacing="3">${esc(data.s3_col_left_header || "CONVENCIONAL")}</text>`;
  svg += `<text x="${col2X + colW/2}" y="${startY - 26}" font-family="Inter, sans-serif" font-size="13" font-weight="500" fill="${ACCENT_CLAY}" text-anchor="middle" letter-spacing="3">${esc(data.s3_col_right_header || "LONGEVIFY")}</text>`;

  const pairs = data.s3_pairs || [];
  pairs.forEach((p, i) => {
    const y = startY + i * rowH;
    if (i > 0) svg += `<line x1="${blockX}" y1="${y - 14}" x2="${blockX + blockW}" y2="${y - 14}" stroke="${P.WHITE}" stroke-width="0.5" opacity="0.15"/>`;
    svg += `<text x="${col1X + colW/2}" y="${y + 55}" font-family="Inter, sans-serif" font-size="24" font-weight="400" fill="${P.WHITE_FAINT}" text-anchor="middle">${esc(p.left)}</text>`;
    svg += `<text x="${col2X + colW/2}" y="${y + 55}" font-family="Inter, sans-serif" font-size="24" font-weight="500" fill="${P.WHITE}" text-anchor="middle" letter-spacing="-0.3">${esc(p.right)}</text>`;
  });

  if (data.s3_closing_italic) {
    svg += `<text x="${W/2}" y="${1060}" font-family="Georgia, serif" font-style="italic" font-size="24" font-weight="400" fill="${P.WHITE}" text-anchor="middle">${esc(data.s3_closing_italic)}</text>`;
  }

  const base = await sharp(Buffer.from(svgWrap(svg))).png().toBuffer();
  const withLogo = await compositeLogo(base, { paletteKey });
  fs.writeFileSync(path.join(runDir, "slide-3-diferenca.png"), withLogo);
  console.log("  ✓ slide-3-diferenca.png");
}

// ═══════════════════════════════════════════════════════════════════════════
// S4 — Como começa (4 passos com icons circulares)
// ═══════════════════════════════════════════════════════════════════════════
async function renderSlide4() {
  let svg = `<rect width="${W}" height="${H}" fill="${P.BG}"/>`;
  svg += headlineXml(data.s4_headline_1, data.s4_headline_2_italic, data.s4_sub, P);

  const steps = data.s4_steps || [];
  const iconSize = 120;
  const iconGap = 32;
  const textBlockW = 580;
  const groupW = iconSize + iconGap + textBlockW;
  const groupX = (W - groupW) / 2;
  const textX = groupX + iconSize + iconGap;
  const cardStartY = 410;
  const cardH = 150;
  const cardGap = 18;

  steps.forEach((s, i) => {
    const y = cardStartY + i * (cardH + cardGap);
    if (i > 0) {
      const dy = y - cardGap/2;
      svg += `<line x1="${groupX}" y1="${dy}" x2="${groupX + groupW}" y2="${dy}" stroke="${P.WHITE}" stroke-width="0.5" opacity="0.15"/>`;
    }
    svg += `<text x="${textX}" y="${y + 38}" font-family="Inter, sans-serif" font-size="14" font-weight="500" fill="${ACCENT_CLAY}" letter-spacing="3">PASSO ${esc(s.n || (i+1).toString().padStart(2,"0"))}</text>`;
    svg += `<text x="${textX}" y="${y + 78}" font-family="Inter, sans-serif" font-size="28" font-weight="500" fill="${P.WHITE}" letter-spacing="-0.3">${esc(s.t)}</text>`;
    svg += `<text x="${textX}" y="${y + 115}" font-family="Inter, sans-serif" font-size="19" font-weight="400" fill="${P.WHITE_SOFT}">${esc(s.b)}</text>`;
  });

  const base = await sharp(Buffer.from(svgWrap(svg))).png().toBuffer();
  const composites = [];
  for (let i = 0; i < steps.length; i++) {
    const y = cardStartY + i * (cardH + cardGap);
    const iconPath = path.join(ICONS_DIR, steps[i].icon || "icon-painel.png");
    if (!fs.existsSync(iconPath)) continue;
    const SCALE = 1440 / 1080;
    const iconBuf = await makeCircleIcon(iconPath, Math.round(iconSize * SCALE));
    composites.push({ input: iconBuf, left: Math.round(groupX * SCALE), top: Math.round((y + (cardH - iconSize) / 2) * SCALE) });
  }
  const withIcons = await sharp(base).composite(composites).png().toBuffer();
  const withLogo = await compositeLogo(withIcons, { paletteKey });
  fs.writeFileSync(path.join(runDir, "slide-4-como-funciona.png"), withLogo);
  console.log("  ✓ slide-4-como-funciona.png");
}

// ═══════════════════════════════════════════════════════════════════════════
// S5 — Manifesto closing
// ═══════════════════════════════════════════════════════════════════════════
async function renderSlide5() {
  let svg = `<rect width="${W}" height="${H}" fill="${P.BG}"/>`;
  const headY = 380;
  svg += `<text x="${W/2}" y="${headY}" font-family="Inter, sans-serif" font-size="68" font-weight="300" fill="${P.WHITE}" text-anchor="middle" letter-spacing="-2">${esc(data.s5_headline_1)}</text>`;
  if (data.s5_headline_2_italic) {
    svg += `<text x="${W/2}" y="${headY + 80}" font-family="Georgia, serif" font-style="italic" font-size="68" font-weight="400" fill="${P.WHITE}" text-anchor="middle" letter-spacing="-1">${esc(data.s5_headline_2_italic)}</text>`;
  }

  const bodyLines = data.s5_body || [];
  const bodyY = headY + 200;
  bodyLines.forEach((ln, i) => {
    svg += `<text x="${W/2}" y="${bodyY + i * 34}" font-family="Inter, sans-serif" font-size="24" font-weight="400" fill="${P.WHITE}" text-anchor="middle">${esc(ln)}</text>`;
  });

  if (data.s5_closing_italic) {
    const closingY = bodyY + bodyLines.length * 34 + 80;
    svg += `<text x="${W/2}" y="${closingY}" font-family="Georgia, serif" font-style="italic" font-size="26" font-weight="400" fill="${ACCENT_CLAY}" text-anchor="middle">${esc(data.s5_closing_italic)}</text>`;
  }

  const base = await sharp(Buffer.from(svgWrap(svg))).png().toBuffer();
  const withLogo = await compositeLogo(base, { paletteKey });
  fs.writeFileSync(path.join(runDir, "slide-5-manifesto.png"), withLogo);
  console.log("  ✓ slide-5-manifesto.png");
}

console.log(`\n🎨 brand-manifesto · ${runId} · palette ${paletteKey}\n`);
await renderSlide2();
await renderSlide3();
await renderSlide4();
await renderSlide5();
console.log(`\n✓ S2-S5 prontos em ${path.relative(ROOT, runDir)}\n`);
