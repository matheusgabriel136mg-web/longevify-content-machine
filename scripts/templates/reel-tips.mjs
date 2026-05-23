// scripts/templates/reel-tips.mjs — Reel "Pressione e segure" Mito-style genérico
//
// Data schema:
// {
//   "header_line_1": "Pressione e segure",
//   "header_line_2": "pra revelar sua dica:",
//   "cards": [
//     { "title": "ALIMENTE\nSUA CURVA", "tip": "...", "bg": "bg-nutrition.png" },
//     ...
//   ],
//   "fps": 30,
//   "pop_in_frames": 3,
//   "hold_frames": 28,
//   "fade_out_frames": 3
// }
//
// Output: runs/<id>/assets/slide-1-reel.mp4

import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { ROOT, esc, loadData, ensureRunDir, LOGO_PATH } from "./_shared.mjs";

const W = 1080, H = 1920;  // REEL portrait
const BG_WHITE = "#FAF7F0";
const DARK = "#1A1A1A";
const CARD_W = 720;
const CARD_H = 980;
const CARD_X = (W - CARD_W) / 2;
const CARD_Y = 470;
const CARD_RADIUS = 36;

const TMP_DIR = "/tmp/longevify-reel-tpl-frames";
fs.mkdirSync(TMP_DIR, { recursive: true });

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

function wrapText(text, maxChars) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length <= maxChars) cur = (cur + " " + w).trim();
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

async function loadCardBg(bgPath) {
  if (!fs.existsSync(bgPath)) {
    const svg = `<svg width="${CARD_W}" height="${CARD_H}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#A29B89"/><stop offset="1" stop-color="#6B5E4E"/></linearGradient></defs><rect width="${CARD_W}" height="${CARD_H}" fill="url(#g)"/></svg>`;
    return sharp(Buffer.from(svg)).png().toBuffer();
  }
  return sharp(bgPath).resize(CARD_W, CARD_H, { fit: "cover", position: "center" }).blur(8).png().toBuffer();
}

async function maskRounded(bgBuf) {
  const mask = Buffer.from(`<svg width="${CARD_W}" height="${CARD_H}"><rect x="0" y="0" width="${CARD_W}" height="${CARD_H}" rx="${CARD_RADIUS}" ry="${CARD_RADIUS}" fill="white"/></svg>`);
  const grad = Buffer.from(`<svg width="${CARD_W}" height="${CARD_H}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.18"/><stop offset="0.4" stop-color="#000" stop-opacity="0.10"/><stop offset="0.55" stop-color="#000" stop-opacity="0.35"/><stop offset="1" stop-color="#000" stop-opacity="0.62"/></linearGradient></defs><rect width="${CARD_W}" height="${CARD_H}" fill="url(#g)" rx="${CARD_RADIUS}" ry="${CARD_RADIUS}"/></svg>`);
  const masked = await sharp(bgBuf).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  return sharp(masked).composite([{ input: grad, top: 0, left: 0 }]).png().toBuffer();
}

function cardOverlaySvg(title, tip) {
  const titleLines = title.split("\n");
  const titleFontSize = 88;
  const titleStartY = 160;
  let svg = `<svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">`;
  titleLines.forEach((ln, i) => {
    svg += `<text x="68" y="${titleStartY + i * titleFontSize * 1.05}" font-family="Inter, sans-serif" font-size="${titleFontSize}" font-weight="700" fill="#FFFFFF" letter-spacing="-2">${esc(ln)}</text>`;
  });
  const tipY = CARD_H - 260;
  const bulbX = 78, bulbY = tipY - 28;
  svg += `<circle cx="${bulbX}" cy="${bulbY}" r="22" fill="none" stroke="#FFFFFF" stroke-width="1.5" opacity="0.85"/>`;
  svg += `<path d="M ${bulbX-7} ${bulbY-4} Q ${bulbX} ${bulbY-12} ${bulbX+7} ${bulbY-4} L ${bulbX+5} ${bulbY+6} L ${bulbX-5} ${bulbY+6} Z" fill="none" stroke="#FFFFFF" stroke-width="1.2" opacity="0.85"/>`;
  const tipLines = wrapText(tip, 38);
  const tipFontSize = 32;
  tipLines.forEach((ln, i) => {
    svg += `<text x="128" y="${tipY + i * tipFontSize * 1.32}" font-family="Inter, sans-serif" font-size="${tipFontSize}" font-weight="500" fill="#FFFFFF">${esc(ln)}</text>`;
  });
  svg += `</svg>`;
  return Buffer.from(svg);
}

