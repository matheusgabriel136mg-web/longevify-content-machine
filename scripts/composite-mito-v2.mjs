import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";

const W = 1080, H = 1350;
const FOREST = "#1C3F3A";
const TEXT = "#f8fffc";
const GOLD = "#C89136";
const padX = 80;

const bgPath = "/tmp/longevify-covers/mito-v2-raw.png";
const outPath = "/tmp/longevify-covers/mito-v2-composed.png";

const bgBuf = await sharp(bgPath).resize(W, H, { fit: "cover", position: "center" }).toBuffer();

// Gradient: forest opaco no topo (deixa texto legível sobre céu)
const grad = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0%" stop-color="${FOREST}" stop-opacity="0.82"/>
  <stop offset="40%" stop-color="${FOREST}" stop-opacity="0.0"/>
</linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#g)"/>`;

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

const headline = "A célula que decide\nse você envelhece bem.";
const micro = "Não é o coração. Não é o cérebro.";
const headFont = 70;
const hLines = wrap(headline, 22);
const startY = 230;

const textXml = hLines.map((ln, i) =>
  `<text x="${padX}" y="${startY + i * headFont * 1.12}" font-family="DM Sans, Helvetica, Arial, sans-serif" font-size="${headFont}" font-weight="300" fill="${TEXT}" letter-spacing="-1.3">${ln}</text>`
).join("");

const microY = startY + hLines.length * headFont * 1.12 + 50;
const microXml = `<text x="${padX}" y="${microY}" font-family="Georgia, serif" font-size="22" font-style="italic" fill="${TEXT}" opacity="0.88">${micro}</text>`;

const numXml = `<text x="${padX}" y="115" font-family="DM Sans, Helvetica, Arial, sans-serif" font-size="22" font-weight="400" fill="${GOLD}" letter-spacing="2.5">01 / 05</text>`;

const overlaySvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${grad}${numXml}${textXml}${microXml}</svg>`;

let img = sharp(bgBuf).composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }]);

// Logo bottom-center
const LOGO = "/Users/mathe/Documents/Longev/Brand/Longevify/content-machine/assets/logo-horizontal-white.png";
const trimmed = await sharp(LOGO).trim().toBuffer({ resolveWithObject: true });
const cropH = Math.round(trimmed.info.height * 0.78);
const wordmark = await sharp(trimmed.data).extract({ left: 0, top: 0, width: trimmed.info.width, height: cropH }).toBuffer();
const logoW = Math.round(W * 0.22);
const logoBuf = await sharp(wordmark).resize(logoW).toBuffer();
const logoMeta = await sharp(logoBuf).metadata();
const logoX = Math.round((W - logoW) / 2);
const logoY = Math.round(H - (logoMeta.height ?? 80) - 70);
const compBuf = await img.png().toBuffer();
img = sharp(compBuf).composite([{ input: logoBuf, left: logoX, top: logoY }]);

await img.png().toFile(outPath);
console.log(`✓ ${outPath}`);
