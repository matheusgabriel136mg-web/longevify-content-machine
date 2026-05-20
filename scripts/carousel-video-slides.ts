/**
 * carousel-video-slides.ts — analisa slides de vídeo dentro de carrosséis.
 *
 * Por que: ~22 carrosséis SP+Mito têm childPosts com videoUrl (slides de vídeo).
 * O visual-dna trata esses como capa estática. Esse script baixa cada vídeo
 * e roda Gemini Pro (vídeo nativo) pra análise temporal completa.
 *
 * Uso:
 *   npm run carousel-videos                          # SP + Mito
 *   npm run carousel-videos -- --brand=Superpower    # uma marca
 *
 * Custo: ~$0.02 por slide × ~69 slides = ~$1.40
 * Tempo: ~60-120s por slide
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);

const MODEL_PRIMARY = "gemini-2.5-pro";
const MODEL_FALLBACK = "gemini-2.0-flash";
const MAX_VIDEO_BYTES = 18 * 1024 * 1024;
const REQUEST_DELAY_MS = 1000;

const args = process.argv.slice(2);
const onlyBrand = args.find((a) => a.startsWith("--brand="))?.split("=")[1];

interface ChildPost {
  displayUrl?: string;
  videoUrl?: string;
  type?: string;
}

interface RawPost {
  url?: string;
  shortCode?: string;
  brand: string;
  format: "image" | "carousel" | "reel";
  caption?: string;
  vsMedian?: number;
  childPosts?: ChildPost[];
}

interface VideoSlideAnalysis {
  carouselUrl: string;
  brand: string;
  slideIdx: number;
  videoUrl: string;
  durationFromAnalysis?: string;
  analysis: Record<string, unknown> | null;
  meta: {
    analyzedAt: string;
    model: string;
    error?: string;
  };
}

function findLatestAnalysisDir(): string {
  const dirs = fs.readdirSync(path.join(ROOT, "output")).filter((n) => n.startsWith("analysis-")).sort();
  return path.join(ROOT, "output", dirs[dirs.length - 1]);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function downloadVideo(url: string, dest: string): Promise<{ size: number; mime: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_VIDEO_BYTES) {
    throw new Error(`Vídeo > 18MB (${(buf.length / 1024 / 1024).toFixed(1)}MB)`);
  }
  fs.writeFileSync(dest, buf);
  return { size: buf.length, mime: (res.headers.get("content-type") ?? "video/mp4").split(";")[0].trim() };
}

const SYSTEM_PROMPT = `Você é diretor de cinema sênior. Esse é UM SLIDE DE VÍDEO dentro de um carrossel Instagram. Slides de carrossel duram 2-8 segundos tipicamente — vídeo curto, focado, geralmente 1-2 cenas.

Sua missão: descrever esse slide com detalhe replicável. Foco em:
- Movimento (camera, sujeito, partículas, transições)
- Paleta hex exata
- Áudio (se houver — música, voz, SFX)
- Texto/overlays com timing
- Mood + intenção do slide dentro do carrossel`;

function buildPrompt(p: RawPost, slideIdx: number): string {
  return `${SYSTEM_PROMPT}

## Contexto
- Marca: @${p.brand}
- Caption do carrossel: "${(p.caption ?? "").split("\n")[0].slice(0, 200)}"
- Slide ${slideIdx + 1} de ${p.childPosts?.length ?? "?"}

## Output
APENAS JSON (sem markdown):

{
  "duration": "X.Xs",
  "movement": "static | slow push-in | pan left | morph | particle drift | etc",
  "scenes": [
    { "range": "0.0s-2.5s", "description": "PT", "subject": "o que aparece", "framing": "ECU|CU|MS|...", "cameraMove": "...", "palette": ["#hex"] }
  ],
  "audio": {
    "present": true,
    "type": "music | sfx | voice | none",
    "description": "PT — se houver"
  },
  "textOverlays": [
    { "time": "0.0s-3.0s", "text": "literal", "position": "...", "font": "estimada", "color": "#hex" }
  ],
  "lookAndFeel": "PT — descrição geral do estilo desse slide específico",
  "replicationPrompt": "PT — prompt de ~150 palavras pronto pra Veo 3 / Kling v3 recriar esse slide. Inclui movement, palette hex, lighting, mood, audio se houver."
}`;
}

function safeParseJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```(?:json)?\s*/g, "").replace(/```\s*$/g, "").trim();
  try { return JSON.parse(cleaned); } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { return null; }
    }
    return null;
  }
}

async function analyzeSlide(p: RawPost, slideIdx: number, videoUrl: string, tmpDir: string): Promise<VideoSlideAnalysis> {
  const carouselUrl = p.url ?? `https://instagram.com/p/${p.shortCode}`;
  const sc = p.shortCode ?? "x";
  const tmpFile = path.join(tmpDir, `cs-${sc}-${slideIdx}.mp4`);

  const entry: VideoSlideAnalysis = {
    carouselUrl,
    brand: p.brand,
    slideIdx,
    videoUrl,
    analysis: null,
    meta: { analyzedAt: new Date().toISOString(), model: MODEL_PRIMARY },
  };

  try {
    const { mime } = await downloadVideo(videoUrl, tmpFile);
    const data = fs.readFileSync(tmpFile);
    const base64 = data.toString("base64");

    const genai = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
    const prompt = buildPrompt(p, slideIdx);

    for (const modelName of [MODEL_PRIMARY, MODEL_FALLBACK]) {
      try {
        const model = genai.getGenerativeModel({ model: modelName });
        const result = await model.generateContent({
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { mimeType: mime, data: base64 } },
                { text: prompt },
              ],
            },
          ],
        });
        const parsed = safeParseJson(result.response.text());
        if (parsed) {
          entry.analysis = parsed;
          entry.meta.model = modelName;
          entry.durationFromAnalysis = parsed.duration as string | undefined;
          return entry;
        }
        entry.meta.error = `${modelName}: JSON inválido`;
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes("429") || msg.includes("quota")) continue;
        entry.meta.error = `${modelName}: ${msg.slice(0, 200)}`;
        break;
      }
    }
    return entry;
  } catch (err) {
    entry.meta.error = (err as Error).message.slice(0, 200);
    return entry;
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
}

