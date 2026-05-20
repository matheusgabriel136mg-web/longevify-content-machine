/**
 * reel-dna.ts — análise completa de reels em vídeo nativo.
 *
 * Pra cada reel: baixa o videoUrl, manda inteiro pro Gemini 2.5 Pro
 * (vídeo nativo, sem extração de frames) e pede análise estruturada
 * em JSON cobrindo VISUAL + ÁUDIO + EDIÇÃO + TEXTO + HOOK + 3 PROMPTS
 * replicáveis (Veo 3 / Kling v3 Pro / Seedance i2v).
 *
 * Saída: reel-dna-{brand}.json
 *
 * Custo: ~$0.02 por reel · Tempo: ~60-120s por reel (download + Gemini Pro)
 *
 * Uso:
 *   npm run reel-dna -- --brand=Superpower [--limit=30]
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);

const MODEL_PRIMARY = "gemini-2.5-pro";
const MODEL_FALLBACK = "gemini-2.0-flash";
const MAX_VIDEO_BYTES = 18 * 1024 * 1024; // ~18MB safe limit pra inlineData
const REQUEST_DELAY_MS = 1000;

const args = process.argv.slice(2);
const onlyBrand = args.find((a) => a.startsWith("--brand="))?.split("=")[1];
const limit = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 0);

if (!onlyBrand) throw new Error("Passe --brand=Superpower (ou outra)");

interface RawPost {
  url?: string;
  shortCode?: string;
  brand?: string;
  format?: string;
  videoUrl?: string;
  displayUrl?: string;
  caption?: string;
  vsMedian?: number;
  videoPlayCount?: number;
  videoViewCount?: number;
}

function findLatestAnalysisDir(): string {
  const dirs = fs
    .readdirSync(path.join(ROOT, "output"))
    .filter((n) => n.startsWith("analysis-"))
    .sort();
  if (!dirs.length) throw new Error("Nenhuma pasta analysis-*");
  return path.join(ROOT, "output", dirs[dirs.length - 1]);
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function downloadVideo(url: string, dest: string): Promise<{ size: number; mime: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_VIDEO_BYTES) {
    throw new Error(`Vídeo muito grande (${(buf.length / 1024 / 1024).toFixed(1)}MB > 18MB) — Gemini File API recomendado`);
  }
  fs.writeFileSync(dest, buf);
  const mime = (res.headers.get("content-type") ?? "video/mp4").split(";")[0].trim();
  return { size: buf.length, mime };
}

const SYSTEM_PROMPT = `Você é um diretor de cinema e diretor de arte sênior, especialista em conteúdo viral de saúde/longevidade premium em formato Reels (9:16). Sua única missão: descrever este vídeo com PERFEIÇÃO DE FORMA REPLICÁVEL VIA PROMPT — alguém deve conseguir recriar 95% do reel só lendo seu output.

Seu output cobre 5 dimensões interligadas:
  1. VISUAL (cena a cena com timestamps reais, paleta hex exata, lente, iluminação K, movimento de câmera)
  2. ÁUDIO (música BPM/gênero/mood, voz tom/sotaque/cadência, SFX, sound design, mix)
  3. EDIÇÃO (cortes por minuto, tipos de transição, ritmo, speed ramps)
  4. TEXTO/OVERLAYS (timing exato, fonte estimada, cor, animação de entrada/saída)
  5. ESTRUTURA NARRATIVA (hook nos primeiros 1.5s, retenção mid-roll, payoff/CTA)

Especificidade > generalidade. Sempre que possível, dê:
  - Hex codes exatos (não "warm tones" — diga "#F6A6C5 → #B74635")
  - Tempo em segundos (não "no início" — diga "0.0s-1.4s")
  - Lente em mm e abertura (não "close-up" — diga "85mm f/2.8 shallow DOF")
  - Temperatura de cor em Kelvin (não "warm" — diga "3200K com gel CTO")
  - BPM da música (não "upbeat" — diga "BPM ~110, downtempo electronic, sub-bass prominente")
  - Marcas referenciadas (Apple? Aesop? Equinox? Calvin Klein?)`;

function buildPrompt(p: RawPost): string {
  return `${SYSTEM_PROMPT}

## Contexto do reel
- Marca: @${p.brand}
- Hook (caption): "${(p.caption ?? "").split("\n")[0].slice(0, 200)}"
- vsMedian: ${(p.vsMedian ?? 0).toFixed(2)}x
- Views: ${p.videoViewCount ?? p.videoPlayCount ?? "N/A"}

## Saída

Responda APENAS um JSON (sem markdown, sem texto antes/depois). Schema:

{
  "duration": "duração total em segundos (ex: 23.4)",
  "aspectRatio": "9:16 | 1:1 | 4:5",

  "narrative": {
    "hookFirst1_5s": "EM PORTUGUÊS — descrição minuto-detalhe do que acontece nos primeiros 1.5s. Esse é o stop-scroll. Inclui visual + áudio + texto se houver.",
    "midRollRetention": "como o reel mantém o viewer entre 1.5s e o payoff (ritmo, mistério, revelação progressiva)",
    "payoff": "qual é o pagamento emocional/informacional final",
    "cta": "tem CTA explícito? qual? quando aparece (timestamp)?"
  },

  "scenes": [
    {
      "range": "0.0s-1.4s",
      "description": "EM PORTUGUÊS — o que acontece visualmente",
      "subject": "o que/quem está em cena",
      "framing": "ECU|CU|MCU|MS|MLS|LS|ELS · ângulo (eye-level/low/high/dutch)",
      "lens": "lente equivalente em mm (ex: 35mm) · abertura (ex: f/1.8) · DOF (shallow/deep)",
      "cameraMove": "static | slow push-in | pan left | dolly out | handheld | crane | gimbal whip",
      "lighting": "key light direção/qualidade · temperatura K · contraste",
      "palette": ["#hex1", "#hex2", "#hex3"],
      "compositionRule": "rule-of-thirds | center | golden ratio | leading lines | symmetry",
      "movementInScene": "ação dos sujeitos (ex: 'mulher gira lentamente, cabelo voa em câmera lenta')"
    }
  ],

  "audio": {
    "music": {
      "present": true,
      "genre": "downtempo electronic | lofi | cinematic | indie | pop | trap | classical etc",
      "bpm": 95,
      "mood": "contemplativo | urgente | nostálgico | euforico | clínico | misterioso",
      "instruments": ["sub bass synth", "soft pads", "muted piano"],
      "structure": "build-up | drop | constante | sweep | duck na voz",
      "referenceTrack": "estilo similar a 'X' de 'Y' se reconhecível"
    },
    "voice": {
      "present": false,
      "language": "en-US | pt-BR | en-UK | none",
      "gender": "M | F | neutral",
      "ageRange": "20s | 30s | 40s | 50s+",
      "tone": "calmo/autoritativo | empolgado | sussurrado | direct ASMR-ish",
      "pace": "lento | médio | rápido (palavras/min)",
      "accent": "general American | British RP | Brazilian Portuguese clean",
      "transcript": "transcrição completa palavra-por-palavra (se houver fala)"
    },
    "sfx": [
      { "time": "0.5s", "type": "whoosh | bass drop | chime | swell | impact", "purpose": "transição | acento | ambiente" }
    ],
    "ambience": "silêncio | ruído urbano leve | natureza | estúdio mudo",
    "mix": "música prominente · voz prominente · ducking automático na fala · 50/50 · SFX em primeiro plano"
  },

  "edit": {
    "totalCuts": 8,
    "cutsPerMinute": 24,
    "cutTypes": ["hard cut", "match cut", "J-cut audio precede"],
    "transitions": ["whip pan 0.3s @1.2s", "morph cut @4.5s"],
    "speedRamps": "ex: ramp 100%→200% em 2.0s-2.4s",
    "rhythm": "constante | acelera no clímax | desacelera pro CTA"
  },

  "textOverlays": [
    {
      "time": "0.0s-2.5s",
      "text": "TEXTO LITERAL na tela (OCR exato)",
      "font": "estimada (ex: SF Pro Display Bold | Inter Medium | Helvetica Neue)",
      "weight": "Light | Regular | Medium | Bold | Black",
      "size": "extra-large | large | medium | small (relativo ao frame)",
      "color": "#hex",
      "position": "top-left | center | bottom-third | full-bleed",
      "animation": "fade-in 0.3s | type-in caractere a caractere | slide-up | bounce | none",
      "tracking": "tight (-2) | normal | loose (+50)"
    }
  ],

  "lookAndFeel": {
    "grade": "ex: lifted blacks, lowered saturation, warm shadows, cool highlights — estilo film emulation S-Curve",
    "grain": "0% | 3% | 5% | 8% (filme 35mm vibe)",
    "lutReference": "Kodak Portra 400 | Fuji Pro 400H | Apple ProRes log-to-Rec709 | bypass",
    "vignette": "none | subtle | strong",
    "brandReferences": ["Apple keynote", "Aesop minimal", "Calvin Klein editorial"]
  },

  "replicationPrompts": {
    "veo3": "EM INGLÊS — prompt de ~150-300 palavras pro Veo 3 (text-to-video com áudio nativo). Formato 9:16, duração X seconds. Inclui descrição visual cena a cena com timestamps, movimento de câmera por cena, paleta hex, lighting, descrição do ÁUDIO desejado (música, voz, SFX), texto na tela com timing. Específico, replicável.",
    "klingV3Pro": "EM INGLÊS — prompt pro Kling v3 Pro (text-to-video com áudio nativo). ~200 palavras. Foco: action verbs, camera moves explícitos, mood, palette. Inclui audio cue. Diferente do Veo: Kling responde melhor a descrições mais visuais que técnicas.",
    "seedanceI2V": "EM INGLÊS — prompt pro Seedance image-to-video (animação de uma imagem-base). ~80 palavras. Foco: ONE motion direction, intensity 1-10, duration. Sintético."
  },

  "longevifyAdaptation": {
    "applicableForPillar": "1 | 2 | 3 | 4 | NA",
    "rationale": "PT — por que esse formato/aesthetic se adapta (ou não) aos pilares Longevify",
    "adaptationBrief": "PT — briefing de ~80 palavras de COMO recriar esse reel pro Longevify, mantendo a fórmula viral mas com paleta/tom Longevify"
  }
}`;
}

interface ReelDna {
  url: string;
  brand: string;
  shortCode: string;
  vsMedian: number;
  caption: string;
  hookLine: string;
  videoUrl?: string;
  displayUrl?: string;
  videoBytes?: number;
  views?: number | null;
  analysis: Record<string, unknown> | null;
  meta: {
    analyzedAt: string;
    model: string;
    error?: string;
  };
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

async function analyzeReel(p: RawPost, tmpDir: string): Promise<ReelDna> {
  const url = p.url ?? `https://instagram.com/p/${p.shortCode ?? ""}`;
  const sc = p.shortCode ?? "x";
  const baseEntry: ReelDna = {
    url, brand: p.brand ?? "?", shortCode: sc, vsMedian: p.vsMedian ?? 0,
    caption: p.caption ?? "", hookLine: (p.caption ?? "").split("\n")[0].slice(0, 200),
    videoUrl: p.videoUrl, displayUrl: p.displayUrl,
    views: p.videoViewCount ?? p.videoPlayCount ?? null,
    analysis: null,
    meta: { analyzedAt: new Date().toISOString(), model: MODEL_PRIMARY },
  };

  if (!p.videoUrl) {
    baseEntry.meta.error = "videoUrl ausente";
    return baseEntry;
  }

  const tmpFile = path.join(tmpDir, `reel-${sc}.mp4`);

  try {
    const { size, mime } = await downloadVideo(p.videoUrl, tmpFile);
    baseEntry.videoBytes = size;

    const data = fs.readFileSync(tmpFile);
    const base64 = data.toString("base64");

    const genai = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
    const prompt = buildPrompt(p);

    const tryModels = [MODEL_PRIMARY, MODEL_FALLBACK];
    for (const modelName of tryModels) {
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
        const text = result.response.text();
        const parsed = safeParseJson(text);
        if (parsed) {
          baseEntry.analysis = parsed;
          baseEntry.meta.model = modelName;
          return baseEntry;
        }
        baseEntry.meta.error = `${modelName}: JSON inválido`;
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes("429") || msg.includes("quota") || msg.includes("RESOURCE_EXHAUSTED")) {
          continue; // tenta fallback
        }
        baseEntry.meta.error = `${modelName}: ${msg.slice(0, 200)}`;
        break;
      }
    }
    return baseEntry;
  } catch (err) {
    baseEntry.meta.error = (err as Error).message.slice(0, 200);
    return baseEntry;
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
}

async function main() {
  if (!process.env.GOOGLE_API_KEY) throw new Error("GOOGLE_API_KEY ausente");

  const dir = findLatestAnalysisDir();
  const raw = JSON.parse(fs.readFileSync(path.join(dir, "raw-posts.json"), "utf-8")) as RawPost[];

  let reels = raw.filter((p) => p.brand === onlyBrand && p.format === "reel" && p.videoUrl);
  console.log(`📁 ${path.basename(dir)}`);
  console.log(`🎬 ${reels.length} reels da @${onlyBrand}`);

  if (limit > 0) {
    reels = reels.slice(0, limit);
    console.log(`🎯 Limit aplicado: ${reels.length}`);
  }

  const tmpDir = path.join(ROOT, "output", "tmp-reel-videos");
  fs.mkdirSync(tmpDir, { recursive: true });

  const results: ReelDna[] = [];
  for (let i = 0; i < reels.length; i++) {
    const p = reels[i];
    const tag = `[${i + 1}/${reels.length}] ${p.shortCode} ${(p.vsMedian ?? 0).toFixed(2)}x`;
    process.stdout.write(`  ${tag} ... `);
    const dna = await analyzeReel(p, tmpDir);
    results.push(dna);
    if (dna.analysis) {
      const dur = (dna.analysis.duration as string | undefined) ?? "?";
      const scenes = Array.isArray(dna.analysis.scenes) ? dna.analysis.scenes.length : "?";
      process.stdout.write(`✅ ${dur}s, ${scenes} cenas (${(dna.videoBytes! / 1024 / 1024).toFixed(1)}MB)\n`);
    } else {
      process.stdout.write(`⚠️  ${dna.meta.error?.slice(0, 80) ?? "sem análise"}\n`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  const slug = onlyBrand.toLowerCase().replace(/\s+/g, "-");
  const outPath = path.join(dir, `reel-dna-${slug}.json`);
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));

  const ok = results.filter((r) => r.analysis).length;
  console.log(`\n✅ ${ok}/${results.length} analisados → ${path.basename(outPath)}`);
  console.log(`   ${(fs.statSync(outPath).size / 1024).toFixed(0)}KB`);
}

main().catch((err) => {
  console.error("\n❌", err.message);
  process.exit(1);
});
