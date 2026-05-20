/**
 * content-machine — Longevify Instagram Content Pipeline
 *
 * Etapas:
 *   1. Scrape dos últimos N posts do Instagram via Apify
 *   2. Análise competitiva com Claude (hook, copy, performance, lacunas)
 *   3. Geração de 3 posts para Longevify com Claude
 *   4. Geração de prompts visuais estruturados com Claude
 *   5. Geração de imagens via fal.ai (NB2 / NBPro / Flux / GPT Image 2)
 *   6. Geração de vídeos via fal.ai Kling v3 + Veo 3 + Seedance [opt-in]
 *   7. Salvamento em output/YYYY-MM-DD/
 *
 * Uso:
 *   cp .env.example .env   # preencha as chaves
 *   npm install
 *   npm run run
 *
 * Para gerar vídeos: defina GENERATE_VIDEO=true no .env
 * (Kling v3 ≈ $0.56/5s com áudio | Veo 3 ≈ $2/clip | Seedance = alternativa rápida)
 */

import Anthropic from "@anthropic-ai/sdk";
import { fal } from "@fal-ai/client";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { compositeLogoAndText } from "./composite.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Brand Context (LONGEVIFY_BRAND.md) ──────────────────────────────────────
// Injected into steps 2, 3 and 4 so every Claude call knows the brand deeply.

function loadBrandContext(): string {
  const brandFile = path.join(__dirname, "LONGEVIFY_BRAND.md");
  if (!fs.existsSync(brandFile)) {
    console.warn("⚠️  LONGEVIFY_BRAND.md not found — running without brand context");
    return "";
  }
  const content = fs.readFileSync(brandFile, "utf-8");
  return `\n\n---\n## LONGEVIFY BRAND CONTEXT\n\nUse the following brand guidelines for ALL output. Never deviate from tone, vocabulary, color, or positioning described below.\n\n${content}\n---\n`;
}

const BRAND_CONTEXT = loadBrandContext();

const POSTS_PER_ACCOUNT = 10;
const APIFY_POLL_MS = 6_000;
const APIFY_TIMEOUT_MS = 5 * 60_000;

const COMPETITORS = [
  {
    name: "Superpower",
    url: `https://www.instagram.com/${process.env.IG_HANDLE_1 ?? "superpowerapp"}/`,
  },
  {
    name: "Mito Health",
    url: `https://www.instagram.com/${process.env.IG_HANDLE_2 ?? "mitohealth"}/`,
  },
];

// ── fal.ai image models ──────────────────────────────────────────────────────
// NB2    → "visual"        — lifestyle/fotografia: $0.08/img, rápido
// NBPro  → "text"          — texto/infográfico/tipografia: $0.15/img
// Flux   → "photorealistic"— fotorrealismo/frames de reel: $0.04/MP
// GPT    → "text-pt"       — composições com texto em português: token-based
const FAL_NB2   = process.env.FAL_IMAGE_MODEL_NB2   ?? "fal-ai/nano-banana-2";
const FAL_NBPRO = process.env.FAL_IMAGE_MODEL_NBPRO ?? "fal-ai/nano-banana-pro";
const FAL_FLUX  = process.env.FAL_IMAGE_MODEL_FLUX  ?? "fal-ai/flux-pro/v1.1";
const FAL_GPT   = process.env.FAL_IMAGE_MODEL_GPT   ?? "openai/gpt-image-2";

// ── fal.ai video models ──────────────────────────────────────────────────────
const FAL_VIDEO_KLING    = process.env.FAL_VIDEO_MODEL_KLING    ?? "fal-ai/kling-video/v3/pro/text-to-video";
const FAL_VIDEO_VEO      = process.env.FAL_VIDEO_MODEL_VEO      ?? "fal-ai/veo3";
const FAL_VIDEO_SEEDANCE = process.env.FAL_VIDEO_MODEL_SEEDANCE ?? "bytedance/seedance-2.0/image-to-video";
const GENERATE_VIDEO = process.env.GENERATE_VIDEO === "true";

const BRAND_VOICE =
  process.env.LONGEVIFY_BRAND_VOICE ??
  "científico mas acessível, otimista, voltado à comunidade brasileira";
const TARGET_AUDIENCE =
  process.env.LONGEVIFY_TARGET_AUDIENCE ??
  "brasileiros 30-55 anos interessados em longevidade e saúde preventiva";

