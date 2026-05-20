/**
 * prompt-to-video.ts — Lê análise de vídeo e gera sequência multi-cena Longevify
 *
 * Pipeline:
 *   1. Claude Opus 4.7 lê o .md completo → extrai 5-6 cenas adaptadas para Longevify
 *   2. GPT Image 2 gera cada cena (frame limpo, sem texto)
 *   3. Kling v3 anima cada frame → clip de 5s
 *   4. ffmpeg trimma cada clip para 2.5s + concatena com hard cuts
 *
 * Uso:
 *   npm run prompt-to-video
 *   npm run prompt-to-video -- output/prompts/2026-04-26T17-04-31-video-analysis.md
 */

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { fal }   from "@fal-ai/client";
import { execSync } from "child_process";
import * as fs   from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
fal.config({ credentials: process.env.FAL_KEY });

const BRAND_MD  = fs.readFileSync(path.join(ROOT, "LONGEVIFY_BRAND.md"), "utf-8");
const LOGO_PATH = path.join(ROOT, "assets/logo-horizontal-white.png");
const OUT_DIR   = path.join(ROOT, "output/videos");
const TMP_DIR   = "/tmp/ptv-scenes";
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

// ── Types ─────────────────────────────────────────────────────────────────────

interface Scene {
  id:           number;
  description:  string;  // o que acontece na cena
  imagePrompt:  string;  // prompt para GPT Image 2 (inglês, sem texto)
  motionPrompt: string;  // prompt para Kling v3 (movimento da cena)
  duration:     number;  // segundos no corte final (1.5–3)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveLatestMd(arg?: string): string {
  if (arg && fs.existsSync(path.resolve(process.cwd(), arg)))
    return path.resolve(process.cwd(), arg);
  const dir   = path.join(ROOT, "output/prompts");
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith(".md"))
    .map(f => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!files.length) throw new Error("Nenhum .md em output/prompts/");
  return path.join(dir, files[0].f);
}

async function download(url: string, dest: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Download falhou: ${r.status} ${url}`);
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}

// ── Etapa 1: Claude extrai cenas ──────────────────────────────────────────────

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
  let text: string;

  if (process.env.ANTHROPIC_API_KEY) {
    console.log("\n🧠 Etapa 1 — Claude Opus 4.7 extraindo cenas...");
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await client.messages.create({
      model: "claude-opus-4-7", max_tokens: 2048,
      messages: [{ role: "user", content: SCENE_PROMPT(md) }],
    });
    text = (res.content[0] as Anthropic.TextBlock).text.trim();
  } else {
    console.log("\n🧠 Etapa 1 — Gemini 2.5 Pro extraindo cenas...");
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
    const res   = await model.generateContent(SCENE_PROMPT(md));
    text = res.response.text().trim();
  }

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error(`LLM não retornou JSON válido:\n${text.slice(0, 300)}`);

  const scenes: Scene[] = JSON.parse(jsonMatch[0]);
  console.log(`  ✅ ${scenes.length} cenas extraídas:`);
  scenes.forEach(s => console.log(`     [${s.id}] ${s.description}`));
  return scenes;
}

// ── Etapa 2: GPT Image 2 ──────────────────────────────────────────────────────

async function generateImage(scene: Scene, outPath: string): Promise<string> {
  console.log(`\n🖼  Cena ${scene.id} — GPT Image 2...`);
  console.log(`   "${scene.imagePrompt.slice(0, 80)}..."`);

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
  return outPath;
}

// ── Etapa 3: Kling v3 ─────────────────────────────────────────────────────────

async function animateScene(imgPath: string, scene: Scene, outPath: string): Promise<string> {
  console.log(`\n🎬 Cena ${scene.id} — Kling v3...`);

  const fileBytes = fs.readFileSync(imgPath);
  const ext       = path.extname(imgPath).replace(".", "") || "png";
  const file      = new File([fileBytes], `scene${scene.id}.${ext}`, { type: `image/${ext}` });
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
  return outPath;
}

// ── Etapa 4: ffmpeg — trim + concatenar ──────────────────────────────────────

async function concatenate(
  clipPaths: string[],
  durations: number[],
  outPath: string
): Promise<string> {
  console.log("\n✂️  Etapa 4 — Trimming e concatenando com ffmpeg...");

  const trimmedPaths: string[] = [];

  // Trim cada clip para a duração definida
  for (let i = 0; i < clipPaths.length; i++) {
    const trimmed = path.join(TMP_DIR, `trimmed-${i}.mp4`);
    execSync(
      `ffmpeg -y -i "${clipPaths[i]}" -t ${durations[i]} -c:v libx264 -pix_fmt yuv420p -crf 16 "${trimmed}"`,
      { stdio: "pipe" }
    );
    trimmedPaths.push(trimmed);
    console.log(`  ✅ cena ${i + 1} trimada para ${durations[i]}s`);
  }

  // Cria lista de concatenação
  const listFile = path.join(TMP_DIR, "concat.txt");
  fs.writeFileSync(listFile, trimmedPaths.map(p => `file '${p}'`).join("\n"));

  // Concatena
  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${listFile}" -c:v libx264 -pix_fmt yuv420p -crf 16 -movflags +faststart "${outPath}"`,
    { stdio: "pipe" }
  );

  console.log(`  ✅ vídeo final: ${outPath}`);
  return outPath;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const mdPath = resolveLatestMd(process.argv[2]);
  const md     = fs.readFileSync(mdPath, "utf-8");

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  console.log(`\n🚀 Prompt-to-Video (multi-cena) — Longevify`);
  console.log(`   Análise: ${path.basename(mdPath)}`);
  console.log("─".repeat(50));

  // 1. Extrai cenas via Claude
  const scenes = await extractScenes(md);

  // 2 + 3. Para cada cena: GPT Image 2 → Kling v3 (em série para não estourar rate limits)
  const clipPaths: string[] = [];

  for (const scene of scenes) {
    const imgPath  = path.join(TMP_DIR, `scene-${scene.id}.png`);
    const clipPath = path.join(TMP_DIR, `clip-${scene.id}.mp4`);

    await generateImage(scene, imgPath);
    await animateScene(imgPath, scene, clipPath);
    clipPaths.push(clipPath);
  }

  // 4. Concatena
  const finalPath = path.join(OUT_DIR, `${ts}-longevify-multiscene.mp4`);
  await concatenate(clipPaths, scenes.map(s => s.duration), finalPath);

  console.log(`\n✅ Concluído!`);
  console.log(`📁 ${finalPath}`);
  console.log(`   ${scenes.length} cenas × ${scenes.map(s=>s.duration+'s').join(' + ')} = ${scenes.reduce((a,s)=>a+s.duration,0)}s total`);
}

main().catch(e => { console.error("\n❌", e.message); process.exit(1); });
