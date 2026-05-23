// scripts/agents/editor-agent.mjs — Editor agent v1 (latent vs deterministic)
//
// Princípio Tan #4: "Determinístico filtra o óbvio. LLM resolve o ambíguo. Nunca o contrário."
//
// 5 estágios em ordem (qualquer um falhar = reject sem chamar LLM):
//   1. Avoid-slop scan        (deterministic regex/YAML)
//   2. Compliance scan        (deterministic CFM/Procon)
//   3. Persona fit            (deterministic keywords + LLM ambiguous)
//   4. Hook strength          (deterministic chars/patterns + LLM ambiguous)
//   5. Rubric 0-12            (LLM final pass com Zod schema)
//
// Output: JSON estruturado (Zod-validated)
//   { decision: APPROVE | REVISE | REJECT | ESCALATE, score: 0-12, reasons: [...] }
//
// Audit log: cada decisão registrada em runs/_audit-log.jsonl
//
// Circuit breaker:
//   - Cost: aborta se > $0.50/post
//   - Quality: aborta se 5 consecutivos REJECT
//   - Compliance: ESCALATE em hit zero-tolerance
//
// CLI:
//   node scripts/agents/editor-agent.mjs --run <run-id>
//   node scripts/agents/editor-agent.mjs --text "..." --persona maria

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import YAML from "yaml";
import { scanAvoidSlop } from "./avoid-slop-scan.mjs";
import { scanCompliance } from "./compliance-scan.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");

