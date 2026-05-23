// scripts/agents/dashboard-helpers.mjs — helpers for /api/drafts + /api/health.
//
// Read-only utilities. No state mutation. Safe to call from dashboard handlers.

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { scanAvoidSlop } from "./avoid-slop-scan.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");
const RUNS_DIR = path.join(ROOT, "runs");
const AUDIT_LOG = path.join(ROOT, "runs", "_audit-log.jsonl");
const CIRCUIT = path.join(ROOT, "runs", "_circuit-state.json");

// Caption extraction matches both "## Caption" (newer drafts) and "### Caption" (older).
const CAPTION_RE = /#{2,3} Caption[^\n]*\n([\s\S]*?)(?=\n#{1,3} |$)/;
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

export function readDraftCaption(runId) {
  const dpPath = path.join(RUNS_DIR, runId, "draft-package.md");
  if (!fs.existsSync(dpPath)) return null;
  const dp = fs.readFileSync(dpPath, "utf-8");
  const m = dp.match(CAPTION_RE);
  return m ? m[1].trim() : null;
}

// Extracts YAML frontmatter (key: value lines) from a markdown file. Naive — no nested objects.
function readFrontmatter(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const text = fs.readFileSync(filePath, "utf-8");
  const m = text.match(FRONTMATTER_RE);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-z_][a-z0-9_]*)\s*:\s*(.+?)\s*$/i);
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

// One draft summary with flags. Returns { run_id, caption_preview, caption_chars, flags }.
// flags include em-dash count, avoid-slop verdict, persona, pillar, format.
export function summarizeDraft(runId) {
  const runDir = path.join(RUNS_DIR, runId);
  if (!fs.existsSync(runDir)) return null;
  const caption = readDraftCaption(runId);
  const fmDraft = readFrontmatter(path.join(runDir, "draft-package.md"));
  const fmContent = readFrontmatter(path.join(runDir, "content-object.md"));
  const fm = { ...fmContent, ...fmDraft };

  let slopVerdict = null;
  let emDashCount = 0;
  if (caption) {
    const result = scanAvoidSlop(caption);
    slopVerdict = {
      action: result.action,
      grave: result.grave_count,
      medio: result.medio_count,
      leve: result.leve_count,
      deduction: result.score_deduction,
    };
    const emViol = result.violations.find(v => v.type === "em-dash-overuse");
    emDashCount = emViol?.count || 0;
    // Fallback raw count if no violation but caption has any.
    if (emDashCount === 0) {
      emDashCount = (caption.match(/—/g) || []).length
                  + (caption.match(/–/g) || []).length
                  + (caption.match(/(^|\s)-(\s)/g) || []).length;
    }
  }

  // Hook = first sentence/line of caption (capped at 100 chars).
  let hook = null;
  if (caption) {
    const firstLine = caption.split(/\n/).find(l => l.trim().length > 0) || "";
    hook = firstLine.length > 100 ? firstLine.slice(0, 100) + "…" : firstLine;
  }

  // Visual assets: slide-*.{png,jpg,webp} for carousels, *.mp4 for reels.
  const assetsDir = path.join(runDir, "assets");
  let slides = [];
  let videos = [];
  if (fs.existsSync(assetsDir)) {
    const all = fs.readdirSync(assetsDir);
    slides = all.filter(f => /^slide-\d+.*\.(png|jpg|jpeg|webp)$/i.test(f)).sort();
    videos = all.filter(f => /\.(mp4|mov|webm)$/i.test(f)).sort();
  }

  // Editor score: look for runs/<id>/editor-decision.json or last audit entry.
  let editorScore = null;
  let editorDecision = null;
  const editorJson = path.join(runDir, "editor-decision.json");
  if (fs.existsSync(editorJson)) {
    try {
      const j = JSON.parse(fs.readFileSync(editorJson, "utf-8"));
      editorScore = j.rubric?.total ?? null;
      editorDecision = j.decision ?? null;
    } catch {}
  }

  return {
    run_id: runId,
    caption: caption || null,
    caption_preview: caption ? caption.slice(0, 280) : null,
    caption_chars: caption ? caption.length : 0,
    has_caption: !!caption,
    hook,
    slides,  // filenames; served from /runs/<id>/assets/<file>
    videos,  // mp4/mov filenames for reels
    flags: {
      em_dash_count: emDashCount,
      slop: slopVerdict,
      persona: fm.target_persona || fm.persona || null,
      pillar: fm.pillar ? Number(fm.pillar) : null,
      format: fm.format || null,
      route: fm.route || null,
      state: fm.state || null,
      scheduled_for: fm.scheduled_for || null,
      editor_score: editorScore,
      editor_decision: editorDecision,
    },
  };
}

