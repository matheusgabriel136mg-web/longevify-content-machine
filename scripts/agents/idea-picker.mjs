// scripts/agents/idea-picker.mjs — Autonomous idea picker
//
// Roda semanalmente (dom 23:00 BRT). Lê:
//   - CLAUDE.md slots (4 posts/sem fixos)
//   - foundation/pillars.md (mix target)
//   - runs/_pipeline.db (o que já tem na queue)
//   - runs/_insights.db (o que está performando)
//   - cross-version diarization (gaps detectados)
//
// Para cada slot vago na próxima semana:
//   1. Determinístico: escolhe pillar+persona priorizando GAPS (P4 underserved,
//      Ana=0, P5=0) over default mix
//   2. LLM: gera brief específico que serve hero ICP via persona escolhida
//   3. Cria runs/<id>/idea.md placeholder + entry no _queue.json
//
// Princípio Tan #4: pillar/persona selection é DETERMINÍSTICO (math).
// LLM só pra brief writing.
//
// CLI:
//   node scripts/agents/idea-picker.mjs [--days 7] [--dry-run]

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";
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

const PIPELINE_DB = path.join(ROOT, "runs", "_pipeline.db");
const QUEUE = path.join(ROOT, "runs", "_queue.json");

// ─── Slot mapping (mirror CLAUDE.md 4x/sem cronograma) ────────────────────────
const WEEKLY_SLOTS = [
  { day: 0, hour: 10, format: "carousel", slot_type: "premium-manifesto", default_pillar: 1, default_persona: "todas" }, // Dom
  // Seg OFF
  { day: 2, hour: 19, format: "carousel", slot_type: "dado-punch",         default_pillar: 2, default_persona: "maria" }, // Ter
  // Qua OFF
  { day: 4, hour: 19, format: "carousel", slot_type: "deep-dive-tecnico",  default_pillar: 4, default_persona: "ana"   }, // Qui
  { day: 5, hour: 19, format: "carousel", slot_type: "persona-bio",        default_pillar: 4, default_persona: "julia" }, // Sex
  // Sáb stories only
];

// Target mix mensal (foundation/pillars.md)
const TARGET_MIX = { P1: 2, P2: 3, P3: 2, P4: 3, P5: 1, P6: 1 }; // 12 posts/mês
const PERSONAS = ["maria", "julia", "pedro", "ana"];

// ─── Compute gaps (deterministic) ─────────────────────────────────────────────
function computeGaps() {
  if (!fs.existsSync(PIPELINE_DB)) return { pillar_gaps: TARGET_MIX, persona_gaps: PERSONAS.reduce((a,p) => ({...a, [p]: 1}), {}) };
  const db = new Database(PIPELINE_DB, { readonly: true });
  // Considera últimos 30 dias
  const cutoff = new Date(Date.now() - 30*86400000).toISOString().slice(0, 10);
  const runs = db.prepare(`SELECT pillar, persona, format, state FROM runs WHERE created_at >= ?`).all(cutoff);
  db.close();

  const pillarCounts = {};
  const personaCounts = {};
  for (const r of runs) {
    const p = `P${r.pillar || "?"}`;
    pillarCounts[p] = (pillarCounts[p] || 0) + 1;
    if (r.persona && r.persona !== "unknown") {
      personaCounts[r.persona] = (personaCounts[r.persona] || 0) + 1;
    }
  }

  // Gaps = target - actual (positive = need more)
  const pillarGaps = {};
  for (const [p, target] of Object.entries(TARGET_MIX)) {
    pillarGaps[p] = target - (pillarCounts[p] || 0);
  }
  const personaGaps = {};
  for (const p of PERSONAS) {
    personaGaps[p] = 1 - Math.min(1, (personaCounts[p] || 0)); // 1 if zero, 0 if has at least 1
  }
  return { pillar_gaps: pillarGaps, persona_gaps: personaGaps, current_pillar: pillarCounts, current_persona: personaCounts };
}

