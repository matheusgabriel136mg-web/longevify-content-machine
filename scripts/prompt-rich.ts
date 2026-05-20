/**
 * prompt-rich.ts — re-roda os top virais com GPT-5 Vision pra prompts ricos
 * (direção de arte, não só descrição). Sobrescreve `prompt` + `hookSignal`
 * no visual-dna-{brand}.json existente.
 *
 * Foco: só os top N virais por marca (default 10) — não desperdiça GPT no bulk.
 * Mantém o resto do output do Gemini Flash intacto.
 *
 * Custo: ~$1-2 (GPT-5 Vision em 30 imagens)
 * Tempo: ~3-5 min
 *
 * Uso:
 *   npm run -- prompt-rich                         # top 10 por marca
 *   npm run -- prompt-rich -- --top=15             # top 15
 *   npm run -- prompt-rich -- --brand=Superpower   # só uma marca
 */

import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);

const args = process.argv.slice(2);
const topN = Number(args.find((a) => a.startsWith("--top="))?.split("=")[1] ?? 10);
const onlyBrand = args.find((a) => a.startsWith("--brand="))?.split("=")[1];
const all = args.includes("--all");
const formatFilter = args.find((a) => a.startsWith("--format="))?.split("=")[1] as
  | "image" | "carousel" | "reel" | undefined;
const fromSelection = args.find((a) => a.startsWith("--from-selection="))?.split("=")[1];

interface SelectionFile {
  items: Array<{ url: string; brand: string; format: string }>;
}

function loadSelectionUrls(p: string): Set<string> | null {
  if (!fs.existsSync(p)) {
    console.error(`❌ Seleção não encontrada: ${p}`);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(p, "utf-8")) as SelectionFile;
  return new Set(data.items.map((i) => i.url));
}

const MODEL = "gpt-5"; // GPT-5 Vision

const BRAND_FILES: Record<string, string[]> = {
  "Superpower": [
    "visual-dna-superpower.json",
    "visual-dna-superpower-reel.json",
    "visual-dna-superpower-image.json",
  ],
  "Mito Health": [
    "visual-dna-mito-health.json",
    "visual-dna-mito-health-reel.json",
    "visual-dna-mito-health-image.json",
  ],
  "Function Health": [
    "visual-dna-function-health.json",
    "visual-dna-function-health-reel.json",
    "visual-dna-function-health-image.json",
  ],
};

const client = new OpenAI();

interface VisualDna {
  url: string;
  brand: string;
  format: "image" | "carousel" | "reel";
  vsMedian: number;
  caption: string;
  hookLine: string;
  primary: {
    composition: string;
    palette: string[];
    subject: string;
    textOverlay: string | null;
    mood: string;
    style: string;
    hookSignal: string;
    prompt: string;
  };
  slides?: Array<Record<string, unknown>>;
  meta: { isReelCover: boolean; analyzedAt: string; model: string };
}

interface RichOutput {
  prompt: string;       // PT, mega-detalhado (300-400 palavras), copiável pra GPT-Image-2
  promptEN: string;     // EN, versão concisa pra Midjourney/Flux (~120-180 palavras)
  hookSignal: string;   // PT, what stops the scroll
  artDirection: string; // PT, briefing pra designer humano (~150 palavras)
}

function findLatestAnalysisDir(): string {
  const dirs = fs
    .readdirSync(path.join(ROOT, "output"))
    .filter((n) => n.startsWith("analysis-"))
    .sort();
  if (!dirs.length) throw new Error("Nenhuma pasta analysis-*");
  return path.join(ROOT, "output", dirs[dirs.length - 1]);
}

