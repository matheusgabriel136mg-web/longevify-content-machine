/**
 * generate-brief.ts — Gera assets do brief Longevify (adaptado do @superpower DKaPfjnSYx7)
 *
 * Pipeline:
 *   1. GPT Image 2  → thumbnail limpa (foto pura, sem texto)
 *   2. NB2          → imagem feed limpa (foto pura, sem texto)
 *   3. Compositing  → logo real + legenda adicionados via sharp sobre ambas as imagens
 *   4. Kling v3     → reel vertical 9:16 sem áudio (anima a imagem NB2)
 *
 * Uso: node --env-file=.env --import tsx/esm generate-brief.ts
 */

import { fal } from "@fal-ai/client";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { compositeLogoAndText } from "./composite.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

fal.config({ credentials: process.env.FAL_KEY });

const OUT = path.join(__dirname, "output", "brief-superpower-adaptation");
fs.mkdirSync(OUT, { recursive: true });

// ── Prompts — PUROS, sem texto na imagem (logo/legenda adicionados via código) ─

// GPT Image 2: thumbnail — foto limpa, sem nenhum texto gerado por IA
const THUMBNAIL_PROMPT_CLEAN = `Extreme macro photograph of human skin texture, shoulder or forearm, filling entire vertical square frame. Warm teal-golden ambient light with dark forest-green color grade. Very dark shadows, warm highlights. No faces, no text, no overlay, no typography, no watermark. Black vignette at edges. Style: intimate, premium, editorial health photography. Color palette: deep forest-green darks, warm amber-teal highlights, near-black shadows.`;

// NB2: imagem feed — macro orgânico limpo, sem texto
const VISUAL_PROMPT = `Extreme macro editorial photograph of human skin texture, clavicle area, warm teal and golden side lighting, dark forest-green deep shadows, almost abstract organic landscape quality, contemplative and intimate mood, very high detail, cinematic film grain, no faces, no text, health and longevity editorial photography, aspect ratio 1:1 square`;

const VISUAL_NEG = `hospital, medical equipment, stethoscope, white coat, generic stock photo, bright studio lighting, white background, watermark, text, typography, distortion`;

// Kling v3: reel vertical
const VIDEO_PROMPT = `Extreme macro close-up of human skin texture, clavicle or forearm area, ultra slow breathing camera motion, warm teal-golden side lighting with subtle green undertone, skin texture almost abstract like an organic landscape, static camera with imperceptible rack focus from soft blur to sharp detail, dark forest-green color grade, atmospheric intimate contemplative mood, no faces, no products, editorial health photography, cinematic slow motion`;

