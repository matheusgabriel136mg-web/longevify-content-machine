// Composite cover editorial: foto Higgsfield + forest gradient overlay + texto Sharp
// Modo: gradient só no topo (40% da altura) pra deixar foto respirar embaixo

import sharp from "sharp";
import * as fs from "fs";

const W = 1080, H = 1350;
const FOREST = "#1C3F3A";
const TEXT = "#f8fffc";
const GOLD = "#C89136";

async function composite(bgPath, outPath, opts) {
  const { numeration, headline, micro, gradientPos = "top", gradientStrength = 0.85 } = opts;

  // 1. Resize bg foto pra 1080x1350 cover
  const bgBuf = await sharp(bgPath).resize(W, H, { fit: "cover", position: "center" }).toBuffer();

  // 2. SVG overlay com gradient + text
  const padX = 80;
  // Gradient: forest opaco no topo fade pra transparente
  const grad = gradientPos === "top"
    ? `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
         <stop offset="0%" stop-color="${FOREST}" stop-opacity="${gradientStrength}"/>
         <stop offset="55%" stop-color="${FOREST}" stop-opacity="0.0"/>
       </linearGradient></defs>
       <rect width="${W}" height="${H}" fill="url(#g)"/>`
    : `<defs><linearGradient id="g" x1="0" y1="1" x2="0" y2="0">
         <stop offset="0%" stop-color="${FOREST}" stop-opacity="${gradientStrength}"/>
         <stop offset="55%" stop-color="${FOREST}" stop-opacity="0.0"/>
       </linearGradient></defs>
       <rect width="${W}" height="${H}" fill="url(#g)"/>`;

  // Text: numeration top-left, headline centered upper-third
  // Word-wrap simples
  const wrap = (text, maxChars) => {
    const segs = text.split("\n");
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
  };

  const headFont = 76;
  const hLines = wrap(headline, 24);
  const startY = 250;
  const textXml = hLines.map((ln, i) =>
    `<text x="${padX}" y="${startY + i * headFont * 1.15}" font-family="DM Sans, Helvetica, Arial, sans-serif" font-size="${headFont}" font-weight="300" fill="${TEXT}" letter-spacing="-1.5">${ln.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`
  ).join("");

  const microXml = micro
    ? `<text x="${padX}" y="${startY + hLines.length * headFont * 1.15 + 50}" font-family="Georgia, serif" font-size="22" font-style="italic" fill="${TEXT}" opacity="0.85">${micro.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`
    : "";

  const numXml = numeration
    ? `<text x="${padX}" y="120" font-family="DM Sans, Helvetica, Arial, sans-serif" font-size="22" font-weight="400" fill="${GOLD}" letter-spacing="2.5">${numeration.toUpperCase()}</text>`
    : "";

  const overlaySvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${grad}${numXml}${textXml}${microXml}</svg>`;

  // 3. Composite bg + overlay
  let img = sharp(bgBuf).composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }]);

  // 4. Logo bottom-center
  const LOGO = "/Users/mathe/Documents/Longev/Brand/Longevify/content-machine/assets/logo-horizontal-white.png";
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
  console.log(`✓ ${outPath}`);
}

await composite("/tmp/longevify-covers/glute-raw.png", "/tmp/longevify-covers/glute-composed.png", {
  numeration: "01 / 05",
  headline: "Glúteo não é\nestética.",
  micro: "É longevidade.",
});

await composite("/tmp/longevify-covers/mito-raw.png", "/tmp/longevify-covers/mito-composed.png", {
  numeration: "01 / 05",
  headline: "A célula que decide\nse você envelhece bem.",
  micro: "Não é o coração. Não é o cérebro.",
  gradientPos: "top",
});
