// scripts/templates/dado-punch.mjs — Single image "dado punch" template.
//
// 2026-05-23: brand-rule update — covers MUST be photographic/scene/object/person
// in premium BR context, NOT solid color. New default behavior:
//   1. Reads data.cover_variant or data.cover_scene_prompt
//   2. Caches lifestyle bg to runs/<id>/_cover-bg.png (Higgsfield gen on first run, reuse after)
//   3. Composites text/number overlay on top of bg + gradient
//   4. Runs cover-validator at end; logs (does not fail) if WARN/FAIL
//
// Data schema (data/<id>.json):
// {
//   "kicker":               "VITAMINA D · BRASIL",
//   "number":               "73%",
//   "number_color":         "amber" | "sage" | "warm",
//   "headline_1":           "dos brasileiros têm vitamina D",
//   "headline_2_italic":    "abaixo da faixa funcional.",
//   "body":                 ["Faixa populacional aceita 20 ng/mL.", "Faixa funcional pede 40–60."],
//   "closing_italic":       "No país do sol, vitamina D virou marcador silencioso.",
//   "footer_source":        "FONTE · ESTUDO BRAZOS · 2024 N=22.000",
//   "palette":              "dark_cedar" | "warm_taupe" | "cream_clay",
//   "cover_variant":        "copacabana-woman-A",            // OPTIONAL preset
//   "cover_scene_prompt":   "Editorial cinematic ..."        // OPTIONAL overrides variant
// }
//
// Output: runs/<id>/assets/slide-1-cover.png (1440x1800).

import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";
import { W, H, ROOT, PALETTES, esc, svgWrap, compositeLogo, loadData, ensureRunDir } from "./_shared.mjs";
import { higgsfieldGenerate } from "../agents/higgsfield-retry.mjs";
import { validateCover } from "../agents/cover-validator.mjs";

// Curated scene presets — keep in sync with foundation/cover-brand-rule.md.
const COVER_VARIANTS = {
  "copacabana-woman-A":
    "Editorial cinematic medium-back shot, woman around 38 walking the Copacabana boardwalk pre-dawn, backlit Brazilian sun creating warm rim light on her shoulders and loose hair. Shot from behind, no face visible. Deep amber + dark cedar color grade. Generous negative space upper third for text overlay. Medium format 645, shallow depth of field, slight film grain, premium Vogue Brasil aesthetic. NO text, NO logos, NO watermarks, NO baseball caps, NO gym wear, NO water bottle, NO white backgrounds, NO pastel filters.",
  "sp-restaurant-still-life-A":
    "Editorial cinematic restaurant table detail in São Paulo Jardins district, half-finished plate of grilled fish + half glass of red wine + linen napkin + warm side light through window, NO people visible, only the still life. Dark forest green + warm amber color grade. Premium Wallpaper magazine still-life aesthetic. Shallow depth of field on the wine glass rim. Medium format 645, slight film grain. NO text, NO logos, NO watermarks, NO smartphones, NO menus, NO hands visible.",
  "br-executive-lunch-cgm-B":
    "Editorial overhead flat-lay shot of Brazilian executive lunch on rustic dark wooden table: white rice + black beans + grilled chicken + slice of pão on side + sparkling water glass. Beside the plate, a small modern glucose meter device resting casually. Warm overhead window light from upper-right. Premium minimalist food editorial, Cabana magazine aesthetic. Deep amber + warm cedar color grade with rich shadows. Medium format, slight film grain. NO text, NO logos, NO watermarks, NO hands or face visible, NO branded packaging.",
  // Generic fallback when nothing specific is provided. Editor-side editor can still revise.
  "generic-br-premium":
    "Editorial cinematic close-up macro photograph, 4:5 vertical. Premium Brazilian home detail — warm cedar tabletop with neutral linen, soft side window light, deep amber + dark forest color grade. Premium minimalist editorial aesthetic, Cabana magazine. Medium format 645, shallow depth of field, slight film grain, generous negative space upper third for text overlay. NO text, NO logos, NO watermarks, NO white backgrounds, NO pastel filters, NO neon colors.",
};

const { runId, data } = loadData();

// Fallback: pick cover_variant + cover_scene_prompt from content-object.md frontmatter
// if not in render-data.json (so regens don't lose the founder-approved variant).
function readCoverFromContentObject() {
  const coPath = path.join(ROOT, "runs", runId, "content-object.md");
  if (!fs.existsSync(coPath)) return {};
  const txt = fs.readFileSync(coPath, "utf-8");
  const variant = (txt.match(/^cover_variant:\s*(\S+)/m) ?? [])[1] || null;
  const promptMatch = txt.match(/^cover_scene_prompt:\s*(?:>|\|)?\s*(.+)/m);
  let promptStr = promptMatch?.[1]?.trim() || null;
  // Multi-line YAML value support: > or | indicators
  if (promptStr && (txt.includes("cover_scene_prompt: >") || txt.includes("cover_scene_prompt: |"))) {
    // Greedy capture indented lines after the key
    const block = txt.match(/cover_scene_prompt:\s*[>|]\s*\n((?:  .*\n?)+)/);
    if (block) promptStr = block[1].split("\n").map(l => l.replace(/^ {2}/, "")).join(" ").trim();
  }
  return { cover_variant: variant, cover_scene_prompt: promptStr };
}
if (!data.cover_variant && !data.cover_scene_prompt) {
  Object.assign(data, readCoverFromContentObject());
}