const VIDEO_NEG = `hospital, medical equipment, stethoscope, white coat, generic stock footage, fast cuts, bright white background, saturated colors, people smiling at camera, laboratory, text overlay, talking person`;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function download(url: string, dest: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download falhou: ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

function log(icon: string, msg: string) {
  console.log(`${icon} ${msg}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🚀 Gerando assets do brief — Longevify x Superpower");
  console.log("   Foto limpa → logo real + texto via sharp → vídeo Kling v3\n");
  console.log("─".repeat(60));

  // ── 1. Thumbnail limpa — GPT Image 2 ────────────────────────────────────────
  log("\n🖼 ", "Thumbnail base → GPT Image 2 (square_hd, sem texto)...");
  const thumbRawPath = path.join(OUT, "thumbnail-raw.png");
  const thumbFinalPath = path.join(OUT, "thumbnail-final.jpg");
  try {
    const r = await fal.subscribe("openai/gpt-image-2", {
      input: {
        prompt: THUMBNAIL_PROMPT_CLEAN,
        image_size: "square_hd",
        quality: "high",
        num_images: 1,
        output_format: "png",
      },
      logs: false,
    }) as { data: { images: Array<{ url: string }> } };

    const url = r.data.images[0]?.url;
    if (url) {
      await download(url, thumbRawPath);
      log("  ✅", "thumbnail-raw.png (foto limpa)");
    }
  } catch (err) {
    log("  ❌", `GPT Image 2: ${(err as Error).message}`);
  }

  // ── 2. Imagem feed — Nano Banana 2 ──────────────────────────────────────────
  log("\n🖼 ", "Imagem feed → Nano Banana 2 (1:1, sem texto)...");
  const nb2RawPath = path.join(OUT, "visual-raw.jpg");
  const nb2FinalPath = path.join(OUT, "visual-final.jpg");
  try {
    const r = await fal.subscribe("fal-ai/nano-banana-2", {
      input: {
        prompt: VISUAL_PROMPT,
        aspect_ratio: "1:1",
        num_images: 1,
        output_format: "jpeg",
        safety_tolerance: "2",
        resolution: "1K",
        thinking_level: "minimal",
      },
      logs: false,
    }) as { data: { images: Array<{ url: string }> } };

    const url = r.data.images[0]?.url;
    if (url) {
      await download(url, nb2RawPath);
      log("  ✅", "visual-raw.jpg (foto limpa)");
    }
  } catch (err) {
    log("  ❌", `NB2: ${(err as Error).message}`);
  }

  // ── 3. Compositing — logo real + texto via sharp ─────────────────────────────
  log("\n🎨", "Compositing — logo real + legenda via sharp...");

  if (fs.existsSync(thumbRawPath)) {
    try {
      await compositeLogoAndText(thumbRawPath, thumbFinalPath, {
        caption: "Agora em mais cidades.",
        subline: "longevify.com.br",
        logoScale: 0.52,
        logoY: 0.52,
        captionY: 0.33,
        format: "jpg",
      });
      log("  ✅", "thumbnail-final.jpg (com logo + texto)");
    } catch (err) {
      log("  ❌", `Composite thumbnail: ${(err as Error).message}`);
    }
  }

  if (fs.existsSync(nb2RawPath)) {
    try {
      await compositeLogoAndText(nb2RawPath, nb2FinalPath, {
        caption: "Seus próximos 40 anos começam aqui.",
        subline: "longevify.com.br",
        logoScale: 0.50,
        logoY: 0.52,
        captionY: 0.30,
        format: "jpg",
      });
      log("  ✅", "visual-final.jpg (com logo + texto)");
    } catch (err) {
      log("  ❌", `Composite visual: ${(err as Error).message}`);
    }
  }

  // ── 4. Vídeo — Kling v3 (image-to-video, 9:16, sem áudio) ──────────────────
  log("\n🎬", "Vídeo → Kling v3 Pro (9:16, 5s, sem áudio)...");
  log("  ⏳", "Aguarde ~3-5 min...");

  // Usa a imagem raw (sem overlay) como frame de entrada
  const videoInputPath = fs.existsSync(nb2RawPath) ? nb2RawPath : thumbRawPath;

  if (fs.existsSync(videoInputPath)) {
    try {
      const fileBytes = fs.readFileSync(videoInputPath);
      const file = new File([fileBytes], "input.jpg", { type: "image/jpeg" });
      log("  📤", "Upload para fal.ai storage...");
      const uploadedUrl = await fal.storage.upload(file);
      log("  ✅", `Upload: ${uploadedUrl}`);

      const klingResult = await fal.subscribe("fal-ai/kling-video/v3/pro/image-to-video", {
        input: {
          prompt: VIDEO_PROMPT,
          image_url: uploadedUrl,
          negative_prompt: VIDEO_NEG,
          duration: "5",
          aspect_ratio: "9:16",
          cfg_scale: 0.5,
          generate_audio: false,
        },
        logs: false,
        onQueueUpdate: (update) => {
          if (update.status === "IN_QUEUE") {
            process.stdout.write(`\r  ⌛ Na fila...`);
          } else if (update.status === "IN_PROGRESS") {
            process.stdout.write(".");
          }
        },
      }) as { data: { video: { url: string } } };

      console.log();
      const videoUrl = klingResult.data.video?.url;
      if (videoUrl) {
        const videoPath = path.join(OUT, "reel-kling-v3.mp4");
        await download(videoUrl, videoPath);
        log("  ✅", "reel-kling-v3.mp4");
      }
    } catch (err) {
      log("  ❌", `Kling v3: ${(err as Error).message}`);
    }
  } else {
    log("  ⚠️", "Nenhuma imagem disponível para animar");
  }

  // ── Resumo ─────────────────────────────────────────────────────────────────
  console.log("\n\n" + "─".repeat(60));
  console.log("✅ Pipeline concluído!");
  console.log(`\n📁 content-machine/output/brief-superpower-adaptation/`);
  console.log("   thumbnail-raw.png     ← foto pura GPT Image 2 (sem texto)");
  console.log("   thumbnail-final.jpg   ← thumbnail com logo real + legenda");
  console.log("   visual-raw.jpg        ← foto pura NB2 (sem texto)");
  console.log("   visual-final.jpg      ← imagem feed com logo real + legenda");
  console.log("   reel-kling-v3.mp4     ← reel vertical 9:16 (sem áudio)\n");
}

main().catch((err) => {
  console.error("\n❌ Falhou:", err.message);
  process.exit(1);
});
