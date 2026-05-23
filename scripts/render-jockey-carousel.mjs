// render-jockey-carousel.mjs — Manifesto Longevify (Jockey Club)
// Carrossel: S1 cover (Matheus GPT) + 4 slides internos
//
// Palette derivada da cover Jockey: clay terra + white tank + olive trees + golden hour
// Internals: cream off-white #F5EFE3 BG, dark warm charcoal text, terra accent
//
// Estrutura:
//   S2 — O que medimos (painel completo agrupado)
//   S3 — A diferença (Longevify vs medicina convencional)
//   S4 — Como funciona (4 passos)
//   S5 — Closing manifesto

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

// Palette cream/clay derivada da cover Jockey
const BG_CREAM = "#F1EBDD";            // cream off-white (lighter than warm taupe)
const DARK = "#2A2722";                 // warm charcoal pra texto principal
const DARK_SOFT = "#2A2722CC";
const DARK_FAINT = "#2A272288";
const ACCENT_CLAY = "#A8623A";          // clay terra do court (muted, não saturado)
const ACCENT_SAGE = "#7A8B6E";          // olive sage das árvores

const RUN_DIR = path.join(ROOT, "runs", "2026-05-24-001-manifesto-jockey", "assets");
const LOGO_WHITE = path.join(ROOT, "assets", "logo-horizontal-white.png");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const sc = (n) => Math.round(n * SCALE);

