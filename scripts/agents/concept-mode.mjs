// scripts/agents/concept-mode.mjs — "Só a ideia" mode.
//
// Vs remix-mode: this mode IGNORES the original post structure. It takes only
// the TOPIC + persona + pillar, and generates a 100% Longevify-native draft
// using ONE of the 5 standard patterns (LLM-picked from topic).
//
// Flow (mirrors remix-mode but with different prompt):
//   1. Read idea row from ideas_backlog
//   2. Claude (sonnet) call: topic → chosen_pattern + Longevify draft
//   3. Create runs/<new_runId>/idea.md + content-object.md
//   4. INSERT into pipeline.db (state=draft)
//   5. Dispatch content-generator --run <new_runId>
//   6. Mark idea row use_mode=concept-only + promoted_to_run_id
//   7. Trigger telegram-approval --notify <new_runId> --force
//
// CLI:
//   node scripts/agents/concept-mode.mjs --idea <id>

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import Database from "better-sqlite3";
import Anthropic from "@anthropic-ai/sdk";
import { getIdea, setIdeaStatus } from "./idea-ingester.mjs";
import { runFullPipeline } from "./pipeline-helpers.mjs";

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
const PIPELINE_DB = path.join(ROOT, "runs", "_pipeline.db");
const BRAND_TRUTH = path.join(ROOT, "foundation", "stores", "voice-rules.md");
const CFM = path.join(ROOT, "foundation", "compliance", "cfm-restricted.md");
const SLOP = path.join(ROOT, "foundation", "compliance", "avoid-slop.yaml");

const PATTERN_MAP = {
  "persona-bio-case-study":      { type: "persona-bio",        format: "carousel" },
  "dado-punch-bryan-style":      { type: "dado-punch",         format: "image"    },
  "brand-manifesto":             { type: "premium-manifesto",  format: "carousel" },
  "biomarker-gap":               { type: "biomarker-gap",      format: "carousel" },
  "reel-tips-hold-to-reveal":    { type: "reel-tips",          format: "reel"     },
};
// Patterns excluded from LLM auto-pick — quarantined until visual template rewritten.
const PATTERN_EXCLUDED_FROM_AUTOPICK = new Set(["reel-tips-hold-to-reveal"]);

function audit(entry) {
  fs.mkdirSync(path.dirname(AUDIT_LOG), { recursive: true });
  fs.appendFileSync(AUDIT_LOG, JSON.stringify({ ts: new Date().toISOString(), agent: "concept-mode", ...entry }) + "\n");
}
function readSafe(p, limit = 3000) {
  if (!fs.existsSync(p)) return "";
  try { return fs.readFileSync(p, "utf-8").slice(0, limit); } catch { return ""; }
}
function genRunId(brand, persona, pillar) {
  const today = new Date().toISOString().slice(0, 10);
  const seq = String(Math.floor(Math.random() * 900) + 100);
  const slug = `${brand}-concept-${persona}-p${pillar}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${today}-${seq}-${slug}`.slice(0, 80);
}

// Extracts a 1-2 sentence TOPIC summary from the original caption (LLM-free heuristic).
// Use as the "concept" input — the LLM then generates Longevify-native content from scratch.
function extractTopic(originalCaption) {
  if (!originalCaption) return "";
  // First non-empty sentence, capped at 240 chars.
  const first = originalCaption.split(/[.!?\n]/).map(s => s.trim()).find(s => s.length > 15) || originalCaption;
  return first.slice(0, 240);
}

