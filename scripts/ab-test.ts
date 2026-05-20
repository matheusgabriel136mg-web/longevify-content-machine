/**
 * ab-test.ts — Generate 2 variants of a draft and track winner.
 *
 * Fluxo:
 *   1. Lê draft existente (runs/<id>/draft-package.md)
 *   2. Pede ao Claude 1 variação editorial (mantém pillar/format, varia hook+caption)
 *   3. Salva como draft-package-B.md (original vira A)
 *   4. (Manual ou via dashboard): publica A como story → mede 24h → promove vencedor pro feed
 *
 * Pra ver winner depois:
 *   pnpm ab-test --run <id> --select-winner A|B
 *
 * Uso:
 *   pnpm ab-test --run 2026-05-17-001-cortisol-corredora --generate
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

interface Args {
  run: string;
  generate?: boolean;
  selectWinner?: "A" | "B";
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Partial<Args> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--run") out.run = args[++i];
    else if (a === "--generate") out.generate = true;
    else if (a === "--select-winner") out.selectWinner = args[++i] as "A" | "B";
  }
  if (!out.run) {
    console.error("Usage: pnpm ab-test --run <id> [--generate | --select-winner A|B]");
    process.exit(1);
  }
  return out as Args;
}

async function generateVariantB(draftA: string): Promise<string> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const prompt = `Você é o A/B tester editorial da Longevify.

# Draft A (versão original)
${draftA}

# Sua tarefa
Crie uma VARIAÇÃO B do draft acima. Regras:
- MANTÉM: pillar, format (carrossel/reel/post), número de slides, paleta visual
- VARIA: hook (ângulo diferente), caption (estrutura nova), Visual brief (composição diferente)
- O insight nuclear é o mesmo, mas a abordagem é distinta o suficiente pra eu medir qual converte melhor
- Mesma tom Longevify (Mito + Aesop)

Retorne SOMENTE o markdown completo do draft-package-B.md no MESMO formato do A (frontmatter + sections). Sem comentários, sem preamble.`;

  console.log("→ Claude Opus gerando variação B...");
  const msg = await anthropic.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  });
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function readDraft(runDir: string, suffix = ""): string {
  const p = path.join(runDir, `draft-package${suffix}.md`);
  if (!fs.existsSync(p)) throw new Error(`Não encontrado: ${p}`);
  return fs.readFileSync(p, "utf-8");
}

function ledgerPath(runDir: string): string {
  return path.join(runDir, "ab-test.json");
}

interface ABLedger {
  generated_at: string;
  variant_b_at: string;
  winner?: "A" | "B";
  winner_at?: string;
  story_a_published_at?: string;
  story_b_published_at?: string;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY ausente");
  const args = parseArgs();
  const runDir = path.join(ROOT, "runs", args.run);
  if (!fs.existsSync(runDir)) throw new Error(`Run não existe: ${runDir}`);

  if (args.generate) {
    const draftA = readDraft(runDir);
    // Renomeia o atual pra -A (canonical) se ainda não foi
    const draftAPath = path.join(runDir, "draft-package-A.md");
    if (!fs.existsSync(draftAPath)) fs.copyFileSync(path.join(runDir, "draft-package.md"), draftAPath);

    const draftB = await generateVariantB(draftA);
    fs.writeFileSync(path.join(runDir, "draft-package-B.md"), draftB);

    const ledger: ABLedger = {
      generated_at: fs.statSync(path.join(runDir, "draft-package.md")).mtime.toISOString(),
      variant_b_at: new Date().toISOString(),
    };
    fs.writeFileSync(ledgerPath(runDir), JSON.stringify(ledger, null, 2));

    console.log(`✓ Variant B salva: runs/${args.run}/draft-package-B.md`);
    console.log(`  Próximo: revisa A vs B, publica A e B como stories sequenciais, mede engagement 24h, depois roda --select-winner`);
    return;
  }

  if (args.selectWinner) {
    const lp = ledgerPath(runDir);
    if (!fs.existsSync(lp)) throw new Error("Sem ledger A/B. Roda --generate primeiro.");
    const ledger = JSON.parse(fs.readFileSync(lp, "utf-8")) as ABLedger;
    ledger.winner = args.selectWinner;
    ledger.winner_at = new Date().toISOString();
    fs.writeFileSync(lp, JSON.stringify(ledger, null, 2));

    // Copia vencedor pra draft-package.md (canonical pra publish.ts)
    const winnerFile = `draft-package-${args.selectWinner}.md`;
    fs.copyFileSync(path.join(runDir, winnerFile), path.join(runDir, "draft-package.md"));
    console.log(`✓ Winner: ${args.selectWinner}. draft-package.md atualizado.`);
    console.log(`  Agora roda: pnpm publish --run ${args.run}`);
    return;
  }

  // Sem flag: mostra status
  const lp = ledgerPath(runDir);
  if (!fs.existsSync(lp)) {
    console.log("Sem A/B test pra esse run. Roda com --generate.");
    return;
  }
  const ledger = JSON.parse(fs.readFileSync(lp, "utf-8")) as ABLedger;
  console.log(JSON.stringify(ledger, null, 2));
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
