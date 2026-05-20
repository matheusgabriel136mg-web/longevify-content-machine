/**
 * new-run.ts — Scaffold a new content run folder
 *
 * Cria runs/YYYY-MM-DD-NNN-slug/ a partir de runs/_template/
 * Opcionalmente pre-popula frontmatter de content-object.md
 *
 * Uso:
 *   pnpm new-run --slug cortisol-atleta-br
 *   pnpm new-run --slug cortisol-atleta-br --pillar 2 --route rewrite --format reel
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

interface Args {
  slug: string;
  pillar?: string;
  route?: string;
  format?: string;
  platform?: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Partial<Args> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--slug") out.slug = args[++i];
    else if (arg === "--pillar") out.pillar = args[++i];
    else if (arg === "--route") out.route = args[++i];
    else if (arg === "--format") out.format = args[++i];
    else if (arg === "--platform") out.platform = args[++i];
  }
  if (!out.slug) {
    console.error("Usage: pnpm new-run --slug <slug> [--pillar N] [--route R] [--format F] [--platform P]");
    process.exit(1);
  }
  return out as Args;
}

function getNextSequence(date: string, runsDir: string): string {
  if (!fs.existsSync(runsDir)) return "001";
  const existing = fs.readdirSync(runsDir).filter((d) => d.startsWith(date));
  const seqs = existing
    .map((d) => parseInt(d.slice(date.length + 1, date.length + 4), 10))
    .filter((n) => !isNaN(n));
  const next = (seqs.length === 0 ? 0 : Math.max(...seqs)) + 1;
  return String(next).padStart(3, "0");
}

function copyDir(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function prefillContentObject(filePath: string, runId: string, args: Args) {
  const today = new Date().toISOString().slice(0, 10);
  let content = fs.readFileSync(filePath, "utf-8");
  content = content
    .replace(/id: YYYY-MM-DD-NNN-slug/g, `id: ${runId}`)
    .replace(/route: original \| repurpose \| rewrite \| research/g, `route: ${args.route ?? "original"}`)
    .replace(/state: idea \| brief \| draft \| verified \| published \| archived/g, "state: idea")
    .replace(/pillar: 1 \| 2 \| 3 \| 4/g, `pillar: ${args.pillar ?? "1"}`)
    .replace(/format: reel \| carousel \| story \| post \| thread \| longform/g, `format: ${args.format ?? "post"}`)
    .replace(/platforms: \[instagram, \.\.\.\]/g, `platforms: [${args.platform ?? "instagram"}]`)
    .replace(/created_at: YYYY-MM-DD/g, `created_at: ${today}`)
    .replace(/updated_at: YYYY-MM-DD/g, `updated_at: ${today}`)
    .replace(/next_action: write_idea \| write_brief \| write_draft \| verify \| publish \| feedback/g, "next_action: write_idea");
  fs.writeFileSync(filePath, content);
}

function main() {
  const args = parseArgs();
  const today = new Date().toISOString().slice(0, 10);
  const runsDir = path.join(ROOT, "runs");
  const templateDir = path.join(runsDir, "_template");

  if (!fs.existsSync(templateDir)) {
    console.error(`Template not found at ${templateDir}`);
    process.exit(1);
  }

  const seq = getNextSequence(today, runsDir);
  const runId = `${today}-${seq}-${args.slug}`;
  const runDir = path.join(runsDir, runId);

  if (fs.existsSync(runDir)) {
    console.error(`Run already exists: ${runDir}`);
    process.exit(1);
  }

  copyDir(templateDir, runDir);
  prefillContentObject(path.join(runDir, "content-object.md"), runId, args);

  // Create assets/ subdir for media generated for this run
  fs.mkdirSync(path.join(runDir, "assets"), { recursive: true });

  console.log(`✓ Created runs/${runId}/`);
  console.log(`  pillar: ${args.pillar ?? "1"} · route: ${args.route ?? "original"} · format: ${args.format ?? "post"}`);
  console.log(`\nNext: fill out runs/${runId}/idea.md → runs/${runId}/brief.md → run writer`);
}

main();
