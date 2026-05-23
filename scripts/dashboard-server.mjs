// scripts/dashboard-server.mjs — HTTP server local pra dashboard HTML
//
// Roda local no Mac: `node scripts/dashboard-server.mjs`
// Serve em http://localhost:4242
// Endpoints:
//   GET  /            — serve ~/longevify-content-dashboard.html
//   GET  /api/state   — read-only: queue + pipeline state + insights + flags
//   GET  /api/brief   — gera daily brief on-demand
//   GET  /api/insights — ranking IG
//   POST /api/draft   — content-generator pra novo idea
//   POST /api/edit    — re-run editor em draft existente
//   POST /api/publish — fires publish.ts (requer confirm: true)
//   POST /api/discard — safe-rm.mjs
//   POST /api/idea    — append em foundation/stores/ideas.md
//
// CORS habilitado pra http://localhost:* (dashboard pode estar em file:// também)

import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { timingSafeEqual } from "node:crypto";
import Database from "better-sqlite3";
import {
  listDrafts, summarizeDraft, getTimerHealth, getRecentErrors,
  getCostBreakdown, getCircuitState,
} from "./agents/dashboard-helpers.mjs";

// .env loader (so DASHBOARD_USERS works when launched directly, not just via systemd)
const ENV_PATH_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
if (fs.existsSync(ENV_PATH_ROOT)) {
  for (const line of fs.readFileSync(ENV_PATH_ROOT, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PORT = 4242;

const PIPELINE_DB = path.join(ROOT, "runs", "_pipeline.db");
const INSIGHTS_DB = path.join(ROOT, "runs", "_insights.db");
const QUEUE = path.join(ROOT, "runs", "_queue.json");
const CIRCUIT = path.join(ROOT, "runs", "_circuit-state.json");
const BRIEFS_DIR = path.join(ROOT, "runs", "_briefs");
const STORES_DIR = path.join(ROOT, "foundation", "stores");
const AUDIT_LOG = path.join(ROOT, "runs", "_audit-log.jsonl");
// Dashboard HTML lives in the repo (versioned). Fallback to legacy ~/ location for single-user dev.
const DASHBOARD_HTML_REPO = path.join(ROOT, "dashboard", "index.html");
const DASHBOARD_HTML_LEGACY = path.join(process.env.HOME || "/root", "longevify-content-dashboard.html");
const DASHBOARD_HTML = fs.existsSync(DASHBOARD_HTML_REPO) ? DASHBOARD_HTML_REPO : DASHBOARD_HTML_LEGACY;

function auditEvent(entry) {
  try {
    fs.mkdirSync(path.dirname(AUDIT_LOG), { recursive: true });
    fs.appendFileSync(AUDIT_LOG, JSON.stringify({ ts: new Date().toISOString(), agent: "dashboard", ...entry }) + "\n");
  } catch {}
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// HTTP Basic Auth via DASHBOARD_USERS=user1:pass1,user2:pass2 in .env.
// If unset → open access (dev mode). On VPS the env file must set it.
// On localhost when LOCAL_BYPASS=1, also allowed without auth (founder local dev).
const USERS = (() => {
  const raw = process.env.DASHBOARD_USERS;
  if (!raw) return null;
  const map = {};
  for (const pair of raw.split(",")) {
    const [u, p] = pair.split(":");
    if (u && p) map[u.trim()] = p.trim();
  }
  return Object.keys(map).length ? map : null;
})();
const LOCAL_BYPASS = process.env.DASHBOARD_LOCAL_BYPASS === "1";

function safeEq(a, b) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function isAuthorized(req) {
  if (!USERS) return true;  // no auth configured
  if (LOCAL_BYPASS) {
    const ra = req.socket.remoteAddress || "";
    if (ra === "127.0.0.1" || ra === "::1" || ra === "::ffff:127.0.0.1") return true;
  }
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) return false;
  let decoded;
  try { decoded = Buffer.from(header.slice(6), "base64").toString("utf-8"); } catch { return false; }
  const idx = decoded.indexOf(":");
  if (idx < 0) return false;
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);
  const expected = USERS[user];
  if (!expected) return false;
  return safeEq(pass, expected);
}

function sendUnauthorized(res) {
  res.setHeader("WWW-Authenticate", 'Basic realm="Longevify Dashboard", charset="UTF-8"');
  res.writeHead(401, { "Content-Type": "text/plain" });
  res.end("Unauthorized");
}

function json(res, data, status = 200) {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", c => data += c);
    req.on("end", () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve({}); }
    });
  });
}

