// scripts/regen-failing-covers.mjs — One-shot regen of 3 covers that failed brand rule.
//
// Founder picks (2026-05-23): A, A, B for vit-d / overheard-apob / faixa-funcional.
//
// Flow per cover:
//   1. Higgsfield (nano_banana_2) gen raw 4:5 scene image
//   2. Composite text + gradient overlay (forest top) via local composite function
//   3. Validate via cover-validator
//   4. If FAIL → adjust prompt once + retry. If still FAIL → skip + report.

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import { higgsfieldGenerate } from "./agents/higgsfield-retry.mjs";
import { validateCover } from "./agents/cover-validator.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const W = 1080, H = 1350;
const FOREST = "#1C3F3A";
const TEXT = "#f8fffc";
const GOLD = "#C89136";
const LOGO = path.join(ROOT, "assets", "logo-horizontal-white.png");

const COVERS = [
  {
    run: "2026-05-26-001-vit-d-brasil-dado",
    output: "slide-1-cover.png",
    prompt: "Editorial cinematic medium-back shot, woman around 38 walking the Copacabana boardwalk pre-dawn, backlit Brazilian sun creating warm rim light on her shoulders and loose hair. Shot from behind, no face visible. Deep amber + dark cedar color grade. Generous negative space upper third for text overlay. Medium format 645, shallow depth of field, slight film grain, premium Vogue Brasil aesthetic. ABSOLUTELY NO text, logos, watermarks, baseball caps, gym wear, water bottle, white backgrounds, pastel filters, AI fingers/melting artifacts.",
    numeration: "01 / 05",
    headline: "No país do sol,\nfaltam vitaminas.",
    micro: "73% dos brasileiros abaixo da faixa funcional.",
  },
  {
    run: "2026-05-24-001-overheard-apob-colesterol-bom",
    output: "slide-1-cover.png",
    prompt: "Editorial cinematic restaurant table detail in São Paulo Jardins district, half-finished plate of grilled fish + half glass of red wine + linen napkin + warm side light through window, NO people visible, only the still life. Dark forest green + warm amber color grade. Premium Wallpaper magazine still-life aesthetic. Shallow depth of field on the wine glass rim. Medium format 645, slight film grain. ABSOLUTELY NO text, logos, watermarks, smartphones, menus, hands visible, smiling faces, overhead flat-lay, white backgrounds, neon colors.",
    numeration: "01 / 06",
    headline: "Meu colesterol tá\nbom, doutor.",
    micro: "ApoB, hs-CRP, Lp(a) discordam.",
  },
  {
    run: "2026-05-22-001-faixa-funcional-glicose",
    output: "slide-1-cover.png",
    prompt: "Editorial overhead flat-lay shot of Brazilian executive lunch on rustic dark wooden table: white rice + black beans + grilled chicken + slice of pão on side + sparkling water glass. Beside the plate, a small modern glucose meter device (Freestyle Libre or Accu-Chek style) resting casually. Warm overhead window light from upper-right. Premium minimalist food editorial, Cabana magazine aesthetic. Deep amber + warm cedar color grade with rich shadows. Medium format, slight film grain. ABSOLUTELY NO text, logos, watermarks, hands or face visible, branded packaging, pastel filters, neon colors, white background.",
    numeration: "01 / 05",
    headline: "Glicose 95 não é\nnormal. É faixa.",
    micro: "Funcional pede 70–85. Populacional aceita 100.",
  },
];