async function callClaudeConcept(idea) {
  const voice = readSafe(BRAND_TRUTH, 4000);
  const cfm = readSafe(CFM, 1500);
  const slop = readSafe(SLOP, 1500);
  const anthropic = new Anthropic();

  const topic = extractTopic(idea.original_caption);

  const prompt = `Você é o gerador de conteúdo Longevify modo "só a ideia". Recebeu um TÓPICO inspirado em outro post mas NÃO copia estrutura. Gera carrossel/post 100% Longevify-native do zero.

═══ TÓPICO (inspiração, NÃO estrutura) ═══
${topic}

═══ SOURCE CAPTION COMPLETO (fonte única de fatos verificáveis) ═══
${idea.original_caption}

(Brand original do post: ${idea.source_brand}. Use só como referência de espaço temático — NUNCA copie estrutura, hook, ou organização.)

═══ REGRA DE GROUNDING (NÃO-NEGOCIÁVEL) ═══
- USE APENAS estatísticas, números, percentuais e citações PRESENTES no source caption acima.
- NÃO adicione fatos do seu training (mesmo que plausíveis ou clinicamente corretos).
- Se precisar suportar uma claim sem suporte na source → OMITA. Qualidade > volume.
- Termos médicos consagrados (ApoB, hs-CRP, HbA1c, faixa funcional) são OK porque são CONCEITOS, não stats.
- Stats genéricos populacionais (ex: faixa funcional 40-60 ng/mL) são OK SE coerentes com canon Longevify (foundation/*).
- Numbers in output que NÃO estão no source caption serão flagged como hallucinated e bloqueiam approval.

Você DEVE declarar quais stats você USOU do source no campo 'source_stats_used'.

═══ VOICE / BRAND-TRUTH ═══
${voice}

═══ CFM-SAFE ═══
${cfm}

═══ AVOID-SLOP ═══
${slop}

═══ TARGET ═══
- Persona: ${idea.persona_suggested}
- Pillar: P${idea.pillar_suggested}
- Voice: Mito + Aesop. Sem self-help, sem fear, sem promessa de cura.
- Em-dash ≤1 por caption.
- CFM-safe: "suporta", "otimiza", "calibra" — nunca "cura", "trata", "previne doença".
- Português brasileiro. Termos médicos em inglês permitidos (ApoB, hs-CRP, etc).

═══ PATTERN — escolha UM dos 4 ═══

REGRA DE OURO: tópico rico (≥3 sub-pontos relacionados) → CARROSSEL.
                tópico compacto (1 dado central, 1 frase) → dado-punch.

- "dado-punch-bryan-style"   — SINGLE IMAGE. SÓ se: 1 dado central (ex: 73%, 5x, 500mi) + 1 frase impacto Mito-style + ZERO sub-pontos que precisariam de slide próprio. Se o tópico tem múltiplos ângulos (sintomas + mecanismo + protocolo + CTA), NÃO use. Default é carrossel quando ambíguo.
- "biomarker-gap"            — CARROSSEL 5 slides. Sintoma → biomarcador escondido → faixa populacional vs funcional → protocolo → manifesto. Bate com qualquer tópico de "exame normal mas sensação ruim" / "marcador específico" / "eixo X-Y" (ex: eixo intestino-cérebro, vit D, ferritina).
- "persona-bio-case-study"   — CARROSSEL 6 slides. Narrativa pessoa concreta (Maria/Julia/Pedro/Ana) com sintoma → painel → protocolo → resultado em 6 sem.
- "brand-manifesto"          — CARROSSEL 5 slides. Manifesto/posicionamento/filosofia editorial. Bate com tópico de framing macro (modelo convencional vs Longevify, faixa funcional como categoria, ApoB vs colesterol).

VIESES A EVITAR:
- NÃO escolha dado-punch só porque o original tem um número. Pergunta: "esse número aguenta sozinho 1 slide inteiro sem precisar de contexto?". Se não, carrossel.
- NÃO escolha persona-bio se o tópico é abstrato (sem pessoa concreta).
- biomarker-gap é o coringa pra tópicos técnicos com ≥3 pontos.

═══ OUTPUT: JSON ÚNICO ═══
{
  "chosen_pattern": "<one of 4 above>",
  "pattern_reason": "<1 sentence>",
  "headline": "<4-6 words, paradoxo/biológico>",
  "sub_headline": "<oferta de produto/protocolo, max 12 palavras>",
  "caption_full": "<800-1200 chars pt-BR, formato Longevify, NÃO copia estrutura do original>",
  "cover_variant": "copacabana-woman-A" | "sp-restaurant-still-life-A" | "br-executive-lunch-cgm-B" | "generic-br-premium",
  "concept_notes": "<1 sentence: o que pegou do tópico + por que esse pattern>",
  "source_stats_used": ["<lista das stats verbatim copiadas do source caption — ex: '95% serotonina', '70% sistema imune'. SE NENHUMA stat do source foi usada, [].>"]
}

REGRA JSON CRÍTICA: dentro de qualquer valor string (especialmente caption_full), JAMAIS use aspas duplas (\"). Se precisar destacar palavras use aspas simples ('') ou curvas (« »). Quebras de linha = \\n literal. Caractere \\ não permitido salvo \\n.

Retorne SÓ o JSON.`;

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 3500,
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("\n");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Claude returned no JSON: " + text.slice(0, 300));
  const parsed = parseLlmJsonResilient(m[0]);
  if (!parsed) throw new Error("LLM JSON unparseable after sanitization: " + text.slice(0, 300));
  const cost = ((msg.usage?.input_tokens ?? 0) / 1e6) * 3 + ((msg.usage?.output_tokens ?? 0) / 1e6) * 15;
  return { ...parsed, _cost_usd: cost, _topic: topic };
}

