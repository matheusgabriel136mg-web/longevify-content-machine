/**
 * competitor-sources.ts — minera de onde os big 3 tiram conteúdo.
 *
 * Lê raw-posts.json e extrai das captions:
 *   - URLs externos (estudos, sites, news)
 *   - @mentions (experts, parceiros, afiliados que viram conteúdo)
 *   - Citações de pesquisa (journal names, "study", "research", "guidelines")
 *   - Hashtags (clusters temáticos)
 *   - Anos citados (2023, 2024 — sinais de pesquisa recente)
 *
 * Output:
 *   output/sources/competitor-sources.json
 *   output/sources/competitor-sources.md (legível)
 *
 * Custo: zero (regex puro, sem LLM)
 *
 * Uso:
 *   npm run competitor-sources
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const OUT_DIR = path.join(ROOT, "output", "sources");
fs.mkdirSync(OUT_DIR, { recursive: true });

const TARGET_BRANDS = ["Superpower", "Mito Health", "Function Health"];

interface RawPost {
  url?: string;
  shortCode?: string;
  brand: string;
  format: "image" | "carousel" | "reel";
  caption?: string;
  vsMedian?: number;
  isViral?: boolean;
  hashtags?: string[];
}

function findLatestAnalysisDir(): string {
  const dirs = fs
    .readdirSync(path.join(ROOT, "output"))
    .filter((n) => n.startsWith("analysis-"))
    .sort();
  if (!dirs.length) throw new Error("Nenhuma pasta analysis-*");
  return path.join(ROOT, "output", dirs[dirs.length - 1]);
}

// ─── Regex ────────────────────────────────────────────────────────────────────

// URLs (excluindo IG CDN)
const URL_RE = /https?:\/\/(?!(?:[a-z0-9-]+\.)?cdninstagram\.com|(?:[a-z0-9-]+\.)?fbcdn\.net|instagram\.com|t\.me)[^\s)\]]+/gi;
// @mentions
const MENTION_RE = /(?<![a-z0-9])@([a-z0-9_.]{2,30})/gi;
// Hashtags
const HASHTAG_RE = /#([a-zA-Z0-9_]+)/g;
// Citações de pesquisa: padrões textuais
const RESEARCH_PHRASES = [
  /\bstud(?:y|ies) (?:show|found|reveal|suggest|published|in)\b/i,
  /\bresearch (?:shows|suggests|published|by)\b/i,
  /\baccording to (?:a |the )?(?:new |recent )?study\b/i,
  /\b(?:new|recent|latest) guidelines?\b/i,
  /\b(?:meta-?analysis|systematic review|RCT|randomized)\b/i,
  /\b(?:NEJM|JAMA|Lancet|Nature|Science|Cell|BMJ)\b/i,
  /\bclinical trial\b/i,
  /\bpublished in\b/i,
  /\bphase (?:I|II|III|1|2|3) trial\b/i,
];

// Journals e organizações (sinaliza autoridade citada)
const AUTHORITY_RE = /\b(NEJM|JAMA|The Lancet|Nature|Science|Cell|BMJ|Annals of Internal Medicine|Mayo Clinic|Cleveland Clinic|Harvard|Stanford|MIT|Johns Hopkins|AHA|American Heart|ACC|American College of Cardiology|ESC|European Society of Cardiology|FDA|CDC|WHO|NIH|NCCN|ESMO|ASCO|Endocrine Society|IDF|ADA|American Diabetes)\b/gi;

// Anos recentes
const YEAR_RE = /\b(202[0-9]|2030)\b/g;

// Domínios "tipo" (categoriza URL)
function classifyUrl(url: string): string {
  const host = url.toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  if (/pubmed|ncbi\.nlm|sciencedirect|nature|science\.org|cell\.com|nejm|jamanetwork|thelancet|bmj/.test(host)) return "scientific-journal";
  if (/heart\.org|ahajournals|escardio|acc\.org|diabetes\.org|endocrine\.org/.test(host)) return "medical-society";
  if (/nytimes|wsj|wapo|theatlantic|bloomberg|forbes|fastcompany|wired|theguardian|economist/.test(host)) return "premium-news";
  if (/youtu\.be|youtube\.com|tiktok\.com|x\.com|twitter\.com|substack\.com/.test(host)) return "social-content";
  if (/peterattia|hubermanlab|drhyman|maxlugavere|robynyoukilis/.test(host)) return "longevity-influencer";
  if (/cdc\.gov|nih\.gov|fda\.gov|who\.int/.test(host)) return "government-health";
  return "other";
}

// ─── Análise ─────────────────────────────────────────────────────────────────

interface BrandStats {
  brand: string;
  totalPosts: number;
  postsWithUrl: number;
  postsWithMention: number;
  postsWithResearchClaim: number;
  postsWithAuthorityCite: number;
  urls: Map<string, { count: number; type: string; samplePost: string }>;
  mentions: Map<string, number>;
  hashtags: Map<string, number>;
  authorities: Map<string, number>;
  researchClaims: Array<{ phrase: string; postUrl: string; vsMedian: number }>;
  yearsCited: Map<string, number>;
}

function analyzeBrand(posts: RawPost[]): BrandStats {
  const stats: BrandStats = {
    brand: posts[0]?.brand ?? "?",
    totalPosts: posts.length,
    postsWithUrl: 0,
    postsWithMention: 0,
    postsWithResearchClaim: 0,
    postsWithAuthorityCite: 0,
    urls: new Map(),
    mentions: new Map(),
    hashtags: new Map(),
    authorities: new Map(),
    researchClaims: [],
    yearsCited: new Map(),
  };

  for (const p of posts) {
    const cap = p.caption ?? "";
    const postUrl = p.url ?? `https://instagram.com/p/${p.shortCode ?? ""}`;

    // URLs
    const urls = [...cap.matchAll(URL_RE)].map((m) => m[0]);
    if (urls.length) stats.postsWithUrl++;
    for (const u of urls) {
      const clean = u.replace(/[.,;:)]+$/, "");
      const existing = stats.urls.get(clean);
      if (existing) existing.count++;
      else stats.urls.set(clean, { count: 1, type: classifyUrl(clean), samplePost: postUrl });
    }

    // Mentions (filtra a própria conta)
    const ownHandle = stats.brand.toLowerCase().replace(/\s+/g, "");
    const mentions = [...cap.matchAll(MENTION_RE)].map((m) => m[1].toLowerCase()).filter((h) => !h.includes(ownHandle));
    if (mentions.length) stats.postsWithMention++;
    for (const m of mentions) stats.mentions.set(m, (stats.mentions.get(m) ?? 0) + 1);

    // Hashtags
    const hashtags = [...cap.matchAll(HASHTAG_RE)].map((m) => m[1].toLowerCase());
    for (const h of hashtags) stats.hashtags.set(h, (stats.hashtags.get(h) ?? 0) + 1);

    // Research claims
    for (const re of RESEARCH_PHRASES) {
      const m = cap.match(re);
      if (m) {
        stats.postsWithResearchClaim++;
        stats.researchClaims.push({ phrase: m[0], postUrl, vsMedian: p.vsMedian ?? 0 });
        break; // 1x por post
      }
    }

    // Authority cites
    const auths = [...cap.matchAll(AUTHORITY_RE)].map((m) => m[1]);
    if (auths.length) stats.postsWithAuthorityCite++;
    for (const a of auths) stats.authorities.set(a, (stats.authorities.get(a) ?? 0) + 1);

    // Years
    const years = [...cap.matchAll(YEAR_RE)].map((m) => m[1]);
    for (const y of years) stats.yearsCited.set(y, (stats.yearsCited.get(y) ?? 0) + 1);
  }

  return stats;
}

function topN<K>(map: Map<K, number>, n: number): Array<[K, number]> {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function buildMarkdown(byBrand: BrandStats[]): string {
  const L: string[] = [];
  L.push(`# De onde os Big 3 tiram conteúdo`);
  L.push("");
  L.push(`> Mineração de captions · ${byBrand.reduce((s, b) => s + b.totalPosts, 0)} posts analisados · ${new Date().toLocaleString("pt-BR")}`);
  L.push("");
  L.push(`## Sumário comparativo`);
  L.push("");
  L.push(`| Marca | Posts | Com URL | Com @mention | Com claim de pesquisa | Cita autoridade |`);
  L.push(`|-------|------:|--------:|-------------:|----------------------:|----------------:|`);
  for (const b of byBrand) {
    L.push(`| **${b.brand}** | ${b.totalPosts} | ${b.postsWithUrl} (${((b.postsWithUrl / b.totalPosts) * 100).toFixed(0)}%) | ${b.postsWithMention} (${((b.postsWithMention / b.totalPosts) * 100).toFixed(0)}%) | ${b.postsWithResearchClaim} (${((b.postsWithResearchClaim / b.totalPosts) * 100).toFixed(0)}%) | ${b.postsWithAuthorityCite} (${((b.postsWithAuthorityCite / b.totalPosts) * 100).toFixed(0)}%) |`);
  }
  L.push("");

  for (const b of byBrand) {
    L.push(`---`);
    L.push("");
    L.push(`## ${b.brand}`);
    L.push("");

    // URLs por tipo
    if (b.urls.size) {
      L.push(`### URLs externos (${b.urls.size} únicos)`);
      L.push("");
      const byType = new Map<string, Array<{ url: string; count: number; samplePost: string }>>();
      for (const [url, info] of b.urls.entries()) {
        if (!byType.has(info.type)) byType.set(info.type, []);
        byType.get(info.type)!.push({ url, count: info.count, samplePost: info.samplePost });
      }
      for (const [type, list] of [...byType.entries()].sort((a, b) => b[1].length - a[1].length)) {
        L.push(`**${type}** (${list.length}):`);
        for (const item of list.sort((a, b) => b.count - a.count).slice(0, 8)) {
          L.push(`- ${item.url}${item.count > 1 ? ` (${item.count}×)` : ""} · post: ${item.samplePost}`);
        }
        L.push("");
      }
    } else {
      L.push(`*Nenhum URL externo nos posts.*`);
      L.push("");
    }

    // Mentions top
    if (b.mentions.size) {
      L.push(`### @mentions mais frequentes (top 15)`);
      L.push("");
      for (const [m, n] of topN(b.mentions, 15)) {
        L.push(`- @${m} (${n}×) → https://instagram.com/${m}`);
      }
      L.push("");
    }

    // Authorities
    if (b.authorities.size) {
      L.push(`### Autoridades citadas (top 10)`);
      L.push("");
      for (const [a, n] of topN(b.authorities, 10)) {
        L.push(`- **${a}** — ${n}×`);
      }
      L.push("");
    }

    // Research claims (samples)
    if (b.researchClaims.length) {
      L.push(`### Sinais de pesquisa nas captions (${b.researchClaims.length} ocorrências)`);
      L.push("");
      const top = b.researchClaims.sort((a, b) => b.vsMedian - a.vsMedian).slice(0, 8);
      for (const c of top) {
        L.push(`- "${c.phrase}" · ${c.vsMedian.toFixed(2)}x · ${c.postUrl}`);
      }
      L.push("");
    }

    // Hashtags
    if (b.hashtags.size) {
      L.push(`### Hashtags mais usadas (top 15)`);
      L.push("");
      L.push(topN(b.hashtags, 15).map(([h, n]) => `\`#${h}\`(${n})`).join(" · "));
      L.push("");
    }

    // Years
    if (b.yearsCited.size) {
      L.push(`### Anos citados`);
      L.push("");
      L.push(topN(b.yearsCited, 8).map(([y, n]) => `${y} (${n})`).join(" · "));
      L.push("");
    }
  }

  // Diagnóstico cruzado
  L.push(`---`);
  L.push("");
  L.push(`## Diagnóstico cruzado — onde a Longevify pode roubar bem`);
  L.push("");
  for (const b of byBrand) {
    const pct = (n: number) => ((n / b.totalPosts) * 100).toFixed(0);
    L.push(`**${b.brand}:** ${pct(b.postsWithResearchClaim)}% dos posts amarram em research, ${pct(b.postsWithAuthorityCite)}% citam autoridade nominalmente. ${b.urls.size} fontes externas únicas.`);
  }
  L.push("");
  L.push(`**Padrão:** Quanto mais a marca cita autoridade nominal (NEJM, AHA, Mayo), mais "credível" o post lê. Mas a maioria dos virais não cita — usa apenas frases tipo "studies show". Isso significa: hook viral > rigor científico (mas Longevify pode ganhar fazendo AMBOS — citar fonte real, com hook poético).`);

  return L.join("\n");
}

function main() {
  const dir = findLatestAnalysisDir();
  const raw = JSON.parse(fs.readFileSync(path.join(dir, "raw-posts.json"), "utf-8")) as RawPost[];

  console.log(`📁 ${path.basename(dir)} · ${raw.length} posts totais`);

  const byBrand: BrandStats[] = [];
  for (const brand of TARGET_BRANDS) {
    const posts = raw.filter((p) => p.brand === brand);
    if (!posts.length) continue;
    const stats = analyzeBrand(posts);
    byBrand.push(stats);
    console.log(`  ${brand}: ${posts.length} posts · ${stats.urls.size} URLs únicos · ${stats.mentions.size} mentions únicos · ${stats.postsWithResearchClaim} claims de pesquisa`);
  }

  // Serializa Maps pra JSON
  const jsonable = byBrand.map((b) => ({
    ...b,
    urls: Object.fromEntries(b.urls),
    mentions: Object.fromEntries(b.mentions),
    hashtags: Object.fromEntries(b.hashtags),
    authorities: Object.fromEntries(b.authorities),
    yearsCited: Object.fromEntries(b.yearsCited),
  }));

  const jsonPath = path.join(OUT_DIR, "competitor-sources.json");
  const mdPath = path.join(OUT_DIR, "competitor-sources.md");
  fs.writeFileSync(jsonPath, JSON.stringify(jsonable, null, 2));
  fs.writeFileSync(mdPath, buildMarkdown(byBrand));

  console.log(`\n✅ ${path.basename(jsonPath)} (${(fs.statSync(jsonPath).size / 1024).toFixed(0)}KB)`);
  console.log(`   ${path.basename(mdPath)} (${(fs.statSync(mdPath).size / 1024).toFixed(0)}KB)`);
}

main();
