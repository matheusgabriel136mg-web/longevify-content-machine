/**
 * story-typing-video.ts — Gera story video 9:16 com typing animation.
 *
 * Composição:
 *   - Background: imagem estática (cells fluorescentes)
 *   - Texto top: typewriter animation
 *   - Logo bottom centralizada (padrão Longevify)
 *
 * Output: mp4 9:16 1080x1920, 30fps, ~7s, H264, mute (story IG).
 *
 * Uso:
 *   pnpm story-typing --bg path/to/bg.png --text "Texto aqui" --out story.mp4
 *   pnpm story-typing --bg X --text Y --duration 7 --char-ms 40
 */

import * as fs from "fs";
import * as path from "path";
import { execSync, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

interface Args {
  bg: string;
  text: string;
  out: string;
  duration: number;
  charMs: number;
  logo?: string;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const out: Partial<Args> = { duration: 7, charMs: 45 };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--bg") out.bg = a[++i];
    else if (a[i] === "--text") out.text = a[++i];
    else if (a[i] === "--out") out.out = a[++i];
    else if (a[i] === "--duration") out.duration = parseFloat(a[++i]);
    else if (a[i] === "--char-ms") out.charMs = parseInt(a[++i], 10);
    else if (a[i] === "--logo") out.logo = a[++i];
  }
  if (!out.bg || !out.text || !out.out) {
    console.error("Usage: pnpm story-typing --bg X.png --text 'Y' --out Z.mp4 [--duration 7] [--char-ms 45] [--logo logo.png]");
    process.exit(1);
  }
  return out as Args;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function buildTextSvg(text: string, width: number, height: number): string {
  // Quebra texto em múltiplas linhas (~28 chars/linha pra 9:16)
  const maxCharsPerLine = 28;
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxCharsPerLine && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? cur + " " + w : w;
    }
  }
  if (cur) lines.push(cur);

  const fontSize = 52;
  const lineHeight = fontSize * 1.4;
  const totalH = lines.length * lineHeight;
  const startY = Math.round(height * 0.15);

  const tspans = lines.map((line, i) => {
    return `<tspan x="${Math.round(width * 0.08)}" y="${startY + i * lineHeight}">${escapeXml(line)}</tspan>`;
  }).join("");

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .typed { font-family: 'DM Sans', -apple-system, sans-serif; font-weight: 300; font-size: ${fontSize}px; fill: #f8fffc; letter-spacing: 0.5px; }
  </style>
  <text class="typed">${tspans}</text>
</svg>`;
}

async function renderFrame(opts: {
  bg: Buffer;
  width: number;
  height: number;
  visibleText: string;
  logo?: { buf: Buffer; w: number; h: number };
}): Promise<Buffer> {
  const { bg, width, height, visibleText, logo } = opts;
  const composites: sharp.OverlayOptions[] = [];

  if (visibleText) {
    const svg = buildTextSvg(visibleText, width, height);
    composites.push({ input: Buffer.from(svg), top: 0, left: 0 });
  }

  if (logo) {
    composites.push({
      input: logo.buf,
      left: Math.round((width - logo.w) / 2),
      top: Math.round(height * 0.86 - logo.h / 2),
    });
  }

  return sharp(bg).composite(composites).png().toBuffer();
}

async function main() {
  const args = parseArgs();
  const bgPath = path.isAbsolute(args.bg) ? args.bg : path.join(ROOT, args.bg);
  if (!fs.existsSync(bgPath)) throw new Error(`bg não existe: ${bgPath}`);

  // Resize bg pra 1080x1920 (9:16)
  const bgBuf = await sharp(bgPath).resize(1080, 1920, { fit: "cover" }).png().toBuffer();
  const W = 1080, H = 1920;

  // Logo prep (default usa Longevify white horizontal)
  let logo: { buf: Buffer; w: number; h: number } | undefined;
  const logoPath = args.logo ?? "/Users/mathe/Documents/Longev/Claude Code/extracted2/Longevify/.claude/worktrees/tender-booth-dc78a3/attached_assets/logo_horizontal_white_1773668692240.png";
  if (fs.existsSync(logoPath)) {
    const logoW = Math.round(W * 0.36);
    const buf = await sharp(logoPath).resize({ width: logoW }).png().toBuffer();
    const m = await sharp(buf).metadata();
    logo = { buf, w: logoW, h: m.height ?? 100 };
  }

  // Frames
  const fps = 30;
  const totalFrames = Math.round(args.duration * fps);
  const tmpDir = fs.mkdtempSync(path.join("/tmp", "story-frames-"));
  console.log(`🎬 Renderizando ${totalFrames} frames em ${tmpDir}...`);

  const charsTotal = args.text.length;
  const typingFrames = Math.round((charsTotal * args.charMs * fps) / 1000);

  for (let f = 0; f < totalFrames; f++) {
    const elapsedMs = (f / fps) * 1000;
    let charsVisible: number;
    if (f < typingFrames) {
      charsVisible = Math.min(charsTotal, Math.floor(elapsedMs / args.charMs));
    } else {
      charsVisible = charsTotal;
    }
    const visibleText = args.text.slice(0, charsVisible);
    const frameBuf = await renderFrame({ bg: bgBuf, width: W, height: H, visibleText, logo });
    fs.writeFileSync(path.join(tmpDir, `frame-${String(f).padStart(5, "0")}.png`), frameBuf);
    if (f % 30 === 0) process.stdout.write(`\r  frame ${f}/${totalFrames}`);
  }
  process.stdout.write(`\r  frame ${totalFrames}/${totalFrames} ✓\n`);

  // ffmpeg junta
  const outPath = path.isAbsolute(args.out) ? args.out : path.join(ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  console.log("🎞️  ffmpeg encode...");
  execSync(
    `ffmpeg -y -framerate ${fps} -i ${JSON.stringify(path.join(tmpDir, "frame-%05d.png"))} -c:v libx264 -pix_fmt yuv420p -crf 18 -preset slow ${JSON.stringify(outPath)}`,
    { stdio: "ignore" }
  );

  // Cleanup tmp
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const sizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2);
  console.log(`\n✅ ${path.relative(ROOT, outPath)} (${sizeMB} MB)`);
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
