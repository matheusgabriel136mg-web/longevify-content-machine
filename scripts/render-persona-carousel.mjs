// render-persona-carousel.mjs — Persona deep-dive (template fixo, lê personas/<id>.json)
//
// Toda sexta-feira: nova persona, mesma estrutura narrativa:
//   S1 — Cover (matheus-generated, salvo em runs/<run-id>/assets/cover-raw.png)
//   S2 — Sintomas que não fechavam (lista 4 sintomas da persona)
//   S3 — Painel inicial · biomarkers mini-charts (before only)
//   S4 — Protocolo construído (6 alavancas com icons circulares)
//   S5 — Resultado 6 sem (before/after mini-charts + headliner stat)
//   S6 — Manifesto / CTA editorial
//
// Uso:
//   node scripts/render-persona-carousel.mjs --persona julia --run <run-id>
//   (persona file: personas/julia.json · run dir: runs/<run-id>/assets/)

import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

function parseArgs() {
  const a = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--persona") out.persona = a[++i];
    else if (a[i] === "--run") out.runId = a[++i];
  }
  if (!out.persona) { console.error("Usage: render-persona-carousel.mjs --persona <id> --run <run-id>"); process.exit(1); }
  if (!out.runId) out.runId = `2026-XX-XX-${out.persona}-persona`;
  return out;
}

const args = parseArgs();
const PERSONA_PATH = path.join(ROOT, "personas", `${args.persona}.json`);
if (!fs.existsSync(PERSONA_PATH)) { console.error(`persona não existe: ${PERSONA_PATH}`); process.exit(1); }
const P = JSON.parse(fs.readFileSync(PERSONA_PATH, "utf-8"));

const W = 1080, H = 1350;
const OUT_W = 1440, OUT_H = 1800;
const SCALE = OUT_W / W;

// Palette: padrão dark cedar (espelha Julia sauna). Pode ser overridden via persona.palette_internal
const PALETTES = {
  dark_cedar: {
    BG: "#1A1916", WHITE: "#F5EFE3", WHITE_SOFT: "#F5EFE3CC", WHITE_FAINT: "#F5EFE388",
    STATUS_WARM: "#D4A053", STATUS_GOOD: "#8FB39A",
  },
  cream_clay: {
    BG: "#F1EBDD", WHITE: "#2A2722", WHITE_SOFT: "#2A2722CC", WHITE_FAINT: "#2A272288",
    STATUS_WARM: "#A8623A", STATUS_GOOD: "#7A8B6E",
  },
};
const P_KEY = P.palette_internal || "dark_cedar";
const C = PALETTES[P_KEY] || PALETTES.dark_cedar;
const { BG, WHITE, WHITE_SOFT, WHITE_FAINT, STATUS_WARM, STATUS_GOOD } = C;

const RUN_DIR = path.join(ROOT, "runs", args.runId, "assets");
fs.mkdirSync(RUN_DIR, { recursive: true });
const LOGO_PATH = path.join(ROOT, "assets", "logo-horizontal-white.png");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const sc = (n) => Math.round(n * SCALE);