function chromeOverlaySvg(h1, h2) {
  const headerY = 180;
  let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<text x="${W/2}" y="${headerY}" font-family="Inter, sans-serif" font-size="46" font-weight="500" fill="${DARK}" text-anchor="middle" letter-spacing="-0.5">${esc(h1)}</text>`;
  svg += `<text x="${W/2}" y="${headerY + 64}" font-family="Inter, sans-serif" font-size="46" font-weight="500" fill="${DARK}" text-anchor="middle" letter-spacing="-0.5">${esc(h2)}</text>`;
  svg += `</svg>`;
  return Buffer.from(svg);
}

async function loadLogo() {
  const trimmed = await sharp(LOGO_PATH).trim().toBuffer({ resolveWithObject: true });
  const cropH = Math.round(trimmed.info.height * 0.78);
  let wordmark = await sharp(trimmed.data).extract({ left: 0, top: 0, width: trimmed.info.width, height: cropH }).toBuffer();
  wordmark = await sharp(wordmark).negate({ alpha: false }).toBuffer();  // dark logo no bg cream
  const logoW = Math.round(W * 0.22);
  return sharp(wordmark).resize(logoW).toBuffer();
}

async function renderFrame(cardIndex, framePhase, cards, opts, logoBuf, chromeBuf) {
  const card = cards[cardIndex];
  const { POP_IN, HOLD, FADE_OUT } = opts;
  let opacity = 1, scale = 1;
  if (framePhase < POP_IN) {
    const t = framePhase / POP_IN;
    const e = easeOutCubic(t);
    opacity = e;
    scale = 0.93 + 0.07 * e;
  } else if (framePhase < POP_IN + HOLD) {
    opacity = 1; scale = 1;
  } else {
    const t = (framePhase - POP_IN - HOLD) / FADE_OUT;
    opacity = 1 - easeOutCubic(t);
  }

  let canvas = await sharp({ create: { width: W, height: H, channels: 4, background: BG_WHITE } }).png().toBuffer();
  const cardBgRaw = await loadCardBg(card.bgPath);
  const cardBgMasked = await maskRounded(cardBgRaw);
  const contentOverlay = cardOverlaySvg(card.title, card.tip);
  let cardComposed = await sharp(cardBgMasked).composite([{ input: contentOverlay, top: 0, left: 0 }]).png().toBuffer();

  let cardW = CARD_W, cardH = CARD_H, cardX = CARD_X, cardY = CARD_Y;
  if (scale !== 1) {
    cardW = Math.round(CARD_W * scale);
    cardH = Math.round(CARD_H * scale);
    cardX = Math.round(CARD_X + (CARD_W - cardW) / 2);
    cardY = Math.round(CARD_Y + (CARD_H - cardH) / 2);
    cardComposed = await sharp(cardComposed).resize(cardW, cardH).toBuffer();
  }

  if (opacity < 1) {
    cardComposed = await sharp(cardComposed).ensureAlpha().composite([{
      input: Buffer.from(`<svg width="${cardW}" height="${cardH}"><rect width="${cardW}" height="${cardH}" fill="white" opacity="${opacity}"/></svg>`),
      blend: "dest-in",
    }]).png().toBuffer();
  }

  canvas = await sharp(canvas).composite([{ input: cardComposed, top: cardY, left: cardX }]).png().toBuffer();
  canvas = await sharp(canvas).composite([{ input: chromeBuf, top: 0, left: 0 }]).png().toBuffer();
  const logoMeta = await sharp(logoBuf).metadata();
  const logoX = Math.round((W - logoMeta.width) / 2);
  const logoY = H - logoMeta.height - 110;
  canvas = await sharp(canvas).composite([{ input: logoBuf, top: logoY, left: logoX }]).png().toBuffer();
  return canvas;
}

const { runId, data } = loadData();
const FPS = data.fps || 30;
const opts = {
  POP_IN: data.pop_in_frames || 3,
  HOLD: data.hold_frames || 28,
  FADE_OUT: data.fade_out_frames || 3,
};
const PER_CARD = opts.POP_IN + opts.HOLD + opts.FADE_OUT;

const runDir = ensureRunDir(runId);

// Resolve bg paths
const cards = (data.cards || []).map(c => ({
  ...c,
  bgPath: c.bg ? path.join(runDir, c.bg) : null,
}));

console.log(`\n🎬 reel-tips · ${runId} · ${cards.length} cards · ${cards.length * PER_CARD} frames @ ${FPS}fps · ${(cards.length * PER_CARD / FPS).toFixed(1)}s\n`);

// Clear tmp
for (const f of fs.readdirSync(TMP_DIR)) fs.unlinkSync(path.join(TMP_DIR, f));

const logoBuf = await loadLogo();
const chromeBuf = await sharp(chromeOverlaySvg(data.header_line_1 || "Pressione e segure", data.header_line_2 || "pra revelar sua dica:")).png().toBuffer();

let frameNum = 0;
for (let ci = 0; ci < cards.length; ci++) {
  for (let fp = 0; fp < PER_CARD; fp++) {
    const buf = await renderFrame(ci, fp, cards, opts, logoBuf, chromeBuf);
    const p = path.join(TMP_DIR, `f-${String(frameNum).padStart(4, "0")}.png`);
    fs.writeFileSync(p, buf);
    frameNum++;
    if (frameNum % 30 === 0) process.stdout.write(`  ${frameNum} `);
  }
}
console.log(`\n  ✓ ${frameNum} frames\n`);

const outMp4 = path.join(runDir, "slide-1-reel.mp4");
console.log(`🎞 Encoding...`);
execSync(`ffmpeg -y -framerate ${FPS} -i ${TMP_DIR}/f-%04d.png -fps_mode cfr -pix_fmt yuv420p -c:v libx264 -preset slow -crf 16 -movflags +faststart ${outMp4}`, { stdio: "pipe" });
const stats = fs.statSync(outMp4);
console.log(`✓ ${path.relative(ROOT, outMp4)} · ${(stats.size / 1024 / 1024).toFixed(2)}MB\n`);
