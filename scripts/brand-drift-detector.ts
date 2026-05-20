/**
 * brand-drift-detector.ts — Monitor brand voice drift across published posts.
 *
 * Pega os N posts mais recentes publicados (state=published), envia pro Claude
 * comparar contra LONGEVIFY_BRAND.md + BRAND_DEFAULTS.md + foundation/voice.md
 * e detectar se a voz da marca está derivando.
 *
 * Sinal: cada post recebe drift_score (0=fiel, 10=totalmente fora).
 * Trigger alerta se média dos últimos 5 ≥ 4.0 OU se delta entre primeiro/último ≥ 3.
 *
 * Roda diariamente via cron.
 *
 * Uso:
 *   pnpm brand-drift-detector
 *   pnpm brand-drift-detector --window 10        # default 10 últimos
 *   pnpm brand-drift-detector --threshold 3.5    # default 4.0
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { notify } from "./notify.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

interface Args {
  window: number;
  threshold: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Args = { window: 10, threshold: 4.0 };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--window") out.window = parseInt(args[++i], 10);
    else if (a === "--threshold") out.threshold = parseFloat(args[++i]);
  }
  return out;
}

interface PublishedRun {
  run_id: string;
  pillar: string;
  format: string;
  hook: string;
  caption: string;
  published_at: string;
}

function loadRecentPublished(window: number): PublishedRun[] {
  const runsDir = path.join(ROOT, "runs");
  if (!fs.existsSync(runsDir)) return [];
  const items: PublishedRun[] = [];

  for (const dir of fs.readdirSync(runsDir)) {
    if (dir.startsWith("_") || dir.startsWith(".")) continue;
    const runDir = path.join(runsDir, dir);
    const coPath = path.join(runDir, "content-object.md");
    if (!fs.existsSync(coPath)) continue;
    const co = fs.readFileSync(coPath, "utf-8");
    if (!/^state:\s*published/m.test(co)) continue;
    const pillar = co.match(/^pillar:\s*(\d+)/m)?.[1] ?? "?";
    const format = co.match(/^format:\s*(\w+)/m)?.[1] ?? "?";
    const updatedAt = co.match(/^updated_at:\s*(.+)/m)?.[1]?.trim() ?? "";

    const draftPath = path.join(runDir, "draft-package.md");
    let hook = "";
    let caption = "";
    if (fs.existsSync(draftPath)) {
      const dc = fs.readFileSync(draftPath, "utf-8");
      hook = dc.match(/### Headline\s*\n+\*?\*?([^\n*]+)/)?.[1]?.trim() ?? "";
      const cm = dc.match(/### Caption[^\n]*\n([\s\S]*?)(?=\n###|\n##|\n# )/);
      caption = cm?.[1]?.trim().slice(0, 600) ?? "";
    }

    items.push({ run_id: dir, pillar, format, hook, caption, published_at: updatedAt });
  }

  return items.sort((a, b) => b.published_at.localeCompare(a.published_at)).slice(0, window);
}

function loadBrandBaseline(): string {
  const parts: string[] = [];
  for (const file of ["LONGEVIFY_BRAND.md", "LONGEVIFY_PILLARS.md", "BRAND_DEFAULTS.md", "foundation/voice.md"]) {
    const p = path.join(ROOT, file);
    if (fs.existsSync(p)) parts.push(`# ${file}\n\n${fs.readFileSync(p, "utf-8")}`);
  }
  return parts.join("\n\n---\n\n").slice(0, 12000);
}

interface DriftResult {
  posts: Array<{ run_id: string; drift_score: number; reason: string; flags: string[] }>;
  average_drift: number;
  trend: "stable" | "drifting_up" | "drifting_down";
  alert: boolean;
  recommendation: string;
}

async function analyzeDrift(runs: PublishedRun[], baseline: string): Promise<DriftResult> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const prompt = `Você é o brand voice analyzer da Longevify.

# Baseline (canônico)
${baseline}

# Últimos ${runs.length} posts publicados (ordem cronológica, mais recente primeiro)
${runs.map((r, i) => `
## Post ${i + 1} — ${r.run_id} (${r.published_at})
- Pilar: ${r.pillar} · Format: ${r.format}
- Hook: ${r.hook}
- Caption: ${r.caption}
`).join("\n")}

# Sua tarefa
Para cada post, avalia drift_score (0-10):
- 0 = fidelidade absoluta ao baseline (tom Mito+Aesop, ICP BR, pilar coerente)
- 3 = pequenas variações aceitáveis
- 5 = derivando — sinal de alerta
- 8+ = não soa Longevify

Calcula média + trend (comparando primeiros 3 vs últimos 3). Retorna JSON puro:

{
  "posts": [
    { "run_id": "...", "drift_score": 0-10, "reason": "1 frase", "flags": ["tag1", "tag2"] }
  ],
  "average_drift": number,
  "trend": "stable" | "drifting_up" | "drifting_down",
  "alert": boolean,
  "recommendation": "1-2 frases — o que fazer se houver drift"
}

Flags úteis: "corporativês", "fear", "self-help", "buzzwords", "pilar-fora", "hook-fraco", "caption-longa", "americanismo".`;

  console.log(`→ Claude analisando ${runs.length} posts...`);
  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 3000,
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text).join("\n");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Claude não retornou JSON:\n" + text);
  return JSON.parse(m[0]) as DriftResult;
}

function saveReport(result: DriftResult): string {
  const today = new Date().toISOString().slice(0, 10);
  const dir = path.join(ROOT, "logs", "brand-drift");
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${today}.json`);
  fs.writeFileSync(p, JSON.stringify(result, null, 2));
  return p;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY ausente");
  const args = parseArgs();

  const runs = loadRecentPublished(args.window);
  console.log(`📊 ${runs.length} posts publicados analisados (window=${args.window})`);

  if (runs.length < 3) {
    console.log(`⚠️  Poucos posts (${runs.length}). Drift detection precisa de ≥3 publicados pra ter sinal.`);
    process.exit(0);
  }

  const baseline = loadBrandBaseline();
  const result = await analyzeDrift(runs, baseline);

  const p = saveReport(result);
  console.log(`\n📋 Relatório: ${path.relative(ROOT, p)}`);
  console.log(`   Média drift: ${result.average_drift.toFixed(2)}/10`);
  console.log(`   Trend: ${result.trend}`);
  console.log(`   Alert: ${result.alert ? "🚨 SIM" : "✅ não"}`);

  for (const post of result.posts) {
    const icon = post.drift_score >= 5 ? "🔴" : post.drift_score >= 3 ? "🟡" : "🟢";
    console.log(`   ${icon} ${post.drift_score}/10 — ${post.run_id} — ${post.reason}`);
  }

  if (result.alert || result.average_drift >= args.threshold) {
    await notify({
      title: "Longevify · Brand voice drift detectado",
      message: `Média ${result.average_drift.toFixed(1)}/10 · ${result.trend}. ${result.recommendation}`,
      level: "warn",
    });
    process.exit(2);
  }
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
