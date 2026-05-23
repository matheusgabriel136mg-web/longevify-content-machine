// scripts/agents/big3-watcher.mjs — Daily auto-scrape of Function/Mito/Superpower.
//
// Sources per brand:
//   • Instagram via Apify (requires APIFY_API_TOKEN)
//   • Blog via fetch + og-tags
//   • LinkedIn company page via fetch + og-tags
//
// Diff is implicit (source_url UNIQUE in ideas_backlog → ingestUrl returns dup:true).
// New posts get auto_ingested=1 flag so daily-digest can rank them.
//
// CLI:
//   node scripts/agents/big3-watcher.mjs              # full sweep
//   node scripts/agents/big3-watcher.mjs --brand mito # just one
//   node scripts/agents/big3-watcher.mjs --dry-run    # log what would be ingested

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { ingestUrl } from "./idea-ingester.mjs";
import { sendTelegram } from "./telegram-notify.mjs";

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

const AUDIT_LOG = path.join(ROOT, "runs", "_audit-log.jsonl");
const STATE_PATH = path.join(ROOT, "runs", "_big3-watch-state.json");

// Brand config: handles + blog URLs + estimated followers (for engagement normalization).
const BIG3 = {
  function: {
    name: "Function Health",
    instagram: "functionhealth",
    instagram_followers: 60000,
    blog: "https://www.functionhealth.com/blog",
    linkedin: "https://www.linkedin.com/company/function-health",
  },
  mito: {
    name: "Mito Health",
    instagram: "mitohealth",
    instagram_followers: 35000,
    blog: "https://mitohealth.com/blog",
    linkedin: "https://www.linkedin.com/company/mito-health",
  },
  superpower: {
    name: "Superpower",
    instagram: "joinsuperpower",
    instagram_followers: 25000,
    blog: "https://superpower.com/blog",
    linkedin: "https://www.linkedin.com/company/joinsuperpower",
  },
};

function audit(entry) {
  fs.mkdirSync(path.dirname(AUDIT_LOG), { recursive: true });
  fs.appendFileSync(AUDIT_LOG, JSON.stringify({ ts: new Date().toISOString(), agent: "big3-watcher", ...entry }) + "\n");
}

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf-8")); } catch { return {}; }
}
function saveState(s) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

// ─── Apify Instagram scraper (Apify actor 'apify/instagram-profile-scraper') ──
async function scrapeInstagramViaApify(handle, brand, followers, maxPosts = 6) {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) return { error: "APIFY_API_TOKEN missing" };
  const actorId = "apify~instagram-profile-scraper";
  try {
    const startRes = await fetch(`https://api.apify.com/v2/acts/${actorId}/runs?token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usernames: [handle],
        resultsLimit: maxPosts,
        resultsType: "posts",
      }),
    });
    if (!startRes.ok) return { error: `apify start ${startRes.status}` };
    const startJson = await startRes.json();
    const runId = startJson?.data?.id;
    if (!runId) return { error: "no runId from apify start" };
    // Poll for completion (max 90s).
    let status = "RUNNING", attempts = 0;
    while (status !== "SUCCEEDED" && status !== "FAILED" && status !== "ABORTED" && attempts < 30) {
      await new Promise(r => setTimeout(r, 3000));
      attempts++;
      const stRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`);
      const stJson = await stRes.json();
      status = stJson?.data?.status || "UNKNOWN";
    }
    if (status !== "SUCCEEDED") return { error: `apify status ${status}` };
    // Fetch dataset.
    const dsRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${token}`);
    if (!dsRes.ok) return { error: `apify dataset ${dsRes.status}` };
    const items = await dsRes.json();
    // Transform: each item is a post.
    return {
      ok: true,
      posts: (items || []).slice(0, maxPosts).map(item => ({
        url: item.url || `https://www.instagram.com/p/${item.shortCode}/`,
        caption: item.caption || "",
        media_urls: (item.images || [item.displayUrl]).filter(Boolean).slice(0, 10),
        engagement: {
          likes: item.likesCount || 0,
          comments: item.commentsCount || 0,
          saves_estimated: Math.round((item.likesCount || 0) * 0.05),  // rough proxy
        },
        author: handle,
        brand,
        followers,
      })),
    };
  } catch (e) {
    return { error: e.message?.slice(0, 200) || "apify exception" };
  }
}

