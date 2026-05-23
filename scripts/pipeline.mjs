// scripts/pipeline.mjs — Orchestrator state machine
//
// Princípio Tan #2 (narrow harness): zero markdown carregado no boot,
// agents invocados sob demanda via spawn (child_process), audit log JSONL,
// safety nets como middleware.
//
// State machine:
//   draft → rendering → editing → approving → publishing → published
//                          ↘    ↗      ↘
//                          revise        failed
//
// Persistência: SQLite em runs/_pipeline.db
// Audit log: runs/_audit-log.jsonl (append-only)
//
// CLI:
//   node scripts/pipeline.mjs run --run <run-id>           # 1 run
//   node scripts/pipeline.mjs tick                          # process all unfinished
//   node scripts/pipeline.mjs status                        # show queue
//   node scripts/pipeline.mjs reset --run <run-id>          # reset failed
//
// Cron: */15 * * * * node /path/scripts/pipeline.mjs tick

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const DB_PATH = path.join(ROOT, "runs", "_pipeline.db");
const AUDIT_LOG = path.join(ROOT, "runs", "_audit-log.jsonl");
const CIRCUIT_PATH = path.join(ROOT, "runs", "_circuit-state.json");
const SAFETY_THRESHOLDS_PATH = path.join(ROOT, "foundation", "safety-thresholds.yaml");

// Load safety thresholds from YAML (founder-approved values)
import YAML from "yaml";
const THRESHOLDS = fs.existsSync(SAFETY_THRESHOLDS_PATH)
  ? YAML.parse(fs.readFileSync(SAFETY_THRESHOLDS_PATH, "utf-8"))
  : { cost_circuit_breaker: { daily_limit_usd: 40 }, quality_circuit_breaker: { consecutive_rejects_threshold: 5 } };

// ─── DB setup ─────────────────────────────────────────────────────────────────
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    last_action TEXT,
    failure_reason TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    scheduled_for TEXT,
    persona TEXT,
    pillar INTEGER,
    format TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_state ON runs(state);
  CREATE INDEX IF NOT EXISTS idx_scheduled ON runs(scheduled_for);