const paletteKey = data.palette || "dark_cedar";
const P = PALETTES[paletteKey] || PALETTES.dark_cedar;
const accentColors = { amber: P.STATUS_WARM, sage: P.STATUS_GOOD, warm: P.STATUS_WARM };
const accent = accentColors[data.number_color || "amber"];

const runDir = ensureRunDir(runId);
const bgCachePath = path.join(ROOT, "runs", runId, "_cover-bg.png");

async function ensureLifestyleBg() {
  if (fs.existsSync(bgCachePath)) {
    console.log(`  ↪ reusing cached cover bg`);
    return bgCachePath;
  }
  const variant = data.cover_variant || "generic-br-premium";
  const prompt = data.cover_scene_prompt || COVER_VARIANTS[variant] || COVER_VARIANTS["generic-br-premium"];
  console.log(`  ⏳ Higgsfield gen cover bg (variant=${variant})...`);
  await higgsfieldGenerate({ prompt, aspectRatio: "4:5", resolution: "2k", outPath: bgCachePath, logName: `cover-bg-${runId}` });
  if (!fs.existsSync(bgCachePath)) throw new Error("Higgsfield bg gen produced no file");
  console.log(`  ✓ cover bg cached at runs/${runId}/_cover-bg.png`);
  return bgCachePath;
}

const bgPath = await ensureLifestyleBg();
const bgBuf = await sharp(bgPath).resize(W, H, { fit: "cover", position: "center" }).toBuffer();

// ─── SVG overlay: gradient + text + number ───────────────────────────────────
let svg = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="${P.BG}" stop-opacity="0.85"/>
    <stop offset="55%" stop-color="${P.BG}" stop-opacity="0.0"/>
  </linearGradient>
  <linearGradient id="gb" x1="0" y1="1" x2="0" y2="0">
    <stop offset="0%" stop-color="${P.BG}" stop-opacity="0.78"/>
    <stop offset="45%" stop-color="${P.BG}" stop-opacity="0.0"/>
  </linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <rect width="${W}" height="${H}" fill="url(#gb)"/>`;

if (data.kicker) {
  svg += `<text x="${W/2}" y="${330}" font-family="Inter, sans-serif" font-size="20" font-weight="500" fill="${P.WHITE_FAINT}" text-anchor="middle" letter-spacing="4">${esc(data.kicker)}</text>`;
}

// Número GIGANTE
svg += `<text x="${W/2}" y="${600}" font-family="Inter, sans-serif" font-size="320" font-weight="200" fill="${accent}" text-anchor="middle" letter-spacing="-12">${esc(data.number || "—")}</text>`;

if (data.headline_1) {
  svg += `<text x="${W/2}" y="${740}" font-family="Inter, sans-serif" font-size="32" font-weight="400" fill="${P.WHITE}" text-anchor="middle" letter-spacing="-0.5">${esc(data.headline_1)}</text>`;
}
if (data.headline_2_italic) {
  svg += `<text x="${W/2}" y="${782}" font-family="Georgia, serif" font-style="italic" font-size="32" font-weight="400" fill="${P.WHITE}" text-anchor="middle">${esc(data.headline_2_italic)}</text>`;
}

const bodyLines = data.body || [];
bodyLines.forEach((ln, i) => {
  svg += `<text x="${W/2}" y="${890 + i * 30}" font-family="Inter, sans-serif" font-size="20" font-weight="400" fill="${P.WHITE_SOFT}" text-anchor="middle">${esc(ln)}</text>`;
});

if (data.closing_italic) {
  const closingY = 890 + bodyLines.length * 30 + 50;
  svg += `<text x="${W/2}" y="${closingY}" font-family="Georgia, serif" font-style="italic" font-size="22" font-weight="400" fill="${P.WHITE}" text-anchor="middle">${esc(data.closing_italic)}</text>`;
}

if (data.footer_source) {
  svg += `<text x="${W/2}" y="${1110}" font-family="Courier New, monospace" font-size="13" font-weight="500" fill="${P.WHITE_FAINT}" text-anchor="middle" letter-spacing="2.5">${esc(data.footer_source)}</text>`;
}

// Composite: bg → svg overlay (text) → logo
const overlay = await sharp(Buffer.from(svgWrap(svg))).png().toBuffer();
const composited = await sharp(bgBuf).composite([{ input: overlay, top: 0, left: 0 }]).png().toBuffer();
const outPath = path.join(runDir, "slide-1-cover.png");
const withLogo = await compositeLogo(composited, { paletteKey });
fs.writeFileSync(outPath, withLogo);
console.log(`✓ ${path.relative(ROOT, outPath)} (dado-punch lifestyle-bg, palette=${paletteKey})`);

// Validate (advisory — log warnings, don't fail).
try {
  const v = await validateCover(outPath);
  const icon = v.verdict === "pass" ? "✓" : v.verdict === "warn" ? "⚠" : "✗";
  console.log(`  ${icon} cover-validator: ${v.verdict.toUpperCase()} — lum_std=${v.metrics?.lum_std} solid=${(v.metrics?.solid_pct*100 ?? 0).toFixed(0)}%`);
  if (v.verdict === "fail") {
    console.log(`  ⚠️ Cover failed brand rule. Inspect runs/${runId}/_cover-bg.png — try a different cover_variant in content-object.md.`);
  }
} catch (e) {
  console.log(`  (validator skipped: ${e.message?.slice(0, 80)})`);
}
