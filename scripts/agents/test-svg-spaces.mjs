// Isolated test: does sharp/libvips collapse whitespace in SVG <text>?
import sharp from "sharp";
import * as fs from "fs";

const W = 1080, H = 100;
const tests = [
  { name: "plain", svg: `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="#1A1916"/><text x="80" y="60" font-family="Inter, sans-serif" font-size="32" fill="#FFF">O ruído aparece antes</text></svg>` },
  { name: "xml-preserve", svg: `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="#1A1916"/><text x="80" y="60" font-family="Inter, sans-serif" font-size="32" fill="#FFF" xml:space="preserve">O ruído aparece antes</text></svg>` },
  { name: "letter-spacing-neg2", svg: `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="#1A1916"/><text x="80" y="60" font-family="Inter, sans-serif" font-size="32" fill="#FFF" letter-spacing="-2">SEROTONINA INTESTINAL</text></svg>` },
  { name: "letter-spacing-pos2", svg: `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="#1A1916"/><text x="80" y="60" font-family="Inter, sans-serif" font-size="32" fill="#FFF" letter-spacing="2">SEROTONINA INTESTINAL</text></svg>` },
];

async function renderAndInspect(t) {
  const outPath = `/tmp/test-svg-${t.name}.png`;
  await sharp(Buffer.from(t.svg)).png().toFile(outPath);
  // Count light pixels per row at y=60 (text baseline) ±15.
  const raw = await sharp(outPath).removeAlpha().raw().toBuffer();
  let lightCols = [];
  for (let x = 0; x < W; x++) {
    let lightCount = 0;
    for (let y = 45; y < 75; y++) {
      const i = (y * W + x) * 3;
      const lum = raw[i] * 0.299 + raw[i + 1] * 0.587 + raw[i + 2] * 0.114;
      if (lum > 180) lightCount++;
    }
    if (lightCount >= 2) lightCols.push(x);
  }
  // Find leftmost + rightmost light col + count of "gap" between sequential cols >= 3 px
  const gaps = [];
  for (let i = 1; i < lightCols.length; i++) {
    const g = lightCols[i] - lightCols[i - 1];
    if (g >= 3) gaps.push(g);
  }
  console.log(`${t.name}: textCols=${lightCols.length}, leftX=${lightCols[0]}, rightX=${lightCols[lightCols.length-1]}, gaps>=3px=${gaps.length}, sampleGaps=${gaps.slice(0, 6).join(",")}`);
  return outPath;
}

for (const t of tests) await renderAndInspect(t);
