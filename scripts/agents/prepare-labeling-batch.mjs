// scripts/agents/prepare-labeling-batch.mjs — Prepara batch pra ground truth labeling
//
// Coleta drafts existentes + gera drafts SINTÉTICOS pra cobrir gaps (personas/pilares ausentes).
// Pra cada draft, roda editor-agent e captura decisão.
// Output: runs/_labeling/YYYY-MM-DD/labeling-batch.md + 1 file por draft

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
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

const TODAY = new Date().toISOString().slice(0, 10);
const BATCH_DIR = path.join(ROOT, "runs", "_labeling", TODAY);
fs.mkdirSync(BATCH_DIR, { recursive: true });

// ─── Collect existing drafts ──────────────────────────────────────────────────
function collectExistingDrafts() {
  const runsDir = path.join(ROOT, "runs");
  const out = [];
  for (const dir of fs.readdirSync(runsDir).filter(d => /^\d{4}-\d{2}-\d{2}/.test(d))) {
    const dpPath = path.join(runsDir, dir, "draft-package.md");
    if (!fs.existsSync(dpPath)) continue;
    const dp = fs.readFileSync(dpPath, "utf-8");
    const m = dp.match(/### Caption[^\n]*\n([\s\S]*?)(?=\n###|\n##|\n# |$)/);
    if (!m) continue;
    const coPath = path.join(runsDir, dir, "content-object.md");
    const co = fs.existsSync(coPath) ? fs.readFileSync(coPath, "utf-8") : "";
    const pillar = (co.match(/^pillar:\s*(\d+)/m) ?? [, "?"])[1];
    const persona = (co.match(/^target_persona:\s*(\S+)/m) ?? [, "unknown"])[1];
    const format = (co.match(/^format:\s*(\S+)/m) ?? [, "?"])[1];
    out.push({
      source: "existing",
      run_id: dir,
      text: m[1].trim(),
      declared_pillar: pillar,
      declared_persona: persona,
      declared_format: format,
    });
  }
  return out;
}

// ─── Generate synthetic drafts pra cobrir gaps ────────────────────────────────
async function generateSynthetic({ persona, pillar, brief }) {
  const anthropic = new Anthropic();
  const voicePath = path.join(ROOT, "foundation", "voice.md");
  const voice = fs.existsSync(voicePath) ? fs.readFileSync(voicePath, "utf-8").slice(0, 3000) : "";
  const prompt = `Você é o copywriter Longevify. Escreva caption Instagram (3-5 parágrafos curtos) seguindo:

- Persona alvo: ${persona}
- Pillar: P${pillar}
- Brief: ${brief}

Voice reference:
${voice}

Retorne SÓ o texto da caption. Sem header, sem comentário.`;

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    messages: [{ role: "user", content: prompt }],
  });
  return msg.content.filter(b => b.type === "text").map(b => b.text).join("\n").trim();
}

