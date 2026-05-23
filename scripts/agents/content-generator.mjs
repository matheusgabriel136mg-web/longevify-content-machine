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
const ICONS_CATALOG_PATH = path.join(ROOT, "assets", "icons", "CATALOG.yaml");
const ICONS_DIR = path.join(ROOT, "assets", "icons");

// Load icon catalog (whitelist) — fail fast if LLM invents
const ICONS_CATALOG = fs.existsSync(ICONS_CATALOG_PATH)
  ? YAML.parse(fs.readFileSync(ICONS_CATALOG_PATH, "utf-8"))
  : { icons: {} };
const VALID_ICONS = Object.keys(ICONS_CATALOG.icons || {});

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

// Derive idea.md from content-object.md when missing (regen path for old runs).
// Writes the derived idea.md to disk so subsequent calls are idempotent + cheaper.
function deriveIdeaFromContentObject(runId) {
  const coPath = path.join(ROOT, "runs", runId, "content-object.md");
  if (!fs.existsSync(coPath)) return false;
  const co = fs.readFileSync(coPath, "utf-8");

  // YAML frontmatter — both --- delimited and ```yaml fenced styles seen in repo.
  const fmMatch = co.match(/^---\n([\s\S]*?)\n---/) ?? co.match(/```yaml\n([\s\S]*?)\n```/);
  const fm = {};
  if (fmMatch) {
    for (const line of fmMatch[1].split("\n")) {
      const kv = line.match(/^([a-z_][a-z0-9_]*)\s*:\s*(.+?)\s*$/i);
      if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
    }
  }

  // Headline = first `# ` line after frontmatter
  const headlineMatch = co.match(/^#\s+(.+)$/m);
  const headline = headlineMatch?.[1]?.trim() ?? runId;

  // Brief = ## TL;DR section, fallback to first non-empty paragraph
  const tldrMatch = co.match(/##\s+TL;DR\s*\n([\s\S]*?)(?=\n##|\n---|$)/i);
  const briefBody = tldrMatch
    ? tldrMatch[1].trim()
    : (co.split(/\n\n/).find(p => p.trim() && !p.startsWith("#") && !p.startsWith("---")) || "").trim();

  // Slot: prefer scheduled_for, or fall back to slot.date if nested
  const slot = fm.scheduled_for || fm.slot || null;
  const ideaContent = `---
content_object: ${runId}
route: derived-from-content-object
pillar: ${fm.pillar ?? "2"}
format: ${fm.format ?? "carousel"}
target_persona: ${fm.target_persona ?? fm.persona ?? "maria"}
type: ${fm.pattern ?? fm.type ?? "persona-bio"}
${slot ? `slot: ${slot}\n` : ""}created_at: ${new Date().toISOString().slice(0,10)}
---

# ${runId}

**Headline hint:** ${headline}

**Brief:**
${briefBody || `Regenerar conteúdo pra ${runId}. Briefing derivado automaticamente de content-object.md (idea.md original ausente).`}
`;
  const ideaPath = path.join(ROOT, "runs", runId, "idea.md");
  fs.writeFileSync(ideaPath, ideaContent);
  console.log(`  ↻ derived idea.md from content-object.md`);
  return true;
}

function readBrief(runId) {
  const ideaPath = path.join(ROOT, "runs", runId, "idea.md");
  if (!fs.existsSync(ideaPath)) {
    if (!deriveIdeaFromContentObject(runId)) {
      throw new Error(`idea.md missing for ${runId} and no content-object.md to derive from`);
    }
  }
  const txt = fs.readFileSync(ideaPath, "utf-8");
  const meta = {
    pillar: parseInt((txt.match(/^pillar:\s*(\d+)/m) ?? [, "0"])[1]),
    format: (txt.match(/^format:\s*(\S+)/m) ?? [, "carousel"])[1],
    target_persona: (txt.match(/^target_persona:\s*(\S+)/m) ?? [, "unknown"])[1],
    slot: (txt.match(/^slot:\s*(\S+)/m) ?? [, null])[1],
    type: (txt.match(/^type:\s*(\S+)/m) ?? [, null])[1],
    pattern: (txt.match(/^pattern:\s*(\S+)/m) ?? [, null])[1],
  };
  const headlineMatch = txt.match(/\*\*Headline hint:\*\*\s*(.+)/);
  const angleMatch = txt.match(/\*\*Angle:\*\*\s*(.+)/);
  const briefBody = (txt.match(/\*\*Brief:\*\*\n([\s\S]*?)(?=\n##|\n---|\n\*\*External|$)/) ?? [, ""])[1].trim();
  // Regen hint: if regen-hint.txt exists (set by telegram-bot edit_v2 flow), prepend it.
  const hintPath = path.join(ROOT, "runs", runId, "regen-hint.txt");
  let regenHint = "";
  if (fs.existsSync(hintPath)) {
    try { regenHint = fs.readFileSync(hintPath, "utf-8").trim(); } catch {}
  }
  return {
    meta,
    headline_hint: headlineMatch?.[1]?.trim() ?? "",
    angle: angleMatch?.[1]?.trim() ?? "",
    brief_text: regenHint ? `[FOUNDER REGEN HINT: ${regenHint}]\n\n${briefBody}` : briefBody,
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

  // Build icons whitelist string for prompt
  const iconsListStr = Object.entries(ICONS_CATALOG.icons || {})
    .map(([fname, meta]) => `- ${fname} — ${meta.description} (tags: ${(meta.tags || []).join(", ")})`)
    .join("\n");

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
    { "n": "01", "t": "<intervenção curta>", "b": "<por que/como — 1 frase>", "icon": "<EXATAMENTE 1 nome da LISTA ABAIXO>" },
    /* 6 alavancas — CADA uma deve ter relação direta com 1 biomarker */
  ],

═══ ICON WHITELIST (USE SOMENTE ESTES — JAMAIS invente nome) ═══
${iconsListStr}

REGRA DE ICON: pra cada item do protocolo, escolha o icon mais semanticamente próximo da intervenção. Se nenhum match perfeito, escolha o mais próximo via tags. NUNCA invente um filename novo.

EXEMPLOS válidos:
- "Vitamina D3 + K2" → icon-vitd.png
- "Ômega-3 EPA/DHA" → icon-omega.png
- "Força 3× por semana" → icon-forca.png
- "Sono janela 22h-6h" → icon-sono.png
- "Sauna 2× por semana" → icon-sauna.png
- "Recheck mensal" → icon-recheck.png
- "Painel completo" → icon-painel.png
- "Investigue raiz (H. pylori)" → icon-root.png

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
function validateIcons(personaJson) {
  const invalidIcons = [];
  const remaps = {};
  for (const item of personaJson.protocolo || []) {
    if (!item.icon) continue;
    if (VALID_ICONS.includes(item.icon)) continue;
    // Try fuzzy match via tags
    const lowerIcon = item.icon.toLowerCase();
    let bestMatch = null;
    for (const [validIcon, meta] of Object.entries(ICONS_CATALOG.icons || {})) {
      const tags = (meta.tags || []).join(" ");
      const score = (lowerIcon.includes(validIcon.replace("icon-", "").replace(".png", ""))
                     || tags.toLowerCase().split(/\s+/).some(t => lowerIcon.includes(t.toLowerCase())))
                    ? 1 : 0;
      if (score && !bestMatch) bestMatch = validIcon;
    }
    if (bestMatch) {
      remaps[item.icon] = bestMatch;
      item.icon = bestMatch;
    } else {
      invalidIcons.push({ original: item.icon, fallback: "icon-painel.png" });
      item.icon = "icon-painel.png"; // generic fallback
    }
  }
  return { invalidIcons, remaps };
}

function persistPersonaJson({ runId, personaJson, dryRun }) {
  // Salva em personas/<personaId-runId>.json (não sobrescreve persona base)
  const personasDir = path.join(ROOT, "personas");
  fs.mkdirSync(personasDir, { recursive: true });
  const safeId = personaJson.id.replace(/[^a-z0-9-]/gi, "-");
  const p = path.join(personasDir, `${safeId}.json`);

  // Validate icons — remap inválidos ou fallback
  const { invalidIcons, remaps } = validateIcons(personaJson);
  if (Object.keys(remaps).length) {
    console.log(`         ⚠ Icon remaps: ${Object.entries(remaps).map(([k,v]) => `${k}→${v}`).join(", ")}`);
  }
  if (invalidIcons.length) {
    console.log(`         ⚠ Icons inventados → fallback icon-painel.png: ${invalidIcons.map(i => i.original).join(", ")}`);
  }

  // Copy icons referenced into run dir (renderer expects them there)
  const runAssetsDir = path.join(ROOT, "runs", runId, "assets");
  fs.mkdirSync(runAssetsDir, { recursive: true });
  for (const item of personaJson.protocolo || []) {
    if (!item.icon) continue;
    const srcIcon = path.join(ICONS_DIR, item.icon);
    const dstIcon = path.join(runAssetsDir, item.icon);
    if (fs.existsSync(srcIcon) && !fs.existsSync(dstIcon)) {
      fs.copyFileSync(srcIcon, dstIcon);
    }
  }

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

// ─── Dispatcher por pattern/format ───────────────────────────────────────────
async function dispatchByPattern({ brief, runId, anthropic }) {
  const p = brief.meta.pattern;
  const slot = brief.meta.type || brief.meta.slot_type;
  const format = brief.meta.format;

  if (p === "persona-bio-case-study" || slot === "persona-bio") {
    return await generatePersonaBioFlow({ brief, runId, anthropic });
  }
  if (p === "dado-punch-bryan-style" || format === "image" || slot === "dado-punch") {
    return await generateDadoPunchFlow({ brief, runId, anthropic });
  }
  if (p === "brand-manifesto" || slot === "premium-manifesto") {
    return await generateManifestoFlow({ brief, runId, anthropic });
  }
  if (p === "biomarker-gap") {
    return await generateBiomarkerGapFlow({ brief, runId, anthropic });
  }
  if (format === "reel" || p === "reel-tips-hold-to-reveal") {
    return await generateReelTipsFlow({ brief, runId, anthropic });
  }
  throw new Error(`Pattern não suportado: ${p}/${slot}/${format}`);
}

// Persona-bio flow (existing logic)
async function generatePersonaBioFlow({ brief, runId, anthropic }) {
  let totalCost = 0;
  console.log(`  [1/3] persona JSON via LLM...`);
  const { json: personaJson, cost: c1 } = await generatePersonaBioJson({ runId, brief, anthropic });
  console.log(`         ✓ $${c1.toFixed(4)} · ${personaJson.name} (${personaJson.age}/${personaJson.biological_age})`);
  totalCost += c1;
  const personaId = persistPersonaJson({ runId, personaJson, dryRun: args.dryRun });

  console.log(`  [2/3] caption via LLM...`);
  const { caption, cost: c2 } = await generateCaption({ brief, personaJson, anthropic });
  console.log(`         ✓ $${c2.toFixed(4)} · ${caption.length} chars`);
  totalCost += c2;
  persistDraftPackage({ runId, caption, personaId, dryRun: args.dryRun });

  console.log(`  [3/3] content-object verified...`);
  upsertContentObject({ runId, personaId, brief, dryRun: args.dryRun });
  return { totalCost, persona_id: personaId, format: "persona-bio" };
}

// Generic LLM-based render data generator pra outros formats
async function generateRenderData({ brief, runId, schema, anthropic }) {
  const voice = fs.readFileSync(VOICE_PATH, "utf-8").slice(0, 3000);

  const prompt = `Você é o content-generator da Longevify. Gere JSON estruturado completo no schema abaixo, baseado no brief.

═══ BRIEF ═══
Pillar: P${brief.meta.pillar}
Persona alvo: ${brief.meta.target_persona}
Format: ${brief.meta.format}
Pattern/type: ${brief.meta.pattern || brief.meta.type}
Headline hint: ${brief.headline_hint}
Angle: ${brief.angle}
Brief: ${brief.brief_text}

═══ VOICE (resumido) ═══
${voice.slice(0, 1500)}

═══ AVOID-SLOP (banidos) ═══
transformação, jornada, bora, melhor versão, link na bio, cura, garante, reverte, milagre, no excuses, no shortcuts

═══ SCHEMA EXPECTED ═══
${schema}

REGRAS:
- pt-BR puro. Voice Mito+Aesop+Equinox sóbrio. Anti-hype.
- Headlines: 4-7 palavras paradoxo/número
- Italics editoriais (Aesop) pontuais
- NUNCA hashtag, emoji decorativo, link na bio, claim médico
- Valores numéricos realistas

Retorne SÓ o JSON. Sem markdown wrapper.`;

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 3000,
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("\n");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`LLM no JSON: ${text.slice(0,300)}`);
  const cost = ((msg.usage?.input_tokens ?? 0) / 1e6) * 3 + ((msg.usage?.output_tokens ?? 0) / 1e6) * 15;
  return { json: JSON.parse(m[0]), cost };
}

async function generateDadoPunchFlow({ brief, runId, anthropic }) {
  console.log(`  [1/2] render-data via LLM (dado-punch)...`);
  const schema = `{
  "palette": "dark_cedar" | "warm_taupe" | "cream_clay",
  "kicker": "<TÓPICO · CONTEXTO>",
  "number": "<NÚMERO + UNIDADE OPCIONAL ex: 73% ou 2.3x>",
  "number_color": "amber" | "sage" | "warm",
  "headline_1": "<linha 1 que precede o número grande>",
  "headline_2_italic": "<linha 2 italic Georgia que completa a frase>",
  "body": ["<linha body 1>", "<linha body 2>"],
  "closing_italic": "<fechamento Aesop>",
  "footer_source": "<FONTE · STUDO · YEAR N=>"
}`;
  const { json, cost } = await generateRenderData({ brief, runId, schema, anthropic });
  console.log(`         ✓ $${cost.toFixed(4)} · número ${json.number}`);
  persistRenderData(runId, json);
  await generateCaptionGeneric({ brief, renderData: json, runId, anthropic, format: "dado-punch" });
  return { totalCost: cost, format: "dado-punch" };
}

async function generateManifestoFlow({ brief, runId, anthropic }) {
  console.log(`  [1/2] render-data via LLM (brand-manifesto)...`);
  const schema = `{
  "palette": "cream_clay",
  "s2_headline_1": "<headline curto>",
  "s2_headline_2_italic": "<continuation italic>",
  "s2_sub": "<sub>",
  "s2_groups": [
    {"label": "<DIMENSÃO>", "markers": ["m1", "m2", "m3", "m4"]}
    /* 4-5 grupos */
  ],
  "s2_legend": "CADA PONTO · UM MARCADOR LIDO",
  "s3_headline_1": "<...>",
  "s3_headline_2_italic": "<...>",
  "s3_sub": "<...>",
  "s3_col_left_header": "CONVENCIONAL",
  "s3_col_right_header": "LONGEVIFY",
  "s3_pairs": [{"left": "...", "right": "..."}, /* 3-4 pairs */],
  "s3_closing_italic": "<fechamento>",
  "s4_headline_1": "<...>",
  "s4_headline_2_italic": "<...>",
  "s4_sub": "<...>",
  "s4_steps": [{"n": "01", "t": "...", "b": "...", "icon": "icon-X.png"}, /* 4 steps */],
  "s5_headline_1": "<manifesto headline>",
  "s5_headline_2_italic": "<continuation>",
  "s5_body": ["linha 1", "linha 2", "linha 3"],
  "s5_closing_italic": "<sign-off italic>"
}

ICONS VÁLIDOS (use SOMENTE esta lista): ${Object.keys(ICONS_CATALOG.icons || {}).join(", ")}`;
  const { json, cost } = await generateRenderData({ brief, runId, schema, anthropic });
  console.log(`         ✓ $${cost.toFixed(4)}`);
  persistRenderData(runId, json);
  await generateCaptionGeneric({ brief, renderData: json, runId, anthropic, format: "brand-manifesto" });
  return { totalCost: cost, format: "brand-manifesto" };
}

async function generateBiomarkerGapFlow({ brief, runId, anthropic }) {
  console.log(`  [1/2] render-data via LLM (biomarker-gap)...`);
  const schema = `{
  "palette": "warm_taupe" | "dark_cedar",
  "cover_filename": "cover-raw.png",
  "cover_headline_1": "<linha 1>",
  "cover_headline_2_italic": "<linha 2 italic>",
  "cover_sub": "<sub>",
  "s2_headline_1": "<MARCADOR A ≠ MARCADOR B>",
  "s2_sub": "<sub explicativa>",
  "s2_bar_left":  {"label": "MARC A", "value": "120 µg/dL", "unit": "no sangue", "height_pct": 0.85},
  "s2_bar_right": {"label": "MARC B", "value": "22 ng/mL",  "unit": "no estoque", "height_pct": 0.18},
  "s2_body_1": "<insight body 1>",
  "s2_body_2": "<insight body 2>",
  "s2_closing_italic": "<fechamento>",
  "s3_headline_1": "<...>",
  "s3_headline_2_italic": "<...>",
  "s3_sub": "<...>",
  "s3_items": [{"title": "...", "body": "...", "icon": "icon-X.png"}, /* 4 sintomas */],
  "s4_headline_1": "<...>",
  "s4_headline_2_italic": "<...>",
  "s4_sub": "<...>",
  "s4_items": [{"n": "01", "t": "...", "b": "...", "icon": "icon-X.png"}, /* 4 alavancas */],
  "s5_headline_1": "Bloqueadores",
  "s5_headline_2_italic": "silenciosos.",
  "s5_sub": "<sub>",
  "s5_items": [{"title": "...", "body": "..."}, /* 3 bloqueadores X-mark */]
}

ICONS VÁLIDOS (use SOMENTE esta lista): ${Object.keys(ICONS_CATALOG.icons || {}).join(", ")}`;
  const { json, cost } = await generateRenderData({ brief, runId, schema, anthropic });
  console.log(`         ✓ $${cost.toFixed(4)}`);
  persistRenderData(runId, json);
  await generateCaptionGeneric({ brief, renderData: json, runId, anthropic, format: "biomarker-gap" });
  return { totalCost: cost, format: "biomarker-gap" };
}

async function generateReelTipsFlow({ brief, runId, anthropic }) {
  console.log(`  [1/2] render-data via LLM (reel-tips)...`);
  const schema = `{
  "header_line_1": "Pressione e segure",
  "header_line_2": "pra revelar sua dica:",
  "cards": [
    {"title": "TITULO\\nDUAS LINHAS UPPERCASE", "tip": "<dica concreta com biomarker/dado>", "bg": "bg-<slug>.png"}
    /* 5-8 cards */
  ],
  "fps": 30,
  "pop_in_frames": 3,
  "hold_frames": 28,
  "fade_out_frames": 3
}`;
  const { json, cost } = await generateRenderData({ brief, runId, schema, anthropic });
  console.log(`         ✓ $${cost.toFixed(4)} · ${json.cards?.length} cards`);
  persistRenderData(runId, json);
  await generateCaptionGeneric({ brief, renderData: json, runId, anthropic, format: "reel-tips" });
  return { totalCost: cost, format: "reel-tips" };
}

function persistRenderData(runId, json) {
  const runDir = path.join(ROOT, "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  const p = path.join(runDir, "render-data.json");
  fs.writeFileSync(p, JSON.stringify(json, null, 2));
}

async function generateCaptionGeneric({ brief, renderData, runId, anthropic, format }) {
  console.log(`  [2/2] caption via LLM...`);
  const voice = fs.readFileSync(VOICE_PATH, "utf-8").slice(0, 2000);
  const prompt = `Você é o copywriter Longevify. Escreva CAPTION Instagram (3-5 parágrafos curtos) baseada no render-data abaixo.

═══ Format ═══ ${format}
═══ Brief ═══
${brief.brief_text.slice(0, 1500)}
═══ Render-data (estrutura visual) ═══
${JSON.stringify(renderData, null, 1).slice(0, 2000)}
═══ Voice ═══
${voice.slice(0, 1500)}

REGRAS: pt-BR. Mito+Aesop+Equinox sóbrio. Frase italic editorial pontual. ZERO: hashtags, emoji decorativo, link na bio, transformação, jornada, cura, garantia.

Retorne SÓ o texto da caption.`;
  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
  });
  const caption = msg.content.filter(b => b.type === "text").map(b => b.text).join("\n").trim();
  const cost = ((msg.usage?.input_tokens ?? 0) / 1e6) * 3 + ((msg.usage?.output_tokens ?? 0) / 1e6) * 15;
  // Persist draft-package.md (genérico)
  const p = path.join(ROOT, "runs", runId, "draft-package.md");
  fs.writeFileSync(p, `---
content_object: ${runId}
draft_id: v1
status: verified
target_persona: ${brief.meta.target_persona}
format: ${format}
generated_by: content-generator
---

# Draft — ${runId}

## Caption

${caption}
`);
  // Upsert content-object minimal
  const coPath = path.join(ROOT, "runs", runId, "content-object.md");
  if (!fs.existsSync(coPath)) {
    fs.writeFileSync(coPath, `---
id: ${runId}
route: original-content-generator
state: verified
pillar: ${brief.meta.pillar}
format: ${brief.meta.format}
platforms: [instagram]
created_at: ${new Date().toISOString().slice(0,10)}
updated_at: ${new Date().toISOString().slice(0,10)}
scheduled_for: ${brief.meta.slot}
pattern: ${brief.meta.pattern || brief.meta.type}
target_persona: ${brief.meta.target_persona}
render_data_file: runs/${runId}/render-data.json
---

# ${runId}

Auto-generated by content-generator (${format}).
`);
  }
  console.log(`         ✓ $${cost.toFixed(4)} · caption + draft-package.md`);
  return cost;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const args = parseArgs();
console.log(`\n🤖 Content Generator · ${args.run}\n`);

const brief = readBrief(args.run);
console.log(`  Brief: P${brief.meta.pillar} · persona=${brief.meta.target_persona} · pattern=${brief.meta.pattern || brief.meta.type} · format=${brief.meta.format}`);
console.log(`  Headline hint: ${brief.headline_hint}\n`);

const anthropic = new Anthropic();

const result = await dispatchByPattern({ brief, runId: args.run, anthropic });

console.log(`\n✅ Total: $${result.totalCost.toFixed(4)} · format=${result.format}`);
logAudit({ event: "content_generated", run_id: args.run, format: result.format, total_cost_usd: result.totalCost });
console.log(`\nNext: node scripts/agents/generator.mjs --run ${args.run}\n`);
