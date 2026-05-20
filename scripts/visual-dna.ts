/**
 * visual-dna.ts — Layer 2: análise visual dos virais
 *
 * O que faz:
 *   1. Carrega top-virals.json da última (ou fornecida) análise
 *   2. Pra cada viral roda visão do Gemini:
 *      - Foto: 1 análise da displayUrl
 *      - Carrossel: 1 análise por slide (com inferência de role: hook/body/data/cta)
 *      - Reel: 1 análise da capa (displayUrl) — ainda não analisa frames internos do vídeo
 *   3. Salva:
 *      - visual-dna.json — DNA estruturado por post
 *      - visual-dna.md — sumário legível agrupado por marca/formato
 *
 * Custo: ~zero (Gemini Flash, free tier aguenta os ~200-250 calls)
 * Tempo: ~10-15 min (sequencial com throttle leve pra não bater rate limit)
 *
 * Uso:
 *   npm run visual-dna                       # usa última pasta analysis-*
 *   npm run visual-dna -- output/analysis-2026-05-08T13-19  # pasta específica
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// ─── Config ───────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PARENT = path.dirname(__dirname);

const MODEL = "gemini-2.5-flash";
const REQUEST_DELAY_MS = 800; // ~75 req/min — abaixo de qualquer free tier limit
const MAX_CAROUSEL_SLIDES = 10; // proteção contra carrossel gigante

// ─── Localiza pasta de análise ───────────────────────────────────────────────

function findLatestAnalysisDir(): string {
  const outputDir = path.join(PARENT, "output");
  const dirs = fs
    .readdirSync(outputDir)
    .filter((n) => n.startsWith("analysis-"))
    .sort();
  if (!dirs.length) throw new Error("Nenhuma pasta analysis-* encontrada em output/");
  return path.join(outputDir, dirs[dirs.length - 1]);
}

// Args: [analysis-dir?] [--brand=NomeDaMarca] [--format=carousel|reel|image] [--limit=N]
const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
const brandFlag = flags.find((f) => f.startsWith("--brand="))?.split("=")[1];
const formatFlag = flags.find((f) => f.startsWith("--format="))?.split("=")[1] as
  | "carousel" | "reel" | "image" | undefined;
const limitFlag = Number(flags.find((f) => f.startsWith("--limit="))?.split("=")[1] ?? 0);

const argDir = positional[0];
const ANALYSIS_DIR = argDir ? path.resolve(argDir) : findLatestAnalysisDir();
const RAW_PATH = path.join(ANALYSIS_DIR, "raw-posts.json");
const BRAND_FILTER = brandFlag; // ex: "Superpower" — se setado, pega TODOS os posts da marca
const FORMAT_FILTER = formatFlag; // ex: "carousel" — filtra format depois do brand filter
const LIMIT = limitFlag > 0 ? limitFlag : 0; // 0 = sem limite

if (!fs.existsSync(RAW_PATH)) {
  throw new Error(`Não achei raw-posts.json em ${ANALYSIS_DIR}`);
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Viral {
  url?: string;
  shortCode?: string;
  brand: string;
  format: "image" | "carousel" | "reel";
  vsMedian: number;
  isViral?: boolean;
  caption?: string;
  displayUrl?: string;
  images?: string[];
  childPosts?: Array<{ displayUrl?: string }>;
  videoUrl?: string;
  likesCount?: number;
  commentsCount?: number;
  videoViewCount?: number;
}

interface ImageDna {
  composition: string;
  palette: string[];
  subject: string;
  textOverlay: string | null;
  mood: string;
  style: string;
  hookSignal: string;
  prompt: string; // reverse-engineered prompt em inglês (Midjourney/Flux/Nano Banana ready)
}

interface SlideDna extends ImageDna {
  slideNum: number;
  role: "hook" | "body" | "data" | "cta" | "outro";
}

interface VisualDna {
  url: string;
  brand: string;
  format: "image" | "carousel" | "reel";
  vsMedian: number;
  caption: string;
  hookLine: string;
  primary: ImageDna; // pra reel = cover frame; pra image = a foto; pra carrossel = slide 1
  slides?: SlideDna[]; // só pra carrossel
  meta: {
    isReelCover: boolean; // true quando primary é capa de reel (não conteúdo da imagem)
    analyzedAt: string;
    model: string;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(icon: string, msg: string): void {
  console.log(`${icon} ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function downloadImage(url: string): Promise<{ buf: Buffer; mime: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao baixar imagem: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type") ?? "image/jpeg";
  return { buf, mime: ct.split(";")[0].trim() };
}

function safeParseJson<T>(text: string): T | null {
  // remove fences markdown se houver
  const cleaned = text.replace(/```(?:json)?\s*/g, "").replace(/```\s*$/g, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // tenta extrair primeiro objeto JSON
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function getImages(p: Viral): string[] {
  if (Array.isArray(p.images) && p.images.length > 0) return p.images;
  if (Array.isArray(p.childPosts)) {
    return p.childPosts.map((c) => c.displayUrl).filter((u): u is string => !!u);
  }
  return p.displayUrl ? [p.displayUrl] : [];
}

function postUrl(p: Viral): string {
  return p.url ?? `https://instagram.com/p/${p.shortCode ?? ""}`;
}

