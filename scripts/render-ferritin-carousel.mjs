// render-ferritin-carousel.mjs — Carrossel completo FERRITINA (5 slides)
// Output: 1440x1800 (max IG sem compressão), design space 1080x1350 via SVG viewBox
// Replicando 5 refs Mito Health, adaptando à voz Longevify (Mito+Aesop pt-BR)
// Regras CLAUDE.md: warm taupe #BBB4A2, Inter Light 300, logo branca 25%, sem kicker

import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";

// ─── RESOLUÇÃO ────────────────────────────────────────────────────────────────
const W = 1080, H = 1350;          // DESIGN SPACE (todas as coords abaixo)
const OUT_W = 1440, OUT_H = 1800;  // OUTPUT max IG
const SCALE = OUT_W / W;            // 1.333... (pra raster composites)

const BG_TAUPE = "#BBB4A2";
const WHITE = "#FAF7F0";
const WHITE_SOFT = "#FAF7F0CC";

const RUN_DIR = "/Users/mathe/Documents/Longev/Brand/Longevify/content-machine/runs/2026-05-22-001-ferritina-ferro-escondido/assets";
const LOGO_PATH = "/Users/mathe/Documents/Longev/Brand/Longevify/content-machine/assets/logo-horizontal-white.png";

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const sc = (n) => Math.round(n * SCALE);

// ─── WRAPPER SVG → renderiza viewBox 1080x1350 em canvas 1440x1800 (vetorial) ─
function svgWrap(innerSvg) {
  return `<svg width="${OUT_W}" height="${OUT_H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${innerSvg}</svg>`;
}

