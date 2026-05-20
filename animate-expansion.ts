/**
 * animate-expansion.ts
 * Anima o story do cogumelo: começa 40% menor, cresce até o tamanho atual.
 * Smoothstep easing. sharp frame-by-frame + ffmpeg.
 */

import sharp from "sharp";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const W = 1080;
const H = 1920;
const FPS = 24;
const DURATION = 6;          // segundos
const FRAMES = FPS * DURATION; // 144 frames

const INPUT  = path.join(__dirname, "output/stories/story-saude-quebrada.png");
const FRAMES_DIR = "/tmp/longevify-frames";
const OUTPUT = path.join(__dirname, "output/stories/mushroom-expansion.mp4");

fs.mkdirSync(FRAMES_DIR, { recursive: true });

// Limpa frames anteriores
fs.readdirSync(FRAMES_DIR).forEach(f => fs.unlinkSync(path.join(FRAMES_DIR, f)));

console.log("\n🎞  Gerando frames...");

// Pré-carrega imagem source
const source = await sharp(INPUT).toBuffer();

for (let i = 0; i < FRAMES; i++) {
  const t    = i / (FRAMES - 1);
  // Smoothstep easing: começa devagar, acelera, termina devagar
  const ease  = t * t * (3 - 2 * t);
  const scale = 0.6 + 0.4 * ease;  // 0.60 → 1.00

  // Dimensões da imagem escalada (múltiplos de 2 para h264)
  const sw = Math.round(W * scale / 2) * 2;
  const sh = Math.round(H * scale / 2) * 2;
  const left = Math.round((W - sw) / 2);
  const top  = Math.round((H - sh) / 2);

  const scaled = await sharp(source)
    .resize(sw, sh, { fit: "fill", kernel: "lanczos3" })
    .toBuffer();

  await sharp({
    create: { width: W, height: H, channels: 3, background: { r: 0, g: 0, b: 0 } }
  })
    .composite([{ input: scaled, top, left }])
    .jpeg({ quality: 88 })
    .toFile(path.join(FRAMES_DIR, `frame${String(i).padStart(4, "0")}.jpg`));

  if (i % 24 === 0 || i === FRAMES - 1) {
    process.stdout.write(`\r  🎞 ${i + 1}/${FRAMES} frames (${Math.round(scale * 100)}%)`);
  }
}

console.log("\n🎬 Montando vídeo com ffmpeg...");
execSync(
  `ffmpeg -y -framerate ${FPS} -i "${FRAMES_DIR}/frame%04d.jpg" \
   -c:v libx264 -pix_fmt yuv420p -crf 16 -movflags +faststart \
   "${OUTPUT}"`,
  { stdio: "inherit" }
);

console.log(`\n✅ output/stories/mushroom-expansion.mp4`);
