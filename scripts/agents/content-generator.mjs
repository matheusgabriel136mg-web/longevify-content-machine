// scripts/agents/content-generator.mjs — LLM gera content a partir de brief
//
// Bridge crítico do loop autônomo: brief (idea-picker) → data estruturada
// (personas/<id>.json + draft-package.md + atualiza content-object.md).
//
// Princípio Tan #4: deterministic onde dá (file IO, template skeleton),
// LLM SOMENTE pra criar copy + content + biomarkers narrativos.
//
// Cost-guarded: respeita safety-thresholds.yaml (lê via env LONGEVIFY_COST_LIMIT
// passada pelo orchestrator OR fallback $40/day default).
//
// Output:
//   - Persona-bio: personas/<id>.json populado + draft-package.md + content-object verified
//   - Outros formats: caption + structure (template generic stub) + draft-package.md
//
// CLI:
//   node scripts/agents/content-generator.mjs --run <run-id>
//   node scripts/agents/content-generator.mjs --run <run-id> --persona-id ana  (override)

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import YAML from "yaml";
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

const AUDIT_LOG = path.join(ROOT, "runs", "_audit-log.jsonl");
const PERSONA_KW_PATH = path.join(ROOT, "foundation", "persona-keywords.yaml");
const VOICE_PATH = path.join(ROOT, "foundation", "voice.md");
const PILLARS_PATH = path.join(ROOT, "foundation", "pillars.md");
const SLOP_PATH = path.join(ROOT, "foundation", "compliance", "avoid-slop.yaml");
const CFM_PATH = path.join(ROOT, "foundation", "compliance", "cfm-blocklist.yaml");

function logAudit(entry) {
  fs.mkdirSync(path.dirname(AUDIT_LOG), { recursive: true });
  fs.appendFileSync(AUDIT_LOG, JSON.stringify({ ts: new Date().toISOString(), agent: "content-generator", ...entry }) + "\n");
}

// ─── Parse args + read inputs ────────────────────────────────────────────────
function parseArgs() {
  const a = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--run") out.run = a[++i];
    else if (a[i] === "--persona-id") out.personaId = a[++i];
    else if (a[i] === "--dry-run") out.dryRun = true;
  }
  if (!out.run) { console.error("Usage: content-generator.mjs --run <id> [--persona-id <ana>]"); process.exit(1); }
  return out;
}