// Manual .env loader
const ENV_PATH = path.join(ROOT, ".env");
if (fs.existsSync(ENV_PATH)) {
  for (const line of fs.readFileSync(ENV_PATH, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const AUDIT_LOG = path.join(ROOT, "runs", "_audit-log.jsonl");
const VOICE_MD = path.join(ROOT, "foundation", "voice.md");
const PILLARS_MD = path.join(ROOT, "foundation", "pillars.md");

// ─── Zod schema pra output do editor ──────────────────────────────────────────
const EditorDecisionSchema = z.object({
  decision: z.enum(["APPROVE", "REVISE", "REJECT", "ESCALATE"]),
  score: z.number().int().min(0).max(12),
  stages: z.object({
    avoid_slop: z.object({ pass: z.boolean(), violations: z.array(z.any()), deduction: z.number() }),
    compliance: z.object({ pass: z.boolean(), violations: z.array(z.any()), escalation: z.string().nullable() }),
    persona_fit: z.object({ pass: z.boolean(), persona: z.string(), confidence: z.number(), reasoning: z.string() }),
    hook_strength: z.object({ score: z.number().int().min(0).max(3), reasoning: z.string() }),
    rubric: z.object({ pillar: z.number(), voice: z.number(), avoid_slop: z.number(), hook: z.number(), total: z.number() }),
  }),
  reasons: z.array(z.string()),
  fix_suggestions: z.array(z.string()).nullable(),
  cost_usd: z.number(),
  duration_ms: z.number(),
});

// ─── Circuit breaker state ────────────────────────────────────────────────────
const CIRCUIT_STATE_PATH = path.join(ROOT, "runs", "_circuit-state.json");

function readCircuitState() {
  if (!fs.existsSync(CIRCUIT_STATE_PATH)) return { state: "CLOSED", reject_streak: 0, cost_today: 0, cost_today_date: null };
  return JSON.parse(fs.readFileSync(CIRCUIT_STATE_PATH, "utf-8"));
}

function writeCircuitState(s) {
  fs.mkdirSync(path.dirname(CIRCUIT_STATE_PATH), { recursive: true });
  fs.writeFileSync(CIRCUIT_STATE_PATH, JSON.stringify(s, null, 2));
}

function checkCircuit() {
  const s = readCircuitState();
  const today = new Date().toISOString().slice(0, 10);
  if (s.cost_today_date !== today) {
    s.cost_today = 0;
    s.cost_today_date = today;
    writeCircuitState(s);
  }
  if (s.state === "OPEN") {
    throw new Error(`Circuit OPEN: ${s.reason || "unknown"}. Manually close after fix: write {state: CLOSED} to ${CIRCUIT_STATE_PATH}`);
  }
  if (s.cost_today > 50) {
    s.state = "OPEN";
    s.reason = `cost circuit breaker: $${s.cost_today.toFixed(2)} > $50/day`;
    writeCircuitState(s);
    throw new Error(s.reason);
  }
  return s;
}

function updateCircuit({ decisionType, costUsd }) {
  const s = readCircuitState();
  s.cost_today = (s.cost_today || 0) + costUsd;
  if (decisionType === "REJECT") s.reject_streak = (s.reject_streak || 0) + 1;
  else s.reject_streak = 0;

  if (s.reject_streak >= 5) {
    s.state = "OPEN";
    s.reason = "quality circuit breaker: 5 consecutive REJECTs";
  }
  writeCircuitState(s);
}

// ─── Audit log ───────────────────────────────────────────────────────────────
function logAudit(entry) {
  fs.mkdirSync(path.dirname(AUDIT_LOG), { recursive: true });
  fs.appendFileSync(AUDIT_LOG, JSON.stringify(entry) + "\n");
}

// ─── Stage 3: Persona fit (strong/weak weighted + LLM tiebreaker) ────────────
// Carrega persona-keywords.yaml v1.0 — strong=3pts, weak=1pt
const PERSONA_KW_PATH = path.join(ROOT, "foundation", "persona-keywords.yaml");
const PERSONA_KW = fs.existsSync(PERSONA_KW_PATH)
  ? YAML.parse(fs.readFileSync(PERSONA_KW_PATH, "utf-8"))
  : null;

function detectPersonaDeterministic(text) {
  const lower = text.toLowerCase();
  const scores = {};
  const breakdown = {};

  for (const persona of ["maria", "julia", "pedro", "ana"]) {
    const p = PERSONA_KW?.[persona];
    if (!p) { scores[persona] = 0; continue; }
    let strong = 0, weak = 0;
    const strongHits = [], weakHits = [];
    for (const sig of p.strong_signals ?? []) {
      if (lower.includes(sig.toLowerCase())) { strong++; strongHits.push(sig); }
    }
    for (const sig of p.weak_signals ?? []) {
      if (lower.includes(sig.toLowerCase())) { weak++; weakHits.push(sig); }
    }
    scores[persona] = strong * 3 + weak * 1;
    breakdown[persona] = { strong_count: strong, weak_count: weak, strong_hits: strongHits, weak_hits: weakHits };
  }

  // Ranking
  const sorted = Object.entries(scores).sort((a,b) => b[1] - a[1]);
  const top = sorted[0];
  const runner = sorted[1];

  // Detecta empate em weak only (todas strong=0, dois ou mais empatados em weak score)
  const topPersonaName = top[0];
  const topBd = breakdown[topPersonaName];
  const tieOnWeak = top[1] > 0
    && top[1] === runner[1]
    && topBd.strong_count === 0
    && breakdown[runner[0]].strong_count === 0;

  // Cold call (zero matches em todas)
  const coldCall = top[1] === 0;

  return {
    persona: top[0],
    score: top[1],
    scores,
    breakdown,
    tie_on_weak: tieOnWeak,
    cold_call: coldCall,
    requires_llm_tiebreak: tieOnWeak || coldCall,
  };
}

async function personaLLMTiebreak({ text, detResult }) {
  const candidates = detResult.tie_on_weak
    ? [detResult.persona, ...Object.keys(detResult.scores).filter(p => p !== detResult.persona && detResult.scores[p] === detResult.score)]
    : ["maria", "julia", "pedro", "ana"];

  const personaDescriptions = candidates.map(p => `- ${p}: ${PERSONA_KW?.[p]?.description ?? "(no description)"}`).join("\n");

  const prompt = `Você é o detector de persona da Longevify. 4 personas oficiais:

${personaDescriptions}

═══ DRAFT ═══
${text.slice(0, 2000)}

═══ DETERMINISTIC RESULT ═══
${detResult.tie_on_weak ? `Empate em weak signals entre: ${candidates.join(", ")}.` : "Zero matches deterministic — cold call."}
Breakdown: ${JSON.stringify(detResult.breakdown, null, 2).slice(0, 800)}

Qual persona é a alvo mais provável deste draft? Retorne SÓ:
{"persona": "<maria|julia|pedro|ana>", "confidence": <0-1>, "reasoning": "<1-2 sentences>"}`;

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 400,
    messages: [{ role: "user", content: prompt }],
  });
  const text2 = msg.content.filter(b => b.type === "text").map(b => b.text).join("\n");
  const m = text2.match(/\{[\s\S]*\}/);
  if (!m) return { persona: detResult.persona, confidence: 0, reasoning: "LLM failed to return JSON" };
  const parsed = JSON.parse(m[0]);
  const cost = ((msg.usage?.input_tokens ?? 0) / 1e6) * 3 + ((msg.usage?.output_tokens ?? 0) / 1e6) * 15;
  return { ...parsed, cost_usd: cost, llm_tiebreak: true };
}

// ─── Stage 4: Hook strength (det chars/patterns + LLM) ────────────────────────
function hookStrengthDeterministic(text) {
  const firstLine = (text.split("\n").find(l => l.trim().length > 0) || "").trim();
  const charCount = firstLine.length;
  const hasParadox = /≠|nunca|sempre|mesmo|apesar/i.test(firstLine);
  const hasNumber = /\d/.test(firstLine);
  const hasQuestion = /\?/.test(firstLine);
  const hasItalic = /\*[^*]+\*/.test(firstLine);

  let score = 0;
  if (charCount >= 20 && charCount <= 80) score += 1;
  if (hasParadox) score += 1;
  if (hasNumber) score += 1;
  if (hasQuestion) score += 0.5;
  if (hasItalic) score += 0.5;

  return { first_line: firstLine, char_count: charCount, has_paradox: hasParadox, has_number: hasNumber, has_question: hasQuestion, det_score: Math.min(3, Math.round(score)) };
}

// ─── Anthropic client ─────────────────────────────────────────────────────────
const anthropic = new Anthropic();

// ─── Stage 5: Rubric 0-12 via LLM ─────────────────────────────────────────────
async function llmRubric({ text, persona, slopResult, complianceResult, hookDet }) {
  const voice = fs.readFileSync(VOICE_MD, "utf-8").slice(0, 4000);
  const pillars = fs.readFileSync(PILLARS_MD, "utf-8").slice(0, 3000);

  const prompt = `Você é o editor sênior da Longevify. Avalie o draft abaixo contra a rubrica 0-12.

═══ DRAFT ═══
${text}

═══ PERSONA ALVO (detected) ═══
${persona}

═══ DETERMINISTIC RESULTS (já passados) ═══
Avoid-slop: ${slopResult.action} (${slopResult.violations.length} violations, deduction ${slopResult.score_deduction})
Compliance: ${complianceResult.action} (escalation: ${complianceResult.escalation || "none"})
Hook det: first_line ${hookDet.char_count} chars · paradox=${hookDet.has_paradox} · number=${hookDet.has_number} · det_score=${hookDet.det_score}/3

═══ VOICE/PILLARS REFERENCE (resumido) ═══
${voice.slice(0, 1500)}
${pillars.slice(0, 1500)}

═══ RUBRICA ═══
Cada item: 0 (falha) | 1 (parcial) | 2 (bom) | 3 (excepcional)
1. Pillar alignment — claramente em 1 dos 6 pilares?
2. Voice alignment — soa Longevify ou genérico?
3. Avoid-slop pass — passou no deterministic (já está acima — confirme)
4. Hook strength — segura 2s? (use deterministic det_score como base)

═══ OUTPUT (JSON SÓ) ═══
{
  "pillar": <int 0-3>,
  "voice": <int 0-3>,
  "avoid_slop": <int 0-3 — baseado no deterministic result>,
  "hook": <int 0-3 — baseado em det_score + julgamento de interesse>,
  "total": <sum>,
  "decision": "APPROVE | REVISE | REJECT | ESCALATE",
  "reasoning": "<2-3 sentences explicando a decisão>",
  "fix_suggestions": ["<sugestão concreta 1>", "<concreta 2>"]
}

Decision rules:
- total >= 9 → APPROVE
- total 6-8 → REVISE (fixable)
- total < 6 → REJECT
- ESCALATE só se compliance flag pediu OR voice drift severo`;

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1200,
    messages: [{ role: "user", content: prompt }],
  });

  const text2 = msg.content.filter(b => b.type === "text").map(b => b.text).join("\n");
  const m = text2.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`LLM rubric not JSON: ${text2.slice(0,300)}`);

  // Cost estimate: sonnet-4-6 ~$3/1M input, $15/1M output. Approximate.
  const inputTokens = (msg.usage?.input_tokens ?? 0);
  const outputTokens = (msg.usage?.output_tokens ?? 0);
  const costUsd = (inputTokens / 1e6) * 3 + (outputTokens / 1e6) * 15;

  return { ...JSON.parse(m[0]), cost_usd: costUsd, tokens_in: inputTokens, tokens_out: outputTokens };
}