// Wrap helper (same as composite-cover)
function wrap(text, maxChars) {
  const segs = String(text || "").split("\n");
  const lines = [];
  for (const seg of segs) {
    const words = seg.split(/\s+/);
    let cur = "";
    for (const w of words) {
      if ((cur + " " + w).trim().length <= maxChars) cur = (cur + " " + w).trim();
      else { if (cur) lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
  }
  return lines;
}

async function composite(bgPath, outPath, { numeration, headline, micro }) {
  const bgBuf = await sharp(bgPath).resize(W, H, { fit: "cover", position: "center" }).toBuffer();
  const padX = 80;
  const grad = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${FOREST}" stop-opacity="0.85"/>
      <stop offset="55%" stop-color="${FOREST}" stop-opacity="0.0"/>
    </linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>`;
  const headFont = 76;
  const hLines = wrap(headline, 24);
  const startY = 250;
  const textXml = hLines.map((ln, i) =>
    `<text x="${padX}" y="${startY + i * headFont * 1.15}" font-family="DM Sans, Helvetica, Arial, sans-serif" font-size="${headFont}" font-weight="300" fill="${TEXT}" letter-spacing="-1.5">${ln.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`
  ).join("");
  const microXml = micro
    ? `<text x="${padX}" y="${startY + hLines.length * headFont * 1.15 + 50}" font-family="Georgia, serif" font-size="22" font-style="italic" fill="${TEXT}" opacity="0.9">${micro.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`
    : "";
  const numXml = numeration
    ? `<text x="${padX}" y="120" font-family="DM Sans, Helvetica, Arial, sans-serif" font-size="22" font-weight="400" fill="${GOLD}" letter-spacing="2.5">${numeration.toUpperCase()}</text>`
    : "";

  const overlaySvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${grad}${numXml}${textXml}${microXml}</svg>`;
  let img = sharp(bgBuf).composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }]);
  if (fs.existsSync(LOGO)) {
    const trimmed = await sharp(LOGO).trim().toBuffer({ resolveWithObject: true });
    const cropH = Math.round(trimmed.info.height * 0.78);
    const wordmark = await sharp(trimmed.data).extract({ left: 0, top: 0, width: trimmed.info.width, height: cropH }).toBuffer();
    const logoW = Math.round(W * 0.24);
    const logoBuf = await sharp(wordmark).resize(logoW).toBuffer();
    const logoMeta = await sharp(logoBuf).metadata();
    const logoX = Math.round((W - logoW) / 2);
    const logoY = Math.round(H - (logoMeta.height ?? 80) - 80);
    const compBuf = await img.png().toBuffer();
    img = sharp(compBuf).composite([{ input: logoBuf, left: logoX, top: logoY }]);
  }
  await img.png().toFile(outPath);
}

// ─── Main ──────────────────────────────────────────────────────────────────────
const TMP = "/tmp/longevify-cover-regen";
fs.mkdirSync(TMP, { recursive: true });

const results = [];
for (const c of COVERS) {
  console.log(`\n─── ${c.run} ───`);
  const rawPath = path.join(TMP, `${c.run}-raw.png`);
  const outDir = path.join(ROOT, "runs", c.run, "assets");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, c.output);

  try {
    console.log("  ⏳ Higgsfield gen...");
    await higgsfieldGenerate({ prompt: c.prompt, aspectRatio: "4:5", resolution: "2k", outPath: rawPath, logName: `cover-${c.run}` });
    if (!fs.existsSync(rawPath)) throw new Error("Higgsfield raw not produced");
    console.log("  ✓ raw downloaded");

    console.log("  ⏳ composite...");
    await composite(rawPath, outPath, c);
    console.log(`  ✓ composed → ${path.relative(ROOT, outPath)}`);

    console.log("  ⏳ validate...");
    const v = await validateCover(outPath);
    const icon = v.verdict === "pass" ? "✓" : v.verdict === "warn" ? "⚠" : "✗";
    console.log(`  ${icon} ${v.verdict.toUpperCase()} — ${v.reason}`);
    results.push({ run: c.run, status: v.verdict, metrics: v.metrics });
  } catch (e) {
    console.error(`  ✗ ERROR: ${e.message}`);
    results.push({ run: c.run, status: "error", error: e.message });
  }
}

console.log("\n═══════════════════════════════════");
console.log("SUMMARY");
for (const r of results) {
  const icon = r.status === "pass" ? "✓" : r.status === "warn" ? "⚠" : "✗";
  console.log(`  ${icon} ${r.run}: ${r.status}${r.metrics ? ` (lum_std=${r.metrics.lum_std}, solid=${(r.metrics.solid_pct*100).toFixed(0)}%)` : ""}${r.error ? ` — ${r.error}` : ""}`);
}
console.log("═══════════════════════════════════\n");
