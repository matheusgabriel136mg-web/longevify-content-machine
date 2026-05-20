/**
 * mito-style-video.ts — UI de mensagem estilo Mito Concierge × Longevify
 *
 * Estrutura visual:
 *   • Fundo #000F08 (preto-floresta)
 *   • Logo Longevify horizontal no topo
 *   • Título serif + subtítulo DM Sans
 *   • Balão de chat escuro, cursor piscando, typewriter em DM Sans
 *   • Resposta surge abaixo do balão em teal
 *   • 3 ciclos de pergunta → resposta
 *
 * Uso:
 *   npm run mito-video
 */

import sharp from "sharp";
import { execSync } from "child_process";
import * as fs   from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT    = path.resolve(__dirname, "..");

const LOGO_PATH  = path.join(ROOT, "assets/logo-horizontal-white.png");
const FONTS_DIR  = path.join(ROOT, "assets/fonts");
const OUT_DIR    = path.join(ROOT, "output/videos");
const TMP_DIR    = "/tmp/mito-frames";

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

// ── Dimensões ─────────────────────────────────────────────────────────────────
const W = 1080, H = 1920, FPS = 24;

// ── Frames por fase ───────────────────────────────────────────────────────────
const F = {
  type:       54,   // 2.25s — digitação
  hold:       30,   // 1.25s — exibe pergunta completa
  erase:      18,   // 0.75s — apaga
  answerIn:   12,   // 0.5s  — resposta fade in
  answerHold: 48,   // 2.0s  — exibe resposta
  answerOut:  12,   // 0.5s  — resposta fade out
};                  // = 174 frames/ciclo × 3 = 522 + 60 intro/outro = 582

const INTRO  = 36;
const OUTRO  = 36;

// ── Cores ─────────────────────────────────────────────────────────────────────
const BG       = "#000F08";
const BUBBLE   = "#0c1f14";
const BORDER   = "#1a3a24";
const TEAL     = "#5BAE9E";
const TEXT_Q   = "#e8f5f0";
const TEXT_A   = "#5BAE9E";
const TEXT_SUB = "#4a7a66";

// ── Font base64 ───────────────────────────────────────────────────────────────
function fontB64(filename: string): string {
  return fs.readFileSync(path.join(FONTS_DIR, filename)).toString("base64");
}

const FONT_DEFS = () => `
  <defs>
    <style>
      @font-face {
        font-family: 'DMSans';
        font-weight: 300;
        src: url('data:font/ttf;base64,${fontB64("DMSans-Light.ttf")}');
      }
      @font-face {
        font-family: 'DMSans';
        font-weight: 400;
        src: url('data:font/ttf;base64,${fontB64("DMSans-Regular.ttf")}');
      }
      @font-face {
        font-family: 'DMSans';
        font-weight: 500;
        src: url('data:font/ttf;base64,${fontB64("DMSans-Medium.ttf")}');
      }
    </style>
  </defs>`;

