/**
 * continue-pipeline.ts — Continua pipeline multi-cena de onde parou
 * Lê o .md mais recente, extrai cenas, pula clips que já existem, finaliza.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { fal } from "@fal-ai/client";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
fal.config({ credentials: process.env.FAL_KEY });

const BRAND_MD = fs.readFileSync(path.join(ROOT, "LONGEVIFY_BRAND.md"), "utf-8");
const OUT_DIR = path.join(ROOT, "output/videos");
const TMP_DIR = "/tmp/ptv-scenes";
fs.mkdirSync(OUT_DIR, { recursive: true });

interface Scene {
  id: number;
  description: string;
  imagePrompt: string;
  motionPrompt: string;
  duration: number;
}

const SCENE_PROMPT = (md: string) => `Você recebeu a análise completa de um vídeo de referência da Superpower e o brand guide da Longevify.

Sua tarefa: extrair 5 cenas para recriar este vídeo adaptado para a Longevify.

Cada cena deve ser um macro shot ÚNICO (não split screen, não collage) — frame simples, câmera estática, objeto único em close extremo. Exatamente como o vídeo original: uma cena por vez, corte seco para a próxima.

Responda APENAS com JSON válido, sem markdown, sem explicação:
[
  {
    "id": 1,
    "description": "descrição curta da cena em português",
    "imagePrompt": "prompt em inglês para GPT Image 2 — fotorrealista, macro extremo, fundo preto puro, sem texto, sem logo, sem watermark, vertical 9:16",
    "motionPrompt": "prompt em inglês para Kling v3 — descreve movimento sutil (respiração, rack focus, partículas fluindo)",
    "duration": 2.5
  }
]

Adapte para a Longevify: paleta teal/âmbar/preto-floresta, tom sofisticado e científico.

---
ANÁLISE DO VÍDEO DE REFERÊNCIA:
${md}

---
BRAND GUIDE LONGEVIFY:
${BRAND_MD}`;

async function extractScenes(md: string): Promise<Scene[]> {
  console.log("\n🧠 Extraindo cenas com Gemini 2.5 Pro...");
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
  const res = await model.generateContent(SCENE_PROMPT(md));
  const text = res.response.text().trim();

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error(`Gemini não retornou JSON válido:\n${text.slice(0, 300)}`);

  const scenes: Scene[] = JSON.parse(jsonMatch[0]);
  console.log(`  ✅ ${scenes.length} cenas:`);
  scenes.forEach(s => console.log(`     [${s.id}] ${s.description}`));
  return scenes;
}

async function download(url: string, dest: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Download falhou: ${r.status}`);
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}

async function generateImage(scene: Scene, outPath: string): Promise<string> {
  if (fs.existsSync(outPath)) {
    console.log(`  ⏭  Imagem cena ${scene.id} já existe, pulando...`);
    return outPath;
  }
  console.log(`\n🖼  Cena ${scene.id} — GPT Image 2...`);
  const r = await fal.subscribe("openai/gpt-image-2", {
    input: {
      prompt: scene.imagePrompt,
      image_size: "square_hd",
      quality: "high",
      num_images: 1,
      output_format: "png",
    },
    logs: false,
  }) as { data: { images: Array<{ url: string }> } };

  const url = r.data.images[0]?.url;
  if (!url) throw new Error(`GPT Image 2 sem resultado na cena ${scene.id}`);
  await download(url, outPath);
  console.log(`  ✅ imagem cena ${scene.id}`);
  return outPath;
}

async function animateScene(imgPath: string, scene: Scene, outPath: string): Promise<string> {
  if (fs.existsSync(outPath)) {
    console.log(`  ⏭  Clip cena ${scene.id} já existe, pulando...`);
    return outPath;
  }
  console.log(`\n🎬 Cena ${scene.id} — Kling v3...`);

  const fileBytes = fs.readFileSync(imgPath);
  const file = new File([fileBytes], `scene${scene.id}.png`, { type: "image/png" });
  const uploadUrl = await fal.storage.upload(file);

  const result = await fal.subscribe("fal-ai/kling-video/v3/pro/image-to-video", {
    input: {
      prompt: scene.motionPrompt + " Static camera, cinematic macro, premium health brand.",
      negative_prompt: "text overlay, logo, watermark, fast cuts, shaky, bright white, hospital",
      image_url: uploadUrl,
      duration: "5",
      aspect_ratio: "9:16",
      cfg_scale: 0.5,
      generate_audio: false,
    },
    logs: false,
    onQueueUpdate: (u) => {
      if (u.status === "IN_QUEUE") process.stdout.write(`\r  ⌛ Cena ${scene.id} na fila...`);
      if (u.status === "IN_PROGRESS") process.stdout.write(".");
    },
  }) as { data: { video: { url: string } } };

  console.log();
  const videoUrl = result.data.video?.url;
  if (!videoUrl) throw new Error(`Kling sem vídeo na cena ${scene.id}`);
  await download(videoUrl, outPath);
  console.log(`  ✅ clip cena ${scene.id}`);
  return outPath;
}

async function concatenate(clipPaths: string[], durations: number[], outPath: string) {
  console.log("\n✂️  Trimming e concatenando com ffmpeg...");
  const trimmedPaths: string[] = [];

  for (let i = 0; i < clipPaths.length; i++) {
    const trimmed = path.join(TMP_DIR, `trimmed-${i}.mp4`);
    execSync(
      `ffmpeg -y -i "${clipPaths[i]}" -t ${durations[i]} -c:v libx264 -pix_fmt yuv420p -crf 16 "${trimmed}"`,
      { stdio: "pipe" }
    );
    trimmedPaths.push(trimmed);
    console.log(`  ✅ cena ${i + 1} trimada para ${durations[i]}s`);
  }

  const listFile = path.join(TMP_DIR, "concat.txt");
  fs.writeFileSync(listFile, trimmedPaths.map(p => `file '${p}'`).join("\n"));

  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${listFile}" -c:v libx264 -pix_fmt yuv420p -crf 16 -movflags +faststart "${outPath}"`,
    { stdio: "pipe" }
  );
  console.log(`  ✅ ${outPath}`);
}

async function main() {
  const mdDir = path.join(ROOT, "output/prompts");
  const mdFile = fs.readdirSync(mdDir)
    .filter(f => f.endsWith(".md"))
    .map(f => ({ f, mtime: fs.statSync(path.join(mdDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0].f;

  const md = fs.readFileSync(path.join(mdDir, mdFile), "utf-8");
  console.log(`\n🚀 Continue-Pipeline — Longevify`);
  console.log(`   MD: ${mdFile}`);
  console.log("─".repeat(50));

  const scenes = await extractScenes(md);
  const clipPaths: string[] = [];

  for (const scene of scenes) {
    const imgPath  = path.join(TMP_DIR, `scene-${scene.id}.png`);
    const clipPath = path.join(TMP_DIR, `clip-${scene.id}.mp4`);
    await generateImage(scene, imgPath);
    await animateScene(imgPath, scene, clipPath);
    clipPaths.push(clipPath);
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const finalPath = path.join(OUT_DIR, `${ts}-longevify-multiscene.mp4`);
  await concatenate(clipPaths, scenes.map(s => s.duration), finalPath);

  const total = scenes.reduce((a, s) => a + s.duration, 0);
  console.log(`\n✅ Concluído!`);
  console.log(`📁 ${finalPath}`);
  console.log(`   ${scenes.length} cenas × ${scenes.map(s => s.duration + "s").join(" + ")} = ${total}s`);
}

main().catch(e => { console.error("\n❌", e.message); process.exit(1); });