function svgWrap(inner) {
  return `<svg width="${OUT_W}" height="${OUT_H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

async function makeCircleIcon(srcPath, diameter) {
  const src = await sharp(srcPath).resize(diameter, diameter, { fit: "cover", position: "center" }).toBuffer();
  const mask = Buffer.from(
    `<svg width="${diameter}" height="${diameter}"><circle cx="${diameter/2}" cy="${diameter/2}" r="${diameter/2}" fill="white"/></svg>`
  );
  return sharp(src).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
}

async function compositeLogo(buf, { bottomMargin = 50 } = {}) {
  const trimmed = await sharp(LOGO_PATH).trim().toBuffer({ resolveWithObject: true });
  const cropH = Math.round(trimmed.info.height * 0.78);
  let wordmark = await sharp(trimmed.data)
    .extract({ left: 0, top: 0, width: trimmed.info.width, height: cropH })
    .toBuffer();
  // Em paleta cream usa logo dark; em dark usa branca
  if (P_KEY === "cream_clay") {
    wordmark = await sharp(wordmark).negate({ alpha: false }).toBuffer();
  }
  const logoW = Math.round(OUT_W * 0.25);
  const logoBuf = await sharp(wordmark).resize(logoW).toBuffer();
  const meta = await sharp(logoBuf).metadata();
  const x = Math.round((OUT_W - logoW) / 2);
  const y = Math.round(OUT_H - (meta.height ?? 60) - sc(bottomMargin));
  return sharp(buf).composite([{ input: logoBuf, left: x, top: y }]).png().toBuffer();
}

// Wrap text por largura — quebra em N lines mantendo word boundaries
function wrapText(text, maxCharsPerLine) {
  if (!text) return [];
  const words = text.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length <= maxCharsPerLine) {
      cur = (cur + " " + w).trim();
    } else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Auto-shrink fontSize se headline > N chars
function autoShrinkFont(text, baseSize, maxCharsAtBaseSize = 16) {
  if (!text) return baseSize;
  if (text.length <= maxCharsAtBaseSize) return baseSize;
  // Linear shrink: longer text → smaller font
  const ratio = maxCharsAtBaseSize / text.length;
  return Math.max(36, Math.round(baseSize * Math.max(0.65, ratio)));
}

function headlineXml(line1, line2Italic, sub, opts = {}) {
  const { y = 110, fontSize: baseFontSize = 62 } = opts;
  // Auto-shrink baseado na linha mais comprida
  const longest = Math.max((line1 || "").length, (line2Italic || "").length);
  const fontSize = autoShrinkFont(longest, baseFontSize, 18);

  let svg = `<text x="${W/2}" y="${y}" font-family="Inter, sans-serif" font-size="${fontSize}" font-weight="300" fill="${WHITE}" text-anchor="middle" letter-spacing="-2">${esc(line1)}</text>`;
  if (line2Italic) {
    svg += `<text x="${W/2}" y="${y + fontSize * 1.1}" font-family="Georgia, serif" font-style="italic" font-size="${fontSize}" font-weight="400" fill="${WHITE}" text-anchor="middle" letter-spacing="-1">${esc(line2Italic)}</text>`;
  }
  if (sub) {
    // Wrap sub se > 60 chars (cabe ~60 chars em 22pt no canvas 1080)
    const subLines = wrapText(sub, 60);
    const subStartY = y + (line2Italic ? 2 * fontSize * 1.1 : fontSize * 1.1) + 14;
    subLines.forEach((ln, i) => {
      svg += `<text x="${W/2}" y="${subStartY + i * 28}" font-family="Inter, sans-serif" font-size="22" font-weight="400" fill="${WHITE_SOFT}" text-anchor="middle">${esc(ln)}</text>`;
    });
  }
  return svg;
}

// ═══════════════════════════════════════════════════════════════════════════
// S2 — Sintomas
// ═══════════════════════════════════════════════════════════════════════════
async function renderSlide2() {
  let svg = `<rect width="${W}" height="${H}" fill="${BG}"/>`;
  svg += headlineXml(P.copy.s2_headline_1, P.copy.s2_headline_2_italic, P.copy.s2_sub);

  const startY = 460;
  const itemH = 130;
  const blockW = 740;
  const blockX = (W - blockW) / 2;

  P.sintomas.forEach((it, i) => {
    const y = startY + i * itemH;
    if (i > 0) svg += `<line x1="${blockX}" y1="${y - 10}" x2="${blockX + blockW}" y2="${y - 10}" stroke="${WHITE}" stroke-width="0.5" opacity="0.18"/>`;
    svg += `<text x="${blockX}" y="${y + 38}" font-family="Courier New, monospace" font-size="22" font-weight="500" fill="${WHITE_SOFT}" letter-spacing="2">${it.n}</text>`;
    svg += `<text x="${blockX + 80}" y="${y + 38}" font-family="Inter, sans-serif" font-size="26" font-weight="400" fill="${WHITE}">${esc(it.text)}</text>`;
  });

  if (P.copy.s2_closing_italic) {
    svg += `<text x="${W/2}" y="${1050}" font-family="Georgia, serif" font-style="italic" font-size="24" font-weight="400" fill="${WHITE}" text-anchor="middle">${esc(P.copy.s2_closing_italic)}</text>`;
  }

  const base = await sharp(Buffer.from(svgWrap(svg))).png().toBuffer();
  const withLogo = await compositeLogo(base);
  fs.writeFileSync(path.join(RUN_DIR, "slide-2-sintomas.png"), withLogo);
  console.log("✓ slide-2-sintomas.png");
}

// ═══════════════════════════════════════════════════════════════════════════
// S3 — Painel inicial (mini-charts before-only)
// ═══════════════════════════════════════════════════════════════════════════
async function renderSlide3() {
  let svg = `<rect width="${W}" height="${H}" fill="${BG}"/>`;
  svg += headlineXml(P.copy.s3_headline_1, P.copy.s3_headline_2_italic, P.copy.s3_sub);

  const startY = 440;
  const rowH = 110;
  const blockW = 860;
  const blockX = (W - blockW) / 2;
  const nameW = 180;
  const trackX = blockX + nameW + 20;
  const trackW = 460;
  const statusX = trackX + trackW + 50;

  P.biomarkers_before.forEach((m, i) => {
    const y = startY + i * rowH;
    if (i > 0) svg += `<line x1="${blockX}" y1="${y - 14}" x2="${blockX + blockW}" y2="${y - 14}" stroke="${WHITE}" stroke-width="0.5" opacity="0.15"/>`;
    const cY = y + 42;
    svg += `<text x="${blockX}" y="${cY + 6}" font-family="Inter, sans-serif" font-size="24" font-weight="500" fill="${WHITE}" letter-spacing="-0.3">${esc(m.name)}</text>`;
    svg += `<line x1="${trackX}" y1="${cY}" x2="${trackX + trackW}" y2="${cY}" stroke="${WHITE}" stroke-width="2" opacity="0.22"/>`;
    const optX1 = trackX + trackW * m.optStart;
    const optX2 = trackX + trackW * m.optEnd;
    svg += `<line x1="${optX1}" y1="${cY}" x2="${optX2}" y2="${cY}" stroke="${STATUS_GOOD}" stroke-width="4" opacity="0.7"/>`;
    const dotX = trackX + trackW * m.pct;
    svg += `<circle cx="${dotX}" cy="${cY}" r="7" fill="${STATUS_WARM}"/>`;
    svg += `<circle cx="${dotX}" cy="${cY}" r="11" fill="none" stroke="${STATUS_WARM}" stroke-width="1" opacity="0.4"/>`;
    svg += `<text x="${dotX}" y="${cY - 18}" font-family="Inter, sans-serif" font-size="18" font-weight="500" fill="${WHITE}" text-anchor="middle">${m.value} ${m.unit}</text>`;
    svg += `<text x="${statusX}" y="${cY + 6}" font-family="Inter, sans-serif" font-size="16" font-weight="500" fill="${STATUS_WARM}" text-anchor="middle" letter-spacing="2">${m.status}</text>`;
  });

  svg += `<text x="${W/2}" y="${1060}" font-family="Inter, sans-serif" font-size="14" font-weight="400" fill="${WHITE_FAINT}" text-anchor="middle" letter-spacing="2">FAIXA FUNCIONAL  ·  VALOR ATUAL</text>`;

  const base = await sharp(Buffer.from(svgWrap(svg))).png().toBuffer();
  const withLogo = await compositeLogo(base);
  fs.writeFileSync(path.join(RUN_DIR, "slide-3-painel.png"), withLogo);
  console.log("✓ slide-3-painel.png");
}

// ═══════════════════════════════════════════════════════════════════════════
// S4 — Protocolo (6 alavancas com icons circulares)
// ═══════════════════════════════════════════════════════════════════════════
async function renderSlide4() {
  let svg = `<rect width="${W}" height="${H}" fill="${BG}"/>`;
  svg += headlineXml(P.copy.s4_headline_1, P.copy.s4_headline_2_italic, P.copy.s4_sub);

  const iconSize = 105;
  const iconGap = 28;
  const textBlockW = 560;
  const groupW = iconSize + iconGap + textBlockW;
  const groupX = (W - groupW) / 2;
  const textX = groupX + iconSize + iconGap;
  const cardStartY = 320;
  const cardH = 130;
  const cardGap = 12;

  P.protocolo.forEach((it, i) => {
    const y = cardStartY + i * (cardH + cardGap);
    if (i > 0) svg += `<line x1="${groupX}" y1="${y - cardGap/2}" x2="${groupX + groupW}" y2="${y - cardGap/2}" stroke="${WHITE}" stroke-width="0.5" opacity="0.15"/>`;
    svg += `<text x="${textX}" y="${y + 52}" font-family="Inter, sans-serif" font-size="24" font-weight="500" fill="${WHITE}" letter-spacing="-0.3">${it.n}  ·  ${esc(it.t)}</text>`;
    svg += `<text x="${textX}" y="${y + 88}" font-family="Inter, sans-serif" font-size="19" font-weight="400" fill="${WHITE_SOFT}">${esc(it.b)}</text>`;
  });

  const base = await sharp(Buffer.from(svgWrap(svg))).png().toBuffer();
  const composites = [];
  for (let i = 0; i < P.protocolo.length; i++) {
    const y = cardStartY + i * (cardH + cardGap);
    const iconPath = path.join(RUN_DIR, P.protocolo[i].icon);
    if (!fs.existsSync(iconPath)) { console.warn(`  ⚠ ${P.protocolo[i].icon} ausente`); continue; }
    const iconBuf = await makeCircleIcon(iconPath, sc(iconSize));
    composites.push({ input: iconBuf, left: Math.round(sc(groupX)), top: Math.round(sc(y + (cardH - iconSize) / 2)) });
  }
  const withIcons = await sharp(base).composite(composites).png().toBuffer();
  const withLogo = await compositeLogo(withIcons);
  fs.writeFileSync(path.join(RUN_DIR, "slide-4-protocolo.png"), withLogo);
  console.log("✓ slide-4-protocolo.png");
}

// ═══════════════════════════════════════════════════════════════════════════
// S5 — Resultado before/after + headliner stat
// ═══════════════════════════════════════════════════════════════════════════
async function renderSlide5() {
  let svg = `<rect width="${W}" height="${H}" fill="${BG}"/>`;
  svg += headlineXml(P.copy.s5_headline_1, P.copy.s5_headline_2_italic, P.copy.s5_sub);

  const startY = 410;
  const rowH = 100;
  const blockW = 860;
  const blockX = (W - blockW) / 2;
  const nameW = 180;
  const trackX = blockX + nameW + 20;
  const trackW = 510;

  svg += `<text x="${trackX}" y="${startY - 22}" font-family="Inter, sans-serif" font-size="12" font-weight="500" fill="${WHITE_FAINT}" letter-spacing="2.5">ANTES</text>`;
  svg += `<circle cx="${trackX + 60}" cy="${startY - 26}" r="4" fill="${STATUS_WARM}" opacity="0.4"/>`;
  svg += `<text x="${trackX + 200}" y="${startY - 22}" font-family="Inter, sans-serif" font-size="12" font-weight="500" fill="${WHITE_FAINT}" letter-spacing="2.5">DEPOIS</text>`;
  svg += `<circle cx="${trackX + 270}" cy="${startY - 26}" r="5" fill="${STATUS_GOOD}"/>`;

  P.biomarkers_after.forEach((m, i) => {
    const y = startY + i * rowH;
    if (i > 0) svg += `<line x1="${blockX}" y1="${y - 12}" x2="${blockX + blockW}" y2="${y - 12}" stroke="${WHITE}" stroke-width="0.5" opacity="0.15"/>`;
    const cY = y + 50;
    svg += `<text x="${blockX}" y="${cY + 6}" font-family="Inter, sans-serif" font-size="24" font-weight="500" fill="${WHITE}" letter-spacing="-0.3">${esc(m.name)}</text>`;
    svg += `<line x1="${trackX}" y1="${cY}" x2="${trackX + trackW}" y2="${cY}" stroke="${WHITE}" stroke-width="2" opacity="0.22"/>`;
    const optX1 = trackX + trackW * m.optStart;
    const optX2 = trackX + trackW * m.optEnd;
    svg += `<line x1="${optX1}" y1="${cY}" x2="${optX2}" y2="${cY}" stroke="${STATUS_GOOD}" stroke-width="4" opacity="0.6"/>`;
    const bX = trackX + trackW * m.bPct;
    svg += `<circle cx="${bX}" cy="${cY}" r="6" fill="${STATUS_WARM}" opacity="0.45"/>`;
    svg += `<text x="${bX}" y="${cY - 16}" font-family="Inter, sans-serif" font-size="13" font-weight="400" fill="${WHITE_FAINT}" text-anchor="middle">${m.before}</text>`;
    const aX = trackX + trackW * m.aPct;
    svg += `<line x1="${bX}" y1="${cY}" x2="${aX}" y2="${cY}" stroke="${STATUS_GOOD}" stroke-width="1.5" opacity="0.55" stroke-dasharray="2,3"/>`;
    svg += `<circle cx="${aX}" cy="${cY}" r="8" fill="${STATUS_GOOD}"/>`;
    svg += `<circle cx="${aX}" cy="${cY}" r="13" fill="none" stroke="${STATUS_GOOD}" stroke-width="1" opacity="0.4"/>`;
    svg += `<text x="${aX}" y="${cY - 18}" font-family="Inter, sans-serif" font-size="16" font-weight="500" fill="${WHITE}" text-anchor="middle">${m.after}</text>`;
  });

  if (P.headliner_stat) {
    const hY = startY + P.biomarkers_after.length * rowH + 40;
    svg += `<line x1="${blockX}" y1="${hY - 24}" x2="${blockX + blockW}" y2="${hY - 24}" stroke="${WHITE}" stroke-width="0.5" opacity="0.18"/>`;
    svg += `<text x="${W/2}" y="${hY + 10}" font-family="Inter, sans-serif" font-size="14" font-weight="500" fill="${WHITE_FAINT}" text-anchor="middle" letter-spacing="3">${P.headliner_stat.label}</text>`;
    svg += `<text x="${W/2 - 90}" y="${hY + 80}" font-family="Inter, sans-serif" font-size="60" font-weight="300" fill="${WHITE_SOFT}" text-anchor="middle" letter-spacing="-1">${P.headliner_stat.before}</text>`;
    svg += `<text x="${W/2}" y="${hY + 80}" font-family="Inter, sans-serif" font-size="30" font-weight="300" fill="${WHITE_FAINT}" text-anchor="middle">→</text>`;
    svg += `<text x="${W/2 + 90}" y="${hY + 80}" font-family="Inter, sans-serif" font-size="60" font-weight="500" fill="${STATUS_GOOD}" text-anchor="middle" letter-spacing="-1">${P.headliner_stat.after}</text>`;
  }

  const base = await sharp(Buffer.from(svgWrap(svg))).png().toBuffer();
  const withLogo = await compositeLogo(base);
  fs.writeFileSync(path.join(RUN_DIR, "slide-5-resultado.png"), withLogo);
  console.log("✓ slide-5-resultado.png");
}

// ═══════════════════════════════════════════════════════════════════════════
// S6 — Manifesto / CTA editorial
// ═══════════════════════════════════════════════════════════════════════════
async function renderSlide6() {
  let svg = `<rect width="${W}" height="${H}" fill="${BG}"/>`;
  const headY = 380;
  svg += `<text x="${W/2}" y="${headY}" font-family="Inter, sans-serif" font-size="72" font-weight="300" fill="${WHITE}" text-anchor="middle" letter-spacing="-2">${esc(P.copy.s6_headline_1)}</text>`;
  svg += `<text x="${W/2}" y="${headY + 80}" font-family="Georgia, serif" font-style="italic" font-size="72" font-weight="400" fill="${WHITE}" text-anchor="middle" letter-spacing="-1">${esc(P.copy.s6_headline_2_italic)}</text>`;

  const bodyLines = (P.copy.s6_body || "").split("\n");
  const bodyY = headY + 200;
  bodyLines.forEach((ln, i) => {
    svg += `<text x="${W/2}" y="${bodyY + i * 34}" font-family="Inter, sans-serif" font-size="24" font-weight="400" fill="${WHITE}" text-anchor="middle">${esc(ln)}</text>`;
  });

  if (P.copy.s6_closing_italic) {
    const cY = bodyY + bodyLines.length * 34 + 80;
    svg += `<text x="${W/2}" y="${cY}" font-family="Georgia, serif" font-style="italic" font-size="26" font-weight="400" fill="${WHITE}" text-anchor="middle">${esc(P.copy.s6_closing_italic)}</text>`;
  }

  const base = await sharp(Buffer.from(svgWrap(svg))).png().toBuffer();
  const withLogo = await compositeLogo(base);
  fs.writeFileSync(path.join(RUN_DIR, "slide-6-manifesto.png"), withLogo);
  console.log("✓ slide-6-manifesto.png");
}

console.log(`\n🎨 Renderizando persona "${P.name}" · 5 internos · palette ${P_KEY}\n`);
await renderSlide2();
await renderSlide3();
await renderSlide4();
await renderSlide5();
await renderSlide6();
console.log("\n✓ Slides 2-6 prontos em", RUN_DIR);