// ─── Pick pillar + persona pra slot (deterministic w/ gap priority) ──────────
function pickPillarPersona(slot, gaps) {
  // Priority logic:
  // 1. If slot has default that's STILL in gap, use it
  // 2. Otherwise pick from gap > 0 (most underserved first)
  // 3. Fallback to slot default
  let pillar = `P${slot.default_pillar}`;
  let persona = slot.default_persona;
  let reasoning = `default slot mapping (${slot.slot_type})`;

  // Persona gap override (Ana ou Pedro=0)
  if (slot.default_persona && gaps.persona_gaps[slot.default_persona] === 0) {
    // Default persona already served — try gap personas
    const underservedPersonas = Object.entries(gaps.persona_gaps).filter(([_, g]) => g > 0).sort((a,b) => b[1] - a[1]);
    if (underservedPersonas.length > 0) {
      persona = underservedPersonas[0][0];
      reasoning = `gap override: ${slot.default_persona} já servida (${gaps.current_persona[slot.default_persona]}); priorizando ${persona} (=0 runs)`;
    }
  }

  // Pillar gap override
  const underservedPillars = Object.entries(gaps.pillar_gaps).filter(([_, g]) => g > 0).sort((a,b) => b[1] - a[1]);
  if (underservedPillars.length > 0) {
    const topGapPillar = underservedPillars[0][0];
    if (parseInt(topGapPillar.slice(1)) !== slot.default_pillar) {
      // Only override if slot is "flexible" (premium-manifesto allows P1/P5; persona-bio allows P4/P5)
      const flexibleSlots = ["premium-manifesto", "persona-bio", "deep-dive-tecnico"];
      if (flexibleSlots.includes(slot.slot_type)) {
        pillar = topGapPillar;
        reasoning += ` | pillar override: ${topGapPillar} gap=${gaps.pillar_gaps[topGapPillar]} (slot is flexible)`;
      }
    }
  }

  return { pillar, persona, reasoning };
}

// ─── Generate ideas brief via LLM ─────────────────────────────────────────────
async function generateBrief({ pillar, persona, slot, dateStr }) {
  const anthropic = new Anthropic();
  const voicePath = path.join(ROOT, "foundation", "voice.md");
  const pillarsPath = path.join(ROOT, "foundation", "pillars.md");
  const voice = fs.existsSync(voicePath) ? fs.readFileSync(voicePath, "utf-8").slice(0, 2500) : "";
  const pillars = fs.existsSync(pillarsPath) ? fs.readFileSync(pillarsPath, "utf-8").slice(0, 2000) : "";

  const prompt = `Você é o planner de conteúdo Longevify. Gere brief pra slot vago.

═══ Slot ═══
Data: ${dateStr}
Tipo: ${slot.slot_type}
Format: ${slot.format}
Pillar atribuído: ${pillar}
Persona alvo: ${persona}

═══ Voice + pillar context ═══
${voice.slice(0, 1500)}
${pillars.slice(0, 1500)}

═══ Tarefa ═══
Retorne SÓ JSON:
{
  "id": "<YYYY-MM-DD-NNN-slug-curto-kebab-case>",
  "headline_hint": "<headline sugestão 6-12 palavras com paradoxo/número/pergunta>",
  "angle": "<1-2 sentences do ângulo único pro slot — não repete temas óbvios>",
  "brief": "<3-4 parágrafos: o que ensina, hook, qual o insight, qual CTA editorial>",
  "external_assets": [<lista de assets externos requeridos. Vazio se Higgsfield+SVG basta. Geralmente cover-raw.png se for cover GPT.>]
}`;

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 800,
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("\n");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Brief não retornou JSON");
  const parsed = JSON.parse(m[0]);
  // ID slug — replace special chars
  parsed.id = parsed.id.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
  return parsed;
}

// ─── Compute upcoming slot dates ──────────────────────────────────────────────
function upcomingSlots(daysAhead = 7) {
  const out = [];
  const now = new Date();
  for (let d = 1; d <= daysAhead; d++) {
    const date = new Date(now);
    date.setDate(now.getDate() + d);
    const dow = date.getDay();
    const slot = WEEKLY_SLOTS.find(s => s.day === dow);
    if (!slot) continue;
    date.setHours(slot.hour, 0, 0, 0);
    out.push({
      ...slot,
      date_str: date.toISOString().slice(0, 10),
      slot_iso: date.toISOString().slice(0, 16) + "-03:00",
    });
  }
  return out;
}

