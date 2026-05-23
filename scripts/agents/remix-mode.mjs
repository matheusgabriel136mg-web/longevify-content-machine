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
import Anthropic from "@anthropic-ai/sdk";
import { getIdea, setIdeaStatus } from "./idea-ingester.mjs";

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

═══ OUTPUT: JSON ÚNICO ═══
{
  "headline": "<headline curta paradoxal/biológica, 4-6 palavras max>",
  "sub_headline": "<oferta de produto/protocolo, max 12 palavras>",
  "caption_full": "<caption pt-BR completa 800-1200 chars, estrutura preservada do original mas adaptada>",
  "slides": [
    {"n": 1, "type": "cover", "headline": "...", "sub": "...", "cover_variant": "<sugestão de variant da brand-rule cover>"},
    {"n": 2, "type": "context", "title": "...", "body": "..."},
    {"n": 3, "type": "data_punch", "kicker": "...", "number": "...", "headline_1": "...", "sub": "..."},
    {"n": 4, "type": "explanation", "title": "...", "body": "..."},
    {"n": 5, "type": "cta", "title": "...", "body": "..."}
  ],
  "scheduled_for_suggested": null,
  "remix_notes": "<1 sentence sobre o que mudou vs original>"
}

Retorne SÓ o JSON. Sem texto antes ou depois.`;

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("\n");
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Claude returned no JSON: " + text.slice(0, 300));
  const parsed = JSON.parse(jsonMatch[0]);
  const cost = ((msg.usage?.input_tokens ?? 0) / 1e6) * 3 + ((msg.usage?.output_tokens ?? 0) / 1e6) * 15;
  return { ...parsed, _cost_usd: cost };
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

  const runId = genRunId(idea.source_brand, idea.persona_suggested, idea.pillar_suggested);
  const runDir = path.join(ROOT, "runs", runId);
  fs.mkdirSync(path.join(runDir, "assets"), { recursive: true });

  // idea.md
  fs.writeFileSync(path.join(runDir, "idea.md"), `---
content_object: ${runId}
route: remix
source_idea_id: ${ideaId}
source_url: ${idea.source_url}
source_brand: ${idea.source_brand}
pillar: ${idea.pillar_suggested}
format: carousel
target_persona: ${idea.persona_suggested}
type: remix
created_at: ${new Date().toISOString().slice(0,10)}
---

# ${runId}

**Headline hint:** ${remix.headline}

**Brief:**
${remix.caption_full}

**Remix notes:**
${remix.remix_notes}
`);

  // content-object.md (verified-ready format)
  fs.writeFileSync(path.join(runDir, "content-object.md"), `---
id: ${runId}
route: remix
state: draft
pillar: ${idea.pillar_suggested}
format: carousel
platforms: [instagram]
created_at: ${new Date().toISOString().slice(0,10)}
target_persona: ${idea.persona_suggested}
pattern: remix-from-external
source_idea_id: ${ideaId}
source_url: ${idea.source_url}
source_brand: ${idea.source_brand}
cover_variant: ${remix.slides?.[0]?.cover_variant || "generic-br-premium"}
---

# ${remix.headline}

## TL;DR
${remix.sub_headline}

## Caption
${remix.caption_full}

## Slides
${(remix.slides || []).map(s => `- S${s.n} (${s.type}) — ${s.title || s.headline || ""}`).join("\n")}

## Remix notes
${remix.remix_notes}
`);

  console.log(`  ✓ run dir + idea.md + content-object.md created`);

  // Dispatch content-generator
  console.log(`  ⏳ content-generator...`);
  try {
    const out = execSync(`node ${path.join(__dirname, "content-generator.mjs")} --run ${runId} 2>&1`, { cwd: ROOT, encoding: "utf-8", timeout: 240000 });
    console.log(`  ✓ content-generator done`);
    audit({ event: "remix_generator_ok", idea_id: ideaId, run_id: runId, gen_tail: out.slice(-300) });
  } catch (e) {
    console.error(`  ✗ content-generator failed: ${e.message.slice(0, 300)}`);
    audit({ event: "remix_generator_failed", idea_id: ideaId, run_id: runId, error: e.message?.slice(0, 200) });
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
