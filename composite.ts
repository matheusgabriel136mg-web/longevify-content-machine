/**
 * composite.ts — Composita logo real da Longevify + legenda sobre imagem gerada por IA.
 *
 * Pipeline:
 *   1. Imagem gerada (NB2 / Flux / GPT) — foto limpa, sem texto
 *   2. Logo real sobreposto via sharp (blend: screen — bg escuro some, logo mint aparece)
 *   3. Texto da legenda via SVG (fonte sistema, peso 300, lettering editorial)
 *   4. Vignette suave nas bordas (darkens edges, Longevify mood)
 */

import sharp from "sharp";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Logo: versão mint clara sobre fundo preto-floresta (#000F08)
// Blend: screen — fundo escuro some, logo mint fica visível sobre qualquer imagem escura
const LOGO_PATH = path.resolve(
  __dirname,
  "assets/logo-horizontal-white.png"
);

export interface CompositeOptions {
  /** Texto principal centralizado (ex: "Agora em mais cidades.") */
  caption?: string;
  /** Sublinha menor em teal (ex: "longevify.com.br") */
  subline?: string;
  /** Largura do logo como fração da imagem — default: 0.52 */
  logoScale?: number;
  /** Posição vertical do logo como fração — default: 0.48 (centro-baixo) */
  logoY?: number;
  /** Posição vertical da legenda como fração — default: 0.30 */
  captionY?: number;
  /** Extensão de saída: "jpg" | "png" — default: "jpg" */
  format?: "jpg" | "png";
}

export async function compositeLogoAndText(
  inputPath: string,
  outputPath: string,
  options: CompositeOptions = {}
): Promise<void> {
  const {
    caption,
    subline,
    logoScale = 0.52,
    logoY = 0.48,
    captionY = 0.30,
    format = "jpg",
  } = options;

  const base = sharp(inputPath);
  const { width: W = 1024, height: H = 1024 } = await base.metadata();

  const overlays: sharp.OverlayOptions[] = [];

  // ── 1. Vignette (sobreposta via multiply — escurece bordas) ─────────────────
  const vignetteSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <radialGradient id="vig" cx="50%" cy="50%" r="65%" gradientUnits="objectBoundingBox">
        <stop offset="0%"   stop-color="#000000" stop-opacity="0.00"/>
        <stop offset="60%"  stop-color="#000000" stop-opacity="0.10"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.55"/>
      </radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#vig)"/>
  </svg>`;

  overlays.push({
    input: Buffer.from(vignetteSvg),
    blend: "over",
  });

  // ── 2. Legenda / caption (SVG com tipografia editorial) ────────────────────
  if (caption || subline) {
    const fontSize = Math.round(W * 0.032);   // ~33px em 1024
    const subSize  = Math.round(W * 0.016);   // ~16px
    const lineGap  = Math.round(fontSize * 1.8);
    const textBlockH = lineGap + subSize + 20;
    const textTop = Math.round(H * captionY);

    let svgContent = "";

    if (caption) {
      svgContent += `<text
        x="50%" y="${fontSize}"
        text-anchor="middle"
        dominant-baseline="auto"
        font-family="Helvetica Neue,Helvetica,Arial,sans-serif"
        font-size="${fontSize}"
        font-weight="300"
        fill="#ffffff"
        fill-opacity="0.95"
      >${escapeXml(caption)}</text>`;
    }

    if (subline) {
      svgContent += `<text
        x="50%" y="${fontSize + lineGap * 0.55}"
        text-anchor="middle"
        dominant-baseline="auto"
        font-family="Helvetica Neue,Helvetica,Arial,sans-serif"
        font-size="${subSize}"
        font-weight="400"
        fill="#5BAE9E"
        fill-opacity="0.90"
      >${escapeXml(subline.toUpperCase())}</text>`;
    }

    const textSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${textBlockH}">
      ${svgContent}
    </svg>`;

    overlays.push({
      input: Buffer.from(textSvg),
      top: textTop,
      left: 0,
    });
  }

  // ── 3. Logo real (page-002: mint sobre #000F08, blend: screen) ─────────────
  if (fs.existsSync(LOGO_PATH)) {
    // Trim dark background, resize to logoScale% da largura
    const logoTargetW = Math.round(W * logoScale);

    const logoBuffer = await sharp(LOGO_PATH)
      .resize(logoTargetW, null, { withoutEnlargement: false, fit: "inside" })
      .toBuffer();

    const logoMeta = await sharp(logoBuffer).metadata();
    const logoH = logoMeta.height ?? 80;
    const logoLeft = Math.round((W - logoTargetW) / 2);
    const logoTop = Math.round(H * logoY);

    overlays.push({
      input: logoBuffer,
      top: logoTop,
      left: logoLeft,
      blend: "over",
    });

    // Linha separadora teal sutil abaixo do logo (assinatura editorial)
    const lineW = Math.round(logoTargetW * 0.18);
    const lineSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${lineW}" height="2">
      <rect width="${lineW}" height="1" fill="#5BAE9E" fill-opacity="0.50"/>
    </svg>`;

    overlays.push({
      input: Buffer.from(lineSvg),
      top: logoTop + logoH + 12,
      left: Math.round((W - lineW) / 2),
    });
  } else {
    console.warn(`⚠️  Logo não encontrado em: ${LOGO_PATH}`);
  }

  // ── Compose & save ──────────────────────────────────────────────────────────
  const pipeline = base.composite(overlays);

  if (format === "png") {
    await pipeline.png({ compressionLevel: 8 }).toFile(outputPath);
  } else {
    await pipeline.jpeg({ quality: 94 }).toFile(outputPath);
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