// ─── Run editor on draft + capture decision ───────────────────────────────────
function runEditor(text, persona) {
  try {
    const result = execSync(`node ${path.join(__dirname, "editor-agent.mjs")} --text ${JSON.stringify(text)} ${persona ? `--persona ${persona}` : ""} --json`, {
      cwd: ROOT, encoding: "utf-8", timeout: 60000,
    });
    return JSON.parse(result);
  } catch (e) {
    return { decision: "ERROR", error: e.message.slice(0, 200) };
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
console.log(`\n📝 Preparing labeling batch · ${TODAY}\n`);

const existing = collectExistingDrafts();
console.log(`  ✓ ${existing.length} drafts existentes coletados`);

// Gaps identificados na cross-version diarization: Ana=0, P4 underserved, P5=0
const syntheticBriefs = [
  { persona: "ana", pillar: 2, brief: "ApoB > LDL — a partícula que entope, não o número que tranquiliza. Hook: 'Seu colesterol total tá ótimo. Seu ApoB tá em 110. Esse é o número que decide.'" },
  { persona: "ana", pillar: 4, brief: "Lp(a) hereditário em painel funcional. Por que mainstream não pede." },
  { persona: "ana", pillar: 2, brief: "Telômero como marcador de envelhecimento celular. O biomarcador que ninguém te ofereceu." },
  { persona: "ana", pillar: 6, brief: "Manhã em Equinox premium club. Routine que cruza 4 dimensões. Sem dado é só hábito." },
  { persona: "pedro", pillar: 4, brief: "HRV caiu 18% essa semana. Wearable mostra. AI Longevify cruza com cortisol curva + carga aeróbica = treino HOJE é Z2 30min, não Z4." },
  { persona: "pedro", pillar: 4, brief: "VO2max plateauing em 52. Que biomarcador investigar primeiro (e por quê não é hemograma)." },
  { persona: "pedro", pillar: 6, brief: "Z2 não é uma intensidade — é um sinal. Lactato e ferritina entram no protocolo." },
  { persona: "julia", pillar: 4, brief: "Acordou sem disposição 3 dias seguidos. Painel responde antes do médico." },
  { persona: "julia", pillar: 5, brief: "Conheça o time virtual: nutricionista + médico + psicólogo do sono + nutrólogo. Em UM plano." },
  { persona: "maria", pillar: 5, brief: "5 médicos. 3 semanas pra cada agenda. R$2.800/mês. Uma única integração custa 5% disso." },
  { persona: "maria", pillar: 3, brief: "Convênio premium pediu 'só' hemograma. Sintoma persistiu. O sistema fragmentado é caro e burro." },
  { persona: "todas", pillar: 1, brief: "Manifesto: 'A medicina convencional pergunta se você está doente. Longevify pergunta se você está otimizado.'" },
];

console.log(`  ⏳ Gerando ${syntheticBriefs.length} drafts sintéticos...`);
const synthetic = [];
for (const sb of syntheticBriefs) {
  process.stdout.write(`    ${sb.persona}/P${sb.pillar}... `);
  try {
    const text = await generateSynthetic(sb);
    synthetic.push({
      source: "synthetic",
      run_id: `synth-${sb.persona}-P${sb.pillar}-${synthetic.length+1}`,
      text,
      declared_persona: sb.persona,
      declared_pillar: sb.pillar,
      declared_format: "carousel",
      brief: sb.brief,
    });
    console.log("✓");
  } catch (e) {
    console.log(`✗ ${e.message.slice(0,80)}`);
  }
}

const all = [...existing, ...synthetic];
console.log(`\n  Total: ${all.length} drafts (${existing.length} existing + ${synthetic.length} synthetic)\n`);

// Run editor on each + write 1 file per draft
console.log(`  ⏳ Running editor-agent on each draft...`);
const summary = [];
for (let i = 0; i < all.length; i++) {
  const d = all[i];
  process.stdout.write(`    [${(i+1).toString().padStart(2)}/${all.length}] ${d.run_id.padEnd(48)} `);
  const decision = runEditor(d.text, d.declared_persona !== "unknown" ? d.declared_persona : null);
  process.stdout.write(`${decision.decision} (${decision.score ?? "?"}/12)\n`);

  const filename = `${(i+1).toString().padStart(2, "0")}__${d.declared_persona}__P${d.declared_pillar}__${d.run_id.replace(/[^a-z0-9-]/gi, "_").slice(0, 50)}.md`;
  const filepath = path.join(BATCH_DIR, filename);
  fs.writeFileSync(filepath, `---
sequence: ${i+1}
total: ${all.length}
run_id: ${d.run_id}
source: ${d.source}
declared_persona: ${d.declared_persona}
declared_pillar: ${d.declared_pillar}
declared_format: ${d.declared_format}
editor_decision: ${decision.decision}
editor_score: ${decision.score ?? "?"}
editor_persona_detected: ${decision.stages?.persona_fit?.persona ?? "?"}
${d.brief ? "brief: \"" + d.brief.replace(/"/g, "'") + "\"" : ""}
---

# Draft ${i+1}/${all.length}

## Caption text

${d.text}

---

## Editor decision

**${decision.decision}** (score ${decision.score ?? "?"}/12)

${decision.reasons?.join("\n\n") ?? "(no reasons)"}

### Fix suggestions
${decision.fix_suggestions?.map(f => "- " + f).join("\n") ?? "(none)"}

---

## ⚠️ MATHEUS LABELING SECTION

**Concordo com decisão?** [ ] sim  [ ] não

**Se NÃO, qual deveria ter sido?** [ ] APPROVE  [ ] REVISE  [ ] REJECT  [ ] ESCALATE

**Nota do PORQUÊ (curta):**

(escreva aqui se discordou — ajuda calibrar próxima iteração)

`);

  summary.push({
    seq: i+1,
    filename,
    persona: d.declared_persona,
    pillar: d.declared_pillar,
    decision: decision.decision,
    score: decision.score,
    source: d.source,
  });
}

// Write batch summary
const summaryPath = path.join(BATCH_DIR, "00-batch-summary.md");
let summaryMd = `# Ground Truth Labeling Batch · ${TODAY}\n\nTotal: ${all.length} drafts (${existing.length} existing + ${synthetic.length} synthetic)\n\n`;
summaryMd += `## Como usar\n\n1. Abra cada arquivo numerado (01__ até ${all.length.toString().padStart(2,'0')}__) em ordem.\n2. Leia a caption + editor decision + reasoning.\n3. Marque na seção MATHEUS LABELING:\n   - [x] sim/não pra concordância\n   - Se discordou: qual seria a decisão correta + nota curta do porquê\n4. Salve. Próximo arquivo.\n\nTempo estimado: ${Math.ceil(all.length * 2)} minutos (≈2min/draft).\n\n## Distribution\n\n`;

const personaCounts = {};
const pillarCounts = {};
const decisionCounts = {};
for (const s of summary) {
  personaCounts[s.persona] = (personaCounts[s.persona] || 0) + 1;
  pillarCounts[s.pillar] = (pillarCounts[s.pillar] || 0) + 1;
  decisionCounts[s.decision] = (decisionCounts[s.decision] || 0) + 1;
}
summaryMd += `**Persona:** ${Object.entries(personaCounts).map(([k,v]) => `${k}:${v}`).join(" · ")}\n`;
summaryMd += `**Pillar:** ${Object.entries(pillarCounts).map(([k,v]) => `P${k}:${v}`).join(" · ")}\n`;
summaryMd += `**Editor decision:** ${Object.entries(decisionCounts).map(([k,v]) => `${k}:${v}`).join(" · ")}\n\n`;
summaryMd += `## Lista de drafts\n\n| # | persona | pillar | decision | score | file |\n|---|---|---|---|---|---|\n`;
for (const s of summary) {
  summaryMd += `| ${s.seq} | ${s.persona} | P${s.pillar} | ${s.decision} | ${s.score ?? "?"} | \`${s.filename}\` |\n`;
}
fs.writeFileSync(summaryPath, summaryMd);

console.log(`\n✅ Batch salvo: ${path.relative(ROOT, BATCH_DIR)}/`);
console.log(`   ${all.length} drafts + 00-batch-summary.md`);
console.log(`   Tempo estimado de labeling pra você: ${Math.ceil(all.length * 2)}min\n`);