function hookLine(caption: string | undefined): string {
  return (caption ?? "").split("\n")[0].slice(0, 200);
}

// ─── Gemini ───────────────────────────────────────────────────────────────────

const genai = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
const model = genai.getGenerativeModel({ model: MODEL });

async function analyzeImageBuffer(
  buf: Buffer,
  mime: string,
  promptContext: string
): Promise<ImageDna | null> {
  const promptStructure = `${promptContext}

Analise esta imagem e responda APENAS um objeto JSON (sem markdown, sem comentário antes ou depois) com esta estrutura exata:

{
  "composition": "1 frase curta descrevendo a composição visual (ex: 'tipografia minimalista sobre fundo verde-escuro', 'retrato em close, luz lateral quente')",
  "palette": ["#hex1", "#hex2", "#hex3"],
  "subject": "elemento visual principal (ex: 'rosto humano', 'gráfico de dados', 'mockup de produto', 'cena de natureza', 'tipografia pura')",
  "textOverlay": "texto LITERAL visível sobre a imagem (faça OCR), ou null se não tem",
  "mood": "1 palavra: 'clínico'|'caloroso'|'energético'|'contemplativo'|'urgente'|'editorial'|'casual'",
  "style": "estilo visual: 'fotografia editorial'|'infográfico'|'meme'|'tipografia minimalista'|'foto candid'|'ilustração'|'gráfico de dados'",
  "hookSignal": "1 frase: o que nessa imagem para o scroll (qual elemento prende o olho primeiro)",
  "prompt": "EM INGLÊS — prompt detalhado de reverse engineering pronto pra alimentar Midjourney/Flux/Nano Banana, capturando composição, sujeito, iluminação, paleta, estilo, lente/câmera quando aplicável, mood. ~40-80 palavras, descritivo e específico, sem usar a marca original — descreve só o estilo visual."
}`;

  const result = await model.generateContent([
    { inlineData: { mimeType: mime, data: buf.toString("base64") } },
    promptStructure,
  ]);

  const text = result.response.text();
  return safeParseJson<ImageDna>(text);
}

