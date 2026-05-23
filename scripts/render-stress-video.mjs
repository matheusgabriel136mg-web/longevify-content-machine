// render-stress-video.mjs — slide 2 do carrossel ESTRESSE como MP4 4:5 (1080x1350)
// 12 quadros · 20s · paleta Longevify warm cream + forest dark + gold (NÃO pink)
// Output: runs/2026-05-21-022-.../assets/slide-2.mp4

import sharp from "sharp";
import * as fs from "fs";
import { execSync } from "child_process";
import * as path from "path";

const W = 1080, H = 1350;
const BG = "#BBB4A2";          // Warm taupe (mesmo do carrossel)
const CARD = "#F5F1EA";        // Off-white pra card
const HEAD = "#1C3F3A";        // Forest dark texto principal
const BODY = "#4A453E";        // Cinza warm body
const GOLD = "#C89136";        // Indicator dot (substitui pink)
const ACCENT = "#2D7A5C";      // Emerald sage pra slider track
const FOOTER_COL = "#1C3F3A";

const RUN_DIR = "/Users/mathe/Documents/Longev/Brand/Longevify/content-machine/runs/2026-05-21-022-your-stress-response-system-has-bm/assets";
const TMP_DIR = "/tmp/longevify-stress-video";
fs.mkdirSync(TMP_DIR, { recursive: true });

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

// Card "Cortisol · Indicador de estresse" — pode mostrar state alto / baixo / vazio
function cardXml(opts) {
  const { x, y, w, h, state = null } = opts;
  // state: null (vazio), "alto" (dot direita), "baixo" (dot esquerda)
  let inner = `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="${CARD}" stroke="${HEAD}" stroke-width="0.5" opacity="0.95"/>
    <text x="${x + 32}" y="${y + 56}" font-family="Inter, sans-serif" font-size="30" font-weight="500" fill="${HEAD}">Cortisol</text>
    <text x="${x + 32}" y="${y + 90}" font-family="Inter, sans-serif" font-size="20" font-weight="400" fill="${BODY}" opacity="0.85">Indicador de estresse</text>
  `;
  if (state) {
    // Slider track: 3 segments (low | mid | high) com cores: gold, sage, gold
    const trackY = y + h - 50;
    const trackX1 = x + w - 350;
    const trackX2 = x + w - 40;
    const trackLen = trackX2 - trackX1;
    // Linha tracejada (dashed) ligando "Alto"/"Baixo" texto até a posição do dot
    const labelX = x + w - 350 + 50;
    const labelText = state === "alto" ? "Alto" : "Baixo";
    inner += `<text x="${labelX}" y="${y + 64}" font-family="Inter, sans-serif" font-size="22" font-weight="500" fill="${HEAD}">${labelText}</text>`;

    // Dot position (alto = right, baixo = left)
    const dotX = state === "alto" ? trackX2 - 10 : trackX1 + 10;
    const dotY = trackY;
    // Dashed line from label to dot
    inner += `<line x1="${labelX + 60}" y1="${y + 60}" x2="${dotX}" y2="${dotY}" stroke="${GOLD}" stroke-width="1" stroke-dasharray="4,4" opacity="0.75"/>`;
    // Track segments
    inner += `
      <line x1="${trackX1}" y1="${trackY}" x2="${trackX1 + trackLen/3}" y2="${trackY}" stroke="${GOLD}" stroke-width="3" opacity="${state === 'baixo' ? 1 : 0.35}"/>
      <line x1="${trackX1 + trackLen/3}" y1="${trackY}" x2="${trackX1 + 2*trackLen/3}" y2="${trackY}" stroke="${ACCENT}" stroke-width="3" opacity="0.6"/>
      <line x1="${trackX1 + 2*trackLen/3}" y1="${trackY}" x2="${trackX2}" y2="${trackY}" stroke="${GOLD}" stroke-width="3" opacity="${state === 'alto' ? 1 : 0.35}"/>
      <circle cx="${dotX}" cy="${dotY}" r="8" fill="${GOLD}"/>
    `;
  }
  return inner;
}

function bodyTextXml(text, x, y, maxChars = 36) {
  const lines = wrap(text, maxChars);
  const font = 24;
  return lines.map((ln, i) =>
    `<text x="${x}" y="${y + i * font * 1.45}" font-family="DM Sans, Inter, sans-serif" font-size="${font}" font-weight="400" fill="${BODY}" text-anchor="middle">${esc(ln)}</text>`
  ).join("");
}

// HEADLINE: "Sinais de que seu cortisol está fora do eixo"
function headlineXml(y = 280) {
  const lines = ["Sinais de que", "seu cortisol", "está fora do eixo"];
  const font = 50;
  return lines.map((ln, i) =>
    `<text x="${W/2}" y="${y + i * font * 1.15}" font-family="Inter, Helvetica, sans-serif" font-size="${font}" font-weight="500" fill="${HEAD}" text-anchor="middle" letter-spacing="-1">${esc(ln)}</text>`
  ).join("");
}

function footerXml(visible = false) {
  if (!visible) return "";
  return `<text x="${W/2}" y="${H - 90}" font-family="Courier New, monospace" font-size="22" font-weight="500" fill="${FOOTER_COL}" text-anchor="middle" letter-spacing="2.5">PROTOCOLO DE REEQUILÍBRIO DO CORTISOL</text>`;
}

