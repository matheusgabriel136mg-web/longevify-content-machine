// scripts/agents/daily-brief.mjs — Daily Content Brief Diarization (#1)
//
// Roda 7am via cron. Lê:
//   - runs/_pipeline.db (state machine)
//   - runs/_audit-log.jsonl (decisions overnight)
//   - runs/_insights.db (IG metrics)
//   - runs/_queue.json (schedule)
//   - runs/_briefs/ (cross-version + critical flags)
//
// Output: runs/_briefs/morning-YYYY-MM-DD.md (markdown 1-page)
//   + push Telegram (se configurado)
//
// Tan #5 Diarization: 1-page brief estruturado, queryable.
// Tan #4: lê dados determinísticos primeiro (SQL queries), LLM apenas pra
// sintetizar padrão emergente + recomendação de mix.

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import Database from "better-sqlite3";
import Anthropic from "@anthropic-ai/sdk";
import { composeDailyBriefTelegram } from "./formatTelegram.mjs";
import { sendTelegram } from "./telegram-notify.mjs";

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

const PIPELINE_DB = path.join(ROOT, "runs", "_pipeline.db");
const INSIGHTS_DB = path.join(ROOT, "runs", "_insights.db");
const AUDIT_LOG = path.join(ROOT, "runs", "_audit-log.jsonl");
const QUEUE = path.join(ROOT, "runs", "_queue.json");
const BRIEFS_DIR = path.join(ROOT, "runs", "_briefs");
const CIRCUIT = path.join(ROOT, "runs", "_circuit-state.json");

fs.mkdirSync(BRIEFS_DIR, { recursive: true });

// ─── Gather data (deterministic SQL queries) ──────────────────────────────────

function getPipelineCounts() {
  if (!fs.existsSync(PIPELINE_DB)) return null;
  const db = new Database(PIPELINE_DB, { readonly: true });
  const counts = db.prepare(`SELECT state, COUNT(*) as n FROM runs GROUP BY state`).all();
  const upcoming = db.prepare(`SELECT * FROM runs WHERE scheduled_for IS NOT NULL AND state NOT IN ('published', 'failed') ORDER BY scheduled_for ASC LIMIT 5`).all();
  db.close();
  return { counts, upcoming };
}

function getOvernightDecisions() {
  if (!fs.existsSync(AUDIT_LOG)) return [];
  const cutoff = Date.now() - 16 * 3600 * 1000; // last 16h
  const entries = fs.readFileSync(AUDIT_LOG, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean)
    .filter(e => new Date(e.ts).getTime() > cutoff)
    .filter(e => e.event === "editor_decision" || e.event === "transition");
  return entries;
}

function getInsightsRanking() {
  if (!fs.existsSync(INSIGHTS_DB)) return null;
  const db = new Database(INSIGHTS_DB, { readonly: true });
  const rows = db.prepare(`
    SELECT run_id, MAX(scraped_at) as latest, reach, likes, comments, shares, saves, save_rate, share_rate, pillar, persona, format
    FROM insights GROUP BY run_id ORDER BY save_rate DESC NULLS LAST
  `).all();
  db.close();
  if (rows.length === 0) return null;

  const reaches = rows.map(r => r.reach || 0).sort((a,b) => a-b);
  const medianReach = reaches[Math.floor(reaches.length / 2)] || 0;

  const ranked = rows.map(r => ({
    ...r,
    vs_median: medianReach > 0 ? r.reach / medianReach : 0,
  }));
  return { ranked, median_reach: medianReach, n: rows.length };
}

function getCircuitState() {
  if (!fs.existsSync(CIRCUIT)) return { state: "CLOSED" };
  return JSON.parse(fs.readFileSync(CIRCUIT, "utf-8"));
}

function getCostToday() {
  const today = new Date().toISOString().slice(0, 10);
  if (!fs.existsSync(AUDIT_LOG)) return 0;
  let cost = 0;
  for (const line of fs.readFileSync(AUDIT_LOG, "utf-8").split("\n")) {
    if (!line) continue;
    try {
      const e = JSON.parse(line);
      if (e.ts?.slice(0, 10) === today && e.decision?.cost_usd) {
        cost += e.decision.cost_usd;
      }
    } catch {}
  }
  return cost;
}

