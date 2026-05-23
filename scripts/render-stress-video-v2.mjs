// render-stress-video-v2.mjs — vídeo slide 2 com ANIMAÇÃO PROGRESSIVA
// Linha do gráfico desenha left→right · sem card · BG warm taupe · 20s @ 30fps

import sharp from "sharp";
import * as fs from "fs";
import { execSync } from "child_process";
import * as path from "path";

const W = 1080, H = 1350;
const BG = "#BBB4A2";
const HEAD = "#1C3F3A";
const BODY_COL = "#4A453E";
const GOLD = "#C89136";
const SAGE = "#557D6D";
const ACCENT = "#2D7A5C";
const TRACK_OFF = "#A29B89";  // Inactive track tone

const RUN_DIR = "/Users/mathe/Documents/Longev/Brand/Longevify/content-machine/runs/2026-05-21-022-your-stress-response-system-has-bm/assets";
const TMP_DIR = "/tmp/longevify-stress-video";
fs.mkdirSync(TMP_DIR, { recursive: true });
// Clean previous frames
for (const f of fs.readdirSync(TMP_DIR).filter(f => f.endsWith(".png"))) fs.unlinkSync(path.join(TMP_DIR, f));

const FPS = 30;
const DURATION = 10; // segundos (max IG carrossel video conforto)
const TOTAL = FPS * DURATION; // 300 frames

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const easeOut = (t) => 1 - Math.pow(1 - t, 3); // cubic ease-out
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;

// Timeline (em frames @ 30fps · total 300 = 10s)
const T = {
  headline_in: [0, 20],         // 0-0.7s
  label1_in:   [15, 40],        // 0.5-1.3s
  slider1_draw: [40, 90],       // 1.3-3s (line draws)
  dot1_appear: [90, 95],        // 3-3.2s
  body1_fade:  [95, 130],       // 3.2-4.3s
  label2_in:   [140, 165],      // 4.7-5.5s
  slider2_draw: [165, 215],     // 5.5-7.2s
  dot2_appear: [215, 220],
  body2_fade:  [220, 250],      // 7.3-8.3s
  footer_in:   [250, 275],      // 8.3-9.2s
  hold_final:  [275, 300],      // 9.2-10s (hold final)
};

function progress(frame, [start, end]) {
  if (frame <= start) return 0;
  if (frame >= end) return 1;
  return easeOut((frame - start) / (end - start));
}

const wrap = (text, max) => {
  const out = [];
  const words = text.split(/\s+/);
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length <= max) cur = (cur + " " + w).trim();
    else { if (cur) out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out;
};

// ─── Headline ────────────────────────────────────────────────────────────────
function headlineSvg(opacity) {
  const lines = ["Sinais de que seu cortisol", "está fora do eixo."];
  const fontSize = 52;
  const startY = 230;
  return lines.map((ln, i) =>
    `<text x="${W/2}" y="${startY + i * fontSize * 1.18}" font-family="Inter, sans-serif" font-size="${fontSize}" font-weight="500" fill="${HEAD}" text-anchor="middle" letter-spacing="-1" opacity="${opacity.toFixed(2)}">${esc(ln)}</text>`
  ).join("");
}