function readBrief(runId) {
  const ideaPath = path.join(ROOT, "runs", runId, "idea.md");
  if (!fs.existsSync(ideaPath)) throw new Error(`idea.md missing for ${runId}`);
  const txt = fs.readFileSync(ideaPath, "utf-8");
  const meta = {
    pillar: parseInt((txt.match(/^pillar:\s*(\d+)/m) ?? [, "0"])[1]),
    format: (txt.match(/^format:\s*(\S+)/m) ?? [, "carousel"])[1],
    target_persona: (txt.match(/^target_persona:\s*(\S+)/m) ?? [, "unknown"])[1],
    slot: (txt.match(/^slot:\s*(\S+)/m) ?? [, null])[1],
    type: (txt.match(/^type:\s*(\S+)/m) ?? [, null])[1],
  };
  const headlineMatch = txt.match(/\*\*Headline hint:\*\*\s*(.+)/);
  const angleMatch = txt.match(/\*\*Angle:\*\*\s*(.+)/);
  const briefBody = (txt.match(/\*\*Brief:\*\*\n([\s\S]*?)(?=\n##|\n---|\n\*\*External|$)/) ?? [, ""])[1].trim();
  return {
    meta,
    headline_hint: headlineMatch?.[1]?.trim() ?? "",
    angle: angleMatch?.[1]?.trim() ?? "",
    brief_text: briefBody,
  };
}

// ─── LLM: persona-bio JSON ────────────────────────────────────────────────────
async function generatePersonaBioJson({ runId, brief, anthropic }) {
  // Personas/<id>.json schema — derivado de julia.json template
  const personaKw = YAML.parse(fs.readFileSync(PERSONA_KW_PATH, "utf-8"));
  const voice = fs.readFileSync(VOICE_PATH, "utf-8").slice(0, 4500);
  const slopRules = fs.readFileSync(SLOP_PATH, "utf-8").slice(0, 2000);
  const cfmRules = fs.readFileSync(CFM_PATH, "utf-8").slice(0, 1500);

  const personaId = brief.meta.target_persona;
  const personaDef = personaKw[personaId];
  if (!personaDef) throw new Error(`persona ${personaId} not in persona-keywords.yaml`);

  const prompt = `Você é o content-generator da Longevify. Sua tarefa: a partir do brief abaixo, gerar JSON estruturado completo de uma persona-bio case study (carrossel de 6 slides).

═══ BRIEF ═══
Run ID: ${runId}
Pillar: P${brief.meta.pillar}
Persona alvo: ${personaId} (${personaDef.description})
Slot: ${brief.meta.slot}

Headline hint: ${brief.headline_hint}
Angle: ${brief.angle}
Brief completo:
${brief.brief_text}

═══ VOICE GUIDE ═══
${voice}

═══ AVOID-SLOP (rejeitar imediatamente) ═══
Vocabulário banido essencial: transformação, jornada (overused), bora, melhor versão, link na bio, no excuses, milagre, cura, garante, reverte, diagnóstico, prescrever
Banido em CTA: compre agora, garanta já, clique aqui, link na bio

═══ CFM COMPLIANCE (jamais usar) ═══
cura · curar · tratamento · tratar · garante · garantia · reverte · diagnóstico · prescrever · prescrição

═══ TAREFA ═══
Gere JSON COMPLETO no schema abaixo. Cada campo PRECISA estar preenchido com conteúdo específico, não placeholder. Biomarkers devem fazer sentido pra persona (use valores realísticos pra ${personaId}, considere idade + perfil + sintomas descritos no brief).

Schema:
{
  "id": "${personaId}-${runId}",
  "name": "<Nome próprio, brasileiro, condizente com persona>",
  "age": <number, dentro do range da persona>,
  "biological_age": <number, 4-8 anos abaixo de age>,
  "location": "<endereço carioca/paulistano específico — bar/parque/club/etc>",
  "city": "<Rio de Janeiro | São Paulo>",
  "occupation": "<profissão específica condizente com persona>",
  "cover_external": true,
  "cover_filename": "cover-raw.png",

  "sintomas": [
    { "n": "01", "text": "<sintoma específico ~12-18 palavras>" },
    { "n": "02", "text": "..." },
    { "n": "03", "text": "..." },
    { "n": "04", "text": "..." }
  ],

  "biomarkers_before": [
    { "name": "<marcador>", "unit": "<unidade>", "value": "<valor numérico>", "status": "BAIXO|ALTO|LIMITE", "pct": <0-1>, "optStart": <0-1>, "optEnd": <0-1> },
    /* 5 marcadores total — RELEVANTES pra persona + pillar */
  ],

  "biomarkers_after": [
    { "name": "<idem>", "unit": "<idem>", "before": "<valor before>", "after": "<valor melhorado>", "bPct": <0-1>, "aPct": <0-1>, "optStart": <0-1>, "optEnd": <0-1> }
    /* 4 marcadores (drops 5o) */
  ],

  "headliner_stat": {
    "label": "IDADE BIOLÓGICA",
    "before": "<age>",
    "after": "<biological_age>"
  },

  "protocolo": [
    { "n": "01", "t": "<intervenção curta>", "b": "<por que/como — 1 frase>", "icon": "icon-<slug>.png" },
    /* 6 alavancas — CADA uma deve ter relação direta com 1 biomarker */
  ],

  "copy": {
    "s2_headline_1": "<headline curta — Inter Light>",
    "s2_headline_2_italic": "<continuação italic Georgia>",
    "s2_sub": "<sub explicativa>",
    "s2_closing_italic": "<fechamento Aesop pontual>",

    "s3_headline_1": "<...>",
    "s3_headline_2_italic": "<...>",
    "s3_sub": "<...>",

    "s4_headline_1": "<...>",
    "s4_headline_2_italic": "<...>",
    "s4_sub": "<...>",

    "s5_headline_1": "<...>",
    "s5_headline_2_italic": "<...>",
    "s5_sub": "<...>",

    "s6_headline_1": "<...>",
    "s6_headline_2_italic": "<...>",
    "s6_body": "<3 linhas separadas por \\n>",
    "s6_closing_italic": "<fechamento Aesop>"
  },

  "palette_internal": "dark_cedar"
}

REGRAS DE ESCRITA:
- Voice mode pra ${personaId}: ${personaId === "ana" ? "Biomarcador deep-dive sofisticado" : personaId === "julia" ? "Persona-bio warm narrativo (Equinox lifestyle)" : personaId === "pedro" ? "Athletic premium (Mito × Equinox)" : "Frustração validada (Aesop empático)"}
- Headlines: 4-7 palavras (Inter Light L1 + Georgia Italic L2)
- Italic fechamentos: paradoxos Mito-coded ("Sintoma sem laudo é sinal mal lido")
- NUNCA: transformação, jornada, cura, garantir, link na bio, "no excuses"
- Citações de marcadores com valor + unidade
- Valores biomarker realistas pra perfil (não invente faixas estranhas)

Retorne SÓ o JSON. Sem markdown wrapper. Sem comentário.`;

  const startMs = Date.now();
  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 3500,
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("\n");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`LLM returned no JSON: ${text.slice(0, 300)}`);
  const json = JSON.parse(m[0]);
  const cost = ((msg.usage?.input_tokens ?? 0) / 1e6) * 3 + ((msg.usage?.output_tokens ?? 0) / 1e6) * 15;
  return { json, cost, duration_ms: Date.now() - startMs };
}

// ─── LLM: gera caption para draft-package.md ─────────────────────────────────
async function generateCaption({ brief, personaJson, anthropic }) {
  const voice = fs.readFileSync(VOICE_PATH, "utf-8").slice(0, 3000);
  const prompt = `Você é o copywriter Longevify. Escreva a CAPTION (3-5 parágrafos curtos) pro post Instagram desta persona-bio.

═══ PERSONA / CONTEXT ═══
Nome: ${personaJson.name}
Idade: ${personaJson.age} (biológica ${personaJson.biological_age})
Local: ${personaJson.location}, ${personaJson.city}
Profissão: ${personaJson.occupation}

═══ SINTOMAS ═══
${personaJson.sintomas.map(s => "- " + s.text).join("\n")}

═══ BIOMARKERS ANTES → DEPOIS ═══
${personaJson.biomarkers_after.map(m => `${m.name}: ${m.before} → ${m.after} ${m.unit}`).join("\n")}
Idade biológica: ${personaJson.headliner_stat.before} → ${personaJson.headliner_stat.after}

═══ PROTOCOLO ═══
${personaJson.protocolo.map(p => `- ${p.t}: ${p.b}`).join("\n")}

═══ FECHAMENTO ITALIC ═══
${personaJson.copy.s2_closing_italic} / ${personaJson.copy.s6_closing_italic}

═══ VOICE GUIDE (resumido) ═══
${voice.slice(0, 1500)}

═══ TAREFA ═══
Caption de 5-7 parágrafos curtos. Estrutura:
1. Apresenta a persona com paradoxo (ex: "Conheça a X. Y anos no documento, Z no biológico.")
2. Reconhecimento dos sintomas que "não fechavam"
3. Resultado do painel funcional
4. Protocolo (com nomes dos itens)
5. Resultado 6-12 sem (números concretos)
6. Insight central + manifesto
7. Disclaimer: *Caso ilustrativo. Resultados individuais variam.*

NUNCA: hashtags, emoji decorativo, link na bio, transformação, jornada, cura, garantia, "compre agora"
SEMPRE: dado concreto, voice Mito+Aesop+Equinox sóbrio, frase italic editorial pontual

Retorne SÓ o texto da caption. Sem header, sem comentário, sem markdown ###.`;

  const startMs = Date.now();
  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1200,
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("\n").trim();
  const cost = ((msg.usage?.input_tokens ?? 0) / 1e6) * 3 + ((msg.usage?.output_tokens ?? 0) / 1e6) * 15;
  return { caption: text, cost, duration_ms: Date.now() - startMs };
}

// ─── Persist outputs ──────────────────────────────────────────────────────────
function persistPersonaJson({ runId, personaJson, dryRun }) {
  // Salva em personas/<personaId-runId>.json (não sobrescreve persona base)
  const personasDir = path.join(ROOT, "personas");
  fs.mkdirSync(personasDir, { recursive: true });
  const safeId = personaJson.id.replace(/[^a-z0-9-]/gi, "-");
  const p = path.join(personasDir, `${safeId}.json`);
  if (dryRun) { console.log(`  [DRY-RUN] Would write ${p}`); return safeId; }
  fs.writeFileSync(p, JSON.stringify(personaJson, null, 2));
  return safeId;
}

function persistDraftPackage({ runId, caption, personaId, dryRun }) {
  const p = path.join(ROOT, "runs", runId, "draft-package.md");
  const md = `---
content_object: ${runId}
draft_id: v1
status: verified
target_persona: ${personaId}
voice_mode: ${personaId === "ana" ? "biomarcador-deep-dive" : personaId === "pedro" ? "athletic-premium" : personaId === "julia" ? "persona-bio-warm" : "frustracao-validada"}
generated_by: content-generator
---

# Draft — ${runId}

## Caption

${caption}
`;
  if (dryRun) { console.log(`  [DRY-RUN] Would write ${p}`); return; }
  fs.writeFileSync(p, md);
}

function upsertContentObject({ runId, personaId, brief, dryRun }) {
  const p = path.join(ROOT, "runs", runId, "content-object.md");
  const fm = `---
id: ${runId}
route: original-content-generator
state: verified
pillar: ${brief.meta.pillar}
format: ${brief.meta.format}
platforms: [instagram]
created_at: ${new Date().toISOString().slice(0,10)}
updated_at: ${new Date().toISOString().slice(0,10)}
scheduled_for: ${brief.meta.slot}
next_action: render_then_publish_on_trigger
pattern: persona-bio-case-study
target_persona: ${personaId}
persona_data_file: personas/${personaId}.json
external_assets: [cover-raw.png]
---

# ${runId}

## TL;DR
Persona-bio case-study gerado autonomously pelo content-generator agent (D2 noite).
Persona alvo: ${personaId}. Pillar: P${brief.meta.pillar}. Slot: ${brief.meta.slot}.

## Brief original (idea-picker)
- Headline hint: ${brief.headline_hint}
- Angle: ${brief.angle}

## Persona data
Ver \`personas/${personaId}.json\` (auto-gerado).

## Render pendente
Próximo passo: \`node scripts/render-persona-carousel.mjs --persona ${personaId.replace(/[^a-z0-9-]/gi,"-")} --run ${runId}\`

(generator.mjs entry point cuida disso quando state==editing)
`;
  if (dryRun) { console.log(`  [DRY-RUN] Would write ${p}`); return; }
  fs.writeFileSync(p, fm);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const args = parseArgs();
console.log(`\n🤖 Content Generator · ${args.run}\n`);

const brief = readBrief(args.run);
console.log(`  Brief: P${brief.meta.pillar} · persona=${brief.meta.target_persona} · slot=${brief.meta.slot}`);
console.log(`  Headline hint: ${brief.headline_hint}\n`);

const anthropic = new Anthropic();

let totalCost = 0;

// Step 1: gera personas/<id>.json (LLM)
console.log(`  [1/3] Generating persona data via LLM...`);
const { json: personaJson, cost: c1, duration_ms: d1 } = await generatePersonaBioJson({ runId: args.run, brief, anthropic });
console.log(`         ✓ ${d1}ms · $${c1.toFixed(4)} · ${personaJson.name} (${personaJson.age}/${personaJson.biological_age})`);
totalCost += c1;

const personaId = persistPersonaJson({ runId: args.run, personaJson, dryRun: args.dryRun });

// Step 2: gera caption (LLM)
console.log(`  [2/3] Generating caption via LLM...`);
const { caption, cost: c2, duration_ms: d2 } = await generateCaption({ brief, personaJson, anthropic });
console.log(`         ✓ ${d2}ms · $${c2.toFixed(4)} · ${caption.length} chars`);
totalCost += c2;

persistDraftPackage({ runId: args.run, caption, personaId, dryRun: args.dryRun });

// Step 3: upsert content-object
console.log(`  [3/3] Upserting content-object.md...`);
upsertContentObject({ runId: args.run, personaId, brief, dryRun: args.dryRun });
console.log(`         ✓ state=verified`);

console.log(`\n✅ Total: $${totalCost.toFixed(4)} · ${d1+d2}ms`);
console.log(`   persona data: personas/${personaId}.json`);
console.log(`   draft: runs/${args.run}/draft-package.md`);

logAudit({ event: "content_generated", run_id: args.run, persona_id: personaId, total_cost_usd: totalCost, name: personaJson.name });

console.log(`\nNext: node scripts/agents/generator.mjs --run ${args.run}  # → render-persona-carousel\n`);