async function analyzeSlideBuffer(
  buf: Buffer,
  mime: string,
  slideNum: number,
  totalSlides: number,
  caption: string
): Promise<SlideDna | null> {
  const ctx = `Você está analisando o slide ${slideNum} de ${totalSlides} de um carrossel do Instagram. Caption do post: "${hookLine(caption)}"`;
  const promptStructure = `${ctx}

Analise este slide e responda APENAS um objeto JSON (sem markdown):

{
  "slideNum": ${slideNum},
  "role": "hook|body|data|cta|outro",
  "composition": "...",
  "palette": ["#hex1","#hex2","#hex3"],
  "subject": "...",
  "textOverlay": "texto literal sobre a imagem, ou null",
  "mood": "...",
  "style": "...",
  "hookSignal": "...",
  "prompt": "EM INGLÊS — prompt de reverse engineering pra recriar este slide em Midjourney/Flux/Nano Banana, ~30-60 palavras"
}

Sobre "role":
- "hook": slide 1 ou que serve de capa/gancho (geralmente título grande)
- "body": slides intermediários explicativos
- "data": slide com gráfico, número grande, estatística
- "cta": último slide com chamada à ação ou pergunta
- "outro": qualquer outra função`;

  const result = await model.generateContent([
    { inlineData: { mimeType: mime, data: buf.toString("base64") } },
    promptStructure,
  ]);
  const text = result.response.text();
  return safeParseJson<SlideDna>(text);
}

// ─── Análise por post ─────────────────────────────────────────────────────────

async function analyzePost(p: Viral): Promise<VisualDna | null> {
  const url = postUrl(p);
  const caption = p.caption ?? "";
  const ctxBase = `Post do Instagram da marca ${p.brand} (formato: ${p.format}, viralizou ${p.vsMedian.toFixed(2)}x a mediana da própria conta). Caption começa com: "${hookLine(caption)}"`;

  if (p.format === "image") {
    const imgUrl = p.displayUrl;
    if (!imgUrl) return null;
    const { buf, mime } = await downloadImage(imgUrl);
    const primary = await analyzeImageBuffer(buf, mime, ctxBase);
    if (!primary) return null;
    return {
      url, brand: p.brand, format: "image", vsMedian: p.vsMedian,
      caption, hookLine: hookLine(caption),
      primary,
      meta: { isReelCover: false, analyzedAt: new Date().toISOString(), model: MODEL },
    };
  }

  if (p.format === "reel") {
    // Por enquanto: só capa (displayUrl). Frame interno fica pra Layer 2.5.
    const coverUrl = p.displayUrl;
    if (!coverUrl) return null;
    const { buf, mime } = await downloadImage(coverUrl);
    const ctxReel = `${ctxBase}\n\nVocê está vendo a CAPA (thumbnail) deste reel — o que aparece no feed antes do clique. Análise foca em: o que faz parar o scroll.`;
    const primary = await analyzeImageBuffer(buf, mime, ctxReel);
    if (!primary) return null;
    return {
      url, brand: p.brand, format: "reel", vsMedian: p.vsMedian,
      caption, hookLine: hookLine(caption),
      primary,
      meta: { isReelCover: true, analyzedAt: new Date().toISOString(), model: MODEL },
    };
  }

  // Carrossel — analisa cada slide
  const allSlides = getImages(p).slice(0, MAX_CAROUSEL_SLIDES);
  if (!allSlides.length) return null;

  const slides: SlideDna[] = [];
  for (let i = 0; i < allSlides.length; i++) {
    try {
      const { buf, mime } = await downloadImage(allSlides[i]);
      const slide = await analyzeSlideBuffer(buf, mime, i + 1, allSlides.length, caption);
      if (slide) slides.push(slide);
      await sleep(REQUEST_DELAY_MS);
    } catch (err) {
      log("    ⚠️", `slide ${i + 1} falhou: ${(err as Error).message}`);
    }
  }
  if (!slides.length) return null;

  // primary = slide hook (ou slide 1)
  const hookSlide = slides.find((s) => s.role === "hook") ?? slides[0];
  const { slideNum, role, ...primary } = hookSlide;

  return {
    url, brand: p.brand, format: "carousel", vsMedian: p.vsMedian,
    caption, hookLine: hookLine(caption),
    primary,
    slides,
    meta: { isReelCover: false, analyzedAt: new Date().toISOString(), model: MODEL },
  };
}

// ─── Markdown summary ─────────────────────────────────────────────────────────

