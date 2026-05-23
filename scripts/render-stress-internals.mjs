// Renderiza slides internos do carrossel ESTRESSE (3 a 7) seguindo layout SP
// Estética: warm taupe bg, número grande topo, title Inter, body Inter regular, footer monospace, logo 25%

import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";

const W = 1080, H = 1350;
const BG = "#BBB4A2";              // Taupe médio (entre #D8D2C5 cream e #A29B89)
const HEAD = "#1C3F3A";            // Forest dark pro número + title
const BODY = "#4A453E";            // Cinza dark warm pro body
const FOOTER = "#1C3F3A";          // Forest dark pro footer monospace
const PILL_BORDER = "#1C3F3A";     // Outline pill (slide 7)

const RUN_DIR = "/Users/mathe/Documents/Longev/Brand/Longevify/content-machine/runs/2026-05-21-022-your-stress-response-system-has-bm/assets";
const FOOTER_TEXT = "PROTOCOLO DE RESET DO CORTISOL";

// Helpers
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

const wrap = (text, max) => {
  const segs = text.split("\n");
  const out = [];
  for (const seg of segs) {
    const words = seg.split(/\s+/);
    let cur = "";
    for (const w of words) {
      if ((cur + " " + w).trim().length <= max) cur = (cur + " " + w).trim();
      else { if (cur) out.push(cur); cur = w; }
    }
    if (cur) out.push(cur);
  }
  return out;
};

// Render slide standard (3-6): número + title + body
async function renderStandardSlide(num, title, body, outPath) {
  const padX = 100;
  const numXml = `<text x="${W/2}" y="200" font-family="Inter, Helvetica, Arial, sans-serif" font-size="110" font-weight="500" fill="${HEAD}" text-anchor="middle" letter-spacing="-3">${esc(num)}</text>`;

  // Title centralizado VERTICALMENTE no canvas — sobe pra ~y=540 (40% do canvas)
  const titleLines = wrap(title, 22);
  const titleFont = 62;
  const titleStartY = 540;
  const titleXml = titleLines.map((ln, i) =>
    `<text x="${W/2}" y="${titleStartY + i * titleFont * 1.1}" font-family="Inter, Helvetica, Arial, sans-serif" font-size="${titleFont}" font-weight="500" fill="${HEAD}" text-anchor="middle" letter-spacing="-1.5">${esc(ln)}</text>`
  ).join("");

  // Body centralizado, multi-line wrapped — começa ~70px depois do title
  const bodyLines = wrap(body, 38);
  const bodyFont = 30;
  const bodyStartY = titleStartY + titleLines.length * titleFont * 1.1 + 70;
  const bodyXml = bodyLines.map((ln, i) =>
    `<text x="${W/2}" y="${bodyStartY + i * bodyFont * 1.45}" font-family="Inter, Helvetica, Arial, sans-serif" font-size="${bodyFont}" font-weight="400" fill="${BODY}" text-anchor="middle">${esc(ln)}</text>`
  ).join("");

  // Footer monospace caps embaixo (acima logo) — sobe pra dar mais respiro do body
  const footerY = H - 250;
  const footerXml = `<text x="${W/2}" y="${footerY}" font-family="Courier New, Courier, monospace" font-size="22" font-weight="500" fill="${FOOTER}" text-anchor="middle" letter-spacing="3">${FOOTER_TEXT}</text>`;

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" fill="${BG}"/>
    ${numXml}${titleXml}${bodyXml}${footerXml}
  </svg>`;

  let img = sharp(Buffer.from(svg));

  // Logo bottom-center 25% width — DARK forest (tinted da branca)
  const LOGO = "/Users/mathe/Documents/Longev/Brand/Longevify/content-machine/assets/logo-horizontal-white.png";
  const trimmed = await sharp(LOGO).trim().toBuffer({ resolveWithObject: true });
  const cropH = Math.round(trimmed.info.height * 0.78);
  const wordmark = await sharp(trimmed.data).extract({ left: 0, top: 0, width: trimmed.info.width, height: cropH }).toBuffer();
  const logoW = Math.round(W * 0.25);
  const logoResized = await sharp(wordmark).resize(logoW).toBuffer();
  // Logo BRANCA (consistente com capa) — sem tint
  const tinted = logoResized;
  const logoMeta = await sharp(tinted).metadata();
  const logoX = Math.round((W - logoW) / 2);
  const logoY = Math.round(H - (logoMeta.height ?? 80) - 90);
  const baseBuf = await img.png().toBuffer();
  img = sharp(baseBuf).composite([{ input: tinted, left: logoX, top: logoY }]);

  await img.png().toFile(outPath);
  console.log(`✓ ${path.basename(outPath)}`);
}

// Render slide adaptogens (slide 7): número + title + 2 cards com number-first hierarchy
async function renderAdaptogensSlide(num, title, items, outPath) {
  const numXml = `<text x="${W/2}" y="180" font-family="Inter, Helvetica, Arial, sans-serif" font-size="100" font-weight="500" fill="${HEAD}" text-anchor="middle" letter-spacing="-3">${esc(num)}</text>`;

  const titleFont = 48;
  const titleY = 370;
  const titleXml = `<text x="${W/2}" y="${titleY}" font-family="Inter, Helvetica, Arial, sans-serif" font-size="${titleFont}" font-weight="500" fill="${HEAD}" text-anchor="middle" letter-spacing="-1.5">${esc(title)}</text>`;

  // Pills refinados: tamanho médio, respiro entre cards, body sob
  let pillsXml = "";
  let startY = 490;
  const cardSpacing = 70;
  for (const it of items) {
    // Pill outlined
    const pillTextW = it.name.length * 14;
    const pillW = Math.max(440, pillTextW + 90);
    const pillH = 58;
    const pillX = (W - pillW) / 2;
    pillsXml += `
      <rect x="${pillX}" y="${startY}" width="${pillW}" height="${pillH}" rx="${pillH/2}" fill="none" stroke="#f8fffc" stroke-width="1.5" opacity="0.95"/>
      <text x="${W/2}" y="${startY + pillH/2 + 8}" font-family="Courier New, Courier, monospace" font-size="22" font-weight="500" fill="#f8fffc" text-anchor="middle" letter-spacing="2.5">${esc(it.name.toUpperCase())}</text>
    `;
    // Body sob pill
    const bodyLines = wrap(it.body, 36);
    const bodyFont = 26;
    const bodyY = startY + pillH + 50;
    bodyLines.forEach((ln, i) => {
      pillsXml += `<text x="${W/2}" y="${bodyY + i * bodyFont * 1.4}" font-family="DM Sans, Inter, Helvetica, sans-serif" font-size="${bodyFont}" font-weight="400" fill="${BODY}" text-anchor="middle">${esc(ln)}</text>`;
    });
    startY = bodyY + bodyLines.length * bodyFont * 1.4 + cardSpacing;
  }

  // Footer monospace
  const footerY = H - 230;
  const footerXml = `<text x="${W/2}" y="${footerY}" font-family="Courier New, Courier, monospace" font-size="24" font-weight="500" fill="${FOOTER}" text-anchor="middle" letter-spacing="3">${FOOTER_TEXT}</text>`;

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" fill="${BG}"/>
    ${numXml}${titleXml}${pillsXml}${footerXml}
  </svg>`;

  let img = sharp(Buffer.from(svg));

  // Logo BRANCA (consistente com capa) — sem tint
  const LOGO = "/Users/mathe/Documents/Longev/Brand/Longevify/content-machine/assets/logo-horizontal-white.png";
  const trimmed = await sharp(LOGO).trim().toBuffer({ resolveWithObject: true });
  const cropH = Math.round(trimmed.info.height * 0.78);
  const wordmark = await sharp(trimmed.data).extract({ left: 0, top: 0, width: trimmed.info.width, height: cropH }).toBuffer();
  const logoW = Math.round(W * 0.25);
  const logoResized = await sharp(wordmark).resize(logoW).toBuffer();
  const tinted = logoResized; // BRANCA, sem tint
  const logoMeta = await sharp(tinted).metadata();
  const logoX = Math.round((W - logoW) / 2);
  const logoY = Math.round(H - (logoMeta.height ?? 80) - 90);
  const baseBuf = await img.png().toBuffer();
  img = sharp(baseBuf).composite([{ input: tinted, left: logoX, top: logoY }]);

  await img.png().toFile(outPath);
  console.log(`✓ ${path.basename(outPath)}`);
}