// ─── Slider section ───────────────────────────────────────────────────────────
// y_offset = top of the section, label & slider & body stacked
function sliderSection({ y, labelOpacity, sliderProgress, dotShown, state, bodyOpacity, bodyText }) {
  let svg = "";
  const padL = 80;
  const padR = 80;

  // Label: "Cortisol" / "Indicador de estresse"
  svg += `<text x="${padL}" y="${y}" font-family="Inter, sans-serif" font-size="32" font-weight="500" fill="${HEAD}" opacity="${labelOpacity.toFixed(2)}">Cortisol</text>`;
  svg += `<text x="${padL}" y="${y + 36}" font-family="Inter, sans-serif" font-size="20" font-weight="400" fill="${BODY_COL}" opacity="${(labelOpacity * 0.85).toFixed(2)}">Indicador de estresse</text>`;

  // State label right-aligned ("Alto" / "Baixo") — aparece quando dot mostra
  const stateLabel = state === "alto" ? "Alto" : "Baixo";
  const labelStateOpacity = dotShown ? 1 : 0;
  svg += `<text x="${W - padR}" y="${y}" font-family="Inter, sans-serif" font-size="24" font-weight="500" fill="${HEAD}" text-anchor="end" opacity="${labelStateOpacity}">${stateLabel}</text>`;

  // Slider track — draws progressively from left to right
  const trackY = y + 90;
  const trackXStart = padL;
  const trackXEnd = W - padR;
  const trackLen = trackXEnd - trackXStart;
  // Background track (full, faded)
  svg += `<line x1="${trackXStart}" y1="${trackY}" x2="${trackXEnd}" y2="${trackY}" stroke="${TRACK_OFF}" stroke-width="3" opacity="0.4"/>`;
  // Active progressive line: 3 segments com cores
  const seg = trackLen / 3;
  const drawnEnd = trackXStart + trackLen * sliderProgress;
  // Seg 1 (gold left)
  if (drawnEnd > trackXStart) {
    const segEnd = Math.min(drawnEnd, trackXStart + seg);
    svg += `<line x1="${trackXStart}" y1="${trackY}" x2="${segEnd}" y2="${trackY}" stroke="${GOLD}" stroke-width="4" opacity="${state === 'baixo' ? 1 : 0.45}"/>`;
  }
  // Seg 2 (sage middle)
  if (drawnEnd > trackXStart + seg) {
    const segStart = trackXStart + seg;
    const segEnd = Math.min(drawnEnd, trackXStart + 2*seg);
    svg += `<line x1="${segStart}" y1="${trackY}" x2="${segEnd}" y2="${trackY}" stroke="${ACCENT}" stroke-width="4" opacity="0.7"/>`;
  }
  // Seg 3 (gold right)
  if (drawnEnd > trackXStart + 2*seg) {
    const segStart = trackXStart + 2*seg;
    const segEnd = drawnEnd;
    svg += `<line x1="${segStart}" y1="${trackY}" x2="${segEnd}" y2="${trackY}" stroke="${GOLD}" stroke-width="4" opacity="${state === 'alto' ? 1 : 0.45}"/>`;
  }

  // Dot + dashed connector — só quando dotShown
  if (dotShown) {
    const dotX = state === "alto" ? trackXEnd - 6 : trackXStart + 6;
    const dotY = trackY;
    const labelStateX = state === "alto" ? W - padR - 70 : padL + 70;
    const labelStateY = y - 8;
    // Dashed line from state label to dot
    svg += `<line x1="${labelStateX}" y1="${labelStateY}" x2="${dotX}" y2="${dotY - 4}" stroke="${GOLD}" stroke-width="1.2" stroke-dasharray="5,5" opacity="0.7"/>`;
    svg += `<circle cx="${dotX}" cy="${dotY}" r="10" fill="${GOLD}"/>`;
  }

  // Body text below slider
  if (bodyText && bodyOpacity > 0) {
    const bodyLines = wrap(bodyText, 38);
    const bodyFont = 22;
    const bodyStartY = trackY + 60;
    bodyLines.forEach((ln, i) => {
      svg += `<text x="${W/2}" y="${bodyStartY + i * bodyFont * 1.45}" font-family="DM Sans, Inter, sans-serif" font-size="${bodyFont}" font-weight="400" fill="${BODY_COL}" text-anchor="middle" opacity="${bodyOpacity.toFixed(2)}">${esc(ln)}</text>`;
    });
  }
}