function buildMarkdown(dnas: VisualDna[]): string {
  const lines: string[] = [];
  lines.push(`# Visual DNA — ${dnas.length} virais analisados`);
  lines.push("");
  lines.push(`> Gerado em ${new Date().toLocaleString("pt-BR")} · modelo ${MODEL}`);
  lines.push("");

  // Por marca, ordenado por vsMedian
  const brands = [...new Set(dnas.map((d) => d.brand))];
  for (const brand of brands) {
    const items = dnas.filter((d) => d.brand === brand).sort((a, b) => b.vsMedian - a.vsMedian);
    lines.push(`## ${brand} — ${items.length} posts`);
    lines.push("");
    for (const d of items) {
      lines.push(`### [${d.format}] ${d.vsMedian.toFixed(2)}x — ${d.hookLine.slice(0, 90) || "(sem hook)"}`);
      lines.push(`**Link:** ${d.url}`);
      lines.push("");
      lines.push("**Visual DNA (primary):**");
      lines.push(`- Composição: ${d.primary.composition}`);
      lines.push(`- Sujeito: ${d.primary.subject}`);
      lines.push(`- Mood: ${d.primary.mood} · Estilo: ${d.primary.style}`);
      lines.push(`- Paleta: ${d.primary.palette.join(" · ")}`);
      if (d.primary.textOverlay) lines.push(`- Texto na imagem: "${d.primary.textOverlay}"`);
      lines.push(`- O que prende: ${d.primary.hookSignal}`);
      if (d.meta.isReelCover) lines.push(`- *(análise é da capa do reel, não do vídeo interno)*`);
      lines.push("");
      lines.push("**Prompt (reverse-engineered, EN):**");
      lines.push("```");
      lines.push(d.primary.prompt);
      lines.push("```");
      lines.push("");

      if (d.slides && d.slides.length > 1) {
        lines.push(`**Slides do carrossel (${d.slides.length}):**`);
        for (const s of d.slides) {
          lines.push("");
          lines.push(`#### Slide ${s.slideNum}/${d.slides.length} — [${s.role}]`);
          lines.push(`- Composição: ${s.composition}`);
          lines.push(`- Sujeito: ${s.subject} · Mood: ${s.mood} · Estilo: ${s.style}`);
          if (s.textOverlay) lines.push(`- Texto: "${s.textOverlay}"`);
          lines.push(`- Paleta: ${s.palette.join(" · ")}`);
          lines.push(`- Prompt:`);
          lines.push("  ```");
          lines.push(`  ${s.prompt}`);
          lines.push("  ```");
        }
        lines.push("");
      }
      lines.push("---");
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n🎨 Visual DNA — Layer 2");
  console.log(`📁 Lendo: ${ANALYSIS_DIR}`);
  console.log(`🤖 Modelo: ${MODEL}`);
  console.log("─".repeat(60));

  if (!process.env.GOOGLE_API_KEY) throw new Error("GOOGLE_API_KEY não setada no .env");

  // Sempre carregamos raw-posts.json (todos os posts).
  // Se --brand=Nome foi passado: pega TODOS os posts daquela marca, sem filtro de viral.
  // Caso contrário: pega virais das 3 marcas-alvo (comportamento original).
  const allPosts = JSON.parse(fs.readFileSync(RAW_PATH, "utf-8")) as Viral[];

  let filtered: Viral[];
  if (BRAND_FILTER) {
    filtered = allPosts.filter((p) => p.brand === BRAND_FILTER);
    log("🎯", `Modo BRAND: pegando TODOS os posts de "${BRAND_FILTER}" (sem filtro de viral)`);
  } else {
    const targetBrands = new Set(["Superpower", "Mito Health", "Function Health"]);
    filtered = allPosts.filter((v) => targetBrands.has(v.brand) && v.isViral);
    log("🚀", `Modo VIRAL: pegando virais das 3 marcas-alvo`);
  }

  if (FORMAT_FILTER) {
    const before = filtered.length;
    filtered = filtered.filter((p) => p.format === FORMAT_FILTER);
    log("🎬", `Modo FORMAT: filtrado pra "${FORMAT_FILTER}" (${filtered.length}/${before} posts)`);
  }

  if (LIMIT > 0 && filtered.length > LIMIT) {
    // Se vsMedian é confiável (>0 pra alguns), ordena por viralização desc.
    // Senão (likes ocultos = vsMedian sempre 0), pega os primeiros N (mais recentes do scrape).
    const hasVirality = filtered.some((p) => p.vsMedian > 0);
    if (hasVirality) {
      filtered = [...filtered].sort((a, b) => b.vsMedian - a.vsMedian).slice(0, LIMIT);
      log("🎯", `Modo LIMIT: top ${LIMIT} por vsMedian`);
    } else {
      filtered = filtered.slice(0, LIMIT);
      log("🎯", `Modo LIMIT: ${LIMIT} mais recentes (vsMedian indisponível, likes ocultos)`);
    }
  }

  log("📊", `${filtered.length} posts alvo (de ${allPosts.length} no arquivo)`);
  const byFormat = filtered.reduce<Record<string, number>>((acc, v) => {
    acc[v.format] = (acc[v.format] ?? 0) + 1;
    return acc;
  }, {});
  log("  ", `Formatos: ${Object.entries(byFormat).map(([k, v]) => `${k}=${v}`).join(", ")}`);

  // Estima total de calls
  const estCalls = filtered.reduce((sum, v) => {
    if (v.format === "carousel") {
      const n = Math.min(getImages(v).length, MAX_CAROUSEL_SLIDES);
      return sum + n;
    }
    return sum + 1;
  }, 0);
  log("  ", `Estimativa: ${estCalls} chamadas Gemini, ~${Math.ceil((estCalls * REQUEST_DELAY_MS) / 60_000)} min`);
  console.log();

  const dnas: VisualDna[] = [];
  for (let i = 0; i < filtered.length; i++) {
    const v = filtered[i];
    const tag = `[${i + 1}/${filtered.length}] ${v.brand} · ${v.format} · ${v.vsMedian.toFixed(2)}x`;
    process.stdout.write(`  → ${tag} ... `);
    try {
      const dna = await analyzePost(v);
      if (dna) {
        dnas.push(dna);
        process.stdout.write(`✅${dna.slides ? ` (${dna.slides.length} slides)` : ""}\n`);
      } else {
        process.stdout.write(`⚠️ sem resultado\n`);
      }
    } catch (err) {
      process.stdout.write(`❌ ${(err as Error).message.slice(0, 80)}\n`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  // Nome de saída inclui marca + formato se filtrados (evita sobrescrever)
  const brandSlug = BRAND_FILTER ? `-${BRAND_FILTER.toLowerCase().replace(/\s+/g, "-")}` : "";
  const formatSlug = FORMAT_FILTER ? `-${FORMAT_FILTER}` : "";
  const jsonPath = path.join(ANALYSIS_DIR, `visual-dna${brandSlug}${formatSlug}.json`);
  const mdPath = path.join(ANALYSIS_DIR, `visual-dna${brandSlug}${formatSlug}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(dnas, null, 2), "utf-8");
  fs.writeFileSync(mdPath, buildMarkdown(dnas), "utf-8");

  console.log("\n" + "─".repeat(60));
  console.log("✅ Visual DNA completo!");
  console.log(`\n📁 ${ANALYSIS_DIR}/`);
  console.log(`   ${path.basename(jsonPath)}  ← DNA + prompt estruturado por post`);
  console.log(`   ${path.basename(mdPath)}    ← sumário legível agrupado por marca`);
  console.log();
  console.log(`📈 Resumo: ${dnas.length}/${filtered.length} posts analisados com sucesso`);
}

main().catch((err) => {
  console.error("\n❌ Falhou:", err.message);
  process.exit(1);
});
