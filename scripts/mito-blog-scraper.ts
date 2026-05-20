/**
 * mito-blog-scraper.ts — minera todo o blog de mitohealth.com.
 *
 * Por que: Mito tem ~50+ artigos longform (CGM, dawn phenomenon, T3/T4, ApoB,
 * magnésio glicinato vs threonate, candida, anemia etc). Eles repackage cada
 * um em carrossel IG. Isso = library de tópicos validados pra Longevify
 * adaptar e escrever em PT-BR.
 *
 * O que faz:
 *   1. Scrape mitohealth.com/blog (página índice + paginação se houver)
 *   2. Pra cada artigo: título, data, body text, links externos citados
 *   3. Cross-reference: quais viraram IG post (compara slugs com captions Mito)
 *   4. Salva: output/mito-blog/articles.json + articles.md
 *
 * Custo: zero (HTTP simples, sem LLM)
 * Tempo: ~3-5 min
 *
 * Uso: npm run mito-blog
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const OUT_DIR = path.join(ROOT, "output", "mito-blog");
fs.mkdirSync(OUT_DIR, { recursive: true });

const BASE = "https://mitohealth.com";
const REQUEST_DELAY_MS = 600;

interface Article {
  url: string;
  slug: string;
  title: string;
  date: string | null;
  description: string | null;
  bodyText: string;
  externalLinks: string[];
  internalLinks: string[];
  categories: string[];
  authorName: string | null;
  wordCount: number;
  matchedIgPost?: { url: string; vsMedian: number; caption: string };
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// ─── HTML helpers (sem libs) ─────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function extractMeta(html: string, name: string): string | null {
  const re = new RegExp(`<meta\\s+(?:property|name)=["']${name}["']\\s+content=["']([^"']+)["']`, "i");
  const m = html.match(re);
  return m ? decodeEntities(m[1]) : null;
}

function extractTitle(html: string): string {
  const og = extractMeta(html, "og:title");
  if (og) return og;
  const t = html.match(/<title>([^<]+)<\/title>/i);
  if (t) return decodeEntities(t[1]).replace(/\s*[\|\-—]\s*Mito.*$/, "").trim();
  return "—";
}

function extractDate(html: string): string | null {
  // Tenta meta, depois <time>, depois texto "Published"
  const meta = extractMeta(html, "article:published_time")
    ?? extractMeta(html, "og:article:published_time")
    ?? extractMeta(html, "datePublished");
  if (meta) return meta;
  const tm = html.match(/<time[^>]*datetime=["']([^"']+)/i);
  if (tm) return tm[1];
  const pub = html.match(/Published[:\s]+([A-Z][a-z]+ \d{1,2},?\s+\d{4})/i);
  if (pub) return pub[1];
  return null;
}

function extractCategories(html: string): string[] {
  // Mito usa tags ou categories — heurística: links pra /blog/category/* ou tag/*
  const cats = [...html.matchAll(/href=["'][^"']*\/(?:category|tag)\/([^"'\/]+)/gi)].map((m) => m[1]);
  return [...new Set(cats)];
}

function extractAuthor(html: string): string | null {
  return extractMeta(html, "author") ?? extractMeta(html, "article:author");
}

function extractArticleBody(html: string): string {
  // Tenta extrair conteúdo do <article>, depois fallback genérico
  const articleM = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleM) return stripTags(articleM[1]);
  const mainM = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (mainM) return stripTags(mainM[1]);
  return stripTags(html);
}

function extractLinks(html: string, baseUrl: string): { internal: string[]; external: string[] } {
  const internal: string[] = [];
  const external: string[] = [];
  for (const m of html.matchAll(/href=["']([^"']+)["']/g)) {
    const u = m[1];
    if (u.startsWith("#") || u.startsWith("mailto:") || u.startsWith("tel:")) continue;
    let resolved: string;
    if (u.startsWith("/")) resolved = baseUrl + u;
    else if (u.startsWith("http")) resolved = u;
    else continue;
    if (resolved.includes("mitohealth.com")) {
      if (resolved.includes("/blog/") && !internal.includes(resolved)) internal.push(resolved);
    } else {
      if (!external.includes(resolved)) external.push(resolved);
    }
  }
  return { internal, external };
}

// ─── Discovery: lista de artigos ────────────────────────────────────────────

async function discoverArticles(): Promise<string[]> {
  const found = new Set<string>();
  // Página principal do blog
  for (const path of ["/blog", "/blog?page=2", "/blog?page=3", "/blog?page=4", "/blog?page=5"]) {
    try {
      const res = await fetch(BASE + path);
      if (!res.ok) continue;
      const html = await res.text();
      for (const m of html.matchAll(/href=["'](\/blog\/[a-z0-9-]+)["']/g)) {
        const slug = m[1];
        // Exclui paginação e categorias
        if (/\/blog\/(page|category|tag|author)\//.test(slug)) continue;
        if (slug === "/blog") continue;
        found.add(BASE + slug);
      }
      await sleep(REQUEST_DELAY_MS);
    } catch {
      // ignora
    }
  }
  return [...found].sort();
}

// ─── Fetch artigo ────────────────────────────────────────────────────────────

async function fetchArticle(url: string): Promise<Article | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const html = await res.text();
    const slug = url.replace(BASE + "/blog/", "").replace(/\/$/, "");

    const title = extractTitle(html);
    const date = extractDate(html);
    const description = extractMeta(html, "og:description") ?? extractMeta(html, "description");
    const body = extractArticleBody(html);
    const categories = extractCategories(html);
    const author = extractAuthor(html);
    const links = extractLinks(html, BASE);

    return {
      url, slug, title, date,
      description,
      bodyText: body.slice(0, 8000), // limita a 8KB por artigo
      externalLinks: links.external.slice(0, 20),
      internalLinks: links.internal.slice(0, 30),
      categories,
      authorName: author,
      wordCount: body.split(/\s+/).filter(Boolean).length,
    };
  } catch {
    return null;
  }
}

// ─── Cross-reference com IG posts ───────────────────────────────────────────

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

function crossReferenceWithIg(articles: Article[]): void {
  let mitoPosts: RawPost[] = [];
  try {
    const dir = findLatestAnalysisDir();
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "raw-posts.json"), "utf-8")) as RawPost[];
    mitoPosts = raw.filter((p) => p.brand === "Mito Health");
  } catch {
    return;
  }

  for (const a of articles) {
    // Tenta achar IG post que linka pra esse artigo
    const igMatch = mitoPosts.find((p) => (p.caption ?? "").includes(`/blog/${a.slug}`));
    if (igMatch) {
      a.matchedIgPost = {
        url: igMatch.url ?? `https://instagram.com/p/${igMatch.shortCode}`,
        vsMedian: igMatch.vsMedian ?? 0,
        caption: (igMatch.caption ?? "").slice(0, 200),
      };
    }
  }
}

// ─── Markdown ────────────────────────────────────────────────────────────────

function buildMarkdown(articles: Article[]): string {
  const L: string[] = [];
  L.push(`# Mito Health Blog — biblioteca de longform`);
  L.push("");
  L.push(`> ${articles.length} artigos scraped · ${new Date().toLocaleString("pt-BR")}`);
  L.push("");

  // Stats
  const matched = articles.filter((a) => a.matchedIgPost).length;
  const totalWords = articles.reduce((s, a) => s + a.wordCount, 0);
  const avgWords = articles.length ? Math.round(totalWords / articles.length) : 0;
  L.push(`- **${articles.length}** artigos`);
  L.push(`- **${matched}** com IG post linkado encontrado (${((matched / articles.length) * 100).toFixed(0)}%)`);
  L.push(`- Média de **${avgWords}** palavras/artigo · total ${(totalWords / 1000).toFixed(1)}k palavras`);
  L.push("");

  // Top temas (sample do título)
  L.push(`## Lista completa (ordenada por data, mais recentes primeiro)`);
  L.push("");
  const sorted = [...articles].sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return db - da;
  });

  for (const a of sorted) {
    const dateStr = a.date ? a.date.slice(0, 10) : "—";
    L.push(`### ${a.title}`);
    L.push("");
    L.push(`- **Data:** ${dateStr} · **Palavras:** ${a.wordCount} · **URL:** ${a.url}`);
    if (a.description) L.push(`- **Descrição:** ${a.description}`);
    if (a.matchedIgPost) {
      L.push(`- **IG repackage:** ${a.matchedIgPost.url} (${a.matchedIgPost.vsMedian.toFixed(2)}x)`);
    }
    if (a.externalLinks.length) {
      L.push(`- **Links externos citados (${a.externalLinks.length}):**`);
      for (const link of a.externalLinks.slice(0, 6)) L.push(`  - ${link}`);
    }
    L.push("");
    L.push(`> ${a.bodyText.slice(0, 400)}…`);
    L.push("");
  }

  return L.join("\n");
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`📝 Mito Health blog scraper`);
  console.log(`   Descobrindo artigos…`);

  const urls = await discoverArticles();
  console.log(`   ${urls.length} URLs únicos descobertos`);

  const articles: Article[] = [];
  for (let i = 0; i < urls.length; i++) {
    const u = urls[i];
    process.stdout.write(`  [${i + 1}/${urls.length}] ${u.split("/").pop()?.slice(0, 50)}... `);
    const a = await fetchArticle(u);
    if (a) {
      articles.push(a);
      process.stdout.write(`✅ ${a.wordCount} palavras\n`);
    } else {
      process.stdout.write(`❌\n`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  // Cross-reference com IG
  crossReferenceWithIg(articles);
  const matched = articles.filter((a) => a.matchedIgPost).length;
  console.log(`\n🔗 Cross-reference: ${matched}/${articles.length} artigos com IG post linkado`);

  const jsonPath = path.join(OUT_DIR, "articles.json");
  const mdPath = path.join(OUT_DIR, "articles.md");
  fs.writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), total: articles.length, matched, articles }, null, 2));
  fs.writeFileSync(mdPath, buildMarkdown(articles));

  console.log(`\n✅ ${path.basename(jsonPath)} (${(fs.statSync(jsonPath).size / 1024).toFixed(0)}KB)`);
  console.log(`   ${path.basename(mdPath)} (${(fs.statSync(mdPath).size / 1024).toFixed(0)}KB)`);
}

main().catch((err) => {
  console.error("\n❌", err.message);
  process.exit(1);
});