const TODAY = new Date().toISOString().split("T")[0];
const OUTPUT_DIR = path.join(__dirname, "output", TODAY);
const IMAGES_DIR = path.join(OUTPUT_DIR, "05_images");
const VIDEOS_DIR = path.join(OUTPUT_DIR, "06_videos");

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApifyPost {
  ownerUsername?: string;
  username?: string;
  caption?: string;
  likesCount?: number;
  commentsCount?: number;
  type?: string;
  timestamp?: string;
  videoViewCount?: number;
}

interface MediaPrompt {
  postNumber: number;
  theme: string;
  /**
   * "visual"          → NB2   — lifestyle, fotografia, natureza, corpo em movimento
   * "photorealistic"  → Flux  — fotorrealismo técnico, frames de reel, close-ups de pele
   * "text"            → NBPro — infográfico, estatística, citação, carrossel com headline
   * "text-pt"         → GPT Image 2 — composição com texto em português (legível e preciso)
   */
  imageType: "visual" | "photorealistic" | "text" | "text-pt";
  imagePrompt: string;
  imageNegativePrompt: string;
  videoPrompt: string;
  videoNegativePrompt: string;
}

// Routes to the right image model based on what Claude flagged in imageType
function selectImageModel(p: MediaPrompt): { model: string; label: string } {
  switch (p.imageType) {
    case "photorealistic": return { model: FAL_FLUX,  label: "Flux 1.1 Pro (photorealistic)" };
    case "text":           return { model: FAL_NBPRO, label: "Nano Banana Pro (text)" };
    case "text-pt":        return { model: FAL_GPT,   label: "GPT Image 2 (text-pt)" };
    default:               return { model: FAL_NB2,   label: "Nano Banana 2 (visual)" };
  }
}

// ─── Clients ──────────────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

fal.config({ credentials: process.env.FAL_KEY });

// ─── Apify ────────────────────────────────────────────────────────────────────

async function apifyFetch(
  endpoint: string,
  options?: RequestInit
): Promise<unknown> {
  const sep = endpoint.includes("?") ? "&" : "?";
  const url = `https://api.apify.com/v2${endpoint}${sep}token=${process.env.APIFY_API_TOKEN}`;
  const res = await fetch(url, options);
  if (!res.ok)
    throw new Error(`Apify ${res.status}: ${await res.text()}`);
  return res.json();
}

async function scrapeInstagram(profileUrls: string[]): Promise<ApifyPost[]> {
  log("📸", `Scraping Instagram (${profileUrls.length} profiles)...`);

  const run = (await apifyFetch("/acts/apify~instagram-scraper/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      directUrls: profileUrls,
      resultsType: "posts",
      resultsLimit: POSTS_PER_ACCOUNT,
      addParentData: false,
      scrapeStories: false,
    }),
  })) as { data: { id: string; defaultDatasetId: string } };

  const runId = run.data.id;
  log("  →", `Run: ${runId}`);

  const deadline = Date.now() + APIFY_TIMEOUT_MS;
  let status = "RUNNING";

  while (["RUNNING", "READY"].includes(status)) {
    if (Date.now() > deadline) throw new Error("Apify timeout após 5 min");
    await sleep(APIFY_POLL_MS);
    const poll = (await apifyFetch(`/actor-runs/${runId}`)) as {
      data: { status: string; defaultDatasetId: string };
    };
    status = poll.data.status;
    log("  →", `Status: ${status}`);
  }

  if (status !== "SUCCEEDED")
    throw new Error(`Apify terminou com: ${status}`);

  const items = (await apifyFetch(
    `/datasets/${run.data.defaultDatasetId}/items?clean=true&format=json`
  )) as ApifyPost[];

  log("  ✅", `${items.length} posts coletados`);
  return items;
}

// ─── Claude streaming ─────────────────────────────────────────────────────────

async function stream(
  system: string,
  user: string,
  thinking = true
): Promise<string> {
  const params = {
    model: "claude-opus-4-7" as const,
    max_tokens: 8192,
    stream: true as const,
    system,
    messages: [{ role: "user" as const, content: user }],
    ...(thinking ? { thinking: { type: "adaptive" as const } } : {}),
  };

  const s = anthropic.messages.stream(params as Parameters<typeof anthropic.messages.stream>[0]);
  let out = "";
  for await (const e of s) {
    if (e.type === "content_block_delta" && e.delta.type === "text_delta") {
      out += e.delta.text;
      process.stdout.write(e.delta.text);
    }
  }
  return out;
}

