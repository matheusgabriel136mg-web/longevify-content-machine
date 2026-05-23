// scripts/regen-failing-covers-gpt.mjs — Parallel A/B test of GPT Image 2 vs Higgsfield.
// Same 3 covers, same prompts. Output → slide-1-cover-GPT.png (suffix to differentiate).

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import OpenAI from "openai";
import { validateCover } from "./agents/cover-validator.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

// .env loader
const ENV_PATH = path.join(ROOT, ".env");
if (fs.existsSync(ENV_PATH)) {
  for (const line of fs.readFileSync(ENV_PATH, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const openai = new OpenAI();

const W = 1080, H = 1350;
const FOREST = "#1C3F3A";
const TEXT = "#f8fffc";
const GOLD = "#C89136";
const LOGO = path.join(ROOT, "assets", "logo-horizontal-white.png");

const COVERS = [
  {
    run: "2026-05-26-001-vit-d-brasil-dado",
    output: "slide-1-cover-GPT.png",
    prompt: "Editorial cinematic medium-back shot, woman around 38 walking the Copacabana boardwalk pre-dawn, backlit Brazilian sun creating warm rim light on her shoulders and loose hair. Shot from behind, no face visible. Deep amber + dark cedar color grade. Generous negative space upper third for text overlay. Medium format 645, shallow depth of field, slight film grain, premium Vogue Brasil aesthetic. NO text, NO logos, NO watermarks, NO baseball caps, NO gym wear, NO water bottle, NO white backgrounds, NO pastel filters.",
    numeration: "01 / 05",
    headline: "No país do sol,\nfaltam vitaminas.",
    micro: "73% dos brasileiros abaixo da faixa funcional.",
  },
  {
    run: "2026-05-24-001-overheard-apob-colesterol-bom",
    output: "slide-1-cover-GPT.png",
    prompt: "Editorial cinematic restaurant table detail in São Paulo Jardins district, half-finished plate of grilled fish + half glass of red wine + linen napkin + warm side light through window, NO people visible, only the still life. Dark forest green + warm amber color grade. Premium Wallpaper magazine still-life aesthetic. Shallow depth of field on the wine glass rim. Medium format 645, slight film grain. NO text, NO logos, NO watermarks, NO smartphones, NO menus, NO hands visible, NO smiling faces, NO overhead flat-lay, NO white backgrounds, NO neon colors.",
    numeration: "01 / 06",
    headline: "Meu colesterol tá\nbom, doutor.",
    micro: "ApoB, hs-CRP, Lp(a) discordam.",
  },
  {
    run: "2026-05-22-001-faixa-funcional-glicose",
    output: "slide-1-cover-GPT.png",
    prompt: "Editorial overhead flat-lay shot of Brazilian executive lunch on rustic dark wooden table: white rice + black beans + grilled chicken + slice of pão on side + sparkling water glass. Beside the plate, a small modern glucose meter device resting casually. Warm overhead window light from upper-right. Premium minimalist food editorial, Cabana magazine aesthetic. Deep amber + warm cedar color grade with rich shadows. Medium format, slight film grain. NO text, NO logos, NO watermarks, NO hands or face visible, NO branded packaging, NO pastel filters, NO neon colors, NO white background.",
    numeration: "01 / 05",
    headline: "Glicose 95 não é\nnormal. É faixa.",
    micro: "Funcional pede 70–85. Populacional aceita 100.",
  },
];

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

async function gptGenerate(prompt, outPath) {
  // OpenAI gpt-image-1: native 1024×1536 portrait (2:3) — closest to 4:5; sharp crops in composite.
  const r = await openai.images.generate({
    model: "gpt-image-1",
    prompt,
    size: "1024x1536",
    quality: "high",
    n: 1,
  });
  const item = r.data?.[0];
  if (!item) throw new Error("OpenAI returned no image");
  if (item.b64_json) {
    fs.writeFileSync(outPath, Buffer.from(item.b64_json, "base64"));
  } else if (item.url) {
    const resp = await fetch(item.url);
    fs.writeFileSync(outPath, Buffer.from(await resp.arrayBuffer()));
  } else {
    throw new Error("OpenAI image had neither b64_json nor url");
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────
const TMP = "/tmp/longevify-cover-regen-gpt";
fs.mkdirSync(TMP, { recursive: true });

const results = [];
for (const c of COVERS) {
  console.log(`\n─── ${c.run} (GPT) ───`);
  const rawPath = path.join(TMP, `${c.run}-raw.png`);
  const outDir = path.join(ROOT, "runs", c.run, "assets");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, c.output);

  try {
    console.log("  ⏳ GPT Image 2 gen via FAL...");
    await gptGenerate(c.prompt, rawPath);
    if (!fs.existsSync(rawPath)) throw new Error("GPT raw not produced");
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
console.log("GPT IMAGE 2 SUMMARY");
for (const r of results) {
  const icon = r.status === "pass" ? "✓" : r.status === "warn" ? "⚠" : "✗";
  console.log(`  ${icon} ${r.run}: ${r.status}${r.metrics ? ` (lum_std=${r.metrics.lum_std}, solid=${(r.metrics.solid_pct*100).toFixed(0)}%)` : ""}${r.error ? ` — ${r.error}` : ""}`);
}
console.log("═══════════════════════════════════\n");