`);

// ─── States + valid transitions ──────────────────────────────────────────────
const STATES = ["draft", "rendering", "editing", "approving", "publishing", "published", "failed", "blocked"];
const VALID_TRANSITIONS = {
  draft:      ["rendering", "failed", "blocked"],
  rendering:  ["editing", "failed"],
  editing:    ["approving", "draft", "failed"], // → draft = revise loop
  approving:  ["publishing", "blocked", "failed"],
  publishing: ["published", "failed"],
  published:  [],   // terminal
  failed:     ["draft"],  // can be reset to retry
  blocked:    ["draft", "approving"],
};

// ─── Audit log ───────────────────────────────────────────────────────────────
function audit(event) {
  const entry = { ts: new Date().toISOString(), ...event };
  fs.mkdirSync(path.dirname(AUDIT_LOG), { recursive: true });
  fs.appendFileSync(AUDIT_LOG, JSON.stringify(entry) + "\n");
}

// ─── Safety nets ─────────────────────────────────────────────────────────────
function checkCircuit() {
  if (!fs.existsSync(CIRCUIT_PATH)) return { state: "CLOSED" };
  const s = JSON.parse(fs.readFileSync(CIRCUIT_PATH, "utf-8"));
  if (s.state === "OPEN") {
    throw new Error(`Circuit OPEN: ${s.reason || "unknown"}. Manually close after fix.`);
  }
  // Apply founder-approved thresholds from safety-thresholds.yaml
  const costLimit = THRESHOLDS?.cost_circuit_breaker?.daily_limit_usd ?? 40;
  if ((s.cost_today ?? 0) > costLimit) {
    s.state = "OPEN";
    s.reason = `cost circuit breaker: $${(s.cost_today).toFixed(2)} > $${costLimit}/day (limit from safety-thresholds.yaml)`;
    fs.writeFileSync(CIRCUIT_PATH, JSON.stringify(s, null, 2));
    throw new Error(s.reason);
  }
  const rejectLimit = THRESHOLDS?.quality_circuit_breaker?.consecutive_rejects_threshold ?? 5;
  if ((s.reject_streak ?? 0) >= rejectLimit) {
    s.state = "OPEN";
    s.reason = `quality circuit breaker: ${s.reject_streak} consecutive REJECTs >= ${rejectLimit} (limit from safety-thresholds.yaml)`;
    fs.writeFileSync(CIRCUIT_PATH, JSON.stringify(s, null, 2));
    throw new Error(s.reason);
  }
  return s;
}

// ─── Sync queue.json → SQLite ────────────────────────────────────────────────
function syncQueueToDb() {
  const QUEUE_PATH = path.join(ROOT, "runs", "_queue.json");
  if (!fs.existsSync(QUEUE_PATH)) return;
  const queue = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf-8"));
  const upsert = db.prepare(`
    INSERT INTO runs (run_id, state, created_at, updated_at, scheduled_for, persona, pillar, format)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      scheduled_for = excluded.scheduled_for,
      persona = excluded.persona,
      pillar = excluded.pillar,
      format = excluded.format,
      updated_at = excluded.updated_at
  `);
  const now = new Date().toISOString();
  for (const item of queue.items ?? []) {
    upsert.run(item.id, item.status ?? "draft", item.created_at ?? now, now, item.slot ?? null, item.target_persona ?? null, item.pillar ?? null, item.format ?? null);
  }
}

// ─── Sync runs/ dirs → SQLite (existing runs nem em queue) ───────────────────
function syncRunsDirToDb() {
  const runsDir = path.join(ROOT, "runs");
  const dirs = fs.readdirSync(runsDir).filter(d => /^\d{4}-\d{2}-\d{2}/.test(d));
  const upsert = db.prepare(`
    INSERT INTO runs (run_id, state, created_at, updated_at, scheduled_for, persona, pillar, format)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO NOTHING
  `);
  for (const dir of dirs) {
    const coPath = path.join(runsDir, dir, "content-object.md");
    if (!fs.existsSync(coPath)) continue;
    const co = fs.readFileSync(coPath, "utf-8");
    let state = (co.match(/^state:\s*(\S+)/m) ?? [, "draft"])[1];
    // Normalize content-object states → pipeline state machine
    if (state === "verified") state = "approving";   // verified content-object é approving-step
    if (state === "visuals-generated") state = "editing"; // visuals exist, ready for editor
    if (state === "idea") state = "draft";
    const scheduledFor = (co.match(/^scheduled_for:\s*(\S+)/m) ?? [, null])[1];
    const persona = (co.match(/^target_persona:\s*(\S+)/m) ?? [, null])[1];
    const pillar = parseInt((co.match(/^pillar:\s*(\d+)/m) ?? [, "0"])[1]);
    const format = (co.match(/^format:\s*(\S+)/m) ?? [, null])[1];
    const created = (co.match(/^created_at:\s*(\S+)/m) ?? [, new Date().toISOString().slice(0,10)])[1];
    upsert.run(dir, state, created, new Date().toISOString(), scheduledFor, persona, pillar, format);
  }
}

// ─── Transition + persistence ────────────────────────────────────────────────
function transition(runId, fromState, toState, extras = {}) {
  if (!VALID_TRANSITIONS[fromState]?.includes(toState)) {
    throw new Error(`Invalid transition: ${fromState} → ${toState}`);
  }
  const update = db.prepare(`UPDATE runs SET state = ?, last_action = ?, failure_reason = ?, updated_at = ? WHERE run_id = ?`);
  update.run(toState, extras.action ?? null, extras.failure_reason ?? null, new Date().toISOString(), runId);
  audit({ event: "transition", run_id: runId, from: fromState, to: toState, ...extras });
}

// ─── Step handlers (each transition) ─────────────────────────────────────────
async function handleDraft(runId) {
  // Check if assets already rendered
  const assetsDir = path.join(ROOT, "runs", runId, "assets");
  const hasAssets = fs.existsSync(assetsDir) && fs.readdirSync(assetsDir).filter(f => /\.(png|mp4|jpe?g)$/i.test(f)).length > 0;
  if (hasAssets) {
    transition(runId, "draft", "editing", { action: "skip_rendering (assets exist)" });
    return;
  }
  // Else: would need to invoke generator agent (out of D1 scope — manual render today)
  transition(runId, "draft", "blocked", { failure_reason: "no assets + no auto-generator yet" });
}

async function handleEditing(runId) {
  // Invoke editor-agent
  try {
    const result = execSync(`node ${path.join(__dirname, "agents", "editor-agent.mjs")} --run ${runId} --json`, {
      cwd: ROOT, encoding: "utf-8", timeout: 60000,
    });
    const decision = JSON.parse(result);
    audit({ event: "editor_decision", run_id: runId, decision });

    if (decision.decision === "APPROVE") {
      transition(runId, "editing", "approving");
    } else if (decision.decision === "REVISE") {
      // ─── Auto-invoke critic-fix-loop pra tentar corrigir antes de mandar back to draft ──
      const retryCount = run.retry_count || 0;
      if (retryCount < 2) {
        try {
          // Identifica render script pela meta
          const ideaPath = path.join(ROOT, "runs", runId, "idea.md");
          const coPath = path.join(ROOT, "runs", runId, "content-object.md");
          let renderScript = null;
          for (const p of [coPath, ideaPath]) {
            if (!fs.existsSync(p)) continue;
            const txt = fs.readFileSync(p, "utf-8");
            const pattern = (txt.match(/^pattern:\s*(\S+)/m) ?? [])[1];
            if (pattern === "persona-bio-case-study") { renderScript = "render-persona-carousel.mjs"; break; }
            if (pattern === "dado-punch-bryan-style") { renderScript = "templates/dado-punch.mjs"; break; }
            if (pattern === "brand-manifesto") { renderScript = "templates/brand-manifesto.mjs"; break; }
            if (pattern === "biomarker-gap") { renderScript = "templates/biomarker-gap.mjs"; break; }
          }
          if (renderScript) {
            console.log(`  ↻ critic-fix-loop: retry ${retryCount + 1}/2 (REVISE → auto-patch attempt)`);
            audit({ event: "critic_fix_attempt", run_id: runId, retry: retryCount + 1, render_script: renderScript });
            execSync(`node ${path.join(__dirname, "agents", "critic-fix-loop.mjs")} --run ${runId} --render ${renderScript} --max-iters 2`, {
              cwd: ROOT, stdio: "ignore", timeout: 180000,
            });
            // Re-incrementa retry, mantém em editing pra próximo tick re-roda editor
            db.prepare(`UPDATE runs SET retry_count = retry_count + 1, updated_at = ? WHERE run_id = ?`).run(new Date().toISOString(), runId);
            audit({ event: "critic_fix_completed", run_id: runId });
            return; // próximo tick re-roda editor; se ainda REVISE, retry ou give up
          }
        } catch (e) {
          audit({ event: "critic_fix_failed", run_id: runId, error: e.message.slice(0, 200) });
          console.warn(`  ⚠ critic-fix-loop failed: ${e.message.slice(0, 100)}`);
        }
      }
      // Max retries OU no render script known → send back to draft
      transition(runId, "editing", "draft", { failure_reason: `REVISE max retries: ${decision.reasons.join("; ")}` });
    } else if (decision.decision === "REJECT") {
      transition(runId, "editing", "failed", { failure_reason: `REJECT: ${decision.reasons.join("; ")}` });
    } else if (decision.decision === "ESCALATE") {
      transition(runId, "editing", "blocked", { failure_reason: `ESCALATE: ${decision.reasons.join("; ")}` });
      // Telegram notify
      try {
        execSync(`node ${path.join(__dirname, "agents", "telegram-notify.mjs")} --alert "ESCALATE run ${runId}: ${decision.reasons[0]}" critical`, { cwd: ROOT });
      } catch (e) { /* telegram not configured yet */ }
    }
  } catch (e) {
    transition(runId, "editing", "failed", { failure_reason: `editor-agent crashed: ${e.message.slice(0, 200)}` });
  }
}

async function handleApproving(runId) {
  // Invoke approver agent
  try {
    execSync(`node ${path.join(__dirname, "agents", "approver.mjs")} --run ${runId}`, { cwd: ROOT, encoding: "utf-8" });
    transition(runId, "approving", "publishing");
  } catch (e) {
    transition(runId, "approving", "blocked", { failure_reason: `approver: ${e.message.slice(0, 200)}` });
  }
}

async function handlePublishing(runId) {
  // CHECK SCHEDULED time first (NUNCA publica fora do slot OR sem trigger humano)
  // Per CLAUDE.md: "Auto-publish via cron NUNCA sem trigger explícito do Matheus"
  // → orchestrator NUNCA invoca publish.ts automaticamente.
  // → marca como "blocked" + telegram waiting for human trigger
  transition(runId, "publishing", "blocked", { failure_reason: "awaiting human publish trigger (CLAUDE.md regra)" });
  try {
    execSync(`node ${path.join(__dirname, "agents", "telegram-notify.mjs")} --alert "Run ${runId} pronto pra publish. Aguardando seu trigger." info`, { cwd: ROOT });
  } catch (e) { /* telegram not configured */ }
}

// ─── Main tick loop ──────────────────────────────────────────────────────────
async function tick() {
  checkCircuit();
  syncQueueToDb();
  syncRunsDirToDb();

  const active = db.prepare(`SELECT * FROM runs WHERE state IN ('draft', 'rendering', 'editing', 'approving', 'publishing') ORDER BY scheduled_for ASC NULLS LAST LIMIT 10`).all();

  audit({ event: "tick_start", active_count: active.length });

  for (const run of active) {
    try {
      switch (run.state) {
        case "draft": await handleDraft(run.run_id); break;
        case "rendering": /* no-op — manual today */; break;
        case "editing": await handleEditing(run.run_id); break;
        case "approving": await handleApproving(run.run_id); break;
        case "publishing": await handlePublishing(run.run_id); break;
      }
    } catch (e) {
      audit({ event: "handler_error", run_id: run.run_id, state: run.state, error: e.message });
      console.error(`✗ ${run.run_id} (${run.state}): ${e.message}`);
    }
  }

  audit({ event: "tick_end", processed: active.length });
}

function statusReport() {
  syncQueueToDb();
  syncRunsDirToDb();
  const counts = db.prepare(`SELECT state, COUNT(*) as n FROM runs GROUP BY state ORDER BY n DESC`).all();
  console.log("\n📊 Pipeline state\n");
  for (const c of counts) console.log(`  ${c.state.padEnd(12)} ${c.n}`);
  console.log("");
  const upcoming = db.prepare(`SELECT * FROM runs WHERE scheduled_for IS NOT NULL AND state NOT IN ('published', 'failed') ORDER BY scheduled_for ASC LIMIT 10`).all();
  console.log("Próximos 10 runs agendados:");
  for (const r of upcoming) {
    console.log(`  ${r.scheduled_for ?? "(no slot)"}  ${r.state.padEnd(12)} ${r.run_id}`);
  }
}

function resetRun(runId) {
  db.prepare(`UPDATE runs SET state = 'draft', failure_reason = NULL, retry_count = retry_count + 1, updated_at = ? WHERE run_id = ?`).run(new Date().toISOString(), runId);
  audit({ event: "manual_reset", run_id: runId });
  console.log(`✓ ${runId} reset to draft`);
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
const cmd = process.argv[2];
const argIdx = process.argv.indexOf("--run");
const runArg = argIdx >= 0 ? process.argv[argIdx + 1] : null;

if (cmd === "tick") {
  await tick();
} else if (cmd === "status") {
  statusReport();
} else if (cmd === "reset" && runArg) {
  resetRun(runArg);
} else if (cmd === "run" && runArg) {
  syncQueueToDb();
  syncRunsDirToDb();
  const run = db.prepare(`SELECT * FROM runs WHERE run_id = ?`).get(runArg);
  if (!run) { console.error(`run ${runArg} not found`); process.exit(1); }
  console.log(`\nProcessing ${runArg} in state ${run.state}...\n`);
  switch (run.state) {
    case "draft": await handleDraft(runArg); break;
    case "editing": await handleEditing(runArg); break;
    case "approving": await handleApproving(runArg); break;
    case "publishing": await handlePublishing(runArg); break;
    default: console.log(`State ${run.state} is terminal or no handler`);
  }
  statusReport();
} else {
  console.error(`Usage:
  pipeline.mjs tick              process all active runs
  pipeline.mjs run --run <id>    process single run
  pipeline.mjs status            show queue
  pipeline.mjs reset --run <id>  reset failed run to draft`);
  process.exit(1);
}
