/**
 * gen-scenes-4-5.ts — Gera apenas cenas 4 e 5 (hardcoded) e concatena tudo.
 * Clips 1-3 já existem em /tmp/ptv-scenes/
 */

import { fal } from "@fal-ai/client";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
fal.config({ credentials: process.env.FAL_KEY });

const OUT_DIR = path.join(ROOT, "output/videos");
const TMP_DIR = "/tmp/ptv-scenes";
fs.mkdirSync(OUT_DIR, { recursive: true });

const SCENES = [
  {
    id: 4,
    imagePrompt: "Extreme macro photography of teal and amber light beams passing through dense organic fibers, like data streams through biological tissue. Pure black background. No text, no logo, no watermark. Photorealistic, cinematic, 9:16 vertical aspect ratio.",
    motionPrompt: "Slow drift of light beams through the fibers, gentle pulse rhythm, particles flowing in one direction.",
    duration: 2.5,
  },
  {
    id: 5,
    imagePrompt: "Extreme macro of a single water droplet reflecting teal light, suspended just above a dark reflective surface. Pure black background. No text, no logo, no watermark. Photorealistic, cinematic macro, 9:16 vertical aspect ratio.",
    motionPrompt: "Droplet trembles slightly with surface tension, teal reflection shimmers, slow motion anticipation before impact.",
    duration: 2.5,
  },
];

async function download(url: string, dest: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Download falhou: ${r.status} — ${url}`);
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}

async function generateImage(scene: typeof SCENES[0], outPath: string) {
  if (fs.existsSync(outPath)) {
    console.log(`  ⏭  Imagem cena ${scene.id} já existe`);
    return;
  }
  console.log(`\n🖼  Cena ${scene.id} — GPT Image 2...`);
  const r = await fal.subscribe("openai/gpt-image-2", {
    input: {
      prompt:        scene.imagePrompt,
      image_size:    "square_hd",
      quality:       "high",
      num_images:    1,
      output_format: "png",
    },
    logs: false,
  }) as { data: { images: Array<{ url: string }> } };

  const url = r.data.images[0]?.url;
  if (!url) throw new Error(`GPT Image 2 sem resultado na cena ${scene.id}`);
  await download(url, outPath);
  console.log(`  ✅ imagem cena ${scene.id}`);
}

async function animateScene(imgPath: string, scene: typeof SCENES[0], outPath: string) {
  if (fs.existsSync(outPath)) {
    console.log(`  ⏭  Clip cena ${scene.id} já existe`);
    return;
  }
  console.log(`\n🎬 Cena ${scene.id} — Kling v3...`);

  const fileBytes = fs.readFileSync(imgPath);
  const file      = new File([fileBytes], `scene${scene.id}.png`, { type: "image/png" });
  const uploadUrl = await fal.storage.upload(file);

  const result = await fal.subscribe("fal-ai/kling-video/v3/pro/image-to-video", {
    input: {
      prompt:          scene.motionPrompt + " Static camera, cinematic macro, premium health brand.",
      negative_prompt: "text overlay, logo, watermark, fast cuts, shaky, bright white, hospital",
      image_url:       uploadUrl,
      duration:        "5",
      aspect_ratio:    "9:16",
      cfg_scale:       0.5,
      generate_audio:  false,
    },
    logs: false,
    onQueueUpdate: (u) => {
      if (u.status === "IN_QUEUE")    process.stdout.write(`\r  ⌛ Cena ${scene.id} na fila...`);
      if (u.status === "IN_PROGRESS") process.stdout.write(".");
    },
  }) as { data: { video: { url: string } } };

  console.log();
  const videoUrl = result.data.video?.url;
  if (!videoUrl) throw new Error(`Kling sem vídeo na cena ${scene.id}`);
  await download(videoUrl, outPath);
  console.log(`  ✅ clip cena ${scene.id}`);
}

async function concatenate(clipPaths: string[], durations: number[], outPath: string) {
  console.log("\n✂️  Trimming e concatenando...");
  const trimmedPaths: string[] = [];

  for (let i = 0; i < clipPaths.length; i++) {
    const trimmed = path.join(TMP_DIR, `trimmed-${i}.mp4`);
    execSync(
      `ffmpeg -y -i "${clipPaths[i]}" -t ${durations[i]} -c:v libx264 -pix_fmt yuv420p -crf 16 "${trimmed}"`,
      { stdio: "pipe" }
    );
    trimmedPaths.push(trimmed);
    console.log(`  ✅ cena ${i + 1} trimada (${durations[i]}s)`);
  }

  const listFile = path.join(TMP_DIR, "concat.txt");
  fs.writeFileSync(listFile, trimmedPaths.map(p => `file '${p}'`).join("\n"));

  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${listFile}" -c:v libx264 -pix_fmt yuv420p -crf 16 -movflags +faststart "${outPath}"`,
    { stdio: "pipe" }
  );
  console.log(`  ✅ vídeo final: ${outPath}`);
}

async function main() {
  console.log("\n🚀 Gerando cenas 4 e 5 — Longevify");
  console.log("─".repeat(50));

  // Gera cenas 4 e 5
  for (const scene of SCENES) {
    const imgPath  = path.join(TMP_DIR, `scene-${scene.id}.png`);
    const clipPath = path.join(TMP_DIR, `clip-${scene.id}.mp4`);
    await generateImage(scene, imgPath);
    await animateScene(imgPath, scene, clipPath);
  }

  // Todos os 5 clips
  const allClips     = [1, 2, 3, 4, 5].map(i => path.join(TMP_DIR, `clip-${i}.mp4`));
  const allDurations = [2.5, 2.5, 2.5, 2.5, 2.5];

  const ts        = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const finalPath = path.join(OUT_DIR, `${ts}-longevify-multiscene.mp4`);
  await concatenate(allClips, allDurations, finalPath);

  console.log(`\n✅ Pronto! 5 cenas × 2.5s = 12.5s`);
  console.log(`📁 ${finalPath}`);
}

main().catch(e => { console.error("\n❌", e.message); process.exit(1); });
