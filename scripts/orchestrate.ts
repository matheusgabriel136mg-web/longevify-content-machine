/**
 * orchestrate.ts — Phase 3 Orchestrator
 *
 * Coordena uma run pelo lifecycle: brief → draft → visuals → verify → publish → feedback
 *
 * Lê o state atual de content-object.md, dispatcha o handler certo (script), atualiza state,
 * loop até terminal ou --until. Erros param o pipeline (fail-fast).
 *
 * Uso:
 *   pnpm orchestrate --run 2026-05-10-001-ferritina-corredora
 *   pnpm orchestrate --run <id> --until draft     # para após writer
 *   pnpm orchestrate --run <id> --from draft      # força resumir a partir de draft
 *   pnpm orchestrate --run <id> --dry-run         # mostra plano, não executa
 *   pnpm orchestrate --run <id> --skip-state visuals-generated  # pula 1 estado
 */

import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// State machine — ordem canônica de transições
const STATE_ORDER = [
  "idea",
  "brief",
  "draft",
  "visuals-generated",
  "verified",
  "published",
  "feedback-logged",
  "archived",
] as const;

type State = (typeof STATE_ORDER)[number];

interface Handler {
  state: State;
  nextState: State;
  description: string;
  // Returns true if action completed successfully (advance state), false to skip transition
  run: (runId: string, opts: HandlerOpts) => Promise<boolean>;
  // If true, this handler is currently manual (human writes the file). Orchestrator just verifies and advances.
  manual?: boolean;
}

interface HandlerOpts {
  dryRun: boolean;
  verbose: boolean;
}

interface Args {
  run: string;
  until?: State;
  from?: State;
  dryRun: boolean;
  verbose: boolean;
  skipStates: State[];
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Partial<Args> = { dryRun: false, verbose: false, skipStates: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--run") out.run = args[++i];
    else if (arg === "--until") out.until = args[++i] as State;
    else if (arg === "--from") out.from = args[++i] as State;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--verbose" || arg === "-v") out.verbose = true;
    else if (arg === "--skip-state") out.skipStates!.push(args[++i] as State);
  }
  if (!out.run) {
    console.error("Usage: pnpm orchestrate --run <run-id> [--until STATE] [--from STATE] [--dry-run] [--skip-state STATE]+");
    process.exit(1);
  }
  return out as Args;
}

function readContentObject(runDir: string): { frontmatter: Record<string, string>; raw: string } {
  const filePath = path.join(runDir, "content-object.md");
  const raw = fs.readFileSync(filePath, "utf-8");
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) throw new Error("No frontmatter in content-object.md");
  const fm: Record<string, string> = {};
  for (const line of fmMatch[1].split("\n")) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].trim();
  }
  return { frontmatter: fm, raw };
}

function updateState(runDir: string, newState: State, nextAction: string) {
  const filePath = path.join(runDir, "content-object.md");
  let content = fs.readFileSync(filePath, "utf-8");
  const today = new Date().toISOString().slice(0, 10);
  content = content
    .replace(/^state: .*$/m, `state: ${newState}`)
    .replace(/^updated_at: .*$/m, `updated_at: ${today}`)
    .replace(/^next_action: .*$/m, `next_action: ${nextAction}`);
  if (content.includes("## State log")) {
    content = content.replace(
      "## State log",
      `## State log\n- ${today}: orchestrator advanced to ${newState}`
    );
  }
  fs.writeFileSync(filePath, content);
}

function appendOrchestratorLog(runDir: string, msg: string) {
  const logPath = path.join(runDir, "orchestrator.log");
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
}

function runScript(scriptName: string, scriptArgs: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const cmd = "node";
    const fullArgs = [
      "--env-file=.env",
      "--import",
      "tsx/esm",
      path.join("scripts", scriptName),
      ...scriptArgs,
    ];
    const proc = spawn(cmd, fullArgs, { cwd: ROOT, stdio: "inherit" });
    proc.on("close", (code) => resolve(code ?? 1));
    proc.on("error", (err) => reject(err));
  });
}

// ────────────────────────────────────────────────────────────────────────────
// HANDLERS
// ────────────────────────────────────────────────────────────────────────────