// ─── Specs ────────────────────────────────────────────────────────────────────
const slides = [
  {
    num: "01",
    type: "standard",
    title: "Mova o treino",
    body: "Treino intenso à noite eleva cortisol quando ele já deveria estar descendo. Mova as sessões intensas pra antes das 10h e use o pico fisiológico a seu favor.",
    out: "slide-3.png",
  },
  {
    num: "02",
    type: "standard",
    title: "Cafeína tem hora",
    body: "Cortisol e cafeína fazem o mesmo trabalho: acordar o sistema. Combinar os dois depois do meio-dia adia o sono profundo e mantém o eixo HPA ligado quando deveria desligar.",
    out: "slide-4.png",
  },
  {
    num: "03",
    type: "standard",
    title: "Acorde no mesmo horário",
    body: "Variar o horário de acordar — incluindo fim de semana — quebra o ritmo diurno do cortisol. Wake time consistente é a intervenção mais efetiva pra restaurar a curva.",
    out: "slide-5.png",
  },
  {
    num: "04",
    type: "standard",
    title: "Luz natural cedo",
    body: "Luz solar direta nos olhos nos primeiros 30 minutos depois de acordar ativa o pico saudável de cortisol matinal e calibra a queda diurna. O input mais barato e subestimado.",
    out: "slide-6.png",
  },
  {
    num: "05",
    type: "adaptogens",
    title: "Adaptógenos com evidência.",
    items: [
      { name: "Ashwagandha KSM-66", body: "reduz cortisol 27–30% em RCTs duplo-cego" },
      { name: "Rhodiola Rosea", body: "reduz reatividade do cortisol ao estresse agudo" },
    ],
    out: "slide-7.png",
  },
];

console.log(`🎨 Renderizando 5 slides internos ESTRESSE (3-7)...`);
for (const s of slides) {
  const outPath = path.join(RUN_DIR, s.out);
  if (s.type === "adaptogens") {
    await renderAdaptogensSlide(s.num, s.title, s.items, outPath);
  } else {
    await renderStandardSlide(s.num, s.title, s.body, outPath);
  }
}
console.log(`\n✓ Done · ${RUN_DIR}`);