function getCriticalFlags() {
  const flagPath = path.join(BRIEFS_DIR, `CRITICAL-DRIFT-FLAGS-${new Date().toISOString().slice(0,10)}.md`);
  // Check past 7 days for flags
  const flags = [];
  for (let d = 0; d < 7; d++) {
    const date = new Date(Date.now() - d * 86400000).toISOString().slice(0,10);
    const p = path.join(BRIEFS_DIR, `CRITICAL-DRIFT-FLAGS-${date}.md`);
    if (fs.existsSync(p)) flags.push({ date, path: p });
  }
  return flags;
}

// ─── LLM synthesis (only for "padrão emergente" + recomendação) ──────────────
async function synthesizePattern({ decisions, insights, pipelineCounts }) {
  if (decisions.length === 0 && (!insights || insights.n < 3)) {
    return { pattern: "(dados insuficientes — < 3 posts published e < 1 decision overnight)", recommendation: "Aguardar acumular dados." };
  }

  const anthropic = new Anthropic();
  const prompt = `Você é o sintetizador do Daily Content Brief. Dado:

═══ DECISIONS overnight (editor + transições) ═══
Count: ${decisions.length}
Sample: ${JSON.stringify(decisions.slice(0, 5), null, 1).slice(0, 2000)}

═══ INSIGHTS ranking (posts publicados) ═══
${insights ? JSON.stringify(insights.ranked.slice(0, 10), null, 1).slice(0, 1500) : "(sem insights)"}

═══ PIPELINE state ═══
${JSON.stringify(pipelineCounts, null, 1).slice(0, 800)}

Tarefa: 2-3 sentences sobre PADRÃO EMERGENTE + 1 RECOMENDAÇÃO concreta de mix pra próxima semana.

Retorne SÓ JSON:
{
  "pattern": "<2-3 sentences>",
  "recommendation": "<1 ação concreta de mix>"
}`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    });
    const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("\n");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return { pattern: "(LLM returned no JSON)", recommendation: text.slice(0, 200) };
    return JSON.parse(m[0]);
  } catch (e) {
    return { pattern: `(LLM error: ${e.message.slice(0,100)})`, recommendation: "Aguardar." };
  }
}

