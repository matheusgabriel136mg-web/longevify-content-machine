// scripts/agents/remix-mode.mjs — orchestrate a remix of an ingested idea.
//
// Flow:
//   1. Read idea row from ideas_backlog
//   2. Claude (sonnet) call: original caption → Longevify draft (pt-BR, voice, persona, pillar)
//   3. Create runs/<new_runId>/idea.md + content-object.md
//   4. Dispatch content-generator --run <new_runId>
//   5. Mark idea row promoted_to_run_id
//   6. Trigger telegram-approval --notify <new_runId> --force
//
// CLI:
//   node scripts/agents/remix-mode.mjs --idea <id>

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import Database from "better-sqlite3";
import Anthropic from "@anthropic-ai/sdk";
import { getIdea, setIdeaStatus } from "./idea-ingester.mjs";

// 5 valid patterns from content-generator dispatchByPattern.
// Dispatcher reads (brief.meta.type || brief.meta.slot_type) as the short slot ID,
// and brief.meta.pattern as the full pattern name. We populate BOTH for safety.
const PATTERN_MAP = {
  "persona-bio-case-study":      { type: "persona-bio",        format: "carousel" },
  "dado-punch-bryan-style":      { type: "dado-punch",         format: "image"    },
  "brand-manifesto":             { type: "premium-manifesto",  format: "carousel" },
  "biomarker-gap":               { type: "biomarker-gap",      format: "carousel" },
  "reel-tips-hold-to-reveal":    { type: "reel-tips",          format: "reel"     },
};

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
const BRAND_TRUTH = path.join(ROOT, "foundation", "stores", "voice-rules.md");
const CFM = path.join(ROOT, "foundation", "compliance", "cfm-restricted.md");
const SLOP = path.join(ROOT, "foundation", "compliance", "avoid-slop.yaml");

function audit(entry) {
  fs.mkdirSync(path.dirname(AUDIT_LOG), { recursive: true });
  fs.appendFileSync(AUDIT_LOG, JSON.stringify({ ts: new Date().toISOString(), agent: "remix-mode", ...entry }) + "\n");
}

function readSafe(p, limit = 3000) {
  if (!fs.existsSync(p)) return "";
  try { return fs.readFileSync(p, "utf-8").slice(0, limit); } catch { return ""; }
}

function genRunId(brand, persona, pillar) {
  const today = new Date().toISOString().slice(0, 10);
  const seq = String(Math.floor(Math.random() * 900) + 100);  // 3-digit
  const slug = `${brand}-remix-${persona}-p${pillar}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${today}-${seq}-${slug}`.slice(0, 80);
}

