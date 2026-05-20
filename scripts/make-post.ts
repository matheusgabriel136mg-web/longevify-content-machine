/**
 * make-post.ts — gera UM post Longevify end-to-end com TODO contexto coletado.
 *
 * Combina:
 *   - LONGEVIFY_BRAND.md (paleta, tom, público)
 *   - LONGEVIFY_PILLARS.md (4 pilares + ICP + anti-themes)
 *   - PubMed papers do biomarcador-alvo (autoridade científica real)
 *   - Mito blog longform sobre o tópico (estrutura de conteúdo)
 *   - Visual DNA dos top virais do tópico (formato e visual replicável)
 *   - Análise competitiva (5 hooks que viralizam)
 *
 * Manda tudo pro Claude Opus 4.7 e pede:
 *   - Hook (4 variações pra A/B)
 *   - Carrossel pt-BR (5 slides) com copy + visual prompt por slide
 *   - Caption final + 1 paper citado escondido
 *
 * Output:
 *   output/longevify-posts/{date}-pillar{N}-{topic}/
 *     post.md             — readable
 *     post.json           — estruturado
 *     context-used.md     — auditoria de TUDO que entrou no prompt (transparência)
 *
 * Uso:
 *   npm run make-post -- --pillar=2 --topic=ferritina
 *   npm run make-post -- --pillar=2 --topic=apob
 */

import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);

const args = process.argv.slice(2);
const pillar = Number(args.find((a) => a.startsWith("--pillar="))?.split("=")[1] ?? 2);
const topic = args.find((a) => a.startsWith("--topic="))?.split("=")[1] ?? "ferritina";

// Topic → biomarker mapping (slug PubMed)
const TOPIC_TO_BIOMARKER: Record<string, string> = {
  ferritina: "ferritin",
  ferritin: "ferritin",
  apob: "apob",
  "lp-a": "lpa",
  "hs-crp": "hs-crp",
  homocisteina: "homocysteine",
  "t3-reverso": "reverse-t3",
  "vitamina-d": "vitamin-d-brazil",
  magnesio: "magnesium",
  cortisol: "cortisol",
  homair: "homa-ir",
  hba1c: "hba1c",
};

// Keywords bilíngues pra buscar no Mito blog + visual DNA + captions IG.
// Cada tópico expande pra múltiplas palavras-chave (PT, EN, sinônimos clínicos).
const TOPIC_KEYWORDS: Record<string, string[]> = {
  ferritina: ["ferritin", "ferritina", "iron deficien", "deficiência de ferro"],
  ferritin: ["ferritin", "ferritina", "iron deficien", "deficiência de ferro"],
  apob: ["apob", "apolipoprotein b", "apolipoproteína b"],
  "lp-a": ["lipoprotein(a)", "lipoproteína(a)", "lp(a)", "lpa"],
  "hs-crp": ["hs-crp", "hscrp", "c-reactive protein", "pcr ultrassensível", "pcr us"],
  homocisteina: ["homocysteine", "homocisteína"],
  "t3-reverso": ["reverse t3", "t3 reverso", "rt3", "free t3"],
  "vitamina-d": ["vitamin d", "vitamina d", "25-oh"],
  magnesio: ["magnesium", "magnésio"],
  cortisol: ["cortisol", "diurnal cortisol"],
  homair: ["homa-ir", "insulin resistance", "resistência insulínica"],
  hba1c: ["hba1c", "hemoglobina glicada", "a1c"],
};

const BIOMARKER_SLUG = TOPIC_TO_BIOMARKER[topic.toLowerCase()] ?? topic.toLowerCase();
const SEARCH_KEYWORDS = TOPIC_KEYWORDS[topic.toLowerCase()] ?? [topic.toLowerCase()];

const client = new OpenAI();
const MODEL = "gpt-5";

function findLatestAnalysisDir(): string {
  const dirs = fs.readdirSync(path.join(ROOT, "output")).filter((n) => n.startsWith("analysis-")).sort();
  return path.join(ROOT, "output", dirs[dirs.length - 1]);
}

function pick<T>(arr: T[], n: number): T[] {
  return arr.slice(0, n);
}

interface PubMedPaper {
  pmid: string;
  title: string;
  authors: string[];
  journal: string;
  year: number | null;
  doi: string | null;
  abstract?: string;
}

interface PubMedResult {
  biomarker: string;
  slug: string;
  pillar: number;
  context: string;
  papers: PubMedPaper[];
}