// ─── Step 2: Competitor Analysis ──────────────────────────────────────────────

function formatPosts(posts: ApifyPost[]): string {
  return posts
    .map(
      (p, i) => `
### Post ${i + 1} — @${p.ownerUsername ?? p.username ?? "?"}
- **Caption:** ${p.caption?.slice(0, 400) ?? "(sem legenda)"}
- **Likes:** ${p.likesCount ?? 0} | **Comentários:** ${p.commentsCount ?? 0} | **Views:** ${p.videoViewCount ?? "N/A"}
- **Tipo:** ${p.type ?? "image"} | **Data:** ${p.timestamp ?? "?"}
`
    )
    .join("\n---\n");
}

async function analyzeCompetitors(posts: ApifyPost[]): Promise<string> {
  log("\n🧠", "Analisando posts dos concorrentes...\n");
  return stream(
    `Você é um analista de inteligência competitiva especializado em marcas de longevidade e saúde no Instagram. Seja direto e orientado a dados.${BRAND_CONTEXT}`,
    `Analise estes ${posts.length} posts de Instagram dos concorrentes da Longevify.

${formatPosts(posts)}

Identifique para cada conta e no resumo cruzado:

## 1. Hooks — tipos, exemplos e engajamento
## 2. Estrutura das legendas — padrões de formato e tamanho
## 3. Padrões de copy — gatilhos, CTAs, tom de voz
## 4. Performance por formato — Reels vs. carrossel vs. estático
## 5. Temas — o que está saturado vs. lacunas não exploradas
## 6. Oportunidades para Longevify — 3-5 ações concretas

Formato: markdown estruturado, direto ao ponto.`
  );
}

// ─── Step 3: Generate Posts ───────────────────────────────────────────────────

async function generatePosts(analysis: string): Promise<string> {
  log("\n\n✍️", "Gerando posts para Longevify...\n");
  return stream(
    `Você é um copywriter de redes sociais para a Longevify, marca brasileira de longevidade.
Voz da marca: ${BRAND_VOICE}.
Público: ${TARGET_AUDIENCE}.
Escreva sempre em português brasileiro.${BRAND_CONTEXT}`,
    `Com base nesta análise competitiva:

${analysis}

Gere EXATAMENTE 3 posts para o Instagram da Longevify.

Para cada post:

---

## Post [N]: [Tema]

**Hook (1ª linha):** [abertura que para o scroll]

**Legenda:**
[150-350 caracteres, PT-BR, autêntico]

**Hashtags:** [8-12 hashtags]

**Formato:** [Reel / Carrossel / Estático + justificativa em 1 linha]

**Inspiração:** [padrão adaptado + o que mudou para Longevify]

**Por que vai performar:** [1-2 frases baseadas nos dados]

---`
  );
}

// ─── Step 4: Media Prompts (structured JSON) ──────────────────────────────────

function extractJson(text: string): MediaPrompt[] {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (!match) throw new Error("Claude não retornou JSON no formato esperado");
  return JSON.parse(match[1].trim()) as MediaPrompt[];
}

