/**
 * analyze-instagrams.ts — Análise dos 3 concorrentes Longevify
 *
 * O que faz:
 *   1. Scrape 80 posts por conta (Superpower, Mito, Function) via Apify
 *   2. Calcula engagement vs. mediana DA PRÓPRIA marca → ranqueia virais
 *   3. Salva raw-posts.json (todos) + top-virals.json + top-virals.md
 *   4. Roda Claude (com BRAND_CONTEXT da Longevify) sobre os virais → analysis.md
 *
 * O que NÃO faz (de propósito — escopo cirúrgico):
 *   - Não gera posts pra Longevify
 *   - Não gera prompts de imagem/vídeo
 *   - Não chama fal.ai
 *   - Não escreve em DB nenhum
 *
 * Custo estimado: ~$3-5 (Apify ~240 posts + Claude 1 chamada longa)
 * Tempo: 8-15 minutos (Apify é o gargalo)
 *
 * Uso: cd content-machine && npm run analyze-instagrams
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// ─── Config ───────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PARENT = path.dirname(__dirname); // content-machine/

// NOTE 18/mai/2026 — última scrape: 7 handles voltaram com 0 posts.
// Possíveis causas: handle mudou, conta privada, Apify rate-limit no fetch específico,
// ou handle simplesmente errado. Verificar manualmente em instagram.com/<handle>/
// antes da próxima scrape. Candidatos alternativos comentados.
const COMPETITORS = [
  // Tier 1 — concorrentes diretos
  { name: "Superpower", handle: "superpower" },              // ✓ 5 posts last scrape (poucos mas existe)
  { name: "Mito Health", handle: "mitohealth" },             // ⚠️ 0 last scrape — tentar variantes: mitohealth | getmito | mito.health
  { name: "Function Health", handle: "function" },           // ✓ 8 posts last scrape
  { name: "Bryan Johnson", handle: "bryanjohnson_" },        // ⚠️ 0 last scrape — confirmar; perfil exists, possível rate-limit Apify
  // Tier 2 — health-tech adjacentes
  { name: "Thorne Health", handle: "thornehealth" },          // ✓ 7 posts
  { name: "Rerise Health", handle: "rerisehealth" },          // ✓ 25 posts
  { name: "Timeline Longevity", handle: "timeline_longevity" }, // ✓ 130 posts
  { name: "Lifeforce", handle: "mylifeforce" },               // ✓ 178 posts (campeão)
  { name: "InsideTracker", handle: "insidetracker" },         // ✓ 12 posts
  { name: "Everlywell", handle: "everlywell" },               // ⚠️ 0 last scrape — verificar
  { name: "OneSkin", handle: "oneskin" },                     // ⚠️ 0 last scrape — era oneskinco, agora `oneskin`
  { name: "Forward", handle: "goforward" },                   // ⚠️ 0 last scrape — talvez forwardhealth ou @forward
  // Tier 2 — autoridade científica
  { name: "Huberman Lab", handle: "hubermanlab" },            // ✓ 90 posts
  { name: "Peter Attia MD", handle: "peterattiamd" },         // ✓ 4 posts
  { name: "Dr Mark Hyman", handle: "drmarkhyman" },           // ⚠️ 0 last scrape — perfil exists. Provável rate-limit.
  { name: "Rhonda Patrick", handle: "foundmyfitness" },       // ✓ 122 posts
  // Tier 2 — BR
  { name: "Better Be Health", handle: "betterbehealth" },     // ⚠️ 0 last scrape — era betterbe.health (com ponto)
  { name: "Everlab Health", handle: "everlab_health" },       // 🆕 20/mai/2026 — referência AU, posts alta qualidade (Matheus)
];

const POSTS_PER_ACCOUNT = 200;
const CAROUSEL_FOCUS = true; // priorizar carrosséis no output ranqueado
const VIRAL_THRESHOLD = 1.5; // vs_median ≥ 1.5x → consideramos viral
const APIFY_POLL_MS = 6_000;
const APIFY_TIMEOUT_MS = 10 * 60_000;

const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
const OUTPUT_DIR = path.join(PARENT, "output", `analysis-${TIMESTAMP}`);

// ─── Brand context (lê uma vez, injeta no prompt do Claude) ──────────────────

function loadBrandContext(): string {
  const brandFile = path.join(PARENT, "LONGEVIFY_BRAND.md");
  if (!fs.existsSync(brandFile)) {
    log("⚠️ ", "LONGEVIFY_BRAND.md não encontrado — análise vai sem contexto da marca");
    return "";
  }
  return fs.readFileSync(brandFile, "utf-8");
}

// ─── Apify ────────────────────────────────────────────────────────────────────

interface ApifyPost {
  id?: string;
  shortCode?: string;
  url?: string;
  ownerUsername?: string;
  username?: string;
  caption?: string;
  likesCount?: number;
  commentsCount?: number;
  videoViewCount?: number;
  videoPlayCount?: number;
  type?: string;
  productType?: string;
  timestamp?: string;
  displayUrl?: string;
  videoUrl?: string;
  images?: string[];
  hashtags?: string[];
}

async function apifyFetch(
  endpoint: string,
  options?: RequestInit
): Promise<unknown> {
  const sep = endpoint.includes("?") ? "&" : "?";
  const url = `https://api.apify.com/v2${endpoint}${sep}token=${process.env.APIFY_API_TOKEN}`;
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`Apify ${res.status}: ${await res.text()}`);
  return res.json();
}

async function scrapeAll(): Promise<ApifyPost[]> {
  const directUrls = COMPETITORS.map((c) => `https://www.instagram.com/${c.handle}/`);
  log("📸", `Scraping ${COMPETITORS.length} contas (${POSTS_PER_ACCOUNT} posts cada = ${POSTS_PER_ACCOUNT * COMPETITORS.length} total)...`);
  COMPETITORS.forEach((c) => log("  →", `@${c.handle} (${c.name})`));

  const run = (await apifyFetch("/acts/apify~instagram-scraper/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      directUrls,
      resultsType: "posts",
      resultsLimit: POSTS_PER_ACCOUNT,
      addParentData: false,
      scrapeStories: false,
    }),
  })) as { data: { id: string; defaultDatasetId: string } };

  const runId = run.data.id;
  log("  ⏳", `Apify run: ${runId}`);

  const deadline = Date.now() + APIFY_TIMEOUT_MS;
  let status = "RUNNING";
  while (["RUNNING", "READY"].includes(status)) {
    if (Date.now() > deadline) throw new Error("Apify timeout (10 min)");
    await sleep(APIFY_POLL_MS);
    const poll = (await apifyFetch(`/actor-runs/${runId}`)) as {
      data: { status: string };
    };
    status = poll.data.status;
    process.stdout.write(`\r  ⏳ Status: ${status}        `);
  }
  process.stdout.write("\n");

  if (status !== "SUCCEEDED") throw new Error(`Apify terminou com: ${status}`);

  const items = (await apifyFetch(
    `/datasets/${run.data.defaultDatasetId}/items?clean=true&format=json`
  )) as ApifyPost[];

  log("  ✅", `${items.length} posts coletados`);
  return items;
}

// ─── Ranking ──────────────────────────────────────────────────────────────────

interface RankedPost extends ApifyPost {
  brand: string;
  format: "image" | "carousel" | "reel";
  engagementScore: number;
  brandMedian: number;
  vsMedian: number;
  isViral: boolean;
}

function detectFormat(p: ApifyPost): RankedPost["format"] {
  if (p.productType === "clips" || p.type === "Video") return "reel";
  if (p.type === "Sidecar" || (p.images?.length ?? 0) > 1) return "carousel";
  return "image";
}

function computeScore(p: ApifyPost): number {
  // Comentários valem 5x — sinal muito mais raro/forte que like.
  return (p.likesCount ?? 0) + 5 * (p.commentsCount ?? 0);
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function rankPosts(posts: ApifyPost[]): RankedPost[] {
  // Mapeia handle → nome amigável da marca
  const handleToName = new Map(COMPETITORS.map((c) => [c.handle.toLowerCase(), c.name]));

  // Atribui marca + score
  const enriched = posts.map((p) => {
    const handle = (p.ownerUsername ?? p.username ?? "").toLowerCase();
    const brand = handleToName.get(handle) ?? handle;
    const format = detectFormat(p);
    const engagementScore = computeScore(p);
    return { ...p, brand, format, engagementScore };
  });

  // Mediana por marca
  const medianByBrand = new Map<string, number>();
  for (const c of COMPETITORS) {
    const scores = enriched
      .filter((p) => p.brand === c.name)
      .map((p) => p.engagementScore);
    medianByBrand.set(c.name, median(scores));
  }

  // Anota vs_median + viral flag
  return enriched
    .map((p) => {
      const m = medianByBrand.get(p.brand) ?? 0;
      const vsMedian = m > 0 ? p.engagementScore / m : 0;
      return {
        ...p,
        brandMedian: m,
        vsMedian,
        isViral: vsMedian >= VIRAL_THRESHOLD,
      } as RankedPost;
    })
    .sort((a, b) => b.vsMedian - a.vsMedian);
}

// ─── Markdown helpers ─────────────────────────────────────────────────────────

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function compactNumber(n: number | undefined | null): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function topViralsMarkdown(virals: RankedPost[]): string {
  const lines: string[] = [];
  lines.push("# Top virais — análise cruzada");
  lines.push("");
  lines.push(`> ${virals.length} posts viralizaram (≥${VIRAL_THRESHOLD}x da mediana da própria conta).`);
  lines.push("");

  // Por marca
  for (const c of COMPETITORS) {
    const brandVirals = virals.filter((v) => v.brand === c.name);
    if (!brandVirals.length) continue;
    lines.push(`## ${c.name} — ${brandVirals.length} virais`);
    lines.push("");
    lines.push("| vs.med | Formato | Likes | Coments | Views | Hook (1ª linha) | Link |");
    lines.push("|-------:|---------|------:|--------:|------:|-----------------|------|");
    for (const v of brandVirals.slice(0, 15)) {
      const hook = (v.caption ?? "").split("\n")[0].slice(0, 80).replace(/\|/g, "\\|");
      const link = v.url ?? `https://instagram.com/p/${v.shortCode}`;
      lines.push(
        `| ${v.vsMedian.toFixed(2)}x | ${v.format} | ${compactNumber(v.likesCount)} | ${compactNumber(v.commentsCount)} | ${compactNumber(v.videoViewCount ?? v.videoPlayCount)} | ${hook} | [↗](${link}) |`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Claude analysis ──────────────────────────────────────────────────────────

function formatPostsForClaude(virals: RankedPost[]): string {
  return virals
    .slice(0, 60) // limita pra não estourar contexto
    .map(
      (p, i) => `
### ${i + 1}. ${p.brand} — ${p.format} — ${p.vsMedian.toFixed(2)}x mediana
- Likes: ${p.likesCount ?? 0} | Comentários: ${p.commentsCount ?? 0}${p.videoViewCount ? ` | Views: ${p.videoViewCount}` : ""}
- URL: ${p.url ?? `https://instagram.com/p/${p.shortCode}`}
- Caption:
${(p.caption ?? "(sem caption)").slice(0, 800)}
`
    )
    .join("\n---\n");
}

async function runAnalysis(virals: RankedPost[], all: RankedPost[]): Promise<string> {
  const genai = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
  const brandContext = loadBrandContext();

  // Estatísticas resumo
  const totalsByBrand = COMPETITORS.map((c) => {
    const brandPosts = all.filter((p) => p.brand === c.name);
    const brandVirals = virals.filter((p) => p.brand === c.name);
    return {
      name: c.name,
      total: brandPosts.length,
      virals: brandVirals.length,
      median: brandPosts[0]?.brandMedian ?? 0,
    };
  });

  const summary = totalsByBrand
    .map((b) => `- **${b.name}**: ${b.total} posts coletados, ${b.virals} viralizaram, mediana de engajamento = ${Math.round(b.median)}`)
    .join("\n");

  const system = `Você é analista de inteligência competitiva de marcas de longevidade/saúde no Instagram. Use dados, não generalidades. Cite posts específicos pelo número quando defender uma tese.

---
## CONTEXTO DA MARCA LONGEVIFY (lentes pra interpretar os dados)

${brandContext}
---`;

  const user = `Analisei o Instagram dos 3 principais concorrentes da Longevify:

${summary}

Considera "viral" todo post com engajamento ≥ ${VIRAL_THRESHOLD}x da mediana da própria conta.

Abaixo estão os ${Math.min(60, virals.length)} posts virais ordenados por vs_median:

${formatPostsForClaude(virals)}

Quero uma análise em markdown com EXATAMENTE estas seções:

## 1. Padrões de hook que viralizam
Identifica 4-6 arquétipos de abertura (1ª linha) que aparecem repetidamente nos virais. Pra cada arquétipo: descrição em 1 frase + 2-3 exemplos citando o número do post.

## 2. Formato dominante por marca
Pra cada marca (Superpower, Mito, Function): qual formato (reel/carrossel/foto) tem mais virais e qual tem maior vs_median médio. Cita números.

## 3. Temas que performam
3-5 grupos temáticos que aparecem nos virais (ex: "biomarcador específico explicado", "mito desmentido", "founder story", "depoimento de paciente"). Quais marcas dominam quais temas.

## 4. Lacunas e oportunidades pra Longevify
3-5 ângulos que NÃO estão sendo explorados pelas 3 marcas (ou estão mal explorados) e que casariam com o posicionamento Longevify (medicina de precisão BR, alma humana, copy em PT). Cada oportunidade com:
- Por que existe a lacuna
- Que arquétipo de hook + formato adotaríamos
- 1 ideia concreta de post

## 5. 5 templates "pronto pra adaptar"
Pega os 5 posts virais MAIS REPLICÁVEIS pela Longevify (que têm DNA claro e tema universal). Pra cada um:
- Número e marca de origem
- DNA estrutural (hook + estrutura do corpo + CTA)
- Como adaptaríamos pra Longevify mantendo a estrutura mas trocando tema/voz
- Link do original

Seja direto, cite dados, evite generalidades.`;

  log("\n🧠", "Rodando análise com Gemini 2.5 Pro...\n");

  const model = genai.getGenerativeModel({
    model: "gemini-2.5-pro",
    systemInstruction: system,
  });

  const result = await model.generateContentStream(user);

  let out = "";
  for await (const chunk of result.stream) {
    const text = chunk.text();
    out += text;
    process.stdout.write(text);
  }
  return out;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function save(filename: string, content: string): void {
  fs.writeFileSync(path.join(OUTPUT_DIR, filename), content, "utf-8");
  log("  💾", `output/analysis-${TIMESTAMP}/${filename}`);
}

function log(icon: string, msg: string): void {
  console.log(`${icon} ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n📊 Análise dos Instagrams concorrentes — Longevify");
  console.log(`📅 ${new Date().toLocaleString("pt-BR")}`);
  console.log("─".repeat(60));

  if (!process.env.GOOGLE_API_KEY) throw new Error("GOOGLE_API_KEY não setada no .env");
  if (!process.env.APIFY_API_TOKEN) throw new Error("APIFY_API_TOKEN não setado no .env");

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // ── 1. Scrape ──────────────────────────────────────────────────────────────
  const rawPosts = await scrapeAll();
  if (!rawPosts.length) throw new Error("Nenhum post coletado — confere os handles");

  // ── 2. Rank ────────────────────────────────────────────────────────────────
  log("\n🏷 ", "Calculando engagement vs. mediana de cada marca...");
  const ranked = rankPosts(rawPosts);
  const virals = ranked.filter((p) => p.isViral);

  for (const c of COMPETITORS) {
    const brandPosts = ranked.filter((p) => p.brand === c.name);
    const brandVirals = brandPosts.filter((p) => p.isViral);
    log("  📈", `${c.name}: ${brandPosts.length} posts, ${brandVirals.length} virais (mediana=${Math.round(brandPosts[0]?.brandMedian ?? 0)})`);
  }

  // ── 3. Save raw + virals ───────────────────────────────────────────────────
  log("\n💾", "Salvando outputs estruturados...");
  save("raw-posts.json", JSON.stringify(ranked, null, 2));
  save("top-virals.json", JSON.stringify(virals, null, 2));
  save("top-virals.md", topViralsMarkdown(virals));

  if (!virals.length) {
    log("\n⚠️ ", "Zero posts viralizaram — verifica os dados antes de seguir pra análise");
    return;
  }

  // ── 4. Claude analysis ─────────────────────────────────────────────────────
  const analysis = await runAnalysis(virals, ranked);
  save(
    "analysis.md",
    `# Análise competitiva — ${TIMESTAMP}\n\n> ${COMPETITORS.map((c) => `@${c.handle}`).join(" · ")} — ${ranked.length} posts coletados, ${virals.length} virais\n\n${analysis}`
  );

  // ── Resumo ─────────────────────────────────────────────────────────────────
  console.log("\n\n" + "─".repeat(60));
  console.log("✅ Análise completa!");
  console.log(`\n📁 ${OUTPUT_DIR}/`);
  console.log("   raw-posts.json   ← todos os posts ranqueados");
  console.log("   top-virals.json  ← só os virais (estruturado)");
  console.log("   top-virals.md    ← virais em tabela legível");
  console.log("   analysis.md      ← análise completa do Claude");
  console.log();
}

main().catch((err) => {
  console.error("\n❌ Falhou:", err.message);
  process.exit(1);
});