interface MitoArticle {
  url: string;
  slug: string;
  title: string;
  bodyText: string;
  wordCount: number;
}

interface VisualDnaPrimary {
  composition: string;
  palette: string[];
  subject: string;
  style: string;
  mood: string;
  hookSignal: string;
  prompt: string;
  artDirection?: string;
  promptEN?: string;
}

interface VisualDna {
  url: string;
  brand: string;
  format: "image" | "carousel" | "reel";
  vsMedian: number;
  caption: string;
  hookLine: string;
  primary: VisualDnaPrimary;
  meta: { richModel?: string };
}

// ─── Build context pack ──────────────────────────────────────────────────────

function loadBrand(): string {
  return fs.readFileSync(path.join(ROOT, "LONGEVIFY_BRAND.md"), "utf-8");
}

function loadPillars(): string {
  return fs.readFileSync(path.join(ROOT, "LONGEVIFY_PILLARS.md"), "utf-8");
}

function loadPubmedForBiomarker(slug: string): PubMedPaper[] {
  const p = path.join(ROOT, "output", "pubmed", "papers.json");
  if (!fs.existsSync(p)) return [];
  const data = JSON.parse(fs.readFileSync(p, "utf-8")) as { results: PubMedResult[] };
  const match = data.results.find((r) => r.slug === slug);
  if (!match) return [];
  return pick(match.papers, 5); // top 5 papers
}

function matchesAnyKeyword(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

function loadBlogsForTopic(keywords: string[]): Array<MitoArticle & { brand: string }> {
  const sources: Array<{ brand: string; file: string; legacyPath?: string }> = [
    { brand: "Mito Health", file: "mito-articles.json", legacyPath: path.join(ROOT, "output", "mito-blog", "articles.json") },
    { brand: "Superpower", file: "superpower-articles.json" },
    { brand: "Function Health", file: "function-articles.json" },
  ];

  const all: Array<MitoArticle & { brand: string }> = [];
  for (const src of sources) {
    let p = path.join(ROOT, "output", "blogs", src.file);
    if (!fs.existsSync(p) && src.legacyPath && fs.existsSync(src.legacyPath)) p = src.legacyPath;
    if (!fs.existsSync(p)) continue;
    const data = JSON.parse(fs.readFileSync(p, "utf-8")) as { articles: MitoArticle[] };
    const matches = data.articles.filter((a) =>
      matchesAnyKeyword(a.slug, keywords) ||
      matchesAnyKeyword(a.title, keywords) ||
      matchesAnyKeyword(a.bodyText, keywords)
    );
    for (const m of matches) all.push({ ...m, brand: src.brand });
  }
  // Ordena por wordCount desc
  return all.sort((a, b) => b.wordCount - a.wordCount);
}

function loadVisualDnaSamples(keywords: string[]): VisualDna[] {
  const dir = findLatestAnalysisDir();
  const out: VisualDna[] = [];
  for (const f of ["visual-dna-superpower.json", "visual-dna-mito-health.json"]) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) continue;
    const arr = JSON.parse(fs.readFileSync(p, "utf-8")) as VisualDna[];
    const matches = arr.filter((d) =>
      matchesAnyKeyword((d.hookLine || "") + " " + (d.caption || ""), keywords)
    );
    // Prioriza: carousel + rich GPT-5, depois carousel sem rich, depois reel
    const ranked = [...matches].sort((a, b) => {
      const score = (d: VisualDna) => {
        const richBonus = d.meta.richModel ? 100 : 0;
        const formatBonus = d.format === "carousel" ? 10 : d.format === "reel" ? 5 : 0;
        return richBonus + formatBonus + d.vsMedian;
      };
      return score(b) - score(a);
    });
    out.push(...pick(ranked, 3));
  }
  return out;
}

function loadAnalysisMd(): string {
  const dir = findLatestAnalysisDir();
  const p = path.join(dir, "analysis.md");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : "(análise competitiva não encontrada)";
}

// ─── Build the mega-prompt ───────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `Você é Diretor de Conteúdo Sênior da Longevify, brand de medicina de precisão premium para o público brasileiro de alta renda. Seu trabalho: produzir UM carrossel viral pt-BR que combina:

1. AUTORIDADE CIENTÍFICA real (paper PubMed citado de forma elegante)
2. HOOK VIRAL (5 arquétipos validados — declaração contraintuitiva, ciência inesperada, dor comum validada, pergunta direta, crítica ao sistema)
3. ESTÉTICA LONGEVIFY (paleta verde-floresta + teal, glow radial, glassmorphism, NB International + DM Sans, NUNCA stock genérico)
4. PILAR ALVO (1 dos 4: terroir BR, biomarcador escondido, falha do check-up, sintoma→dado)
5. ANTI-THEMES estritos (sem medo, sem jargão, sem cura-promessa, sem clichê de saúde)

Você recebeu 5 fontes de contexto. Use TODAS:
- BRAND book Longevify
- PILLARS Longevify (com ICP detalhado)
- ANÁLISE competitiva (5 hooks virais do mercado)
- PAPERS PubMed sobre o biomarcador (cite 1 escondido no fim do carrossel)
- ARTIGO blog Mito (longform — base de profundidade, traduza/adapte mas NÃO copie)
- VISUAL DNA dos top virais sobre o tópico (replicar o formato vencedor com tom Longevify)

Output: APENAS JSON (sem markdown, sem texto antes/depois) com a estrutura solicitada no user message.`;
}

function buildUserPrompt(opts: {
  biomarker: string;
  pillar: number;
  brand: string;
  pillars: string;
  analysisMd: string;
  papers: PubMedPaper[];
  blogs: Array<MitoArticle & { brand: string }>;
  visuals: VisualDna[];
}): string {
  const {
    biomarker, pillar, brand, pillars, analysisMd, papers, blogs, visuals,
  } = opts;

  const papersBlock = papers.map((p, i) =>
    `${i + 1}. **${p.title}** (${p.authors.slice(0, 3).join(", ")}${p.authors.length > 3 ? " et al." : ""}) · *${p.journal}*, ${p.year} · PMID ${p.pmid}\n   ${(p.abstract ?? "").slice(0, 600)}`
  ).join("\n\n");

  // Top 3 blogs (priorizando wordCount desc, mas 1 por brand quando possível)
  const seenBrands = new Set<string>();
  const topBlogs = [
    ...blogs.filter((b) => { if (seenBrands.has(b.brand)) return false; seenBrands.add(b.brand); return true; }),
    ...blogs.filter((b) => !seenBrands.has(b.brand) || true).slice(0, 3),
  ].slice(0, 3);
  const blogBlock = topBlogs.length
    ? topBlogs.map((b, i) => `### Blog ${i + 1} — ${b.brand} (${b.wordCount} palavras)
**Título:** ${b.title}
**URL:** ${b.url}

EXTRATO (use como base, NÃO copie literalmente):
${b.bodyText.slice(0, 3000)}`).join("\n\n---\n\n")
    : "(nenhum artigo de blog matched — improvise)";

  const visualBlock = visuals.length
    ? visuals.map((v, i) =>
        `${i + 1}. [${v.brand} · ${v.format} · ${v.vsMedian.toFixed(2)}x] "${v.hookLine.slice(0, 100)}"
   Hook signal: ${v.primary.hookSignal}
   Prompt visual (chatbot-quality):
   ${(v.primary.prompt || "").slice(0, 1500)}`
      ).join("\n\n")
    : "(nenhum viral encontrado sobre tópico — use referência Apple/Aesop)";

  return `# Tarefa
Gerar 1 carrossel viral Longevify (5 slides, formato 4:5 vertical) sobre **${biomarker}**, alinhado ao **Pilar ${pillar}**.

# Contexto

## 1. BRAND book Longevify
${brand}

## 2. PILLARS Longevify
${pillars}

## 3. Análise competitiva (5 hooks virais)
${analysisMd.slice(0, 4000)}

## 4. PubMed — papers sobre ${biomarker}
${papersBlock}

## 5. Blogs longform dos big 3 (top match por marca)
${blogBlock}

## 6. Top virais sobre o tópico (visual DNA replicável)
${visualBlock}

# Output (APENAS JSON, schema):

