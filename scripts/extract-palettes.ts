/**
 * extract-palettes.ts — extrai paletas dos PNGs de gradiente Longevify.
 *
 * Lê /Users/mathe/Documents/Longev/Brand/_degrades/_png/*.png
 * Pra cada gradiente, sampleia 5 cores nas posições 5%, 25%, 50%, 75%, 95%
 * e salva como JSON com hex codes.
 *
 * Output: ../../_degrades/longevify-palettes.json + content-machine/LONGEVIFY_PALETTES.json
 *
 * Uso: npm run extract-palettes
 */

import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);

const PNG_DIR = "/Users/mathe/Documents/Longev/Brand/_degrades/_png";
const SAMPLE_POSITIONS = [0.05, 0.25, 0.5, 0.75, 0.95];

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}

async function extractPalette(pngPath: string): Promise<string[]> {
  const img = sharp(pngPath);
  const meta = await img.metadata();
  const w = meta.width ?? 1000;
  const h = meta.height ?? 600;
  const yCenter = Math.floor(h / 2);

  // Pega raw pixel data (RGB sem alpha)
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const stride = info.width * channels;

  const colors: string[] = [];
  for (const pos of SAMPLE_POSITIONS) {
    const x = Math.floor(w * pos);
    const idx = yCenter * stride + x * channels;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    colors.push(rgbToHex(r, g, b));
  }
  return colors;
}

async function main() {
  if (!fs.existsSync(PNG_DIR)) throw new Error(`Pasta não existe: ${PNG_DIR}`);
  const files = fs
    .readdirSync(PNG_DIR)
    .filter((f) => f.endsWith(".png"))
    .sort();

  console.log(`📁 ${files.length} PNGs em ${PNG_DIR}\n`);

  const palettes: Array<{ id: string; file: string; hex: string[]; gradient: string }> = [];

  for (const f of files) {
    const fullPath = path.join(PNG_DIR, f);
    try {
      const hex = await extractPalette(fullPath);
      const id = f.replace(/^_degrades-?/, "").replace(/\.png$/i, "").replace(/_Prancheta.*$/, "");
      const gradient = hex.join(" → ");
      palettes.push({ id: id || "main", file: f, hex, gradient });
      console.log(`  ${id.padEnd(20)} ${gradient}`);
    } catch (err) {
      console.error(`  ❌ ${f}: ${(err as Error).message}`);
    }
  }

  const outData = {
    extractedAt: new Date().toISOString(),
    source: PNG_DIR,
    totalPalettes: palettes.length,
    samplePositions: SAMPLE_POSITIONS.map((p) => `${(p * 100).toFixed(0)}%`),
    palettes,
  };

  // Salva 2 cópias: uma na pasta source, outra na content-machine
  const sourceOutPath = path.join(path.dirname(PNG_DIR), "longevify-palettes.json");
  const contentOutPath = path.join(ROOT, "LONGEVIFY_PALETTES.json");
  fs.writeFileSync(sourceOutPath, JSON.stringify(outData, null, 2));
  fs.writeFileSync(contentOutPath, JSON.stringify(outData, null, 2));

  console.log(`\n✅ Salvo:\n   ${sourceOutPath}\n   ${contentOutPath}`);
}

main().catch((err) => {
  console.error("\n❌", err.message);
  process.exit(1);
});