const SYSTEM_PROMPT = `Você é diretor de arte sênior + copywriter sênior, especializado em conteúdo viral de health-tech premium e luxury wellness no Instagram. Sua única missão: descrever uma imagem com TANTO detalhe que outra pessoa consegue recriá-la 95% só lendo seu output em GPT-Image-2 / Midjourney / Flux.

Sua descrição precisa servir DIRETAMENTE como prompt copiável — não é "análise", é BRIEFING DE PRODUÇÃO.

Estrutura obrigatória em camadas (nunca pule camadas):

1. FORMATO + ESTILO + ÂNGULO DE CÂMERA (1ª frase): "Imagem vertical 4:5 para post de Instagram, fotografia editorial cinematográfica vista de cima, ângulo aéreo alto, mostrando..."
2. SUJEITO PRINCIPAL com contexto narrativo (não só "uma mulher" — diga "uma mulher de cabelos castanhos médios, ~35 anos, olhar baixo, em pose contemplativa")
3. ILUMINAÇÃO específica (golden hour? rim light? key light a 45°?) + temperatura K + intensidade + sombras
4. PALETA EXATA com hex codes (não "warm tones" — diga "pêssego #F5C99B → coral #E36A4F → terracotta #B74635") + grading do filme (subexposto? lifted blacks?)
5. TEXTURA / TRATAMENTO ("textura granulada, levemente subexposto", "grain de filme 35mm 5%", "blur cinematográfico orgânico")
6. COMPOSIÇÃO detalhada — onde cada elemento está no quadro (terço superior, centralizado, etc) + relação foreground/background
7. CAMERA POSITION CONTEXT ("como se capturada por drone", "85mm f/2.8 shallow DOF", "iPhone vertical handheld")
8. TEXTO/OVERLAY na imagem — EXHAUSTIVO. Pra cada texto visível dê:
   - conteúdo literal (OCR exato)
   - posição (top center | bottom-third left | mid-right)
   - fonte estimada (SF Pro Display | Inter Bold | Helvetica Neue Light | Times Italic)
   - peso (Light/Regular/Medium/Bold/Black)
   - cor exata (#hex) + tracking + line-height se relevante
   - tamanho relativo (xl/lg/md/sm) + animação de entrada se aplicável
   - destaques: palavras em cor diferente ou maior
9. ELEMENTOS GRÁFICOS — pills, labels, callouts, tracking boxes, ícones — descreva CADA UM com forma, cor, borda, posição, função
10. MOOD ADJETIVOS empilhados ("clean, premium, editorial, científico, contemplativo, sofisticado")
11. REFERÊNCIAS DE MARCA explícitas (Apple keynote slide / Aesop minimal product / Calvin Klein editorial / Equinox campaign)
12. ANTI-PADRÕES (3-5 "Não X"): "Não adicionar logo. Não usar cores vibrantes saturadas. Não adicionar ícones médicos genéricos. Não criar aparência de IA. Não usar fontes display ornamentadas."
13. STYLE SUMMARY FINAL: "Manter realismo fotográfico, sombras naturais, grão sutil de filme, alta resolução, sharp, composição minimalista e sofisticada."

LINGUAGEM: Português com termos técnicos em inglês quando padrão (golden hour, shallow DOF, rule-of-thirds, rim light). NÃO traduza esses. ~300-400 palavras totais.`;

function buildUserMessage(d: VisualDna): { type: "text" | "image_url"; [k: string]: unknown }[] {
  const ctx = `Post viral do Instagram da @${d.brand} (formato: ${d.format}, viralizou ${d.vsMedian.toFixed(2)}x a mediana). Hook: "${d.hookLine.slice(0, 200)}"`;

  return [
    {
      type: "text",
      text: `${ctx}

Analisa essa imagem e devolve APENAS um JSON (sem markdown, sem texto antes/depois) com esta estrutura:

{
  "prompt": "EM INGLÊS — prompt completo de direção de arte pra alimentar Midjourney/Flux/GPT-Image-2. Capture composição, paleta exata (com hex se possível), tipografia (peso/família), tratamento (blur/grain/glow), iluminação, sujeito, mood, referências de marca/estética. ~80-150 palavras. Específico, não genérico.",
  "hookSignal": "EM PORTUGUÊS — 1-2 frases sobre o que prende o olho primeiro nessa imagem. O elemento exato que disparou o stop-scroll.",
  "artDirection": "EM PORTUGUÊS — descrição rica de direção de arte (estilo briefing pra designer humano). Inclui: estética geral, paleta, tipografia, elementos visuais importantes, anti-padrões evitados, referências. ~150-250 palavras. Use bullets se ajudar."
}`,
    },
    {
      type: "image_url",
      image_url: { url: ""}, // preenchido depois
    },
  ];
}