\`\`\`json
{
  "topic": "${biomarker}",
  "pillar": ${pillar},
  "hooks": [
    "4 variações de hook (1ª linha) que se encaixam num arquétipo viral cada",
    "...",
    "...",
    "..."
  ],
  "selectedHookIndex": 0,
  "hookArchetype": "declaração-contraintuitiva | ciência-inesperada | dor-comum-validada | pergunta-direta | crítica-sistema",
  "hookRationale": "1-2 frases — por que esse hook bate na audiência Longevify especificamente",

  "slides": [
    {
      "slideNum": 1,
      "role": "hook",
      "copy": "TEXTO LITERAL no slide (ex: '14 traduções biológicas para \\\"estou cansado\\\"'). Curto, 6-12 palavras, peso visual.",
      "visualPrompt": "PROMPT MEGA-DETALHADO em PT (com termos EN técnicos onde padrão) seguindo a estrutura de 13 camadas: formato → estilo → ângulo → sujeito → iluminação → paleta hex → textura → composição → camera context → texto overlays exhaustive → elementos gráficos → mood adjetivos → restrições → style summary. ~250-350 palavras. Replicável 95% no GPT-Image-2/Midjourney/Flux. PALETA OBRIGATÓRIA Longevify: #1C3F3A verde-floresta · #006070 azul-petróleo · #5BAE9E teal médio · #f8fffc quase-branco. Tipografia: NB International ou Inter Display Light/Medium. ASSINATURA Longevify: glow teal radial centralizado sobre fundo escuro. NUNCA: jaleco, hospital, fundo branco puro, fonte bold pesado, estoque genérico.",
      "promptEN": "Versão concisa em EN (~120 palavras) pra Midjourney/Flux. Mantém hex codes, lens, lighting."
    },
    { "slideNum": 2, "role": "body", "copy": "...", "visualPrompt": "...", "promptEN": "..." },
    { "slideNum": 3, "role": "data", "copy": "número grande + contexto", "visualPrompt": "...", "promptEN": "..." },
    { "slideNum": 4, "role": "body", "copy": "...", "visualPrompt": "...", "promptEN": "..." },
    { "slideNum": 5, "role": "cta", "copy": "convite inteligente, nunca urgência fabricada", "visualPrompt": "...", "promptEN": "..." }
  ],

  "caption": "EM PT-BR — caption completa do post. ~120-180 palavras. Estrutura: hook reescrito em forma narrativa → 2-3 parágrafos de profundidade tirada do Mito blog adaptada → 1 frase com paper escondido (citação acadêmica natural, não 'ESTUDO MOSTRA') → CTA (não urgente, convite). Tom: sofisticado, direto, brasileiro. Termina com 4-6 hashtags relevantes (não genéricas).",

  "citedPaper": {
    "pmid": "PMID do paper escolhido (entre os fornecidos)",
    "shortRef": "ex: 'Smith et al., NEJM 2024' — formato amigável dentro da caption"
  },

  "mediaSpecs": {
    "format": "carousel 4:5 vertical · 1080x1350 · 5 slides",
    "primaryColor": "#1C3F3A",
    "accentColor": "#5BAE9E",
    "fontHeadline": "NB International ou Inter Display Light",
    "fontBody": "DM Sans Regular"
  },

  "antiPatternCheckPassed": "PT — confirma que o post evita: medo, jargão, cura-promessa, exclamações, clichê de saúde, visual genérico. Lista 1 risco residual se houver."
}
\`\`\``;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY ausente");

  console.log(`🎯 make-post — Pilar ${pillar} · tópico: ${topic} (${BIOMARKER_SLUG})`);
  console.log(`   Modelo: ${MODEL}`);
  console.log("");

  // Load context
  const brand = loadBrand();
  const pillars = loadPillars();
  const papers = loadPubmedForBiomarker(BIOMARKER_SLUG);
  const blogs = loadBlogsForTopic(SEARCH_KEYWORDS);
  const visuals = loadVisualDnaSamples(SEARCH_KEYWORDS);
  const analysisMd = loadAnalysisMd();
  console.log(`🔎 Keywords de busca: ${SEARCH_KEYWORDS.join(" · ")}`);

  console.log(`📚 Contexto carregado:`);
  console.log(`   - BRAND: ${(brand.length / 1024).toFixed(0)}KB`);
  console.log(`   - PILLARS: ${(pillars.length / 1024).toFixed(0)}KB`);
  console.log(`   - Análise competitiva: ${(analysisMd.length / 1024).toFixed(0)}KB`);
  console.log(`   - PubMed papers: ${papers.length}`);
  console.log(`   - Blogs (3 marcas): ${blogs.length} matches`);
  for (const b of blogs.slice(0, 5)) {
    console.log(`     · [${b.brand}] ${b.wordCount}p — ${b.title.slice(0, 70)}`);
  }
  console.log(`   - Visual DNA virais: ${visuals.length}`);
  console.log("");

  if (papers.length === 0) console.log(`⚠️  Sem papers PubMed pra "${BIOMARKER_SLUG}" — GPT vai improvisar`);
  if (blogs.length === 0) console.log(`⚠️  Sem artigos de blog matched pra keywords "${SEARCH_KEYWORDS.join(", ")}"`);

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt({
    biomarker: topic, pillar, brand, pillars, analysisMd, papers, blogs, visuals,
  });

  // Save context audit
  const dateStr = new Date().toISOString().slice(0, 10);
  const slug = `${dateStr}-pillar${pillar}-${topic}`;
  const outDir = path.join(ROOT, "output", "longevify-posts", slug);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "context-used.md"),
    `# Context audit — ${slug}

## System prompt
${systemPrompt}

## User prompt (full)
${userPrompt}
`);
  console.log(`💾 Context audit: ${outDir}/context-used.md`);

  console.log(`\n🤖 Chamando ${MODEL}...`);
  const start = Date.now();
  const res = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const u = res.usage;
  console.log(`   ✅ ${elapsed}s · ${u?.prompt_tokens ?? "?"} in / ${u?.completion_tokens ?? "?"} out`);

  const text = res.choices[0]?.message?.content ?? "";

  // Extract JSON
  const jsonM = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
  if (!jsonM) {
    fs.writeFileSync(path.join(outDir, "raw-response.txt"), text);
    throw new Error("Claude não retornou JSON parseable. Veja raw-response.txt");
  }
  const post = JSON.parse(jsonM[1]);

  // Save outputs
  fs.writeFileSync(path.join(outDir, "post.json"), JSON.stringify(post, null, 2));

  // Build readable .md
  const md = buildPostMd(post);
  fs.writeFileSync(path.join(outDir, "post.md"), md);

  console.log(`\n✅ Post gerado:`);
  console.log(`   ${outDir}/post.json`);
  console.log(`   ${outDir}/post.md`);
  console.log("");
  console.log(`📝 Hook escolhido: "${post.hooks[post.selectedHookIndex]}"`);
  console.log(`📖 Slides: ${post.slides.length}`);
  console.log(`📄 Caption: ${(post.caption || "").slice(0, 200)}...`);
}

