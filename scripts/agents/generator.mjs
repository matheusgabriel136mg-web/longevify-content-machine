// scripts/agents/generator.mjs — Generator agent (idea brief → render)
//
// Roteamento determinístico baseado em pattern/format/persona:
//   - persona-bio-case-study  → scripts/render-persona-carousel.mjs --persona X --run Y
//   - brand-manifesto         → scripts/render-jockey-carousel.mjs (TODO generic manifesto template)
//   - dado-punch              → scripts/render-vitd-brasil.mjs (TODO generic dado template)
//   - biomarker-gap           → scripts/render-ferritin-carousel.mjs (TODO generic biomarker template)
//   - reel-tips               → scripts/render-reel-tips.mjs (TODO generic reel template)
//
// Pra MVP D2-D5: roteia pra script existente. Templates genéricos D6+.
//
// CLI:
//   node scripts/agents/generator.mjs --run <run-id>

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");

function parseArgs() {
  const a = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--run") out.run = a[++i];
    else if (a[i] === "--dry-run") out.dryRun = true;
  }
  if (!out.run) {
    console.error("Usage: generator.mjs --run <run-id> [--dry-run]");
    process.exit(1);
  }
  return out;
}

// ─── Read run metadata ────────────────────────────────────────────────────────
function readMeta(runId) {
  const ideaPath = path.join(ROOT, "runs", runId, "idea.md");
  const coPath = path.join(ROOT, "runs", runId, "content-object.md");

  let meta = { pattern: null, format: null, persona: null, pillar: null };
  for (const p of [coPath, ideaPath]) {
    if (!fs.existsSync(p)) continue;
    const txt = fs.readFileSync(p, "utf-8");
    meta.pattern = meta.pattern || (txt.match(/^pattern:\s*(\S+)/m) ?? [])[1];
    meta.format = meta.format || (txt.match(/^format:\s*(\S+)/m) ?? [])[1];
    meta.persona = meta.persona || (txt.match(/^target_persona:\s*(\S+)/m) ?? [])[1];
    meta.pillar = meta.pillar || parseInt((txt.match(/^pillar:\s*(\d+)/m) ?? [, "0"])[1]);
    meta.slot_type = meta.slot_type || (txt.match(/^type:\s*(\S+)/m) ?? [])[1];
  }
  return meta;
}

// ─── Router ───────────────────────────────────────────────────────────────────
function routeToRenderer(meta) {
  // Priority order:
  // 1. persona-bio pattern → persona-carousel.mjs (data-driven via personas/<id>.json)
  // 2. reel format → render-reel-tips.mjs
  // 3. dado-punch pattern OR single image → render-vitd-brasil.mjs template
  // 4. brand-manifesto → render-jockey-carousel.mjs template
  // 5. biomarker-gap → render-ferritin-carousel.mjs template
  // 6. fallback: error — pode existir brief mas sem renderer matching

  if (meta.pattern === "persona-bio-case-study" || meta.slot_type === "persona-bio") {
    // persona-carousel needs personas/<persona>.json
    const personaJson = path.join(ROOT, "personas", `${meta.persona}.json`);
    if (!fs.existsSync(personaJson)) {
      return { ok: false, reason: `persona JSON missing: ${personaJson}. Create it first.` };
    }
    return { ok: true, script: "scripts/render-persona-carousel.mjs", args: ["--persona", meta.persona, "--run", meta.runId] };
  }

  if (meta.format === "reel") {
    return { ok: true, script: "scripts/render-reel-tips.mjs", args: [] };
  }

  if (meta.pattern === "dado-punch-bryan-style" || meta.format === "image") {
    return { ok: false, reason: "dado-punch template generic ainda não construído. Use scripts/render-vitd-brasil.mjs como base — duplica + adapta." };
  }

  if (meta.pattern === "brand-manifesto" || meta.slot_type === "premium-manifesto") {
    return { ok: false, reason: "brand-manifesto template generic ainda não construído. Use scripts/render-jockey-carousel.mjs como base." };
  }

  if (meta.pattern === "biomarker-gap") {
    return { ok: false, reason: "biomarker-gap template generic ainda não construído. Use scripts/render-ferritin-carousel.mjs como base." };
  }

  return { ok: false, reason: `Sem rota pra meta: ${JSON.stringify(meta)}` };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const args = parseArgs();
const meta = readMeta(args.run);
meta.runId = args.run;

console.log(`\n🛠 Generator · ${args.run}\n`);
console.log(`  meta: ${JSON.stringify(meta)}`);

const route = routeToRenderer(meta);
if (!route.ok) {
  console.error(`\n✗ Cannot route: ${route.reason}\n`);
  process.exit(1);
}

console.log(`  → ${route.script} ${route.args.join(" ")}`);

if (args.dryRun) {
  console.log(`\n[DRY-RUN] Skipped execution.\n`);
  process.exit(0);
}

try {
  execSync(`node ${path.join(ROOT, route.script)} ${route.args.join(" ")}`, { cwd: ROOT, stdio: "inherit" });
  console.log(`\n✓ Render complete.\n`);
} catch (e) {
  console.error(`\n✗ Render failed: ${e.message}\n`);
  process.exit(1);
}