function parseJson(text: string): RichOutput | null {
  const cleaned = text.replace(/```(?:json)?\s*/g, "").replace(/```\s*$/g, "").trim();
  try {
    return JSON.parse(cleaned) as RichOutput;
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as RichOutput;
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function analyzeWithGpt(d: VisualDna): Promise<RichOutput | null> {
  const imageUrl = d.url ? null : null; // We need displayUrl which is in raw-posts, not visual-dna
  // visual-dna doesn't store displayUrl — só url do post. Precisamos reconstruir.
  // displayUrl está no raw-posts.json, indexado por shortCode/url.

  // Por simplicidade: pega imagem da URL do post via IG embed... não, vamos passar displayUrl como arg.
  return null;
}

interface RawPost {
  url?: string;
  shortCode?: string;
  displayUrl?: string;
  brand: string;
}

function buildDisplayUrlMap(rawPosts: RawPost[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of rawPosts) {
    if (!p.displayUrl) continue;
    if (p.url) m.set(p.url, p.displayUrl);
    if (p.shortCode) m.set(`https://instagram.com/p/${p.shortCode}`, p.displayUrl);
    if (p.shortCode) m.set(p.shortCode, p.displayUrl);
  }
  return m;
}

async function downloadAsBase64(url: string): Promise<{ dataUri: string; mime: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
    const dataUri = `data:${mime};base64,${buf.toString("base64")}`;
    return { dataUri, mime };
  } catch {
    return null;
  }
}

async function callGpt(d: VisualDna, displayUrl: string): Promise<RichOutput | null> {
  const ctx = `Post viral do Instagram da @${d.brand} (formato: ${d.format}, viralizou ${d.vsMedian.toFixed(2)}x a mediana). Hook: "${d.hookLine.slice(0, 200)}"`;
  const userText = `${ctx}

Analisa essa imagem e devolve APENAS um JSON (sem markdown, sem texto antes/depois):

{
  "prompt": "EM PORTUGUÊS (com termos técnicos em inglês onde padrão) — PROMPT COPIÁVEL pronto pra GPT-Image-2 / Midjourney / Flux. Segue a estrutura de 13 camadas do system prompt (formato → estilo → ângulo → sujeito → iluminação → paleta → textura → composição → camera context → TEXTO/OVERLAYS exhaustive → elementos gráficos → mood adjetivos → referências → anti-padrões → style summary). 300-400 palavras. Específico ao MÁXIMO. Quem ler deve recriar 95% da imagem.",
  "promptEN": "EM INGLÊS — versão concisa do prompt acima (~120-180 palavras), pra ferramentas que respondem melhor a EN (Midjourney v6, Flux Pro). Mantém hex codes, lens specs, lighting setup; pode reduzir o detalhe de overlays.",
  "hookSignal": "EM PORTUGUÊS — 1-2 frases sobre o que prende o olho primeiro nessa imagem. O elemento exato que disparou o stop-scroll. Específico (não 'tipografia grande' — diga 'o número 60% em verde-sage no centro contra o asfalto escuro').",
  "artDirection": "EM PORTUGUÊS — briefing humano (~150 palavras) pra designer recriar. Foca em: paleta com hex · tipografia (família+peso+cor) · 3 anti-padrões críticos · 2 referências de marca · vibe geral em 1 frase."
}`;

  // IG CDN bloqueia OpenAI direto — precisa baixar local e mandar base64
  const img = await downloadAsBase64(displayUrl);
  if (!img) {
    console.error(`  ❌ download falhou: ${displayUrl.slice(0, 80)}`);
    return null;
  }

  try {
    const res = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: userText },
            { type: "image_url", image_url: { url: img.dataUri, detail: "high" } as { url: string; detail: "high" | "low" | "auto" } },
          ] as Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "high" | "low" | "auto" } }>,
        },
      ],
    });
    const text = res.choices[0]?.message?.content ?? "";
    return parseJson(text);
  } catch (err) {
    console.error(`  ❌ GPT err: ${(err as Error).message.slice(0, 120)}`);
    return null;
  }
}

let selectionUrls: Set<string> | null = null;

