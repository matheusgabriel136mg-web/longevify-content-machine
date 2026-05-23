// scripts/agents/idea-ingester.mjs — URL detector + scraper + ideas_backlog writer.
//
// Triggered from telegram-bot.mjs when founder messages contain a URL (no command).
// Bot calls ingestUrl(url, chatId) → returns { idea_id, summary } → bot sends preview
// with 3 inline buttons [🎨 Remixar] [📋 Só guardar] [🗑️ Descartar].
//
// CLI for testing:
//   node scripts/agents/idea-ingester.mjs --url https://instagram.com/p/abc

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");

const ENV_PATH = path.join(ROOT, ".env");
if (fs.existsSync(ENV_PATH)) {
  for (const line of fs.readFileSync(ENV_PATH, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const PIPELINE_DB = path.join(ROOT, "runs", "_pipeline.db");
const AUDIT_LOG = path.join(ROOT, "runs", "_audit-log.jsonl");

function audit(entry) {
  fs.mkdirSync(path.dirname(AUDIT_LOG), { recursive: true });
  fs.appendFileSync(AUDIT_LOG, JSON.stringify({ ts: new Date().toISOString(), agent: "idea-ingester", ...entry }) + "\n");
}

// ─── URL detection ────────────────────────────────────────────────────────────
export const URL_RE = /\bhttps?:\/\/[^\s<>"]+/gi;

const PLATFORM_PATTERNS = {
  instagram: /(?:^|[/.])(?:www\.)?instagram\.com\/(p|reel|reels)\//i,
  linkedin:  /(?:^|[/.])(?:www\.)?linkedin\.com\/(posts|pulse|feed\/update)\//i,
  twitter:   /(?:^|[/.])(?:www\.)?(?:twitter|x)\.com\/[^/]+\/status\//i,
  youtube:   /(?:^|[/.])(?:(?:www\.)?youtube\.com\/watch\?v=|(?:www\.)?youtu\.be\/)/i,
};
const BRAND_PATTERNS = {
  function: /functionhealth|function\.com/i,
  mito:     /mitohealth/i,
  superpower: /superpowerapp|superpower\.com/i,
  thorne:   /thornehealth|thorne\.com/i,
  rerise:   /rerisehealth/i,
  timeline: /timeline_longevity|timelineagainst/i,
  betterbe: /betterbe\.health/i,
  bryan:    /bryanjohnson_|bryanjohnson\.co/i,
};

export function detectUrls(text) {
  return (text.match(URL_RE) || []).slice(0, 5);  // cap 5 URLs per message
}

export function detectPlatform(url) {
  for (const [p, re] of Object.entries(PLATFORM_PATTERNS)) {
    if (re.test(url)) return p;
  }
  return "web";
}

export function detectBrand(url, caption = "") {
  const hay = url + " " + (caption || "");
  for (const [b, re] of Object.entries(BRAND_PATTERNS)) {
    if (re.test(hay)) return b;
  }
  return "other";
}

// ─── Per-source scrapers (defensive — every one returns same shape) ──────────
// Shape: { caption, author, media_urls: [], engagement: {} }

async function scrapeGenericOg(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Longevify content-machine idea-ingester)" },
      signal: AbortSignal.timeout(20000),
      redirect: "follow",
    });
    if (!res.ok) return { error: `http ${res.status}` };
    const html = await res.text();
    const og = (prop) => {
      const m = html.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']+)["']`, "i"))
              ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${prop}["']`, "i"));
      return m?.[1] || null;
    };
    const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
    return {
      caption: og("description") || og("title") || titleTag || "",
      author: og("site_name") || new URL(url).hostname,
      media_urls: og("image") ? [og("image")] : [],
      engagement: {},
    };
  } catch (e) {
    return { error: e.message?.slice(0, 200) || "fetch failed" };
  }
}

async function scrapeYoutube(url) {
  // Use og-tags for title/description/thumbnail.
  return scrapeGenericOg(url);
}

async function scrapeTwitter(url) {
  // X/Twitter aggressively blocks unauth scrape. Try og-tags via Nitter mirror first.
  const nitterUrl = url.replace(/(?:twitter|x)\.com/i, "nitter.net");
  let r = await scrapeGenericOg(nitterUrl);
  if (!r.error && r.caption) return r;
  // Fallback to direct fetch (may fail).
  return scrapeGenericOg(url);
}

async function scrapeLinkedin(url) {
  // LinkedIn requires auth — OG tags are best we get.
  return scrapeGenericOg(url);
}

async function scrapeInstagram(url) {
  // Best-effort via og-tags. Apify is the real path (separate cost); guard behind APIFY_API_TOKEN.
  const og = await scrapeGenericOg(url);
  if (og.error || !og.caption) {
    return { ...og, hint_to_founder: "IG scrape returned vazio. Manda screenshot ou caption colada." };
  }
  return og;
}

const SCRAPERS = {
  instagram: scrapeInstagram,
  linkedin:  scrapeLinkedin,
  twitter:   scrapeTwitter,
  youtube:   scrapeYoutube,
  web:       scrapeGenericOg,
};

