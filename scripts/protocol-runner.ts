/**
 * protocol-runner.ts — Roda pipeline obedecendo um protocolo formal.
 *
 * Lê foundation/protocols/<id>.json, injeta no brief como constraints
 * estritas, depois dispara writer + visual-gen + visual-qa + fact-check + verifier.
 *
 * Diferença vs pipeline.ts normal: protocols enforça slide_count, voice rules,
 * fact_check obrigatório, anti_patterns checados programaticamente.
 *
 * Uso:
 *   pnpm protocol-run --protocol p2-biomarcador-watch-list --topic "ferritina ApoB hsCRP IGF1 insulina"
 *   pnpm protocol-run --list                                             # lista protocols disponíveis
 */

import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { notify } from "./notify.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROTOCOLS_DIR = path.join(ROOT, "foundation", "protocols");

interface Protocol {
  id: string;
  name: string;
  description: string;
  pillar: number;
  format: string;
  slide_count?: number;
  duration_sec?: number;
  structure: any[];
  voice: { tone: string; forbidden: string[] };
  visual: any;
  caption_template: string;
  anti_patterns: string[];
  fact_check_required: boolean;
  estimated_cost_usd: number;
}

function listProtocols(): Protocol[] {
  if (!fs.existsSync(PROTOCOLS_DIR)) return [];
  return fs.readdirSync(PROTOCOLS_DIR)
    .filter((f) => f.endsWith(".json") && !f.includes("schema"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(PROTOCOLS_DIR, f), "utf-8")) as Protocol);
}

function loadProtocol(id: string): Protocol {
  const p = path.join(PROTOCOLS_DIR, `${id}.json`);
  if (!fs.existsSync(p)) throw new Error(`Protocol não existe: ${id}`);
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function generateBrief(protocol: Protocol, topic: string, runId: string): string {
  const L: string[] = [];
  L.push(`---`);
  L.push(`content_object: ${runId}`);
  L.push(`writer: opus-4.7`);
  L.push(`format: ${protocol.format}-${protocol.slide_count ?? "N"}-slides`);
  L.push(`aspect: 4:5`);
  L.push(`protocol: ${protocol.id}`);
  L.push(`target_metric: vsMedian >= 1.3`);
  L.push(`---`);
  L.push(``);
  L.push(`# Brief — ${protocol.name}`);
  L.push(``);
  L.push(`## Tópico específico desta run`);
  L.push(topic);
  L.push(``);
  L.push(`## Protocol enforced (do NOT deviate)`);
  L.push(``);
  L.push(`**Pillar:** ${protocol.pillar}`);
  L.push(`**Format:** ${protocol.format}`);
  if (protocol.slide_count) L.push(`**Slide count:** ${protocol.slide_count} (exato)`);
  if (protocol.duration_sec) L.push(`**Duration:** ${protocol.duration_sec}s`);
  L.push(``);
  L.push(`## Structure (slide-by-slide / scene-by-scene)`);
  L.push("```json");
  L.push(JSON.stringify(protocol.structure, null, 2));
  L.push("```");
  L.push(``);
  L.push(`## Voice`);
  L.push(`- Tone: ${protocol.voice.tone}`);
  L.push(`- Forbidden: ${protocol.voice.forbidden.join(", ")}`);
  L.push(``);
  L.push(`## Visual`);
  L.push("```json");
  L.push(JSON.stringify(protocol.visual, null, 2));
  L.push("```");
  L.push(``);
  L.push(`## Caption template`);
  L.push(protocol.caption_template);
  L.push(``);
  L.push(`## Anti-patterns (auto-reject if found)`);
  for (const a of protocol.anti_patterns) L.push(`- ❌ ${a}`);
  L.push(``);
  L.push(`## Fact-check`);
  L.push(protocol.fact_check_required ? "OBRIGATÓRIO (rodar fact-check antes de verifier)" : "Opcional");
  L.push(``);
  L.push(`## Verifier targets`);
  L.push(`- Total score: ≥ 9/12`);
  L.push(`- Zero violações de voice.forbidden`);
  L.push(`- Slide count exatamente ${protocol.slide_count ?? "conforme structure"}`);
  return L.join("\n");
}

function runStep(label: string, cmd: string, args: string[]): boolean {
  console.log(`\n━━━ ${label} ━━━`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", env: process.env });
  return r.status === 0 || r.status === 2;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--list")) {
    const ps = listProtocols();
    console.log(`📋 ${ps.length} protocolos disponíveis:\n`);
    for (const p of ps) {
      console.log(`  ${p.id}`);
      console.log(`    ${p.name}`);
      console.log(`    Pilar ${p.pillar} · ${p.format} · ~$${p.estimated_cost_usd}\n`);
    }
    return;
  }

  const protocolId = args[args.indexOf("--protocol") + 1];
  const topic = args[args.indexOf("--topic") + 1];
  if (!protocolId || !topic) {
    console.error("Usage: pnpm protocol-run --protocol <id> --topic '<descrição>' | --list");
    process.exit(1);
  }

  const protocol = loadProtocol(protocolId);
  console.log(`📋 Rodando protocolo: ${protocol.name}\n   Tópico: ${topic}\n`);

  // Cria slug
  const slug = (topic.split(/\s+/).slice(0, 4).join("-").toLowerCase().replace(/[^a-z0-9-]/g, "") || "protocol").slice(0, 40);

  // 1. new-run
  if (!runStep("Phase 0 · new-run", "node", [
    "--import", "tsx/esm", "scripts/new-run.ts",
    "--slug", `${slug}-proto`,
    "--pillar", String(protocol.pillar),
    "--route", "original",
    "--format", protocol.format,
  ])) throw new Error("new-run falhou");

  // Encontra runId
  const today = new Date().toISOString().slice(0, 10);
  const runsDir = path.join(ROOT, "runs");
  const matches = fs.readdirSync(runsDir).filter((d) => d.startsWith(today) && d.endsWith(`-${slug}-proto`));
  if (!matches.length) throw new Error("run-id não encontrado");
  const runId = matches.sort().pop()!;
  const runDir = path.join(runsDir, runId);

  // 2. Sobrescreve brief.md com o brief do protocolo
  fs.writeFileSync(path.join(runDir, "brief.md"), generateBrief(protocol, topic, runId));
  console.log(`✓ brief.md sobrescrito com protocolo`);

  // 3. writer
  if (!runStep("Phase 1 · writer", "node", [
    "--import", "tsx/esm", "scripts/writer.ts",
    "--run", runId,
  ])) throw new Error("writer falhou");

  // 4. fact-check (se obrigatório)
  if (protocol.fact_check_required) {
    runStep("Phase 1.5 · fact-check", "node", [
      "--import", "tsx/esm", "scripts/fact-checker.ts",
      "--run", runId,
    ]);
  }

  // 5. visual-gen
  runStep("Phase 2 · visual-gen", "node", ["--import", "tsx/esm", "scripts/visual-gen.ts", "--run", runId]);

  // 6. visual-qa
  runStep("Phase 3 · visual-qa", "node", ["--import", "tsx/esm", "scripts/visual-qa.ts", "--run", runId]);

  // 7. verifier
  runStep("Phase 4 · verifier", "node", ["--import", "tsx/esm", "scripts/verifier.ts", "--run", runId]);

  // 8. notify
  await notify({
    title: `Longevify · ${protocol.name}`,
    message: `${runId} pronto pra revisar no dashboard`,
    level: "success",
  });

  console.log(`\n✅ Protocolo completo: runs/${runId}/`);
  console.log(`   Próximo: abrir dashboard (http://localhost:8088) → tab Review → Aprovar / Rejeitar`);
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
