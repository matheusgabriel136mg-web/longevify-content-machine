// scripts/agents/competitor-tracker.mjs — Competitor intel weekly
//
// Roda 1x/semana (sábado 04:00 BRT) via systemd timer.
// Pra cada concorrente em foundation/source-watchlist.md (seção "Concorrentes nacionais"):
//   1. Fetch homepage HTML
//   2. Extract: pricing (regex R$/mês), feature launches (h2/h3 novos), blog posts (links recentes)
//   3. Diff vs snapshot anterior (runs/_competitor-snapshots/<slug>.json)
//   4. Se diff material → append em foundation/stores/competitor-moves.md + Telegram alert
//
// Princípio Tan: scrape + diff deterministic, LLM SÓ pra classificar "material vs trivial" se diff>0.

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import Anthropic from "@anthropic-ai/sdk";

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

const SNAPSHOTS_DIR = path.join(ROOT, "runs", "_competitor-snapshots");
const MOVES_LOG = path.join(ROOT, "foundation", "stores", "competitor-moves.md");
const AUDIT_LOG = path.join(ROOT, "runs", "_audit-log.jsonl");
const TELEGRAM_NOTIFY = path.join(ROOT, "scripts", "agents", "telegram-notify.mjs");
const WATCHLIST = path.join(ROOT, "foundation", "source-watchlist.md");

fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
fs.mkdirSync(path.dirname(MOVES_LOG), { recursive: true });