// Lists all drafts in runs/ (filtered by state if provided via pipeline DB).
// statesAllowed: optional Set of state strings to include (from runs table).
export function listDrafts({ pipelineDb, statesAllowed = null, limit = 100 } = {}) {
  const all = [];
  for (const dir of fs.readdirSync(RUNS_DIR).sort().reverse()) {
    if (dir.startsWith("_") || dir.startsWith(".")) continue;
    const dpPath = path.join(RUNS_DIR, dir, "draft-package.md");
    if (!fs.existsSync(dpPath)) continue;
    all.push(dir);
    if (all.length >= limit * 2) break;  // soft cap for perf
  }

  // Cross-reference with pipeline DB state if available.
  let stateByRunId = {};
  if (pipelineDb) {
    try {
      const rows = pipelineDb.prepare(`SELECT run_id, state, scheduled_for FROM runs`).all();
      for (const r of rows) stateByRunId[r.run_id] = { state: r.state, scheduled_for: r.scheduled_for };
    } catch {}
  }

  const summaries = [];
  for (const runId of all) {
    const s = summarizeDraft(runId);
    if (!s) continue;
    const dbState = stateByRunId[runId];
    if (dbState) {
      s.flags.state = dbState.state;
      s.flags.scheduled_for = dbState.scheduled_for || s.flags.scheduled_for;
    }
    if (statesAllowed && !statesAllowed.has(s.flags.state)) continue;
    summaries.push(s);
    if (summaries.length >= limit) break;
  }
  return summaries;
}

// Returns array of { timer, next, last, unit } from `systemctl list-timers`.
// On macOS (no systemd), returns empty array — caller treats as "not on VPS".
export function getTimerHealth() {
  try {
    const out = execSync("systemctl list-timers --no-pager --no-legend 2>/dev/null | grep longevify", {
      encoding: "utf-8", timeout: 5000,
    });
    return out.trim().split("\n").filter(Boolean).map(line => {
      // format: "Sat 2026-05-23 13:25:00 UTC  4min 32s  Sat 2026-05-23 13:20:02 UTC  25s ago  longevify-X.timer  longevify-X.service"
      const cols = line.split(/\s{2,}/);
      return { next: cols[0], next_in: cols[1], last: cols[2], last_ago: cols[3], timer: cols[4], unit: cols[5] };
    });
  } catch {
    return [];
  }
}

// Scans last N hours of audit log for error events. Returns up to `limit` most recent.
export function getRecentErrors(hoursBack = 24, limit = 20) {
  if (!fs.existsSync(AUDIT_LOG)) return [];
  const cutoff = Date.now() - hoursBack * 3600 * 1000;
  const errors = [];
  const lines = fs.readFileSync(AUDIT_LOG, "utf-8").split("\n");
  // Walk from newest to oldest.
  for (let i = lines.length - 1; i >= 0 && errors.length < limit; i--) {
    if (!lines[i]) continue;
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    if (!e.ts || new Date(e.ts).getTime() < cutoff) break;
    if (/error|failed|fail$|reject/i.test(e.event || "")) {
      errors.push({ ts: e.ts, agent: e.agent, event: e.event, error: e.error?.slice?.(0, 200), run_id: e.run_id });
    }
  }
  return errors;
}

// Cost breakdown by agent today. Returns { totals: { agent: usd }, total_usd }.
export function getCostBreakdown() {
  const today = new Date().toISOString().slice(0, 10);
  const totals = {};
  if (!fs.existsSync(AUDIT_LOG)) return { totals: {}, total_usd: 0 };
  for (const line of fs.readFileSync(AUDIT_LOG, "utf-8").split("\n")) {
    if (!line) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.ts?.slice(0, 10) !== today) continue;
    const cost = (e.decision?.cost_usd ?? 0) + (e.total_cost_usd ?? 0) + (e.cost_usd ?? 0);
    if (cost > 0) {
      const k = e.agent || "unknown";
      totals[k] = (totals[k] || 0) + cost;
    }
  }
  const total_usd = Object.values(totals).reduce((a, b) => a + b, 0);
  return { totals, total_usd };
}

export function getCircuitState() {
  if (!fs.existsSync(CIRCUIT)) return { state: "CLOSED" };
  try { return JSON.parse(fs.readFileSync(CIRCUIT, "utf-8")); }
  catch { return { state: "CLOSED", parse_error: true }; }
}
