// scripts/agents/cross-version-diarization.mjs — Diarization #3 (Tan principle #5)
//
// READ-ONLY. Não modifica nenhum arquivo.
// Lê 3 repos:
//   - CEO project:    /Users/mathe/Documents/Longev/Claude Code/CEO/contexto/
//   - Brand CC:       /Users/mathe/Documents/Longev/Brand CC/ (lê só docs canônicos)
//   - content-machine: este repo (foundation/ + CLAUDE.md + LONGEVIFY_PILLARS.md)
//
// Extrai claims sobre: ICP, posicionamento, tiers, voice, pilares, concorrentes, hero feature.
// Detecta conflitos entre fontes (DECLARADO vs OPERACIONAL via runs/ recentes).
// Output: 1-page brief em runs/_briefs/cross-version-YYYY-MM-DD.md
//
// CLI: node scripts/agents/cross-version-diarization.mjs

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
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

const CEO_DIR = "/Users/mathe/Documents/Longev/Claude Code/CEO/contexto";
const BRAND_CC = "/Users/mathe/Documents/Longev/Brand CC";
const CM_ROOT = ROOT;

const BRIEFS_DIR = path.join(ROOT, "runs", "_briefs");
fs.mkdirSync(BRIEFS_DIR, { recursive: true });

// ─── Load canonical docs (POINTERS only — read content sob demanda) ──────────
function loadIfExists(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : null;
}

function gatherSources() {
  return {
    ceo: {
      brand_truth: loadIfExists(path.join(CEO_DIR, "brand-truth.md")),
      icp: loadIfExists(path.join(CEO_DIR, "icp.md")),
      posicionamento: loadIfExists(path.join(CEO_DIR, "posicionamento.md")),
      modelo_negocio: loadIfExists(path.join(CEO_DIR, "modelo-de-negocio.md")),
      empresa: loadIfExists(path.join(CEO_DIR, "empresa.md")),
    },
    brand_cc: {
      brand_md: loadIfExists(path.join(BRAND_CC, "LONGEVIFY_BRAND.md")),
    },
    content_machine: {
      claude_md: loadIfExists(path.join(CM_ROOT, "CLAUDE.md")),
      pillars_root: loadIfExists(path.join(CM_ROOT, "LONGEVIFY_PILLARS.md")),
      strategy: loadIfExists(path.join(CM_ROOT, "foundation/strategy.md")),
      pillars: loadIfExists(path.join(CM_ROOT, "foundation/pillars.md")),
      voice: loadIfExists(path.join(CM_ROOT, "foundation/voice.md")),
      skills_inventory: loadIfExists(path.join(CM_ROOT, "foundation/skills-inventory.md")),
    },
  };
}

// ─── Gather OPERATIONAL evidence (last 30d runs) ─────────────────────────────
function gatherOperationalEvidence() {
  const runsDir = path.join(CM_ROOT, "runs");
  if (!fs.existsSync(runsDir)) return { count: 0, breakdown: {} };
  const dirs = fs.readdirSync(runsDir)
    .filter(d => /^\d{4}-\d{2}-\d{2}/.test(d))
    .sort();

  const breakdown = { by_pillar: {}, by_persona: {}, by_format: {}, by_state: {} };
  const recent = [];
  for (const dir of dirs) {
    const coPath = path.join(runsDir, dir, "content-object.md");
    if (!fs.existsSync(coPath)) continue;
    const co = fs.readFileSync(coPath, "utf-8");
    const pillar = (co.match(/^pillar:\s*(\d+)/m) ?? [, "?"])[1];
    const persona = (co.match(/^target_persona:\s*(\S+)/m) ?? [, "unknown"])[1];
    const format = (co.match(/^format:\s*(\S+)/m) ?? [, "?"])[1];
    const state = (co.match(/^state:\s*(\S+)/m) ?? [, "?"])[1];
    breakdown.by_pillar[pillar] = (breakdown.by_pillar[pillar] ?? 0) + 1;
    breakdown.by_persona[persona] = (breakdown.by_persona[persona] ?? 0) + 1;
    breakdown.by_format[format] = (breakdown.by_format[format] ?? 0) + 1;
    breakdown.by_state[state] = (breakdown.by_state[state] ?? 0) + 1;
    recent.push({ id: dir, pillar, persona, format, state });
  }
  return { count: dirs.length, breakdown, recent: recent.slice(-15) };
}

