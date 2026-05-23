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

// 8 canonical palettes per brand-bible §4. Each carries thematic meaning.
// Schema: { BG, WHITE, WHITE_SOFT, WHITE_FAINT, STATUS_WARM, STATUS_GOOD, ACCENT, MID }
// BG = canvas background, WHITE = primary text fill, ACCENT = highlight (numbers, italics).
// MID = secondary accent (often used for charts/lines).
export const PALETTES = {
  // ─── Bible §4 canonical paletas ─────────────────────────────────────────────
  "P1-sage": {
    BG: "#3A4A3A", WHITE: "#E8E4D9", WHITE_SOFT: "#E8E4D9CC", WHITE_FAINT: "#E8E4D988",
    STATUS_WARM: "#C9A661", STATUS_GOOD: "#A8C49C",
    ACCENT: "#A8C49C", MID: "#5C6E5A",
    description: "Microbioma, intestino, vegetal, natural — forest greens",
  },
  "P2-amber": {
    BG: "#8B5E2B", WHITE: "#F5E8D3", WHITE_SOFT: "#F5E8D3CC", WHITE_FAINT: "#F5E8D388",
    STATUS_WARM: "#E5A268", STATUS_GOOD: "#A8C49C",
    ACCENT: "#C28B47", MID: "#5C3F1D",
    description: "Ômega-3, óleos, gordura, oxidação — amber/lipid warmth (lighter brown bg)",
  },
  "P3-concrete": {
    BG: "#2A2823", WHITE: "#E8E2D5", WHITE_SOFT: "#E8E2D5CC", WHITE_FAINT: "#E8E2D588",
    STATUS_WARM: "#C18545", STATUS_GOOD: "#A8B377",
    ACCENT: "#A89C8A", MID: "#7A7264",
    description: "Performance, prevenção, masculino sério (cancer, prostate) — urban concrete",
  },
  "P4-sunset": {
    BG: "#3B2516", WHITE: "#FFE8CC", WHITE_SOFT: "#FFE8CCCC", WHITE_FAINT: "#FFE8CC88",
    STATUS_WARM: "#E5A268", STATUS_GOOD: "#C9A661",
    ACCENT: "#E5A268", MID: "#A85B2B",
    description: "Sol, vitamina D, paisagem BR, energia — Carioca sunset",
  },
  "P5-olive": {
    BG: "#2C2B1F", WHITE: "#D8D4B8", WHITE_SOFT: "#D8D4B8CC", WHITE_FAINT: "#D8D4B888",
    STATUS_WARM: "#C9A661", STATUS_GOOD: "#A8B377",
    ACCENT: "#A8B377", MID: "#7E7E5C",
    description: "Mood, comportamental, sazonal — contemplative olive",
  },
  "P6-cool": {
    BG: "#1F262C", WHITE: "#D9DDE0", WHITE_SOFT: "#D9DDE0CC", WHITE_FAINT: "#D9DDE088",
    STATUS_WARM: "#C18545", STATUS_GOOD: "#7A8590",
    ACCENT: "#7A8590", MID: "#3A4148",
    description: "Sangue, ferro, sono, recovery — cool mineral",
  },
  "P7-white": {
    BG: "#FAFAF7", WHITE: "#1A1916", WHITE_SOFT: "#1A1916CC", WHITE_FAINT: "#1A191688",
    STATUS_WARM: "#A8623A", STATUS_GOOD: "#5C9477",
    ACCENT: "#A8623A", MID: "#7A7264",
    description: "Stats slides, comparison, CTA, inner respiro — editorial branco",
  },
  "P8-nightfall": {
    BG: "#1A1916", WHITE: "#F5EFE3", WHITE_SOFT: "#F5EFE3CC", WHITE_FAINT: "#F5EFE388",
    STATUS_WARM: "#D4A053", STATUS_GOOD: "#8FB39A",
    ACCENT: "#D4A053", MID: "#252321",
    description: "Member case study, premium feel, manifesto — nightfall premium",
  },

  // ─── Status vocabulary visual (bible §4) — for badges/biomarker cards ──────
  // Use via paletteStatus({ level }) helper, not as a slide background.
  // STATUS_LEVELS exported separately below.

  // ─── Legacy aliases (backward compat for older runs / templates) ───────────
  warm_taupe: {
    BG: "#BBB4A2", WHITE: "#FAF7F0", WHITE_SOFT: "#FAF7F0CC", WHITE_FAINT: "#FAF7F088",
    STATUS_WARM: "#C89136", STATUS_GOOD: "#7A9B7E",
    ACCENT: "#C89136", MID: "#A89C8A",
    description: "Legacy — alias to P3-concrete in future",
  },
  dark_cedar: {
    BG: "#1A1916", WHITE: "#F5EFE3", WHITE_SOFT: "#F5EFE3CC", WHITE_FAINT: "#F5EFE388",
    STATUS_WARM: "#D4A053", STATUS_GOOD: "#8FB39A",
    ACCENT: "#D4A053", MID: "#252321",
    description: "Legacy — alias to P8-nightfall",
  },
  cream_clay: {
    BG: "#F1EBDD", WHITE: "#2A2722", WHITE_SOFT: "#2A2722CC", WHITE_FAINT: "#2A272288",
    STATUS_WARM: "#A8623A", STATUS_GOOD: "#7A8B6E",
    ACCENT: "#A8623A", MID: "#7A7264",
    description: "Legacy — alias to P7-white variant",
  },
  dark_charcoal: {
    BG: "#141414", WHITE: "#F5EFE3", WHITE_SOFT: "#F5EFE3CC", WHITE_FAINT: "#F5EFE388",
    STATUS_WARM: "#D4A053", STATUS_GOOD: "#8FB39A",
    ACCENT: "#D4A053", MID: "#252321",
    description: "Legacy — alias to P8-nightfall variant",
  },
};