// Best-effort JSON parse: try direct, then heuristic escape of stray `"` inside string values.
function parseLlmJsonResilient(jsonText) {
  try { return JSON.parse(jsonText); } catch {}
  // Heuristic: walk chars, track if we're inside a string value (after `:` until matching `"`).
  // Inside a string, escape any `"` that isn't followed by `,` or `\n` or `\s*}` (close of string).
  let s = jsonText;
  let out = "";
  let inStringVal = false;
  let escapeNext = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escapeNext) { out += c; escapeNext = false; continue; }
    if (c === "\\") { out += c; escapeNext = true; continue; }
    if (!inStringVal) {
      out += c;
      if (c === ":" ) {
        // Skip whitespace.
        let j = i + 1;
        while (j < s.length && /\s/.test(s[j])) { out += s[j]; j++; }
        if (s[j] === "\"") { inStringVal = true; out += "\""; i = j; }
      }
      continue;
    }
    // Inside string value
    if (c === "\"") {
      // Look ahead: if next non-space is `,` `}` or `]` or newline-then-key — it's the closing.
      let k = i + 1;
      while (k < s.length && /[\s\n]/.test(s[k])) k++;
      if (k >= s.length || s[k] === "," || s[k] === "}" || s[k] === "]") {
        out += "\""; inStringVal = false; continue;
      }
      // Otherwise treat as literal: escape it.
      out += "\\\"";
      continue;
    }
    out += c;
  }
  try { return JSON.parse(out); } catch (e) {
    console.error("parseLlmJsonResilient failed:", e.message.slice(0, 200));
    return null;
  }
}