async function processFile(analysisDir: string, fileName: string, displayUrlMap: Map<string, string>) {
  const inputPath = path.join(analysisDir, fileName);
  if (!fs.existsSync(inputPath)) {
    console.log(`⚠️  ${fileName} não existe — pula`);
    return;
  }

  const dnas = JSON.parse(fs.readFileSync(inputPath, "utf-8")) as VisualDna[];

  // Aplica filtros: selection > format > top-N
  let pool = dnas;
  if (selectionUrls) {
    pool = pool.filter((d) => selectionUrls.has(d.url));
  }
  if (formatFilter) pool = pool.filter((d) => d.format === formatFilter);

  // Skip já-rich quando em modo --from-selection (não re-processa o que já tem GPT-5 v2)
  const beforeSkip = pool.length;
  if (selectionUrls) {
    pool = pool.filter((d) => !d.meta?.richModel);
  }
  const skipped = beforeSkip - pool.length;

  pool = [...pool].sort((a, b) => b.vsMedian - a.vsMedian);
  const top = (all || selectionUrls) ? pool : pool.slice(0, topN);
  const labels: string[] = [];
  if (selectionUrls) labels.push("from-selection");
  if (formatFilter) labels.push(`formato=${formatFilter}`);
  if (!labels.length) labels.push("todos");
  console.log(`\n🎨 ${fileName} — ${top.length} posts (${labels.join(", ")}${all ? ", all" : selectionUrls ? "" : `, top ${topN}`})${skipped > 0 ? ` · ${skipped} já rich, skipados` : ""}`);

  let upgraded = 0;
  for (let i = 0; i < top.length; i++) {
    const d = top[i];
    process.stdout.write(`  [${i + 1}/${top.length}] ${d.format} ${d.vsMedian.toFixed(1)}x ... `);

    const displayUrl = displayUrlMap.get(d.url);
    if (!displayUrl) {
      process.stdout.write(`⚠️  sem displayUrl no raw-posts\n`);
      continue;
    }

    const rich = await callGpt(d, displayUrl);
    if (!rich) {
      process.stdout.write(`⚠️  GPT sem retorno\n`);
      continue;
    }

    // Sobrescreve no objeto original
    const original = dnas.find((x) => x.url === d.url);
    if (original) {
      original.primary.prompt = rich.prompt; // agora PT mega-detalhado
      original.primary.hookSignal = rich.hookSignal;
      (original.primary as Record<string, unknown>).promptEN = rich.promptEN;
      (original.primary as Record<string, unknown>).artDirection = rich.artDirection;
      (original.meta as Record<string, unknown>).richModel = MODEL;
      (original.meta as Record<string, unknown>).richAt = new Date().toISOString();
      upgraded++;
    }

    process.stdout.write(`✅ ${rich.prompt.slice(0, 50)}…\n`);
  }

  // Salva: sobrescreve o arquivo original (mantém schema, só upgrade nos top N)
  fs.writeFileSync(inputPath, JSON.stringify(dnas, null, 2));
  console.log(`  💾 ${upgraded}/${top.length} upgradeados em ${path.basename(inputPath)}`);
}

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY não setada");

  if (fromSelection) {
    selectionUrls = loadSelectionUrls(fromSelection);
    console.log(`📋 Selection mode: ${selectionUrls?.size} URLs from ${fromSelection}`);
  }

  const dir = findLatestAnalysisDir();
  console.log(`📁 ${path.basename(dir)} — modelo ${MODEL}`);

  // Carrega raw-posts.json pra resolver displayUrl
  const raw = JSON.parse(fs.readFileSync(path.join(dir, "raw-posts.json"), "utf-8")) as RawPost[];
  const displayUrlMap = buildDisplayUrlMap(raw);
  console.log(`🔗 ${displayUrlMap.size} displayUrls indexados em raw-posts.json`);

  const targets = onlyBrand
    ? Object.entries(BRAND_FILES).filter(([k]) => k === onlyBrand)
    : Object.entries(BRAND_FILES);

  for (const [_brand, files] of targets) {
    for (const file of files) {
      const filePath = path.join(dir, file);
      if (!fs.existsSync(filePath)) continue;
      await processFile(dir, file, displayUrlMap);
    }
  }

  console.log("\n✅ Completo");
}

main().catch((err) => {
  console.error("\n❌", err.message);
  process.exit(1);
});