// ─── Compose LLM prompt ──────────────────────────────────────────────────────
async function diarize(sources, operational) {
  const anthropic = new Anthropic();

  const prompt = `Você é o Cross-Version Diarization agent do Longevify. Tarefa: ler claims de 3 fontes DECLARATIVAS (CEO, Brand CC, content-machine) + evidência OPERACIONAL (runs/), e produzir brief 1-page detectando:

1. Versão dominante em PRODUÇÃO (baseado em N runs publicados)
2. Versão dominante em DOCS ESTRATÉGICOS (declarações canonical)
3. Conflitos entre fontes (lista específica)
4. Drift entre declared vs operational (gap em pillar mix, persona mix, voice tone)
5. Recomendação: sync action específica

═══ CEO project — brand-truth.md ═══
${sources.ceo.brand_truth ? sources.ceo.brand_truth.slice(0, 4000) : "(ausente)"}

═══ CEO project — icp.md (excerpt) ═══
${sources.ceo.icp ? sources.ceo.icp.slice(0, 2000) : "(ausente)"}

═══ CEO project — modelo-de-negocio.md (excerpt) ═══
${sources.ceo.modelo_negocio ? sources.ceo.modelo_negocio.slice(0, 1500) : "(ausente)"}

═══ Brand CC — LONGEVIFY_BRAND.md (excerpt) ═══
${sources.brand_cc.brand_md ? sources.brand_cc.brand_md.slice(0, 3000) : "(ausente)"}

═══ content-machine — CLAUDE.md (topo) ═══
${sources.content_machine.claude_md ? sources.content_machine.claude_md.slice(0, 2000) : "(ausente)"}

═══ content-machine — foundation/strategy.md ═══
${sources.content_machine.strategy ? sources.content_machine.strategy.slice(0, 3000) : "(ausente)"}

═══ content-machine — foundation/voice.md (excerpt) ═══
${sources.content_machine.voice ? sources.content_machine.voice.slice(0, 2000) : "(ausente)"}

═══ EVIDÊNCIA OPERACIONAL — últimos ${operational.count} runs ═══
Distribuição PILLAR: ${JSON.stringify(operational.breakdown.by_pillar)}
Distribuição PERSONA: ${JSON.stringify(operational.breakdown.by_persona)}
Distribuição FORMAT: ${JSON.stringify(operational.breakdown.by_format)}
Distribuição STATE: ${JSON.stringify(operational.breakdown.by_state)}
Recent runs sample: ${JSON.stringify(operational.recent.slice(-10), null, 1).slice(0, 1500)}

═══ FORMATO OUTPUT ═══
Markdown 1-page (target 600-1000 palavras). Headers H2. Tom: sóbrio, factual, sem opinião sobre estética. Foco em FATOS + GAPS detectados.

Estrutura obrigatória:
## 1. Versão dominante em DOCS estratégicos
## 2. Versão dominante em PRODUÇÃO (baseado em runs)
## 3. Conflitos detectados (lista numerada com fonte vs fonte)
## 4. Drift declared vs operational (gap em pillar mix, persona mix)
## 5. Recomendações de sync (3-5 ações específicas, ordem de prioridade)
## 6. Saúde geral (1 emoji + 1 sentence)

NÃO inclua copy de marketing. NÃO opinião subjetiva. SÓ fato + gap.`;

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 3000,
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("\n");
  const inputTokens = msg.usage?.input_tokens ?? 0;
  const outputTokens = msg.usage?.output_tokens ?? 0;
  const cost = (inputTokens / 1e6) * 3 + (outputTokens / 1e6) * 15;
  return { brief: text, cost, tokens: { in: inputTokens, out: outputTokens } };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
console.log("🔍 Cross-version Diarization (read-only) ...\n");
const startMs = Date.now();

const sources = gatherSources();
console.log(`  ✓ Sources gathered (CEO/${Object.values(sources.ceo).filter(Boolean).length}, BrandCC/${Object.values(sources.brand_cc).filter(Boolean).length}, CM/${Object.values(sources.content_machine).filter(Boolean).length})`);

const operational = gatherOperationalEvidence();
console.log(`  ✓ Operational evidence: ${operational.count} runs scanned`);

console.log(`  ⏳ Calling Claude for diarization...`);
const result = await diarize(sources, operational);

const today = new Date().toISOString().slice(0, 10);
const briefPath = path.join(BRIEFS_DIR, `cross-version-${today}.md`);
const header = `# Cross-Version Diarization · ${today}

> Read-only diarization (Tan principle #5). Auto-gerado pelo content-machine.
> Custo: $${result.cost.toFixed(4)} · Tempo: ${((Date.now() - startMs) / 1000).toFixed(1)}s

---

`;
fs.writeFileSync(briefPath, header + result.brief);

console.log(`\n✅ Brief salvo: ${path.relative(ROOT, briefPath)}\n`);
console.log(`   Cost: $${result.cost.toFixed(4)} · tokens in/out: ${result.tokens.in}/${result.tokens.out}`);
console.log(`   Tempo: ${((Date.now() - startMs) / 1000).toFixed(1)}s\n`);