async function generateMediaPrompts(posts: string): Promise<{
  markdown: string;
  prompts: MediaPrompt[];
}> {
  log("\n\n🎨", "Gerando prompts de mídia...\n");

  const raw = await stream(
    `Você é um especialista em prompts de geração de imagem e vídeo para Instagram de saúde/longevidade.
Identidade visual Longevify: tons verde-escuro, off-white, dourado suave. Estilo editorial científico com calor humano brasileiro.${BRAND_CONTEXT}`,
    `Com base nestes 3 posts da Longevify:

${posts}

Retorne um JSON array com exatamente 3 objetos, dentro de um bloco \`\`\`json:

\`\`\`json
[
  {
    "postNumber": 1,
    "theme": "título curto do post",
    "imageType": "visual",
    "imagePrompt": "prompt detalhado em inglês — composição, iluminação, sujeitos, profundidade, cores. Aspect ratio 1:1 (square). Clean editorial health photography, warm Brazilian tones, dark forest-green backgrounds.",
    "imageNegativePrompt": "blur, distortion, watermark, oversaturated, stock photo cliché",
    "videoPrompt": "prompt detalhado em inglês para Kling/Veo — movimento de câmera, ação dos sujeitos, ambiente, áudio sugerido. Formato 9:16 vertical para Stories/Reels.",
    "videoNegativePrompt": "blur, shaky footage, watermark, distortion, low quality"
  }
]
\`\`\`

**Regras de imageType — escolha com precisão:**
- \`"visual"\`         → Lifestyle, fotografia de corpo humano, natureza, ambiente, macro orgânico. Sem texto na imagem. → Nano Banana 2 ($0.08)
- \`"photorealistic"\` → Fotorrealismo técnico, close-up de pele/biomarcadores, frame cinemático de reel, composição com profundidade de campo. → Flux 1.1 Pro ($0.04/MP)
- \`"text"\`           → Infográfico, estatística em destaque, citação visual, carrossel com headline, qualquer composição com tipografia legível em inglês. → Nano Banana Pro ($0.15)
- \`"text-pt"\`        → Texto em português na imagem: frase de impacto, número de destaque, chamada do post. Use quando o texto precisa ser legível e correto em PT-BR. → GPT Image 2 (token-based)

Seja extremamente descritivo nos prompts — detalhes específicos geram imagens melhores.`,
    false
  );

  const prompts = extractJson(raw);

  // Gera versão markdown legível para o arquivo salvo
  const modelLabel = (type: MediaPrompt["imageType"]) => {
    switch (type) {
      case "photorealistic": return "Flux 1.1 Pro";
      case "text":           return "Nano Banana Pro";
      case "text-pt":        return "GPT Image 2";
      default:               return "Nano Banana 2";
    }
  };

  const markdown = prompts
    .map(
      (p) => `## Prompt ${p.postNumber}: ${p.theme}

### 🖼 Imagem (${modelLabel(p.imageType)} — 1:1)
**Prompt:** ${p.imagePrompt}
**Negative:** ${p.imageNegativePrompt}

### 🎬 Vídeo (Kling v3 / Veo 3 — 9:16)
**Prompt:** ${p.videoPrompt}
**Negative:** ${p.videoNegativePrompt}`
    )
    .join("\n\n---\n\n");

  return { markdown, prompts };
}

// ─── Step 5: Generate Images via fal.ai (NB2 / NBPro / Flux / GPT Image 2) ───

interface FalImagesOutput {
  images: Array<{ url: string; file_name?: string; content_type: string }>;
  description?: string;
}

/** Build the fal.ai input object per model family */
function buildImageInput(p: MediaPrompt, model: string): Record<string, unknown> {
  // GPT Image 2 — enum image_size (não aceita "1024x1024"), no negative_prompt
  if (model === FAL_GPT) {
    return {
      prompt: p.imagePrompt,
      image_size: "square_hd",  // fal.ai enum = 1024x1024
      quality: "high",
      num_images: 1,
      output_format: "png",
    };
  }

  // Flux — image_size (not aspect_ratio), supports negative_prompt
  if (model === FAL_FLUX) {
    return {
      prompt: p.imagePrompt,
      negative_prompt: p.imageNegativePrompt,
      image_size: "square_hd",
      num_images: 1,
      output_format: "jpeg",
      safety_tolerance: "2",
    };
  }

  // Nano Banana (NB2 / NBPro) — aspect_ratio, no negative_prompt
  const input: Record<string, unknown> = {
    prompt: p.imagePrompt,
    aspect_ratio: "1:1",
    num_images: 1,
    output_format: "jpeg",
    safety_tolerance: "2",
    resolution: "1K",
  };
  if (model === FAL_NB2) input.thinking_level = "minimal";
  return input;
}

