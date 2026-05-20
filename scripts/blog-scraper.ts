/**
 * blog-scraper.ts — scraper genérico de blogs dos big 3.
 *
 * Suporta:
 *   - Mito Health (mitohealth.com/blog) — discovery via paginação HTML
 *   - Superpower (superpower.com/blog) — discovery via index HTML
 *   - Function Health (functionhealth.com) — discovery via sitemap.xml /article/*
 *
 * Output: output/blogs/{brand}-articles.json + .md
 *
 * Custo: zero (HTTP simples)
 *
 * Uso:
 *   npm run blog-scraper -- --brand=superpower
 *   npm run blog-scraper -- --brand=function
 *   npm run blog-scraper -- --brand=mito
 *   npm run blog-scraper -- --all
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const OUT_DIR = path.join(ROOT, "output", "blogs");
fs.mkdirSync(OUT_DIR, { recursive: true });

const REQUEST_DELAY_MS = 600;

interface BrandConfig {
  slug: string;
  brandName: string;
  baseUrl: string;
  // Discovery: ou via sitemap (pega URLs filtradas) ou via paginação HTML
  discovery:
    | { type: "sitemap"; sitemapUrl: string; articleRegex: RegExp }
    | { type: "html-pagination"; pages: string[]; articleHrefRegex: RegExp; resolveHref: (href: string) => string };
  igBrandKey: string; // pra cross-reference com raw-posts.json
}

const BRANDS: Record<string, BrandConfig> = {
  mito: {
    slug: "mito",
    brandName: "Mito Health",
    baseUrl: "https://mitohealth.com",
    discovery: {
      type: "html-pagination",
      pages: ["/blog", "/blog?page=2", "/blog?page=3", "/blog?page=4", "/blog?page=5"],
      articleHrefRegex: /href=["'](\/blog\/[a-z0-9-]+)["']/g,
      resolveHref: (h: string) => `https://mitohealth.com${h}`,
    },
    igBrandKey: "Mito Health",
  },
  superpower: {
    slug: "superpower",
    brandName: "Superpower",
    baseUrl: "https://superpower.com",
    discovery: {
      type: "html-pagination",
      pages: ["/blog", "/blog?page=2", "/blog?page=3"],
      articleHrefRegex: /href=["'](\/blog\/[a-z0-9-]+)["']/g,
      resolveHref: (h: string) => `https://superpower.com${h}`,
    },
    igBrandKey: "Superpower",
  },
  function: {
    slug: "function",
    brandName: "Function Health",
    baseUrl: "https://www.functionhealth.com",
    discovery: {
      type: "sitemap",
      sitemapUrl: "https://www.functionhealth.com/sitemap.xml",
      articleRegex: /<loc>(https:\/\/www\.functionhealth\.com\/article\/[^<]+)<\/loc>/g,
    },
    igBrandKey: "Function Health",
  },
};

const args = process.argv.slice(2);
const brandArg = args.find((a) => a.startsWith("--brand="))?.split("=")[1];
const all = args.includes("--all");

interface Article {
  url: string;
  slug: string;
  title: string;
  date: string | null;
  description: string | null;
  bodyText: string;
  externalLinks: string[];
  internalLinks: string[];
  authorName: string | null;
  wordCount: number;
  matchedIgPost?: { url: string; vsMedian: number; caption: string };
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// ─── HTML helpers (sem libs externas) ────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—").replace(/&ndash;/g, "–")
    .replace(/&rsquo;/g, "'").replace(/&lsquo;/g, "'")
    .replace(/&ldquo;/g, '"').replace(/&rdquo;/g, '"')
    .replace(/&#x27;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripTags(html: string): string {
  return decodeEntities(html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ").trim());
}

function extractMeta(html: string, name: string): string | null {
  const re = new RegExp(`<meta\\s+(?:property|name)=["']${name}["']\\s+content=["']([^"']+)["']`, "i");
  const m = html.match(re);
  return m ? decodeEntities(m[1]) : null;
}

function extractTitle(html: string): string {
  return extractMeta(html, "og:title")
    ?? (html.match(/<title>([^<]+)<\/title>/i)?.[1]
      ? decodeEntities(html.match(/<title>([^<]+)<\/title>/i)![1]).replace(/\s*[\|\-—]\s*[A-Z][A-Za-z\s]+$/, "").trim()
      : "—");
}

function extractDate(html: string): string | null {
  return extractMeta(html, "article:published_time")
    ?? extractMeta(html, "datePublished")
    ?? html.match(/<time[^>]*datetime=["']([^"']+)/i)?.[1]
    ?? null;
}

function extractAuthor(html: string): string | null {
  return extractMeta(html, "author") ?? extractMeta(html, "article:author");
}

function extractBody(html: string): string {
  const articleM = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleM) return stripTags(articleM[1]);
  const mainM = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (mainM) return stripTags(mainM[1]);
  return stripTags(html);
}

function extractLinks(html: string, baseUrl: string): { internal: string[]; external: string[] } {
  const internal: string[] = [];
  const external: string[] = [];
  const baseHost = new URL(baseUrl).hostname;
  for (const m of html.matchAll(/href=["']([^"']+)["']/g)) {
    const u = m[1];
    if (u.startsWith("#") || u.startsWith("mailto:") || u.startsWith("tel:") || u.startsWith("javascript:")) continue;
    let resolved: string;
    if (u.startsWith("/")) resolved = baseUrl + u;
    else if (u.startsWith("http")) resolved = u;
    else continue;
    try {
      const host = new URL(resolved).hostname;
      if (host === baseHost) {
        if (!internal.includes(resolved)) internal.push(resolved);
      } else {
        if (!external.includes(resolved)) external.push(resolved);
      }
    } catch { /* skip malformed */ }
  }
  return { internal, external };
}

