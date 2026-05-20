/**
 * rescrape-superpower.ts — re-scrape só da Superpower com limite alto
 *
 * Objetivo: Apify originalmente trouxe 75 posts. Conta tem ~96 visíveis.
 * Roda scrape isolado com resultsLimit=120, normaliza pro mesmo formato do
 * raw-posts.json existente, e SUBSTITUI as entradas de Superpower nele.
 *
 * Uso: npm run -- rescrape-superpower output/analysis-2026-05-08T13-19
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PARENT = path.dirname(__dirname);

const HANDLE = "superpower";
const BRAND_NAME = "Superpower";
const RESULTS_LIMIT = 120;
const VIRAL_THRESHOLD = 1.5;
const APIFY_POLL_MS = 6_000;
const APIFY_TIMEOUT_MS = 10 * 60_000;

const argDir = process.argv[2];
if (!argDir) throw new Error("Passe a pasta da análise: npm run -- rescrape-superpower output/analysis-...");
const ANALYSIS_DIR = path.resolve(argDir);
const RAW_PATH = path.join(ANALYSIS_DIR, "raw-posts.json");
if (!fs.existsSync(RAW_PATH)) throw new Error(`Não achei ${RAW_PATH}`);

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

interface ApifyPost {
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
  childPosts?: Array<{ displayUrl?: string }>;
  hashtags?: string[];
}

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

function score(p: ApifyPost): number {
  return (p.likesCount ?? 0) + 5 * (p.commentsCount ?? 0);
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function scrape(): Promise<ApifyPost[]> {
  console.log(`📸 Scrape @${HANDLE} com resultsLimit=${RESULTS_LIMIT}`);
  const run = (await apifyFetch("/acts/apify~instagram-scraper/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      directUrls: [`https://www.instagram.com/${HANDLE}/`],
      resultsType: "posts",
      resultsLimit: RESULTS_LIMIT,
      addParentData: false,
      scrapeStories: false,
    }),
  })) as { data: { id: string; defaultDatasetId: string } };

  const runId = run.data.id;
  console.log(`  ⏳ Run: ${runId}`);

  const deadline = Date.now() + APIFY_TIMEOUT_MS;
  let status = "RUNNING";
  while (["RUNNING", "READY"].includes(status)) {
    if (Date.now() > deadline) throw new Error("Apify timeout");
    await sleep(APIFY_POLL_MS);
    const poll = (await apifyFetch(`/actor-runs/${runId}`)) as { data: { status: string } };
    status = poll.data.status;
    process.stdout.write(`\r  ⏳ Status: ${status}        `);
  }
  process.stdout.write("\n");
  if (status !== "SUCCEEDED") throw new Error(`Apify ${status}`);

  const items = (await apifyFetch(
    `/datasets/${run.data.defaultDatasetId}/items?clean=true&format=json`
  )) as ApifyPost[];
  console.log(`  ✅ ${items.length} posts coletados`);
  return items;
}

function rank(posts: ApifyPost[]): RankedPost[] {
  const enriched = posts.map((p) => ({
    ...p,
    brand: BRAND_NAME,
    format: detectFormat(p),
    engagementScore: score(p),
  }));
  const m = median(enriched.map((p) => p.engagementScore));
  return enriched
    .map((p) => {
      const vs = m > 0 ? p.engagementScore / m : 0;
      return {
        ...p,
        brandMedian: m,
        vsMedian: vs,
        isViral: vs >= VIRAL_THRESHOLD,
      } as RankedPost;
    })
    .sort((a, b) => b.vsMedian - a.vsMedian);
}

async function main() {
  if (!process.env.APIFY_API_TOKEN) throw new Error("APIFY_API_TOKEN ausente");

  const raw = JSON.parse(fs.readFileSync(RAW_PATH, "utf-8")) as RankedPost[];
  const others = raw.filter((p) => p.brand !== BRAND_NAME);
  const oldSP = raw.filter((p) => p.brand === BRAND_NAME);
  console.log(`📊 raw-posts.json atual: ${raw.length} (${oldSP.length} Superpower, ${others.length} outras)`);

  const fresh = await scrape();
  const ranked = rank(fresh);
  console.log(`📊 Após rank: ${ranked.length} Superpower (mediana=${Math.round(ranked[0]?.brandMedian ?? 0)})`);

  // backup
  const backup = `${RAW_PATH}.bak-${Date.now()}`;
  fs.writeFileSync(backup, JSON.stringify(raw, null, 2));
  console.log(`💾 Backup: ${path.basename(backup)}`);

  const merged = [...others, ...ranked];
  fs.writeFileSync(RAW_PATH, JSON.stringify(merged, null, 2));
  console.log(`✅ raw-posts.json atualizado: ${merged.length} posts (${ranked.length} Superpower + ${others.length} outras)`);
}

main().catch((err) => {
  console.error("\n❌", err.message);
  process.exit(1);
});
