/**
 * server.ts — Dashboard Web Server (Valle Dashboard)
 *
 * Express server expondo 3 tabs:
 *   - Inspire: feed de posts SP + Mito (com botão "Reproduzir")
 *   - Review: fila de runs aguardando aprovação (Aprovar / Rejeitar)
 *   - Ops: custo + state + notificações
 *
 * Auth: HTTP Basic via DASHBOARD_USER + DASHBOARD_PASS no .env
 *
 * Uso:
 *   pnpm dashboard
 *   pnpm dashboard --port 8088
 */

import express from "express";
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { readLedger, totalForDay, totalForMonth, totalForRun } from "./lib/cost-guard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const PORT = parseInt(process.env.PORT ?? process.argv.find((a, i, arr) => arr[i - 1] === "--port") ?? "8088", 10);
const USER = process.env.DASHBOARD_USER ?? "longevify";
const PASS = process.env.DASHBOARD_PASS ?? "changeme";

const app = express();
app.use(express.json({ limit: "1mb" }));

// ─── Auth ─────────────────────────────────────────────────────────────────────
function authPage(badCreds: boolean): string {
  const msg = badCreds
    ? `Login ou senha incorretos. Tente novamente.`
    : `Acesso restrito ao time Longevify. Use o login fornecido pelo Matheus.`;
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Longevify — Acesso</title><style>
    body{margin:0;background:#1C3F3A;color:#f8fffc;font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;}
    .box{max-width:420px;text-align:center;}
    .logo{font-size:24px;font-weight:300;letter-spacing:-0.02em;margin-bottom:8px;}
    .accent{color:#C89136;}
    .sub{font-size:14px;opacity:0.7;margin-bottom:32px;}
    .msg{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:20px;font-size:14px;line-height:1.5;}
    .hint{font-size:12px;opacity:0.5;margin-top:18px;}
  </style></head><body><div class="box">
    <div class="logo">Longev<span class="accent">ify</span></div>
    <div class="sub">Content review dashboard</div>
    <div class="msg">${msg}<br><br>Seu navegador deve mostrar um popup pedindo <b>login</b> e <b>senha</b>. Se ele já fechou, clique em recarregar (⌘R / Ctrl+R) que ele aparece de novo.</div>
    <div class="hint">Dúvida? fala com o Matheus.</div>
  </div></body></html>`;
}
app.use((req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth) {
    res.set("WWW-Authenticate", 'Basic realm="Longevify Dashboard"');
    res.set("Content-Type", "text/html; charset=utf-8");
    return res.status(401).send(authPage(false));
  }
  const decoded = Buffer.from(auth.replace(/^Basic\s+/, ""), "base64").toString("utf-8");
  const [u, p] = decoded.split(":");
  if (u !== USER || p !== PASS) {
    res.set("WWW-Authenticate", 'Basic realm="Longevify Dashboard"');
    res.set("Content-Type", "text/html; charset=utf-8");
    return res.status(401).send(authPage(true));
  }
  next();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseFrontmatter(content: string): Record<string, string> {
  // Allow optional HTML comment OR whitespace before the --- block (template files start with <!-- TEMPLATE -->)
  const m = content.match(/(?:^|\n)---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const fm = line.match(/^([a-z_]+):\s*(.+)$/);
    if (fm) out[fm[1]] = fm[2].trim();
  }
  return out;
}

function findLatestAnalysisDir(): string | null {
  const outDir = path.join(ROOT, "output");
  if (!fs.existsSync(outDir)) return null;
  const dirs = fs.readdirSync(outDir).filter((d) => d.startsWith("analysis-")).sort();
  return dirs.length ? path.join(outDir, dirs[dirs.length - 1]) : null;
}

function findAllAnalysisDirs(): string[] {
  const outDir = path.join(ROOT, "output");
  if (!fs.existsSync(outDir)) return [];
  return fs.readdirSync(outDir)
    .filter((d) => d.startsWith("analysis-"))
    .sort()
    .reverse() // mais recente primeiro
    .map((d) => path.join(outDir, d));
}

/**
 * Mergeia raw-posts.json de TODOS os snapshots analysis-*.
 * Dedupe por p.id (mantém a primeira ocorrência = mais recente, pois dirs estão reverse-sorted).
 * Isso protege contra Apify scrape parcial que apaga conteúdo bom de scrapes anteriores.
 */
function loadAllInstagramPosts(): any[] {
  const dirs = findAllAnalysisDirs();
  const seen = new Set<string>();
  const merged: any[] = [];
  for (const dir of dirs) {
    const rawPath = path.join(dir, "raw-posts.json");
    if (!fs.existsSync(rawPath)) continue;
    try {
      const posts = JSON.parse(fs.readFileSync(rawPath, "utf-8")) as Array<{ id: string }>;
      for (const p of posts) {
        if (!p.id || seen.has(p.id)) continue;
        seen.add(p.id);
        merged.push(p);
      }
    } catch { /* skip corrupted snapshot */ }
  }
  return merged;
}

function findLatestTikTokDir(): string | null {
  const outDir = path.join(ROOT, "output");
  if (!fs.existsSync(outDir)) return null;
  const dirs = fs.readdirSync(outDir).filter((d) => d.startsWith("tiktok-analysis-")).sort();
  return dirs.length ? path.join(outDir, dirs[dirs.length - 1]) : null;
}

// In-memory active jobs registry (run-id → status)
const activeJobs = new Map<string, { phase: string; startedAt: number; logTail: string[] }>();

function startBackgroundJob(runId: string, script: string, args: string[], phase: string): void {
  if (!activeJobs.has(runId)) activeJobs.set(runId, { phase, startedAt: Date.now(), logTail: [] });
  const job = activeJobs.get(runId)!;
  job.phase = phase;
  const child = spawn("node", ["--import", "tsx/esm", `scripts/${script}.ts`, ...args], {
    cwd: ROOT,
    env: process.env,
  });
  child.stdout.on("data", (d) => {
    job.logTail.push(d.toString());
    if (job.logTail.length > 50) job.logTail.shift();
  });
  child.stderr.on("data", (d) => {
    job.logTail.push("[err] " + d.toString());
    if (job.logTail.length > 50) job.logTail.shift();
  });
  child.on("close", (code) => {
    job.logTail.push(`[exit ${code}]`);
    if (code !== 0) job.phase = "failed";
  });
}

// ─── API: Thumb proxy ─────────────────────────────────────────────────────────
// Tenta primeiro o cache local (output/analysis-*/thumbs/<postId>.jpg), depois proxy IG CDN.
app.get("/api/thumb", async (req, res) => {
  const url = req.query.url as string;
  const postId = req.query.postId as string | undefined;

  // 1. Tenta cache local
  if (postId) {
    const outDir = path.join(ROOT, "output");
    if (fs.existsSync(outDir)) {
      const snapshots = fs.readdirSync(outDir).filter((d) => d.startsWith("analysis-")).sort().reverse();
      for (const s of snapshots) {
        const cached = path.join(outDir, s, "thumbs", `${postId}.jpg`);
        if (fs.existsSync(cached) && fs.statSync(cached).size > 1000) {
          res.setHeader("Content-Type", "image/jpeg");
          res.setHeader("Cache-Control", "public, max-age=86400");
          return fs.createReadStream(cached).pipe(res);
        }
      }
    }
  }

  // 2. Proxy remoto (best-effort)
  if (!url || !/^https?:\/\//.test(url)) return res.status(404).send("no source");
  try {
    const r = await fetch(url, { headers: { Referer: "https://www.instagram.com/", "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return res.status(404).send("expired");
    const ct = r.headers.get("content-type") ?? "image/jpeg";
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "public, max-age=3600");
    const buf = Buffer.from(await r.arrayBuffer());

    // Cacheia pro próximo request (best-effort)
    if (postId) {
      const outDir = path.join(ROOT, "output");
      const snapshots = fs.existsSync(outDir) ? fs.readdirSync(outDir).filter((d) => d.startsWith("analysis-")).sort() : [];
      if (snapshots.length) {
        const cacheDir = path.join(outDir, snapshots[snapshots.length - 1], "thumbs");
        try {
          fs.mkdirSync(cacheDir, { recursive: true });
          fs.writeFileSync(path.join(cacheDir, `${postId}.jpg`), buf);
        } catch { /* ignore */ }
      }
    }

    res.send(buf);
  } catch (e) {
    res.status(500).send((e as Error).message);
  }
});

// ─── Internal ideas (não-competidores, ideias nossas) ─────────────────────────
const IDEAS_PATH = path.join(ROOT, "output", "internal-ideas.json");

interface InternalIdea {
  id: string;
  title: string;
  biomarker_focus?: string;
  format_suggestion?: string;
  pillar?: number;
  source_text: string;
  hook_suggestions?: string[];
  angle?: string;
  source_url?: string;
  added_at: string;
  added_by?: string;
  status?: string;
  notes?: string;
}

function loadIdeas(): InternalIdea[] {
  if (!fs.existsSync(IDEAS_PATH)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(IDEAS_PATH, "utf-8")) as { ideas: InternalIdea[] };
    return data.ideas ?? [];
  } catch { return []; }
}

function saveIdeas(ideas: InternalIdea[]): void {
  fs.mkdirSync(path.dirname(IDEAS_PATH), { recursive: true });
  fs.writeFileSync(IDEAS_PATH, JSON.stringify({ ideas, updated_at: new Date().toISOString() }, null, 2));
}

app.get("/api/ideas", (_req, res) => {
  res.json({ ideas: loadIdeas() });
});

app.post("/api/ideas", (req, res) => {
  const idea = req.body as Partial<InternalIdea>;
  if (!idea.title || !idea.source_text) return res.status(400).json({ error: "title e source_text obrigatórios" });
  const ideas = loadIdeas();
  const newIdea: InternalIdea = {
    id: idea.id ?? `idea-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 8)}`,
    title: idea.title,
    biomarker_focus: idea.biomarker_focus,
    format_suggestion: idea.format_suggestion ?? "carousel",
    pillar: idea.pillar ?? 2,
    source_text: idea.source_text,
    hook_suggestions: idea.hook_suggestions,
    angle: idea.angle,
    source_url: idea.source_url,
    added_at: new Date().toISOString(),
    added_by: idea.added_by ?? "matheus",
    status: "queued",
    notes: idea.notes,
  };
  ideas.unshift(newIdea);
  saveIdeas(ideas);
  res.json({ ok: true, idea: newIdea, total: ideas.length });
});

app.put("/api/ideas/:id", (req, res) => {
  const patch = req.body as Partial<InternalIdea>;
  const ideas = loadIdeas();
  const idx = ideas.findIndex((i) => i.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: "idea não encontrada" });
  ideas[idx] = { ...ideas[idx], ...patch, id: ideas[idx].id, added_at: ideas[idx].added_at };
  saveIdeas(ideas);
  res.json({ ok: true, idea: ideas[idx] });
});

app.delete("/api/ideas/:id", (req, res) => {
  const ideas = loadIdeas().filter((i) => i.id !== req.params.id);
  saveIdeas(ideas);
  res.json({ ok: true, total: ideas.length });
});

// ─── Feedback (Valle/Matheus deixam comentários pra modelo melhorar) ──────────
const FEEDBACK_PATH = path.join(ROOT, "output", "feedback.json");

interface Feedback {
  id: string;
  target_type: "post" | "run" | "idea" | "general";
  target_id: string;             // postId, runId, ideaId — vazio se general
  target_label?: string;         // título/brand/hook pra mostrar na lista
  author: "matheus" | "valle" | "ai" | "external";
  text: string;
  tags: string[];                // ["voice","visual","palette","cta","hook","pillar","copy","format"]
  severity: "praise" | "nit" | "must-fix";
  created_at: string;
  resolved: boolean;
  resolved_at?: string;
  resolved_by?: string;
}

function loadFeedback(): Feedback[] {
  if (!fs.existsSync(FEEDBACK_PATH)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(FEEDBACK_PATH, "utf-8")) as { feedback: Feedback[] };
    return data.feedback ?? [];
  } catch { return []; }
}

function saveFeedback(items: Feedback[]): void {
  fs.mkdirSync(path.dirname(FEEDBACK_PATH), { recursive: true });
  fs.writeFileSync(FEEDBACK_PATH, JSON.stringify({ feedback: items, updated_at: new Date().toISOString() }, null, 2));
}

app.get("/api/feedback", (req, res) => {
  const items = loadFeedback();
  const { target_type, target_id, resolved, author } = req.query as Record<string, string | undefined>;
  let filtered = items;
  if (target_type) filtered = filtered.filter((f) => f.target_type === target_type);
  if (target_id) filtered = filtered.filter((f) => f.target_id === target_id);
  if (resolved === "true") filtered = filtered.filter((f) => f.resolved);
  if (resolved === "false") filtered = filtered.filter((f) => !f.resolved);
  if (author) filtered = filtered.filter((f) => f.author === author);
  res.json({
    feedback: filtered,
    total: items.length,
    unresolved: items.filter((f) => !f.resolved).length,
  });
});

app.post("/api/feedback", (req, res) => {
  const body = req.body as Partial<Feedback>;
  if (!body.text || !body.text.trim()) return res.status(400).json({ error: "text obrigatório" });
  const items = loadFeedback();
  const newItem: Feedback = {
    id: `fb-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 8)}`,
    target_type: body.target_type ?? "general",
    target_id: body.target_id ?? "",
    target_label: body.target_label,
    author: body.author ?? "matheus",
    text: body.text.trim(),
    tags: body.tags ?? [],
    severity: body.severity ?? "nit",
    created_at: new Date().toISOString(),
    resolved: false,
  };
  items.unshift(newItem);
  saveFeedback(items);
  res.json({ ok: true, feedback: newItem, total: items.length });
});

app.put("/api/feedback/:id/resolve", (req, res) => {
  const items = loadFeedback();
  const idx = items.findIndex((f) => f.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: "feedback não encontrado" });
  const { resolved_by } = req.body as { resolved_by?: string };
  items[idx].resolved = !items[idx].resolved;
  items[idx].resolved_at = items[idx].resolved ? new Date().toISOString() : undefined;
  items[idx].resolved_by = items[idx].resolved ? (resolved_by ?? "matheus") : undefined;
  saveFeedback(items);
  res.json({ ok: true, feedback: items[idx] });
});

app.put("/api/feedback/:id", (req, res) => {
  const items = loadFeedback();
  const idx = items.findIndex((f) => f.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: "feedback não encontrado" });
  const patch = req.body as Partial<Feedback>;
  items[idx] = { ...items[idx], ...patch, id: items[idx].id, created_at: items[idx].created_at };
  saveFeedback(items);
  res.json({ ok: true, feedback: items[idx] });
});

app.delete("/api/feedback/:id", (req, res) => {
  const items = loadFeedback().filter((f) => f.id !== req.params.id);
  saveFeedback(items);
  res.json({ ok: true, total: items.length });
});

// ─── Bookmarked posts persistence ─────────────────────────────────────────────
const BOOKMARKED_PATH = path.join(ROOT, "output", "bookmarked-posts.json");

function loadBookmarked(): Set<string> {
  if (!fs.existsSync(BOOKMARKED_PATH)) return new Set();
  try {
    const data = JSON.parse(fs.readFileSync(BOOKMARKED_PATH, "utf-8")) as { ids: string[] };
    return new Set(data.ids ?? []);
  } catch { return new Set(); }
}
function saveBookmarked(set: Set<string>): void {
  fs.mkdirSync(path.dirname(BOOKMARKED_PATH), { recursive: true });
  fs.writeFileSync(BOOKMARKED_PATH, JSON.stringify({ ids: [...set], updated_at: new Date().toISOString() }, null, 2));
}

app.post("/api/feed/bookmark/:postId", (req, res) => {
  const set = loadBookmarked();
  set.add(req.params.postId);
  saveBookmarked(set);
  res.json({ ok: true, bookmarked_count: set.size, action: "added" });
});

app.post("/api/feed/unbookmark/:postId", (req, res) => {
  const set = loadBookmarked();
  set.delete(req.params.postId);
  saveBookmarked(set);
  res.json({ ok: true, bookmarked_count: set.size, action: "removed" });
});

app.get("/api/feed/bookmarked", (_req, res) => {
  const set = loadBookmarked();
  res.json({ ids: [...set], count: set.size });
});

// ─── Dismissed posts persistence ──────────────────────────────────────────────
const DISMISSED_PATH = path.join(ROOT, "output", "dismissed-posts.json");

function loadDismissed(): Set<string> {
  if (!fs.existsSync(DISMISSED_PATH)) return new Set();
  try {
    const data = JSON.parse(fs.readFileSync(DISMISSED_PATH, "utf-8")) as { ids: string[] };
    return new Set(data.ids ?? []);
  } catch {
    return new Set();
  }
}

function saveDismissed(set: Set<string>): void {
  fs.mkdirSync(path.dirname(DISMISSED_PATH), { recursive: true });
  fs.writeFileSync(DISMISSED_PATH, JSON.stringify({ ids: [...set], updated_at: new Date().toISOString() }, null, 2));
}

// ─── Scheduled posts (Inspire → backlog) ──────────────────────────────────────
const SCHEDULED_PATH = path.join(ROOT, "runs", "_backlog", "scheduled-posts.json");

interface ScheduledPost {
  post_id: string;
  brand: string;
  caption_excerpt: string;
  source_url: string;
  source_vsmedian: number;
  source_format: string;
  scheduled_day: string;
  scheduled_format: string;
  scheduled_series?: string;
  notes?: string;
  status: "queued" | "in_production" | "verified" | "published" | "skipped";
  added_at: string;
}

function loadScheduled(): ScheduledPost[] {
  if (!fs.existsSync(SCHEDULED_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(SCHEDULED_PATH, "utf-8")) as ScheduledPost[]; } catch { return []; }
}
function saveScheduled(items: ScheduledPost[]): void {
  fs.mkdirSync(path.dirname(SCHEDULED_PATH), { recursive: true });
  fs.writeFileSync(SCHEDULED_PATH, JSON.stringify(items, null, 2));
}

app.post("/api/feed/schedule/:postId", (req, res) => {
  const { day, format, series, notes, brand, caption, url, vsMedian, sourceFormat } = req.body as any;
  if (!day || !format) return res.status(400).json({ error: "day e format obrigatórios" });
  const items = loadScheduled();
  // Remove duplicates pelo post_id+day (re-schedule overrides)
  const filtered = items.filter((i) => !(i.post_id === req.params.postId && i.scheduled_day === day));
  filtered.push({
    post_id: req.params.postId,
    brand: brand ?? "?",
    caption_excerpt: (caption ?? "").slice(0, 200),
    source_url: url ?? "",
    source_vsmedian: vsMedian ?? 0,
    source_format: sourceFormat ?? "image",
    scheduled_day: day,
    scheduled_format: format,
    scheduled_series: series,
    notes,
    status: "queued",
    added_at: new Date().toISOString(),
  });
  saveScheduled(filtered);
  res.json({ ok: true, count: filtered.length });
});

app.get("/api/scheduled", (_req, res) => {
  res.json({ items: loadScheduled() });
});

app.post("/api/scheduled/remove/:postId/:day", (req, res) => {
  const items = loadScheduled().filter((i) => !(i.post_id === req.params.postId && i.scheduled_day === req.params.day));
  saveScheduled(items);
  res.json({ ok: true, count: items.length });
});

// ─── API: Dismiss / Undismiss ─────────────────────────────────────────────────
app.post("/api/feed/dismiss/:postId", (req, res) => {
  const set = loadDismissed();
  set.add(req.params.postId);
  saveDismissed(set);
  res.json({ ok: true, dismissed_count: set.size });
});

app.post("/api/feed/undismiss/:postId", (req, res) => {
  const set = loadDismissed();
  set.delete(req.params.postId);
  saveDismissed(set);
  res.json({ ok: true, dismissed_count: set.size });
});

app.get("/api/feed/dismissed", (_req, res) => {
  const set = loadDismissed();
  res.json({ ids: [...set], count: set.size });
});

// ─── API: Feed (Inspire tab) ──────────────────────────────────────────────────
app.get("/api/feed", (_req, res) => {
  const dir = findLatestAnalysisDir();
  if (!dir) return res.json({ posts: [], message: "Sem snapshot. Rode pnpm analyze-instagrams ou aguarde cron diário." });

  // Merge TODOS os snapshots (não só o mais recente) — protege contra scrape parcial
  // ex.: 18/mai trouxe Mito=0 mas 17/mai tinha Mito=77 e 08/mai tinha Mito=315
  const posts = loadAllInstagramPosts() as Array<{
    id: string;
    shortCode?: string;
    url?: string;
    ownerUsername?: string;
    caption?: string;
    likesCount?: number;
    commentsCount?: number;
    timestamp?: string;
    displayUrl?: string;
    images?: string[];
    type?: string;
    productType?: string;
    brand?: string;
    vsMedian?: number;
    isViral?: boolean;
    format?: string;
  }>;

  const dismissed = loadDismissed();
  const allowedBrands = [
    // Tier 1 direto
    "Superpower", "Mito Health", "Function Health", "Bryan Johnson",
    // Tier 2 health-tech
    "Thorne Health", "Rerise Health", "Timeline Longevity",
    "Lifeforce", "InsideTracker", "Everlywell", "OneSkin", "Forward",
    // Tier 2 autoridade
    "Huberman Lab", "Peter Attia MD", "Dr Mark Hyman", "Rhonda Patrick",
    // Tier 2 BR
    "Better Be Health",
    // Tier 2 AU
    "Everlab Health",
  ];
  const mapped = posts
    .filter((p) => p.brand && allowedBrands.includes(p.brand) && !dismissed.has(p.id))
    .map((p) => ({
      id: p.id,
      shortCode: p.shortCode,
      url: p.url ?? `https://instagram.com/p/${p.shortCode ?? ""}`,
      brand: p.brand!,
      caption: (p.caption ?? "").slice(0, 400),
      likes: p.likesCount ?? 0,
      comments: p.commentsCount ?? 0,
      vsMedian: p.vsMedian ?? 0,
      isViral: p.isViral ?? false,
      format: p.format ?? "image",
      timestamp: p.timestamp ?? "",
      thumbnail: p.displayUrl ?? p.images?.[0] ?? null,
      platform: "instagram" as const,
    }));

  // ── TikTok merge ──────────────────────────────────────────────────────────
  const tiktokDir = findLatestTikTokDir();
  let tiktokMapped: typeof mapped = [];
  if (tiktokDir) {
    const ttRawPath = path.join(tiktokDir, "raw-posts.json");
    if (fs.existsSync(ttRawPath)) {
      try {
        const ttPosts = JSON.parse(fs.readFileSync(ttRawPath, "utf-8")) as Array<{
          id: string;
          shortCode?: string;
          url?: string;
          brand?: string;
          caption?: string;
          likesCount?: number;
          commentsCount?: number;
          vsMedian?: number;
          isViral?: boolean;
          format?: string;
          timestamp?: string;
          displayUrl?: string;
          images?: string[];
          playCount?: number;
          shareCount?: number;
          geo?: "BR" | "US";
        }>;
        tiktokMapped = ttPosts
          .filter((p) => p.brand && !dismissed.has(p.id))
          .map((p) => ({
            id: p.id,
            shortCode: p.shortCode,
            url: p.url ?? "",
            brand: p.brand!,
            caption: (p.caption ?? "").slice(0, 400),
            likes: p.likesCount ?? 0,
            comments: p.commentsCount ?? 0,
            vsMedian: p.vsMedian ?? 0,
            isViral: p.isViral ?? false,
            format: p.format ?? "reel",
            timestamp: p.timestamp ?? "",
            thumbnail: p.displayUrl ?? p.images?.[0] ?? null,
            platform: "tiktok" as const,
            _playCount: p.playCount ?? 0,
            _shareCount: p.shareCount ?? 0,
            _geo: p.geo ?? "US",
          })) as any;
      } catch (e) {
        console.warn("⚠️ TikTok merge falhou:", (e as Error).message);
      }
    }
  }

  // Balanceia: top 50 por marca (IG + TT no mesmo bucket — brand é único)
  const combined = [...mapped, ...tiktokMapped];
  const byBrand = new Map<string, typeof combined>();
  for (const item of combined) {
    if (!byBrand.has(item.brand)) byBrand.set(item.brand, []);
    byBrand.get(item.brand)!.push(item);
  }
  const items: typeof combined = [];
  for (const [, list] of byBrand) {
    list.sort((a, b) => b.vsMedian - a.vsMedian);
    items.push(...list.slice(0, 50));
  }
  items.sort((a, b) => b.vsMedian - a.vsMedian);

  // Merge internal ideas as if they were posts (brand = "💡 Ideias")
  const ideas = loadIdeas();
  const ideaPosts = ideas
    .filter((i) => !dismissed.has(i.id))
    .map((i) => ({
      id: i.id,
      shortCode: "",
      url: i.source_url ?? "",
      brand: "💡 Ideias" as any,
      caption: i.source_text,
      likes: 0,
      comments: 0,
      vsMedian: 99, // Coloca no topo
      isViral: false,
      format: i.format_suggestion ?? "carousel",
      timestamp: i.added_at,
      thumbnail: null,
      _isIdea: true,
      _title: i.title,
      _biomarker: i.biomarker_focus,
      _pillar: i.pillar,
      _hookSuggestions: i.hook_suggestions,
      _angle: i.angle,
      _notes: i.notes,
    }));

  // Ideias primeiro, depois posts competidores
  const allItems = [...ideaPosts, ...items];

  res.json({
    posts: allItems,
    snapshot: path.basename(dir),
    tiktok_snapshot: tiktokDir ? path.basename(tiktokDir) : null,
    dismissed_count: dismissed.size,
    ideas_count: ideaPosts.length,
    instagram_count: mapped.length,
    tiktok_count: tiktokMapped.length,
  });
});

