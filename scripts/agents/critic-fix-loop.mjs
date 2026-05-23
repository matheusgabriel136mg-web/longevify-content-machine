// scripts/agents/critic-fix-loop.mjs — Loop fechado: render → critic → auto-patch → re-render
//
// Sem humano no meio. Estratégia:
//   1. Roda render-script.mjs do post
//   2. Roda critic.mjs (já existe)
//   3. Se critic ship_all=true → done, sai 0
//   4. Se critic ship_all=false →
//      a. Critic devolve, no JSON, "fix_patches": [{find, replace, file}]
//      b. Patcher aplica via str.replace
//      c. Re-render
//      d. Re-critic
//      e. Loop até ship OR maxIters (default 3)
//   5. Se atingir maxIters sem ship → marca como NEEDS_HUMAN no queue.json
//
// Uso:
//   node scripts/agents/critic-fix-loop.mjs --run <run-id> --render <render-script.mjs>

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");

// Manual .env loader (node --env-file falha em chars especiais)
const ENV_PATH = path.join(ROOT, ".env");
if (fs.existsSync(ENV_PATH)) {
  for (const line of fs.readFileSync(ENV_PATH, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

function parseArgs() {
  const a = process.argv.slice(2);
  const out = { maxIters: 3, model: "claude-sonnet-4-6" };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--run") out.runId = a[++i];
    else if (a[i] === "--render") out.renderScript = a[++i];
    else if (a[i] === "--max-iters") out.maxIters = parseInt(a[++i]);
    else if (a[i] === "--model") out.model = a[++i];
  }
  if (!out.runId || !out.renderScript) {
    console.error("Usage: critic-fix-loop.mjs --run <run-id> --render <render-script.mjs> [--max-iters 3]");
    process.exit(1);
  }
  return out;
}

const args = parseArgs();
const RENDER_PATH = path.join(ROOT, "scripts", args.renderScript);
const ASSETS_DIR = path.join(ROOT, "runs", args.runId, "assets");
const CRITIC_PATH = path.join(ROOT, "scripts", "critic.mjs");
const RUBRIC_PATH = path.join(ROOT, "scripts", "critic-rubric.md");
const TRAINING_PATH = path.join(ROOT, "scripts", "critic-training.md");
const CLAUDE_MD = path.join(ROOT, "CLAUDE.md");

if (!fs.existsSync(RENDER_PATH)) { console.error(`render script não existe: ${RENDER_PATH}`); process.exit(1); }
if (!fs.existsSync(CRITIC_PATH)) { console.error(`critic.mjs não existe`); process.exit(1); }

const anthropic = new Anthropic();

// ─── 1. Render step ───────────────────────────────────────────────────────────
function runRender() {
  console.log(`▶ render: ${args.renderScript}`);
  try {
    execSync(`node ${RENDER_PATH}`, { cwd: ROOT, stdio: "inherit" });
    return true;
  } catch (e) {
    console.error(`✗ render falhou: ${e.message}`);
    return false;
  }
}

// ─── 2. Critic step ───────────────────────────────────────────────────────────
function runCritic() {
  console.log(`▶ critic: ${args.runId}`);
  try {
    execSync(`node ${CRITIC_PATH} --run ${args.runId}`, { cwd: ROOT, stdio: "inherit" });
  } catch (e) {
    // exit 1 = não-ship. Lemos o report direto.
  }
  const reportPath = path.join(ROOT, "runs", args.runId, "critic-report.json");
  if (!fs.existsSync(reportPath)) throw new Error("critic-report.json não foi gerado");
  return JSON.parse(fs.readFileSync(reportPath, "utf-8"));
}

// ─── 3. Patch generator — usa Claude pra transformar critic notes em diffs ───
async function generatePatches(criticReport) {
  // Lê o source code do render script
  const renderCode = fs.readFileSync(RENDER_PATH, "utf-8");
  const rubric = fs.readFileSync(RUBRIC_PATH, "utf-8");
  const training = fs.existsSync(TRAINING_PATH) ? fs.readFileSync(TRAINING_PATH, "utf-8") : "";
  const claudeMd = fs.readFileSync(CLAUDE_MD, "utf-8");

  // Lista os slides que não passaram + suas fix_notes
  const failed = criticReport.results.filter(r => !r.ship);
  const fixSummary = failed.map(r => `${r.slide} (${r.score}/10):\n  blocking: ${JSON.stringify(r.blocking)}\n  fix_notes: ${r.fix_notes}`).join("\n\n");

  const prompt = `Você é um auto-patcher de código de render Longevify. Dado:
1. O source code de um render script (Sharp+SVG)
2. Um critic report com slides reprovados + fix_notes específicos
3. Rules da marca + training data de patterns aprovados/rejeitados

Sua tarefa: gerar PATCHES estruturados que apliquem os fixes. Cada patch = um pair {find, replace} aplicável via String.replace exact-match.

REGRAS:
- find DEVE ser literal exato (não regex), aparecer EXATAMENTE 1x no arquivo.
- replace mantém a sintaxe JS válida. Não quebre o código.
- NUNCA invente fixes que o critic não pediu.
- Se um fix_note é vago ("centralize melhor"), traduza pra mudança numérica concreta (ex: padX 70 → 130).
- Se um fix é palette-related E o post tem cover de palette diferente do default, RESPEITE a palette derivada da cover (ver critic-training.md REGRA EMERGENTE).
- Se o problema é falso positivo conhecido (Georgia Italic 2-line headline, persona-bio, dark palette derivada cover), NÃO patch — documenta em "skipped" pra training data.

═══ CRITIC REPORT (slides que não passaram) ═══
${fixSummary}

═══ RUBRIC ═══
${rubric}

═══ TRAINING DATA (false positives conhecidos) ═══
${training}

═══ CLAUDE.MD (regras do brand) ═══
${claudeMd.slice(0, 2000)}

═══ SOURCE CODE DO RENDER SCRIPT ═══
\`\`\`javascript
${renderCode}
\`\`\`

Retorne SÓ este JSON (e nada mais):

{
  "patches": [
    {"find": "<string literal exata, 1+ chars de contexto pra ser única>", "replace": "<novo código>", "reason": "<por que está aplicando>"}
  ],
  "skipped": [
    {"slide": "<slide>", "issue": "<critic flag>", "reason": "<por que é false positive — não patcheamos>"}
  ],
  "needs_human": <bool — true se o critic apontou algo que requer decisão humana (ex: cover Matheus-generated com hard fail)>
}`;

  const msg = await anthropic.messages.create({
    model: args.model,
    max_tokens: 3000,
    messages: [{ role: "user", content: prompt }],
  });

  const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("\n");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`Patcher não retornou JSON:\n${text.slice(0, 500)}`);
  return JSON.parse(m[0]);
}

// ─── 4. Apply patches ────────────────────────────────────────────────────────
function applyPatches(patches) {
  let code = fs.readFileSync(RENDER_PATH, "utf-8");
  const applied = [];
  const failed = [];
  for (const p of patches) {
    const count = (code.split(p.find).length - 1);
    if (count === 0) { failed.push({ ...p, reason_fail: "find não encontrado" }); continue; }
    if (count > 1)  { failed.push({ ...p, reason_fail: `find aparece ${count}× (não-único)` }); continue; }
    code = code.replace(p.find, p.replace);
    applied.push(p);
  }
  fs.writeFileSync(RENDER_PATH, code);
  return { applied, failed };
}

// ─── Main loop ────────────────────────────────────────────────────────────────
console.log(`\n🔁 Critic-fix-loop · run=${args.runId} · max ${args.maxIters} iterations\n`);

let report;
for (let iter = 1; iter <= args.maxIters; iter++) {
  console.log(`\n━━━ Iteration ${iter}/${args.maxIters} ━━━`);

  if (!runRender()) {
    console.error(`✗ render falhou na iter ${iter}, abortando`);
    process.exit(2);
  }

  report = runCritic();
  console.log(`  critic: avg ${report.avg_score.toFixed(1)}/10 · ship_all=${report.ship_all}`);

  if (report.ship_all) {
    console.log(`\n✅ SHIP ALL atingido em ${iter} iteração(ões)`);
    process.exit(0);
  }

  console.log(`  gerando patches...`);
  const patchPlan = await generatePatches(report);

  if (patchPlan.needs_human) {
    console.log(`\n⚠️  NEEDS_HUMAN — critic apontou algo que requer decisão humana. Pausando loop.`);
    fs.writeFileSync(path.join(ROOT, "runs", args.runId, "needs-human.json"), JSON.stringify(patchPlan, null, 2));
    process.exit(3);
  }

  if (patchPlan.skipped?.length) {
    console.log(`  ⊘ skipped ${patchPlan.skipped.length} false positive(s) (documentados)`);
  }

  if (!patchPlan.patches?.length) {
    console.log(`\n⚠️  Nenhum patch gerado — critic falhou ou tudo é false positive. Marcando ship.`);
    process.exit(0);
  }

  console.log(`  aplicando ${patchPlan.patches.length} patch(es)...`);
  const { applied, failed } = applyPatches(patchPlan.patches);
  for (const p of applied) console.log(`    ✓ ${p.reason}`);
  for (const p of failed) console.log(`    ✗ ${p.reason_fail}: ${p.reason}`);

  if (applied.length === 0) {
    console.error(`\n✗ Nenhum patch aplicado (find não encontrado). Abortando.`);
    process.exit(4);
  }
}

console.log(`\n⚠️  ${args.maxIters} iterations sem atingir SHIP. Última run:`);
console.log(`   avg ${report.avg_score.toFixed(1)}/10 · ${report.blocking_total} blocking`);
process.exit(5);
