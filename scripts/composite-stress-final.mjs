// Composite final: palitos + texto SP-style PT-BR + logo dark
import sharp from "sharp";
import * as fs from "fs";

const W = 1080, H = 1350;
const DARK = "#f8fffc";       // BRANCO (cream off-white) pra headline
const DARK_SOFT = "#f8fffcCC"; // Branco com 80% opacity pra subhead
const padX = 90;

const bgPath = "/tmp/longevify-covers/stress-final-raw.png";
const outPath = "/tmp/longevify-covers/stress-final-composed.png";

const bgBuf = await sharp(bgPath).resize(W, H, { fit: "cover", position: "center" }).toBuffer();

// SP usa headline grande + sub menor + nada mais. Sem gradient (fundo já é claro).
// Quebra balanceada: "Cortisol está te queimando" / "em silêncio." (italic na 2ª linha)
const headlineLine1 = "Cortisol está te queimando";
const headlineLine2 = "em silêncio.";  // italic Georgia
const sub = "Crie um protocolo pra restaurar o ritmo.";

const headFont = 84;
const startY = 360;

// Line 1: Inter Light (peso 300) — texto factual
// Line 2: Georgia Italic — poesia editorial Aesop
const head1Xml = `<text x="${W/2}" y="${startY}" font-family="Inter, Helvetica, Arial, sans-serif" font-size="${headFont}" font-weight="300" fill="${DARK}" text-anchor="middle" letter-spacing="-2">${headlineLine1}</text>`;

const head2Xml = `<text x="${W/2}" y="${startY + headFont * 1.1}" font-family="Georgia, serif" font-style="italic" font-size="${headFont}" font-weight="400" fill="${DARK}" text-anchor="middle" letter-spacing="-1">${headlineLine2}</text>`;

const headXml = head1Xml + head2Xml;

// Mais respiro entre headline e sub
const subY = startY + 2 * headFont * 1.1 + 70;
const subXml = `<text x="${W/2}" y="${subY}" font-family="Inter, Helvetica, Arial, sans-serif" font-size="32" font-weight="400" fill="${DARK_SOFT}" text-anchor="middle" letter-spacing="0.3">${sub}</text>`;

// Sem kicker — SP não tem
const kickerXml = "";

const overlaySvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${kickerXml}${headXml}${subXml}</svg>`;
let img = sharp(bgBuf).composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }]);

// Logo bottom-center, dark forest version
const LOGO = "/Users/mathe/Documents/Longev/Brand/Longevify/content-machine/assets/logo-horizontal-white.png";
const trimmed = await sharp(LOGO).trim().toBuffer({ resolveWithObject: true });
const cropH = Math.round(trimmed.info.height * 0.78);
const wordmark = await sharp(trimmed.data).extract({ left: 0, top: 0, width: trimmed.info.width, height: cropH }).toBuffer();
const logoW = Math.round(W * 0.25); // LOCKED 25% — consistência feed (CLAUDE.md rule)
const logoResized = await sharp(wordmark).resize(logoW).toBuffer();
// Logo BRANCA (original, sem tint)
const tinted = logoResized;
const logoMeta = await sharp(tinted).metadata();
const logoX = Math.round((W - logoW) / 2);
const logoY = Math.round(H - (logoMeta.height ?? 80) - 50);
const compBuf = await img.png().toBuffer();
img = sharp(compBuf).composite([{ input: tinted, left: logoX, top: logoY }]);

await img.png().toFile(outPath);
console.log(`✓ ${outPath}`);
