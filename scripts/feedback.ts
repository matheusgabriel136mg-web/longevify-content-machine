/**
 * feedback.ts — Phase 6 Feedback Loop
 *
 * Coleta métricas 24h/72h dos posts publicados via IG Graph API Insights,
 * atualiza feedback.md, calcula vsMedian, dispatcha updates pras stores
 * (winners/losers/hooks/banned-patterns/feedback-log).
 *
 * Pensado pra rodar via cron 6/6h (`pnpm feedback --all`).
 *
 * Uso:
 *   pnpm feedback --run 2026-05-10-001-ferritina-corredora     # 1 run específica
 *   pnpm feedback --all                                          # scaneia todos published
 *   pnpm feedback --run <id> --force-24h                         # força fetch 24h agora
 *   pnpm feedback --run <id> --force-72h                         # força fetch 72h agora
 *   pnpm feedback --run <id> --dry-run                           # mostra plano
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const GRAPH = "https://graph.facebook.com/v23.0";

interface Args {
  run?: string;
  all: boolean;
  force24h: boolean;
  force72h: boolean;
  dryRun: boolean;
  verbose: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Partial<Args> = { all: false, force24h: false, force72h: false, dryRun: false, verbose: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--run") out.run = args[++i];
    else if (arg === "--all") out.all = true;
    else if (arg === "--force-24h") out.force24h = true;
    else if (arg === "--force-72h") out.force72h = true;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--verbose" || arg === "-v") out.verbose = true;
  }
  if (!out.run && !out.all) {
    console.error("Usage: pnpm feedback (--run <id> | --all) [--force-24h] [--force-72h] [--dry-run] [-v]");
    process.exit(1);
  }
  return out as Args;
}

function read(p: string): string {
  if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
  return fs.readFileSync(p, "utf-8");
}

function parseFrontmatter(content: string): Record<string, string> {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const fm: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const lm = line.match(/^(\w+):\s*(.*)$/);
    if (lm) fm[lm[1]] = lm[2].trim();
  }
  return fm;
}

// ────────────────────────────────────────────────────────────────────────────
// IG GRAPH API INSIGHTS
// ────────────────────────────────────────────────────────────────────────────

type Format = "carousel" | "reel" | "story" | "image";

const METRICS_BY_FORMAT: Record<Format, string[]> = {
  carousel: ["impressions", "reach", "engagement", "saved", "shares", "profile_visits"],
  image: ["impressions", "reach", "engagement", "saved", "shares", "profile_visits"],
  reel: ["plays", "reach", "total_interactions", "saved", "shares", "comments", "likes"],
  story: ["impressions", "reach", "exits", "taps_forward", "taps_back", "replies"],
};

interface Snapshot {
  views: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  reach: number;
  profile_visits?: number;
  // raw fields kept for traceability
  raw: Record<string, number>;
  fetched_at: string;
}

async function fetchInsights(mediaId: string, format: Format, token: string): Promise<Snapshot> {
  const metrics = METRICS_BY_FORMAT[format];
  const url = new URL(`${GRAPH}/${mediaId}/insights`);
  url.searchParams.set("metric", metrics.join(","));
  url.searchParams.set("access_token", token);
  const res = await fetch(url.toString());
  const json: any = await res.json();
  if (!res.ok || json.error) throw new Error(`Graph API insights error: ${JSON.stringify(json)}`);

  const raw: Record<string, number> = {};
  for (const entry of json.data || []) {
    const val = entry.values?.[0]?.value;
    if (typeof val === "number") raw[entry.name] = val;
  }

  // Also fetch basic likes/comments via media endpoint (insights doesn't return them for all formats)
  const mediaUrl = new URL(`${GRAPH}/${mediaId}`);
  mediaUrl.searchParams.set("fields", "like_count,comments_count");
  mediaUrl.searchParams.set("access_token", token);
  const mediaRes = await fetch(mediaUrl.toString());
  const mediaJson: any = await mediaRes.json();
  if (mediaRes.ok && !mediaJson.error) {
    if (mediaJson.like_count != null) raw.like_count = mediaJson.like_count;
    if (mediaJson.comments_count != null) raw.comments_count = mediaJson.comments_count;
  }

  return {
    views: raw.plays ?? raw.impressions ?? 0,
    likes: raw.likes ?? raw.like_count ?? 0,
    comments: raw.comments ?? raw.comments_count ?? 0,
    saves: raw.saved ?? 0,
    shares: raw.shares ?? 0,
    reach: raw.reach ?? 0,
    profile_visits: raw.profile_visits,
    raw,
    fetched_at: new Date().toISOString(),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// FEEDBACK.MD PARSE + UPDATE
// ────────────────────────────────────────────────────────────────────────────

function hasSnapshot24h(content: string): boolean {
  return /^\s*24h_collected_at:/m.test(content) || /-\s*Views:\s*\d+/m.test(content);
}

function hasSnapshot72h(content: string): boolean {
  return /^\s*72h_collected_at:/m.test(content);
}

function buildSnapshotBlock(label: "24h" | "72h", s: Snapshot): string {
  return `### ${label} snapshot (fetched ${s.fetched_at})
- Views/Plays: ${s.views}
- Likes: ${s.likes}
- Comments: ${s.comments}
- Saves: ${s.saves}
- Shares: ${s.shares}
- Reach: ${s.reach}${s.profile_visits != null ? `\n- Profile visits: ${s.profile_visits}` : ""}
`;
}

function injectSnapshot(content: string, label: "24h" | "72h", block: string): string {
  // Try to update existing block; else append after "## Metrics"
  const headerRe = new RegExp(`### ${label} snapshot[^\\n]*\\n[\\s\\S]*?(?=\\n### |\\n## |$)`, "m");
  if (headerRe.test(content)) {
    return content.replace(headerRe, block.trim() + "\n");
  }
  // Append after Metrics header
  if (content.includes("## Metrics")) {
    return content.replace("## Metrics", `## Metrics\n\n${block}`);
  }
  // Last resort: append at end
  return content + "\n\n" + block;
}

// ────────────────────────────────────────────────────────────────────────────
// vsMEDIAN — calcula a partir do histórico de feedback.md de outras runs
// ────────────────────────────────────────────────────────────────────────────

function loadHistoricalMetric(runsDir: string, metric: keyof Snapshot, format?: Format): number[] {
  const values: number[] = [];
  if (!fs.existsSync(runsDir)) return values;
  for (const entry of fs.readdirSync(runsDir)) {
    if (entry.startsWith("_")) continue;
    const fbPath = path.join(runsDir, entry, "feedback.md");
    if (!fs.existsSync(fbPath)) continue;
    const fbContent = fs.readFileSync(fbPath, "utf-8");
    // Look for "72h_collected" — final metrics. Skip in-flight.
    if (!fbContent.includes("72h_collected_at:")) continue;
    if (format) {
      const co = path.join(runsDir, entry, "content-object.md");
      if (fs.existsSync(co)) {
        const fm = parseFrontmatter(fs.readFileSync(co, "utf-8"));
        if (fm.published_format && fm.published_format !== format) continue;
      }
    }
    // Parse the value from feedback.md (simplified — look for "- Views: N")
    const labels: Record<string, RegExp> = {
      views: /-\s*Views\/Plays:\s*(\d+)/,
      likes: /-\s*Likes:\s*(\d+)/,
      comments: /-\s*Comments:\s*(\d+)/,
      saves: /-\s*Saves:\s*(\d+)/,
      shares: /-\s*Shares:\s*(\d+)/,
      reach: /-\s*Reach:\s*(\d+)/,
    };
    const re = labels[metric as string];
    if (re) {
      const m = fbContent.match(re);
      if (m) values.push(parseInt(m[1], 10));
    }
  }
  return values;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

interface VsMedianResult {
  bookmarks_vs_median: number | null;
  shares_vs_median: number | null;
  views_vs_median: number | null;
  primary_score: number | null; // shares-weighted (per strategy.md)
  sample_size: number;
}

function calculateVsMedian(snapshot: Snapshot, runsDir: string, format?: Format): VsMedianResult {
  const histShares = loadHistoricalMetric(runsDir, "shares", format);
  const histSaves = loadHistoricalMetric(runsDir, "saves", format);
  const histViews = loadHistoricalMetric(runsDir, "views", format);

  const medShares = median(histShares);
  const medSaves = median(histSaves);
  const medViews = median(histViews);

  const sharesVs = medShares && medShares > 0 ? snapshot.shares / medShares : null;
  const savesVs = medSaves && medSaves > 0 ? snapshot.saves / medSaves : null;
  const viewsVs = medViews && medViews > 0 ? snapshot.views / medViews : null;

  // Primary score per strategy.md: shares > saves > comments
  // Composite: 0.5 * sharesVs + 0.3 * savesVs + 0.2 * viewsVs (when available)
  let primary: number | null = null;
  let weightSum = 0;
  let weightedSum = 0;
  if (sharesVs != null) { weightedSum += 0.5 * sharesVs; weightSum += 0.5; }
  if (savesVs != null) { weightedSum += 0.3 * savesVs; weightSum += 0.3; }
  if (viewsVs != null) { weightedSum += 0.2 * viewsVs; weightSum += 0.2; }
  if (weightSum > 0) primary = weightedSum / weightSum;

  return {
    bookmarks_vs_median: savesVs,
    shares_vs_median: sharesVs,
    views_vs_median: viewsVs,
    primary_score: primary,
    sample_size: Math.max(histShares.length, histSaves.length, histViews.length),
  };
}

type Verdict = "winner" | "neutral" | "loser" | "insufficient_data";

function determineVerdict(vs: VsMedianResult): Verdict {
  if (vs.sample_size < 5 || vs.primary_score == null) return "insufficient_data";
  if (vs.primary_score >= 2.0) return "winner";
  if (vs.primary_score < 0.8) return "loser";
  return "neutral";
}

// ────────────────────────────────────────────────────────────────────────────
// STORE UPDATES (winners, losers, hooks, feedback-log)
// ────────────────────────────────────────────────────────────────────────────

function appendToStore(filePath: string, line: string) {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
  fs.writeFileSync(filePath, existing.trimEnd() + "\n" + line + "\n");
}

function extractHeadline(draftContent: string): string {
  const m = draftContent.match(/### Headline\s*\n([^\n]+)/);
  return m ? m[1].trim() : "(no headline)";
}

function dispatchStoreUpdates(
  runId: string,
  contentObjectFm: Record<string, string>,
  draftContent: string,
  snapshot: Snapshot,
  vs: VsMedianResult,
  verdict: Verdict
) {
  const today = new Date().toISOString().slice(0, 10);
  const pillar = contentObjectFm.pillar || "?";
  const format = contentObjectFm.published_format || contentObjectFm.format || "?";
  const headline = extractHeadline(draftContent);
  const primary = vs.primary_score != null ? vs.primary_score.toFixed(2) : "n/a";
  const fbLogLine = `\n[${today}] ${runId} — pillar ${pillar} (${format}) — vsMedian: ${primary} — verdict: ${verdict}\n  shares: ${snapshot.shares} · saves: ${snapshot.saves} · views: ${snapshot.views} · likes: ${snapshot.likes} · comments: ${snapshot.comments}`;
  appendToStore(path.join(ROOT, "foundation/stores/feedback-log.md"), fbLogLine);

  if (verdict === "winner") {
    const winnerRow = `| ${runId} | ${headline} | ${pillar} | ${primary} | shares=${snapshot.shares} saves=${snapshot.saves} | TBD |`;
    appendToStore(path.join(ROOT, "foundation/stores/winners.md"), winnerRow);
    const hookRow = `| ${headline} | ${runId} | ${pillar} | ${primary} | TBD |`;
    appendToStore(path.join(ROOT, "foundation/stores/hooks.md"), hookRow);
  } else if (verdict === "loser") {
    const loserRow = `| ${runId} | ${headline} | ${pillar} | ${primary} | TBD | TBD |`;
    appendToStore(path.join(ROOT, "foundation/stores/losers.md"), loserRow);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN LOGIC
// ────────────────────────────────────────────────────────────────────────────

interface RunStatus {
  runId: string;
  publishedAt: Date;
  mediaId: string;
  format: Format;
  hoursElapsed: number;
  fbContent: string;
  contentObjectFm: Record<string, string>;
  has24h: boolean;
  has72h: boolean;
}

function loadRunStatus(runId: string): RunStatus | null {
  const runDir = path.join(ROOT, "runs", runId);
  const coPath = path.join(runDir, "content-object.md");
  const fbPath = path.join(runDir, "feedback.md");
  if (!fs.existsSync(coPath)) return null;
  const co = read(coPath);
  const fm = parseFrontmatter(co);
  if (fm.state !== "published" && fm.state !== "feedback-logged") return null;
  if (!fm.published_at || !fm.published_media_id) return null;
  const fb = fs.existsSync(fbPath) ? read(fbPath) : "";
  const publishedAt = new Date(fm.published_at);
  const hoursElapsed = (Date.now() - publishedAt.getTime()) / 36e5;
  let format = (fm.published_format || fm.format || "image") as Format;
  if (format.startsWith("carousel")) format = "carousel" as Format;
  return {
    runId,
    publishedAt,
    mediaId: fm.published_media_id,
    format,
    hoursElapsed,
    fbContent: fb,
    contentObjectFm: fm,
    has24h: hasSnapshot24h(fb),
    has72h: hasSnapshot72h(fb),
  };
}

async function processRun(status: RunStatus, args: Args): Promise<void> {
  const runDir = path.join(ROOT, "runs", status.runId);
  const fbPath = path.join(runDir, "feedback.md");
  const coPath = path.join(runDir, "content-object.md");

  const due24h = args.force24h || (!status.has24h && status.hoursElapsed >= 22);
  const due72h = args.force72h || (!status.has72h && status.hoursElapsed >= 70);

  if (!due24h && !due72h) {
    console.log(`  ⏳ ${status.runId} — ${status.hoursElapsed.toFixed(1)}h elapsed · nothing due`);
    return;
  }

  if (args.dryRun) {
    console.log(`  [dry-run] ${status.runId} would fetch ${[due24h && "24h", due72h && "72h"].filter(Boolean).join(" + ")}`);
    return;
  }

  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) throw new Error("META_PAGE_ACCESS_TOKEN not set");

  console.log(`\n▶ ${status.runId} (${status.hoursElapsed.toFixed(1)}h elapsed · format: ${status.format})`);
  let fbContent = status.fbContent || `# Feedback — ${status.runId}\n\n## Metrics\n`;

  let lastSnapshot: Snapshot | null = null;
  let lastLabel: "24h" | "72h" | null = null;

  if (due24h) {
    console.log(`  [24h] fetching insights for media ${status.mediaId}...`);
    const snap = await fetchInsights(status.mediaId, status.format, token);
    console.log(`    views: ${snap.views} · likes: ${snap.likes} · saves: ${snap.saves} · shares: ${snap.shares}`);
    fbContent = injectSnapshot(fbContent, "24h", buildSnapshotBlock("24h", snap));
    if (!fbContent.includes("24h_collected_at:")) {
      // Mark in frontmatter
      fbContent = upsertFrontmatterField(fbContent, "24h_collected_at", snap.fetched_at);
    }
    lastSnapshot = snap;
    lastLabel = "24h";
  }

  if (due72h) {
    console.log(`  [72h] fetching insights for media ${status.mediaId}...`);
    const snap = await fetchInsights(status.mediaId, status.format, token);
    console.log(`    views: ${snap.views} · likes: ${snap.likes} · saves: ${snap.saves} · shares: ${snap.shares}`);
    fbContent = injectSnapshot(fbContent, "72h", buildSnapshotBlock("72h", snap));
    fbContent = upsertFrontmatterField(fbContent, "72h_collected_at", snap.fetched_at);
    lastSnapshot = snap;
    lastLabel = "72h";
  }

  // vsMedian + verdict on most recent snapshot
  if (lastSnapshot) {
    const vs = calculateVsMedian(lastSnapshot, path.join(ROOT, "runs"), status.format);
    const verdict = determineVerdict(vs);
    console.log(`  vsMedian — shares: ${fmt(vs.shares_vs_median)} · saves: ${fmt(vs.bookmarks_vs_median)} · views: ${fmt(vs.views_vs_median)}`);
    console.log(`  primary score (shares-weighted): ${fmt(vs.primary_score)} · verdict: ${verdict} (sample n=${vs.sample_size})`);

    fbContent = injectVerdictSection(fbContent, vs, verdict, lastLabel!);

    // Dispatch store updates ONLY on 72h fetch (final verdict)
    if (lastLabel === "72h" && verdict !== "insufficient_data") {
      console.log(`  → dispatching store updates (winner/loser/hook/feedback-log)...`);
      const draft = read(path.join(runDir, "draft-package.md"));
      dispatchStoreUpdates(status.runId, status.contentObjectFm, draft, lastSnapshot, vs, verdict);
    }

    // Update content-object state if 72h
    if (lastLabel === "72h") {
      let co = read(coPath);
      co = co
        .replace(/^state: .*$/m, "state: feedback-logged")
        .replace(/^updated_at: .*$/m, `updated_at: ${new Date().toISOString().slice(0, 10)}`)
        .replace(/^next_action: .*$/m, "next_action: archive_after_30d");
      const today = new Date().toISOString().slice(0, 10);
      if (co.includes("## State log")) {
        co = co.replace("## State log", `## State log\n- ${today}: feedback 72h collected · verdict: ${verdict}`);
      }
      fs.writeFileSync(coPath, co);
      console.log(`  ✓ state: feedback-logged`);
    }
  }

  fs.writeFileSync(fbPath, fbContent);
  console.log(`  ✓ feedback.md updated`);
}

function fmt(n: number | null): string {
  return n != null ? n.toFixed(2) + "x" : "n/a";
}

function upsertFrontmatterField(content: string, key: string, value: string): string {
  const re = new RegExp(`^${key}:.*$`, "m");
  if (re.test(content)) return content.replace(re, `${key}: ${value}`);
  // Insert into frontmatter if exists, else create one
  if (content.startsWith("---\n")) {
    return content.replace(/^---\n([\s\S]*?)\n---/, `---\n$1\n${key}: ${value}\n---`);
  }
  return `---\n${key}: ${value}\n---\n\n${content}`;
}

function injectVerdictSection(content: string, vs: VsMedianResult, verdict: Verdict, label: "24h" | "72h"): string {
  const block = `### Verdict (${label})
- Sample size (historical posts): ${vs.sample_size}
- Shares vs median: ${fmt(vs.shares_vs_median)}
- Saves vs median: ${fmt(vs.bookmarks_vs_median)}
- Views vs median: ${fmt(vs.views_vs_median)}
- **Primary score (shares-weighted): ${fmt(vs.primary_score)}**
- **Verdict: ${verdict.toUpperCase()}**
`;
  const re = new RegExp(`### Verdict \\(${label}\\)[\\s\\S]*?(?=\\n### |\\n## |$)`, "m");
  if (re.test(content)) return content.replace(re, block);
  // Append after the snapshot of same label
  const snapRe = new RegExp(`(### ${label} snapshot[^\\n]*\\n[\\s\\S]*?)(?=\\n### |\\n## |$)`, "m");
  if (snapRe.test(content)) return content.replace(snapRe, `$1\n${block}`);
  return content + "\n\n" + block;
}

async function main() {
  const args = parseArgs();
  const runsDir = path.join(ROOT, "runs");

  let runIds: string[];
  if (args.run) {
    runIds = [args.run];
  } else {
    runIds = fs
      .readdirSync(runsDir)
      .filter((d) => !d.startsWith("_") && fs.statSync(path.join(runsDir, d)).isDirectory());
  }

  console.log(`Feedback loop — checking ${runIds.length} run(s)`);
  let processed = 0;
  for (const id of runIds) {
    const status = loadRunStatus(id);
    if (!status) {
      if (args.run) console.log(`  ⚠ ${id} not in published state or missing metadata`);
      continue;
    }
    try {
      await processRun(status, args);
      processed++;
    } catch (err) {
      console.error(`  ✗ ${id}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`\nDone. Processed ${processed}/${runIds.length} runs.`);
}

main().catch((err) => {
  console.error("✗ Feedback loop error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
