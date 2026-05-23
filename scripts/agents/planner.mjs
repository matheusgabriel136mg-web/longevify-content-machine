// scripts/agents/planner.mjs — Auto-planejador da queue
//
// Lê:
//   - CLAUDE.md (slots semanais)
//   - runs/ (o que já foi feito/agendado)
//   - runs/_queue.json (queue atual)
//   - output/feedback.json (preferências consolidadas)
//   - output/analysis-* (competitor scrape mais recente, se houver)
//
// Decide:
//   Quais slots dos próximos 7 dias ainda não têm post na queue.
//   Pra cada slot vago, gera um item brief no formato { id, slot, format, type, brief, status: "draft" }.
//
// Como decidir o brief de cada slot vazio:
//   - Slot mapeia pra tipo (ex: dom 10h = manifesto/persona-bio; sex 19h = single/faixa funcional)
//   - Brief é gerado pelo Claude usando contexto de:
//     - Posts recentes (não repetir tema)
//     - Pillars 1-3 (manter mix)
//     - Patterns aprovados de competidores
//
// Output:
//   - Atualiza runs/_queue.json adicionando os novos items
//   - Pra cada item novo, cria runs/<id>/idea.md placeholder
//
// Uso:
//   node scripts/agents/planner.mjs [--days 7] [--dry-run]

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";
import { readQueue, upsertItem } from "./queue.mjs";

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

const CLAUDE_MD = path.join(ROOT, "CLAUDE.md");
const RUNS_DIR = path.join(ROOT, "runs");
const FEEDBACK_JSON = path.join(ROOT, "output", "feedback.json");

function parseArgs() {
  const a = process.argv.slice(2);
  const out = { days: 7, dryRun: false };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--days") out.days = parseInt(a[++i]);
    else if (a[i] === "--dry-run") out.dryRun = true;
  }
  return out;
}

// Slots semanais (mirror da tabela no CLAUDE.md)
const WEEKLY_SLOTS = [
  { day: 1, hour: 11, format: "carousel", type: "carrossel-geral" },             // Seg
  { day: 2, hour: 19, format: "carousel", type: "biomarker-dado" },              // Ter
  { day: 3, hour: 13, format: "reel",     type: "reel-tips" },                   // Qua
  { day: 4, hour: 19, format: "carousel", type: "carrossel-premium" },           // Qui
  { day: 5, hour: 19, format: "single",   type: "faixa-funcional" },             // Sex
  // Sáb: stories only — skip
  { day: 0, hour: 10, format: "carousel", type: "manifesto-or-persona-bio" },    // Dom
];

// ─── Compute próximas N datas pra cada slot ───────────────────────────────────
function upcomingSlots(daysAhead) {
  const now = new Date();
  const upcoming = [];
  for (let d = 0; d <= daysAhead; d++) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + d);
    const dow = candidate.getDay();
    const slot = WEEKLY_SLOTS.find(s => s.day === dow);
    if (!slot) continue;
    candidate.setHours(slot.hour, 0, 0, 0);
    if (candidate < now) continue; // skip passado
    upcoming.push({
      slot_iso: candidate.toISOString(),
      slot_local: candidate.toISOString().replace("Z", "-03:00").replace(/\.\d{3}/, ""),
      format: slot.format,
      type: slot.type,
      date_str: candidate.toISOString().slice(0, 10),
    });
  }
  return upcoming;
}

// ─── Já tem post planejado pra esse slot? ────────────────────────────────────
function slotAlreadyTaken(slotIso, queue) {
  return queue.items.some(it => {
    if (!it.slot) return false;
    const itSlot = new Date(it.slot).toISOString();
    return Math.abs(new Date(slotIso) - new Date(itSlot)) < 3600 * 1000; // dentro de 1h
  });
}

