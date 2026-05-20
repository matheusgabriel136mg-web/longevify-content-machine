/**
 * competitor-scan.ts — Weekly competitor scan → 3 idea cards
 *
 * Roda toda segunda-feira via GitHub Actions. Scrapeia 20 posts de cada
 * concorrente, filtra os 7 últimos dias, rankeia por vsMedian, e pede pro
 * Claude converter os top 3 em idea cards alinhados aos pilares Longevify.
 *
 * Output:
 *   runs/YYYY-MM-DD-NNN-competitor-scan/
 *     ideas.md           ← resumo das 3 ideias (você lê e escolhe)
 *     idea-1.md          ← idea card individual (pronta pra virar new-run)
 *     idea-2.md
 *     idea-3.md
 *     raw-posts.json     ← top 20 posts da semana com vsMedian (debug)
 *
 * Uso manual:
 *   npm run competitor-scan
 *
 * Custo: ~$1 (Apify 100 posts + Claude 1 chamada)
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const COMPETITORS = [
  { name: "Superpower", handle: "superpower", tier: 1 },
  { name: "Mito Health", handle: "mitohealthapp", tier: 1 },
  { name: "Function Health", handle: "function", tier: 2 },
  { name: "Better Be Health", handle: "betterbe.health", tier: 2 },
  { name: "Huberman Lab", handle: "hubermanlab", tier: 2 },
  { name: "Bryan Johnson", handle: "bryanjohnson_", tier: 1 },
  { name: "Thorne Health", handle: "thornehealth", tier: 2 },
  { name: "Rerise Health", handle: "rerisehealth", tier: 2 },
  { name: "Timeline Longevity", handle: "timeline_longevity", tier: 2 },
  { name: "Dr Longevity", handle: "dr.longevity", tier: 3 },
];

const POSTS_PER_ACCOUNT = 20;
const LOOKBACK_DAYS = 7;
const APIFY_POLL_MS = 6_000;
const APIFY_TIMEOUT_MS = 10 * 60_000;

interface ApifyPost {
  shortCode?: string;
  url?: string;
  ownerUsername?: string;
  username?: string;
  caption?: string;
  likesCount?: number;
  commentsCount?: number;
  type?: string;
  productType?: string;
  timestamp?: string;
  displayUrl?: string;
  images?: string[];
  hashtags?: string[];
}

interface RankedPost extends ApifyPost {
  brand: string;
  format: "image" | "carousel" | "reel";
  engagementScore: number;
  brandMedian: number;
  vsMedian: number;
  daysAgo: number;
}

function log(prefix: string, msg: string) {
  console.log(`${prefix} ${msg}`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function apifyFetch(endpoint: string, options?: RequestInit): Promise<unknown> {
  const sep = endpoint.includes("?") ? "&" : "?";
  const url = `https://api.apify.com/v2${endpoint}${sep}token=${process.env.APIFY_API_TOKEN}`;
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`Apify ${res.status}: ${await res.text()}`);
  return res.json();
}

async function scrapeAll(): Promise<ApifyPost[]> {
  const directUrls = COMPETITORS.map((c) => `https://www.instagram.com/${c.handle}/`);
  log("📸", `Scraping ${COMPETITORS.length} contas (${POSTS_PER_ACCOUNT} posts cada)...`);

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
  const deadline = Date.now() + APIFY_TIMEOUT_MS;
  let status = "RUNNING";
  while (["RUNNING", "READY"].includes(status)) {
    if (Date.now() > deadline) throw new Error("Apify timeout (10 min)");
    await sleep(APIFY_POLL_MS);
    const poll = (await apifyFetch(`/actor-runs/${runId}`)) as { data: { status: string } };
    status = poll.data.status;
    process.stdout.write(`\r  ⏳ Status: ${status}        `);
  }
  process.stdout.write("\n");
  if (status !== "SUCCEEDED") throw new Error(`Apify falhou: ${status}`);

  const items = (await apifyFetch(
    `/datasets/${run.data.defaultDatasetId}/items?clean=true&format=json`
  )) as ApifyPost[];

  log("  ✅", `${items.length} posts coletados`);
  return items;
}

function detectFormat(p: ApifyPost): RankedPost["format"] {
  if (p.productType === "clips" || p.type === "Video") return "reel";
  if (p.type === "Sidecar" || (p.images?.length ?? 0) > 1) return "carousel";
  return "image";
}

function computeScore(p: ApifyPost): number {
  return (p.likesCount ?? 0) + 5 * (p.commentsCount ?? 0);
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function rankAndFilter(posts: ApifyPost[]): RankedPost[] {
  const handleToName = new Map(COMPETITORS.map((c) => [c.handle.toLowerCase(), c.name]));
  const now = Date.now();
  const cutoff = now - LOOKBACK_DAYS * 86_400_000;

  const enriched = posts.map((p) => {
    const handle = (p.ownerUsername ?? p.username ?? "").toLowerCase();
    const brand = handleToName.get(handle) ?? handle;
    const ts = p.timestamp ? new Date(p.timestamp).getTime() : 0;
    return {
      ...p,
      brand,
      format: detectFormat(p),
      engagementScore: computeScore(p),
      _ts: ts,
    };
  });

  const medianByBrand = new Map<string, number>();
  for (const c of COMPETITORS) {
    const scores = enriched.filter((p) => p.brand === c.name).map((p) => p.engagementScore);
    medianByBrand.set(c.name, median(scores));
  }

  return enriched
    .filter((p) => p._ts >= cutoff)
    .map((p) => {
      const m = medianByBrand.get(p.brand) ?? 0;
      const daysAgo = (now - p._ts) / 86_400_000;
      return {
        ...p,
        brandMedian: m,
        vsMedian: m > 0 ? p.engagementScore / m : 0,
        daysAgo: Math.round(daysAgo * 10) / 10,
      };
    })
    .filter((p) => p.vsMedian >= 1.0)
    .sort((a, b) => b.vsMedian - a.vsMedian)
    .slice(0, 20);
}

interface IdeaCard {
  hook: string;
  pillar: 1 | 2 | 3 | 4;
  pillar_name: string;
  route: "rewrite" | "repurpose" | "original";
  format: "carousel" | "reel" | "post" | "story";
  why: string;
  suggested_slug: string;
  source_post_url: string;
  source_brand: string;
  source_vsmedian: number;
}

async function generateIdeas(top3: RankedPost[]): Promise<IdeaCard[]> {
  const pillarsPath = path.join(ROOT, "LONGEVIFY_PILLARS.md");
  const brandPath = path.join(ROOT, "LONGEVIFY_BRAND.md");
  const pillars = fs.existsSync(pillarsPath) ? fs.readFileSync(pillarsPath, "utf-8") : "";
  const brand = fs.existsSync(brandPath) ? fs.readFileSync(brandPath, "utf-8").slice(0, 2500) : "";

  // Marca posts de tier-3 (ideas-only, visual NÃO copiar)
  const handleToTier = new Map(COMPETITORS.map((c) => [c.name, c.tier]));

  const postsForPrompt = top3.map((p, i) => ({
    n: i + 1,
    brand: p.brand,
    format: p.format,
    vsMedian: p.vsMedian.toFixed(2),
    daysAgo: p.daysAgo,
    url: p.url ?? `https://instagram.com/p/${p.shortCode ?? ""}`,
    caption: (p.caption ?? "").slice(0, 800),
    tier: handleToTier.get(p.brand) ?? 2,
    visual_forbidden: handleToTier.get(p.brand) === 3,
  }));

  const prompt = `Você é o editor de conteúdo da Longevify. Analise os 3 posts virais abaixo (semana passada, top vsMedian dos concorrentes) e converta cada um em uma idea card adaptada pros pilares da Longevify.

# Brand context Longevify
${brand}

# Pilares
${pillars}

# Posts virais da semana
${JSON.stringify(postsForPrompt, null, 2)}

# Sua tarefa
Pra cada um dos 3 posts, retorne UMA idea card pronta pra virar new-run. Use route="rewrite" (adaptação cultural pt-BR) por default. Use route="repurpose" só se o formato em si é o ouro (não a copy). Use route="original" se o post inspira mas a Longevify deveria ir num ângulo totalmente novo.

# REGRA CRÍTICA — Tier 3 sources
Posts com \`visual_forbidden: true\` no JSON acima são de fontes Tier 3 (ideias boas, estética horrível). Para esses, OBRIGATORIAMENTE:
- route MUST be "rewrite" (NUNCA "repurpose")
- O campo "why" deve incluir explicitamente: "Visual da fonte é NÃO usar como referência — apenas ângulo de conteúdo."
- A idea card deve focar 100% no insight/ângulo, ignorando completamente o layout/visual do post original.

Retorne JSON puro (sem markdown fences) com este formato exato:

[
  {
    "hook": "headline pt-BR no tom Longevify (Mito + Aesop), máx 90 chars",
    "pillar": 1 | 2 | 3 | 4,
    "pillar_name": "nome do pilar",
    "route": "rewrite" | "repurpose" | "original",
    "format": "carousel" | "reel" | "post" | "story",
    "why": "2 frases: por que esse post virou + por que cabe no pilar X",
    "suggested_slug": "kebab-case-pt-br-curto",
    "source_post_url": "url do post original",
    "source_brand": "nome da marca",
    "source_vsmedian": número
  }
]

CRÍTICO: hook NUNCA copia o original em português. Sempre reinterpreta no tom Longevify (poético + dado). Se o post original não cabe em nenhum pilar, marque pillar=null e why explica por que não vale adaptar.`;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  log("🧠", "Claude Opus gerando ideas...");

  const msg = await anthropic.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  });

  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("Claude não retornou JSON válido:\n" + text);

  return JSON.parse(jsonMatch[0]) as IdeaCard[];
}

function nextSequence(date: string, runsDir: string): string {
  if (!fs.existsSync(runsDir)) return "001";
  const existing = fs.readdirSync(runsDir).filter((d) => d.startsWith(date));
  const seqs = existing
    .map((d) => parseInt(d.slice(date.length + 1, date.length + 4), 10))
    .filter((n) => !isNaN(n));
  const next = (seqs.length === 0 ? 0 : Math.max(...seqs)) + 1;
  return String(next).padStart(3, "0");
}

function ideaCardMarkdown(card: IdeaCard, index: number): string {
  return `# Idea ${index} — ${card.hook}

**Pilar:** ${card.pillar} — ${card.pillar_name}
**Route:** ${card.route}
**Format:** ${card.format}
**Slug sugerido:** \`${card.suggested_slug}\`

## Por que essa idea
${card.why}

## Fonte original
- **Marca:** ${card.source_brand}
- **Performance:** ${card.source_vsmedian.toFixed(2)}x vsMedian
- **Post:** ${card.source_post_url}

## Pra virar run

\`\`\`bash
npm run new-run -- --slug ${card.suggested_slug} --pillar ${card.pillar} --route ${card.route} --format ${card.format}
\`\`\`
`;
}

function summaryMarkdown(cards: IdeaCard[], top3: RankedPost[], runId: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const L: string[] = [];
  L.push(`# Competitor Scan — ${today}`);
  L.push("");
  L.push(`> Scan automático semanal · ${COMPETITORS.length} contas × ${POSTS_PER_ACCOUNT} posts · janela ${LOOKBACK_DAYS}d · gerado ${new Date().toLocaleString("pt-BR")}`);
  L.push("");
  L.push(`## 3 ideias prontas pra new-run`);
  L.push("");
  L.push(`| # | Hook | Pilar | Route | Format | Fonte | vsMedian |`);
  L.push(`|---|------|-------|-------|--------|-------|---------:|`);
  cards.forEach((c, i) => {
    L.push(`| ${i + 1} | ${c.hook} | ${c.pillar} | ${c.route} | ${c.format} | ${c.source_brand} | ${c.source_vsmedian.toFixed(2)}x |`);
  });
  L.push("");
  L.push(`## Próximo passo`);
  L.push("");
  L.push(`Lê \`idea-1.md\`, \`idea-2.md\`, \`idea-3.md\` e escolhe uma. Roda o comando \`npm run new-run\` que está no rodapé da idea escolhida.`);
  L.push("");
  L.push(`## Top 20 posts virais da semana (debug)`);
  L.push("");
  L.push(`| Marca | Format | vsMedian | Dias atrás | URL |`);
  L.push(`|-------|--------|---------:|-----------:|-----|`);
  top3.forEach((p) => {
    L.push(`| ${p.brand} | ${p.format} | ${p.vsMedian.toFixed(2)}x | ${p.daysAgo}d | ${p.url ?? p.shortCode} |`);
  });
  return L.join("\n");
}

async function main() {
  if (!process.env.APIFY_API_TOKEN) throw new Error("APIFY_API_TOKEN ausente");
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY ausente");

  const raw = await scrapeAll();
  const ranked = rankAndFilter(raw);
  log("📊", `${ranked.length} posts viralizam (≥1.0x mediana) nos últimos ${LOOKBACK_DAYS} dias`);

  if (ranked.length < 3) {
    log("⚠️ ", `Apenas ${ranked.length} posts qualificados — não vou gerar ideas. Tente aumentar LOOKBACK_DAYS ou POSTS_PER_ACCOUNT.`);
    process.exit(0);
  }

  const top3 = ranked.slice(0, 3);
  log("🎯", `Top 3: ${top3.map((p) => `${p.brand} (${p.vsMedian.toFixed(1)}x)`).join(", ")}`);

  const cards = await generateIdeas(top3);

  const today = new Date().toISOString().slice(0, 10);
  const runsDir = path.join(ROOT, "runs");
  fs.mkdirSync(runsDir, { recursive: true });
  const seq = nextSequence(today, runsDir);
  const runId = `${today}-${seq}-competitor-scan`;
  const outDir = path.join(runsDir, runId);
  fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(path.join(outDir, "raw-posts.json"), JSON.stringify(ranked, null, 2));
  fs.writeFileSync(path.join(outDir, "ideas.md"), summaryMarkdown(cards, ranked, runId));
  cards.forEach((c, i) => {
    fs.writeFileSync(path.join(outDir, `idea-${i + 1}.md`), ideaCardMarkdown(c, i + 1));
  });

  log("✅", `Scan completo: runs/${runId}/`);
  log("  ", `→ ideas.md (resumo)`);
  cards.forEach((_, i) => log("  ", `→ idea-${i + 1}.md`));
}

main().catch((e) => {
  console.error("❌ ", e.message);
  process.exit(1);
});