// ─── Handlers ────────────────────────────────────────────────────────────────

function getState() {
  const state = { now: new Date().toISOString() };

  // Pipeline state counts
  if (fs.existsSync(PIPELINE_DB)) {
    const db = new Database(PIPELINE_DB, { readonly: true });
    state.pipeline_counts = db.prepare(`SELECT state, COUNT(*) as n FROM runs GROUP BY state`).all();
    state.upcoming = db.prepare(`SELECT * FROM runs WHERE scheduled_for IS NOT NULL AND state NOT IN ('published', 'failed') ORDER BY scheduled_for ASC LIMIT 5`).all();
    state.pending_approval = db.prepare(`SELECT * FROM runs WHERE state = 'approving' ORDER BY scheduled_for ASC LIMIT 10`).all();
    db.close();
  }

  // Insights ranking
  if (fs.existsSync(INSIGHTS_DB)) {
    const db = new Database(INSIGHTS_DB, { readonly: true });
    const rows = db.prepare(`
      SELECT run_id, MAX(scraped_at) as latest, reach, saves, shares, save_rate, share_rate, pillar, persona
      FROM insights GROUP BY run_id ORDER BY save_rate DESC NULLS LAST LIMIT 10
    `).all();
    db.close();
    state.insights = rows;
  }

  // Circuit state
  if (fs.existsSync(CIRCUIT)) {
    state.circuit = JSON.parse(fs.readFileSync(CIRCUIT, "utf-8"));
  }

  // Critical flags (last 7 days)
  state.flags = [];
  if (fs.existsSync(BRIEFS_DIR)) {
    for (const f of fs.readdirSync(BRIEFS_DIR).sort().reverse()) {
      if (f.startsWith("CRITICAL-DRIFT-FLAGS-")) {
        state.flags.push({ name: f, path: path.join(BRIEFS_DIR, f), preview: fs.readFileSync(path.join(BRIEFS_DIR, f), "utf-8").slice(0, 500) });
        if (state.flags.length >= 3) break;
      }
    }
  }

  // Ideas top 5 (from latest queue items + foundation/stores/ideas.md)
  if (fs.existsSync(QUEUE)) {
    const q = JSON.parse(fs.readFileSync(QUEUE, "utf-8"));
    state.ideas_top = (q.items || []).filter(i => i.status === "idea" || i.status === "draft").slice(0, 5);
  }

  // Cost today
  state.cost_today_usd = 0;
  const auditPath = path.join(ROOT, "runs", "_audit-log.jsonl");
  if (fs.existsSync(auditPath)) {
    const today = new Date().toISOString().slice(0, 10);
    for (const line of fs.readFileSync(auditPath, "utf-8").split("\n")) {
      if (!line) continue;
      try {
        const e = JSON.parse(line);
        if (e.ts?.slice(0, 10) === today) {
          if (e.decision?.cost_usd) state.cost_today_usd += e.decision.cost_usd;
          if (e.total_cost_usd) state.cost_today_usd += e.total_cost_usd;
        }
      } catch {}
    }
  }

  return state;
}

