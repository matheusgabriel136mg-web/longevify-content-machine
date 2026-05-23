// scripts/agents/backfill-idea-md.mjs — One-shot migration.
// Sweeps runs/ for dirs that have content-object.md but no idea.md.
// Derives idea.md using same logic as content-generator.readBrief fallback.
//
// Safe to re-run (idempotent — skips dirs that already have idea.md).

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");
const RUNS = path.join(ROOT, "runs");

function derive(runId) {
  const coPath = path.join(RUNS, runId, "content-object.md");
  if (!fs.existsSync(coPath)) return { skipped: true, reason: "no content-object.md" };
  const co = fs.readFileSync(coPath, "utf-8");
  const fmMatch = co.match(/^---\n([\s\S]*?)\n---/) ?? co.match(/```yaml\n([\s\S]*?)\n```/);
  const fm = {};
  if (fmMatch) {
    for (const line of fmMatch[1].split("\n")) {
      const kv = line.match(/^([a-z_][a-z0-9_]*)\s*:\s*(.+?)\s*$/i);
      if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
    }
  }
  const headlineMatch = co.match(/^#\s+(.+)$/m);
  const headline = headlineMatch?.[1]?.trim() ?? runId;
  const tldrMatch = co.match(/##\s+TL;DR\s*\n([\s\S]*?)(?=\n##|\n---|$)/i);
  const briefBody = tldrMatch
    ? tldrMatch[1].trim()
    : (co.split(/\n\n/).find(p => p.trim() && !p.startsWith("#") && !p.startsWith("---")) || "").trim();
  const slot = fm.scheduled_for || fm.slot || null;

  const ideaContent = `---
content_object: ${runId}
route: derived-from-content-object
pillar: ${fm.pillar ?? "2"}
format: ${fm.format ?? "carousel"}
target_persona: ${fm.target_persona ?? fm.persona ?? "maria"}
type: ${fm.pattern ?? fm.type ?? "persona-bio"}
${slot ? `slot: ${slot}\n` : ""}created_at: ${new Date().toISOString().slice(0,10)}
---

# ${runId}

**Headline hint:** ${headline}

**Brief:**
${briefBody || `Briefing derivado automaticamente de content-object.md.`}
`;
  fs.writeFileSync(path.join(RUNS, runId, "idea.md"), ideaContent);
  return { ok: true };
}

const dirs = fs.readdirSync(RUNS).filter(d => !d.startsWith("_") && !d.startsWith(".") && fs.statSync(path.join(RUNS, d)).isDirectory());
let derived = 0, skipped = 0, alreadyHad = 0, noContentObj = 0;
const results = [];

for (const runId of dirs) {
  const ideaPath = path.join(RUNS, runId, "idea.md");
  if (fs.existsSync(ideaPath)) { alreadyHad++; continue; }
  const r = derive(runId);
  if (r.ok) { derived++; results.push({ runId, status: "derived" }); }
  else if (r.skipped) { noContentObj++; results.push({ runId, status: "skipped", reason: r.reason }); }
  else { skipped++; }
}

console.log(`\n📜 Backfill idea.md from content-object.md:\n`);
console.log(`  total dirs:       ${dirs.length}`);
console.log(`  already had idea: ${alreadyHad}`);
console.log(`  derived now:      ${derived}`);
console.log(`  no content-obj:   ${noContentObj}`);
console.log("");
for (const r of results) {
  const icon = r.status === "derived" ? "✓" : "·";
  console.log(`  ${icon} ${r.runId}${r.reason ? ` (${r.reason})` : ""}`);
}