function svgWrap(inner) {
  return `<svg width="${OUT_W}" height="${OUT_H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

// Mini-charts inline SVG pra cada dimensão do painel (S2)
function miniChartXml(type, x, y) {
  const cw = 130, ch = 64;
  const stroke = ACCENT_CLAY;
  let svg = "";
  if (type === "glucose") {
    // Glicose: curva com pico e queda
    svg += `<path d="M ${x} ${y+ch*0.72} Q ${x+cw*0.28} ${y+ch*0.72} ${x+cw*0.42} ${y+ch*0.12} T ${x+cw*0.72} ${y+ch*0.88} L ${x+cw} ${y+ch*0.7}" stroke="${stroke}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  } else if (type === "bars") {
    // ApoB comparison: 2 barras
    const bw = 28;
    svg += `<rect x="${x+25}" y="${y+ch*0.45}" width="${bw}" height="${ch*0.55}" fill="${stroke}" opacity="0.4"/>`;
    svg += `<rect x="${x+72}" y="${y+ch*0.10}" width="${bw}" height="${ch*0.9}" fill="${stroke}"/>`;
  } else if (type === "wave") {
    // Cortisol diurnal curve
    svg += `<path d="M ${x} ${y+ch*0.88} Q ${x+cw*0.22} ${y+ch*0.05} ${x+cw*0.50} ${y+ch*0.40} T ${x+cw} ${y+ch*0.92}" stroke="${stroke}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
  } else if (type === "vbars") {
    // 4 barras verticais altura variada (deficiência → ótimo)
    const bw = 16;
    const heights = [0.40, 0.72, 0.55, 0.88];
    heights.forEach((hp, i) => {
      const barH = ch * hp;
      svg += `<rect x="${x + 14 + i*26}" y="${y + ch - barH}" width="${bw}" height="${barH}" fill="${stroke}" opacity="${(0.40 + i*0.18).toFixed(2)}"/>`;
    });
  } else if (type === "delta") {
    // Número → número (idade biológica)
    svg += `<text x="${x+22}" y="${y+ch*0.72}" font-family="Inter, sans-serif" font-size="26" font-weight="300" fill="${stroke}" opacity="0.5">34</text>`;
    svg += `<text x="${x+62}" y="${y+ch*0.72}" font-family="Inter, sans-serif" font-size="16" fill="${stroke}" opacity="0.5">→</text>`;
    svg += `<text x="${x+86}" y="${y+ch*0.72}" font-family="Inter, sans-serif" font-size="30" font-weight="500" fill="${stroke}">28</text>`;
  }
  return svg;
}

// Circular icon mask (mesmo pattern Julia S4)
async function makeCircleIcon(srcPath, diameter) {
  const src = await sharp(srcPath).resize(diameter, diameter, { fit: "cover", position: "center" }).toBuffer();
  const mask = Buffer.from(
    `<svg width="${diameter}" height="${diameter}"><circle cx="${diameter/2}" cy="${diameter/2}" r="${diameter/2}" fill="white"/></svg>`
  );
  return sharp(src).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
}

// Logo DARK (invert da white) sobre cream bg
async function compositeLogo(buf, { bottomMargin = 50 } = {}) {
  const trimmed = await sharp(LOGO_WHITE).trim().toBuffer({ resolveWithObject: true });
  const cropH = Math.round(trimmed.info.height * 0.78);
  let wordmark = await sharp(trimmed.data)
    .extract({ left: 0, top: 0, width: trimmed.info.width, height: cropH })
    .toBuffer();
  // Inverte branco → dark
  wordmark = await sharp(wordmark).negate({ alpha: false }).toBuffer();
  const logoW = Math.round(OUT_W * 0.25);
  const logoBuf = await sharp(wordmark).resize(logoW).toBuffer();
  const meta = await sharp(logoBuf).metadata();
  const x = Math.round((OUT_W - logoW) / 2);
  const y = Math.round(OUT_H - (meta.height ?? 60) - sc(bottomMargin));
  return sharp(buf).composite([{ input: logoBuf, left: x, top: y }]).png().toBuffer();
}

function headlineXml(line1, line2Italic, sub, opts = {}) {
  const { y = 110, fontSize = 62 } = opts;
  let svg = `<text x="${W/2}" y="${y}" font-family="Inter, sans-serif" font-size="${fontSize}" font-weight="300" fill="${DARK}" text-anchor="middle" letter-spacing="-2">${esc(line1)}</text>`;
  if (line2Italic) {
    svg += `<text x="${W/2}" y="${y + fontSize * 1.1}" font-family="Georgia, serif" font-style="italic" font-size="${fontSize}" font-weight="400" fill="${DARK}" text-anchor="middle" letter-spacing="-1">${esc(line2Italic)}</text>`;
  }
  if (sub) {
    const subY = y + (line2Italic ? 2 * fontSize * 1.1 : fontSize * 1.1) + 14;
    svg += `<text x="${W/2}" y="${subY}" font-family="Inter, sans-serif" font-size="22" font-weight="400" fill="${DARK_SOFT}" text-anchor="middle">${esc(sub)}</text>`;
  }
  return svg;
}

// ═══════════════════════════════════════════════════════════════════════════
// SLIDE 2 — O que medimos (painel completo, 5 grupos)
// ═══════════════════════════════════════════════════════════════════════════
async function renderSlide2() {
  let svg = `<rect width="${W}" height="${H}" fill="${BG_CREAM}"/>`;
  svg += headlineXml("Longevidade", "é números.", "O painel completo lê em cinco dimensões.");

  // Mesma linguagem visual do Julia S5: track horizontal + dots sage
  // Cada dot = um marcador medido. Dimensão = uma row.
  const groups = [
    { label: "METABÓLICO",     markers: ["Glicose",  "HbA1c",   "Insulina",   "HOMA-IR"]   },
    { label: "CARDIOVASCULAR", markers: ["ApoB",     "Lp(a)",   "hs-CRP",     "Trig./HDL"] },
    { label: "HORMONAL",       markers: ["Cortisol", "DHEA-S",  "Tireoide"]                },
    { label: "NUTRICIONAL",    markers: ["Vit D",    "B12",     "Ferritina",  "Ômega-3"]   },
    { label: "ENVELHECIMENTO", markers: ["Idade",    "HRV",     "VO2max"]                  },
  ];

  const startY = 410;
  const rowH = 120;
  const blockW = 880;
  const blockX = (W - blockW) / 2;
  const trackX = blockX + 220;
  const trackW = blockW - 220;

  groups.forEach((g, i) => {
    const y = startY + i * rowH;
    if (i > 0) {
      svg += `<line x1="${blockX}" y1="${y - 14}" x2="${blockX + blockW}" y2="${y - 14}" stroke="${DARK}" stroke-width="0.5" opacity="0.12"/>`;
    }
    const centerY = y + 50;

    // Dimensão label (left, kicker clay)
    svg += `<text x="${blockX}" y="${centerY + 6}" font-family="Inter, sans-serif" font-size="16" font-weight="500" fill="${ACCENT_CLAY}" letter-spacing="3">${g.label}</text>`;

    // Track base (thin dark muted)
    svg += `<line x1="${trackX}" y1="${centerY}" x2="${trackX + trackW}" y2="${centerY}" stroke="${DARK}" stroke-width="1.5" opacity="0.18"/>`;

    // SAGE SEGMENT — representa a faixa funcional, ocupa middle 80% do track
    const segStart = trackX + trackW * 0.10;
    const segEnd = trackX + trackW * 0.90;
    svg += `<line x1="${segStart}" y1="${centerY}" x2="${segEnd}" y2="${centerY}" stroke="${ACCENT_SAGE}" stroke-width="5" opacity="0.55" stroke-linecap="round"/>`;

    // N dots sage maiores + ring + labels diretamente sob o dot
    const n = g.markers.length;
    const segW = segEnd - segStart;
    for (let j = 0; j < n; j++) {
      const dotX = segStart + (segW * (j + 0.5) / n);
      // Dot sage forte
      svg += `<circle cx="${dotX}" cy="${centerY}" r="9" fill="${ACCENT_SAGE}"/>`;
      svg += `<circle cx="${dotX}" cy="${centerY}" r="14" fill="none" stroke="${ACCENT_SAGE}" stroke-width="1.2" opacity="0.5"/>`;
      // Label do marcador ABAIXO do dot (mais integrado), Inter Medium
      svg += `<text x="${dotX}" y="${centerY + 38}" font-family="Inter, sans-serif" font-size="15" font-weight="500" fill="${DARK}" text-anchor="middle" letter-spacing="-0.2">${esc(g.markers[j])}</text>`;
    }
  });

  // Legenda discreta abaixo
  svg += `<text x="${W/2}" y="${1080}" font-family="Inter, sans-serif" font-size="13" font-weight="500" fill="${DARK_FAINT}" text-anchor="middle" letter-spacing="3">FAIXA FUNCIONAL  ·  CADA PONTO É UM MARCADOR</text>`;

  const base = await sharp(Buffer.from(svgWrap(svg))).png().toBuffer();
  const withLogo = await compositeLogo(base);
  fs.writeFileSync(path.join(RUN_DIR, "slide-2-painel.png"), withLogo);
  console.log("✓ slide-2-painel.png");
}

// ═══════════════════════════════════════════════════════════════════════════
// SLIDE 3 — A diferença: Longevify vs medicina convencional (2 colunas)
// ═══════════════════════════════════════════════════════════════════════════
async function renderSlide3() {
  let svg = `<rect width="${W}" height="${H}" fill="${BG_CREAM}"/>`;
  svg += headlineXml("Não somos", "diagnóstico.", "Somos leitura, contexto, protocolo.");

  // 2 colunas: Convencional (esquerda, dim) | Longevify (direita, destaque)
  const startY = 430;
  const rowH = 110;
  const colGap = 50;
  const colW = 420;
  const blockW = colW * 2 + colGap;
  const blockX = (W - blockW) / 2;
  const col1X = blockX;
  const col2X = blockX + colW + colGap;

  // Headers das colunas
  svg += `<text x="${col1X + colW/2}" y="${startY - 26}" font-family="Inter, sans-serif" font-size="13" font-weight="500" fill="${DARK_FAINT}" text-anchor="middle" letter-spacing="3">CONVENCIONAL</text>`;
  svg += `<text x="${col2X + colW/2}" y="${startY - 26}" font-family="Inter, sans-serif" font-size="13" font-weight="500" fill="${ACCENT_CLAY}" text-anchor="middle" letter-spacing="3">LONGEVIFY</text>`;

  const pairs = [
    { left: "Faixa populacional",     right: "Faixa funcional"     },
    { left: "\"Está doente?\"",        right: "\"Está otimizado?\""  },
    { left: "Espera o sintoma",        right: "Age antes do laudo"   },
    { left: "Prescreve a média",       right: "Ajusta ao indivíduo"  },
  ];

  pairs.forEach((p, i) => {
    const y = startY + i * rowH;
    if (i > 0) {
      svg += `<line x1="${blockX}" y1="${y - 14}" x2="${blockX + blockW}" y2="${y - 14}" stroke="${DARK}" stroke-width="0.5" opacity="0.15"/>`;
    }
    // Left col (dim)
    svg += `<text x="${col1X + colW/2}" y="${y + 55}" font-family="Inter, sans-serif" font-size="24" font-weight="400" fill="${DARK_FAINT}" text-anchor="middle">${esc(p.left)}</text>`;
    // Right col (destaque)
    svg += `<text x="${col2X + colW/2}" y="${y + 55}" font-family="Inter, sans-serif" font-size="24" font-weight="500" fill="${DARK}" text-anchor="middle" letter-spacing="-0.3">${esc(p.right)}</text>`;
  });

  // Fechamento italic
  svg += `<text x="${W/2}" y="${1060}" font-family="Georgia, serif" font-style="italic" font-size="24" font-weight="400" fill="${DARK}" text-anchor="middle">Onde a média termina, a leitura começa.</text>`;

  const base = await sharp(Buffer.from(svgWrap(svg))).png().toBuffer();
  const withLogo = await compositeLogo(base);
  fs.writeFileSync(path.join(RUN_DIR, "slide-3-diferenca.png"), withLogo);
  console.log("✓ slide-3-diferenca.png");
}

// ═══════════════════════════════════════════════════════════════════════════
// SLIDE 4 — Como funciona (4 passos)
// ═══════════════════════════════════════════════════════════════════════════
async function renderSlide4() {
  let svg = `<rect width="${W}" height="${H}" fill="${BG_CREAM}"/>`;
  svg += headlineXml("Como começa", "o seu protocolo.", "Quatro passos. Uma operação contínua.");

  const steps = [
    { n: "01", t: "Painel completo",      b: "Marcadores funcionais + composição corporal + capacidade aeróbica.",  icon: "icon-painel.png"    },
    { n: "02", t: "Leitura clínica",      b: "60 min com o time. O número ganha contexto.",                          icon: "icon-leitura.png"   },
    { n: "03", t: "Protocolo construído", b: "Suplementação, treino, hábitos — calibrados aos dados.",               icon: "icon-protocolo.png" },
    { n: "04", t: "Recheck mensal",       b: "Marcadores re-lidos. Protocolo re-ajustado. Loop fechado.",            icon: "icon-recheck.png"   },
  ];

  // Layout: icon circular esquerda + numero + titulo + body direita
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
      svg += `<line x1="${groupX}" y1="${dy}" x2="${groupX + groupW}" y2="${dy}" stroke="${DARK}" stroke-width="0.5" opacity="0.15"/>`;
    }
    // Numero terra clay (label kicker)
    svg += `<text x="${textX}" y="${y + 38}" font-family="Inter, sans-serif" font-size="14" font-weight="500" fill="${ACCENT_CLAY}" letter-spacing="3">PASSO ${s.n}</text>`;
    // Title
    svg += `<text x="${textX}" y="${y + 78}" font-family="Inter, sans-serif" font-size="28" font-weight="500" fill="${DARK}" letter-spacing="-0.3">${esc(s.t)}</text>`;
    // Body
    svg += `<text x="${textX}" y="${y + 115}" font-family="Inter, sans-serif" font-size="19" font-weight="400" fill="${DARK_SOFT}">${esc(s.b)}</text>`;
  });

  const base = await sharp(Buffer.from(svgWrap(svg))).png().toBuffer();

  // Composite circular icons em output coords
  const composites = [];
  for (let i = 0; i < steps.length; i++) {
    const y = cardStartY + i * (cardH + cardGap);
    const iconPath = path.join(RUN_DIR, steps[i].icon);
    if (!fs.existsSync(iconPath)) {
      console.warn(`  ⚠ ${steps[i].icon} ainda não baixado, skipando`);
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
  fs.writeFileSync(path.join(RUN_DIR, "slide-4-como-funciona.png"), withLogo);
  console.log("✓ slide-4-como-funciona.png");
}

// ═══════════════════════════════════════════════════════════════════════════
// SLIDE 5 — Closing manifesto
// ═══════════════════════════════════════════════════════════════════════════
async function renderSlide5() {
  let svg = `<rect width="${W}" height="${H}" fill="${BG_CREAM}"/>`;

  const headY = 380;
  svg += `<text x="${W/2}" y="${headY}" font-family="Inter, sans-serif" font-size="68" font-weight="300" fill="${DARK}" text-anchor="middle" letter-spacing="-2">Sua biologia merece</text>`;
  svg += `<text x="${W/2}" y="${headY + 80}" font-family="Georgia, serif" font-style="italic" font-size="68" font-weight="400" fill="${DARK}" text-anchor="middle" letter-spacing="-1">leitura, não palpite.</text>`;

  // Body
  const bodyY = headY + 200;
  svg += `<text x="${W/2}" y="${bodyY}" font-family="Inter, sans-serif" font-size="24" font-weight="400" fill="${DARK}" text-anchor="middle">Construído por quem entende</text>`;
  svg += `<text x="${W/2}" y="${bodyY + 34}" font-family="Inter, sans-serif" font-size="24" font-weight="400" fill="${DARK}" text-anchor="middle">que o número sozinho não cura.</text>`;
  svg += `<text x="${W/2}" y="${bodyY + 68}" font-family="Inter, sans-serif" font-size="24" font-weight="400" fill="${DARK}" text-anchor="middle">A leitura cura. O protocolo sustenta.</text>`;

  // Closing italic
  const closingY = bodyY + 180;
  svg += `<text x="${W/2}" y="${closingY}" font-family="Georgia, serif" font-style="italic" font-size="26" font-weight="400" fill="${ACCENT_CLAY}" text-anchor="middle">É por isso que existimos.</text>`;

  const base = await sharp(Buffer.from(svgWrap(svg))).png().toBuffer();
  const withLogo = await compositeLogo(base);
  fs.writeFileSync(path.join(RUN_DIR, "slide-5-manifesto.png"), withLogo);
  console.log("✓ slide-5-manifesto.png");
}

console.log(`🎨 Renderizando Jockey manifesto · 4 internos · cream/clay palette\n`);
await renderSlide2();
await renderSlide3();
await renderSlide4();
await renderSlide5();
console.log("\n✓ Internos prontos em", RUN_DIR);
