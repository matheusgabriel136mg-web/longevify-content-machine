import sharp from "sharp";
import * as fs from "fs";

const W = 1080, H = 1350;
const DARK = "#1C3F3A";   // Forest forte pro texto principal sobre warm cream
const DARK_SOFT = "#3B5D58"; // Sub
const GOLD = "#8B7240";   // Gold mais escuro pra warm cream (em vez de #C89136 saturado)
const padX = 80;

async function composite(bgPath, outPath, opts) {
  const { headline, micro, numeration = "01 / 05", gradientStrength = 0.4 } = opts;
  const bgBuf = await sharp(bgPath).resize(W, H, { fit: "cover", position: "center" }).toBuffer();

  // Gradient: cream MUITO suave no topo, só pra dar mais espaço pro texto se a foto já for clara
  // Em fundos warm cream isso é mínimo
  const grad = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#D8D2C5" stop-opacity="${gradientStrength}"/>
    <stop offset="50%" stop-color="#D8D2C5" stop-opacity="0"/>
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
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

  const headFont = 76;
  const hLines = wrap(headline, 22);
  const startY = 220;

  const textXml = hLines.map((ln, i) =>
    `<text x="${padX}" y="${startY + i * headFont * 1.12}" font-family="DM Sans, Helvetica, Arial, sans-serif" font-size="${headFont}" font-weight="500" fill="${DARK}" letter-spacing="-1.5">${esc(ln)}</text>`
  ).join("");

  const microY = startY + hLines.length * headFont * 1.12 + 50;
  const microXml = micro
    ? `<text x="${padX}" y="${microY}" font-family="DM Sans, Helvetica, Arial, sans-serif" font-size="28" font-weight="400" fill="${DARK_SOFT}">${esc(micro)}</text>`
    : "";

  const numXml = `<text x="${padX}" y="115" font-family="DM Sans, Helvetica, Arial, sans-serif" font-size="22" font-weight="400" fill="${GOLD}" letter-spacing="2.5">${esc(numeration.toUpperCase())}</text>`;

  const overlaySvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${grad}${numXml}${textXml}${microXml}</svg>`;

  let img = sharp(bgBuf).composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }]);

  // Logo bottom-center — usar versão DARK do logo pra warm cream bg
  // Por enquanto usa o white com opacity reduzida — funciona razoavelmente em cream
  const LOGO = "/Users/mathe/Documents/Longev/Brand/Longevify/content-machine/assets/logo-horizontal-white.png";
  if (fs.existsSync(LOGO)) {
    const trimmed = await sharp(LOGO).trim().toBuffer({ resolveWithObject: true });
    const cropH = Math.round(trimmed.info.height * 0.78);
    const wordmark = await sharp(trimmed.data).extract({ left: 0, top: 0, width: trimmed.info.width, height: cropH }).toBuffer();
    // Inverte: white → dark forest
    const logoW = Math.round(W * 0.22);
    const logoResized = await sharp(wordmark).resize(logoW).toBuffer();
    // Tint pra forest dark
    const tinted = await sharp(logoResized)
      .negate({ alpha: false })  // inverte branco→preto
      .tint({ r: 28, g: 63, b: 58 }) // tint forest
      .toBuffer();
    const logoMeta = await sharp(tinted).metadata();
    const logoX = Math.round((W - logoW) / 2);
    const logoY = Math.round(H - (logoMeta.height ?? 80) - 70);
    const compBuf = await img.png().toBuffer();
    img = sharp(compBuf).composite([{ input: tinted, left: logoX, top: logoY }]);
  }

  await img.png().toFile(outPath);
}

// A — palitos: hook adaptado direto da SP
await composite("/tmp/longevify-covers/stress-a-raw.png", "/tmp/longevify-covers/stress-a-composed.png", {
  headline: "Cortisol tá\nte queimando?",
  micro: "Como ler o ritmo antes do colapso.",
  numeration: "01 / 05",
});
console.log("✓ A composed");

// B — vela: hook mais Aesop poético
await composite("/tmp/longevify-covers/stress-b-raw.png", "/tmp/longevify-covers/stress-b-composed.png", {
  headline: "Cortisol queima\nem silêncio.",
  micro: "O ritmo tem assinatura.",
  numeration: "01 / 05",
});
console.log("✓ B composed");