function buildPostMd(post: Record<string, unknown>): string {
  const slides = post.slides as Array<Record<string, unknown>>;
  const hooks = post.hooks as string[];
  const selectedHookIndex = post.selectedHookIndex as number;

  const L: string[] = [];
  L.push(`# Longevify Post — ${post.topic} · Pilar ${post.pillar}`);
  L.push("");
  L.push(`> Gerado em ${new Date().toLocaleString("pt-BR")} · arquétipo: ${post.hookArchetype}`);
  L.push("");

  L.push(`## Hook escolhido`);
  L.push("");
  L.push(`> "${hooks[selectedHookIndex]}"`);
  L.push("");
  L.push(`**Por quê:** ${post.hookRationale}`);
  L.push("");

  L.push(`## Outras 3 variações de hook (A/B test)`);
  L.push("");
  for (let i = 0; i < hooks.length; i++) {
    if (i === selectedHookIndex) continue;
    L.push(`- "${hooks[i]}"`);
  }
  L.push("");

  L.push(`## Slides`);
  L.push("");
  for (const s of slides) {
    L.push(`### Slide ${s.slideNum} — [${s.role}]`);
    L.push("");
    L.push(`**Copy:** "${s.copy}"`);
    L.push("");
    L.push(`**Visual prompt (PT, 13 camadas):**`);
    L.push("```");
    L.push(s.visualPrompt as string);
    L.push("```");
    L.push("");
    L.push(`**Visual prompt EN (Midjourney/Flux):**`);
    L.push("```");
    L.push(s.promptEN as string);
    L.push("```");
    L.push("");
  }

  L.push(`## Caption final (publicar)`);
  L.push("");
  L.push(post.caption as string);
  L.push("");

  const cited = post.citedPaper as { pmid: string; shortRef: string };
  L.push(`## Paper citado`);
  L.push("");
  L.push(`- ${cited.shortRef}`);
  L.push(`- PMID: ${cited.pmid} · https://pubmed.ncbi.nlm.nih.gov/${cited.pmid}/`);
  L.push("");

  L.push(`## Specs de mídia`);
  L.push("");
  const specs = post.mediaSpecs as Record<string, string>;
  for (const [k, v] of Object.entries(specs)) L.push(`- **${k}:** ${v}`);
  L.push("");

  L.push(`## Anti-pattern check`);
  L.push("");
  L.push(post.antiPatternCheckPassed as string);

  return L.join("\n");
}

main().catch((err) => {
  console.error("\n❌", err.message);
  process.exit(1);
});