async function main() {
  const a = process.argv.slice(2);
  const idx = a.indexOf("--idea");
  if (idx < 0 || !a[idx + 1]) {
    console.error("Usage: concept-mode.mjs --idea <id> [--pattern <name>]");
    process.exit(1);
  }
  const ideaId = parseInt(a[idx + 1]);
  // Optional --pattern override: founder can force a specific pattern (e.g. when
  // re-applying after a bad auto-pick). Must match one of PATTERN_MAP keys.
  const pIdx = a.indexOf("--pattern");
  const forcedPattern = pIdx >= 0 && a[pIdx + 1] ? a[pIdx + 1] : null;
  if (forcedPattern && !PATTERN_MAP[forcedPattern]) {
    console.error(`Unknown --pattern '${forcedPattern}'. Valid: ${Object.keys(PATTERN_MAP).join(", ")}`);
    process.exit(1);
  }
  const idea = getIdea(ideaId);
  if (!idea) { console.error(`idea #${ideaId} not found`); process.exit(1); }

  console.log(`\n💡 Concept-mode for idea #${ideaId} (${idea.source_brand}, persona ${idea.persona_suggested}, P${idea.pillar_suggested})...`);

  const result = await callClaudeConcept(idea);
  console.log(`  ✓ Claude concept done ($${result._cost_usd.toFixed(4)}) · pattern=${result.chosen_pattern}`);
  audit({ event: "concept_llm_done", idea_id: ideaId, cost_usd: result._cost_usd, chosen_pattern: result.chosen_pattern });

  let chosenPattern = result.chosen_pattern && PATTERN_MAP[result.chosen_pattern]
    ? result.chosen_pattern : "persona-bio-case-study";
  if (PATTERN_EXCLUDED_FROM_AUTOPICK.has(chosenPattern)) {
    console.log(`  ⚠ Claude picked excluded pattern '${chosenPattern}' — fallback biomarker-gap`);
    audit({ event: "pattern_excluded_fallback", original: chosenPattern, fallback: "biomarker-gap", idea_id: ideaId });
    chosenPattern = "biomarker-gap";
  }
  // --pattern <name> CLI override wins over Claude pick.
  if (forcedPattern) {
    console.log(`  🔧 --pattern override: ${chosenPattern} → ${forcedPattern}`);
    audit({ event: "pattern_forced", original: chosenPattern, forced: forcedPattern, idea_id: ideaId });
    chosenPattern = forcedPattern;
  }
  const { type: patternType, format: patternFormat } = PATTERN_MAP[chosenPattern];

  const runId = genRunId(idea.source_brand, idea.persona_suggested, idea.pillar_suggested);
  const runDir = path.join(ROOT, "runs", runId);
  fs.mkdirSync(path.join(runDir, "assets"), { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const cover_variant = result.cover_variant || "generic-br-premium";

  fs.writeFileSync(path.join(runDir, "idea.md"), `---
content_object: ${runId}
route: concept-only
source_idea_id: ${ideaId}
source_url: ${idea.source_url}
source_brand: ${idea.source_brand}
pillar: ${idea.pillar_suggested}
format: ${patternFormat}
target_persona: ${idea.persona_suggested}
type: ${patternType}
pattern: ${chosenPattern}
created_at: ${today}
---

# ${runId}

**Headline hint:** ${result.headline}

**Brief:**
${result.caption_full}

**Concept notes:**
${result.concept_notes}

(Topic seed from idea #${ideaId}: ${result._topic})
`);

  fs.writeFileSync(path.join(runDir, "content-object.md"), `---
id: ${runId}
route: concept-only
state: draft
pillar: ${idea.pillar_suggested}
format: ${patternFormat}
platforms: [instagram]
created_at: ${today}
target_persona: ${idea.persona_suggested}
pattern: ${chosenPattern}
source_idea_id: ${ideaId}
source_url: ${idea.source_url}
source_brand: ${idea.source_brand}
cover_variant: ${cover_variant}
---

# ${result.headline}

## TL;DR
${result.sub_headline}

## Caption
${result.caption_full}

## Concept notes
${result.concept_notes}
`);

  // INSERT into pipeline.db
  if (fs.existsSync(PIPELINE_DB)) {
    const db = new Database(PIPELINE_DB);
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS runs (run_id TEXT PRIMARY KEY, state TEXT NOT NULL, created_at TEXT, updated_at TEXT, scheduled_for TEXT, persona TEXT, pillar INTEGER, format TEXT, last_action TEXT, failure_reason TEXT, retry_count INTEGER DEFAULT 0);`);
      db.prepare(`INSERT INTO runs (run_id, state, created_at, updated_at, scheduled_for, persona, pillar, format) VALUES (?, 'draft', ?, ?, NULL, ?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET updated_at = excluded.updated_at`)
        .run(runId, new Date().toISOString(), new Date().toISOString(), idea.persona_suggested, idea.pillar_suggested, patternFormat);
      console.log(`  ✓ pipeline.db inserted`);
    } finally { db.close(); }
  }

  // Full pipeline via shared helper — guarantees no half-rendered notify.
  const pipelineResult = await runFullPipeline(runId, { source: "concept-mode", reviewer: `idea-${ideaId}`, sourceIdeaId: ideaId });
  if (!pipelineResult.ok) {
    console.error(`\n✗ Concept pipeline failed at step '${pipelineResult.failed_at}': ${pipelineResult.error?.slice(0, 200)}`);
    setIdeaStatus(ideaId, "failed", { promoted_to_run_id: runId, remix_decision: "concept-failed", use_mode: "concept-only" });
    process.exit(1);
  }

  setIdeaStatus(ideaId, "remixed", { promoted_to_run_id: runId, remix_decision: "concept", use_mode: "concept-only" });
  console.log(`\n💡 Concept done: idea #${ideaId} → run ${runId} (pattern=${chosenPattern}, ${pipelineResult.asset_count} slides)\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
