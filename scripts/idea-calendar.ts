/**
 * idea-calendar.ts — Autonomous pillar rotation scheduler
 *
 * Lê quota mensal por pilar (LONGEVIFY_PILLARS.md ou foundation/strategy.md),
 * conta posts já publicados/em-draft no mês corrente, identifica o pilar mais
 * atrasado, e gera 1 idea card pronta pra virar run.
 *
 * Diferente do competitor-scan (que vem de fora), aqui a idea vem de
 * conhecimento interno: pillar gap + brand brain (proof-bank, hooks store).
 *
 * Output:
 *   runs/YYYY-MM-DD-NNN-calendar-pillar-N/
 *     idea.md (pré-populado)
 *     content-object.md (pré-populado)
 *
 * Pra GitHub Actions: roda toda terça e quinta 7am BRT.
 *
 * Uso manual:
 *   pnpm idea-calendar                     # auto pick pillar atrasado
 *   pnpm idea-calendar --pillar 3          # força pillar
 *   pnpm idea-calendar --dry-run           # só reporta, não cria run
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Cota mensal (override em foundation/strategy.md futuramente)
const MONTHLY_QUOTA: Record<number, number> = {
  1: 3, // Pilar 1 — Terroir BR
  2: 4, // Pilar 2 — Biomarcador escondido (heavy)
  3: 3, // Pilar 3 — Falha do check-up
  4: 3, // Pilar 4 — Da sensação ao dado
};

interface Args {
  pillar?: number;
  dryRun: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Partial<Args> = { dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--pillar") out.pillar = parseInt(args[++i], 10);
    else if (a === "--dry-run") out.dryRun = true;
  }
  return out as Args;
}

function countPostsThisMonth(): Record<number, number> {
  const runsDir = path.join(ROOT, "runs");
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  if (!fs.existsSync(runsDir)) return counts;

  const yyyymm = new Date().toISOString().slice(0, 7); // YYYY-MM
  const dirs = fs.readdirSync(runsDir).filter((d) => d.startsWith(yyyymm));

  for (const d of dirs) {
    const coPath = path.join(runsDir, d, "content-object.md");
    if (!fs.existsSync(coPath)) continue;
    const content = fs.readFileSync(coPath, "utf-8");
    const pillarMatch = content.match(/^pillar:\s*(\d)/m);
    const stateMatch = content.match(/^state:\s*(\w+)/m);
    if (!pillarMatch) continue;
    const p = parseInt(pillarMatch[1], 10);
    const state = stateMatch?.[1] ?? "idea";
    // Conta tudo exceto archived
    if (state !== "archived" && counts[p] !== undefined) counts[p]++;
  }
  return counts;
}

function pickPillarMostBehind(counts: Record<number, number>): number {
  let worst = 1;
  let worstGap = -Infinity;
  for (const p of [1, 2, 3, 4]) {
    const gap = MONTHLY_QUOTA[p] - (counts[p] ?? 0);
    if (gap > worstGap) {
      worstGap = gap;
      worst = p;
    }
  }
  return worst;
}

function loadPillarBrain(pillar: number): string {
  const pillarsPath = path.join(ROOT, "LONGEVIFY_PILLARS.md");
  if (!fs.existsSync(pillarsPath)) return "";
  const full = fs.readFileSync(pillarsPath, "utf-8");
  const sections = full.split(/^## Pilar /gm);
  for (const s of sections) {
    if (s.startsWith(String(pillar) + " ")) return "## Pilar " + s;
  }
  return "";
}

function loadInbox(): string {
  const inboxPath = path.join(ROOT, "foundation", "stores", "inbox.md");
  return fs.existsSync(inboxPath) ? fs.readFileSync(inboxPath, "utf-8").slice(-4000) : "";
}

function loadProofBank(): string {
  const proofPath = path.join(ROOT, "foundation", "stores", "proof-bank.md");
  return fs.existsSync(proofPath) ? fs.readFileSync(proofPath, "utf-8").slice(0, 4000) : "";
}

interface GeneratedIdea {
  slug: string;
  hook: string;
  format: "carousel" | "reel" | "post" | "story";
  route: "original" | "rewrite" | "repurpose" | "research";
  insight: string;
  why_now: string;
  anti_themes: string[];
}

async function generateIdea(pillar: number): Promise<GeneratedIdea> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const pillarBrain = loadPillarBrain(pillar);
  const inbox = loadInbox();
  const proof = loadProofBank();

  const prompt = `Você é o editor estratégico da Longevify. Gera UMA idea card pro Pilar ${pillar}, alinhada ao tom da marca (Mito + Aesop), pt-BR, ICP profissional brasileiro 30-55.

# Pilar específico
${pillarBrain}

# Proof-bank (estudos/dados disponíveis)
${proof}

# Inbox de sinais recentes (últimos itens, opcional usar)
${inbox}

# Regras
- A idea NÃO pode repetir hooks que já apareceram no inbox recente
- Hook tem que ser específico (não "fale sobre cortisol", mas sim "aquilo que muda quando o cortisol cai 30%")
- Slug em kebab-case pt-BR, máx 5 palavras
- Formato escolhido com base no insight: carrossel pra storytelling sequencial, reel pra hook visual+contemplativo, post pra single statement

Retorna JSON puro (sem markdown):
{
  "slug": "kebab-case-curto-pt-br",
  "hook": "headline tom Longevify, máx 90 chars",
  "format": "carousel" | "reel" | "post" | "story",
  "route": "original" | "rewrite" | "repurpose" | "research",
  "insight": "2-3 frases — qual é o aha desse post",
  "why_now": "1 frase — por que essa idea agora (gap do pilar, época do ano, sinal de competidor)",
  "anti_themes": ["3-5 padrões específicos a evitar nesse post"]
}`;

  const msg = await anthropic.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Claude não retornou JSON:\n" + text);
  return JSON.parse(m[0]) as GeneratedIdea;
}

function writeIdeaCard(runDir: string, idea: GeneratedIdea, pillar: number): void {
  const ideaPath = path.join(runDir, "idea.md");
  const content = `---
content_object: ${path.basename(runDir)}
route_chosen: ${idea.route}
route_reason: Auto-gerado por idea-calendar (pillar gap).
source: internal calendar — pillar ${pillar} below monthly quota
hook_quality_score: 7
pillar_fit: ${pillar}
estimated_effort: 1.5
---

# Idea — ${idea.hook}

## The insight
${idea.insight}

## Why now
${idea.why_now}

## What the audience walks away with
1 takeaway concreto — alinhado ao pilar ${pillar}.

## Anti-themes to avoid
${idea.anti_themes.map((t) => `- ❌ ${t}`).join("\n")}

## Adjacent territory (could be follow-ups)
TBD pelo writer.

## Idea Gate decision rationale
- **Source quality**: gerada por idea-calendar (auto). Verificar contra inbox antes de avançar.
- **Pilar gap**: pilar ${pillar} estava atrasado na cota mensal.
- **Format opportunity**: ${idea.format}.
- **Risk**: padrão pra auto-gerado — humano deve revisar antes do writer.
- **Effort vs reward**: standard.
`;
  fs.writeFileSync(ideaPath, content);
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY ausente");
  const args = parseArgs();

  const counts = countPostsThisMonth();
  console.log("📊 Pillar quota status (este mês):");
  for (const p of [1, 2, 3, 4]) {
    const used = counts[p] ?? 0;
    const quota = MONTHLY_QUOTA[p];
    const bar = "█".repeat(used) + "░".repeat(Math.max(0, quota - used));
    console.log(`  Pilar ${p}: ${used}/${quota}  ${bar}`);
  }

  const chosenPillar = args.pillar ?? pickPillarMostBehind(counts);
  console.log(`\n🎯 Pilar escolhido: ${chosenPillar}`);

  if (args.dryRun) {
    console.log("✋ dry-run — não gero idea nem crio run");
    process.exit(0);
  }

  const idea = await generateIdea(chosenPillar);
  console.log(`💡 Idea gerada: ${idea.hook}`);
  console.log(`   slug: ${idea.slug} · format: ${idea.format} · route: ${idea.route}`);

  // Cria run via new-run.ts
  const result = spawnSync(
    "node",
    [
      "--import",
      "tsx/esm",
      "scripts/new-run.ts",
      "--slug",
      `${idea.slug}-cal`,
      "--pillar",
      String(chosenPillar),
      "--route",
      idea.route,
      "--format",
      idea.format,
    ],
    { cwd: ROOT, encoding: "utf-8" }
  );
  process.stdout.write(result.stdout);
  if (result.status !== 0) {
    console.error(result.stderr);
    process.exit(1);
  }

  // Encontra run-id recém-criado
  const today = new Date().toISOString().slice(0, 10);
  const runsDir = path.join(ROOT, "runs");
  const matches = fs.readdirSync(runsDir).filter((d) => d.startsWith(today) && d.endsWith(`-${idea.slug}-cal`));
  if (!matches.length) throw new Error("run-id não encontrado após new-run");
  const runId = matches.sort().pop()!;
  const runDir = path.join(runsDir, runId);

  writeIdeaCard(runDir, idea, chosenPillar);

  console.log(`\n✅ runs/${runId}/idea.md`);
  console.log(`   Próximo: pnpm pipeline --resume ${runId} (vai do writer pra frente)`);
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
