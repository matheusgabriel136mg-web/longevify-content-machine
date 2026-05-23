// render-julia-carousel.mjs — Persona deep-dive Julia (sauna Lagoa)
// Carrossel: S1 cover (já feita) + 5 slides internos
//
// Estrutura:
//   S2 — Sintomas que não fechavam
//   S3 — Painel inicial · biomarkers + faixa funcional
//   S4 — Protocolo construído sobre os dados (6 alavancas)
//   S5 — Resultado 6 semanas (before/after)
//   S6 — Manifesto / CTA
//
// Voice: Mito (precisão) + Aesop (italic editorial pontual)
// Output: 1440x1800 via SVG viewBox 1080x1350

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

// Palette: dark clinical — espelha as biomarker overlay cards da capa Julia
// (cedar wood + dark glass + golden hour residual)
const BG_DARK = "#1A1916";           // deep charcoal warm (puxa do cedar do sauna)
const WHITE = "#F5EFE3";              // cream off-white pra texto (não branco puro)
const WHITE_SOFT = "#F5EFE3CC";
const WHITE_FAINT = "#F5EFE388";
const STATUS_WARM = "#D4A053";        // amber golden hour low-sat (puxa da capa)
const STATUS_GOOD = "#8FB39A";        // sage muted

const RUN_DIR = path.join(ROOT, "runs", "2026-05-26-001-julia-persona", "assets");
const LOGO_PATH = path.join(ROOT, "assets", "logo-horizontal-white.png");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const sc = (n) => Math.round(n * SCALE);