async function generateImages(prompts: MediaPrompt[]): Promise<void> {
  if (!process.env.FAL_KEY) {
    log("⚠️", "FAL_KEY não configurada — pulando geração de imagens");
    return;
  }

  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  log("\n\n🖼 ", `Gerando ${prompts.length} imagens...`);

  for (const p of prompts) {
    const { model, label } = selectImageModel(p);
    log("  →", `Post ${p.postNumber} [${label}]: ${p.theme}`);

    let rawPath = "";
    try {
      const result = await fal.subscribe(model, {
        input: buildImageInput(p, model),
        logs: false,
      }) as { data: FalImagesOutput };

      const imageUrl = result.data.images[0]?.url;
      if (!imageUrl) throw new Error("nenhuma imagem retornada");

      const ext = model === FAL_GPT ? "png" : "jpg";
      const rawName = `post-${p.postNumber}-${slugify(p.theme)}-raw.${ext}`;
      rawPath = path.join(IMAGES_DIR, rawName);
      await downloadFile(imageUrl, rawPath);
      log("  ✅", `${rawName} (foto limpa)`);
    } catch (err) {
      log("  ⚠️", `Post ${p.postNumber}: ${(err as Error).message} — fallback Flux`);
      rawPath = await generateImageFallback(p) ?? "";
    }

    // Compositing — logo real + legenda via sharp
    if (rawPath && fs.existsSync(rawPath)) {
      const finalName = `post-${p.postNumber}-${slugify(p.theme)}.jpg`;
      const finalPath = path.join(IMAGES_DIR, finalName);
      try {
        await compositeLogoAndText(rawPath, finalPath, {
          caption: p.theme,
          subline: "longevify.com.br",
          logoScale: 0.50,
          logoY: 0.52,
          captionY: 0.30,
          format: "jpg",
        });
        log("  ✅", `${finalName} (com logo + texto)`);
      } catch (err) {
        log("  ⚠️", `Composite post-${p.postNumber}: ${(err as Error).message}`);
      }
    }
  }
}

// Flux fallback — retorna o path do arquivo salvo ou null
async function generateImageFallback(p: MediaPrompt): Promise<string | null> {
  try {
    const result = await fal.subscribe(FAL_FLUX, {
      input: buildImageInput({ ...p, imageType: "photorealistic" }, FAL_FLUX),
      logs: false,
    }) as { data: FalImagesOutput };
    const url = result.data.images[0]?.url;
    if (url) {
      const filename = `post-${p.postNumber}-${slugify(p.theme)}-raw-flux.jpg`;
      const filepath = path.join(IMAGES_DIR, filename);
      await downloadFile(url, filepath);
      log("  ✅", `${filename} (Flux fallback)`);
      return filepath;
    }
  } catch {
    log("  ❌", `Post ${p.postNumber}: fallback Flux também falhou`);
  }
  return null;
}

// ─── Brain Score (TRIBE v2 viral optimizer) ───────────────────────────────────

const VENV_PYTHON = path.join(__dirname, "..", "tribev2", ".venv311", "bin", "python");
const VIRAL_OPTIMIZER = path.join(__dirname, "scripts", "viral-optimizer.py");

async function runBrainScore(assetPaths: string[]): Promise<void> {
  if (!fs.existsSync(VENV_PYTHON)) {
    log("⚠️ ", "brain-score: venv311 não encontrado — pulando análise neural");
    return;
  }

  const existing = assetPaths.filter(p => fs.existsSync(p));
  if (!existing.length) return;

  log("\n\n🧠", "Rodando brain-score (TRIBE v2)...");
  try {
    const out = execSync(
      `"${VENV_PYTHON}" "${VIRAL_OPTIMIZER}" ${existing.map(p => `"${p}"`).join(" ")}`,
      { encoding: "utf-8", timeout: 10 * 60_000 }
    );
    console.log(out);

    // Extrai o viral score do output para emitir o aviso do pipeline
    const scoreMatch = out.match(/Viral Score:\s*([\d.]+)\/100/g);
    if (scoreMatch) {
      scoreMatch.forEach(m => {
        const score = parseFloat(m.match(/([\d.]+)/)?.[1] ?? "0");
        const asset = existing[scoreMatch.indexOf(m)];
        const name  = path.basename(asset);
        if (score < 70) {
          log("⚠️ ", `${name}: score ${score.toFixed(0)}/100 — revisa antes de postar!`);
        } else {
          log("✅", `${name}: ${score.toFixed(0)}/100 — manda bala!`);
        }
      });
    }
  } catch (err) {
    log("⚠️ ", `brain-score falhou: ${(err as Error).message.slice(0, 200)}`);
  }
}

// ─── Step 6: Generate Videos via Kling v3 + Veo 3 + Seedance (opt-in) ────────

interface VideoOutput {
  video: { url: string; file_name?: string };
}