async function main() {
  if (!process.env.GOOGLE_API_KEY) throw new Error("GOOGLE_API_KEY ausente");

  const dir = findLatestAnalysisDir();
  const raw = JSON.parse(fs.readFileSync(path.join(dir, "raw-posts.json"), "utf-8")) as RawPost[];

  const targetBrands = onlyBrand ? [onlyBrand] : ["Superpower", "Mito Health"];
  let carousels = raw.filter((p) => targetBrands.includes(p.brand) && p.format === "carousel");

  // Apenas carrosséis que têm pelo menos 1 video childPost
  const work: Array<{ post: RawPost; slideIdx: number; videoUrl: string }> = [];
  for (const p of carousels) {
    const children = p.childPosts ?? [];
    children.forEach((c, idx) => {
      if (c.videoUrl) work.push({ post: p, slideIdx: idx, videoUrl: c.videoUrl });
    });
  }

  console.log(`📁 ${path.basename(dir)}`);
  console.log(`🎬 ${work.length} slides de vídeo em ${new Set(work.map((w) => w.post.url)).size} carrosséis · marcas: ${targetBrands.join(", ")}`);

  const tmpDir = path.join(ROOT, "output", "tmp-carousel-videos");
  fs.mkdirSync(tmpDir, { recursive: true });

  const results: VideoSlideAnalysis[] = [];
  for (let i = 0; i < work.length; i++) {
    const w = work[i];
    const tag = `[${i + 1}/${work.length}] ${w.post.brand} · ${w.post.shortCode}-slide${w.slideIdx}`;
    process.stdout.write(`  ${tag} ... `);
    const r = await analyzeSlide(w.post, w.slideIdx, w.videoUrl, tmpDir);
    results.push(r);
    if (r.analysis) {
      const dur = r.durationFromAnalysis ?? "?";
      const scenes = Array.isArray(r.analysis.scenes) ? r.analysis.scenes.length : "?";
      process.stdout.write(`✅ ${dur} · ${scenes} cenas\n`);
    } else {
      process.stdout.write(`⚠️  ${r.meta.error?.slice(0, 80) ?? "sem análise"}\n`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  // Salva por marca
  const byBrand = new Map<string, VideoSlideAnalysis[]>();
  for (const r of results) {
    if (!byBrand.has(r.brand)) byBrand.set(r.brand, []);
    byBrand.get(r.brand)!.push(r);
  }
  for (const [brand, list] of byBrand) {
    const slug = brand.toLowerCase().replace(/\s+/g, "-");
    const outPath = path.join(dir, `carousel-video-slides-${slug}.json`);
    fs.writeFileSync(outPath, JSON.stringify(list, null, 2));
    const ok = list.filter((r) => r.analysis).length;
    console.log(`\n✅ ${brand}: ${ok}/${list.length} → ${path.basename(outPath)}`);
  }
}

main().catch((err) => { console.error("\n❌", err.message); process.exit(1); });
