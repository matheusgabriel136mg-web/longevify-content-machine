/**
 * ops-dashboard.ts — Operational dashboard (custo, notificações, cron runs)
 *
 * Lê:
 *   - logs/cost-ledger.jsonl
 *   - logs/notifications.log
 *   - runs/ (state, runtime info)
 *
 * Serve em :8089 (pra não colidir com reviewer-dashboard :8088).
 */

import * as fs from "fs";
import * as path from "path";
import { createServer } from "http";
import { fileURLToPath } from "url";
import { readLedger, totalForDay, totalForMonth } from "./lib/cost-guard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

interface OpsSnapshot {
  generated_at: string;
  cost: {
    today_usd: number;
    month_usd: number;
    by_provider: Record<string, number>;
    last_10_calls: Array<{ ts: string; provider: string; usd: number; run?: string; phase?: string }>;
  };
  runs: { state_counts: Record<string, number>; total: number };
  notifications: Array<{ ts: string; level: string; title: string; message: string }>;
}

function buildSnapshot(): OpsSnapshot {
  const ledger = readLedger();

  // By provider
  const byProvider: Record<string, number> = {};
  for (const r of ledger) byProvider[r.provider] = (byProvider[r.provider] ?? 0) + r.usd;

  // State counts
  const runsDir = path.join(ROOT, "runs");
  const stateCounts: Record<string, number> = {};
  let totalRuns = 0;
  if (fs.existsSync(runsDir)) {
    for (const d of fs.readdirSync(runsDir)) {
      if (d.startsWith("_") || d.startsWith(".")) continue;
      const coPath = path.join(runsDir, d, "content-object.md");
      if (!fs.existsSync(coPath)) continue;
      totalRuns++;
      const m = fs.readFileSync(coPath, "utf-8").match(/^state:\s*(\w+)/m);
      const s = m?.[1] ?? "idea";
      stateCounts[s] = (stateCounts[s] ?? 0) + 1;
    }
  }

  // Notifications log
  const notifPath = path.join(ROOT, "logs", "notifications.log");
  const notifications: OpsSnapshot["notifications"] = [];
  if (fs.existsSync(notifPath)) {
    const lines = fs.readFileSync(notifPath, "utf-8").split("\n").filter(Boolean).slice(-30).reverse();
    for (const l of lines) {
      const parts = l.split("\t");
      notifications.push({ ts: parts[0], level: parts[1], title: parts[2], message: parts[3] ?? "" });
    }
  }

  return {
    generated_at: new Date().toISOString(),
    cost: {
      today_usd: totalForDay(),
      month_usd: totalForMonth(),
      by_provider: byProvider,
      last_10_calls: ledger.slice(-10).reverse(),
    },
    runs: { state_counts: stateCounts, total: totalRuns },
    notifications,
  };
}