const HANDLERS: Handler[] = [
  {
    state: "idea",
    nextState: "brief",
    description: "Idea written → brief packet (manual for now)",
    manual: true,
    run: async (runId, opts) => {
      const runDir = path.join(ROOT, "runs", runId);
      const briefPath = path.join(runDir, "brief.md");
      // Check if brief.md was already filled out (no template placeholders)
      const content = fs.readFileSync(briefPath, "utf-8");
      const hasTemplatePlaceholders =
        content.includes("YYYY-MM-DD-NNN-slug") ||
        content.includes("[title]") ||
        content.includes("[N]");
      if (hasTemplatePlaceholders) {
        console.log("  ⚠ brief.md still has template placeholders. Fill it out manually and re-run.");
        return false;
      }
      console.log("  ✓ brief.md ready");
      return true;
    },
  },
  {
    state: "brief",
    nextState: "draft",
    description: "Brief → draft via Writer (Claude API)",
    run: async (runId, opts) => {
      if (opts.dryRun) {
        console.log("  [dry-run] would call writer.ts");
        return true;
      }
      const code = await runScript("writer.ts", ["--run", runId]);
      return code === 0;
    },
  },
  {
    state: "draft",
    nextState: "visuals-generated",
    description: "Draft → visuals via Visual Generator (Claude + Higgsfield)",
    run: async (runId, opts) => {
      if (opts.dryRun) {
        console.log("  [dry-run] would call visual-gen.ts");
        return true;
      }
      const code = await runScript("visual-gen.ts", ["--run", runId]);
      return code === 0;
    },
  },
  {
    state: "visuals-generated",
    nextState: "verified",
    description: "Visuals + draft → Verifier (rubric 0-12 + slop scan)",
    run: async (runId, opts) => {
      if (opts.dryRun) {
        console.log("  [dry-run] would call verifier.ts");
        return true;
      }
      const code = await runScript("verifier.ts", ["--run", runId]);
      // verifier.ts updates state itself based on verdict — could be 'verified' or back to 'draft'
      // Return true only if verifier ran successfully; state will be whatever verifier set
      return code === 0;
    },
  },
  {
    state: "verified",
    nextState: "published",
    description: "Verified → Publish (IG Graph API)",
    run: async (runId, opts) => {
      if (opts.dryRun) {
        console.log("  [dry-run] would call publish.ts");
        return true;
      }
      const code = await runScript("publish.ts", ["--run", runId]);
      return code === 0;
    },
  },
  {
    state: "published",
    nextState: "feedback-logged",
    description: "Published → 24h/72h feedback scrape",
    manual: true, // Phase 6 not built yet
    run: async (runId, opts) => {
      console.log("  ⚠ Feedback scraper not built yet (Phase 6). Manual fill feedback.md:");
      console.log(`    edit runs/${runId}/feedback.md (metrics 24h/72h)`);
      console.log(`    Then mark: state: feedback-logged in content-object.md`);
      return false;
    },
  },
  {
    state: "feedback-logged",
    nextState: "archived",
    description: "Archive after 30+ days",
    manual: true,
    run: async () => {
      console.log("  ⚠ Manual archive: mv runs/<id> runs/_archived/<quarter>/");
      return false;
    },
  },
];

function findHandler(state: State): Handler | undefined {
  return HANDLERS.find((h) => h.state === state);
}

function stateIndex(state: State): number {
  return STATE_ORDER.indexOf(state);
}

async function main() {
  const args = parseArgs();
  const runDir = path.join(ROOT, "runs", args.run);
  if (!fs.existsSync(runDir)) {
    console.error(`Run not found: ${runDir}`);
    process.exit(1);
  }

  console.log(`▶ Orchestrating ${args.run}`);
  appendOrchestratorLog(runDir, `Started orchestration (args: ${JSON.stringify(args)})`);

  let { frontmatter } = readContentObject(runDir);
  let currentState = (args.from ?? (frontmatter.state as State)) as State;

  if (!STATE_ORDER.includes(currentState)) {
    console.error(`✗ Unknown state in content-object.md: ${currentState}`);
    process.exit(1);
  }

  console.log(`  current state: ${currentState}`);
  const untilState = args.until;
  if (untilState && stateIndex(untilState) <= stateIndex(currentState)) {
    console.log(`  --until ${untilState} already reached. Nothing to do.`);
    return;
  }

  while (true) {
    const handler = findHandler(currentState);
    if (!handler) {
      console.log(`\n✓ Terminal state reached: ${currentState}`);
      break;
    }
    if (args.skipStates.includes(currentState)) {
      console.log(`\n→ Skipping state ${currentState} (--skip-state)`);
      updateState(runDir, handler.nextState, "auto-orchestrated");
      currentState = handler.nextState;
      continue;
    }

    console.log(`\n┌── ${currentState} → ${handler.nextState}${handler.manual ? "  [manual]" : ""}`);
    console.log(`│  ${handler.description}`);
    console.log(`└─────`);
    appendOrchestratorLog(runDir, `Transition: ${currentState} → ${handler.nextState}`);

    const success = await handler.run(args.run, { dryRun: args.dryRun, verbose: args.verbose });
    if (!success) {
      console.log(`\n⏸  Halted at ${currentState}. Fix the issue above and re-run.`);
      appendOrchestratorLog(runDir, `Halted at ${currentState}`);
      process.exit(0);
    }

    // Re-read content-object to get the latest state (handler may have updated it itself)
    frontmatter = readContentObject(runDir).frontmatter;
    const actualState = frontmatter.state as State;

    if (actualState === currentState) {
      // Handler didn't update state — orchestrator does it
      if (!args.dryRun) updateState(runDir, handler.nextState, "auto-orchestrated");
      currentState = handler.nextState;
    } else {
      currentState = actualState;
    }

    console.log(`  ✓ now at ${currentState}`);

    if (untilState && stateIndex(currentState) >= stateIndex(untilState)) {
      console.log(`\n✓ Reached --until ${untilState}. Stopping.`);
      break;
    }
  }

  appendOrchestratorLog(runDir, `Orchestration ended at state: ${currentState}`);
  console.log(`\n✓ Done. State: ${currentState}`);
}

main().catch((err) => {
  console.error("✗ Orchestrator error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
