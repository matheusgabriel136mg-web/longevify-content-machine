/**
 * analyze-tiktoks.ts — Análise de competidores TikTok (BR + benchmark US)
 *
 * Espelha analyze-instagrams.ts mas pra TikTok via Apify clockworks/tiktok-scraper.
 *
 * O que faz:
 *   1. Scrape N posts/conta via Apify (clockworks~tiktok-scraper)
 *   2. Calcula engagement vs. mediana DA PRÓPRIA conta → ranqueia virais
 *   3. Salva raw-posts.json (shape compatível com server.ts /api/feed)
 *      + top-virals.json + top-virals.md
 *   4. (Skip Claude analysis no primeiro release — adiciona depois)
 *
 * Output dir: output/tiktok-analysis-<timestamp>/
 *   → server.ts faz merge com analysis-* (Instagram) no /api/feed
 *
 * Custo: ~$0.30-0.50 por scrape (200 posts × 16 contas × $0.10/1000)
 * Tempo: 5-12 min (Apify gargalo)
 *
 * Uso: npm run analyze-tiktoks
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PARENT = path.dirname(__dirname);

// ─── Targets ──────────────────────────────────────────────────────────────────
//
// Mix BR (60%) + US benchmark (40%). BR é onde a gente vai ganhar — US é referência
// estética/copy. Handles SEM @ na frente.

const TIKTOK_TARGETS = [
  // ── Tier 1 BR — médicos/nutris longevidade com tração ────────────
  { name: "Dr Flavio Cadegiani", handle: "drflaviocadegiani", tier: 1, geo: "BR" },
  { name: "Dr Rocha Nutri", handle: "drrochanutri", tier: 1, geo: "BR" },
  { name: "Dr Guilherme Reinaldo", handle: "dr.guilhermereinaldo", tier: 1, geo: "BR" },
  { name: "Dr Juliano Pimentel", handle: "drjulianopimentel", tier: 1, geo: "BR" },
  { name: "Dr Pedro Pinheiro", handle: "drpedropinheiro", tier: 1, geo: "BR" },
  // ── Tier 1 BR — wellness/biohackers ──────────────────────────────
  { name: "Caio Bottura", handle: "caiobottura", tier: 1, geo: "BR" },
  { name: "Renato Cariani", handle: "renatocariani", tier: 1, geo: "BR" },
  // ── Tier 2 US — benchmarks de copy/format ────────────────────────
  { name: "Bryan Johnson", handle: "bryanjohnson_", tier: 2, geo: "US" },
  { name: "Huberman Lab clips", handle: "hubermanlabclips", tier: 2, geo: "US" },
  { name: "Peter Attia clips", handle: "peterattiamdclips", tier: 2, geo: "US" },
  { name: "Mark Hyman", handle: "drmarkhyman", tier: 2, geo: "US" },
  { name: "Function Health", handle: "function", tier: 2, geo: "US" },
  { name: "Superpower", handle: "joinsuperpower", tier: 2, geo: "US" },
  // ── Tier 2 — content creators de saúde com algoritmo dominado ────
  { name: "Gary Brecka", handle: "garybrecka", tier: 2, geo: "US" },
  { name: "Dr Mindy Pelz", handle: "drmindypelz", tier: 2, geo: "US" },
  { name: "Dr Eric Berg", handle: "drericberg", tier: 2, geo: "US" },
];

// Dry-run via env: TIKTOK_LIMIT=3 (só primeiras 3 contas) + TIKTOK_POSTS_PER=20 (só 20 posts cada)
const POSTS_PER_ACCOUNT = parseInt(process.env.TIKTOK_POSTS_PER ?? "100", 10);
const ACCOUNT_LIMIT = parseInt(process.env.TIKTOK_LIMIT ?? "0", 10) || TIKTOK_TARGETS.length;
const VIRAL_THRESHOLD = 2.0;   // TikTok tem long-tail mais agressivo que IG → threshold maior
const APIFY_POLL_MS = 6_000;
const APIFY_TIMEOUT_MS = 12 * 60_000;

const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
const OUTPUT_DIR = path.join(PARENT, "output", `tiktok-analysis-${TIMESTAMP}`);

// ─── Apify ────────────────────────────────────────────────────────────────────

interface ApifyTikTokPost {
  id?: string;
  webVideoUrl?: string;
  text?: string;             // caption
  createTimeISO?: string;
  authorMeta?: { name?: string; nickName?: string; fans?: number };
  musicMeta?: { musicName?: string; musicAuthor?: string };
  videoMeta?: { duration?: number; coverUrl?: string; downloadAddr?: string };
  hashtags?: Array<{ name: string }>;
  diggCount?: number;        // likes
  shareCount?: number;
  playCount?: number;        // views
  commentCount?: number;
  collectCount?: number;     // saves
  videoUrl?: string;
  // Apify às vezes retorna campos top-level:
  authorUsername?: string;
  username?: string;
}

async function apifyFetch(endpoint: string, options?: RequestInit): Promise<unknown> {
  const sep = endpoint.includes("?") ? "&" : "?";
  const url = `https://api.apify.com/v2${endpoint}${sep}token=${process.env.APIFY_API_TOKEN}`;
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`Apify ${res.status}: ${await res.text()}`);
  return res.json();
}

async function scrapeAll(): Promise<ApifyTikTokPost[]> {
  const targets = TIKTOK_TARGETS.slice(0, ACCOUNT_LIMIT);
  const profiles = targets.map((t) => t.handle);
  log("🎵", `Scraping ${targets.length} contas TikTok (${POSTS_PER_ACCOUNT} posts cada)...`);
  targets.forEach((t) => log("  →", `@${t.handle} (${t.name}, ${t.geo})`));

  const run = (await apifyFetch("/acts/clockworks~tiktok-scraper/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profiles,
      resultsPerPage: POSTS_PER_ACCOUNT,
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
      shouldDownloadSubtitles: false,
      shouldDownloadSlideshowImages: false,
      proxyConfiguration: { useApifyProxy: true },
    }),
  })) as { data: { id: string; defaultDatasetId: string } };

  const runId = run.data.id;
  log("  ⏳", `Apify run: ${runId}`);

  const deadline = Date.now() + APIFY_TIMEOUT_MS;
  let status = "RUNNING";
  while (["RUNNING", "READY"].includes(status)) {
    if (Date.now() > deadline) throw new Error("Apify timeout (12 min)");
    await sleep(APIFY_POLL_MS);
    const poll = (await apifyFetch(`/actor-runs/${runId}`)) as { data: { status: string } };
    status = poll.data.status;
    process.stdout.write(`\r  ⏳ Status: ${status}        `);
  }
  process.stdout.write("\n");

  if (status !== "SUCCEEDED") throw new Error(`Apify terminou com: ${status}`);

  const items = (await apifyFetch(
    `/datasets/${run.data.defaultDatasetId}/items?clean=true&format=json`
  )) as ApifyTikTokPost[];

  log("  ✅", `${items.length} posts coletados`);
  return items;
}

// ─── Ranking ──────────────────────────────────────────────────────────────────

interface RankedTikTok {
  // Campos compatíveis com server.ts /api/feed (Instagram shape) ──
  id: string;
  shortCode: string;        // alias: ID do video
  url: string;
  ownerUsername: string;
  caption: string;
  likesCount: number;
  commentsCount: number;
  timestamp: string;
  displayUrl: string | null;
  images: string[];
  type: string;             // sempre "Video"
  productType: string;      // sempre "clips"
  brand: string;
  vsMedian: number;
  isViral: boolean;
  format: "reel";           // TikTok = sempre video → mapeia pra "reel" no nosso domain

  // Campos TikTok-específicos ──
  platform: "tiktok";
  playCount: number;
  shareCount: number;
  saves: number;
  duration: number;
  musicName: string;
  hashtags: string[];
  geo: "BR" | "US";
  brandMedian: number;
  engagementScore: number;
}

function computeScore(p: ApifyTikTokPost): number {
  // TikTok scoring: likes + 5×comments + 3×shares + 2×saves
  // Views são divisor (vs_median normaliza) — não soma direto pra não dominar
  const likes = p.diggCount ?? 0;
  const comments = p.commentCount ?? 0;
  const shares = p.shareCount ?? 0;
  const saves = p.collectCount ?? 0;
  return likes + 5 * comments + 3 * shares + 2 * saves;
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function rankPosts(posts: ApifyTikTokPost[]): RankedTikTok[] {
  const handleToTarget = new Map(TIKTOK_TARGETS.map((t) => [t.handle.toLowerCase(), t]));

  // Enriquece com brand + score
  const enriched = posts.map((p) => {
    const handle = (p.authorMeta?.name ?? p.authorUsername ?? p.username ?? "").toLowerCase();
    const target = handleToTarget.get(handle);
    return {
      ...p,
      _handle: handle,
      _brand: target?.name ?? handle,
      _geo: (target?.geo ?? "US") as "BR" | "US",
      _score: computeScore(p),
    };
  });

  // Mediana por marca
  const medianByBrand = new Map<string, number>();
  for (const t of TIKTOK_TARGETS) {
    const scores = enriched.filter((p) => p._brand === t.name).map((p) => p._score);
    medianByBrand.set(t.name, median(scores));
  }

  // Monta shape final
  return enriched
    .map((p) => {
      const m = medianByBrand.get(p._brand) ?? 0;
      const vsMedian = m > 0 ? p._score / m : 0;
      const videoId = p.id ?? p.webVideoUrl?.split("/").pop() ?? "";
      const url = p.webVideoUrl ?? `https://www.tiktok.com/@${p._handle}/video/${videoId}`;
      return {
        id: `tt-${videoId}`,
        shortCode: videoId,
        url,
        ownerUsername: p._handle,
        caption: p.text ?? "",
        likesCount: p.diggCount ?? 0,
        commentsCount: p.commentCount ?? 0,
        timestamp: p.createTimeISO ?? "",
        displayUrl: p.videoMeta?.coverUrl ?? null,
        images: p.videoMeta?.coverUrl ? [p.videoMeta.coverUrl] : [],
        type: "Video",
        productType: "clips",
        brand: p._brand,
        vsMedian,
        isViral: vsMedian >= VIRAL_THRESHOLD,
        format: "reel" as const,
        platform: "tiktok" as const,
        playCount: p.playCount ?? 0,
        shareCount: p.shareCount ?? 0,
        saves: p.collectCount ?? 0,
        duration: p.videoMeta?.duration ?? 0,
        musicName: p.musicMeta?.musicName ?? "",
        hashtags: (p.hashtags ?? []).map((h) => h.name).filter(Boolean),
        geo: p._geo,
        brandMedian: m,
        engagementScore: p._score,
      };
    })
    .sort((a, b) => b.vsMedian - a.vsMedian);
}

// ─── Markdown ─────────────────────────────────────────────────────────────────

function compactNumber(n: number | undefined | null): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function topViralsMarkdown(virals: RankedTikTok[]): string {
  const lines: string[] = [];
  lines.push("# Top virais TikTok — análise cruzada");
  lines.push("");
  lines.push(`> ${virals.length} TikToks viralizaram (≥${VIRAL_THRESHOLD}x da mediana da própria conta).`);
  lines.push("");

  // Por geo primeiro
  for (const geo of ["BR", "US"] as const) {
    const geoVirals = virals.filter((v) => v.geo === geo);
    if (!geoVirals.length) continue;
    lines.push(`## 🌎 ${geo} — ${geoVirals.length} virais`);
    lines.push("");

    // Agrupado por brand
    const byBrand = new Map<string, RankedTikTok[]>();
    for (const v of geoVirals) {
      if (!byBrand.has(v.brand)) byBrand.set(v.brand, []);
      byBrand.get(v.brand)!.push(v);
    }

    for (const [brand, list] of byBrand) {
      lines.push(`### ${brand} — ${list.length} virais`);
      lines.push("");
      lines.push("| vs.med | Views | Likes | Coments | Shares | Hook | Link |");
      lines.push("|-------:|------:|------:|--------:|-------:|------|------|");
      for (const v of list.slice(0, 10)) {
        const hook = (v.caption || "").split("\n")[0].slice(0, 70).replace(/\|/g, "\\|");
        lines.push(
          `| ${v.vsMedian.toFixed(2)}x | ${compactNumber(v.playCount)} | ${compactNumber(v.likesCount)} | ${compactNumber(v.commentsCount)} | ${compactNumber(v.shareCount)} | ${hook} | [↗](${v.url}) |`
        );
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function save(filename: string, content: string): void {
  fs.writeFileSync(path.join(OUTPUT_DIR, filename), content, "utf-8");
  log("  💾", `output/tiktok-analysis-${TIMESTAMP}/${filename}`);
}

function log(icon: string, msg: string): void {
  console.log(`${icon} ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n🎵 Análise dos TikToks competidores — Longevify");
  console.log(`📅 ${new Date().toLocaleString("pt-BR")}`);
  console.log("─".repeat(60));

  if (!process.env.APIFY_API_TOKEN) throw new Error("APIFY_API_TOKEN não setado no .env");

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // ── 1. Scrape ──────────────────────────────────────────────────────────────
  const rawPosts = await scrapeAll();
  if (!rawPosts.length) throw new Error("Nenhum post coletado — confere os handles TikTok");

  // ── 2. Rank ────────────────────────────────────────────────────────────────
  log("\n🏷 ", "Calculando engagement vs. mediana de cada conta...");
  const ranked = rankPosts(rawPosts);
  const virals = ranked.filter((p) => p.isViral);

  for (const t of TIKTOK_TARGETS) {
    const brandPosts = ranked.filter((p) => p.brand === t.name);
    const brandVirals = brandPosts.filter((p) => p.isViral);
    log("  📈", `${t.name}: ${brandPosts.length} posts, ${brandVirals.length} virais (mediana=${Math.round(brandPosts[0]?.brandMedian ?? 0)})`);
  }

  // ── 3. Save ────────────────────────────────────────────────────────────────
  log("\n💾", "Salvando outputs...");
  save("raw-posts.json", JSON.stringify(ranked, null, 2));
  save("top-virals.json", JSON.stringify(virals, null, 2));
  save("top-virals.md", topViralsMarkdown(virals));

  // ── Resumo ─────────────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(60));
  console.log("✅ Análise TikTok completa!");
  console.log(`\n📁 ${OUTPUT_DIR}/`);
  console.log(`   ${ranked.length} posts coletados · ${virals.length} virais (≥${VIRAL_THRESHOLD}x)`);
  console.log("   raw-posts.json   ← shape compatível com dashboard");
  console.log("   top-virals.json  ← só os virais");
  console.log("   top-virals.md    ← tabela legível (BR + US split)");
  console.log("\n💡 Restart o dashboard pra ver os TikToks no feed:");
  console.log("   curl http://localhost:8088/api/feed (filtra brand=🎵 ou geo=BR)");
  console.log();
}

main().catch((err) => {
  console.error("\n❌ Falhou:", err.message);
  process.exit(1);
});