const DASHBOARD_HTML = `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8" /><title>Longevify · Ops</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0a1410; color: #f8fffc; margin: 0; padding: 24px; }
  h1 { color: #C89136; font-weight: 300; margin: 0 0 8px; }
  h2 { color: #91B69D; font-weight: 400; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; margin: 24px 0 8px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
  .card { border: 1px solid #1a2a23; border-radius: 8px; padding: 16px; background: #0f1c17; }
  .kpi { font-size: 28px; font-weight: 300; color: #C89136; }
  .kpi-label { font-size: 11px; color: #91B69D; text-transform: uppercase; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #1a2a23; }
  th { color: #91B69D; font-weight: 400; font-size: 11px; text-transform: uppercase; }
  .level-error { color: #f56262; }
  .level-warn { color: #f5a623; }
  .level-success { color: #4ade80; }
  .meta { color: #91B69D; font-size: 11px; margin-top: 4px; }
</style></head>
<body>
  <h1>Ops Dashboard</h1>
  <div id="meta" class="meta"></div>
  <div id="root">Carregando…</div>
  <script>
    function fmt(n) { return '$' + n.toFixed(2); }
    async function load() {
      const r = await fetch("./ops-snapshot.json", { cache: "no-store" });
      const d = await r.json();
      document.getElementById("meta").textContent = "Atualizado " + new Date(d.generated_at).toLocaleString("pt-BR");
      const html = \`
        <h2>Custo</h2>
        <div class="grid">
          <div class="card"><div class="kpi-label">Hoje</div><div class="kpi">\${fmt(d.cost.today_usd)}</div></div>
          <div class="card"><div class="kpi-label">Mês</div><div class="kpi">\${fmt(d.cost.month_usd)}</div></div>
          <div class="card">
            <div class="kpi-label">Por provider</div>
            <table>\${Object.entries(d.cost.by_provider).map(([p,v])=>'<tr><td>'+p+'</td><td>'+fmt(v)+'</td></tr>').join('')}</table>
          </div>
        </div>

        <h2>Runs por estado</h2>
        <div class="grid">
          \${Object.entries(d.runs.state_counts).map(([s,n])=>'<div class="card"><div class="kpi-label">'+s+'</div><div class="kpi">'+n+'</div></div>').join('')}
          <div class="card"><div class="kpi-label">Total</div><div class="kpi">\${d.runs.total}</div></div>
        </div>

        <h2>Últimas 10 chamadas</h2>
        <div class="card">
          <table>
            <tr><th>quando</th><th>provider</th><th>$</th><th>run</th><th>fase</th></tr>
            \${d.cost.last_10_calls.map(c=>'<tr><td>'+new Date(c.ts).toLocaleString('pt-BR')+'</td><td>'+c.provider+'</td><td>'+fmt(c.usd)+'</td><td>'+(c.run||'—')+'</td><td>'+(c.phase||'—')+'</td></tr>').join('')}
          </table>
        </div>

        <h2>Notificações recentes</h2>
        <div class="card">
          <table>
            <tr><th>quando</th><th>level</th><th>title</th><th>msg</th></tr>
            \${d.notifications.map(n=>'<tr class="level-'+n.level+'"><td>'+new Date(n.ts).toLocaleString('pt-BR')+'</td><td>'+n.level+'</td><td>'+n.title+'</td><td>'+n.message+'</td></tr>').join('')}
          </table>
        </div>
      \`;
      document.getElementById("root").innerHTML = html;
    }
    load();
    setInterval(load, 10000);
  </script>
</body></html>`;

function writeSnapshot(): string {
  const out = path.join(ROOT, "dashboard", "ops-snapshot.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(buildSnapshot(), null, 2));
  return out;
}

function writeHtml(): string {
  const out = path.join(ROOT, "dashboard", "ops.html");
  fs.writeFileSync(out, DASHBOARD_HTML);
  return out;
}

function serveLocal(port: number) {
  const distDir = path.join(ROOT, "dashboard");
  const server = createServer((req, res) => {
    let urlPath = (req.url || "/").split("?")[0];
    if (urlPath === "/" || urlPath === "/ops") urlPath = "/ops.html";
    const filePath = path.join(distDir, urlPath);
    if (!fs.existsSync(filePath)) { res.statusCode = 404; res.end("not found"); return; }
    const ext = path.extname(filePath).toLowerCase();
    const ctype = ext === ".html" ? "text/html" : ext === ".json" ? "application/json" : "text/plain";
    res.setHeader("Content-Type", ctype);
    fs.createReadStream(filePath).pipe(res);
  });
  server.listen(port);
  console.log(`📊 Ops dashboard: http://localhost:${port}`);
}

async function main() {
  const args = process.argv.slice(2);
  const serve = args.includes("--serve");
  const port = parseInt(args[args.indexOf("--port") + 1] ?? "8089", 10);

  writeSnapshot();
  writeHtml();
  console.log(`✓ snapshot ${path.relative(ROOT, path.join("dashboard", "ops-snapshot.json"))}`);

  if (serve) {
    serveLocal(port);
    setInterval(writeSnapshot, 10_000);
  }
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