// ─── Lê posts recentes pra Claude saber o que não repetir ───────────────────
function recentPostsContext() {
  if (!fs.existsSync(RUNS_DIR)) return "";
  const dirs = fs.readdirSync(RUNS_DIR)
    .filter(d => /^\d{4}-\d{2}-\d{2}/.test(d))
    .sort()
    .slice(-15); // últimos 15

  return dirs.map(d => {
    const coPath = path.join(RUNS_DIR, d, "content-object.md");
    if (!fs.existsSync(coPath)) return `- ${d} (sem content-object)`;
    const txt = fs.readFileSync(coPath, "utf-8");
    const titleMatch = txt.match(/^#\s+(.+)$/m);
    const pillarMatch = txt.match(/^pillar:\s*(\d)/m);
    const patternMatch = txt.match(/^pattern:\s*(\S+)/m);
    return `- ${d} (pillar ${pillarMatch?.[1] ?? "?"} · pattern ${patternMatch?.[1] ?? "?"})  ${titleMatch?.[1] ?? ""}`;
  }).join("\n");
}

// ─── Claude: gera brief pra um slot vago ─────────────────────────────────────
async function generateBriefForSlot(slot, recentPosts) {
  const anthropic = new Anthropic();
  const claudeMd = fs.readFileSync(CLAUDE_MD, "utf-8");

  const prompt = `Você é o planejador de conteúdo Longevify. Sua tarefa: gerar um BRIEF (não o post inteiro) para um slot específico do calendário.

═══ CLAUDE.md (regras + voz) ═══
${claudeMd}

═══ POSTS RECENTES (não repetir tema/pattern) ═══
${recentPosts || "(nenhum ainda)"}

═══ SLOT VAGO ═══
- Data: ${slot.date_str}
- Hora: ${slot.slot_local}
- Formato: ${slot.format}
- Tipo esperado: ${slot.type}

═══ TAREFA ═══
Decida o BRIEF deste post. Retorne SÓ este JSON:

{
  "id": "<YYYY-MM-DD-NNN-slug-curto>",
  "slot": "${slot.slot_local}",
  "format": "${slot.format}",
  "type": "<tipo específico: brand-manifesto | persona-bio | biomarker-gap | reel-tips | etc>",
  "pillar": <1, 2 ou 3>,
  "brief": "<1-2 parágrafos descrevendo: o que o post ensina, qual o hook, qual o paradoxo/insight, qual o CTA editorial. Sem voltar pra warm taupe default se o tipo pede outra coisa. NÃO escrever a copy final aqui, só a direção.>",
  "external_assets": [<lista de arquivos que precisam vir de fora: ex: ["cover-gpt.png"] se a capa for design externo. Vazio se for tudo Higgsfield+SVG.>],
  "status": "draft",
  "_planning_notes": "<sua reasoning curta — por que esse tema/ângulo agora>"
}

Critérios:
- Não repetir pattern/tema dos últimos 5 posts.
- Manter mix de pillars (1=performance, 2=biomarcadores, 3=hábitos/identidade).
- ID slug = título curto em kebab-case (sem espaços, sem acentos).
- Se for slot dom 10h: prioriza persona-bio OR brand-manifesto.
- Se for slot qua 13h reel: reel-tips estilo Mito.
- Se for slot sex 19h: single image faixa-funcional (1 dado isolado, formato impactante).
- external_assets: só listar se REALMENTE precisar de cover GPT externo (manifesto premium, persona-bio específica). Default = [] (Longevify gera tudo).`;

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("\n");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`Planner não retornou JSON:\n${text.slice(0, 400)}`);
  return JSON.parse(m[0]);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const args = parseArgs();
console.log(`\n📅 Planner · próximos ${args.days} dias · ${args.dryRun ? "DRY-RUN" : "live"}\n`);

const queue = readQueue();
const slots = upcomingSlots(args.days);
console.log(`Slots upcoming (${slots.length}):`);
for (const s of slots) console.log(`  ${s.slot_local}  ${s.format.padEnd(10)} ${s.type}`);

const recentPosts = recentPostsContext();

const newItems = [];
for (const slot of slots) {
  if (slotAlreadyTaken(slot.slot_iso, queue)) {
    console.log(`  ⊘ ${slot.slot_local} já preenchido`);
    continue;
  }
  console.log(`\n  → gerando brief para ${slot.slot_local} (${slot.type})...`);
  try {
    const item = await generateBriefForSlot(slot, recentPosts);
    item.status = "draft";
    console.log(`    ✓ ${item.id} · pillar ${item.pillar}`);
    console.log(`    brief: ${item.brief.slice(0, 100)}...`);
    if (!args.dryRun) {
      upsertItem(item);
      // Cria run dir + idea.md placeholder
      const runDir = path.join(RUNS_DIR, item.id);
      fs.mkdirSync(path.join(runDir, "assets"), { recursive: true });
      const ideaPath = path.join(runDir, "idea.md");
      if (!fs.existsSync(ideaPath)) {
        const ideaMd = `---
content_object: ${item.id}
route: original-planner
pillar: ${item.pillar}
slot: ${item.slot}
format: ${item.format}
type: ${item.type}
created_at: ${new Date().toISOString().slice(0,10)}
---

# ${item.id}

## Brief auto-gerado
${item.brief}

## Planning notes
${item._planning_notes}

## External assets
${item.external_assets.length ? item.external_assets.map(a => `- [ ] ${a}`).join("\n") : "(nenhum — tudo Higgsfield+SVG)"}
`;
        fs.writeFileSync(ideaPath, ideaMd);
      }
    }
    newItems.push(item);
  } catch (e) {
    console.error(`    ✗ falhou: ${e.message}`);
  }
}

console.log(`\n✓ ${newItems.length} item(s) novo(s) na queue. (${args.dryRun ? "DRY-RUN, nada salvo" : "salvo em runs/_queue.json"})\n`);