async function generateVideos(prompts: MediaPrompt[]): Promise<void> {
  if (!GENERATE_VIDEO) {
    log(
      "\n⏭ ",
      "Geração de vídeo desativada (defina GENERATE_VIDEO=true no .env para ativar)"
    );
    return;
  }

  if (!process.env.FAL_KEY) {
    log("⚠️", "FAL_KEY não configurada — pulando vídeos");
    return;
  }

  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
  log("\n\n🎬", `Gerando vídeos para ${prompts.length} posts...`);
  log(
    "  ⚠️",
    "Kling v3 ≈ $0.56/5s · Veo 3 ≈ $2/clip · Seedance = rápido · Aguarde ~4-8 min"
  );

  for (const p of prompts) {
    log("  →", `Post ${p.postNumber}: ${p.theme}`);

    // ── Kling v3 Pro — Reel/Story vertical 9:16 com áudio ──────────────────
    try {
      log("    ⏳", "Kling v3 Pro (9:16, 5s, áudio)...");
      const klingResult = await fal.subscribe(FAL_VIDEO_KLING, {
        input: {
          prompt: p.videoPrompt,
          negative_prompt: p.videoNegativePrompt,
          duration: 5,
          aspect_ratio: "9:16",
          cfg_scale: 0.5,
          generate_audio: true,  // v3 — áudio ambiente nativo
        },
        logs: false,
      }) as { data: VideoOutput };

      const klingUrl = klingResult.data.video?.url;
      if (klingUrl) {
        const klingFile = `post-${p.postNumber}-kling-v3-${slugify(p.theme)}.mp4`;
        await downloadFile(klingUrl, path.join(VIDEOS_DIR, klingFile));
        log("    ✅", `Kling v3: ${klingFile}`);
      }
    } catch (err) {
      log("    ❌", `Kling v3 falhou: ${(err as Error).message}`);
    }

    // ── Veo 3 — cenas cinematográficas macro com áudio ──────────────────────
    try {
      log("    ⏳", "Veo 3 (16:9, áudio)...");
      const veoResult = await fal.subscribe(FAL_VIDEO_VEO, {
        input: {
          prompt: p.videoPrompt,
          aspect_ratio: "16:9",
          audio_enabled: true,
        },
        logs: false,
      }) as { data: VideoOutput };

      const veoUrl = veoResult.data.video?.url;
      if (veoUrl) {
        const veoFile = `post-${p.postNumber}-veo3-${slugify(p.theme)}.mp4`;
        await downloadFile(veoUrl, path.join(VIDEOS_DIR, veoFile));
        log("    ✅", `Veo 3: ${veoFile}`);
      }
    } catch (err) {
      log("    ❌", `Veo 3 falhou: ${(err as Error).message}`);
    }

    // ── Seedance v1 Lite — alternativa rápida e barata ─────────────────────
    if (FAL_VIDEO_SEEDANCE) {
      try {
        log("    ⏳", "Seedance v1 Lite (9:16, 5s)...");
        const seedResult = await fal.subscribe(FAL_VIDEO_SEEDANCE, {
          input: {
            prompt: p.videoPrompt,
            negative_prompt: p.videoNegativePrompt,
            aspect_ratio: "9:16",
            duration: 5,
          },
          logs: false,
        }) as { data: VideoOutput };

        const seedUrl = seedResult.data.video?.url;
        if (seedUrl) {
          const seedFile = `post-${p.postNumber}-seedance-${slugify(p.theme)}.mp4`;
          await downloadFile(seedUrl, path.join(VIDEOS_DIR, seedFile));
          log("    ✅", `Seedance: ${seedFile}`);
        }
      } catch (err) {
        log("    ❌", `Seedance falhou: ${(err as Error).message}`);
      }
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download falhou: ${res.status} ${url}`);
  const buffer = await res.arrayBuffer();
  fs.writeFileSync(dest, Buffer.from(buffer));
}

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[áàãâä]/g, "a")
    .replace(/[éèêë]/g, "e")
    .replace(/[íìîï]/g, "i")
    .replace(/[óòõôö]/g, "o")
    .replace(/[úùûü]/g, "u")
    .replace(/[ç]/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function save(filename: string, content: string): void {
  fs.writeFileSync(path.join(OUTPUT_DIR, filename), content, "utf-8");
  log("  💾", `output/${TODAY}/${filename}`);
}

function log(icon: string, msg: string): void {
  console.log(`${icon} ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n🚀 Content Machine — Longevify");
  console.log(`📅 ${TODAY}`);
  console.log(`🖼  visual:          ${FAL_NB2}`);
  console.log(`🖼  photorealistic:  ${FAL_FLUX}`);
  console.log(`🖼  text:            ${FAL_NBPRO}`);
  console.log(`🖼  text-pt:         ${FAL_GPT}`);
  if (GENERATE_VIDEO) {
    console.log(`🎬 ${FAL_VIDEO_KLING}`);
    console.log(`🎬 ${FAL_VIDEO_VEO}`);
    console.log(`🎬 ${FAL_VIDEO_SEEDANCE}`);
  }
  console.log("─".repeat(60));

  if (!process.env.ANTHROPIC_API_KEY)
    throw new Error("ANTHROPIC_API_KEY não definida no .env");
  if (!process.env.APIFY_API_TOKEN)
    throw new Error("APIFY_API_TOKEN não definida no .env");

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // ── 1. Scrape ──────────────────────────────────────────────────────────────
  const rawPosts = await scrapeInstagram(COMPETITORS.map((c) => c.url));
  if (rawPosts.length === 0)
    throw new Error("Nenhum post coletado — verifique os handles no .env");
  save("01_raw_posts.json", JSON.stringify(rawPosts, null, 2));

  // ── 2. Análise competitiva ─────────────────────────────────────────────────
  const analysis = await analyzeCompetitors(rawPosts);
  save(
    "02_competitor_analysis.md",
    `# Análise Competitiva — ${TODAY}\n\n> ${rawPosts.length} posts · ${COMPETITORS.map((c) => c.name).join(" · ")}\n\n${analysis}`
  );

  // ── 3. Posts para Longevify ────────────────────────────────────────────────
  const longevifyPosts = await generatePosts(analysis);
  save(
    "03_longevify_posts.md",
    `# Posts Longevify — ${TODAY}\n\n${longevifyPosts}`
  );

  // ── 4. Media prompts ───────────────────────────────────────────────────────
  const { markdown: promptsMd, prompts } =
    await generateMediaPrompts(longevifyPosts);
  save(
    "04_media_prompts.md",
    `# Prompts de Mídia — ${TODAY}\n\n> NB2 (visual) · Flux (photorealistic) · NBPro (text) · GPT Image 2 (text-pt) · Kling v3 + Veo 3 + Seedance (vídeo)\n\n${promptsMd}`
  );

  // ── 5. Imagens via fal.ai Flux ─────────────────────────────────────────────
  await generateImages(prompts);

  // ── 5b. Brain score nas imagens finais ────────────────────────────────────
  const finalImages = prompts.map(p =>
    path.join(IMAGES_DIR, `post-${p.postNumber}-${slugify(p.theme)}.jpg`)
  );
  await runBrainScore(finalImages);

  // ── 6. Vídeos via fal.ai Kling + Veo (opt-in) ─────────────────────────────
  await generateVideos(prompts);

  // ── 6b. Brain score nos vídeos gerados ───────────────────────────────────
  if (GENERATE_VIDEO) {
    const finalVideos = prompts.flatMap(p => [
      path.join(VIDEOS_DIR, `post-${p.postNumber}-kling-v3-${slugify(p.theme)}.mp4`),
      path.join(VIDEOS_DIR, `post-${p.postNumber}-veo3-${slugify(p.theme)}.mp4`),
    ]);
    await runBrainScore(finalVideos);
  }

  // ── Resumo ─────────────────────────────────────────────────────────────────
  console.log("\n\n" + "─".repeat(54));
  console.log("✅ Pipeline completo!");
  console.log(`\n📁 content-machine/output/${TODAY}/`);
  console.log("   01_raw_posts.json         ← dados brutos do Instagram");
  console.log("   02_competitor_analysis.md ← análise de hook/copy/lacunas");
  console.log("   03_longevify_posts.md     ← 3 posts prontos (PT-BR)");
  console.log("   04_media_prompts.md       ← prompts Flux + Kling + Veo");
  console.log("   05_images/               ← imagens geradas pelo Flux");
  if (GENERATE_VIDEO) {
    console.log("   06_videos/               ← vídeos Kling 9:16 + Veo 16:9");
  }
  console.log();
}

main().catch((err) => {
  console.error("\n❌ Pipeline falhou:", err.message);
  process.exit(1);
});