// Parse competitors from foundation/source-watchlist.md (single source of truth).
// Matches lines like:
//   - **Name** (domain.com.br) — description
//   - **Name** (https://domain.com.br) — description
// Scope: only lines under "Concorrentes nacionais" section (between that heading and next H2).
function loadCompetitors() {
  if (!fs.existsSync(WATCHLIST)) {
    throw new Error(`source-watchlist.md not found at ${WATCHLIST}`);
  }
  const md = fs.readFileSync(WATCHLIST, "utf-8");
  const sectionMatch = md.match(/##\s+Concorrentes nacionais[\s\S]*?(?=\n##\s|\n#\s|$)/);
  if (!sectionMatch) {
    throw new Error("'## Concorrentes nacionais' section missing in source-watchlist.md");
  }
  const lineRe = /^-\s+\*\*([^*]+)\*\*\s*\(([^)]+)\)/gm;
  const competitors = [];
  let m;
  while ((m = lineRe.exec(sectionMatch[0])) !== null) {
    const name = m[1].trim();
    let url = m[2].trim();
    if (!/^https?:\/\//.test(url)) url = "https://" + url;
    const slug = name.toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // strip accents
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    competitors.push({ slug, name, url });
  }
  return competitors;
}

const COMPETITORS = loadCompetitors();

function audit(entry) {
  fs.mkdirSync(path.dirname(AUDIT_LOG), { recursive: true });
  fs.appendFileSync(AUDIT_LOG, JSON.stringify({ ts: new Date().toISOString(), agent: "competitor-tracker", ...entry }) + "\n");
}

// ─── Extract signals from HTML (deterministic) ───────────────────────────────
function extractSignals(html) {
  const signals = {
    pricing_mentions: [],
    headings: [],
    blog_links: [],
    captacao_mentions: [],
  };

  // Pricing: R$ XXX/mês, R$XXX, "a partir de R$"
  const pricingRegex = /R\$\s*\d{1,4}(?:[.,]\d{2})?(?:\s*\/(?:m[eê]s|mensal|ano|anual))?/gi;
  signals.pricing_mentions = [...new Set(html.match(pricingRegex) || [])].slice(0, 20);

  // Headings (h1/h2/h3) — sinal de feature launches
  const headingRegex = /<h[123][^>]*>([^<]{5,120})<\/h[123]>/gi;
  let m;
  while ((m = headingRegex.exec(html)) !== null && signals.headings.length < 30) {
    const text = m[1].replace(/\s+/g, " ").trim();
    if (text.length > 5) signals.headings.push(text);
  }
  signals.headings = [...new Set(signals.headings)];

  // Blog/news links
  const linkRegex = /<a[^>]+href=["']([^"']*\/(blog|news|imprensa|press)\/[^"']*)["']/gi;
  while ((m = linkRegex.exec(html)) !== null && signals.blog_links.length < 15) {
    signals.blog_links.push(m[1]);
  }
  signals.blog_links = [...new Set(signals.blog_links)];

  // Captação mentions
  const captacaoRegex = /(?:captou|capta[çc][aã]o|S[eé]rie\s+[A-D]|seed|round|R\$\s*\d+\s*milh[oõ]es?|US\$\s*\d+)/gi;
  signals.captacao_mentions = [...new Set(html.match(captacaoRegex) || [])].slice(0, 10);

  return signals;
}

// ─── Compute diff (deterministic) ────────────────────────────────────────────
function diffSignals(prev, current) {
  if (!prev) return { is_first_snapshot: true, total_changes: 0 };
  const diff = {
    pricing_added: current.pricing_mentions.filter(p => !prev.pricing_mentions.includes(p)),
    pricing_removed: prev.pricing_mentions.filter(p => !current.pricing_mentions.includes(p)),
    headings_added: current.headings.filter(h => !prev.headings.includes(h)),
    headings_removed: prev.headings.filter(h => !current.headings.includes(h)),
    blog_links_added: current.blog_links.filter(l => !prev.blog_links.includes(l)),
    captacao_added: current.captacao_mentions.filter(c => !prev.captacao_mentions.includes(c)),
  };
  diff.total_changes = diff.pricing_added.length + diff.pricing_removed.length
                     + diff.headings_added.length + diff.headings_removed.length
                     + diff.blog_links_added.length + diff.captacao_added.length;
  return diff;
}

// ─── LLM: classify material vs trivial (when diff > 0) ─────────────────────
async function classifyMateriality(competitor, diff, anthropic) {
  if (diff.total_changes === 0) return { material: false, summary: "no changes" };

  const prompt = `Classify materiality (HIGH | MEDIUM | LOW) deste diff de competitor pra Longevify (healthtech BR concorrente).

═══ Competitor ═══
${competitor.name} (${competitor.url})

═══ Diff (semana atual vs anterior) ═══
Pricing added: ${JSON.stringify(diff.pricing_added)}
Pricing removed: ${JSON.stringify(diff.pricing_removed)}
Headings added: ${JSON.stringify(diff.headings_added.slice(0, 10))}
Blog links new: ${JSON.stringify(diff.blog_links_added.slice(0, 5))}
Captação mentions: ${JSON.stringify(diff.captacao_added)}

═══ Tarefa ═══
HIGH = mudança de pricing OU captação anunciada OU feature launch óbvio (novo produto/módulo)
MEDIUM = mudanças significativas em headlines (rebrand parcial) OU blog post relevante
LOW = mudanças cosméticas, copy minor, blog posts genéricos

Retorne SÓ JSON:
{
  "materiality": "HIGH" | "MEDIUM" | "LOW",
  "summary": "<1 sentence summary>",
  "alert_telegram": <bool — true se HIGH ou MEDIUM, false se LOW>
}`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });
    const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("\n");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return { materiality: "LOW", summary: "LLM no JSON", alert_telegram: false };
    const cost = ((msg.usage?.input_tokens ?? 0) / 1e6) * 3 + ((msg.usage?.output_tokens ?? 0) / 1e6) * 15;
    return { ...JSON.parse(m[0]), cost_usd: cost };
  } catch (e) {
    return { materiality: "LOW", summary: `LLM error: ${e.message.slice(0, 100)}`, alert_telegram: false };
  }
}