// ── Conteúdo ──────────────────────────────────────────────────────────────────
const CYCLES = [
  { question: "Sempre cansado,\nserá que é normal?",   answer: "Cortisol: Mapeado."         },
  { question: "Névoa mental\né só cansaço?",            answer: "B12 e Ômega-3: Analisados." },
  { question: "Acordo exausto\ntodo dia, por quê?",     answer: "Sono profundo: Revelado."   },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function easeOut(t: number) { return t * (2 - t); }
function clamp(v: number)   { return Math.max(0, Math.min(1, v)); }

// ── SVG builders ──────────────────────────────────────────────────────────────

// Fundo + glow radial
function svgBg(glowOp = 0.10): string {
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
${FONT_DEFS()}
<rect width="${W}" height="${H}" fill="${BG}"/>
<radialGradient id="glow" cx="50%" cy="42%" r="35%">
  <stop offset="0%"   stop-color="${TEAL}" stop-opacity="${glowOp}"/>
  <stop offset="100%" stop-color="${TEAL}" stop-opacity="0"/>
</radialGradient>
<ellipse cx="${W/2}" cy="${H*0.42}" rx="${W*0.4}" ry="${H*0.18}" fill="url(#glow)"/>
</svg>`;
}

// Cabeçalho: "Sua saúde, a uma mensagem de distância" + separador
function svgHeader(op = 1): string {
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
${FONT_DEFS()}
<text x="${W/2}" y="${H*0.23}"
  font-family="DMSans" font-weight="300" font-size="34"
  fill="${TEXT_SUB}" fill-opacity="${op}" text-anchor="middle" letter-spacing="1">
  Sua saúde, a uma mensagem de distância.
</text>
</svg>`;
}

// Balão de chat com pergunta typewriter
function svgBubble(question: string, charCount: number, cursor: boolean, op = 1): string {
  const visible = question.slice(0, charCount);
  const lines   = visible.split("\n");

  const BW = 860, BH = 200;
  const BX = (W - BW) / 2;
  const BY = H * 0.30;
  const PAD = 44;
  const FS  = 52;
  const LH  = FS * 1.5;

  const startY = BY + PAD + FS;
  const tspans = lines.map((line, i) => {
    const isLast = i === lines.length - 1;
    return `<tspan x="${BX + PAD}" dy="${i === 0 ? 0 : LH}">${esc(line)}${isLast && cursor ? `<tspan fill="${TEAL}" fill-opacity="${op}">|</tspan>` : ""}</tspan>`;
  }).join("");

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
${FONT_DEFS()}
<rect x="${BX}" y="${BY}" width="${BW}" height="${BH}"
  rx="24" ry="24" fill="${BUBBLE}" fill-opacity="${op}"
  stroke="${BORDER}" stroke-opacity="${op}" stroke-width="1.5"/>
<text font-family="DMSans" font-weight="300" font-size="${FS}"
  fill="${TEXT_Q}" fill-opacity="${op}"
  y="${startY}">${tspans}</text>
</svg>`;
}

// Resposta abaixo do balão
function svgAnswer(text: string, op: number): string {
  const AY = H * 0.30 + 220;
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
${FONT_DEFS()}
<text x="${W/2}" y="${AY}"
  font-family="DMSans" font-weight="500" font-size="48"
  fill="${TEXT_A}" fill-opacity="${op}"
  text-anchor="middle" letter-spacing="2">
  ${esc(text)}
</text>
</svg>`;
}

// CTA final
function svgCta(op: number): string {
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
${FONT_DEFS()}
<text x="${W/2}" y="${H*0.42}"
  font-family="DMSans" font-weight="300" font-size="48"
  fill="${TEXT_Q}" fill-opacity="${op}" text-anchor="middle">
  Desbloqueie sua
</text>
<text x="${W/2}" y="${H*0.42 + 72}"
  font-family="DMSans" font-weight="500" font-size="48"
  fill="${TEXT_A}" fill-opacity="${op}" text-anchor="middle" letter-spacing="2">
  inteligência de saúde.
</text>
<text x="${W/2}" y="${H*0.42 + 160}"
  font-family="DMSans" font-weight="300" font-size="32"
  fill="${TEXT_SUB}" fill-opacity="${op * 0.7}" text-anchor="middle" letter-spacing="4">
  longevify.com.br
</text>
</svg>`;
}

// ── Composite + write ─────────────────────────────────────────────────────────

async function renderFrame(idx: number, svgLayers: string[], logoOp = 1): Promise<void> {
  const out = path.join(TMP_DIR, `frame-${String(idx).padStart(5, "0")}.png`);
  if (fs.existsSync(out)) return;

  const [base, ...rest] = svgLayers;
  const composites: sharp.OverlayOptions[] = rest.map(s => ({
    input: Buffer.from(s), blend: "over" as const,
  }));

  // Logo overlay (white, topo, com opacity)
  if (fs.existsSync(LOGO_PATH) && logoOp > 0) {
    const logoW = 320;
    const logoMeta = await sharp(LOGO_PATH).metadata();
    const logoH = Math.round(logoW * (logoMeta.height! / logoMeta.width!));
    const logoX = Math.round((W - logoW) / 2);
    const logoY = Math.round(H * 0.10);

    const logoBuffer = await sharp(LOGO_PATH)
      .resize(logoW, logoH)
      .ensureAlpha()
      .modulate({ brightness: 1 })
      .composite([{
        input: Buffer.from([0, 0, 0, Math.round(255 * logoOp)]),
        raw: { width: 1, height: 1, channels: 4 },
        tile: true,
        blend: "dest-in",
      }])
      .png()
      .toBuffer();

    composites.push({ input: logoBuffer, top: logoY, left: logoX, blend: "over" });
  }

  await sharp(Buffer.from(base), { density: 96 })
    .resize(W, H)
    .composite(composites)
    .png({ compressionLevel: 1 })
    .toFile(out);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const totalFrames = INTRO + CYCLES.length * Object.values(F).reduce((a,b)=>a+b,0) + OUTRO;
  console.log(`\n🎬 Mito-style Video — Longevify`);
  console.log(`─`.repeat(50));
  console.log(`   ${totalFrames} frames @ ${FPS}fps = ${(totalFrames/FPS).toFixed(1)}s`);

  let f = 0;

  // ── Intro ─────────────────────────────────────────────────────────────────
  process.stdout.write("\n  ⟳ Intro...");
  for (let i = 0; i < INTRO; i++, f++) {
    const t = easeOut(clamp(i / INTRO));
    await renderFrame(f, [svgBg(0.06 + 0.06 * t), svgHeader(t)], t);
  }
  console.log(" ✅");

  // ── Ciclos ────────────────────────────────────────────────────────────────
  for (const [ci, cycle] of CYCLES.entries()) {
    process.stdout.write(`\n  ⟳ Ciclo ${ci+1}...`);
    const total = cycle.question.length;

    for (let i = 0; i < F.type; i++, f++) {
      const chars = Math.ceil((i / F.type) * total);
      const cur   = (f % 14) < 7;
      await renderFrame(f, [svgBg(), svgHeader(), svgBubble(cycle.question, chars, cur)]);
    }
    for (let i = 0; i < F.hold; i++, f++) {
      const cur = (f % 14) < 7;
      await renderFrame(f, [svgBg(), svgHeader(), svgBubble(cycle.question, total, cur)]);
    }
    for (let i = 0; i < F.erase; i++, f++) {
      const chars = Math.ceil((1 - i / F.erase) * total);
      const op    = easeOut(clamp(1 - i / F.erase));
      await renderFrame(f, [svgBg(), svgHeader(), svgBubble(cycle.question, chars, false, op)]);
    }
    for (let i = 0; i < F.answerIn; i++, f++) {
      const op = easeOut(clamp(i / F.answerIn));
      await renderFrame(f, [svgBg(0.08 + 0.08 * op), svgHeader(), svgAnswer(cycle.answer, op)]);
    }
    for (let i = 0; i < F.answerHold; i++, f++) {
      await renderFrame(f, [svgBg(0.16), svgHeader(), svgAnswer(cycle.answer, 1)]);
    }
    for (let i = 0; i < F.answerOut; i++, f++) {
      const op = easeOut(clamp(1 - i / F.answerOut));
      await renderFrame(f, [svgBg(0.08 + 0.08 * op), svgHeader(), svgAnswer(cycle.answer, op)]);
    }
    console.log(` ✅ (frame ${f})`);
  }

  // ── Outro ─────────────────────────────────────────────────────────────────
  process.stdout.write("\n  ⟳ Outro (CTA)...");
  for (let i = 0; i < OUTRO; i++, f++) {
    const t = easeOut(clamp(i / (OUTRO * 0.7)));
    await renderFrame(f, [svgBg(0.06 + 0.06 * t), svgCta(t)], t);
  }
  console.log(` ✅`);

  console.log(`\n  Total: ${f} frames`);

  // ── Encode ────────────────────────────────────────────────────────────────
  console.log("\n✂️  Encoding com ffmpeg...");
  const ts  = new Date().toISOString().replace(/[:.]/g,"-").slice(0,19);
  const out = path.join(OUT_DIR, `${ts}-longevify-concierge.mp4`);

  execSync(
    `ffmpeg -y -framerate ${FPS} -i "${TMP_DIR}/frame-%05d.png" ` +
    `-c:v libx264 -pix_fmt yuv420p -crf 14 -movflags +faststart "${out}"`,
    { stdio: "pipe" }
  );

  console.log(`\n✅ Concluído!`);
  console.log(`📁 ${out}`);
}

main().catch(e => { console.error("\n❌", e.message); process.exit(1); });
