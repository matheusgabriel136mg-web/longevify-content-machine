/**
 * review-queue.ts — Gera dados pra reviewer-dashboard.html
 *
 * Varre runs/, identifica todos em state=draft|verified, agrega:
 *   - assets path
 *   - score do verifier (se existe)
 *   - delta writer vs verifier
 *   - custo do run
 *   - QA report
 *
 * Output: dashboard/review-queue.json (consumido por reviewer-dashboard.html)
 *
 * Uso:
 *   pnpm review-queue
 *   pnpm review-queue --serve   # serve dashboard local em :8088
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { totalForRun } from "./lib/cost-guard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

interface QueueItem {
  run_id: string;
  state: string;
  pillar: string;
  format: string;
  hook: string;
  writer_score?: string;
  verifier_score?: string;
  verifier_verdict?: string;
  delta?: string;
  qa_pass?: number;
  qa_escalate?: number;
  cost_usd: number;
  assets: string[];
  updated_at: string;
}

function parseFrontmatter(content: string): Record<string, string> {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const fm = line.match(/^([a-z_]+):\s*(.+)$/);
    if (fm) out[fm[1]] = fm[2].trim();
  }
  return out;
}

function extractFirstHeadline(draftContent: string): string {
  const m = draftContent.match(/### Headline\s*\n+\*?\*?([^\n*]+)/);
  return m ? m[1].trim() : "";
}

function buildQueue(): QueueItem[] {
  const runsDir = path.join(ROOT, "runs");
  if (!fs.existsSync(runsDir)) return [];
  const items: QueueItem[] = [];

  for (const dir of fs.readdirSync(runsDir)) {
    if (dir.startsWith("_") || dir.startsWith(".")) continue;
    const runDir = path.join(runsDir, dir);
    if (!fs.statSync(runDir).isDirectory()) continue;

    const coPath = path.join(runDir, "content-object.md");
    if (!fs.existsSync(coPath)) continue;
    const co = parseFrontmatter(fs.readFileSync(coPath, "utf-8"));
    const state = co.state ?? "idea";
    if (!["draft", "verified"].includes(state)) continue;

    const draftPath = path.join(runDir, "draft-package.md");
    let writerScore = "";
    let hook = "";
    if (fs.existsSync(draftPath)) {
      const draftContent = fs.readFileSync(draftPath, "utf-8");
      const dfm = parseFrontmatter(draftContent);
      writerScore = dfm.verifier_score ?? "";
      hook = extractFirstHeadline(draftContent);
    }

    const verifierPath = path.join(runDir, "verifier-report.md");
    let verifierScore = "";
    let verifierVerdict = "";
    let delta = "";
    if (fs.existsSync(verifierPath)) {
      const vfm = parseFrontmatter(fs.readFileSync(verifierPath, "utf-8"));
      verifierScore = vfm.verifier_score ?? "";
      verifierVerdict = vfm.verdict ?? "";
      delta = vfm.score_delta ?? "";
    }

    const qaPath = path.join(runDir, "visual-qa-report.md");
    let qaPass = 0;
    let qaEscalate = 0;
    if (fs.existsSync(qaPath)) {
      const qa = fs.readFileSync(qaPath, "utf-8");
      qaPass = (qa.match(/aprovados/g) || []).length;
      qaEscalate = (qa.match(/escalate/g) || []).length;
    }

    const assetsDir = path.join(runDir, "assets");
    const assets = fs.existsSync(assetsDir)
      ? fs.readdirSync(assetsDir).filter((f) => /\.(png|jpg|mp4)$/i.test(f))
      : [];

    items.push({
      run_id: dir,
      state,
      pillar: co.pillar ?? "?",
      format: co.format ?? "?",
      hook,
      writer_score: writerScore || undefined,
      verifier_score: verifierScore || undefined,
      verifier_verdict: verifierVerdict || undefined,
      delta: delta || undefined,
      qa_pass: qaPass || undefined,
      qa_escalate: qaEscalate || undefined,
      cost_usd: totalForRun(dir),
      assets,
      updated_at: co.updated_at ?? "",
    });
  }

  return items.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

function writeQueueJson(items: QueueItem[]): string {
  const outDir = path.join(ROOT, "dashboard");
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, "review-queue.json");
  fs.writeFileSync(out, JSON.stringify(items, null, 2));
  return out;
}

const DASHBOARD_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Longevify · Review Queue</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0a1410; color: #f8fffc; margin: 0; padding: 24px; }
    h1 { color: #C89136; font-weight: 300; margin: 0 0 24px; }
    .item { border: 1px solid #1a2a23; border-radius: 8px; padding: 16px; margin-bottom: 16px; background: #0f1c17; }
    .state { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; text-transform: uppercase; }
    .state.draft { background: #C89136; color: #000; }
    .state.verified { background: #2D7A5C; color: #fff; }
    .meta { color: #91B69D; font-size: 12px; margin-top: 4px; }
    .hook { font-size: 18px; font-weight: 300; margin: 8px 0; }
    .scores { display: flex; gap: 16px; font-size: 13px; color: #91B69D; }
    .scores b { color: #f8fffc; }
    .delta-warn { color: #f5a623; }
    .assets { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; margin-top: 12px; }
    .assets img { width: 100%; border-radius: 4px; border: 1px solid #1a2a23; }
    .cost { float: right; color: #C89136; font-weight: 500; }
    .empty { color: #91B69D; text-align: center; padding: 60px; }
  </style>
</head>
<body>
  <h1>Review Queue</h1>
  <div id="root">Carregando…</div>
  <script>
    async function load() {
      const r = await fetch("./review-queue.json", { cache: "no-store" });
      const items = await r.json();
      const root = document.getElementById("root");
      if (!items.length) { root.innerHTML = '<div class="empty">Fila vazia. ✨</div>'; return; }
      root.innerHTML = items.map(it => {
        const deltaWarn = it.delta && Math.abs(parseFloat(it.delta)) > 2;
        return \`
          <div class="item">
            <span class="cost">$\${it.cost_usd.toFixed(2)}</span>
            <span class="state \${it.state}">\${it.state}</span>
            <div class="hook">\${it.hook || it.run_id}</div>
            <div class="meta">\${it.run_id} · Pilar \${it.pillar} · \${it.format} · \${it.updated_at}</div>
            <div class="scores">
              \${it.writer_score ? '<span>Writer: <b>'+it.writer_score+'</b></span>' : ''}
              \${it.verifier_score ? '<span>Verifier: <b>'+it.verifier_score+'</b></span>' : ''}
              \${it.delta ? '<span class="'+(deltaWarn?'delta-warn':'')+'">Δ: <b>'+it.delta+'</b></span>' : ''}
              \${it.verifier_verdict ? '<span>Verdict: <b>'+it.verifier_verdict+'</b></span>' : ''}
              \${it.qa_pass!=null ? '<span>QA: <b>'+it.qa_pass+' pass / '+(it.qa_escalate||0)+' escalate</b></span>' : ''}
            </div>
            \${it.assets.length ? '<div class="assets">'+it.assets.map(a => '<img loading=lazy src="../runs/'+it.run_id+'/assets/'+a+'" />').join('')+'</div>' : ''}
          </div>
        \`;
      }).join('');
    }
    load();
    setInterval(load, 15000);
  </script>
</body>
</html>
`;

function writeDashboardHtml(): string {
  const outDir = path.join(ROOT, "dashboard");
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, "reviewer.html");
  fs.writeFileSync(out, DASHBOARD_HTML);
  return out;
}

function serveLocal(port: number): void {
  const distDir = path.join(ROOT, "dashboard");
  const server = createServer((req, res) => {
    let urlPath = (req.url || "/").split("?")[0];
    if (urlPath === "/" || urlPath === "/reviewer") urlPath = "/reviewer.html";
    // Permite ../runs/<id>/assets/<file>
    const filePath = urlPath.startsWith("/../runs/")
      ? path.join(ROOT, urlPath.slice(1))
      : path.join(distDir, urlPath);
    if (!fs.existsSync(filePath)) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const ctype = ext === ".html" ? "text/html" : ext === ".json" ? "application/json" : ext === ".png" ? "image/png" : ext === ".jpg" ? "image/jpeg" : ext === ".mp4" ? "video/mp4" : "application/octet-stream";
    res.setHeader("Content-Type", ctype);
    fs.createReadStream(filePath).pipe(res);
  });
  server.listen(port);
  console.log(`📺 Reviewer dashboard: http://localhost:${port}`);
}

async function main() {
  const args = process.argv.slice(2);
  const serve = args.includes("--serve");
  const port = parseInt(args[args.indexOf("--port") + 1] ?? "8088", 10);

  const items = buildQueue();
  const jsonPath = writeQueueJson(items);
  const htmlPath = writeDashboardHtml();
  console.log(`✓ ${items.length} runs in queue → ${path.relative(ROOT, jsonPath)}`);
  console.log(`✓ Dashboard → ${path.relative(ROOT, htmlPath)}`);

  if (serve) {
    serveLocal(port);
    // mantém alive
    setInterval(() => {
      const fresh = buildQueue();
      writeQueueJson(fresh);
    }, 15_000);
  }
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