// Status vocabulary visual (bible §4) — colors for biomarker badges/grades.
export const STATUS_LEVELS = {
  optimal:      { color: "#5C9477", label: "ÓTIMO" },        // A grade, biomarker green
  funcional:    { color: "#A8B377", label: "FUNCIONAL" },    // Próximo do alvo
  warning:      { color: "#C18545", label: "ALERTA" },       // B grade, atenção
  insuficiente: { color: "#A85647", label: "INSUFICIENTE" }, // C grade, intervir
  critico:      { color: "#8B3220", label: "CRÍTICO" },      // Urgência clínica
};

// Resolver: accepts canonical IDs, legacy IDs, or null. Returns the palette object.
// Logs warning if unknown key.
export function resolvePalette(key) {
  if (!key) return PALETTES["P8-nightfall"];  // safe default
  if (PALETTES[key]) return PALETTES[key];
  // Tolerate "P2_amber", "p2-amber", "P2 amber" variants.
  const normalized = String(key).toLowerCase().replace(/[_\s]/g, "-");
  for (const k of Object.keys(PALETTES)) {
    if (k.toLowerCase() === normalized) return PALETTES[k];
  }
  console.warn(`  ⚠ unknown palette '${key}' — falling back to P8-nightfall`);
  return PALETTES["P8-nightfall"];
}

// Topic → palette suggestion (bible §4 mapping). Used by concept-mode/remix-mode
// when LLM doesn't pick or as a deterministic check.
export const TOPIC_PALETTE_MAP = {
  microbioma: "P1-sage", intestino: "P1-sage", vegetal: "P1-sage", fibra: "P1-sage", probiotico: "P1-sage",
  omega: "P2-amber", lipidio: "P2-amber", colesterol: "P2-amber", gordura: "P2-amber", oxidacao: "P2-amber", apob: "P2-amber",
  prostata: "P3-concrete", cancer: "P3-concrete", prevencao: "P3-concrete", performance: "P3-concrete",
  vitd: "P4-sunset", "vitamina-d": "P4-sunset", sol: "P4-sunset", energia: "P4-sunset",
  humor: "P5-olive", comportamental: "P5-olive", sazonal: "P5-olive", cortisol: "P5-olive", estresse: "P5-olive",
  ferro: "P6-cool", ferritina: "P6-cool", sangue: "P6-cool", sono: "P6-cool", hrv: "P6-cool", recovery: "P6-cool",
  manifesto: "P8-nightfall", "case-study": "P8-nightfall", premium: "P8-nightfall",
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
    out += `<text x="${startX}" y="${yy}" font-family="${family}" font-size="${fontSize}" font-weight="${weight}" fill="${fill}"${italic ? ' font-style="italic"' : ''}${letterSpacing ? ` letter-spacing="${letterSpacing}"` : ''} xml:space="preserve">${escape(lines[i])}</text>`;
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
    out += `<text x="${W/2}" y="${yy}" font-family="${family}" font-size="${fontSize}" font-weight="${weight}" fill="${fill}"${italic ? ' font-style="italic"' : ''} text-anchor="middle"${letterSpacing ? ` letter-spacing="${letterSpacing}"` : ''} xml:space="preserve">${esc(lines[i])}</text>`;
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

  // 2026-05-23 fix: letter-spacing="-2" collapsed word spaces on libvips/sharp.
  // Inter at fs 32-44 doesn't need negative kerning. Use -0.5 max (subtle tighten).
  // Explicit font fallback chain forces Inter Regular pick (vs Inter Display ambiguity).
  let svg = `<text x="${W/2}" y="${y}" font-family="Inter, 'Helvetica Neue', Arial, sans-serif" font-size="${fontSize}" font-weight="300" fill="${WHITE}" text-anchor="middle" letter-spacing="-0.5" xml:space="preserve">${esc(line1)}</text>`;
  if (line2Italic) {
    svg += `<text x="${W/2}" y="${y + fontSize * 1.1}" font-family="Georgia, 'Liberation Serif', serif" font-style="italic" font-size="${fontSize}" font-weight="400" fill="${WHITE}" text-anchor="middle" xml:space="preserve">${esc(line2Italic)}</text>`;
  }
  if (sub) {
    const subLines = wrapText(sub, 60);
    const subStartY = y + (line2Italic ? 2 * fontSize * 1.1 : fontSize * 1.1) + 14;
    subLines.forEach((ln, i) => {
      svg += `<text x="${W/2}" y="${subStartY + i * 28}" font-family="Inter, 'Helvetica Neue', Arial, sans-serif" font-size="22" font-weight="400" fill="${WHITE_SOFT}" text-anchor="middle" xml:space="preserve">${esc(ln)}</text>`;
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