async function postDraft(body) {
  // body: { runId, persona, pillar, brief }
  // Cria run dir + idea.md + invoca content-generator
  const { runId, persona, pillar, brief } = body;
  if (!runId || !brief) throw new Error("runId + brief required");
  const runDir = path.join(ROOT, "runs", runId);
  fs.mkdirSync(path.join(runDir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "idea.md"), `---
content_object: ${runId}
route: dashboard-manual
pillar: ${pillar || 2}
format: carousel
target_persona: ${persona || "maria"}
type: persona-bio
created_at: ${new Date().toISOString().slice(0,10)}
---

# ${runId}

**Headline hint:** ${(brief || "").split("\n")[0]}

**Brief:**
${brief}
`);
  try {
    execSync(`node ${path.join(__dirname, "agents", "content-generator.mjs")} --run ${runId}`, { cwd: ROOT, encoding: "utf-8", timeout: 120000 });
    return { ok: true, run_id: runId, message: "Content-generator + draft + persona JSON criados" };
  } catch (e) {
    return { ok: false, error: e.message.slice(0, 500) };
  }
}

async function postEdit(body) {
  const { runId } = body;
  if (!runId) throw new Error("runId required");
  try {
    const out = execSync(`node ${path.join(__dirname, "agents", "editor-agent.mjs")} --run ${runId} --json`, { cwd: ROOT, encoding: "utf-8", timeout: 90000 });
    return { ok: true, decision: JSON.parse(out) };
  } catch (e) {
    return { ok: false, error: e.message.slice(0, 500) };
  }
}

async function postPublish(body) {
  const { runId, confirm } = body;
  if (!runId) throw new Error("runId required");
  if (!confirm) return { ok: false, error: "confirm: true required (safety)" };
  try {
    const out = execSync(`cd ${ROOT} && npm run publish -- --run ${runId} 2>&1`, { encoding: "utf-8", timeout: 300000 });
    const mediaId = (out.match(/media_id:\s*(\S+)/) ?? [, null])[1];
    return { ok: true, media_id: mediaId, output: out.slice(-1000) };
  } catch (e) {
    return { ok: false, error: e.message.slice(0, 1000) };
  }
}

async function postDiscard(body) {
  const { runId } = body;
  if (!runId) throw new Error("runId required");
  const target = path.join(ROOT, "runs", runId);
  try {
    execSync(`DESTRUCTIVE_CONFIRMED=1 node ${path.join(__dirname, "agents", "safe-rm.mjs")} --path "${target}" --agent dashboard --reason "user discard"`, { cwd: ROOT, encoding: "utf-8" });
    return { ok: true, archived: true };
  } catch (e) {
    return { ok: false, error: e.message.slice(0, 500) };
  }
}

// ─── F1 handlers: drafts + health + approve/reject/regenerate ────────────────

function getDrafts(query) {
  const filterState = query.state;  // optional: ?state=draft,approving
  let pipelineDb = null;
  if (fs.existsSync(PIPELINE_DB)) pipelineDb = new Database(PIPELINE_DB, { readonly: true });
  try {
    const statesAllowed = filterState ? new Set(filterState.split(",")) : null;
    const drafts = listDrafts({ pipelineDb, statesAllowed, limit: 50 });
    return { drafts, count: drafts.length };
  } finally {
    if (pipelineDb) pipelineDb.close();
  }
}

function getHealth() {
  const timers = getTimerHealth();
  const errors = getRecentErrors(24, 15);
  const cost = getCostBreakdown();
  const circuit = getCircuitState();
  return {
    timers,
    on_vps: timers.length > 0,
    recent_errors_24h: errors,
    cost_today_by_agent: cost.totals,
    cost_today_total: cost.total_usd,
    cost_budget_usd: 40,
    circuit,
  };
}