// ─── Blog/web scraper — parses index page, extracts recent post links ─────────
async function scrapeBlogIndex(blogUrl, brand, maxPosts = 5) {
  try {
    const res = await fetch(blogUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Longevify big3-watcher)" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { error: `http ${res.status}` };
    const html = await res.text();
    // Find post links: any anchor href containing /blog/ or /post/ or /article/.
    const linkRe = /<a[^>]+href=["']([^"']*\/(?:blog|post|posts|article|articles)\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const seen = new Set();
    const posts = [];
    let m;
    const baseUrl = new URL(blogUrl);
    while ((m = linkRe.exec(html)) !== null && posts.length < maxPosts) {
      let url = m[1];
      if (url.startsWith("/")) url = baseUrl.origin + url;
      else if (!url.startsWith("http")) url = baseUrl.origin + "/" + url;
      // Skip the index page itself.
      if (url === blogUrl || url.endsWith("/blog") || url.endsWith("/blog/")) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      posts.push({ url, brand });
    }
    // Fetch og-tags for each individual post to get the real caption.
    const enriched = [];
    for (const p of posts) {
      try {
        const pr = await fetch(p.url, { headers: { "User-Agent": "Mozilla/5.0 (Longevify big3-watcher)" }, signal: AbortSignal.timeout(15000) });
        if (!pr.ok) continue;
        const phtml = await pr.text();
        const og = (prop) => {
          const m = phtml.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']+)["']`, "i"))
                 ?? phtml.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${prop}["']`, "i"));
          return m?.[1] || null;
        };
        enriched.push({
          url: p.url,
          brand,
          caption: og("description") || og("title") || "",
          author: og("site_name") || baseUrl.hostname,
          media_urls: og("image") ? [og("image")] : [],
          engagement: {},  // blogs don't expose engagement
        });
      } catch { /* skip failed */ }
    }
    return { ok: true, posts: enriched };
  } catch (e) {
    return { error: e.message?.slice(0, 200) || "fetch exception" };
  }
}

// ─── Per-brand sweep ─────────────────────────────────────────────────────────
async function sweepBrand(brand, cfg, opts) {
  const { dryRun = false } = opts;
  const results = { brand, ig: null, blog: null, total_new: 0, total_dup: 0, errors: [] };

  // IG via Apify
  console.log(`\n  ─ ${cfg.name} IG (@${cfg.instagram})...`);
  const ig = await scrapeInstagramViaApify(cfg.instagram, brand, cfg.instagram_followers, 6);
  if (ig.error) {
    console.log(`    ⚠ IG scrape failed: ${ig.error}`);
    results.errors.push(`IG: ${ig.error}`);
    results.ig = { error: ig.error };
  } else {
    results.ig = { posts: ig.posts.length };
    for (const post of ig.posts) {
      if (dryRun) { console.log(`    (dry) ${post.url}`); continue; }
      const r = await ingestUrl(post.url, null, { autoIngested: true, prescraped: post, source: "big3-watcher" });
      if (r.dup) results.total_dup++;
      else if (r.ok) { results.total_new++; console.log(`    ✓ ingested ${post.url} score=${r.engagement_score}`); }
      else { console.log(`    ✗ ingest failed: ${r.error}`); results.errors.push(`IG/${post.url}: ${r.error}`); }
    }
  }

  // Blog
  console.log(`  ─ ${cfg.name} blog...`);
  const blog = await scrapeBlogIndex(cfg.blog, brand, 5);
  if (blog.error) {
    console.log(`    ⚠ Blog scrape failed: ${blog.error}`);
    results.errors.push(`Blog: ${blog.error}`);
    results.blog = { error: blog.error };
  } else {
    results.blog = { posts: blog.posts.length };
    for (const post of blog.posts) {
      if (!post.caption) continue;
      if (dryRun) { console.log(`    (dry) ${post.url}`); continue; }
      const r = await ingestUrl(post.url, null, { autoIngested: true, prescraped: post, source: "big3-watcher" });
      if (r.dup) results.total_dup++;
      else if (r.ok) { results.total_new++; console.log(`    ✓ ingested ${post.url}`); }
      else { console.log(`    ✗ ingest failed: ${r.error}`); results.errors.push(`Blog/${post.url}: ${r.error}`); }
    }
  }

  return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const brandArg = args.includes("--brand") ? args[args.indexOf("--brand") + 1] : null;
  const dryRun = args.includes("--dry-run");

  console.log(`\n👁  big3-watcher · ${new Date().toISOString()}${dryRun ? " [DRY RUN]" : ""}\n`);
  const brandsToSweep = brandArg ? [brandArg] : Object.keys(BIG3);

  let totalNew = 0, totalDup = 0;
  const allErrors = [];

  for (const brand of brandsToSweep) {
    const cfg = BIG3[brand];
    if (!cfg) { console.error(`Unknown brand: ${brand}`); continue; }
    const r = await sweepBrand(brand, cfg, { dryRun });
    totalNew += r.total_new;
    totalDup += r.total_dup;
    if (r.errors.length) allErrors.push({ brand, errors: r.errors });
    audit({ event: "sweep_brand", ...r });
  }

  const state = loadState();
  state.last_run = new Date().toISOString();
  state.last_total_new = totalNew;
  state.last_total_dup = totalDup;
  saveState(state);

  console.log(`\n✅ Sweep done. ${totalNew} new · ${totalDup} dup · ${allErrors.length} brand(s) with errors\n`);
  audit({ event: "sweep_complete", total_new: totalNew, total_dup: totalDup, errors_count: allErrors.length });

  // Telegram alert if any brand fully failed.
  if (!dryRun && allErrors.length > 0) {
    const lines = allErrors.map(b => `• *${b.brand}*: ${b.errors.slice(0, 2).join("; ")}`).join("\n");
    try {
      await sendTelegram(`⚠️ *big3-watcher* — falhas parciais\n\n${lines}\n\n_Manual ingest disponível: cola URL no chat ou /reproduce_`);
    } catch { /* telegram not configured */ }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