// ─── Check if slot already taken ──────────────────────────────────────────────
function slotTaken(slotIso) {
  if (!fs.existsSync(PIPELINE_DB)) return false;
  const db = new Database(PIPELINE_DB, { readonly: true });
  const dateStr = slotIso.slice(0, 10);
  // Match by date prefix on scheduled_for
  const taken = db.prepare(`SELECT run_id FROM runs WHERE scheduled_for LIKE ? AND state NOT IN ('failed')`).get(dateStr + "%");
  db.close();
  return !!taken;
}

// ─── Persist to queue + create idea.md ────────────────────────────────────────
function persistItem({ id, brief, headline_hint, angle, external_assets, slot, pillar, persona, dryRun }) {
  if (dryRun) {
    console.log(`    [DRY-RUN] Would create: ${id}`);
    return;
  }
  // Append to _queue.json
  let queue = { items: [], updated_at: null };
  if (fs.existsSync(QUEUE)) queue = JSON.parse(fs.readFileSync(QUEUE, "utf-8"));
  queue.items.push({
    id,
    slot: slot.slot_iso,
    format: slot.format,
    type: slot.slot_type,
    pillar: parseInt(pillar.slice(1)),
    target_persona: persona,
    brief,
    headline_hint,
    angle,
    external_assets: external_assets || [],
    status: "idea",
    created_at: new Date().toISOString(),
    source: "idea-picker-auto",
  });
  queue.updated_at = new Date().toISOString();
  fs.writeFileSync(QUEUE, JSON.stringify(queue, null, 2));

  // Create runs/<id>/idea.md placeholder
  const runDir = path.join(ROOT, "runs", id);
  fs.mkdirSync(path.join(runDir, "assets"), { recursive: true });
  const ideaMd = `---
content_object: ${id}
route: original-idea-picker
pillar: ${parseInt(pillar.slice(1))}
slot: ${slot.slot_iso}
format: ${slot.format}
type: ${slot.slot_type}
target_persona: ${persona}
created_at: ${new Date().toISOString().slice(0,10)}
source: idea-picker-auto
---

# ${id}

## Brief (auto-gerado pelo idea-picker)

**Headline hint:** ${headline_hint}

**Angle:** ${angle}

**Brief:**
${brief}

## External assets requeridos
${(external_assets || []).length ? (external_assets || []).map(a => `- [ ] ${a}`).join("\n") : "(nenhum — tudo Higgsfield+SVG render)"}

## Next steps
1. Aprovar/editar brief
2. Se external_assets: criar/baixar
3. Render via scripts/render-*.mjs
4. Editor agent
5. Publish trigger (manual)
`;
  fs.writeFileSync(path.join(runDir, "idea.md"), ideaMd);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const daysIdx = process.argv.indexOf("--days");
  const days = daysIdx >= 0 ? parseInt(process.argv[daysIdx + 1]) : 7;

  console.log(`\n💡 Idea Picker · próximos ${days} dias · ${dryRun ? "DRY-RUN" : "LIVE"}\n`);

  const gaps = computeGaps();
  console.log(`  Pillar gaps (target - actual): ${JSON.stringify(gaps.pillar_gaps)}`);
  console.log(`  Persona gaps (1 if zero, 0 if served): ${JSON.stringify(gaps.persona_gaps)}\n`);

  const slots = upcomingSlots(days);
  console.log(`  ${slots.length} slots na próxima janela:\n`);

  const newItems = [];
  for (const slot of slots) {
    process.stdout.write(`    ${slot.slot_iso}  ${slot.slot_type.padEnd(20)} `);
    if (slotTaken(slot.slot_iso)) {
      console.log("⊘ já preenchido");
      continue;
    }
    const { pillar, persona, reasoning } = pickPillarPersona(slot, gaps);
    console.log(`→ ${pillar}/${persona}`);
    console.log(`      reasoning: ${reasoning}`);
    try {
      const brief = await generateBrief({ pillar, persona, slot, dateStr: slot.date_str });
      console.log(`      ✓ ${brief.id}: ${brief.headline_hint}`);
      persistItem({ ...brief, slot, pillar, persona, dryRun });
      newItems.push({ id: brief.id, pillar, persona, slot: slot.slot_iso });
    } catch (e) {
      console.log(`      ✗ brief gen failed: ${e.message.slice(0, 100)}`);
    }
  }

  console.log(`\n✅ ${newItems.length} item(s) novo(s) ${dryRun ? "(dry-run, nada salvo)" : "salvo em _queue.json + runs/*/idea.md"}\n`);
}

await main();