async function postApprove(body) {
  // Approve = transition run to 'approving'. Pipeline tick will pick it up async.
  const { runId, reviewer } = body;
  if (!runId) throw new Error("runId required");
  if (!fs.existsSync(PIPELINE_DB)) return { ok: false, error: "pipeline.db missing" };
  const db = new Database(PIPELINE_DB);
  try {
    const row = db.prepare(`SELECT state FROM runs WHERE run_id = ?`).get(runId);
    if (!row) return { ok: false, error: `run ${runId} not in pipeline DB` };
    db.prepare(`UPDATE runs SET state = 'approving', updated_at = ? WHERE run_id = ?`)
      .run(new Date().toISOString(), runId);
    auditEvent({ event: "dashboard_approve", run_id: runId, prev_state: row.state, reviewer: reviewer || "unknown" });
    return { ok: true, run_id: runId, prev_state: row.state, new_state: "approving" };
  } finally {
    db.close();
  }
}

async function postReject(body) {
  const { runId, reason, regenerate, reviewer } = body;
  if (!runId) throw new Error("runId required");
  if (!fs.existsSync(PIPELINE_DB)) return { ok: false, error: "pipeline.db missing" };
  const db = new Database(PIPELINE_DB);
  try {
    const row = db.prepare(`SELECT state FROM runs WHERE run_id = ?`).get(runId);
    if (!row) return { ok: false, error: `run ${runId} not in pipeline DB` };
    db.prepare(`UPDATE runs SET state = 'blocked', failure_reason = ?, updated_at = ? WHERE run_id = ?`)
      .run((reason || "rejected via dashboard").slice(0, 500), new Date().toISOString(), runId);
    auditEvent({ event: "dashboard_reject", run_id: runId, prev_state: row.state, reason: reason || null, reviewer: reviewer || "unknown" });
  } finally {
    db.close();
  }
  if (regenerate) {
    const r = await postRegenerate({ runId, reviewer });
    return { ok: true, rejected: true, regenerated: r };
  }
  return { ok: true, rejected: true };
}

async function postRegenerate(body) {
  const { runId, reviewer } = body;
  if (!runId) throw new Error("runId required");
  const runDir = path.join(ROOT, "runs", runId);
  if (!fs.existsSync(runDir)) return { ok: false, error: `run ${runId} dir missing` };
  auditEvent({ event: "dashboard_regenerate_start", run_id: runId, reviewer: reviewer || "unknown" });
  try {
    const out = execSync(`node ${path.join(__dirname, "agents", "content-generator.mjs")} --run ${runId} 2>&1`, {
      cwd: ROOT, encoding: "utf-8", timeout: 180000,
    });
    auditEvent({ event: "dashboard_regenerate_ok", run_id: runId });
    return { ok: true, run_id: runId, output_tail: out.slice(-800) };
  } catch (e) {
    auditEvent({ event: "dashboard_regenerate_failed", run_id: runId, error: e.message?.slice(0, 200) });
    return { ok: false, error: e.message.slice(0, 800) };
  }
}

async function postIdea(body) {
  // Append em foundation/stores/ideas.md
  const { text, persona, pillar } = body;
  if (!text) throw new Error("text required");
  fs.mkdirSync(STORES_DIR, { recursive: true });
  const file = path.join(STORES_DIR, "ideas.md");
  if (!fs.existsSync(file)) fs.writeFileSync(file, "# Ideas log\n\n");
  fs.appendFileSync(file, `\n## ${new Date().toISOString().slice(0, 16)}\n- persona: ${persona || "any"}\n- pillar: ${pillar || "?"}\n${text}\n`);
  return { ok: true };
}

