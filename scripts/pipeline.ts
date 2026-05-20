/**
 * pipeline.ts — End-to-end content pipeline orchestrator
 *
 * Roda em sequência: new-run → writer → visual-gen → visual-qa → verifier → notify
 *
 * Cada fase é abortável (--stop-after=phase). Se uma fase falha, para e reporta.
 *
 * Uso:
 *   pnpm pipeline --slug cortisol-atleta-br --pillar 2 --route rewrite --format carousel
 *   pnpm pipeline --slug X --from-idea path/to/idea.md     # usa idea pré-escrita
 *   pnpm pipeline --resume <run-id>                        # retoma de onde parou
 *   pnpm pipeline --slug X --stop-after writer             # só até writer
 *   pnpm pipeline --slug X --skip-visual-qa                # pula self-QA
 *
 * Notifica quando termina via macOS notification (osascript).
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { notify } from "./notify.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

type Phase = "new-run" | "writer" | "visual-gen" | "visual-qa" | "verifier" | "notify";
const ALL_PHASES: Phase[] = ["new-run", "writer", "visual-gen", "visual-qa", "verifier", "notify"];

interface Args {
  slug?: string;
  pillar?: string;
  route?: string;
  format?: string;
  fromIdea?: string;
  resume?: string;
  stopAfter?: Phase;
  skipVisualQa: boolean;
  skipVerifier: boolean;
  noNotify: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Partial<Args> = { skipVisualQa: false, skipVerifier: false, noNotify: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--slug") out.slug = args[++i];
    else if (a === "--pillar") out.pillar = args[++i];
    else if (a === "--route") out.route = args[++i];
    else if (a === "--format") out.format = args[++i];
    else if (a === "--from-idea") out.fromIdea = args[++i];
    else if (a === "--resume") out.resume = args[++i];
    else if (a === "--stop-after") out.stopAfter = args[++i] as Phase;
    else if (a === "--skip-visual-qa") out.skipVisualQa = true;
    else if (a === "--skip-verifier") out.skipVerifier = true;
    else if (a === "--no-notify") out.noNotify = true;
  }
  if (!out.slug && !out.resume) {
    console.error("Usage: pnpm pipeline --slug <slug> [--pillar N] [--route R] [--format F] [--from-idea PATH] [--stop-after PHASE]");
    console.error("       pnpm pipeline --resume <run-id>");
    process.exit(1);
  }
  return out as Args;
}

function runShell(cmd: string, args: string[], label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`\n━━━ ${label} ━━━`);
    console.log(`   $ ${cmd} ${args.join(" ")}\n`);
    const child = spawn(cmd, args, { cwd: ROOT, stdio: "inherit", env: process.env, shell: false });
    child.on("close", (code) => {
      if (code === 0 || code === 2 /* visual-qa escalate is ok */) resolve();
      else reject(new Error(`${label} failed with code ${code}`));
    });
    child.on("error", reject);
  });
}

function runNode(script: string, args: string[], label: string): Promise<void> {
  return runShell("node", ["--import", "tsx/esm", `scripts/${script}.ts`, ...args], label);
}

function findRunId(slug: string): string | null {
  const runsDir = path.join(ROOT, "runs");
  if (!fs.existsSync(runsDir)) return null;
  const matches = fs.readdirSync(runsDir).filter((d) => d.endsWith("-" + slug));
  if (!matches.length) return null;
  return matches.sort().pop() ?? null;
}


async function phaseNewRun(args: Args): Promise<string> {
  if (args.resume) {
    if (!fs.existsSync(path.join(ROOT, "runs", args.resume))) {
      throw new Error(`Resume falhou: run ${args.resume} não existe`);
    }
    return args.resume;
  }
  const newRunArgs: string[] = ["--slug", args.slug!];
  if (args.pillar) newRunArgs.push("--pillar", args.pillar);
  if (args.route) newRunArgs.push("--route", args.route);
  if (args.format) newRunArgs.push("--format", args.format);
  await runNode("new-run", newRunArgs, "Phase 0 · new-run");
  const runId = findRunId(args.slug!);
  if (!runId) throw new Error(`new-run rodou mas run-id não encontrado pra slug=${args.slug}`);

  if (args.fromIdea) {
    const target = path.join(ROOT, "runs", runId, "idea.md");
    fs.copyFileSync(args.fromIdea, target);
    console.log(`   📋 idea.md copiada de ${args.fromIdea}`);
  }
  return runId;
}

async function main() {
  const args = parseArgs();
  const stopIdx = args.stopAfter ? ALL_PHASES.indexOf(args.stopAfter) : ALL_PHASES.length - 1;
  const start = Date.now();

  try {
    const runId = await phaseNewRun(args);
    console.log(`\n📁 RUN ID: ${runId}\n`);

    if (stopIdx >= 1) {
      await runNode("writer", ["--run", runId], "Phase 1 · writer");
    }

    if (stopIdx >= 2) {
      await runNode("visual-gen", ["--run", runId], "Phase 2 · visual-gen");
    }

    if (stopIdx >= 3 && !args.skipVisualQa) {
      try {
        await runNode("visual-qa", ["--run", runId], "Phase 3 · visual-qa");
      } catch (e) {
        console.log(`  ⚠️  visual-qa escalou — humano precisa revisar antes de publish`);
      }
    }

    if (stopIdx >= 4 && !args.skipVerifier) {
      try {
        await runNode("verifier", ["--run", runId], "Phase 4 · verifier");
      } catch (e) {
        console.log(`  ⚠️  verifier falhou — confere foundation/ ou roda manual`);
      }
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const runDir = path.join("runs", runId);
    console.log(`\n✅ Pipeline completo em ${elapsed}s`);
    console.log(`   📁 ${runDir}/`);
    console.log(`   📋 Próximo passo: revisar assets/ e rodar pnpm publish --run ${runId}\n`);

    if (!args.noNotify) {
      await notify({
        title: "Longevify · pipeline pronto",
        message: `${runId} pronto pra revisar`,
        level: "success",
        url: `file://${path.resolve(ROOT, runDir)}`,
      });
    }
  } catch (e) {
    const err = e as Error;
    console.error(`\n❌ Pipeline falhou: ${err.message}\n`);
    if (!args.noNotify) {
      await notify({
        title: "Longevify · pipeline FALHOU",
        message: err.message.slice(0, 200),
        level: "error",
      });
    }
    process.exit(1);
  }
}

main();
