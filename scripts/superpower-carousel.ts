/**
 * superpower-carousel.ts — Longevify × Superpower
 * Stack: Imagen 4 (fundo) + sharp/SVG (layout) + logo real
 * npm run carousel
 */

import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT    = path.resolve(__dirname, "..");
const W = 1080, H = 1350;

const LOGO    = path.join(ROOT, "assets/logo-horizontal-white.png");
const FONTS   = path.join(ROOT, "assets/fonts");
const OUT     = path.join(ROOT, "output/stories");
fs.mkdirSync(OUT, { recursive: true });

// ── Fonts ──────────────────────────────────────────────────────────────────
function b64(name: string) {
  return fs.readFileSync(path.join(FONTS, name)).toString("base64");
}
const CSS = `
  @font-face{font-family:'DM';font-weight:300;src:url('data:font/ttf;base64,${b64("DMSans-Light.ttf")}')}
  @font-face{font-family:'DM';font-weight:400;src:url('data:font/ttf;base64,${b64("DMSans-Regular.ttf")}')}
  @font-face{font-family:'DM';font-weight:500;src:url('data:font/ttf;base64,${b64("DMSans-Medium.ttf")}')}
`;

// ── Logo ───────────────────────────────────────────────────────────────────
async function logo(w = 140): Promise<{ buf: Buffer; w: number; h: number }> {
  const m = await sharp(LOGO).metadata();
  const h = Math.round(w * (m.height! / m.width!));
  const buf = await sharp(LOGO).resize(w, h).png().toBuffer();
  return { buf, w, h };
}

// ── Imagen 4 ───────────────────────────────────────────────────────────────
async function imagen4(prompt: string, ratio = "9:16"): Promise<Buffer> {
  const key = process.env.GOOGLE_API_KEY!;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { sampleCount: 1, aspectRatio: ratio, personGeneration: "dont_allow" },
      }),
    }
  );
  const json = await res.json() as any;
  if (!res.ok) throw new Error(JSON.stringify(json.error));
  return Buffer.from(json.predictions[0].bytesBase64Encoded, "base64");
}

// ── Circle diagram ─────────────────────────────────────────────────────────
interface Cat { label: string; angle: number }