function sliderSectionXml({ y, labelOpacity, sliderProgress, dotShown, state, bodyOpacity, bodyText }) {
  let svg = "";
  const padL = 80;
  const padR = 80;

  svg += `<text x="${padL}" y="${y}" font-family="Inter, sans-serif" font-size="32" font-weight="500" fill="${HEAD}" opacity="${labelOpacity.toFixed(2)}">Cortisol</text>`;
  svg += `<text x="${padL}" y="${y + 36}" font-family="Inter, sans-serif" font-size="20" font-weight="400" fill="${BODY_COL}" opacity="${(labelOpacity * 0.85).toFixed(2)}">Indicador de estresse</text>`;

  const stateLabel = state === "alto" ? "Alto" : "Baixo";
  const labelStateOpacity = dotShown ? 1 : 0;
  svg += `<text x="${W - padR}" y="${y}" font-family="Inter, sans-serif" font-size="24" font-weight="500" fill="${HEAD}" text-anchor="end" opacity="${labelStateOpacity}">${stateLabel}</text>`;

  const trackY = y + 90;
  const trackXStart = padL;
  const trackXEnd = W - padR;
  const trackLen = trackXEnd - trackXStart;
  svg += `<line x1="${trackXStart}" y1="${trackY}" x2="${trackXEnd}" y2="${trackY}" stroke="${TRACK_OFF}" stroke-width="3" opacity="0.4"/>`;
  const seg = trackLen / 3;
  const drawnEnd = trackXStart + trackLen * sliderProgress;
  if (drawnEnd > trackXStart) {
    const segEnd = Math.min(drawnEnd, trackXStart + seg);
    svg += `<line x1="${trackXStart}" y1="${trackY}" x2="${segEnd}" y2="${trackY}" stroke="${GOLD}" stroke-width="4" opacity="${state === 'baixo' ? 1 : 0.45}"/>`;
  }
  if (drawnEnd > trackXStart + seg) {
    const segStart = trackXStart + seg;
    const segEnd = Math.min(drawnEnd, trackXStart + 2*seg);
    svg += `<line x1="${segStart}" y1="${trackY}" x2="${segEnd}" y2="${trackY}" stroke="${ACCENT}" stroke-width="4" opacity="0.7"/>`;
  }
  if (drawnEnd > trackXStart + 2*seg) {
    const segStart = trackXStart + 2*seg;
    const segEnd = drawnEnd;
    svg += `<line x1="${segStart}" y1="${trackY}" x2="${segEnd}" y2="${trackY}" stroke="${GOLD}" stroke-width="4" opacity="${state === 'alto' ? 1 : 0.45}"/>`;
  }

  if (dotShown) {
    const dotX = state === "alto" ? trackXEnd - 6 : trackXStart + 6;
    const dotY = trackY;
    const labelStateX = state === "alto" ? W - padR - 70 : padL + 70;
    const labelStateY = y - 8;
    svg += `<line x1="${labelStateX}" y1="${labelStateY}" x2="${dotX}" y2="${dotY - 4}" stroke="${GOLD}" stroke-width="1.2" stroke-dasharray="5,5" opacity="0.7"/>`;
    svg += `<circle cx="${dotX}" cy="${dotY}" r="10" fill="${GOLD}"/>`;
  }

  if (bodyText && bodyOpacity > 0) {
    const bodyLines = wrap(bodyText, 38);
    const bodyFont = 22;
    const bodyStartY = trackY + 60;
    bodyLines.forEach((ln, i) => {
      svg += `<text x="${W/2}" y="${bodyStartY + i * bodyFont * 1.45}" font-family="DM Sans, Inter, sans-serif" font-size="${bodyFont}" font-weight="400" fill="${BODY_COL}" text-anchor="middle" opacity="${bodyOpacity.toFixed(2)}">${esc(ln)}</text>`;
    });
  }
  return svg;
}

