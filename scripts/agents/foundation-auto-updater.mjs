// scripts/agents/foundation-auto-updater.mjs — Diarization #2 weekly
//
// Roda 2ª 03:00 BRT via cron. Lê:
//   - runs/_insights.db (últimos 30d métricas)
//   - runs/_audit-log.jsonl (editor decisions)
//   - foundation/{pillars,voice,strategy}.md (current state)
//
// Extrai padrões emergentes (winners por hook/persona/pillar)
// Propõe PR atualizando foundation/* (DRY-RUN — não auto-merge)
// Founder revisa + aprova PR manualmente.
//
// Princípio Tan #4: extração de padrão deterministic (SQL aggregations).
// LLM só pra REDIGIR a proposta de PR.
// Princípio Tan #5: Diarization — 1-page proposta estruturada.

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
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

const INSIGHTS_DB = path.join(ROOT, "runs", "_insights.db");
const BRIEFS_DIR = path.join(ROOT, "runs", "_briefs");
fs.mkdirSync(BRIEFS_DIR, { recursive: true });

// ─── Deterministic aggregations ─────────────────────────────────────────────
function getInsightAggregations(daysBack = 30) {
  if (!fs.existsSync(INSIGHTS_DB)) return null;
  const db = new Database(INSIGHTS_DB, { readonly: true });
  const cutoff = new Date(Date.now() - daysBack*86400000).toISOString();

  // Latest snapshot per run (mais recente vence)
  const latest = db.prepare(`
    SELECT * FROM insights
    WHERE scraped_at = (SELECT MAX(scraped_at) FROM insights i2 WHERE i2.run_id = insights.run_id)
  `).all();

  // Aggregate by pillar
  const byPillar = {};
  for (const r of latest) {
    const key = `P${r.pillar || "?"}`;
    if (!byPillar[key]) byPillar[key] = { runs: [], avg_reach: 0, avg_save_rate: 0, avg_share_rate: 0 };
    byPillar[key].runs.push(r);
  }
  for (const [k, v] of Object.entries(byPillar)) {
    const n = v.runs.length;
    v.avg_reach = v.runs.reduce((a, r) => a + (r.reach || 0), 0) / n;
    v.avg_save_rate = v.runs.reduce((a, r) => a + (r.save_rate || 0), 0) / n;
    v.avg_share_rate = v.runs.reduce((a, r) => a + (r.share_rate || 0), 0) / n;
    v.count = n;
  }

  // Top 3 e bottom 3 by save_rate
  const sorted = latest.sort((a,b) => (b.save_rate || 0) - (a.save_rate || 0));
  const winners = sorted.slice(0, 3);
  const losers = sorted.slice(-3).reverse();

  // Persona aggregation
  const byPersona = {};
  for (const r of latest) {
    const key = r.persona || "unknown";
    if (!byPersona[key]) byPersona[key] = { runs: [], avg_save: 0 };
    byPersona[key].runs.push(r);
  }
  for (const [k, v] of Object.entries(byPersona)) {
    v.avg_save = v.runs.reduce((a, r) => a + (r.save_rate || 0), 0) / v.runs.length;
    v.count = v.runs.length;
  }

  db.close();
  return { byPillar, winners, losers, byPersona, total_runs: latest.length };
}

// ─── LLM proposes PR text ────────────────────────────────────────────────────
async function proposePR(aggs) {
  if (!aggs || aggs.total_runs < 5) {
    return {
      proposed_changes: "(insufficient data — need ≥5 posts with insights to propose changes)",
      rationale: `${aggs?.total_runs || 0} runs scraped so far. Wait for more data.`,
    };
  }

  const anthropic = new Anthropic();

  const pillarsPath = path.join(ROOT, "foundation", "pillars.md");
  const voicePath = path.join(ROOT, "foundation", "voice.md");
  const pillarsCurrent = fs.existsSync(pillarsPath) ? fs.readFileSync(pillarsPath, "utf-8").slice(0, 3000) : "";

  const prompt = `Você é o Foundation Auto-Updater. Dado:

═══ AGGREGATIONS por pillar (últimos 30d) ═══
${JSON.stringify(aggs.byPillar, (k,v) => k === 'runs' ? `[${v.length} runs]` : v, 2).slice(0, 1500)}

═══ TOP 3 winners (save_rate) ═══
${aggs.winners.map(w => `${w.run_id} · P${w.pillar} · save_rate ${(w.save_rate*100).toFixed(2)}% · reach ${w.reach}`).join("\n")}

═══ BOTTOM 3 losers ═══
${aggs.losers.map(l => `${l.run_id} · P${l.pillar} · save_rate ${(l.save_rate*100).toFixed(2)}% · reach ${l.reach}`).join("\n")}

═══ AGGREGATIONS por persona ═══
${JSON.stringify(aggs.byPersona, (k,v) => k === 'runs' ? `[${v.length} runs]` : v, 2).slice(0, 1500)}

═══ foundation/pillars.md ATUAL (referência) ═══
${pillarsCurrent.slice(0, 2500)}

═══ Tarefa ═══
Proponha 1-3 ajustes CONCRETOS pra foundation/pillars.md OU foundation/voice.md baseados na evidência. Cada ajuste:
- Edit específico (não vague)
- Rationale baseado em DADO (cite save_rate, persona, etc.)
- Severidade: LOW / MEDIUM / HIGH

NÃO altere brand-truth.md (canonical). NÃO altere se dados insuficientes — diga "wait for more data".

Retorne SÓ JSON:
{
  "data_sufficiency": "<insufficient | sufficient>",
  "proposed_changes": [
    {
      "file": "foundation/pillars.md",
      "section": "<seção alvo>",
      "current_text": "<excerpt 1-2 lines>",
      "proposed_text": "<excerpt da proposta>",
      "rationale": "<dado citado>",
      "severity": "LOW|MEDIUM|HIGH"
    }
  ],
  "overall_recommendation": "<1-2 sentences high-level>"
}`;

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("\n");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { proposed_changes: "(LLM returned no JSON)", rationale: text.slice(0,300) };
  return JSON.parse(m[0]);
}