// ─── Discovery ───────────────────────────────────────────────────────────────

async function discoverArticles(cfg: BrandConfig): Promise<string[]> {
  const found = new Set<string>();
  if (cfg.discovery.type === "sitemap") {
    try {
      const res = await fetch(cfg.discovery.sitemapUrl);
      if (!res.ok) return [];
      const xml = await res.text();
      for (const m of xml.matchAll(cfg.discovery.articleRegex)) {
        found.add(m[1]);
      }
    } catch { /* ignore */ }
  } else {
    for (const path of cfg.discovery.pages) {
      try {
        const res = await fetch(cfg.baseUrl + path);
        if (!res.ok) continue;
        const html = await res.text();
        for (const m of html.matchAll(cfg.discovery.articleHrefRegex)) {
          const slug = m[1];
          if (/\/(page|category|tag|author)\//.test(slug)) continue;
          if (slug === "/blog" || slug === "/articles") continue;
          found.add(cfg.discovery.resolveHref(slug));
        }
        await sleep(REQUEST_DELAY_MS);
      } catch { /* ignore */ }
    }
  }
  return [...found].sort();
}

// ─── Fetch artigo ────────────────────────────────────────────────────────────

async function fetchArticle(url: string, cfg: BrandConfig): Promise<Article | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const html = await res.text();
    const slug = url.split("/").pop()?.split("?")[0] ?? "";
    const body = extractBody(html);
    const links = extractLinks(html, cfg.baseUrl);
    return {
      url, slug,
      title: extractTitle(html),
      date: extractDate(html),
      description: extractMeta(html, "og:description") ?? extractMeta(html, "description"),
      bodyText: body.slice(0, 8000),
      externalLinks: links.external.slice(0, 20),
      internalLinks: links.internal.slice(0, 30),
      authorName: extractAuthor(html),
      wordCount: body.split(/\s+/).filter(Boolean).length,
    };
  } catch {
    return null;
  }
}

// ─── Cross-reference com IG raw-posts ────────────────────────────────────────

interface RawPost {
  brand: string;
  url?: string;
  shortCode?: string;
  caption?: string;
  vsMedian?: number;
}

function findLatestAnalysisDir(): string {
  const dirs = fs.readdirSync(path.join(ROOT, "output")).filter((n) => n.startsWith("analysis-")).sort();
  return path.join(ROOT, "output", dirs[dirs.length - 1]);
}

