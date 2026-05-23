// scripts/templates/_shared.mjs — helpers compartilhados por templates genéricos
// Reusa: SVG wrap, logo composite, text wrap, palette derivation

import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT = path.resolve(__dirname, "..", "..");

export const W = 1080, H = 1350;
export const OUT_W = 1440, OUT_H = 1800;
export const SCALE = OUT_W / W;
export const LOGO_PATH = path.join(ROOT, "assets", "logo-horizontal-white.png");

export const PALETTES = {
  warm_taupe: {
    BG: "#BBB4A2", WHITE: "#FAF7F0", WHITE_SOFT: "#FAF7F0CC", WHITE_FAINT: "#FAF7F088",
    STATUS_WARM: "#C89136", STATUS_GOOD: "#7A9B7E",
  },
  dark_cedar: {
    BG: "#1A1916", WHITE: "#F5EFE3", WHITE_SOFT: "#F5EFE3CC", WHITE_FAINT: "#F5EFE388",
    STATUS_WARM: "#D4A053", STATUS_GOOD: "#8FB39A",
  },
  cream_clay: {
    BG: "#F1EBDD", WHITE: "#2A2722", WHITE_SOFT: "#2A2722CC", WHITE_FAINT: "#2A272288",
    STATUS_WARM: "#A8623A", STATUS_GOOD: "#7A8B6E",
  },
  dark_charcoal: {
    BG: "#141414", WHITE: "#F5EFE3", WHITE_SOFT: "#F5EFE3CC", WHITE_FAINT: "#F5EFE388",
    STATUS_WARM: "#D4A053", STATUS_GOOD: "#8FB39A",
  },
};

export const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
export const sc = (n) => Math.round(n * SCALE);