// ─── Logo branca bottom-center ────────────────────────────────────────────────
let logoBufCache;
async function getLogo() {
  if (logoBufCache) return logoBufCache;
  const LOGO = "/Users/mathe/Documents/Longev/Brand/Longevify/content-machine/assets/logo-horizontal-white.png";
  const trimmed = await sharp(LOGO).trim().toBuffer({ resolveWithObject: true });
  const cropH = Math.round(trimmed.info.height * 0.78);
  const wordmark = await sharp(trimmed.data).extract({ left: 0, top: 0, width: trimmed.info.width, height: cropH }).toBuffer();
  const logoW = Math.round(W * 0.22);
  const logoBuf = await sharp(wordmark).resize(logoW).toBuffer();
  const meta = await sharp(logoBuf).metadata();
  logoBufCache = { buf: logoBuf, x: Math.round((W - logoW) / 2), y: Math.round(H - (meta.height ?? 60) - 60) };
  return logoBufCache;
}

// ─── Render single frame ──────────────────────────────────────────────────────
async function renderFrame(frame, outPath) {
  // Compute progresses for this frame
  const op_headline = progress(frame, T.headline_in);
  const op_label1 = progress(frame, T.label1_in);
  const prog_slider1 = progress(frame, T.slider1_draw);
  const dot1 = frame >= T.dot1_appear[0];
  const op_body1 = progress(frame, T.body1_fade);
  const op_label2 = progress(frame, T.label2_in);
  const prog_slider2 = progress(frame, T.slider2_draw);
  const dot2 = frame >= T.dot2_appear[0];
  const op_body2 = progress(frame, T.body2_fade);
  const op_footer = progress(frame, T.footer_in);

  // Layout positions
  const SECTION_1_Y = 500;
  const SECTION_2_Y = 880;

  let svg = `<rect width="${W}" height="${H}" fill="${BG}"/>`;
  svg += headlineSvg(op_headline);

  // Section 1 — Alto
  svg += sliderSectionXml({
    y: SECTION_1_Y,
    labelOpacity: op_label1,
    sliderProgress: prog_slider1,
    dotShown: dot1,
    state: "alto",
    bodyOpacity: op_body1,
    bodyText: "Você pode se sentir exausto à noite, ter dificuldade para dormir mesmo cansado, ansiedade e ganho de peso abdominal.",
  });

  // Section 2 — Baixo
  svg += sliderSectionXml({
    y: SECTION_2_Y,
    labelOpacity: op_label2,
    sliderProgress: prog_slider2,
    dotShown: dot2,
    state: "baixo",
    bodyOpacity: op_body2,
    bodyText: "Você pode se sentir fadiga ao acordar, mesmo dormindo bem, falta de motivação e névoa mental.",
  });

  // Footer removido — só logo bottom-center

  const fullSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${svg}</svg>`;
  const baseBuf = await sharp(Buffer.from(fullSvg)).png().toBuffer();
  // Logo composite
  const logo = await getLogo();
  const finalBuf = await sharp(baseBuf).composite([{ input: logo.buf, left: logo.x, top: logo.y }]).png().toBuffer();
  fs.writeFileSync(outPath, finalBuf);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
console.log(`🎬 Renderizando ${TOTAL} frames (${DURATION}s @ ${FPS}fps)...`);
const t0 = Date.now();
for (let i = 0; i < TOTAL; i++) {
  const out = path.join(TMP_DIR, `f-${String(i).padStart(4, "0")}.png`);
  await renderFrame(i, out);
  if (i % 60 === 0) console.log(`  frame ${i}/${TOTAL} (${Math.round((i/TOTAL)*100)}%)`);
}
console.log(`  ✓ ${TOTAL} frames em ${Math.round((Date.now()-t0)/1000)}s`);

// Encode MP4 com fps fixo
const outMp4 = path.join(RUN_DIR, "slide-2.mp4");
console.log("\n🎞 Encoding MP4...");
execSync(
  `ffmpeg -y -framerate ${FPS} -i ${path.join(TMP_DIR, "f-%04d.png")} -fps_mode cfr -pix_fmt yuv420p -c:v libx264 -preset slow -crf 18 -r ${FPS} ${outMp4}`,
  { stdio: "pipe" }
);
const stats = fs.statSync(outMp4);
console.log(`✓ ${outMp4} · ${(stats.size / 1024 / 1024).toFixed(2)} MB · ${DURATION}s`);
