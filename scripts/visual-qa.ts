/**
 * visual-qa.ts — Phase 4.5 Visual Self-QA (vision multimodal Claude)
 *
 * Para cada slide gerado pelo Higgsfield, Claude lê a imagem e:
 *   1. Compara com o prompt original (cabe? typography correta? sem bugs?)
 *   2. Confere bug-patterns conhecidos (metadata renderizada, fake logos, etc.)
 *   3. Retorna verdict: pass | retry | escalate
 *
 * Se retry → regenera com prompt refinado (anti-pattern adicionado)
 * Se escalate → flag pro humano revisar
 *
 * Bug-patterns aprendidos vão pra foundation/stores/visual-bug-patterns.md
 *
 * Uso:
 *   pnpm visual-qa --run 2026-05-14-001-como-funciona-carousel
 *   pnpm visual-qa --run <id> --slide 3            # 1 slide só
 *   pnpm visual-qa --run <id> --max-retries 2      # default 1
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

interface Args {
  run: string;
  slide?: number;
  maxRetries: number;
  dryRun: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Partial<Args> = { maxRetries: 1, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--run") out.run = args[++i];
    else if (a === "--slide") out.slide = parseInt(args[++i], 10);
    else if (a === "--max-retries") out.maxRetries = parseInt(args[++i], 10);
    else if (a === "--dry-run") out.dryRun = true;
  }
  if (!out.run) {
    console.error("Usage: pnpm visual-qa --run <run-id> [--slide N] [--max-retries N] [--dry-run]");
    process.exit(1);
  }
  return out as Args;
}

const BUG_PATTERNS_PATH = path.join(ROOT, "foundation", "stores", "visual-bug-patterns.md");

function loadBugPatterns(): string {
  if (!fs.existsSync(BUG_PATTERNS_PATH)) {
    fs.mkdirSync(path.dirname(BUG_PATTERNS_PATH), { recursive: true });
    fs.writeFileSync(
      BUG_PATTERNS_PATH,
      `# Visual Bug Patterns — known issues to check in every QA pass

> Atualizado automaticamente por visual-qa.ts. Cada padrão é uma falha real que já apareceu em algum slide.

## Pattern: typography-metadata-rendered
- **Symptom**: Texto do tipo "DM Sans Light 300, at 60% opacity 10pt" aparece literalmente desenhado no canvas.
- **Cause**: Prompt usou nomes de fonte/peso/opacity como instrução sem prefixo explícito.
- **Fix**: Adicionar ao prompt: "DO NOT append technical metadata, font names, opacity percentages, point sizes as text".

## Pattern: fake-logo-placeholder
- **Symptom**: Retângulo branco / frosted glass card desenhado onde deveria ter logo overlay.
- **Cause**: Prompt mencionou "logo" ou "watermark" sem proibir desenho.
- **Fix**: "Reserve clean black space for logo overlay. DO NOT draw any logo, badge, rectangle, frosted glass card, sticker, white box."

## Pattern: number-text-hallucination
- **Symptom**: Percentages como "70%" ou "60%" renderizados após uma palavra-chave (ex: "sensibilidade insulínica 70%").
- **Cause**: Modelo associou conceito a número, inferiu valor.
- **Fix**: "Render ONLY the words specified. Do NOT append any percentage, opacity value, or annotation."

## Pattern: visible-gutters
- **Symptom**: Grid de imagens tem linhas/espaços visíveis entre células.
- **Cause**: Default do modelo é desenhar grid com gap.
- **Fix**: "Cells must be RAZOR-FLUSH, zero gutters, zero gaps. Touching edges."

## Pattern: typography-misplacement
- **Symptom**: Numeral grande no centro-meio em vez de centro-esquerda (ou outro lugar especificado).
- **Cause**: Modelo default a centralizar.
- **Fix**: Especificar exatamente "row 2 column 1 of 3x3 grid" ou "left 30% of canvas".
`
    );
  }
  return fs.readFileSync(BUG_PATTERNS_PATH, "utf-8");
}

interface QAVerdict {
  verdict: "pass" | "retry" | "escalate";
  score: number; // 0-10
  issues: Array<{ pattern: string; severity: "low" | "medium" | "high"; description: string }>;
  prompt_refinement: string; // antipattern to add to next regen
  reasoning: string;
}

async function inspectImage(
  imagePath: string,
  briefSnippet: string,
  bugPatterns: string
): Promise<QAVerdict> {
  const imageData = fs.readFileSync(imagePath).toString("base64");
  const mediaType = imagePath.endsWith(".png") ? "image/png" : "image/jpeg";

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await anthropic.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageData } },
          {
            type: "text",
            text: `Você é o QA visual da Longevify. Avalie esta imagem gerada contra o brief e os bug patterns conhecidos.

# Brief do slide
${briefSnippet}

# Bug patterns conhecidos
${bugPatterns}

# Sua tarefa
Inspecione a imagem e retorne JSON puro (sem markdown fences):

{
  "verdict": "pass" | "retry" | "escalate",
  "score": 0-10,
  "issues": [
    { "pattern": "nome-do-pattern", "severity": "low" | "medium" | "high", "description": "o que vc viu" }
  ],
  "prompt_refinement": "frase exata pra adicionar ao prompt na próxima geração (anti-padrão específico)",
  "reasoning": "1-2 frases"
}

# Decision rules
- verdict="pass" se score ≥ 8 E zero issues com severity=high
- verdict="retry" se score ≥ 5 E nenhuma issue insolúvel via prompt
- verdict="escalate" se score < 5 OU issue impossível de corrigir só com prompt (ex: composição totalmente errada, paleta off, modelo não entendeu o conceito)

CRÍTICO: seja exigente com typography metadata, fake logos, percentages alucinados, gutters visíveis, paleta wrong, pure white (#FFFFFF) onde deveria ser off-white (#f8fffc), cores proibidas (red/amber/orange).`,
          },
        ],
      },
    ],
  });

  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Claude não retornou JSON:\n" + text);
  return JSON.parse(jsonMatch[0]) as QAVerdict;
}

async function regenerateWithRefinement(
  promptPath: string,
  refinement: string,
  outPath: string
): Promise<string> {
  const originalPrompt = fs.readFileSync(promptPath, "utf-8");
  const newPrompt = originalPrompt + "\n\n# Anti-pattern (added by visual-qa)\n" + refinement;
  const tmpPromptPath = promptPath.replace(/\.txt$/, "-qa.txt");
  fs.writeFileSync(tmpPromptPath, newPrompt);

  const { execSync } = await import("child_process");
  const cmd = `higgsfield generate create nano_banana_2 --prompt "$(cat ${JSON.stringify(tmpPromptPath)})" --aspect_ratio 4:5 --resolution 2k --wait`;
  const result = execSync(cmd, { encoding: "utf-8", timeout: 300_000 }).trim();
  const urlMatch = result.match(/https?:\/\/[^\s]+\.(png|jpg|jpeg|webp)/);
  if (!urlMatch) throw new Error("Higgsfield não retornou URL:\n" + result);

  const url = urlMatch[0];
  execSync(`curl -sL "${url}" -o "${outPath}"`);
  return url;
}

interface SlideJob {
  index: number;
  promptPath: string;
  imagePath: string;
  briefSnippet: string;
}

function loadSlideJobs(runDir: string, slideFilter?: number): SlideJob[] {
  const assetsDir = path.join(runDir, "assets");
  const jobs: SlideJob[] = [];

  const files = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : [];
  const slidePngs = files
    .filter((f) => /^slide-\d+-.+\.png$/.test(f) && !f.includes("-qa-"))
    .sort();

  const briefPath = path.join(runDir, "brief.md");
  const brief = fs.existsSync(briefPath) ? fs.readFileSync(briefPath, "utf-8") : "";

  for (const png of slidePngs) {
    const match = png.match(/^slide-(\d+)-/);
    if (!match) continue;
    const idx = parseInt(match[1], 10);
    if (slideFilter !== undefined && idx !== slideFilter) continue;

    const promptPath = path.join("/tmp", png.replace(/\.png$/, ".txt"));
    if (!fs.existsSync(promptPath)) {
      console.log(`  ⚠️  prompt não encontrado pra slide ${idx} (${promptPath}) — pulando`);
      continue;
    }

    jobs.push({
      index: idx,
      promptPath,
      imagePath: path.join(assetsDir, png),
      briefSnippet: brief,
    });
  }

  return jobs;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY ausente");
  const args = parseArgs();
  const runDir = path.join(ROOT, "runs", args.run);
  if (!fs.existsSync(runDir)) throw new Error(`Run não encontrado: ${runDir}`);

  const bugPatterns = loadBugPatterns();
  const jobs = loadSlideJobs(runDir, args.slide);

  if (!jobs.length) {
    console.log("⚠️  Nenhum slide encontrado pra avaliar. Rode visual-gen.ts primeiro.");
    process.exit(0);
  }

  console.log(`🔍 Avaliando ${jobs.length} slide(s) em ${args.run}\n`);

  const report: Array<{ slide: number; rounds: number; final: QAVerdict; escalated?: boolean }> = [];

  for (const job of jobs) {
    console.log(`━━━ Slide ${job.index} ━━━`);
    let verdict = await inspectImage(job.imagePath, job.briefSnippet, bugPatterns);
    let rounds = 1;
    console.log(`  [round ${rounds}] verdict=${verdict.verdict} score=${verdict.score}`);
    if (verdict.issues.length) {
      for (const iss of verdict.issues) console.log(`    · [${iss.severity}] ${iss.pattern}: ${iss.description}`);
    }

    while (verdict.verdict === "retry" && rounds < args.maxRetries + 1) {
      if (args.dryRun) {
        console.log(`  ✋ dry-run — não regenero. Refinamento sugerido: "${verdict.prompt_refinement}"`);
        break;
      }
      console.log(`  🔁 Regenerando com refinamento: "${verdict.prompt_refinement}"`);
      const newImagePath = job.imagePath.replace(/\.png$/, `-qa-r${rounds}.png`);
      try {
        await regenerateWithRefinement(job.promptPath, verdict.prompt_refinement, newImagePath);
        verdict = await inspectImage(newImagePath, job.briefSnippet, bugPatterns);
        rounds++;
        console.log(`  [round ${rounds}] verdict=${verdict.verdict} score=${verdict.score}`);
      } catch (e) {
        console.log(`  ❌ Regeração falhou: ${(e as Error).message}. Escalando.`);
        verdict.verdict = "escalate";
      }
    }

    const escalated = verdict.verdict === "escalate" || (verdict.verdict === "retry" && rounds >= args.maxRetries + 1);
    report.push({ slide: job.index, rounds, final: verdict, escalated });

    if (escalated) {
      console.log(`  🚨 Slide ${job.index} ESCALADO pro humano revisar`);
    } else {
      console.log(`  ✅ Slide ${job.index} aprovado (score=${verdict.final?.score ?? verdict.score})`);
    }
    console.log();
  }

  // Salva relatório
  const reportPath = path.join(runDir, "visual-qa-report.md");
  const L: string[] = [`# Visual QA Report — ${args.run}`, "", `> Gerado ${new Date().toLocaleString("pt-BR")}`, ""];
  L.push(`| Slide | Rounds | Score | Verdict | Issues |`);
  L.push(`|------:|-------:|------:|---------|--------|`);
  for (const r of report) {
    const issuesStr = r.final.issues.length ? r.final.issues.map((i) => `${i.severity}:${i.pattern}`).join(", ") : "—";
    L.push(`| ${r.slide} | ${r.rounds} | ${r.final.score} | ${r.escalated ? "🚨 escalate" : r.final.verdict} | ${issuesStr} |`);
  }
  L.push("");
  L.push(`## Resumo`);
  L.push(`- ${report.filter((r) => !r.escalated).length} aprovados`);
  L.push(`- ${report.filter((r) => r.escalated).length} escalados pro humano`);
  fs.writeFileSync(reportPath, L.join("\n"));

  console.log(`\n📋 Relatório: ${reportPath}`);
  const escalatedCount = report.filter((r) => r.escalated).length;
  process.exit(escalatedCount > 0 ? 2 : 0);
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
