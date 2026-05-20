/**
 * fact-checker.ts — Phase 8 Clinical Fact-Check
 *
 * Lê draft-package.md, extrai claims clínicos/numéricos, valida cada um
 * contra: (a) proof-bank.md local, (b) PubMed live search, (c) Claude self-check.
 *
 * Output: runs/<id>/fact-check-report.md com:
 *   - Cada claim + nível de evidência (1-5)
 *   - Citações encontradas
 *   - Recomendação: keep / soften / cite-source / remove
 *
 * Pra Pilares 2 (Biomarcador) e 3 (Check-up) — claims clínicos são alto risco.
 * Para outros pilares, opcional.
 *
 * Uso:
 *   pnpm fact-check --run <id>
 *   pnpm fact-check --run <id> --strict          # falha se algum claim com evidência <3
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
  if (!out.run) {
    console.error("Usage: pnpm fact-check --run <id> [--strict]");
    process.exit(1);
  }
  return out as Args;
}

interface Claim {
  text: string;
  type: "numeric" | "causal" | "mechanism" | "guideline" | "comparison";
  evidence_level: 1 | 2 | 3 | 4 | 5; // 5 = systematic review/RCT, 1 = vibes
  sources_found: string[];
  recommendation: "keep" | "soften" | "cite-source" | "remove";
  reasoning: string;
  suggested_rewrite?: string;
}

interface FactReport {
  run_id: string;
  total_claims: number;
  high_risk: number;
  medium_risk: number;
  low_risk: number;
  claims: Claim[];
  verdict: "approved" | "revise" | "reject";
  summary: string;
}

function loadProofBank(): string {
  const p = path.join(ROOT, "foundation", "stores", "proof-bank.md");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf-8").slice(0, 12000) : "";
}

function loadPubmedCache(): string {
  const p = path.join(ROOT, "output", "pubmed");
  if (!fs.existsSync(p)) return "";
  const files = fs.readdirSync(p).filter((f) => f.endsWith(".md")).slice(0, 5);
  return files.map((f) => fs.readFileSync(path.join(p, f), "utf-8").slice(0, 3000)).join("\n\n---\n\n");
}

async function checkDraft(draft: string, proofBank: string, pubmedCache: string): Promise<FactReport> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const prompt = `Você é o clinical fact-checker da Longevify. Audita CLAIMS NUMÉRICOS, CAUSAIS, MECANÍSTICOS e DIRETRIZES no draft abaixo.

# Proof bank (estudos curados — fonte primária)
${proofBank || "(vazio)"}

# PubMed cache (estudos recentes)
${pubmedCache || "(vazio)"}

# Draft a auditar
${draft}

# Sua tarefa
Extrai TODOS os claims clínicos (não pegar prosa editorial subjetiva). Para cada:
- text: a frase exata do claim
- type: numeric | causal | mechanism | guideline | comparison
- evidence_level (1-5):
   5 = meta-análise/RCT amplamente citada
   4 = estudo grande RCT ou guideline oficial (AHA/ESC/ADA/SBC)
   3 = estudos observacionais consistentes, expert consensus
   2 = small studies ou racional mecanístico
   1 = afirmação genérica sem suporte
- sources_found: citações encontradas no proof bank ou PubMed (pode ser vazia)
- recommendation:
   keep = evidência ≥4
   soften = evidência 3, suaviza a linguagem
   cite-source = evidência ≥3 mas claim precisa atribuição
   remove = evidência ≤2 OU implica fear-mongering/promessa
- reasoning: 1 frase
- suggested_rewrite: se recommendation ≠ keep, sugere reescrita

CRÍTICO: claims tipo "ApoB alto = risco cardio" são evidence 5 (well-established).
Mas "IGF-1 alto = risco oncológico de longo prazo" é evidence 2 (mechanism only, sem RCT em humanos saudáveis).

Retorna JSON puro:
{
  "total_claims": N,
  "high_risk": N,            // claims com recommendation "remove"
  "medium_risk": N,          // "soften" ou "cite-source"
  "low_risk": N,             // "keep"
  "claims": [{ text, type, evidence_level, sources_found, recommendation, reasoning, suggested_rewrite }],
  "verdict": "approved" | "revise" | "reject",
  "summary": "2-3 frases"
}

Verdict rules:
- 1+ "remove" OR >40% claims com recommendation ≠ keep → "reject"
- 2+ "soften"/"cite-source" → "revise"
- Else → "approved"`;

  console.log("→ Claude fact-checking...");
  const msg = await anthropic.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Claude não retornou JSON:\n" + text);
  return JSON.parse(m[0]) as FactReport;
}

function formatReport(args: { runId: string; report: FactReport }): string {
  const { runId, report } = args;
  const L: string[] = [];
  L.push(`---
fact_check_verdict: ${report.verdict}
total_claims: ${report.total_claims}
high_risk: ${report.high_risk}
medium_risk: ${report.medium_risk}
low_risk: ${report.low_risk}
checked_at: ${new Date().toISOString()}
---

# Fact-Check Report — ${runId}

**Verdict: ${report.verdict.toUpperCase()}**

${report.summary}

## Claims auditados

`);
  for (const c of report.claims) {
    const icon = c.recommendation === "remove" ? "🔴" : c.recommendation === "soften" || c.recommendation === "cite-source" ? "🟡" : "🟢";
    L.push(`### ${icon} ${c.recommendation.toUpperCase()} · evidência ${c.evidence_level}/5
> "${c.text}"

- **Tipo**: ${c.type}
- **Reasoning**: ${c.reasoning}
${c.sources_found.length ? `- **Fontes encontradas**: ${c.sources_found.join("; ")}` : "- **Fontes**: nenhuma encontrada no proof-bank/PubMed"}
${c.suggested_rewrite ? `- **Sugestão reescrita**: \n  > ${c.suggested_rewrite}` : ""}

`);
  }
  return L.join("\n");
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY ausente");
  const args = parseArgs();
  const runDir = path.join(ROOT, "runs", args.run);
  if (!fs.existsSync(runDir)) throw new Error(`Run não existe: ${runDir}`);
  const draftPath = path.join(runDir, "draft-package.md");
  if (!fs.existsSync(draftPath)) throw new Error("draft-package.md não encontrado");

  const draft = fs.readFileSync(draftPath, "utf-8");
  const report = await checkDraft(draft, loadProofBank(), loadPubmedCache());

  const reportPath = path.join(runDir, "fact-check-report.md");
  fs.writeFileSync(reportPath, formatReport({ runId: args.run, report }));

  console.log(`\n📋 ${path.relative(ROOT, reportPath)}`);
  console.log(`   Claims: ${report.total_claims} (🔴 ${report.high_risk} · 🟡 ${report.medium_risk} · 🟢 ${report.low_risk})`);
  console.log(`   Verdict: ${report.verdict.toUpperCase()}`);
  console.log(`   ${report.summary}`);

  if (args.strict && report.verdict !== "approved") process.exit(2);
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