async function callClaudeRemix(idea) {
  const voice = readSafe(BRAND_TRUTH, 4000);
  const cfm = readSafe(CFM, 1500);
  const slop = readSafe(SLOP, 1500);
  const anthropic = new Anthropic();

  const prompt = `Você é o remixer da Longevify, uma marca premium brasileira de healthtech (painel funcional + protocolo personalizado, ICP 30-50 classe A/B, 4 personas: Maria/Julia/Pedro/Ana).

Sua tarefa: remixar este post externo num draft Longevify em pt-BR.

═══ POST ORIGINAL (${idea.source_brand}, ${idea.source_platform}) ═══
${idea.original_caption}

═══ VOICE / BRAND-TRUTH ═══
${voice}

═══ CFM-SAFE RESTRICTIONS ═══
${cfm}

═══ AVOID-SLOP RULES ═══
${slop}

═══ TARGET ═══
- Persona: ${idea.persona_suggested}
- Pillar: P${idea.pillar_suggested}
- Format: carousel
- Voice: Mito (precisão técnica) + Aesop (restrição editorial). SEM self-help. SEM fear. SEM promessa de cura.
- Em-dash count ≤1 por caption (regra editor v1.2).
- Estrutura original preservada (hook → contexto → dado → CTA) mas:
  * Adapta exemplos pra contexto brasileiro (labs, lugares, métricas SBC/AHA, hábito BR)
  * Português brasileiro natural; termos médicos consagrados em inglês permitidos (ApoB, hs-CRP)
  * NUNCA "cura", "trata", "previne doença" — use "suporta", "otimiza", "calibra"

═══ PATTERN SELECTION ═══
Escolha UM dos 5 patterns existentes que melhor encaixa neste conteúdo:
- "persona-bio-case-study"   — narrativa de pessoa (sintoma → painel → protocolo → resultado em N semanas)
- "dado-punch-bryan-style"   — single-image com 1 número/stat gigante + frase curta (ex: 73%)
- "brand-manifesto"          — manifesto/posicionamento/filosofia editorial
- "biomarker-gap"            — comparação faixa populacional vs faixa funcional de UM biomarcador
- "reel-tips-hold-to-reveal" — listicle/tips (4-8 bullets), formato vídeo curto

═══ OUTPUT: JSON ÚNICO ═══
{
  "chosen_pattern": "persona-bio-case-study" | "dado-punch-bryan-style" | "brand-manifesto" | "biomarker-gap" | "reel-tips-hold-to-reveal",
  "pattern_reason": "<1 sentence explicando por que esse pattern encaixa>",
  "headline": "<headline curta paradoxal/biológica, 4-6 palavras max>",
  "sub_headline": "<oferta de produto/protocolo, max 12 palavras>",
  "caption_full": "<caption pt-BR completa 800-1200 chars, estrutura preservada do original mas adaptada>",
  "cover_variant": "copacabana-woman-A" | "sp-restaurant-still-life-A" | "br-executive-lunch-cgm-B" | "generic-br-premium",
  "remix_notes": "<1 sentence sobre o que mudou vs original>"
}

REGRA JSON CRÍTICA: dentro de qualquer valor string (especialmente caption_full), JAMAIS use aspas duplas (\"). Se precisar destacar palavras use aspas simples ('') ou curvas (« »). Quebras de linha = \\n literal.

Retorne SÓ o JSON. Sem texto antes ou depois.`;

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("\n");
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Claude returned no JSON: " + text.slice(0, 300));
  const parsed = parseLlmJsonResilient(jsonMatch[0]);
  if (!parsed) throw new Error("LLM JSON unparseable after sanitization: " + text.slice(0, 300));
  const cost = ((msg.usage?.input_tokens ?? 0) / 1e6) * 3 + ((msg.usage?.output_tokens ?? 0) / 1e6) * 15;
  return { ...parsed, _cost_usd: cost };
}