function pt(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function circle(cats: Cat[], cx: number, cy: number, R: number, color = "rgba(255,255,255,0.5)"): string {
  const LABEL_R = R + 65;
  const FS = 20;

  const dots = cats.map(({ angle }) => {
    const p = pt(cx, cy, R, angle);
    return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="6"
      fill="none" stroke="${color}" stroke-width="1.5"/>`;
  }).join("\n");

  const labels = cats.map(({ label, angle }) => {
    const p = pt(cx, cy, LABEL_R, angle);
    const a = ((angle % 360) + 360) % 360;
    const anchor = a > 20 && a < 160 ? "start" : a > 200 && a < 340 ? "end" : "middle";

    // Split label into max 2 lines
    const words = label.split(" ");
    let l1 = label, l2 = "";
    if (label.length > 15 && words.length > 1) {
      const mid = Math.ceil(words.length / 2);
      l1 = words.slice(0, mid).join(" ");
      l2 = words.slice(mid).join(" ");
    }

    const y = l2 ? p.y - FS * 0.6 : p.y + FS * 0.35;
    return `<text x="${p.x.toFixed(1)}" y="${y.toFixed(1)}"
      font-family="DM" font-weight="400" font-size="${FS}"
      fill="white" fill-opacity="0.85" text-anchor="${anchor}" letter-spacing="1.5">
      <tspan x="${p.x.toFixed(1)}">${l1}</tspan>
      ${l2 ? `<tspan x="${p.x.toFixed(1)}" dy="${FS * 1.3}">${l2}</tspan>` : ""}
    </text>`;
  }).join("\n");

  return `
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${color}" stroke-width="0.8"/>
    ${dots}${labels}`;
}

// ── Build slide from SVG (gradient bg) ────────────────────────────────────
async function buildSlide(svg: string, outPath: string) {
  const lg = await logo(150);
  const logoX = Math.round((W - lg.w) / 2);

  await sharp(Buffer.from(svg))
    .composite([{ input: lg.buf, top: 52, left: logoX, blend: "over" }])
    .jpeg({ quality: 94 })
    .toFile(outPath);
}

// ── SLIDE 1: Cover ─────────────────────────────────────────────────────────
async function slide1() {
  const p = path.join(OUT, "carousel-01-cover.jpg");
  if (fs.existsSync(p)) { console.log("  ⏭  slide 1"); return; }

  console.log("  🎨 Imagen 4 → fundo slide 1...");

  const prompt = `Abstract extreme macro photography of human skin texture seen at microscopic level. Warm beige and sienna tones, smooth organic surface with subtle micro-texture. Pure black background. The organic form fills the left two-thirds of the frame, right third is pure black negative space. Studio directional light from upper-left. Cinematic premium health editorial. No faces, no recognizable body parts, purely abstract warm texture. Film grain, shallow depth of field. 9:16 vertical.`;

  const raw = await imagen4(prompt, "9:16");

  const bioLeft = [
    "PONTUAÇÃO DE IDADE","RITMO DE ENVELHECIMENTO","HEALTH SCORE",
    "CREATINA QUINASE (CK)","LIPOPROTEÍNA (A)","APOLIPOPROTEÍNA B (APOB)",
    "TRIGLICERÍDEOS","LDL COLESTEROL","HDL COLESTEROL","COLESTEROL / HDL RATIO",
    "COLESTEROL TOTAL","VLDL COLESTEROL","TSH","TIROXINA (T4), LIVRE",
    "TRIIODOTIRONINA (T3), LIVRE","PROLACTINA","NEUTRÓFILOS","MONÓCITOS",
    "LEUCÓCITOS TOTAIS (WBC)","BASÓFILOS","LINFÓCITOS","EOSINÓFILOS",
    "TESTOSTERONA TOTAL","ESTRADIOL (E2)","CORTISOL","TESTOSTERONA, LIVRE",
    "PROGESTERONA","HORMÔNIO LUTEINIZANTE (LH)","ÁCIDO ÚRICO","GLICOSE",
  ];
  const bioRight = [
    "CREATINA KINASE (KS)","LIPOPROTEÍNA (A)","APOB","TRIGLICERÍDEOS",
    "LDL COLESTEROL","HDL COLESTEROL","COLESTEROL / HDL RATIO","COLESTEROL TOTAL",
    "VLDL COLESTEROL","TSH","TIROXINA (T4), LIVRE","TRIIODOTIRONINA (T3), LIVRE",
    "PROLACTINA","NEUTRÓFILOS","MONÓCITOS","LEUCÓCITOS TOTAIS (WBC)","BASÓFILOS",
    "LINFÓCITOS","EOSINÓFILOS","TESTOSTERONA TOTAL","ESTRADIOL (E2)","CORTISOL",
    "TESTOSTERONA, LIVRE","PROGESTERONA","ÁCIDO ÚRICO","HEMOGLOBINA A1C (HBA1C)",
    "GLICOSE","INSULINA","VITAMINA B12","FERRITINA",
  ];

  const scatter = (items: string[], x: number, align: string) =>
    items.map((t, i) => `<text x="${x}" y="${55 + i * 36}"
      font-family="DM" font-weight="300" font-size="20" text-anchor="${align}"
      fill="white" fill-opacity="0.55" letter-spacing="0.3">${t}</text>`).join("\n");

  const overlay = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <style>${CSS}</style>
      <linearGradient id="vgr" x1="0" y1="0" x2="0" y2="1">
        <stop offset="60%" stop-color="black" stop-opacity="0"/>
        <stop offset="100%" stop-color="black" stop-opacity="0.8"/>
      </linearGradient>
    </defs>
    ${scatter(bioLeft, 18, "start")}
    ${scatter(bioRight, W - 18, "end")}
    <rect width="${W}" height="${H}" fill="url(#vgr)"/>
    <text x="${W/2}" y="${H - 120}" font-family="DM" font-weight="500" font-size="80"
      fill="white" text-anchor="middle" letter-spacing="-1">O que você testa?</text>
  </svg>`;

  const lg = await logo(150);
  await sharp(raw)
    .resize(W, H, { fit: "cover", position: "top" })
    .composite([
      { input: Buffer.from(overlay), blend: "over" },
      { input: lg.buf, top: 52, left: Math.round((W - lg.w) / 2), blend: "over" },
    ])
    .jpeg({ quality: 94 })
    .toFile(p);
  console.log("  ✅ carousel-01-cover.jpg");
}

// ── SLIDES 2–4: Circle diagrams ────────────────────────────────────────────
interface SlideConfig {
  file: string;
  title: string[];
  sub: string;
  bodyLines: string[];
  cats: Cat[];
  grad: [string, string];
  dotColor?: string;
}

async function buildCircleSlide(cfg: SlideConfig) {
  const p = path.join(OUT, cfg.file);
  if (fs.existsSync(p)) { console.log(`  ⏭  ${cfg.file}`); return; }
  console.log(`  🖼  ${cfg.file}...`);

  // Layout constants
  const LOGO_AREA   = 110;   // top reserved for logo
  const HEADER_TOP  = LOGO_AREA + 20;
  const cx = W / 2;
  const cy = LOGO_AREA + 650;  // circle center, leaving room for header
  const R  = 260;              // safe radius that fits within W

  const titleLines = cfg.title.map((t, i) =>
    `<text x="55" y="${HEADER_TOP + i * 82}"
      font-family="DM" font-weight="500" font-size="78" fill="white">${t}</text>`
  ).join("\n");

  const subY = HEADER_TOP + cfg.title.length * 82 + 4;
  const bodyX = 580;
  const bodyLines = cfg.bodyLines.map((l, i) =>
    `<text x="${bodyX}" y="${HEADER_TOP + i * 36}"
      font-family="DM" font-weight="300" font-size="27" fill="white" fill-opacity="0.9">${l}</text>`
  ).join("\n");

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <style>${CSS}</style>
      <radialGradient id="g" cx="55%" cy="30%" r="75%">
        <stop offset="0%" stop-color="${cfg.grad[0]}"/>
        <stop offset="100%" stop-color="${cfg.grad[1]}"/>
      </radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>

    <!-- Logo placeholder space: top ${LOGO_AREA}px -->

    ${titleLines}
    <text x="55" y="${subY}" font-family="DM" font-weight="300" font-size="26"
      fill="white" fill-opacity="0.6">${cfg.sub}</text>

    ${bodyLines}

    ${circle(cfg.cats, cx, cy, R, cfg.dotColor ?? "rgba(255,255,255,0.55)")}
  </svg>`;

  await buildSlide(svg, p);
  console.log(`  ✅ ${cfg.file}`);
}

// ── SLIDE 5: Diagnostics grid ──────────────────────────────────────────────
async function slide5() {
  const p = path.join(OUT, "carousel-05-diagnostics.jpg");
  if (fs.existsSync(p)) { console.log("  ⏭  slide 5"); return; }
  console.log("  🖼  Slide 5 — Diagnósticos...");

  const thumbDefs = [
    { label: "MICROBIOMA INTESTINAL", prompt: "Extreme macro of glowing bioluminescent bacteria spheres, vivid orange-red, on pure black. Photorealistic 3D scientific." },
    { label: "METAIS PESADOS",        prompt: "Extreme macro of sharp metallic crystal formations, cold silver-blue, on pure black. Abstract scientific." },
    { label: "TOXINAS AMBIENTAIS",    prompt: "Extreme macro of translucent purple and green molecular structures, on black. Cinematic abstract." },
    { label: "RASTREIO ONCOLÓGICO",   prompt: "Extreme macro of deep red and burgundy organic cell formation on dark background. Premium scientific." },
  ];

  const CARD_W = 460, CARD_H = 300, LABEL_H = 58;

  const thumbs: Buffer[] = [];
  for (let i = 0; i < thumbDefs.length; i++) {
    const cache = path.join(OUT, `_thumb-${i}.jpg`);
    if (fs.existsSync(cache)) {
      thumbs.push(fs.readFileSync(cache));
      console.log(`    ⏭  thumb ${i+1}`);
    } else {
      console.log(`    🎨 thumb ${i+1}...`);
      const buf = await imagen4(thumbDefs[i].prompt, "1:1");
      fs.writeFileSync(cache, buf);
      thumbs.push(buf);
    }
  }

  const resized = await Promise.all(
    thumbs.map(b => sharp(b).resize(CARD_W, CARD_H, { fit: "cover" }).jpeg({ quality: 85 }).toBuffer())
  );

  // Card positions in grid
  const MARGIN = 40, GAP = 20;
  const positions = [
    { x: MARGIN,              y: 310 },
    { x: MARGIN + CARD_W + GAP, y: 310 },
    { x: MARGIN,              y: 310 + CARD_H + LABEL_H + GAP },
    { x: MARGIN + CARD_W + GAP, y: 310 + CARD_H + LABEL_H + GAP },
  ];

  const bgSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <style>${CSS}</style>
      <radialGradient id="g" cx="50%" cy="30%" r="80%">
        <stop offset="0%" stop-color="#c07820"/>
        <stop offset="100%" stop-color="#5a2a05"/>
      </radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
    <text x="55" y="180" font-family="DM" font-weight="500" font-size="72" fill="white">Diagnósticos</text>
    <text x="55" y="260" font-family="DM" font-weight="500" font-size="72" fill="white">Avançados</text>
    <text x="55" y="295" font-family="DM" font-weight="300" font-size="24" fill="white" fill-opacity="0.6">Add-on exclusivo para membros</text>
  </svg>`;

  const cards: sharp.OverlayOptions[] = [];
  for (let i = 0; i < 4; i++) {
    const label = thumbDefs[i].label;
    const labelSvg = `<svg width="${CARD_W}" height="${LABEL_H}" xmlns="http://www.w3.org/2000/svg">
      <defs><style>${CSS}</style></defs>
      <rect width="${CARD_W}" height="${LABEL_H}" fill="white"/>
      <text x="16" y="${LABEL_H * 0.65}" font-family="DM" font-weight="400" font-size="18"
        fill="#111" letter-spacing="1.5">${label}</text>
    </svg>`;

    const card = await sharp({
      create: { width: CARD_W, height: CARD_H + LABEL_H, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } }
    }).png()
      .composite([
        { input: resized[i], top: 0, left: 0 },
        { input: Buffer.from(labelSvg), top: CARD_H, left: 0 },
      ])
      .png().toBuffer();

    cards.push({ input: card, top: positions[i].y, left: positions[i].x });
  }

  const lg = await logo(150);
  await sharp(Buffer.from(bgSvg))
    .composite([
      ...cards,
      { input: lg.buf, top: 52, left: Math.round((W - lg.w) / 2), blend: "over" },
    ])
    .jpeg({ quality: 94 })
    .toFile(p);
  console.log("  ✅ carousel-05-diagnostics.jpg");
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n🎠 Longevify Carousel");
  console.log("─".repeat(50));

  await slide1();

  await buildCircleSlide({
    file: "carousel-02-base.jpg",
    title: ["Painel Base"],
    sub: "Incluso no plano anual",
    bodyLines: ["1 exame anual com 100+","biomarcadores para uma","visão completa da sua saúde."],
    grad: ["#4a5e30", "#141f0a"],
    cats: [
      { label: "ENERGIA",           angle: 0   },
      { label: "SAÚDE IMUNE",       angle: 36  },
      { label: "SAÚDE TIREÓIDE",    angle: 72  },
      { label: "HORMÔNIOS SEXUAIS", angle: 108 },
      { label: "SAÚDE HEPÁTICA",    angle: 144 },
      { label: "INFLAMAÇÃO",        angle: 180 },
      { label: "NUTRIENTES",        angle: 216 },
      { label: "SAÚDE METABÓLICA",  angle: 252 },
      { label: "SAÚDE RENAL",       angle: 288 },
      { label: "SAÚDE CARDÍACA",    angle: 324 },
    ],
  });

  await buildCircleSlide({
    file: "carousel-03-advanced.jpg",
    title: ["Painel Avançado"],
    sub: "Upgrade disponível",
    bodyLines: ["1 exame anual com 130+","biomarcadores — cobertura","expandida com composição","corporal e saúde do DNA."],
    grad: ["#c06020", "#5a1a05"],
    dotColor: "rgba(255,220,160,0.7)",
    cats: [
      { label: "ENERGIA",             angle: 0   },
      { label: "SAÚDE IMUNE",         angle: 36  },
      { label: "SAÚDE TIREÓIDE",      angle: 72  },
      { label: "HORMÔNIOS SEXUAIS+",  angle: 108 },
      { label: "SAÚDE HEPÁTICA",      angle: 144 },
      { label: "INFLAMAÇÃO",          angle: 180 },
      { label: "NUTRIENTES+",         angle: 216 },
      { label: "SAÚDE METABÓLICA",    angle: 252 },
      { label: "SAÚDE RENAL",         angle: 288 },
      { label: "SAÚDE CARDÍACA+",     angle: 324 },
    ],
  });

  await buildCircleSlide({
    file: "carousel-04-specialty.jpg",
    title: ["Painéis", "Especializados"],
    sub: "Add-on exclusivo para membros",
    bodyLines: ["5 pacotes focados em","insights específicos para","seus objetivos de saúde."],
    grad: ["#2a4a48", "#091818"],
    dotColor: "rgba(91,174,158,0.9)",
    cats: [
      { label: "AUTOIMUNIDADE &amp; CELÍACA",   angle: 0   },
      { label: "FERTILIDADE",                   angle: 72  },
      { label: "NUTRIENTES &amp; ANTIOXIDANTES",angle: 144 },
      { label: "CARDIOVASCULAR AVANÇADO",       angle: 216 },
      { label: "METILAÇÃO",                     angle: 288 },
    ],
  });

  await slide5();

  console.log("\n✅ output/stories/");
}

main().catch(e => { console.error("\n❌", e.message); process.exit(1); });