// ─── Append to moves log ─────────────────────────────────────────────────────
function appendMove(competitor, diff, classification) {
  const today = new Date().toISOString().slice(0, 10);
  if (!fs.existsSync(MOVES_LOG)) {
    fs.writeFileSync(MOVES_LOG, "# Competitor Moves Log\n\n> Auto-gerado por scripts/agents/competitor-tracker.mjs (weekly).\n\n");
  }
  const block = `\n## ${today} · ${competitor.name} · ${classification.materiality}\n\n` +
    `**Summary:** ${classification.summary}\n\n` +
    `- Pricing added: ${diff.pricing_added.length ? "`" + diff.pricing_added.join("` `") + "`" : "—"}\n` +
    `- Pricing removed: ${diff.pricing_removed.length ? "`" + diff.pricing_removed.join("` `") + "`" : "—"}\n` +
    `- Headings new: ${diff.headings_added.length}\n` +
    `- Blog links new: ${diff.blog_links_added.length}\n` +
    `- Captação mentions: ${diff.captacao_added.length}\n` +
    (diff.headings_added.length ? `\n**Top headlines novos:**\n` + diff.headings_added.slice(0, 5).map(h => `- ${h}`).join("\n") + "\n" : "") +
    `\n---\n`;
  fs.appendFileSync(MOVES_LOG, block);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
console.log(`\n🕵️  Competitor Tracker · ${COMPETITORS.length} concorrentes\n`);

const anthropic = new Anthropic();
let totalChanges = 0;
let alertsSent = 0;

for (const c of COMPETITORS) {
  process.stdout.write(`  ${c.slug.padEnd(15)} `);
  try {
    const res = await fetch(c.url, {
      headers: { "User-Agent": "Mozilla/5.0 (Longevify content-machine competitor-tracker)" },
      signal: AbortSignal.timeout(30000),
    });
    const html = await res.text();
    const current = extractSignals(html);
    const snapshotPath = path.join(SNAPSHOTS_DIR, `${c.slug}.json`);
    const prev = fs.existsSync(snapshotPath) ? JSON.parse(fs.readFileSync(snapshotPath, "utf-8")) : null;
    const diff = diffSignals(prev, current);

    // Save snapshot for next week
    fs.writeFileSync(snapshotPath, JSON.stringify({ scraped_at: new Date().toISOString(), ...current }, null, 2));

    if (diff.is_first_snapshot) {
      console.log(`📸 first snapshot · ${current.pricing_mentions.length} prices · ${current.headings.length} headings`);
      audit({ event: "first_snapshot", competitor: c.slug, signals: { prices: current.pricing_mentions.length, headings: current.headings.length } });
      continue;
    }

    if (diff.total_changes === 0) {
      console.log(`✓ no changes`);
      continue;
    }

    totalChanges += diff.total_changes;
    process.stdout.write(`Δ ${diff.total_changes} · LLM classifying... `);

    const classification = await classifyMateriality(c, diff, anthropic);
    console.log(`${classification.materiality}`);

    appendMove(c, diff, classification);
    audit({ event: "competitor_diff", competitor: c.slug, materiality: classification.materiality, total_changes: diff.total_changes });

    if (classification.alert_telegram) {
      try {
        const alertMsg = `🕵️ *Competitor move · ${c.name}*\n\nMateriality: ${classification.materiality}\n${classification.summary}\n\nSee foundation/stores/competitor-moves.md`;
        execSync(`node ${TELEGRAM_NOTIFY} --alert "${alertMsg.replace(/"/g, '\\"').replace(/\n/g, '\\n')}" ${classification.materiality === "HIGH" ? "critical" : "warn"}`, { stdio: "ignore", timeout: 15000 });
        alertsSent++;
      } catch (e) { /* telegram not configured */ }
    }
  } catch (e) {
    console.log(`✗ ${e.message.slice(0, 60)}`);
    audit({ event: "competitor_fetch_failed", competitor: c.slug, error: e.message });
  }
}

console.log(`\n✓ ${totalChanges} total changes · ${alertsSent} Telegram alerts sent\n`);