// Best-effort JSON parse with escape-fixup for stray internal double-quotes.
function parseLlmJsonResilient(jsonText) {
  try { return JSON.parse(jsonText); } catch {}
  let s = jsonText, out = "", inStringVal = false, escapeNext = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escapeNext) { out += c; escapeNext = false; continue; }
    if (c === "\\") { out += c; escapeNext = true; continue; }
    if (!inStringVal) {
      out += c;
      if (c === ":") {
        let j = i + 1;
        while (j < s.length && /\s/.test(s[j])) { out += s[j]; j++; }
        if (s[j] === "\"") { inStringVal = true; out += "\""; i = j; }
      }
      continue;
    }
    if (c === "\"") {
      let k = i + 1;
      while (k < s.length && /[\s\n]/.test(s[k])) k++;
      if (k >= s.length || s[k] === "," || s[k] === "}" || s[k] === "]") {
        out += "\""; inStringVal = false; continue;
      }
      out += "\\\""; continue;
    }
    out += c;
  }
  try { return JSON.parse(out); }
  catch (e) { console.error("parseLlmJsonResilient failed:", e.message.slice(0, 200)); return null; }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const a = process.argv.slice(2);
  const idx = a.indexOf("--idea");
  if (idx < 0 || !a[idx + 1]) {
    console.error("Usage: remix-mode.mjs --idea <id>");
    process.exit(1);
  }
  const ideaId = parseInt(a[idx + 1]);
  const idea = getIdea(ideaId);
  if (!idea) { console.error(`idea #${ideaId} not found`); process.exit(1); }

  console.log(`\n🎨 Remixing idea #${ideaId} (${idea.source_brand}, persona ${idea.persona_suggested}, P${idea.pillar_suggested})...`);

  const remix = await callClaudeRemix(idea);
  console.log(`  ✓ Claude remix done ($${remix._cost_usd.toFixed(4)})`);
  audit({ event: "remix_llm_done", idea_id: ideaId, cost_usd: remix._cost_usd });

  // ─── Pattern resolution (Bug R2 fix) ───────────────────────────────────────
  const chosenPattern = remix.chosen_pattern && PATTERN_MAP[remix.chosen_pattern]
    ? remix.chosen_pattern
    : "persona-bio-case-study";  // safe default if Claude returned invalid
  const { type: patternType, format: patternFormat } = PATTERN_MAP[chosenPattern];
  console.log(`  ✓ pattern: ${chosenPattern} (type=${patternType}, format=${patternFormat}) — ${remix.pattern_reason || ""}`);

  const runId = genRunId(idea.source_brand, idea.persona_suggested, idea.pillar_suggested);
  const runDir = path.join(ROOT, "runs", runId);
  fs.mkdirSync(path.join(runDir, "assets"), { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const cover_variant = remix.cover_variant || "generic-br-premium";

  // idea.md — populates `type` (short slot ID) + `pattern` (full name) for dispatcher
  fs.writeFileSync(path.join(runDir, "idea.md"), `---
content_object: ${runId}
route: remix
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

**Headline hint:** ${remix.headline}

**Brief:**
${remix.caption_full}

**Remix notes:**
${remix.remix_notes}
`);

  // content-object.md (state=draft so syncRunsDirToDb and our direct INSERT agree)
  fs.writeFileSync(path.join(runDir, "content-object.md"), `---
id: ${runId}
route: remix
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

# ${remix.headline}

## TL;DR
${remix.sub_headline}

## Caption
${remix.caption_full}

## Remix notes
${remix.remix_notes}
`);

  console.log(`  ✓ run dir + idea.md + content-object.md created`);

  // ─── INSERT into pipeline.db (Bug R1 fix) ──────────────────────────────────
  // Use the same schema as pipeline.mjs syncRunsDirToDb upsert (idempotent via UNIQUE constraint).
  const PIPELINE_DB = path.join(ROOT, "runs", "_pipeline.db");
  if (fs.existsSync(PIPELINE_DB)) {
    const db = new Database(PIPELINE_DB);
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT,
        scheduled_for TEXT,
        persona TEXT,
        pillar INTEGER,
        format TEXT,
        last_action TEXT,
        failure_reason TEXT,
        retry_count INTEGER DEFAULT 0
      );`);
      db.prepare(`
        INSERT INTO runs (run_id, state, created_at, updated_at, scheduled_for, persona, pillar, format)
        VALUES (?, 'draft', ?, ?, NULL, ?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET updated_at = excluded.updated_at
      `).run(runId, new Date().toISOString(), new Date().toISOString(),
             idea.persona_suggested, idea.pillar_suggested, patternFormat);
      console.log(`  ✓ pipeline.db row inserted (state=draft, persona=${idea.persona_suggested}, P${idea.pillar_suggested})`);
    } finally { db.close(); }
  } else {
    console.warn("  ⚠ pipeline.db missing — Telegram approve callback won't find this run");
  }

  // Dispatch content-generator (text/data/caption + persistRenderData)
  console.log(`  ⏳ content-generator...`);
  try {
    const out = execSync(`node ${path.join(__dirname, "content-generator.mjs")} --run ${runId} 2>&1`, { cwd: ROOT, encoding: "utf-8", timeout: 240000 });
    console.log(`  ✓ content-generator done`);
    audit({ event: "remix_generator_ok", idea_id: ideaId, run_id: runId, gen_tail: out.slice(-300) });
  } catch (e) {
    console.error(`  ✗ content-generator failed: ${e.message.slice(0, 300)}`);
    audit({ event: "remix_generator_failed", idea_id: ideaId, run_id: runId, error: e.message?.slice(0, 200) });
  }

  // Dispatch generator (visual render via template)
  console.log(`  ⏳ generator (visual render)...`);
  try {
    const out = execSync(`node ${path.join(__dirname, "generator.mjs")} --run ${runId} 2>&1`, { cwd: ROOT, encoding: "utf-8", timeout: 240000 });
    console.log(`  ✓ generator done`);
    audit({ event: "remix_visual_ok", idea_id: ideaId, run_id: runId });
  } catch (e) {
    console.error(`  ✗ generator (visual) failed: ${e.message.slice(0, 300)}`);
    audit({ event: "remix_visual_failed", idea_id: ideaId, run_id: runId, error: e.message?.slice(0, 200) });
  }

  // Mark idea promoted
  setIdeaStatus(ideaId, "remixed", { promoted_to_run_id: runId, remix_decision: "remix" });

  // Trigger approval notification
  try {
    execSync(`node ${path.join(__dirname, "telegram-approval.mjs")} --notify ${runId} --force 2>&1`, { cwd: ROOT, encoding: "utf-8", timeout: 60000 });
    console.log(`  ✓ approval notification dispatched`);
  } catch (e) {
    console.error(`  ⚠ approval notify failed: ${e.message.slice(0, 200)}`);
  }

  console.log(`\n🎨 Remix done: idea #${ideaId} → run ${runId}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