function svgWrap(inner) {
  return `<svg width="${OUT_W}" height="${OUT_H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

// Circular icon mask (mesmo pattern Ferritina)
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
  const wordmark = await sharp(trimmed.data)
    .extract({ left: 0, top: 0, width: trimmed.info.width, height: cropH })
    .toBuffer();
  const logoW = Math.round(OUT_W * 0.25);
  const logoBuf = await sharp(wordmark).resize(logoW).toBuffer();
  const meta = await sharp(logoBuf).metadata();
  const x = Math.round((OUT_W - logoW) / 2);
  const y = Math.round(OUT_H - (meta.height ?? 60) - sc(bottomMargin));
  return sharp(buf).composite([{ input: logoBuf, left: x, top: y }]).png().toBuffer();
}

// Headline pattern Inter Light L1 + Georgia Italic L2 (approved Longevify pattern)
function headlineXml(line1, line2Italic, sub, opts = {}) {
  const { y = 110, fontSize = 62 } = opts;
  let svg = `<text x="${W/2}" y="${y}" font-family="Inter, sans-serif" font-size="${fontSize}" font-weight="300" fill="${WHITE}" text-anchor="middle" letter-spacing="-2">${esc(line1)}</text>`;
  if (line2Italic) {
    svg += `<text x="${W/2}" y="${y + fontSize * 1.1}" font-family="Georgia, serif" font-style="italic" font-size="${fontSize}" font-weight="400" fill="${WHITE}" text-anchor="middle" letter-spacing="-1">${esc(line2Italic)}</text>`;
  }
  if (sub) {
    const subY = y + (line2Italic ? 2 * fontSize * 1.1 : fontSize * 1.1) + 14;
    svg += `<text x="${W/2}" y="${subY}" font-family="Inter, sans-serif" font-size="22" font-weight="400" fill="${WHITE_SOFT}" text-anchor="middle">${esc(sub)}</text>`;
  }
  return svg;
}

// ═══════════════════════════════════════════════════════════════════════════
// SLIDE 2 — Sintomas que não fechavam
// ═══════════════════════════════════════════════════════════════════════════
async function renderSlide2() {
  let svg = `<rect width="${W}" height="${H}" fill="${BG_DARK}"/>`;
  svg += headlineXml("Sintomas que", "não fechavam.", "O hemograma rotineiro dizia normal. O corpo dizia outra coisa.");

  // 4 sintomas em coluna centralizada
  const items = [
    { kicker: "01", text: "Sono picado. Acordava 3 vezes por noite sem motivo." },
    { kicker: "02", text: "Pernas inquietas no fim do dia." },
    { kicker: "03", text: "Disposição que escapava às 15h, todo dia." },
    { kicker: "04", text: "Treino que não rendia mesmo dormindo 7h." },
  ];

  const startY = 460;
  const itemH = 130;
  const blockW = 740;
  const blockX = (W - blockW) / 2;

  items.forEach((it, i) => {
    const y = startY + i * itemH;
    if (i > 0) {
      svg += `<line x1="${blockX}" y1="${y - 10}" x2="${blockX + blockW}" y2="${y - 10}" stroke="${WHITE}" stroke-width="0.5" opacity="0.18"/>`;
    }
    // Kicker monospace
    svg += `<text x="${blockX}" y="${y + 38}" font-family="Courier New, monospace" font-size="22" font-weight="500" fill="${WHITE_SOFT}" letter-spacing="2">${it.kicker}</text>`;
    // Body
    svg += `<text x="${blockX + 80}" y="${y + 38}" font-family="Inter, sans-serif" font-size="26" font-weight="400" fill="${WHITE}">${esc(it.text)}</text>`;
  });

  // Fechamento italic
  svg += `<text x="${W/2}" y="${1050}" font-family="Georgia, serif" font-style="italic" font-size="24" font-weight="400" fill="${WHITE}" text-anchor="middle">Sintoma sem laudo é sinal mal lido.</text>`;

  const base = await sharp(Buffer.from(svgWrap(svg))).png().toBuffer();
  const withLogo = await compositeLogo(base);
  fs.writeFileSync(path.join(RUN_DIR, "slide-2-sintomas.png"), withLogo);
  console.log("✓ slide-2-sintomas.png");
}

// ═══════════════════════════════════════════════════════════════════════════
// SLIDE 3 — Painel inicial · biomarkers reais com faixa
// ═══════════════════════════════════════════════════════════════════════════
async function renderSlide3() {
  let svg = `<rect width="${W}" height="${H}" fill="${BG_DARK}"/>`;
  svg += headlineXml("O que o exame", "mostrou.", "Cinco marcadores fora da faixa funcional.");

  // 5 biomarcadores com mini-chart: nome | track c/ optimal zone + dot | status
  // pct = posição do valor no track (0-1). optStart/optEnd = faixa funcional ideal (0-1)
  const markers = [
    { name: "Vitamina D",  value: "21.3", unit: "ng/mL", status: "BAIXO",  pct: 0.21, optStart: 0.30, optEnd: 0.80 },
    { name: "hs-CRP",      value: "8.12", unit: "mg/L",  status: "ALTO",   pct: 0.81, optStart: 0.00, optEnd: 0.10 },
    { name: "Ferritina",   value: "18",   unit: "ng/mL", status: "BAIXO",  pct: 0.09, optStart: 0.25, optEnd: 1.00 },
    { name: "ApoB",        value: "95",   unit: "mg/dL", status: "LIMITE", pct: 0.59, optStart: 0.00, optEnd: 0.50 },
    { name: "HbA1c",       value: "5.6",  unit: "%",     status: "LIMITE", pct: 0.53, optStart: 0.00, optEnd: 0.46 },
  ];

  const startY = 440;
  const rowH = 110;
  const blockW = 860;
  const blockX = (W - blockW) / 2;

  // Layout per row: name (left col) | chart (center col) | status (right col)
  const nameW = 180;
  const trackX = blockX + nameW + 20;
  const trackW = 460;
  const statusX = trackX + trackW + 50;

  markers.forEach((m, i) => {
    const y = startY + i * rowH;
    if (i > 0) {
      svg += `<line x1="${blockX}" y1="${y - 14}" x2="${blockX + blockW}" y2="${y - 14}" stroke="${WHITE}" stroke-width="0.5" opacity="0.15"/>`;
    }
    const centerY = y + 42;

    // Nome (left)
    svg += `<text x="${blockX}" y="${centerY + 6}" font-family="Inter, sans-serif" font-size="24" font-weight="500" fill="${WHITE}" letter-spacing="-0.3">${esc(m.name)}</text>`;

    // Chart track base
    svg += `<line x1="${trackX}" y1="${centerY}" x2="${trackX + trackW}" y2="${centerY}" stroke="${WHITE}" stroke-width="2" opacity="0.22"/>`;
    // Faixa funcional (sage muted)
    const optX1 = trackX + trackW * m.optStart;
    const optX2 = trackX + trackW * m.optEnd;
    svg += `<line x1="${optX1}" y1="${centerY}" x2="${optX2}" y2="${centerY}" stroke="${STATUS_GOOD}" stroke-width="4" opacity="0.7"/>`;
    // Dot na posição atual
    const dotX = trackX + trackW * m.pct;
    svg += `<circle cx="${dotX}" cy="${centerY}" r="7" fill="${STATUS_WARM}"/>`;
    svg += `<circle cx="${dotX}" cy="${centerY}" r="11" fill="none" stroke="${STATUS_WARM}" stroke-width="1" opacity="0.4"/>`;
    // Valor label acima do dot
    svg += `<text x="${dotX}" y="${centerY - 18}" font-family="Inter, sans-serif" font-size="18" font-weight="500" fill="${WHITE}" text-anchor="middle">${m.value} ${m.unit}</text>`;

    // Status tag (right)
    svg += `<text x="${statusX}" y="${centerY + 6}" font-family="Inter, sans-serif" font-size="16" font-weight="500" fill="${STATUS_WARM}" text-anchor="middle" letter-spacing="2">${m.status}</text>`;
  });

  // Legenda discreta abaixo da tabela
  svg += `<text x="${W/2}" y="${1060}" font-family="Inter, sans-serif" font-size="14" font-weight="400" fill="${WHITE_FAINT}" text-anchor="middle" letter-spacing="2">FAIXA FUNCIONAL  ·  VALOR ATUAL</text>`;

  const base = await sharp(Buffer.from(svgWrap(svg))).png().toBuffer();
  const withLogo = await compositeLogo(base);
  fs.writeFileSync(path.join(RUN_DIR, "slide-3-painel.png"), withLogo);
  console.log("✓ slide-3-painel.png");
}

// ═══════════════════════════════════════════════════════════════════════════
// SLIDE 4 — Protocolo · 6 alavancas com icons circulares Higgsfield
// ═══════════════════════════════════════════════════════════════════════════
async function renderSlide4() {
  let svg = `<rect width="${W}" height="${H}" fill="${BG_DARK}"/>`;
  svg += headlineXml("Protocolo construído", "sobre os dados.", "Seis alavancas, ajustadas à biologia da Julia.");

  const items = [
    { n: "01", t: "Vitamina D3 + K2",        b: "5000 UI matinal, com gordura. K2 direciona o cálcio.",  icon: "icon-vitd.png"  },
    { n: "02", t: "Ômega-3 EPA/DHA",         b: "2g/dia. Apaga a inflamação que o hs-CRP denunciava.",  icon: "icon-omega.png" },
    { n: "03", t: "Ferro heme + vitamina C", b: "Em jejum, longe de café. Ferritina sobe primeiro.",    icon: "icon-ferro.png" },
    { n: "04", t: "Sauna 2× por semana",     b: "HSP, recuperação, baixa inflamação sistêmica.",        icon: "icon-sauna.png" },
    { n: "05", t: "Força 3× por semana",     b: "Massa magra primeiro. Glicose responde depois.",       icon: "icon-forca.png" },
    { n: "06", t: "Janela de sono travada",  b: "23h–7h, sempre. Circadiano não negocia.",              icon: "icon-sono.png"  },
  ];

  // Layout: icon circular + (numero · título) + body, 6 rows compactos
  const iconSize = 105;
  const iconGap = 28;
  const textBlockW = 560;
  const groupW = iconSize + iconGap + textBlockW;
  const groupX = (W - groupW) / 2;
  const textX = groupX + iconSize + iconGap;

  const cardStartY = 320;
  const cardH = 130;
  const cardGap = 12;

  items.forEach((it, i) => {
    const y = cardStartY + i * (cardH + cardGap);
    if (i > 0) {
      const dy = y - cardGap/2;
      svg += `<line x1="${groupX}" y1="${dy}" x2="${groupX + groupW}" y2="${dy}" stroke="${WHITE}" stroke-width="0.5" opacity="0.15"/>`;
    }
    // Numero + título numa linha
    svg += `<text x="${textX}" y="${y + 52}" font-family="Inter, sans-serif" font-size="24" font-weight="500" fill="${WHITE}" letter-spacing="-0.3">${it.n}  ·  ${esc(it.t)}</text>`;
    // Body
    svg += `<text x="${textX}" y="${y + 88}" font-family="Inter, sans-serif" font-size="19" font-weight="400" fill="${WHITE_SOFT}">${esc(it.b)}</text>`;
  });

  const base = await sharp(Buffer.from(svgWrap(svg))).png().toBuffer();

  // Composite icons circulares (em output coords, multiplicar por SCALE)
  const composites = [];
  for (let i = 0; i < items.length; i++) {
    const y = cardStartY + i * (cardH + cardGap);
    const iconPath = path.join(RUN_DIR, items[i].icon);
    if (!fs.existsSync(iconPath)) {
      console.warn(`  ⚠ ${items[i].icon} ainda não baixado, skipando`);
      continue;
    }
    const iconBuf = await makeCircleIcon(iconPath, sc(iconSize));
    composites.push({
      input: iconBuf,
      left: Math.round(sc(groupX)),
      top: Math.round(sc(y + (cardH - iconSize) / 2)),
    });
  }
  const withIcons = await sharp(base).composite(composites).png().toBuffer();
  const withLogo = await compositeLogo(withIcons);
  fs.writeFileSync(path.join(RUN_DIR, "slide-4-protocolo.png"), withLogo);
  console.log("✓ slide-4-protocolo.png");
}

// ═══════════════════════════════════════════════════════════════════════════
// SLIDE 5 — Before/After com mini-charts (mesma linguagem do S3)
// 2 dots por marcador: BEFORE faint + AFTER destacado (movimento p/ faixa)
// ═══════════════════════════════════════════════════════════════════════════
async function renderSlide5() {
  let svg = `<rect width="${W}" height="${H}" fill="${BG_DARK}"/>`;
  svg += headlineXml("Seis semanas.", "Outra Julia.", "Mesmos exames. Faixa funcional alcançada.");

  // 4 biomarkers + 1 headliner abaixo (idade biológica)
  const markers = [
    { name: "Vitamina D", unit: "ng/mL", before: "21.3", after: "47.0", bPct: 0.21, aPct: 0.47, optStart: 0.30, optEnd: 0.80 },
    { name: "hs-CRP",     unit: "mg/L",  before: "8.12", after: "1.20", bPct: 0.81, aPct: 0.12, optStart: 0.00, optEnd: 0.10 },
    { name: "Ferritina",  unit: "ng/mL", before: "18",   after: "68",   bPct: 0.09, aPct: 0.34, optStart: 0.25, optEnd: 1.00 },
    { name: "ApoB",       unit: "mg/dL", before: "95",   after: "73",   bPct: 0.59, aPct: 0.46, optStart: 0.00, optEnd: 0.50 },
  ];

  const startY = 410;
  const rowH = 100;
  const blockW = 860;
  const blockX = (W - blockW) / 2;

  const nameW = 180;
  const trackX = blockX + nameW + 20;
  const trackW = 510;

  // Legenda mini no topo do bloco
  svg += `<text x="${trackX}" y="${startY - 22}" font-family="Inter, sans-serif" font-size="12" font-weight="500" fill="${WHITE_FAINT}" letter-spacing="2.5">ANTES</text>`;
  // Dot legend amber faint
  svg += `<circle cx="${trackX + 60}" cy="${startY - 26}" r="4" fill="${STATUS_WARM}" opacity="0.4"/>`;
  svg += `<text x="${trackX + 200}" y="${startY - 22}" font-family="Inter, sans-serif" font-size="12" font-weight="500" fill="${WHITE_FAINT}" letter-spacing="2.5">DEPOIS</text>`;
  svg += `<circle cx="${trackX + 270}" cy="${startY - 26}" r="5" fill="${STATUS_GOOD}"/>`;

  markers.forEach((m, i) => {
    const y = startY + i * rowH;
    if (i > 0) {
      svg += `<line x1="${blockX}" y1="${y - 12}" x2="${blockX + blockW}" y2="${y - 12}" stroke="${WHITE}" stroke-width="0.5" opacity="0.15"/>`;
    }
    const centerY = y + 50;

    // Nome
    svg += `<text x="${blockX}" y="${centerY + 6}" font-family="Inter, sans-serif" font-size="24" font-weight="500" fill="${WHITE}" letter-spacing="-0.3">${esc(m.name)}</text>`;

    // Track base
    svg += `<line x1="${trackX}" y1="${centerY}" x2="${trackX + trackW}" y2="${centerY}" stroke="${WHITE}" stroke-width="2" opacity="0.22"/>`;
    // Faixa funcional sage
    const optX1 = trackX + trackW * m.optStart;
    const optX2 = trackX + trackW * m.optEnd;
    svg += `<line x1="${optX1}" y1="${centerY}" x2="${optX2}" y2="${centerY}" stroke="${STATUS_GOOD}" stroke-width="4" opacity="0.6"/>`;

    // BEFORE dot (faint amber)
    const beforeX = trackX + trackW * m.bPct;
    svg += `<circle cx="${beforeX}" cy="${centerY}" r="6" fill="${STATUS_WARM}" opacity="0.45"/>`;
    svg += `<text x="${beforeX}" y="${centerY - 16}" font-family="Inter, sans-serif" font-size="13" font-weight="400" fill="${WHITE_FAINT}" text-anchor="middle">${m.before}</text>`;

    // Linha entre before → after
    const afterX = trackX + trackW * m.aPct;
    svg += `<line x1="${beforeX}" y1="${centerY}" x2="${afterX}" y2="${centerY}" stroke="${STATUS_GOOD}" stroke-width="1.5" opacity="0.55" stroke-dasharray="2,3"/>`;

    // AFTER dot (sage destaque)
    svg += `<circle cx="${afterX}" cy="${centerY}" r="8" fill="${STATUS_GOOD}"/>`;
    svg += `<circle cx="${afterX}" cy="${centerY}" r="13" fill="none" stroke="${STATUS_GOOD}" stroke-width="1" opacity="0.4"/>`;
    svg += `<text x="${afterX}" y="${centerY - 18}" font-family="Inter, sans-serif" font-size="16" font-weight="500" fill="${WHITE}" text-anchor="middle">${m.after}</text>`;
  });

  // ── Headliner idade biológica abaixo das 4 mini-charts ──
  const headlinerY = startY + markers.length * rowH + 40;
  svg += `<line x1="${blockX}" y1="${headlinerY - 24}" x2="${blockX + blockW}" y2="${headlinerY - 24}" stroke="${WHITE}" stroke-width="0.5" opacity="0.18"/>`;

  // Label "IDADE BIOLÓGICA" pequena letterspaced
  svg += `<text x="${W/2}" y="${headlinerY + 10}" font-family="Inter, sans-serif" font-size="14" font-weight="500" fill="${WHITE_FAINT}" text-anchor="middle" letter-spacing="3">IDADE BIOLÓGICA</text>`;
  // 34 → 28 grande
  svg += `<text x="${W/2 - 90}" y="${headlinerY + 80}" font-family="Inter, sans-serif" font-size="60" font-weight="300" fill="${WHITE_SOFT}" text-anchor="middle" letter-spacing="-1">34</text>`;
  svg += `<text x="${W/2}" y="${headlinerY + 80}" font-family="Inter, sans-serif" font-size="30" font-weight="300" fill="${WHITE_FAINT}" text-anchor="middle">→</text>`;
  svg += `<text x="${W/2 + 90}" y="${headlinerY + 80}" font-family="Inter, sans-serif" font-size="60" font-weight="500" fill="${STATUS_GOOD}" text-anchor="middle" letter-spacing="-1">28</text>`;

  const base = await sharp(Buffer.from(svgWrap(svg))).png().toBuffer();
  const withLogo = await compositeLogo(base);
  fs.writeFileSync(path.join(RUN_DIR, "slide-5-resultado.png"), withLogo);
  console.log("✓ slide-5-resultado.png");
}

// ═══════════════════════════════════════════════════════════════════════════
// SLIDE 6 — Manifesto / CTA
// ═══════════════════════════════════════════════════════════════════════════
async function renderSlide6() {
  let svg = `<rect width="${W}" height="${H}" fill="${BG_DARK}"/>`;

  // Headline grande no centro
  const headY = 380;
  svg += `<text x="${W/2}" y="${headY}" font-family="Inter, sans-serif" font-size="72" font-weight="300" fill="${WHITE}" text-anchor="middle" letter-spacing="-2">Seu corpo não é</text>`;
  svg += `<text x="${W/2}" y="${headY + 80}" font-family="Georgia, serif" font-style="italic" font-size="72" font-weight="400" fill="${WHITE}" text-anchor="middle" letter-spacing="-1">a média.</text>`;

  // Body abaixo
  const bodyY = headY + 200;
  svg += `<text x="${W/2}" y="${bodyY}" font-family="Inter, sans-serif" font-size="24" font-weight="400" fill="${WHITE}" text-anchor="middle">O exame mainstream te coloca dentro de uma faixa populacional.</text>`;
  svg += `<text x="${W/2}" y="${bodyY + 34}" font-family="Inter, sans-serif" font-size="24" font-weight="400" fill="${WHITE}" text-anchor="middle">O painel certo lê a sua biologia.</text>`;
  svg += `<text x="${W/2}" y="${bodyY + 68}" font-family="Inter, sans-serif" font-size="24" font-weight="400" fill="${WHITE}" text-anchor="middle">E só depois constrói o protocolo.</text>`;

  // Fechamento editorial italic (sem CTA imperativo clichê)
  const closingY = bodyY + 180;
  svg += `<text x="${W/2}" y="${closingY}" font-family="Georgia, serif" font-style="italic" font-size="26" font-weight="400" fill="${WHITE}" text-anchor="middle">É essa leitura que sustenta um protocolo.</text>`;

  const base = await sharp(Buffer.from(svgWrap(svg))).png().toBuffer();
  const withLogo = await compositeLogo(base);
  fs.writeFileSync(path.join(RUN_DIR, "slide-6-manifesto.png"), withLogo);
  console.log("✓ slide-6-manifesto.png");
}

// ─── Run all ──────────────────────────────────────────────────────────────────
console.log(`🎨 Renderizando Julia persona · 5 slides internos · OUT ${OUT_W}×${OUT_H}\n`);
await renderSlide2();
await renderSlide3();
await renderSlide4();
await renderSlide5();
await renderSlide6();
console.log("\n✓ Slides 2-6 prontos em", RUN_DIR);
