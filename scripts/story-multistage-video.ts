/**
 * story-multistage-video.ts — Story video cinematográfico multi-estágio.
 *
 * Suporta sequência de stages, cada um com:
 *   - duration_s, text, font_size_px, position (top/center/bottom + left/center/right)
 *   - typing animation OR fade-in
 *   - opcional: logo replace (último stage)
 *
 * Output: mp4 9:16 1080x1920 30fps.
 *
 * Uso:
 *   pnpm story-multistage --bg X.png --config stages.json --out Y.mp4
 *
 * Config JSON exemplo (L3 multi-stage):
 * {
 *   "stages": [
 *     { "duration_s": 3, "text": "SAÚDE", "font_size": 200, "position": "center", "anim": "fade", "weight": "regular" },
 *     { "duration_s": 3, "text": "É O SEU MAIOR PATRIMÔNIO", "font_size": 64, "position": "center", "anim": "type", "char_ms": 60 },
 *     { "duration_s": 2, "text": "(pause)", "skip_text": true },
 *     { "duration_s": 3, "text": "Por isso, construímos a", "font_size": 56, "position": "top", "anim": "type", "char_ms": 60, "logo_reveal": true }
 *   ]
 * }
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const W = 1080, H = 1920, FPS = 30;

interface Stage {
  duration_s: number;
  text: string;
  font_size: number;
  position: "top" | "center" | "bottom";
  anim: "fade" | "type" | "instant";
  char_ms?: number;
  weight?: "light" | "regular";
  skip_text?: boolean;
  logo_reveal?: boolean;
}

interface Config {
  stages: Stage[];
  always_logo_bottom?: boolean;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function wrapText(text: string, charsPerLine: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > charsPerLine && cur) { lines.push(cur); cur = w; }
    else cur = cur ? cur + " " + w : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

function buildTextSvg(text: string, fontSize: number, weight: "light" | "regular", positionY: "top" | "center" | "bottom", opacity: number = 1): string {
  if (!text) return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"></svg>`;
  const fontWeight = weight === "light" ? 300 : 400;
  const charsPerLine = fontSize > 120 ? 12 : fontSize > 80 ? 18 : 26;
  const lines = wrapText(text, charsPerLine);
  const lineHeight = fontSize * 1.15;
  const totalH = lines.length * lineHeight;
  let startY: number;
  if (positionY === "top") startY = Math.round(H * 0.12) + fontSize;
  else if (positionY === "bottom") startY = Math.round(H * 0.72) - totalH + fontSize;
  else startY = Math.round((H - totalH) / 2) + fontSize;
  const tspans = lines.map((line, i) => `<tspan x="${W / 2}" y="${startY + i * lineHeight}">${escapeXml(line)}</tspan>`).join("");
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <text x="${W / 2}" text-anchor="middle" font-family="-apple-system, 'DM Sans', sans-serif" font-weight="${fontWeight}" font-size="${fontSize}" fill="#f8fffc" opacity="${opacity}" letter-spacing="0.5">${tspans}</text>
  </svg>`;
}

interface Args { bg: string; config: string; out: string; }

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const o: Partial<Args> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--bg") o.bg = a[++i];
    else if (a[i] === "--config") o.config = a[++i];
    else if (a[i] === "--out") o.out = a[++i];
  }
  if (!o.bg || !o.config || !o.out) { console.error("Usage: pnpm story-multistage --bg X --config Y.json --out Z.mp4"); process.exit(1); }
  return o as Args;
}

async function main() {
  const args = parseArgs();
  const cfg = JSON.parse(fs.readFileSync(args.config, "utf-8")) as Config;
  const bgPath = path.isAbsolute(args.bg) ? args.bg : path.join(ROOT, args.bg);
  const bgBuf = await sharp(bgPath).resize(W, H, { fit: "cover" }).png().toBuffer();

  // Logo prep
  const logoPath = "/Users/mathe/Documents/Longev/Claude Code/extracted2/Longevify/.claude/worktrees/tender-booth-dc78a3/attached_assets/logo_horizontal_white_1773668692240.png";
  const logoBottomW = Math.round(W * 0.36);
  const logoBottomBuf = await sharp(logoPath).resize({ width: logoBottomW }).png().toBuffer();
  const logoBottomMeta = await sharp(logoBottomBuf).metadata();

  // Logo reveal (larger, centered)
  const logoRevealW = Math.round(W * 0.55);
  const logoRevealBuf = await sharp(logoPath).resize({ width: logoRevealW }).png().toBuffer();
  const logoRevealMeta = await sharp(logoRevealBuf).metadata();

  // Total duration
  const totalDuration = cfg.stages.reduce((s, st) => s + st.duration_s, 0);
  const totalFrames = Math.round(totalDuration * FPS);

  const tmpDir = fs.mkdtempSync(path.join("/tmp", "story-multistage-"));
  console.log(`🎬 Renderizando ${totalFrames} frames (${totalDuration}s) em ${tmpDir}...`);

  // Stage transitions in seconds
  const stageStarts: number[] = [];
  let acc = 0;
  for (const st of cfg.stages) { stageStarts.push(acc); acc += st.duration_s; }

  for (let f = 0; f < totalFrames; f++) {
    const t = f / FPS;
    // Find current stage
    let stageIdx = cfg.stages.length - 1;
    for (let i = 0; i < cfg.stages.length; i++) {
      if (t < stageStarts[i] + cfg.stages[i].duration_s) { stageIdx = i; break; }
    }
    const stage = cfg.stages[stageIdx];
    const stageT = t - stageStarts[stageIdx];

    // Compute visible text + opacity for typing/fade animation
    let visibleText = stage.text;
    let textOpacity = 1.0;

    if (stage.skip_text) {
      visibleText = "";
    } else if (stage.anim === "type" && stage.char_ms) {
      const charsVisible = Math.min(stage.text.length, Math.floor((stageT * 1000) / stage.char_ms));
      visibleText = stage.text.slice(0, charsVisible);
    } else if (stage.anim === "fade") {
      const fadeIn = Math.min(1, stageT / 0.8); // 0.8s fade in
      const fadeOut = stageT > stage.duration_s - 0.5 ? Math.max(0, (stage.duration_s - stageT) / 0.5) : 1;
      textOpacity = Math.min(fadeIn, fadeOut);
    }

    const composites: sharp.OverlayOptions[] = [];

    // Text
    if (visibleText && !stage.skip_text) {
      const svg = buildTextSvg(visibleText, stage.font_size, stage.weight ?? "light", stage.position, textOpacity);
      composites.push({ input: Buffer.from(svg), top: 0, left: 0 });
    }

    // Logo reveal (último stage com logo_reveal: true)
    if (stage.logo_reveal) {
      // Fades in over first 1s of stage, persists
      const logoOpacity = Math.min(1, stageT / 1.0);
      // Apply opacity manually via sharp ensureAlpha + linear
      const logoCenterY = Math.round(H * 0.55) - Math.round((logoRevealMeta.height ?? 100) / 2);
      const logoCenterX = Math.round((W - logoRevealW) / 2);
      const logoWithOpacity = await sharp(logoRevealBuf).ensureAlpha().composite([{ input: Buffer.from([0, 0, 0, Math.round((1 - logoOpacity) * 255)]), raw: { width: 1, height: 1, channels: 4 }, tile: true, blend: "dest-in" }]).png().toBuffer().catch(() => logoRevealBuf);
      composites.push({ input: logoWithOpacity, top: logoCenterY, left: logoCenterX });
    } else if (cfg.always_logo_bottom !== false && !stage.logo_reveal) {
      // Logo bottom always visible
      composites.push({
        input: logoBottomBuf,
        left: Math.round((W - logoBottomW) / 2),
        top: Math.round(H * 0.88 - (logoBottomMeta.height ?? 60) / 2),
      });
    }

    const frame = await sharp(bgBuf).composite(composites).png().toBuffer();
    fs.writeFileSync(path.join(tmpDir, `frame-${String(f).padStart(5, "0")}.png`), frame);
    if (f % 30 === 0) process.stdout.write(`\r  frame ${f}/${totalFrames}`);
  }
  process.stdout.write(`\r  frame ${totalFrames}/${totalFrames} ✓\n`);

  const outPath = path.isAbsolute(args.out) ? args.out : path.join(ROOT, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  console.log("🎞️  ffmpeg encode...");
  execSync(
    `ffmpeg -y -framerate ${FPS} -i ${JSON.stringify(path.join(tmpDir, "frame-%05d.png"))} -c:v libx264 -pix_fmt yuv420p -crf 18 -preset slow ${JSON.stringify(outPath)}`,
    { stdio: "ignore" }
  );
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const sizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2);
  console.log(`\n✅ ${path.relative(ROOT, outPath)} (${sizeMB} MB)`);
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