// ─── API: Reproduce ───────────────────────────────────────────────────────────
app.post("/api/reproduce", (req, res) => {
  const { postId, shortCode, caption, brand, format } = req.body as {
    postId?: string;
    shortCode?: string;
    caption?: string;
    brand?: string;
    format?: string;
  };
  if (!shortCode && !postId) return res.status(400).json({ error: "shortCode ou postId obrigatório" });

  // slug a partir das primeiras palavras da caption
  const cleanCaption = (caption ?? "").replace(/[^\w\sÀ-ú-]/g, "").trim();
  const slug = (cleanCaption.split(/\s+/).slice(0, 4).join("-").toLowerCase() || `${brand?.toLowerCase()}-${shortCode}`).slice(0, 40);

  const pipelineArgs = [
    "--slug", `${slug}-repro`,
    "--pillar", "2",
    "--route", "rewrite",
    "--format", format === "reel" ? "reel" : "carousel",
  ];

  // Cria run-id temporário pra tracking
  const today = new Date().toISOString().slice(0, 10);
  const tempRunId = `${today}-pending-${slug}`;

  startBackgroundJob(tempRunId, "pipeline", pipelineArgs, "starting");
  res.json({ ok: true, message: "Pipeline iniciada (~10min). Vai aparecer na aba Review quando terminar.", tempRunId });
});

