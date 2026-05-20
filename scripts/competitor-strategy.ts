/**
 * competitor-strategy.ts — Analisa a estratégia real de SP, Mito, Function.
 *
 * Pega raw-posts.json do último snapshot e extrai:
 *   - Frequência de posting (posts/dia médio, distribuição por dia da semana)
 *   - Mix de formato (carousel vs reel vs image)
 *   - Branded series patterns (recurrence de palavras-chave em captions)
 *   - Top hooks (primeira frase dos top vsMedian)
 *   - Caption length distribution
 *   - Hora do post (se disponível no timestamp)
 *   - Posts virais (vsMedian >= 1.5) — o que têm em comum?
 *
 * Depois chama Claude pra sintetizar a estratégia em markdown actionable.
 *
 * Output: output/strategy/<brand>-strategy.md (1 por marca)
 *
 * Uso:
 *   pnpm competitor-strategy
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

interface RawPost {
  id: string;
  brand?: string;
  caption?: string;
  format?: "image" | "carousel" | "reel";
  type?: string;
  productType?: string;
  likesCount?: number;
  commentsCount?: number;
  vsMedian?: number;
  isViral?: boolean;
  timestamp?: string;
  url?: string;
  shortCode?: string;
}

function findLatestAnalysis(): string | null {
  const outDir = path.join(ROOT, "output");
  if (!fs.existsSync(outDir)) return null;
  const dirs = fs.readdirSync(outDir).filter((d) => d.startsWith("analysis-")).sort();
  return dirs.length ? path.join(outDir, dirs[dirs.length - 1]) : null;
}

interface BrandStrategy {
  brand: string;
  totalPosts: number;
  dateRange: { from: string; to: string };
  postsPerDayAvg: number;
  formatMix: Record<string, { count: number; pct: number; avgVsMedian: number }>;
  postsByDayOfWeek: Record<string, number>;
  postsByHourBRT: Record<string, number>;
  captionLengthBuckets: Record<string, number>;
  viralPosts: RawPost[]; // vsMedian >= 1.5
  topHooks: Array<{ hook: string; vsMedian: number; url: string }>;
  recurringPatterns: string[]; // candidato a branded series
}

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function analyzeBrand(brand: string, posts: RawPost[]): BrandStrategy {
  const stats: BrandStrategy = {
    brand,
    totalPosts: posts.length,
    dateRange: { from: "", to: "" },
    postsPerDayAvg: 0,
    formatMix: {},
    postsByDayOfWeek: { sunday: 0, monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0, saturday: 0 },
    postsByHourBRT: {},
    captionLengthBuckets: { "0-100": 0, "100-300": 0, "300-600": 0, "600-1200": 0, "1200+": 0 },
    viralPosts: [],
    topHooks: [],
    recurringPatterns: [],
  };

  if (!posts.length) return stats;

  // Date range
  const timestamps = posts.map((p) => p.timestamp).filter(Boolean) as string[];
  if (timestamps.length) {
    const sorted = timestamps.sort();
    stats.dateRange.from = sorted[0].slice(0, 10);
    stats.dateRange.to = sorted[sorted.length - 1].slice(0, 10);
    const fromMs = new Date(sorted[0]).getTime();
    const toMs = new Date(sorted[sorted.length - 1]).getTime();
    const days = Math.max(1, (toMs - fromMs) / (86400 * 1000));
    stats.postsPerDayAvg = Math.round((posts.length / days) * 10) / 10;
  }

  // Format mix
  for (const p of posts) {
    const f = p.format ?? "image";
    if (!stats.formatMix[f]) stats.formatMix[f] = { count: 0, pct: 0, avgVsMedian: 0 };
    stats.formatMix[f].count++;
    stats.formatMix[f].avgVsMedian += (p.vsMedian ?? 0);
  }
  for (const f of Object.keys(stats.formatMix)) {
    stats.formatMix[f].pct = Math.round((stats.formatMix[f].count / posts.length) * 100);
    stats.formatMix[f].avgVsMedian = Math.round((stats.formatMix[f].avgVsMedian / stats.formatMix[f].count) * 100) / 100;
  }

  // Day of week + hour (BRT -3)
  for (const p of posts) {
    if (!p.timestamp) continue;
    const d = new Date(p.timestamp);
    const brt = new Date(d.getTime() - 3 * 3600 * 1000);
    stats.postsByDayOfWeek[DAY_NAMES[brt.getUTCDay()]]++;
    const hour = brt.getUTCHours();
    const bucket = `${String(hour).padStart(2, "0")}h`;
    stats.postsByHourBRT[bucket] = (stats.postsByHourBRT[bucket] ?? 0) + 1;
  }

  // Caption length
  for (const p of posts) {
    const len = (p.caption ?? "").length;
    if (len < 100) stats.captionLengthBuckets["0-100"]++;
    else if (len < 300) stats.captionLengthBuckets["100-300"]++;
    else if (len < 600) stats.captionLengthBuckets["300-600"]++;
    else if (len < 1200) stats.captionLengthBuckets["600-1200"]++;
    else stats.captionLengthBuckets["1200+"]++;
  }

  // Viral + top hooks
  stats.viralPosts = posts.filter((p) => (p.vsMedian ?? 0) >= 1.5).sort((a, b) => (b.vsMedian ?? 0) - (a.vsMedian ?? 0));
  stats.topHooks = stats.viralPosts.slice(0, 15).map((p) => {
    const firstLine = (p.caption ?? "").split("\n")[0].slice(0, 200);
    return { hook: firstLine, vsMedian: p.vsMedian ?? 0, url: p.url ?? "" };
  });

  // Recurring patterns (palavras-chave em uppercase ou padrões repetidos)
  const tokenMap = new Map<string, number>();
  for (const p of posts) {
    const cap = (p.caption ?? "").slice(0, 100);
    // procura palavras em ALL CAPS (≥4 chars) e frases recorrentes tipo "QUICK QUESTION"
    const caps = cap.match(/\b[A-Z]{4,}(\s[A-Z]+)*\b/g) ?? [];
    for (const c of caps) tokenMap.set(c, (tokenMap.get(c) ?? 0) + 1);
  }
  stats.recurringPatterns = [...tokenMap.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t, n]) => `${t} (${n}x)`);

  return stats;
}

async function synthesizeStrategy(stats: BrandStrategy): Promise<string> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const sample = stats.viralPosts.slice(0, 15).map((p, i) => ({
    i: i + 1,
    vsMedian: p.vsMedian?.toFixed(2),
    format: p.format,
    caption_first_200: (p.caption ?? "").slice(0, 200),
    url: p.url,
  }));

  const prompt = `Você é o analista de estratégia editorial. Analise os dados abaixo da marca **${stats.brand}** no Instagram e sintetize a ESTRATÉGIA REAL deles em markdown actionable.

# Métricas extraídas
\`\`\`json
${JSON.stringify({
  brand: stats.brand,
  total_posts: stats.totalPosts,
  date_range: stats.dateRange,
  posts_per_day_avg: stats.postsPerDayAvg,
  format_mix: stats.formatMix,
  posts_by_day_of_week: stats.postsByDayOfWeek,
  posts_by_hour_brt: stats.postsByHourBRT,
  caption_length_buckets: stats.captionLengthBuckets,
  viral_count: stats.viralPosts.length,
  recurring_patterns: stats.recurringPatterns,
}, null, 2)}
\`\`\`

# Top 15 posts virais (vsMedian >= 1.5x)
\`\`\`json
${JSON.stringify(sample, null, 2)}
\`\`\`

# Sua tarefa
Escreva um markdown com SEÇÕES:

## 1. Cadência observada
- Quantos posts/semana?
- Qual o dia mais frequente?
- Há padrão de horário?
- Comparativo: posts/sem absoluto vs frequência efetiva

## 2. Mix de format
- % de cada format
- Qual format viraliza mais (vsMedian médio)?
- Eles privilegiam reel, carousel ou image?

## 3. Branded series identificadas
- Quais padrões recorrentes em CAPS sugerem branded series?
- Como cada série performa?

## 4. Hook patterns dos virais
- Estruturas comuns nos top hooks (pergunta retórica, dado, contraste, etc.)
- 3-5 templates reutilizáveis

## 5. Caption strategy
- Caption curta ou longa? Bucket dominante?
- Os virais têm caption diferente da média?

## 6. Insights estratégicos pra Longevify
- 3-5 takeaways CONCRETOS adaptáveis pra Longevify
- O que NÃO copiar (anti-padrões deles)
- O que copiar com adaptação BR

Seja específico, cite números. Não invente — só conclua o que os dados mostram.`;

  const msg = await anthropic.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  });
  return msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY ausente");
  const dir = findLatestAnalysis();
  if (!dir) throw new Error("Sem snapshot em output/analysis-*");
  const rawPath = path.join(dir, "raw-posts.json");
  const posts = JSON.parse(fs.readFileSync(rawPath, "utf-8")) as RawPost[];

  const outDir = path.join(ROOT, "output", "strategy");
  fs.mkdirSync(outDir, { recursive: true });

  for (const brand of ["Superpower", "Mito Health", "Function Health"]) {
    const brandPosts = posts.filter((p) => p.brand === brand);
    if (!brandPosts.length) { console.log(`⚠️  ${brand}: 0 posts`); continue; }
    const stats = analyzeBrand(brand, brandPosts);
    console.log(`\n📊 ${brand}: ${stats.totalPosts} posts (${stats.postsPerDayAvg}/dia) · ${stats.viralPosts.length} virais (≥1.5x)`);

    const md = await synthesizeStrategy(stats);
    const slug = brand.toLowerCase().replace(/\s+/g, "-");
    const outPath = path.join(outDir, `${slug}-strategy.md`);
    fs.writeFileSync(outPath, md);
    console.log(`  ✓ ${path.relative(ROOT, outPath)}`);
  }

  // Sumário cruzado
  console.log(`\n📁 ${path.relative(ROOT, outDir)}/`);
  console.log("   Próximo: revisa cada -strategy.md, decide o que adaptar pra Longevify.");
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