// LOGO branca bottom-center 25%
async function compositeLogo(buf) {
  const LOGO = "/Users/mathe/Documents/Longev/Brand/Longevify/content-machine/assets/logo-horizontal-white.png";
  const trimmed = await sharp(LOGO).trim().toBuffer({ resolveWithObject: true });
  const cropH = Math.round(trimmed.info.height * 0.78);
  const wordmark = await sharp(trimmed.data).extract({ left: 0, top: 0, width: trimmed.info.width, height: cropH }).toBuffer();
  const logoW = Math.round(W * 0.22); // ligeiramente menor pra caber com footer
  const logoBuf = await sharp(wordmark).resize(logoW).toBuffer();
  const logoMeta = await sharp(logoBuf).metadata();
  const logoX = Math.round((W - logoW) / 2);
  const logoY = Math.round(H - (logoMeta.height ?? 60) - 25);
  return sharp(buf).composite([{ input: logoBuf, left: logoX, top: logoY }]).png().toBuffer();
}

// ─── Renderiza um quadro específico ───────────────────────────────────────────
async function renderFrame(frameNum, outPath) {
  const cardW = 880;
  const cardH = 200;
  const cardX = (W - cardW) / 2;

  // CASCATA de estados por frame
  let svg = `<rect width="${W}" height="${H}" fill="${BG}"/>`;
  svg += headlineXml(280);

  // Frame 1: só headline
  // Frame 2: + card vazio
  // Frame 3-4: + card com "Alto"
  // Frame 5-6: + body alto sob card
  // Frame 7-8: card alterna pra "Baixo" + body baixo
  // Frame 9-12: 2 cards stacked (Alto + Baixo) com bodies + footer

  const cardY1 = 540; // card top
  const cardY2 = cardY1 + cardH + 200; // 2nd card abaixo (com body entre eles)

  if (frameNum === 1) {
    // só headline
  } else if (frameNum === 2) {
    svg += cardXml({ x: cardX, y: cardY1, w: cardW, h: cardH, state: null });
  } else if (frameNum === 3 || frameNum === 4) {
    svg += cardXml({ x: cardX, y: cardY1, w: cardW, h: cardH, state: "alto" });
  } else if (frameNum === 5 || frameNum === 6) {
    svg += cardXml({ x: cardX, y: cardY1, w: cardW, h: cardH, state: "alto" });
    svg += bodyTextXml("Você pode se sentir exausto à noite, ter dificuldade para dormir mesmo cansado, ansiedade e ganho de peso abdominal.", W/2, cardY1 + cardH + 60);
  } else if (frameNum === 7 || frameNum === 8) {
    svg += cardXml({ x: cardX, y: cardY1, w: cardW, h: cardH, state: "baixo" });
    svg += bodyTextXml("Você pode se sentir fadiga ao acordar, mesmo dormindo bem, falta de motivação e névoa mental.", W/2, cardY1 + cardH + 60);
  } else if (frameNum >= 9) {
    // 2 cards stacked com bodies entre eles — comprimir verticalmente
    const cardYa = 420;
    const bodyYa = cardYa + cardH + 30;
    const cardYb = bodyYa + 130;
    const bodyYb = cardYb + cardH + 30;
    svg += cardXml({ x: cardX, y: cardYa, w: cardW, h: cardH, state: "alto" });
    svg += bodyTextXml("Você pode se sentir exausto à noite, ter dificuldade para dormir mesmo cansado, ansiedade e ganho de peso abdominal.", W/2, bodyYa, 40);
    svg += cardXml({ x: cardX, y: cardYb, w: cardW, h: cardH, state: "baixo" });
    svg += bodyTextXml("Você pode se sentir fadiga ao acordar, mesmo dormindo bem, falta de motivação e névoa mental.", W/2, bodyYb, 40);
    // Footer apenas no último frame (12)
    if (frameNum === 12) svg += footerXml(true);
  }

  const fullSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${svg}</svg>`;
  const baseBuf = await sharp(Buffer.from(fullSvg)).png().toBuffer();
  const withLogo = await compositeLogo(baseBuf);
  fs.writeFileSync(outPath, withLogo);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
console.log("🎬 Renderizando 12 quadros do vídeo ESTRESSE...");
for (let i = 1; i <= 12; i++) {
  const out = path.join(TMP_DIR, `frame-${String(i).padStart(2, "0")}.png`);
  await renderFrame(i, out);
  console.log(`  ✓ frame-${String(i).padStart(2, "0")}.png`);
}

// Build concat file pro ffmpeg com durações específicas
const durations = [1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2]; // 20s total
let concatList = "";
for (let i = 0; i < 12; i++) {
  const frame = path.join(TMP_DIR, `frame-${String(i + 1).padStart(2, "0")}.png`);
  concatList += `file '${frame}'\nduration ${durations[i]}\n`;
}
// Last frame needs to be repeated for ffmpeg concat demuxer
concatList += `file '${path.join(TMP_DIR, 'frame-12.png')}'\n`;
fs.writeFileSync(path.join(TMP_DIR, "concat.txt"), concatList);

// FFmpeg: concat + 30fps + h264 mp4
const outMp4 = path.join(RUN_DIR, "slide-2.mp4");
console.log("\n🎞 Encoding MP4 via ffmpeg...");
try {
  execSync(
    `ffmpeg -y -f concat -safe 0 -i ${path.join(TMP_DIR, "concat.txt")} -fps_mode cfr -pix_fmt yuv420p -c:v libx264 -preset slow -crf 18 -r 30 ${outMp4}`,
    { stdio: "pipe" }
  );
  const stats = fs.statSync(outMp4);
  console.log(`✓ ${outMp4} · ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
} catch (e) {
  console.error("❌ ffmpeg falhou:", e.message);
}
