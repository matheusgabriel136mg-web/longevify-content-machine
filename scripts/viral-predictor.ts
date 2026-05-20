/**
 * viral-predictor.ts — Score 0-100 estimando virabilidade do draft.
 *
 * Combina 3 sinais:
 *   1. Hook strength (Claude analisa primeira frase contra hooks virais conhecidos)
 *   2. Format priors (reel > carousel > image, em algoritmo 2026)
 *   3. Pattern matching contra raw-posts.json dos competidores (similaridade
 *      semântica com posts que já viralizaram vsMedian>=2.0)
 *
 * NÃO garante viralização. Sinaliza posts com score baixo pra revisão antes
 * de publicar.
 *
 * Uso:
 *   pnpm viral-predict --run <id>
 *   pnpm viral-predict --run <id> --strict       # falha se score<60
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

interface Args {
  run: string;
  strict: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Partial<Args> = { strict: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--run") out.run = args[++i];
    else if (a === "--strict") out.strict = true;
  }
  if (!out.run) { console.error("Usage: pnpm viral-predict --run <id> [--strict]"); process.exit(1); }
  return out as Args;
}

function findLatestAnalysis(): string | null {
  const outDir = path.join(ROOT, "output");
  if (!fs.existsSync(outDir)) return null;
  const dirs = fs.readdirSync(outDir).filter((d) => d.startsWith("analysis-")).sort();
  return dirs.length ? path.join(outDir, dirs[dirs.length - 1]) : null;
}

function loadViralBenchmark(): Array<{ brand: string; caption: string; vsMedian: number; format: string }> {
  const dir = findLatestAnalysis();
  if (!dir) return [];
  const rawPath = path.join(dir, "raw-posts.json");
  if (!fs.existsSync(rawPath)) return [];
  const posts = JSON.parse(fs.readFileSync(rawPath, "utf-8")) as any[];
  return posts
    .filter((p) => (p.vsMedian ?? 0) >= 2.0)
    .map((p) => ({ brand: p.brand ?? "?", caption: (p.caption ?? "").slice(0, 400), vsMedian: p.vsMedian ?? 0, format: p.format ?? "image" }))
    .slice(0, 30);
}

function formatPrior(format: string): number {
  // Algoritmo IG 2026 prioriza vídeo; carrossel ainda forte em saves
  if (/reel/i.test(format)) return 25;
  if (/carousel/i.test(format)) return 18;
  return 10;
}

interface ViralScore {
  total: number; // 0-100
  hook: number; // 0-30
  format: number; // 0-25
  pattern_match: number; // 0-30
  voice: number; // 0-15
  reasoning: string;
  weak_spots: string[];
  suggestions: string[];
}

async function predict(draft: string, format: string, benchmark: any[]): Promise<ViralScore> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const prompt = `Você é o viral predictor da Longevify. Analise o draft abaixo e estime probabilidade de virar viral (vsMedian>=2.0).

# Draft a avaliar
${draft}

# Format
${format}

# Benchmark — ${benchmark.length} posts virais (vsMedian>=2x) dos competidores recentes
${benchmark.slice(0, 15).map((b, i) => `${i + 1}. [${b.brand} · ${b.vsMedian.toFixed(1)}x · ${b.format}]\n   "${b.caption.slice(0, 200)}"`).join("\n")}

# Sua tarefa
Score 0-100 combinando:
- hook (0-30): primeira frase agarra atenção em 3s? Tem stakes? Novidade?
- format (0-25): vídeo vale 25, carrossel 18, imagem 10
- pattern_match (0-30): se aproxima dos virais do benchmark em ângulo/tom?
- voice (0-15): consistência com Longevify (Mito + Aesop, sem buzzword)

Retorne JSON puro:
{
  "hook": N,
  "format": N,
  "pattern_match": N,
  "voice": N,
  "total": N,
  "reasoning": "2 frases — o que faz/não faz esse virar",
  "weak_spots": ["3-5 pontos específicos do draft que reduzem score"],
  "suggestions": ["3-5 mudanças concretas que aumentariam score"]
}`;

  const msg = await anthropic.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 2500,
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Claude não retornou JSON:\n" + text);
  const r = JSON.parse(m[0]) as ViralScore;

  // Override format pelo prior (sanity)
  r.format = formatPrior(format);
  r.total = Math.min(100, r.hook + r.format + r.pattern_match + r.voice);
  return r;
}

function saveReport(runDir: string, runId: string, score: ViralScore): string {
  const L: string[] = [];
  L.push(`---`);
  L.push(`viral_score: ${score.total}/100`);
  L.push(`hook: ${score.hook}/30`);
  L.push(`format: ${score.format}/25`);
  L.push(`pattern_match: ${score.pattern_match}/30`);
  L.push(`voice: ${score.voice}/15`);
  L.push(`predicted_at: ${new Date().toISOString()}`);
  L.push(`---`);
  L.push(``);
  L.push(`# Viral Predictor Report — ${runId}`);
  L.push(``);
  L.push(`## Score: ${score.total}/100`);
  L.push(``);
  L.push(`| Dimension | Score |`);
  L.push(`|---|---|`);
  L.push(`| Hook | ${score.hook}/30 |`);
  L.push(`| Format | ${score.format}/25 |`);
  L.push(`| Pattern match | ${score.pattern_match}/30 |`);
  L.push(`| Voice | ${score.voice}/15 |`);
  L.push(``);
  L.push(`## Reasoning`);
  L.push(score.reasoning);
  L.push(``);
  L.push(`## Weak spots`);
  for (const w of score.weak_spots) L.push(`- ${w}`);
  L.push(``);
  L.push(`## Suggestions pra melhorar`);
  for (const s of score.suggestions) L.push(`- ${s}`);
  L.push(``);
  const out = path.join(runDir, "viral-predictor.md");
  fs.writeFileSync(out, L.join("\n"));
  return out;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY ausente");
  const args = parseArgs();
  const runDir = path.join(ROOT, "runs", args.run);
  if (!fs.existsSync(runDir)) throw new Error(`Run não existe: ${runDir}`);

  const draftPath = path.join(runDir, "draft-package.md");
  if (!fs.existsSync(draftPath)) throw new Error("draft-package.md não encontrado");
  const draft = fs.readFileSync(draftPath, "utf-8");

  const coPath = path.join(runDir, "content-object.md");
  const format = fs.existsSync(coPath) ? (fs.readFileSync(coPath, "utf-8").match(/^format:\s*(\w+)/m)?.[1] ?? "carousel") : "carousel";

  const benchmark = loadViralBenchmark();
  console.log(`📊 Benchmark: ${benchmark.length} posts virais (vsMedian≥2.0)`);

  const score = await predict(draft, format, benchmark);
  const reportPath = saveReport(runDir, args.run, score);

  console.log(`\n🎯 Viral score: ${score.total}/100`);
  console.log(`   hook=${score.hook}/30 · format=${score.format}/25 · pattern=${score.pattern_match}/30 · voice=${score.voice}/15`);
  console.log(`   ${score.reasoning}`);
  console.log(`\n📋 ${path.relative(ROOT, reportPath)}`);

  if (args.strict && score.total < 60) {
    console.log("\n🚨 Score < 60. Strict mode: falhando.");
    process.exit(2);
  }
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