export function svgWrap(inner) {
  return `<svg width="${OUT_W}" height="${OUT_H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

export function wrapText(text, maxChars) {
  if (!text) return [];
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length <= maxChars) cur = (cur + " " + w).trim();
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Left-anchored wrap-aware emitter (for card-list layouts where x is fixed).
// Use when text-anchor defaults to "start". Returns { svg, endY }.
export function svgWrappedLeft(text, opts) {
  if (!text) return { svg: "", endY: opts.startY };
  const {
    startX, startY, fontSize, family = "Inter, sans-serif", weight = "400", fill,
    italic = false, letterSpacing = 0, maxChars, lineHeight,
  } = opts;
  const lh = lineHeight || Math.round(fontSize * 1.3);
  const lines = wrapText(text, maxChars);
  const escape = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
  let out = "";
  for (let i = 0; i < lines.length; i++) {
    const yy = startY + i * lh;
    out += `<text x="${startX}" y="${yy}" font-family="${family}" font-size="${fontSize}" font-weight="${weight}" fill="${fill}"${italic ? ' font-style="italic"' : ''}${letterSpacing ? ` letter-spacing="${letterSpacing}"` : ''}>${escape(lines[i])}</text>`;
  }
  return { svg: out, endY: startY + (lines.length - 1) * lh };
}

// Shared SVG text emitter — center-anchored, wrap-aware. Returns { svg, endY }.
// Canvas is 1080px wide (viewBox); safe margin ~60px each side → usable ~960px.
// Default maxChars values: fs 76 → 14 chars · fs 32 → 28 · fs 22 → 50 · fs 20 → 50 · fs 16 → 70.
// Letter-spacing tightens or loosens; account for it via maxChars caller-side.
export function svgWrappedCentered(text, opts) {
  if (!text) return { svg: "", endY: opts.startY };
  const {
    startY, fontSize, family = "Inter, sans-serif", weight = "400", fill,
    italic = false, letterSpacing = 0, maxChars, lineHeight,
  } = opts;
  const lh = lineHeight || Math.round(fontSize * 1.3);
  const lines = wrapText(text, maxChars);
  const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
  let out = "";
  for (let i = 0; i < lines.length; i++) {
    const yy = startY + i * lh;
    out += `<text x="${W/2}" y="${yy}" font-family="${family}" font-size="${fontSize}" font-weight="${weight}" fill="${fill}"${italic ? ' font-style="italic"' : ''} text-anchor="middle"${letterSpacing ? ` letter-spacing="${letterSpacing}"` : ''}>${esc(lines[i])}</text>`;
  }
  return { svg: out, endY: startY + (lines.length - 1) * lh };
}

export function autoShrinkFont(text, baseSize, maxCharsAtBaseSize = 18) {
  if (!text) return baseSize;
  if (text.length <= maxCharsAtBaseSize) return baseSize;
  const ratio = maxCharsAtBaseSize / text.length;
  return Math.max(36, Math.round(baseSize * Math.max(0.65, ratio)));
}

export async function compositeLogo(buf, { paletteKey = "warm_taupe", bottomMargin = 50 } = {}) {
  const trimmed = await sharp(LOGO_PATH).trim().toBuffer({ resolveWithObject: true });
  const cropH = Math.round(trimmed.info.height * 0.78);
  let wordmark = await sharp(trimmed.data)
    .extract({ left: 0, top: 0, width: trimmed.info.width, height: cropH })
    .toBuffer();
  // Cream palette = dark logo (invert white→dark via negate)
  if (paletteKey === "cream_clay") {
    wordmark = await sharp(wordmark).negate({ alpha: false }).toBuffer();
  }
  const logoW = Math.round(OUT_W * 0.25);
  const logoBuf = await sharp(wordmark).resize(logoW).toBuffer();
  const meta = await sharp(logoBuf).metadata();
  const x = Math.round((OUT_W - logoW) / 2);
  const y = Math.round(OUT_H - (meta.height ?? 60) - sc(bottomMargin));
  return sharp(buf).composite([{ input: logoBuf, left: x, top: y }]).png().toBuffer();
}

export function headlineXml(line1, line2Italic, sub, palette, opts = {}) {
  const { y = 110, fontSize: baseFontSize = 62 } = opts;
  const longest = Math.max((line1 || "").length, (line2Italic || "").length);
  const fontSize = autoShrinkFont(longest, baseFontSize, 18);
  const { WHITE, WHITE_SOFT } = palette;

  let svg = `<text x="${W/2}" y="${y}" font-family="Inter, sans-serif" font-size="${fontSize}" font-weight="300" fill="${WHITE}" text-anchor="middle" letter-spacing="-2">${esc(line1)}</text>`;
  if (line2Italic) {
    svg += `<text x="${W/2}" y="${y + fontSize * 1.1}" font-family="Georgia, serif" font-style="italic" font-size="${fontSize}" font-weight="400" fill="${WHITE}" text-anchor="middle" letter-spacing="-1">${esc(line2Italic)}</text>`;
  }
  if (sub) {
    const subLines = wrapText(sub, 60);
    const subStartY = y + (line2Italic ? 2 * fontSize * 1.1 : fontSize * 1.1) + 14;
    subLines.forEach((ln, i) => {
      svg += `<text x="${W/2}" y="${subStartY + i * 28}" font-family="Inter, sans-serif" font-size="22" font-weight="400" fill="${WHITE_SOFT}" text-anchor="middle">${esc(ln)}</text>`;
    });
  }
  return svg;
}

// Loader helper: parse args + load data file
export function loadData(args) {
  const a = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--data") out.dataFile = a[++i];
    else if (a[i] === "--run") out.runId = a[++i];
  }
  if (!out.dataFile || !out.runId) {
    console.error("Usage: <template>.mjs --data <data.json> --run <run-id>");
    process.exit(1);
  }
  const dataPath = path.resolve(ROOT, out.dataFile);
  if (!fs.existsSync(dataPath)) {
    console.error(`Data file não existe: ${dataPath}`);
    process.exit(1);
  }
  return { runId: out.runId, data: JSON.parse(fs.readFileSync(dataPath, "utf-8")) };
}

export function ensureRunDir(runId) {
  const dir = path.join(ROOT, "runs", runId, "assets");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