function crossReference(articles: Article[], brandKey: string): void {
  let posts: RawPost[] = [];
  try {
    const dir = findLatestAnalysisDir();
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "raw-posts.json"), "utf-8")) as RawPost[];
    posts = raw.filter((p) => p.brand === brandKey);
  } catch { return; }

  for (const a of articles) {
    // Match: caption contém slug ou URL do artigo
    const match = posts.find((p) => {
      const cap = (p.caption ?? "").toLowerCase();
      return cap.includes(a.url) || cap.includes(`/${a.slug}`);
    });
    if (match) {
      a.matchedIgPost = {
        url: match.url ?? `https://instagram.com/p/${match.shortCode}`,
        vsMedian: match.vsMedian ?? 0,
        caption: (match.caption ?? "").slice(0, 200),
      };
    }
  }
}

// ─── Markdown ────────────────────────────────────────────────────────────────

function buildMd(brandName: string, articles: Article[]): string {
  const matched = articles.filter((a) => a.matchedIgPost).length;
  const totalWords = articles.reduce((s, a) => s + a.wordCount, 0);
  const L: string[] = [];
  L.push(`# ${brandName} — biblioteca de longform`);
  L.push("");
  L.push(`> ${articles.length} artigos · ${(totalWords / 1000).toFixed(1)}k palavras · ${matched} com IG repackage · ${new Date().toLocaleString("pt-BR")}`);
  L.push("");

  const sorted = [...articles].sort((a, b) => b.wordCount - a.wordCount);
  for (const a of sorted) {
    L.push(`## ${a.title}`);
    L.push("");
    L.push(`- **Slug:** \`${a.slug}\` · **Palavras:** ${a.wordCount} · **Data:** ${a.date?.slice(0, 10) ?? "—"}`);
    L.push(`- **URL:** ${a.url}`);
    if (a.matchedIgPost) L.push(`- **IG repackage:** ${a.matchedIgPost.url} (${a.matchedIgPost.vsMedian.toFixed(2)}x)`);
    if (a.description) L.push(`- **Descrição:** ${a.description}`);
    if (a.externalLinks.length) {
      L.push(`- **External links (${a.externalLinks.length}):**`);
      for (const l of a.externalLinks.slice(0, 5)) L.push(`  - ${l}`);
    }
    L.push("");
    L.push(`> ${a.bodyText.slice(0, 400)}…`);
    L.push("");
  }
  return L.join("\n");
}

// ─── Main por marca ──────────────────────────────────────────────────────────

async function scrapeOneBrand(cfg: BrandConfig): Promise<void> {
  console.log(`\n📝 ${cfg.brandName} blog scraper`);
  const urls = await discoverArticles(cfg);
  console.log(`   ${urls.length} URLs descobertos`);

  const articles: Article[] = [];
  for (let i = 0; i < urls.length; i++) {
    const u = urls[i];
    process.stdout.write(`  [${i + 1}/${urls.length}] ${u.split("/").pop()?.slice(0, 50)}... `);
    const a = await fetchArticle(u, cfg);
    if (a) {
      articles.push(a);
      process.stdout.write(`✅ ${a.wordCount}p\n`);
    } else {
      process.stdout.write(`❌\n`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  crossReference(articles, cfg.igBrandKey);
  const matched = articles.filter((a) => a.matchedIgPost).length;
  console.log(`  🔗 ${matched}/${articles.length} cross-referenced com IG`);

  const jsonPath = path.join(OUT_DIR, `${cfg.slug}-articles.json`);
  const mdPath = path.join(OUT_DIR, `${cfg.slug}-articles.md`);
  fs.writeFileSync(jsonPath, JSON.stringify({
    brand: cfg.brandName, slug: cfg.slug,
    generatedAt: new Date().toISOString(),
    total: articles.length, matched,
    articles,
  }, null, 2));
  fs.writeFileSync(mdPath, buildMd(cfg.brandName, articles));

  console.log(`  ✅ ${path.basename(jsonPath)} (${(fs.statSync(jsonPath).size / 1024).toFixed(0)}KB)`);
}

async function main() {
  if (all) {
    for (const slug of Object.keys(BRANDS)) {
      await scrapeOneBrand(BRANDS[slug]);
    }
  } else if (brandArg && BRANDS[brandArg]) {
    await scrapeOneBrand(BRANDS[brandArg]);
  } else {
    throw new Error(`Passe --brand=mito|superpower|function ou --all`);
  }
}

main().catch((err) => {
  console.error("\n❌", err.message);
  process.exit(1);
});