// ─── Compose proposal brief ─────────────────────────────────────────────────
function composeBrief(aggs, proposal) {
  const today = new Date().toISOString().slice(0, 10);
  let md = `# Foundation Auto-Updater Proposal · ${today}

> Diarization #2 weekly. Read-only — proposal NÃO é aplicada automaticamente.
> Founder lê + decide se aprova edit manual em foundation/.

---

## 📊 Data sample
- Runs com insights: ${aggs?.total_runs || 0}
- Date range: últimos 30 dias

`;

  if (!aggs || aggs.total_runs < 5) {
    md += `## ⏳ Insufficient data\n\n${aggs?.total_runs || 0} runs scraped. Need ≥5 pra propor mudanças baseadas em evidência.\n\n`;
    md += `Próximos passos:\n- IG insights scraper precisa rodar diariamente\n- Aguardar acumular 30d de dados\n- Re-rodar este auto-updater 2ª próxima\n`;
    return md;
  }

  md += `\n## 🏆 Top performers (save_rate)\n\n| run | pillar | save | reach |\n|---|---|---|---|\n`;
  for (const w of aggs.winners) {
    md += `| ${w.run_id} | P${w.pillar} | ${(w.save_rate*100).toFixed(2)}% | ${w.reach} |\n`;
  }

  md += `\n## 📉 Bottom performers\n\n| run | pillar | save | reach |\n|---|---|---|---|\n`;
  for (const l of aggs.losers) {
    md += `| ${l.run_id} | P${l.pillar} | ${(l.save_rate*100).toFixed(2)}% | ${l.reach} |\n`;
  }

  md += `\n## 📐 Average performance por pillar\n\n| pillar | n | avg reach | avg save% | avg share% |\n|---|---|---|---|---|\n`;
  for (const [p, v] of Object.entries(aggs.byPillar).sort()) {
    md += `| ${p} | ${v.count} | ${v.avg_reach.toFixed(0)} | ${(v.avg_save_rate*100).toFixed(2)}% | ${(v.avg_share_rate*100).toFixed(2)}% |\n`;
  }

  md += `\n## 🎯 Por persona\n\n| persona | n | avg save% |\n|---|---|---|\n`;
  for (const [p, v] of Object.entries(aggs.byPersona).sort((a,b) => b[1].avg_save - a[1].avg_save)) {
    md += `| ${p} | ${v.count} | ${(v.avg_save*100).toFixed(2)}% |\n`;
  }

  md += `\n## 🛠 Proposed changes\n\n`;
  md += `**Data sufficiency:** ${proposal.data_sufficiency}\n\n`;
  md += `**Overall:** ${proposal.overall_recommendation}\n\n`;
  if (proposal.proposed_changes && Array.isArray(proposal.proposed_changes) && proposal.proposed_changes.length) {
    for (let i = 0; i < proposal.proposed_changes.length; i++) {
      const c = proposal.proposed_changes[i];
      md += `### Proposal ${i+1} · ${c.severity} severity\n\n`;
      md += `**File:** \`${c.file}\` · section: ${c.section}\n\n`;
      md += `**Current:**\n\`\`\`\n${c.current_text}\n\`\`\`\n\n`;
      md += `**Proposed:**\n\`\`\`\n${c.proposed_text}\n\`\`\`\n\n`;
      md += `**Rationale:** ${c.rationale}\n\n`;
      md += `---\n\n`;
    }
  } else {
    md += `(no changes proposed)\n\n`;
  }

  md += `\n## ✅ Founder action items\n\n`;
  md += `1. Leia proposals acima\n`;
  md += `2. Pra cada proposal: ACCEPT (manual edit em foundation/) OU REJECT (documentar porquê)\n`;
  md += `3. Se aceitar, edit + commit + bumpa version no doc\n`;
  md += `4. Próximo auto-update: ${new Date(Date.now() + 7*86400000).toISOString().slice(0,10)}\n`;

  return md;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
console.log("\n📊 Foundation Auto-Updater (Diarization #2) weekly\n");

const aggs = getInsightAggregations(30);
console.log(`  ✓ ${aggs?.total_runs || 0} runs com insights aggregated`);

console.log(`  ⏳ Gerando proposal via LLM...`);
const proposal = await proposePR(aggs);

const md = composeBrief(aggs, proposal);
const today = new Date().toISOString().slice(0, 10);
const briefPath = path.join(BRIEFS_DIR, `foundation-auto-updater-${today}.md`);
fs.writeFileSync(briefPath, md);

console.log(`\n✅ Proposal salvo: ${path.relative(ROOT, briefPath)}\n`);
console.log(`   ${proposal.data_sufficiency === "sufficient" ? `${proposal.proposed_changes?.length || 0} proposed changes` : "insufficient data"}`);