// ─── HTTP server ─────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { cors(res); res.writeHead(204); res.end(); return; }
  if (!isAuthorized(req)) return sendUnauthorized(res);
  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    // GET routes
    if (req.method === "GET") {
      if (url.pathname === "/" || url.pathname === "/dashboard") {
        if (fs.existsSync(DASHBOARD_HTML)) {
          cors(res);
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(fs.readFileSync(DASHBOARD_HTML));
        } else {
          json(res, { error: `Dashboard HTML não existe em ${DASHBOARD_HTML}` }, 404);
        }
        return;
      }
      // Static assets: /runs/<runId>/assets/<file>
      const assetMatch = url.pathname.match(/^\/runs\/([^\/]+)\/assets\/([^\/]+)$/);
      if (assetMatch) {
        const [, runId, file] = assetMatch;
        // Reject any path traversal attempt.
        if (runId.includes("..") || file.includes("..")) { json(res, { error: "bad path" }, 400); return; }
        const assetPath = path.join(ROOT, "runs", runId, "assets", file);
        if (!fs.existsSync(assetPath)) { json(res, { error: "not found" }, 404); return; }
        const ext = path.extname(file).toLowerCase();
        const mime = {
          ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
          ".webp": "image/webp", ".mp4": "video/mp4", ".webm": "video/webm",
          ".mov": "video/quicktime",
        }[ext] || "application/octet-stream";
        cors(res);
        res.writeHead(200, { "Content-Type": mime, "Cache-Control": "private, max-age=300" });
        fs.createReadStream(assetPath).pipe(res);
        return;
      }
      if (url.pathname === "/api/state") return json(res, getState());
      if (url.pathname === "/api/drafts") {
        const q = Object.fromEntries(url.searchParams.entries());
        return json(res, getDrafts(q));
      }
      if (url.pathname === "/api/health") return json(res, getHealth());
      if (url.pathname === "/api/insights") {
        const out = execSync(`node ${path.join(__dirname, "agents", "ig-insights-scraper.mjs")} --ranking`, { encoding: "utf-8", timeout: 30000 });
        return json(res, { output: out });
      }
      if (url.pathname === "/api/brief") {
        const out = execSync(`node ${path.join(__dirname, "agents", "daily-brief.mjs")}`, { encoding: "utf-8", timeout: 120000 });
        const today = new Date().toISOString().slice(0, 10);
        const briefPath = path.join(BRIEFS_DIR, `morning-${today}.md`);
        const brief = fs.existsSync(briefPath) ? fs.readFileSync(briefPath, "utf-8") : "(brief file não encontrado)";
        return json(res, { ok: true, brief, output: out.slice(-500) });
      }
      json(res, { error: "not found" }, 404);
      return;
    }

    // POST routes
    if (req.method === "POST") {
      const body = await readBody(req);
      if (url.pathname === "/api/draft")      return json(res, await postDraft(body));
      if (url.pathname === "/api/edit")       return json(res, await postEdit(body));
      if (url.pathname === "/api/publish")    return json(res, await postPublish(body));
      if (url.pathname === "/api/discard")    return json(res, await postDiscard(body));
      if (url.pathname === "/api/idea")       return json(res, await postIdea(body));
      if (url.pathname === "/api/approve")    return json(res, await postApprove(body));
      if (url.pathname === "/api/reject")     return json(res, await postReject(body));
      if (url.pathname === "/api/regenerate") return json(res, await postRegenerate(body));
      json(res, { error: "not found" }, 404);
      return;
    }
  } catch (e) {
    json(res, { error: e.message.slice(0, 500) }, 500);
  }
});

// Bind: on VPS we listen 127.0.0.1 only (cloudflared proxies); on dev 0.0.0.0.
const BIND = process.env.DASHBOARD_BIND || "127.0.0.1";
server.listen(PORT, BIND, () => {
  console.log(`\n📊 Dashboard server rodando em http://${BIND}:${PORT}\n`);
  console.log(`  Auth: ${USERS ? Object.keys(USERS).length + " users via DASHBOARD_USERS" : "OPEN (no DASHBOARD_USERS set)"}`);
  console.log(`  HTML: ${DASHBOARD_HTML}`);
  console.log(`  Endpoints:`);
  console.log(`    GET  /api/state    GET  /api/drafts   GET  /api/health`);
  console.log(`    GET  /api/brief    GET  /api/insights`);
  console.log(`    POST /api/draft    POST /api/edit     POST /api/publish`);
  console.log(`    POST /api/discard  POST /api/idea`);
  console.log(`    POST /api/approve  POST /api/reject   POST /api/regenerate\n`);
});