// ─── API: Review queue ────────────────────────────────────────────────────────
app.get("/api/review-queue", (_req, res) => {
  const runsDir = path.join(ROOT, "runs");
  if (!fs.existsSync(runsDir)) return res.json({ items: [] });

  const items: any[] = [];

  for (const dir of fs.readdirSync(runsDir)) {
    if (dir.startsWith("_") || dir.startsWith(".")) continue;
    const runDir = path.join(runsDir, dir);
    if (!fs.statSync(runDir).isDirectory()) continue;
    const coPath = path.join(runDir, "content-object.md");
    if (!fs.existsSync(coPath)) continue;

    const co = parseFrontmatter(fs.readFileSync(coPath, "utf-8"));
    const state = co.state ?? "idea";
    if (!["draft", "verified"].includes(state)) continue;

    // Extrair hook da headline do draft
    const draftPath = path.join(runDir, "draft-package.md");
    let hook = "";
    let caption = "";
    if (fs.existsSync(draftPath)) {
      const dc = fs.readFileSync(draftPath, "utf-8");
      const hm = dc.match(/### Headline\s*\n+\*?\*?([^\n*]+)/);
      hook = hm ? hm[1].trim() : "";
      const cm = dc.match(/### Caption[^\n]*\n([\s\S]*?)(?=\n###|\n##|\n# )/);
      caption = cm ? cm[1].trim().slice(0, 300) : "";
    }

    // Verifier score
    const verifierPath = path.join(runDir, "verifier-report.md");
    let verifierScore = "";
    let verifierVerdict = "";
    if (fs.existsSync(verifierPath)) {
      const vf = parseFrontmatter(fs.readFileSync(verifierPath, "utf-8"));
      verifierScore = vf.verifier_score ?? "";
      verifierVerdict = vf.verdict ?? "";
    }

    // Slides (current finals)
    const assetsDir = path.join(runDir, "assets");
    const slidesPaths: string[] = [];
    if (fs.existsSync(assetsDir)) {
      const all = fs.readdirSync(assetsDir).filter((f) => /^slide-\d+/.test(f) && /\.(png|jpg|jpeg)$/i.test(f));
      const bySlide = new Map<number, string[]>();
      for (const f of all) {
        const m = f.match(/^slide-(\d+)/);
        if (!m) continue;
        const n = parseInt(m[1], 10);
        if (!bySlide.has(n)) bySlide.set(n, []);
        bySlide.get(n)!.push(f);
      }
      for (const n of [...bySlide.keys()].sort((a, b) => a - b)) {
        const candidates = bySlide.get(n)!;
        const finals = candidates.filter((c) => /-final\./.test(c));
        const pool = finals.length ? finals : candidates;
        pool.sort((a, b) => (b.match(/-v(\d+)/)?.[1] ?? "0").localeCompare(a.match(/-v(\d+)/)?.[1] ?? "0"));
        slidesPaths.push(`/runs/${dir}/assets/${pool[0]}`);
      }
    }

    items.push({
      run_id: dir,
      state,
      pillar: co.pillar ?? "?",
      format: co.format ?? "?",
      hook,
      caption,
      verifier_score: verifierScore,
      verifier_verdict: verifierVerdict,
      slides: slidesPaths,
      cost_usd: totalForRun(dir),
      updated_at: co.updated_at ?? "",
    });
  }

  items.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  res.json({ items });
});

// ─── API: Approve (publish) ───────────────────────────────────────────────────
app.post("/api/approve/:runId", (req, res) => {
  const runId = req.params.runId;
  const runDir = path.join(ROOT, "runs", runId);
  if (!fs.existsSync(runDir)) return res.status(404).json({ error: "run não existe" });
  startBackgroundJob(runId, "publish", ["--run", runId], "publishing");
  res.json({ ok: true, message: "Publish iniciado." });
});

// ─── API: Reject (archive) ────────────────────────────────────────────────────
app.post("/api/reject/:runId", (req, res) => {
  const runId = req.params.runId;
  const coPath = path.join(ROOT, "runs", runId, "content-object.md");
  if (!fs.existsSync(coPath)) return res.status(404).json({ error: "run não existe" });
  let content = fs.readFileSync(coPath, "utf-8");
  content = content.replace(/^state:\s*\w+.*$/m, "state: archived");
  content = content.replace(/^next_action:\s*.*$/m, "next_action: rejected");
  fs.writeFileSync(coPath, content);
  res.json({ ok: true });
});

// ─── API: Ops ─────────────────────────────────────────────────────────────────
app.get("/api/ops", (_req, res) => {
  const ledger = readLedger();
  const byProvider: Record<string, number> = {};
  for (const r of ledger) byProvider[r.provider] = (byProvider[r.provider] ?? 0) + r.usd;

  const stateCounts: Record<string, number> = {};
  let totalRuns = 0;
  const runsDir = path.join(ROOT, "runs");
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

  res.json({
    cost: { today_usd: totalForDay(), month_usd: totalForMonth(), by_provider: byProvider },
    runs: { state_counts: stateCounts, total: totalRuns },
    jobs: [...activeJobs.entries()].map(([runId, j]) => ({
      runId,
      phase: j.phase,
      startedAt: j.startedAt,
      runtimeSec: Math.round((Date.now() - j.startedAt) / 1000),
      logTail: j.logTail.slice(-10),
    })),
  });
});

// ─── Static files ─────────────────────────────────────────────────────────────
app.use("/runs", express.static(path.join(ROOT, "runs")));
app.use(express.static(path.join(ROOT, "dashboard")));

app.get("/", (_req, res) => {
  res.sendFile(path.join(ROOT, "dashboard", "app.html"));
});

app.listen(PORT, () => {
  console.log(`🚀 Longevify Dashboard: http://localhost:${PORT}`);
  console.log(`   Auth: ${USER} / ${PASS === "changeme" ? "(default — MUDA isso no .env!)" : "(custom)"}`);
});
