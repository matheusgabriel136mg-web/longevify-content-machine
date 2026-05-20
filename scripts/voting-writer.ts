/**
 * voting-writer.ts — Multi-LLM consensus writer.
 *
 * 3 modelos geram drafts paralelos pro mesmo brief:
 *   - Claude Opus 4.7
 *   - Claude Sonnet 4.6
 *   - Gemini 2.5 Pro (via GOOGLE_API_KEY)
 *
 * Depois um "juiz" (Claude Sonnet diferente) compara as 3, vota no melhor +
 * sintetiza um draft final mesclando os pontos fortes.
 *
 * Custo: ~3x do writer normal. Justifica pra posts de alto risco (pilar 2/3
 * com claim clínico, OU posts de lançamento).
 *
 * Uso:
 *   pnpm voting-writer --run <id>
 *   pnpm voting-writer --run <id> --judge-only       # já tem 3 drafts, só vota
 */

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

interface Args {
  run: string;
  judgeOnly: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Partial<Args> = { judgeOnly: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--run") out.run = args[++i];
    else if (a === "--judge-only") out.judgeOnly = true;
  }
  if (!out.run) {
    console.error("Usage: pnpm voting-writer --run <id> [--judge-only]");
    process.exit(1);
  }
  return out as Args;
}

function loadContext(runId: string): { brief: string; idea: string; foundation: string } {
  const runDir = path.join(ROOT, "runs", runId);
  const read = (p: string) => fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : "";
  const brief = read(path.join(runDir, "brief.md"));
  const idea = read(path.join(runDir, "idea.md"));

  const fparts: string[] = [];
  for (const file of ["LONGEVIFY_BRAND.md", "LONGEVIFY_PILLARS.md", "BRAND_DEFAULTS.md"]) {
    const p = path.join(ROOT, file);
    if (fs.existsSync(p)) fparts.push(`# ${file}\n${fs.readFileSync(p, "utf-8")}`);
  }
  return { brief, idea, foundation: fparts.join("\n\n").slice(0, 10000) };
}

function buildWriterPrompt(ctx: { brief: string; idea: string; foundation: string }): string {
  return `Você é o writer da Longevify. Gera UM draft completo seguindo o template draft-package.md.

# Foundation
${ctx.foundation}

# Idea
${ctx.idea}

# Brief
${ctx.brief}

Retorna apenas o markdown completo (frontmatter + sections). Sem preamble.`;
}

async function genWithClaude(model: "opus" | "sonnet", prompt: string): Promise<string> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const modelId = model === "opus" ? "claude-opus-4-7" : "claude-sonnet-4-6";
  const msg = await anthropic.messages.create({
    model: modelId,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });
  return msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
}

async function genWithGemini(prompt: string): Promise<string> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY ausente");
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
  const r = await model.generateContent(prompt);
  return r.response.text();
}

interface VotingResult {
  winner: "A" | "B" | "C" | "synthesis";
  scores: { A: number; B: number; C: number };
  reasoning: string;
  synthesis_draft?: string;
}

async function judgeDrafts(drafts: { A: string; B: string; C: string }, ctx: any): Promise<VotingResult> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const prompt = `Você é o juiz independente. Tem 3 drafts pro mesmo brief.

# Foundation + Brief (contexto)
${ctx.foundation.slice(0, 6000)}

${ctx.brief}

# Draft A (Claude Opus 4.7)
${drafts.A}

# Draft B (Claude Sonnet 4.6)
${drafts.B}

# Draft C (Gemini 2.5 Pro)
${drafts.C}

# Sua tarefa
Pontua cada um (0-12) em 4 dimensões (pillar/voice/avoid-slop/hook), pega o melhor OU sintetiza um final combinando pontos fortes.

Retorna JSON puro:
{
  "scores": { "A": N, "B": N, "C": N },
  "winner": "A" | "B" | "C" | "synthesis",
  "reasoning": "2-3 frases — por que esse",
  "synthesis_draft": "se winner=synthesis, o draft final completo em markdown"
}

Decision rule:
- Se um draft é claramente superior (delta ≥3 vs próximo) → winner = ele
- Caso contrário, faz synthesis pegando hook do melhor em hook_strength, caption do melhor em voice_alignment, slides do melhor em pillar_alignment.`;

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 6000,
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Juiz não retornou JSON");
  return JSON.parse(m[0]) as VotingResult;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY ausente");
  const args = parseArgs();
  const runDir = path.join(ROOT, "runs", args.run);
  if (!fs.existsSync(runDir)) throw new Error(`Run não existe: ${runDir}`);

  const ctx = loadContext(args.run);
  const prompt = buildWriterPrompt(ctx);

  const drafts = { A: "", B: "", C: "" };
  if (args.judgeOnly) {
    drafts.A = fs.readFileSync(path.join(runDir, "draft-A.md"), "utf-8");
    drafts.B = fs.readFileSync(path.join(runDir, "draft-B.md"), "utf-8");
    drafts.C = fs.readFileSync(path.join(runDir, "draft-C.md"), "utf-8");
  } else {
    console.log("→ Generating 3 drafts em paralelo...");
    const [opus, sonnet, gemini] = await Promise.all([
      genWithClaude("opus", prompt),
      genWithClaude("sonnet", prompt),
      genWithGemini(prompt).catch((e) => { console.error("⚠️  Gemini falhou:", e.message); return ""; }),
    ]);
    drafts.A = opus;
    drafts.B = sonnet;
    drafts.C = gemini || "(Gemini indisponível)";
    fs.writeFileSync(path.join(runDir, "draft-A.md"), drafts.A);
    fs.writeFileSync(path.join(runDir, "draft-B.md"), drafts.B);
    fs.writeFileSync(path.join(runDir, "draft-C.md"), drafts.C);
    console.log(`  ✓ A (Opus, ${drafts.A.length}c), B (Sonnet, ${drafts.B.length}c), C (Gemini, ${drafts.C.length}c)`);
  }

  console.log("→ Juiz votando...");
  const result = await judgeDrafts(drafts, ctx);

  fs.writeFileSync(path.join(runDir, "voting-result.json"), JSON.stringify(result, null, 2));

  // Promove o vencedor pra draft-package.md
  let finalDraft = "";
  if (result.winner === "synthesis" && result.synthesis_draft) {
    finalDraft = result.synthesis_draft;
  } else if (result.winner !== "synthesis") {
    finalDraft = drafts[result.winner];
  } else {
    finalDraft = drafts.A; // fallback
  }
  fs.writeFileSync(path.join(runDir, "draft-package.md"), finalDraft);

  console.log(`\n🏆 Winner: ${result.winner}`);
  console.log(`   Scores: A=${result.scores.A} · B=${result.scores.B} · C=${result.scores.C}`);
  console.log(`   ${result.reasoning}`);
  console.log(`\n✓ draft-package.md atualizado com vencedor`);
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