// ─── LOGO: branca, 25% width, bottom-center, em output coords ─────────────────
async function compositeLogo(buf, opts = {}) {
  const { bottomMargin = 50 } = opts;
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

// ─── ICON CIRCULAR ────────────────────────────────────────────────────────────
async function makeCircleIcon(srcPath, diameter) {
  const src = await sharp(srcPath).resize(diameter, diameter, { fit: "cover", position: "center" }).toBuffer();
  const mask = Buffer.from(
    `<svg width="${diameter}" height="${diameter}"><circle cx="${diameter/2}" cy="${diameter/2}" r="${diameter/2}" fill="white"/></svg>`
  );
  return sharp(src).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
}

// ═══════════════════════════════════════════════════════════════════════════
// SLIDE 1 — COVER: Blur olive + texto no BOTTOM-HALF (não cobre rosto)
// ═══════════════════════════════════════════════════════════════════════════
async function renderSlide1() {
  // 1) Crop hardcoded das margens (Higgsfield gerou frame cream-taupe lateral
  //    que trim() não pega). cover-raw é 1856x2304, extraio o miolo focando no
  //    figure (esquerda) + blur olive (direita). Depois cover-fit pro 1440x1800.
  const bg = await sharp(path.join(RUN_DIR, "cover-raw.png"))
    .extract({ left: 200, top: 50, width: 1456, height: 2204 })
    .resize(OUT_W, OUT_H, { fit: "cover", position: "center" })
    .toBuffer();

  // 2) Gradient overlay BOTTOM-UP pra dar legibilidade ao texto sem manchar topo
  //    SVG em design space 1080x1350
  const gradSvg = svgWrap(`
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#000" stop-opacity="0"/>
        <stop offset="0.45" stop-color="#000" stop-opacity="0.05"/>
        <stop offset="1" stop-color="#000" stop-opacity="0.55"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
  `);
  const dimmed = await sharp(bg).composite([{ input: Buffer.from(gradSvg), top: 0, left: 0 }]).png().toBuffer();

  // 3) Texto no bottom-half (design coords)
  //    Headline y=880, sub y=1080. Não cobre o rosto (que está em y~300-650).
  const headFont = 76;
  const headY = 880;
  const head1 = `<text x="${W/2}" y="${headY}" font-family="Inter, Helvetica, sans-serif" font-size="${headFont}" font-weight="300" fill="${WHITE}" text-anchor="middle" letter-spacing="-2">Você pode ter ferritina baixa</text>`;
  const head2 = `<text x="${W/2}" y="${headY + headFont * 1.1}" font-family="Georgia, serif" font-style="italic" font-size="${headFont}" font-weight="400" fill="${WHITE}" text-anchor="middle" letter-spacing="-1">com ferro perfeito.</text>`;

  const subY = headY + 2 * headFont * 1.1 + 30;
  const sub = `<text x="${W/2}" y="${subY}" font-family="Inter, Helvetica, sans-serif" font-size="28" font-weight="400" fill="${WHITE_SOFT}" text-anchor="middle" letter-spacing="0.3">Investigue além do hemograma básico.</text>`;

  const textSvg = svgWrap(head1 + head2 + sub);
  const composed = await sharp(dimmed).composite([{ input: Buffer.from(textSvg), top: 0, left: 0 }]).png().toBuffer();
  const withLogo = await compositeLogo(composed, { bottomMargin: 35 });
  fs.writeFileSync(path.join(RUN_DIR, "slide-1-cover.png"), withLogo);
  console.log("✓ slide-1-cover.png");
}

// ═══════════════════════════════════════════════════════════════════════════
// SLIDE 2 — FERRO ≠ FERRITINA: chart 2 barras + sub editorial
// ═══════════════════════════════════════════════════════════════════════════
async function renderSlide2() {
  let svg = `<rect width="${W}" height="${H}" fill="${BG_TAUPE}"/>`;

  // Headline consistente com S3/S4/S5 (y=110)
  const headY = 130;
  svg += `<text x="${W/2}" y="${headY}" font-family="Inter, sans-serif" font-size="68" font-weight="300" fill="${WHITE}" text-anchor="middle" letter-spacing="-2">Ferro ≠ Ferritina</text>`;
  svg += `<text x="${W/2}" y="${headY + 50}" font-family="Inter, sans-serif" font-size="26" font-weight="400" fill="${WHITE_SOFT}" text-anchor="middle">Dois marcadores diferentes da mesma rota.</text>`;

  // Chart desce pra balancear o bottom dead-space (era 315px sob italic line)
  const chartY = 430, chartH = 380, barW = 140, barGap = 120;
  const totalChartW = barW * 2 + barGap;
  const chartX = (W - totalChartW) / 2;

  for (let i = 1; i <= 4; i++) {
    const y = chartY + (chartH * i) / 4;
    svg += `<line x1="${chartX - 40}" y1="${y}" x2="${chartX + totalChartW + 40}" y2="${y}" stroke="${WHITE}" stroke-width="0.5" stroke-dasharray="3,5" opacity="0.18"/>`;
  }

  // Bar 1: FERRO alto
  const bar1H = chartH * 0.85, bar1Y = chartY + chartH - bar1H;
  svg += `<rect x="${chartX}" y="${bar1Y}" width="${barW}" height="${bar1H}" fill="${WHITE}" opacity="0.95" rx="2"/>`;
  svg += `<text x="${chartX + barW/2}" y="${bar1Y - 20}" font-family="Inter, sans-serif" font-size="22" font-weight="500" fill="${WHITE}" text-anchor="middle">120 µg/dL</text>`;
  svg += `<text x="${chartX + barW/2}" y="${chartY + chartH + 40}" font-family="Inter, sans-serif" font-size="20" font-weight="500" fill="${WHITE}" text-anchor="middle" letter-spacing="2">FERRO</text>`;
  svg += `<text x="${chartX + barW/2}" y="${chartY + chartH + 68}" font-family="Inter, sans-serif" font-size="16" font-weight="400" fill="${WHITE_SOFT}" text-anchor="middle">no sangue</text>`;

  // Bar 2: FERRITINA baixa
  const bar2H = chartH * 0.18, bar2Y = chartY + chartH - bar2H;
  const bar2X = chartX + barW + barGap;
  svg += `<rect x="${bar2X}" y="${bar2Y}" width="${barW}" height="${bar2H}" fill="${WHITE}" opacity="0.95" rx="2"/>`;
  svg += `<text x="${bar2X + barW/2}" y="${bar2Y - 20}" font-family="Inter, sans-serif" font-size="22" font-weight="500" fill="${WHITE}" text-anchor="middle">22 ng/mL</text>`;
  svg += `<text x="${bar2X + barW/2}" y="${chartY + chartH + 40}" font-family="Inter, sans-serif" font-size="20" font-weight="500" fill="${WHITE}" text-anchor="middle" letter-spacing="2">FERRITINA</text>`;
  svg += `<text x="${bar2X + barW/2}" y="${chartY + chartH + 68}" font-family="Inter, sans-serif" font-size="16" font-weight="400" fill="${WHITE_SOFT}" text-anchor="middle">no estoque</text>`;

  const explY = chartY + chartH + 150;
  svg += `<text x="${W/2}" y="${explY}" font-family="Inter, sans-serif" font-size="22" font-weight="400" fill="${WHITE}" text-anchor="middle" letter-spacing="0.3">O ferro mostra o que circula agora.</text>`;
  svg += `<text x="${W/2}" y="${explY + 32}" font-family="Inter, sans-serif" font-size="22" font-weight="400" fill="${WHITE}" text-anchor="middle" letter-spacing="0.3">A ferritina mostra o que você tem guardado.</text>`;
  svg += `<text x="${W/2}" y="${explY + 90}" font-family="Georgia, serif" font-style="italic" font-size="24" font-weight="400" fill="${WHITE}" text-anchor="middle">Sem estoque, o circulante é só miragem.</text>`;

  const base = await sharp(Buffer.from(svgWrap(svg))).png().toBuffer();
  const withLogo = await compositeLogo(base);
  fs.writeFileSync(path.join(RUN_DIR, "slide-2-ferro-ferritina.png"), withLogo);
  console.log("✓ slide-2-ferro-ferritina.png");
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Slide com lista de cards (icon + título + body) — usado por S3 e S4
// ═══════════════════════════════════════════════════════════════════════════
async function renderCardListSlide({ outName, headLine1, headLine2Italic, sub, items, iconAssets, numbered = false }) {
  let svg = `<rect width="${W}" height="${H}" fill="${BG_TAUPE}"/>`;

  // Headline + sub (subidos pra equilibrar com cards mais altos)
  const headY = 110;
  svg += `<text x="${W/2}" y="${headY}" font-family="Inter, sans-serif" font-size="62" font-weight="300" fill="${WHITE}" text-anchor="middle" letter-spacing="-2">${esc(headLine1)}</text>`;
  svg += `<text x="${W/2}" y="${headY + 68}" font-family="Georgia, serif" font-style="italic" font-size="62" font-weight="400" fill="${WHITE}" text-anchor="middle" letter-spacing="-1">${esc(headLine2Italic)}</text>`;
  svg += `<text x="${W/2}" y="${headY + 130}" font-family="Inter, sans-serif" font-size="22" font-weight="400" fill="${WHITE_SOFT}" text-anchor="middle">${esc(sub)}</text>`;

  // ─── CENTRALIZAÇÃO ──────────────────────────────────────────────────────
  // Bloco do card = icon + gap + textBlock (largura fixa). Centralizo o GRUPO.
  const iconSize = 130;
  const iconGap = 44;
  const textBlockW = 460;          // largura uniforme do bloco de texto (todos cards iguais)
  const groupW = iconSize + iconGap + textBlockW;
  const groupX = (W - groupW) / 2; // centralizado horizontalmente
  const iconX = groupX;
  const textX = groupX + iconSize + iconGap;

  const cardStartY = 330;
  const cardH = 170;
  const cardGap = 22;

  const composites = [];

  for (let i = 0; i < items.length; i++) {
    const y = cardStartY + i * (cardH + cardGap);
    // Divisor APENAS sob a largura do bloco (não edge-to-edge)
    if (i > 0) {
      const dy = y - cardGap/2;
      svg += `<line x1="${groupX}" y1="${dy}" x2="${groupX + groupW}" y2="${dy}" stroke="${WHITE}" stroke-width="0.5" opacity="0.2"/>`;
    }

    // Título
    const title = numbered ? `${String(i+1).padStart(2,"0")}  ·  ${items[i].title}` : items[i].title;
    svg += `<text x="${textX}" y="${y + 60}" font-family="Inter, sans-serif" font-size="30" font-weight="500" fill="${WHITE}" letter-spacing="-0.5">${esc(title)}</text>`;
    // Body
    const bodyLines = items[i].body.split("\n");
    bodyLines.forEach((ln, k) => {
      svg += `<text x="${textX}" y="${y + 102 + k * 30}" font-family="Inter, sans-serif" font-size="21" font-weight="400" fill="${WHITE_SOFT}">${esc(ln)}</text>`;
    });
  }

  const base = await sharp(Buffer.from(svgWrap(svg))).png().toBuffer();

  // Icons composite em output space — multiplica por SCALE
  for (let i = 0; i < items.length; i++) {
    const y = cardStartY + i * (cardH + cardGap);
    const iconBuf = await makeCircleIcon(iconAssets[i], sc(iconSize));
    composites.push({
      input: iconBuf,
      left: sc(iconX),
      top: sc(y + (cardH - iconSize) / 2),
    });
  }
  const withIcons = await sharp(base).composite(composites).png().toBuffer();
  const withLogo = await compositeLogo(withIcons);
  fs.writeFileSync(path.join(RUN_DIR, outName), withLogo);
  console.log(`✓ ${outName}`);
}

async function renderSlide3() {
  return renderCardListSlide({
    outName: "slide-3-sintomas.png",
    headLine1: "Ferritina baixa,",
    headLine2Italic: "mais que cansaço.",
    sub: "Sintomas que poucos médicos conectam.",
    items: [
      { title: "Névoa mental", body: "Concentração escapa,\nleitura cansa antes da hora." },
      { title: "Queda de cabelo", body: "Mais fios no travesseiro\nque no shampoo." },
      { title: "Sono ruim", body: "Pernas inquietas,\nsono picado sem motivo." },
      { title: "Performance trava", body: "Falta ar no exercício\nque você fazia fácil." }
    ],
    iconAssets: [
      path.join(RUN_DIR, "icon-brain.png"),
      path.join(RUN_DIR, "icon-hair.png"),
      path.join(RUN_DIR, "icon-sleep.png"),
      path.join(RUN_DIR, "icon-exercise.png")
    ]
  });
}

async function renderSlide4() {
  return renderCardListSlide({
    outName: "slide-4-como-elevar.png",
    headLine1: "Como elevar",
    headLine2Italic: "sua ferritina.",
    sub: "Quatro alavancas que mudam o estoque.",
    items: [
      { title: "Ferro heme", body: "Carnes vermelhas, fígado,\novos. Biodisponibilidade real." },
      { title: "Vitamina C junto", body: "Cítricos na refeição\ndobram a absorção." },
      { title: "Timing dos supps", body: "Suplemento em jejum,\nlonge de café e cálcio." },
      { title: "Investigue a raiz", body: "H. pylori, menstruação,\ncelíaca silenciosa." }
    ],
    iconAssets: [
      path.join(RUN_DIR, "icon-redmeat.png"),
      path.join(RUN_DIR, "icon-vitc.png"),
      path.join(RUN_DIR, "icon-supplement.png"),
      path.join(RUN_DIR, "icon-root.png")
    ],
    numbered: true
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SLIDE 5 — BLOQUEADORES SILENCIOSOS: 3 X-marks
// ═══════════════════════════════════════════════════════════════════════════
async function renderSlide5() {
  let svg = `<rect width="${W}" height="${H}" fill="${BG_TAUPE}"/>`;

  // Headline subido (consistente com S3/S4 ajustados)
  const headY = 110;
  svg += `<text x="${W/2}" y="${headY}" font-family="Inter, sans-serif" font-size="62" font-weight="300" fill="${WHITE}" text-anchor="middle" letter-spacing="-2">Bloqueadores</text>`;
  svg += `<text x="${W/2}" y="${headY + 68}" font-family="Georgia, serif" font-style="italic" font-size="62" font-weight="400" fill="${WHITE}" text-anchor="middle" letter-spacing="-1">silenciosos.</text>`;
  svg += `<text x="${W/2}" y="${headY + 130}" font-family="Inter, sans-serif" font-size="22" font-weight="400" fill="${WHITE_SOFT}" text-anchor="middle">Hábitos que mantêm sua ferritina no chão.</text>`;

  const items = [
    { title: "Café e chá nas refeições", body: "Taninos bloqueiam até 60%\nda absorção do ferro heme." },
    { title: "Inflamação crônica", body: "Hepcidina alta sequestra\no ferro nos macrófagos." },
    { title: "Má absorção intestinal", body: "Disbiose, celíaca silenciosa,\nH. pylori roubando estoque." }
  ];

  // Centralização: mesmo padrão de S3/S4 — X dentro de círculo outline
  const circleD = 130;          // diâmetro igual aos icons de S3/S4 → coesão
  const xInnerSize = 64;        // X interno (50% do diâmetro pra dar respiro)
  const iconGap = 44;
  const textBlockW = 530;
  const groupW = circleD + iconGap + textBlockW;
  const groupX = (W - groupW) / 2;
  const circleX = groupX;
  const textX = groupX + circleD + iconGap;

  // Items começam logo após o sub (paridade com S3/S4)
  const startY = 330;
  const itemH = 195;
  const gap = 28;

  for (let i = 0; i < items.length; i++) {
    const y = startY + i * (itemH + gap);
    const cx = circleX + circleD/2;
    const cy = y + circleD/2;

    // Círculo outline (rimar com os icons fotográficos de S3/S4)
    svg += `<circle cx="${cx}" cy="${cy}" r="${circleD/2}" fill="none" stroke="${WHITE}" stroke-width="1.5" opacity="0.85"/>`;
    // X interno mais forte
    const half = xInnerSize/2;
    svg += `<line x1="${cx - half}" y1="${cy - half}" x2="${cx + half}" y2="${cy + half}" stroke="${WHITE}" stroke-width="4" stroke-linecap="round"/>`;
    svg += `<line x1="${cx + half}" y1="${cy - half}" x2="${cx - half}" y2="${cy + half}" stroke="${WHITE}" stroke-width="4" stroke-linecap="round"/>`;

    // Texto alinhado verticalmente com o centro do círculo
    const titleY = cy - 12;
    svg += `<text x="${textX}" y="${titleY}" font-family="Inter, sans-serif" font-size="32" font-weight="500" fill="${WHITE}" letter-spacing="-0.5">${esc(items[i].title)}</text>`;
    const bodyLines = items[i].body.split("\n");
    bodyLines.forEach((ln, k) => {
      svg += `<text x="${textX}" y="${titleY + 36 + k * 30}" font-family="Inter, sans-serif" font-size="22" font-weight="400" fill="${WHITE_SOFT}">${esc(ln)}</text>`;
    });

    if (i < items.length - 1) {
      const dy = y + itemH + gap/2;
      svg += `<line x1="${groupX}" y1="${dy}" x2="${groupX + groupW}" y2="${dy}" stroke="${WHITE}" stroke-width="0.5" opacity="0.2"/>`;
    }
  }

  // Fechamento editorial italic Georgia — fecha o bottom dead-space (era 310px)
  // Posição: ~165px acima do logo top (y ~1080 design space)
  const closingY = startY + (items.length - 1) * (itemH + gap) + itemH + 80;
  svg += `<text x="${W/2}" y="${closingY}" font-family="Georgia, serif" font-style="italic" font-size="26" font-weight="400" fill="${WHITE}" text-anchor="middle">O que entra pelo prato sai pela rotina.</text>`;

  const base = await sharp(Buffer.from(svgWrap(svg))).png().toBuffer();
  const withLogo = await compositeLogo(base);
  fs.writeFileSync(path.join(RUN_DIR, "slide-5-bloqueadores.png"), withLogo);
  console.log("✓ slide-5-bloqueadores.png");
}

// ─── Run all ──────────────────────────────────────────────────────────────────
console.log(`🎨 Renderizando carrossel FERRITINA · OUT ${OUT_W}×${OUT_H} · design ${W}×${H}\n`);
await renderSlide1();
await renderSlide2();
await renderSlide3();
await renderSlide4();
await renderSlide5();
console.log("\n✓ Carrossel completo em", RUN_DIR);