// ─── Persona / pillar suggestion (heuristic, no LLM for speed) ───────────────
const PERSONA_KEYWORDS = {
  maria: ["mãe", "filhos", "família", "lar", "casa", "filho", "esposa", "menopausa", "perimenopausa"],
  julia: ["lagoa", "sauna", "rio", "biomarcador", "vitamina d", "ferritina", "hemograma", "exame"],
  pedro: ["executivo", "reunião", "trabalho", "cansaço", "produtividade", "foco", "performance"],
  ana:   ["sócia", "advocacia", "escritório", "carreira", "stress", "ritmo", "demanda"],
};
const PILLAR_KEYWORDS = {
  1: ["manifesto", "filosofia", "modelo", "sistema", "paradigma"],
  2: ["biomarcador", "exame", "painel", "vitamin", "ferritin", "apo b", "hs-crp", "hba1c"],
  3: ["mainstream", "modelo falha", "exame de rotina", "normal", "padrão"],
  4: ["sintoma", "sensação", "cansaço", "sono", "fadiga", "energia"],
  5: ["protocolo", "integrador", "longevidade", "sistema"],
  6: ["cultura", "brasileiro", "brasil", "tropical"],
};

export function suggestPersona(caption) {
  const lower = (caption || "").toLowerCase();
  let best = null, bestScore = 0;
  for (const [p, kws] of Object.entries(PERSONA_KEYWORDS)) {
    const score = kws.reduce((acc, k) => acc + (lower.includes(k) ? 1 : 0), 0);
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return best || "maria";  // default
}

export function suggestPillar(caption) {
  const lower = (caption || "").toLowerCase();
  let best = null, bestScore = 0;
  for (const [p, kws] of Object.entries(PILLAR_KEYWORDS)) {
    const score = kws.reduce((acc, k) => acc + (lower.includes(k) ? 1 : 0), 0);
    if (score > bestScore) { best = parseInt(p); bestScore = score; }
  }
  return best || 2;  // default P2 (biomarker)
}

// ─── ideas_backlog table ──────────────────────────────────────────────────────
function ensureTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ideas_backlog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_url TEXT UNIQUE NOT NULL,
      source_brand TEXT,
      source_platform TEXT,
      original_caption TEXT,
      original_author TEXT,
      media_urls TEXT,
      engagement TEXT,
      persona_suggested TEXT,
      pillar_suggested INTEGER,
      status TEXT DEFAULT 'new',
      ingested_at TEXT NOT NULL,
      ingested_by_chat_id INTEGER,
      promoted_to_run_id TEXT,
      remix_decision TEXT,
      remix_at TEXT
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas_backlog(status);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ideas_brand ON ideas_backlog(source_brand);`);
}

// ─── Main entrypoint ──────────────────────────────────────────────────────────
export async function ingestUrl(url, chatId = null) {
  if (!fs.existsSync(PIPELINE_DB)) {
    return { ok: false, error: "pipeline.db missing" };
  }
  const db = new Database(PIPELINE_DB);
  ensureTable(db);

  // De-dup
  const existing = db.prepare(`SELECT id, status, original_caption FROM ideas_backlog WHERE source_url = ?`).get(url);
  if (existing) {
    db.close();
    return { ok: true, dup: true, idea_id: existing.id, status: existing.status, caption: existing.original_caption };
  }

  const platform = detectPlatform(url);
  const scraper = SCRAPERS[platform] || SCRAPERS.web;

  let scrape;
  try { scrape = await scraper(url); }
  catch (e) { scrape = { error: e.message?.slice(0, 200) || "scrape error" }; }

  if (scrape?.error || !scrape?.caption) {
    audit({ event: "scrape_failed", url, platform, error: scrape?.error });
    db.close();
    return { ok: false, error: scrape?.error || "no caption extracted", platform, hint: scrape?.hint_to_founder };
  }

  const brand = detectBrand(url, scrape.caption);
  const persona = suggestPersona(scrape.caption);
  const pillar = suggestPillar(scrape.caption);

  const stmt = db.prepare(`
    INSERT INTO ideas_backlog
      (source_url, source_brand, source_platform, original_caption, original_author, media_urls, engagement, persona_suggested, pillar_suggested, ingested_at, ingested_by_chat_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')
  `);
  const info = stmt.run(
    url, brand, platform,
    scrape.caption.slice(0, 5000),
    scrape.author || null,
    JSON.stringify(scrape.media_urls || []),
    JSON.stringify(scrape.engagement || {}),
    persona, pillar,
    new Date().toISOString(), chatId,
  );
  db.close();

  audit({ event: "ingest_ok", url, platform, brand, persona, pillar, idea_id: info.lastInsertRowid });
  return {
    ok: true,
    idea_id: info.lastInsertRowid,
    platform, brand, persona, pillar,
    caption: scrape.caption,
    author: scrape.author,
    media_urls: scrape.media_urls || [],
  };
}

export function getIdea(ideaId) {
  if (!fs.existsSync(PIPELINE_DB)) return null;
  const db = new Database(PIPELINE_DB, { readonly: true });
  try {
    return db.prepare(`SELECT * FROM ideas_backlog WHERE id = ?`).get(ideaId);
  } finally { db.close(); }
}

export function setIdeaStatus(ideaId, status, opts = {}) {
  if (!fs.existsSync(PIPELINE_DB)) return null;
  const db = new Database(PIPELINE_DB);
  ensureTable(db);
  try {
    const fields = ["status = ?"];
    const values = [status];
    if (opts.promoted_to_run_id) { fields.push("promoted_to_run_id = ?"); values.push(opts.promoted_to_run_id); }
    if (opts.remix_decision) {
      fields.push("remix_decision = ?", "remix_at = ?");
      values.push(opts.remix_decision, new Date().toISOString());
    }
    values.push(ideaId);
    db.prepare(`UPDATE ideas_backlog SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  } finally { db.close(); }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--url");
  if (idx < 0 || !args[idx + 1]) {
    console.error("Usage: idea-ingester.mjs --url <url>");
    process.exit(1);
  }
  const r = await ingestUrl(args[idx + 1]);
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
}
