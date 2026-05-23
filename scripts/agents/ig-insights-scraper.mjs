// scripts/agents/ig-insights-scraper.mjs — Coleta IG insights pra runs published
//
// Lê runs/ pra encontrar published_media_id, scrape via Meta Graph API,
// salva em runs/<id>/insights.json + atualiza runs/_insights.db (SQLite).
//
// Métricas coletadas: reach, impressions, likes, comments, shares, saves
// Métricas derivadas: vsMedian (vs mediana dos últimos N), save_rate, share_rate
//
// Princípio Tan #4: tudo deterministic (API call → struct → SQL).
// Sem LLM aqui.
//
// CLI:
//   node scripts/agents/ig-insights-scraper.mjs                  # scrape all published
//   node scripts/agents/ig-insights-scraper.mjs --run <id>       # scrape single
//   node scripts/agents/ig-insights-scraper.mjs --ranking        # show winners/losers

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");

// .env loader
const ENV_PATH = path.join(ROOT, ".env");
if (fs.existsSync(ENV_PATH)) {
  for (const line of fs.readFileSync(ENV_PATH, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
const IG_ACCOUNT_ID = process.env.IG_BUSINESS_ACCOUNT_ID;
const GRAPH = "https://graph.facebook.com/v23.0";

const DB_PATH = path.join(ROOT, "runs", "_insights.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS insights (
    run_id TEXT NOT NULL,
    media_id TEXT NOT NULL,
    scraped_at TEXT NOT NULL,
    hours_after_publish INTEGER,
    reach INTEGER, views INTEGER,
    likes INTEGER, comments INTEGER, shares INTEGER, saves INTEGER,
    profile_visits INTEGER, follows INTEGER,
    save_rate REAL, share_rate REAL,
    pillar INTEGER, persona TEXT, format TEXT,
    PRIMARY KEY (run_id, scraped_at)
  );
  CREATE INDEX IF NOT EXISTS idx_run ON insights(run_id);
  CREATE INDEX IF NOT EXISTS idx_scraped ON insights(scraped_at);
`);

// ─── Find published runs ──────────────────────────────────────────────────────
function findPublishedRuns() {
  const runsDir = path.join(ROOT, "runs");
  const out = [];
  for (const dir of fs.readdirSync(runsDir).filter(d => /^\d{4}-\d{2}-\d{2}/.test(d))) {
    const coPath = path.join(runsDir, dir, "content-object.md");
    if (!fs.existsSync(coPath)) continue;
    const co = fs.readFileSync(coPath, "utf-8");
    if (!/^state:\s*published/m.test(co)) continue;
    const mediaId = (co.match(/^published_media_id:\s*(\S+)/m) ?? [, null])[1];
    const publishedAt = (co.match(/^published_at:\s*(\S+)/m) ?? [, null])[1];
    if (!mediaId) continue;
    const pillar = parseInt((co.match(/^pillar:\s*(\d+)/m) ?? [, "0"])[1]);
    const persona = (co.match(/^target_persona:\s*(\S+)/m) ?? [, "unknown"])[1];
    const format = (co.match(/^format:\s*(\S+)/m) ?? [, "unknown"])[1];
    out.push({ run_id: dir, media_id: mediaId, published_at: publishedAt, pillar, persona, format });
  }
  return out;
}

// ─── Scrape insights for 1 media ─────────────────────────────────────────────
async function scrapeMedia(mediaId) {
  if (!TOKEN || !IG_ACCOUNT_ID) throw new Error("META_PAGE_ACCESS_TOKEN or IG_BUSINESS_ACCOUNT_ID missing in .env");
  // IG API v22+ removed "impressions" — use "views" + reach + engagement breakdown
  const fields = "reach,views,likes,comments,shares,saved,profile_visits,follows";
  const url = `${GRAPH}/${mediaId}/insights?metric=${fields}&access_token=${TOKEN}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) {
    // Fallback for carousel/older media that don't support all fields
    const fields2 = "reach,likes,comments,shares,saved";
    const url2 = `${GRAPH}/${mediaId}/insights?metric=${fields2}&access_token=${TOKEN}`;
    const res2 = await fetch(url2);
    const json2 = await res2.json();
    if (json2.error) throw new Error(`IG insights error: ${JSON.stringify(json2.error)}`);
    return parseInsights(json2.data ?? []);
  }
  return parseInsights(json.data ?? []);
}

function parseInsights(data) {
  const result = {};
  for (const m of data) {
    const value = (m.values?.[0]?.value) ?? 0;
    // Normalize "saved" → "saves" for consistency
    const key = m.name === "saved" ? "saves" : m.name;
    result[key] = value;
  }
  return result;
}

// ─── Compute derived metrics + median compare ────────────────────────────────
function computeDerived(insights) {
  const reach = insights.reach ?? 0;
  if (reach === 0) return { ...insights, save_rate: 0, share_rate: 0 };
  return {
    ...insights,
    save_rate: (insights.saves ?? 0) / reach,
    share_rate: (insights.shares ?? 0) / reach,
  };
}

function ranking() {
  const rows = db.prepare(`
    SELECT i.run_id, i.media_id, i.reach, i.saves, i.shares, i.comments, i.save_rate, i.share_rate,
           i.pillar, i.persona, i.format, MAX(i.scraped_at) as latest
    FROM insights i
    GROUP BY i.run_id
    ORDER BY i.save_rate DESC NULLS LAST
  `).all();
  if (rows.length === 0) { console.log("(no insights scraped yet)"); return; }

  const reaches = rows.map(r => r.reach).filter(Boolean).sort((a,b) => a-b);
  const medianReach = reaches[Math.floor(reaches.length / 2)] ?? 0;

  console.log(`\n📊 Insights ranking · ${rows.length} posts · median reach ${medianReach}\n`);
  console.log("  vsMed  | save  | share | reach | post");
  for (const r of rows) {
    const vsMed = medianReach > 0 ? (r.reach / medianReach).toFixed(2) : "—";
    const sr = ((r.save_rate ?? 0) * 100).toFixed(2);
    const shr = ((r.share_rate ?? 0) * 100).toFixed(2);
    console.log(`  ${vsMed.padEnd(6)} | ${sr}% | ${shr}% | ${r.reach?.toString().padEnd(5)} | P${r.pillar} ${r.run_id}`);
  }
  console.log();
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const argRunIdx = process.argv.indexOf("--run");
  const argRun = argRunIdx >= 0 ? process.argv[argRunIdx + 1] : null;
  const showRanking = process.argv.includes("--ranking");

  if (showRanking) {
    ranking();
    return;
  }

  let posts = findPublishedRuns();
  if (argRun) posts = posts.filter(p => p.run_id === argRun);
  if (posts.length === 0) {
    console.log("Nenhum post published encontrado.");
    return;
  }

  console.log(`\n📡 IG Insights Scraper · ${posts.length} posts published\n`);

  const insert = db.prepare(`
    INSERT INTO insights (run_id, media_id, scraped_at, hours_after_publish, reach, impressions, likes, comments, shares, saves, profile_visits, follows, save_rate, share_rate, pillar, persona, format)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const p of posts) {
    process.stdout.write(`  ${p.run_id}... `);
    try {
      const raw = await scrapeMedia(p.media_id);
      const derived = computeDerived(raw);
      const hoursAfter = p.published_at ? Math.round((Date.now() - new Date(p.published_at).getTime()) / 1000 / 3600) : null;
      insert.run(
        p.run_id, p.media_id, new Date().toISOString(), hoursAfter,
        derived.reach ?? 0, derived.impressions ?? 0,
        derived.likes ?? 0, derived.comments ?? 0, derived.shares ?? 0, derived.saves ?? 0,
        derived.profile_visits ?? 0, derived.follows ?? 0,
        derived.save_rate ?? 0, derived.share_rate ?? 0,
        p.pillar, p.persona, p.format
      );
      console.log(`✓ reach=${derived.reach ?? "?"} saves=${derived.saves ?? "?"} (${hoursAfter}h)`);
      // Also save snapshot in run dir
      const insightsPath = path.join(ROOT, "runs", p.run_id, "insights.json");
      const prev = fs.existsSync(insightsPath) ? JSON.parse(fs.readFileSync(insightsPath, "utf-8")) : { snapshots: [] };
      prev.snapshots.push({ scraped_at: new Date().toISOString(), hours_after: hoursAfter, ...derived });
      fs.writeFileSync(insightsPath, JSON.stringify(prev, null, 2));
    } catch (e) {
      console.log(`✗ ${e.message.slice(0, 100)}`);
    }
  }

  ranking();
}

await main();