// ─── Main editor pipeline ─────────────────────────────────────────────────────
export async function editorAgent({ text, persona, runId, slideId = "draft" }) {
  const startMs = Date.now();
  checkCircuit();  // throws if OPEN

  const audit = {
    timestamp: new Date().toISOString(),
    agent: "editor-v1",
    run_id: runId,
    slide_id: slideId,
    stages: {},
  };

  // ─── Stage 1: avoid-slop (deterministic) ────────────────────────────────────
  const slopResult = scanAvoidSlop(text);
  audit.stages.avoid_slop = { pass: slopResult.action !== "reject", deduction: slopResult.score_deduction, violations_count: slopResult.violations.length };

  if (slopResult.action === "reject") {
    const decision = {
      decision: "REJECT",
      score: 0,
      stages: {
        avoid_slop: { pass: false, violations: slopResult.violations, deduction: slopResult.score_deduction },
        compliance: { pass: false, violations: [], escalation: null },
        persona_fit: { pass: false, persona: persona || "unknown", confidence: 0, reasoning: "skipped (slop reject)" },
        hook_strength: { score: 0, reasoning: "skipped" },
        rubric: { pillar: 0, voice: 0, avoid_slop: 0, hook: 0, total: 0 },
      },
      reasons: ["avoid-slop REJECT: " + slopResult.violations.filter(v => v.severity === "grave").map(v => v.phrase || v.token || v.description).join(", ")],
      fix_suggestions: ["Remover violações grave de avoid-slop antes de re-submeter"],
      cost_usd: 0,
      duration_ms: Date.now() - startMs,
    };
    audit.decision = decision;
    logAudit(audit);
    updateCircuit({ decisionType: "REJECT", costUsd: 0 });
    return decision;
  }

  // ─── Stage 2: compliance (deterministic + flag) ─────────────────────────────
  const complianceResult = scanCompliance(text);
  audit.stages.compliance = { pass: complianceResult.action !== "reject", escalation: complianceResult.escalation };

  if (complianceResult.action === "reject" || complianceResult.action === "escalate") {
    const decision = {
      decision: complianceResult.escalation ? "ESCALATE" : "REJECT",
      score: 0,
      stages: {
        avoid_slop: { pass: true, violations: slopResult.violations, deduction: slopResult.score_deduction },
        compliance: { pass: false, violations: complianceResult.violations, escalation: complianceResult.escalation },
        persona_fit: { pass: false, persona: persona || "unknown", confidence: 0, reasoning: "skipped" },
        hook_strength: { score: 0, reasoning: "skipped" },
        rubric: { pillar: 0, voice: 0, avoid_slop: 0, hook: 0, total: 0 },
      },
      reasons: ["compliance " + complianceResult.action.toUpperCase() + ": " + complianceResult.violations.map(v => v.word || v.description).join(", ")],
      fix_suggestions: ["Revisar contra CFM 2.336/2023 — remover claim médico"],
      cost_usd: 0,
      duration_ms: Date.now() - startMs,
    };
    audit.decision = decision;
    logAudit(audit);
    updateCircuit({ decisionType: decision.decision, costUsd: 0 });
    return decision;
  }

  // ─── Stage 3: persona fit (strong/weak determ + LLM tiebreak se preciso) ──
  const personaDet = detectPersonaDeterministic(text);
  let personaFinal = personaDet.persona;
  let personaConfidence = personaDet.score;
  let personaSource = "deterministic";
  let extraCost = 0;

  if (personaDet.requires_llm_tiebreak) {
    const tieBreak = await personaLLMTiebreak({ text, detResult: personaDet });
    personaFinal = tieBreak.persona;
    personaConfidence = tieBreak.confidence;
    personaSource = personaDet.cold_call ? "llm_cold_call" : "llm_tiebreak";
    extraCost += tieBreak.cost_usd ?? 0;
    audit.stages.persona_llm_tiebreak = tieBreak;
  }
  audit.stages.persona_fit = { detected: personaFinal, source: personaSource, det_scores: personaDet.scores, det_breakdown: personaDet.breakdown };

  // ─── Stage 4: hook strength (deterministic) ─────────────────────────────────
  const hookDet = hookStrengthDeterministic(text);
  audit.stages.hook_strength = hookDet;

  // ─── Stage 5: LLM rubric (only if det stages passed) ───────────────────────
  const llmResult = await llmRubric({ text, persona: persona || personaFinal, slopResult, complianceResult, hookDet });
  audit.stages.rubric = llmResult;

  const decision = {
    decision: llmResult.decision,
    score: llmResult.total,
    stages: {
      avoid_slop: { pass: true, violations: slopResult.violations, deduction: slopResult.score_deduction },
      compliance: { pass: true, violations: complianceResult.violations, escalation: null },
      persona_fit: { pass: personaConfidence > 0, persona: persona || personaFinal, confidence: personaConfidence, reasoning: `source: ${personaSource}, det top: ${personaDet.persona} (${personaDet.score}pts)` },
      hook_strength: { score: hookDet.det_score, reasoning: `${hookDet.char_count} chars, paradox=${hookDet.has_paradox}` },
      rubric: { pillar: llmResult.pillar, voice: llmResult.voice, avoid_slop: llmResult.avoid_slop, hook: llmResult.hook, total: llmResult.total },
    },
    reasons: [llmResult.reasoning],
    fix_suggestions: llmResult.fix_suggestions,
    cost_usd: llmResult.cost_usd + extraCost,
    duration_ms: Date.now() - startMs,
  };

  audit.decision = decision;
  logAudit(audit);
  updateCircuit({ decisionType: decision.decision, costUsd: decision.cost_usd });

  // Validate via Zod (safety)
  try {
    EditorDecisionSchema.parse(decision);
  } catch (e) {
    console.error("⚠ Zod validation failed:", e.message);
  }

  return decision;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs() {
  const a = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--run") out.run = a[++i];
    else if (a[i] === "--text") out.text = a[++i];
    else if (a[i] === "--persona") out.persona = a[++i];
    else if (a[i] === "--json") out.json = true;
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs();
  let text;
  if (args.text) text = args.text;
  else if (args.run) {
    const dpPath = path.join(ROOT, "runs", args.run, "draft-package.md");
    const dp = fs.readFileSync(dpPath, "utf-8");
    const m = dp.match(/### Caption[^\n]*\n([\s\S]*?)(?=\n###|\n##|\n# |$)/);
    text = m ? m[1].trim() : dp;
  } else {
    console.error("Usage: editor-agent.mjs --run <run-id> | --text <s> [--persona maria|julia|pedro|ana]");
    process.exit(1);
  }

  const decision = await editorAgent({ text, persona: args.persona, runId: args.run, slideId: "caption" });

  if (args.json) {
    console.log(JSON.stringify(decision, null, 2));
  } else {
    console.log(`\n📋 Editor decision: ${decision.decision} (score ${decision.score}/12)\n`);
    console.log(`  Duration: ${decision.duration_ms}ms · Cost: $${decision.cost_usd.toFixed(4)}`);
    console.log(`  Persona: ${decision.stages.persona_fit.persona} (conf ${decision.stages.persona_fit.confidence})`);
    console.log(`  Hook: ${decision.stages.hook_strength.score}/3`);
    console.log(`  Rubric: pillar ${decision.stages.rubric.pillar} · voice ${decision.stages.rubric.voice} · slop ${decision.stages.rubric.avoid_slop} · hook ${decision.stages.rubric.hook} = ${decision.stages.rubric.total}/12\n`);
    console.log(`  Reasoning: ${decision.reasons.join(" · ")}\n`);
    if (decision.fix_suggestions?.length) {
      console.log(`  Fix suggestions:`);
      for (const f of decision.fix_suggestions) console.log(`    - ${f}`);
    }
  }

  process.exit(decision.decision === "APPROVE" ? 0 : (decision.decision === "REVISE" ? 2 : 1));
}