// ─── Compose markdown brief ───────────────────────────────────────────────────
function compose({ pipelineCounts, decisions, insights, circuit, costToday, flags, synthesis }) {
  const today = new Date().toISOString().slice(0, 10);
  const decisionSummary = decisions.reduce((acc, e) => {
    if (e.event === "editor_decision") {
      const dec = e.decision?.decision || "?";
      acc[dec] = (acc[dec] || 0) + 1;
    }
    return acc;
  }, {});

  const stateCounts = (pipelineCounts?.counts ?? []).map(c => `${c.state}: ${c.n}`).join(" · ");

  let md = `# Daily Content Brief · ${today}

> Auto-gerado pelo content-machine às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })} BRT.

---

## 🚨 Critical flags pendentes
`;
  if (flags.length === 0) {
    md += "Nenhum flag crítico ativo.\n\n";
  } else {
    for (const f of flags) md += `- ${f.date}: \`${path.relative(ROOT, f.path)}\`\n`;
    md += "\n";
  }

  md += `---

## 📊 Pipeline status
- States: ${stateCounts || "(empty)"}
- Cost hoje: $${costToday.toFixed(2)} (limit $40/dia)
- Circuit: **${circuit.state}** ${circuit.reason ? "— " + circuit.reason : ""}

`;

  md += `## 🎯 Próximos slots agendados\n`;
  if (pipelineCounts?.upcoming?.length) {
    for (const u of pipelineCounts.upcoming) {
      md += `- ${u.scheduled_for}  ${u.state.padEnd(10)}  ${u.run_id} (P${u.pillar || "?"} ${u.persona || "?"})\n`;
    }
  } else {
    md += "(queue vazia — idea-picker precisa rodar)\n";
  }

  md += `\n## 🤖 Editor overnight (${decisions.length} decisions)\n`;
  if (Object.keys(decisionSummary).length) {
    for (const [k, v] of Object.entries(decisionSummary)) md += `- ${k}: ${v}\n`;
  } else {
    md += "(nenhuma decisão registrada nas últimas 16h)\n";
  }

  md += `\n## 📈 Insights (posts published)\n`;
  if (insights && insights.n > 0) {
    md += `Median reach: ${insights.median_reach} · ${insights.n} posts scraped\n\n`;
    md += `| vs.med | save% | share% | reach | post |\n|---|---|---|---|---|\n`;
    for (const r of insights.ranked.slice(0, 8)) {
      md += `| ${r.vs_median.toFixed(2)} | ${((r.save_rate||0)*100).toFixed(2)}% | ${((r.share_rate||0)*100).toFixed(2)}% | ${r.reach} | P${r.pillar} ${r.run_id} |\n`;
    }
    md += `\n`;
  } else {
    md += "(sem insights ainda — rode ig-insights-scraper.mjs)\n\n";
  }

  md += `## 💡 Padrão emergente + recomendação\n\n`;
  md += `**Padrão:** ${synthesis.pattern}\n\n`;
  md += `**Recomendação:** ${synthesis.recommendation}\n\n`;

  md += `---\n\n*Cost LLM diário: $${costToday.toFixed(2)} · circuit ${circuit.state} · próximo run de planning recomendado: idea-picker no fim de domingo (semana ${getWeekNumber()})*\n`;

  return md;
}

function getWeekNumber() {
  const d = new Date();
  const onejan = new Date(d.getFullYear(), 0, 1);
  return Math.ceil((((d - onejan) / 86400000) + onejan.getDay() + 1) / 7);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
console.log("\n📋 Daily Content Brief (Diarization #1) ...\n");

const pipelineCounts = getPipelineCounts();
const decisions = getOvernightDecisions();
const insights = getInsightsRanking();
const circuit = getCircuitState();
const costToday = getCostToday();
const flags = getCriticalFlags();

console.log(`  ✓ Pipeline: ${pipelineCounts?.counts?.length ?? 0} state types`);
console.log(`  ✓ Decisions (16h): ${decisions.length}`);
console.log(`  ✓ Insights: ${insights?.n ?? 0} posts`);
console.log(`  ✓ Circuit: ${circuit.state}`);
console.log(`  ✓ Cost today: $${costToday.toFixed(2)}`);
console.log(`  ✓ Critical flags: ${flags.length}`);
console.log(`  ⏳ Synthesizing pattern...`);

const synthesis = await synthesizePattern({ decisions, insights, pipelineCounts });
const md = compose({ pipelineCounts, decisions, insights, circuit, costToday, flags, synthesis });

const today = new Date().toISOString().slice(0, 10);
const briefPath = path.join(BRIEFS_DIR, `morning-${today}.md`);
fs.writeFileSync(briefPath, md);
console.log(`\n✅ Brief salvo: ${path.relative(ROOT, briefPath)}\n`);

// Telegram push uses mobile-first composer (NOT the raw .md — that file is for the queryable archive).
if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
  try {
    const tgText = composeDailyBriefTelegram({
      today,
      counts: pipelineCounts?.counts || [],
      upcoming: pipelineCounts?.upcoming || [],
      decisions,
      insights,
      circuit,
      costToday,
      flags,
      synthesis,
      hoursWindow: 16,
    });
    const r = await sendTelegram(tgText, { silent: false });
    if (r.ok) console.log("  ✓ Telegram push sent (mobile-first)");
    else console.log(`  ⚠ Telegram push not ok: ${JSON.stringify(r).slice(0, 200)}`);
  } catch (e) {
    console.log(`  ⚠ Telegram push failed: ${e.message.slice(0, 100)}`);
  }
} else {
  console.log("  ⚠ Telegram env not configured (skipping push)");
}
