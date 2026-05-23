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
    // persona-carousel needs personas/<persona>-<runId>.json (run-specific) OR personas/<persona>.json (base)
    // 1) Check content-object for explicit persona_data_file pointer
    const coPath = path.join(ROOT, "runs", meta.runId, "content-object.md");
    let personaDataFile = null;
    if (fs.existsSync(coPath)) {
      const co = fs.readFileSync(coPath, "utf-8");
      const m = co.match(/^persona_data_file:\s*(\S+)/m);
      if (m) personaDataFile = m[1];
    }
    // 2) Fallback to persona base file
    const personaIdToUse = personaDataFile ? path.basename(personaDataFile, ".json") : meta.persona;
    const personaJsonPath = path.join(ROOT, personaDataFile || `personas/${meta.persona}.json`);

    if (!fs.existsSync(personaJsonPath)) {
      // ── AUTO-INVOKE content-generator ─────────────────────────────────
      return { ok: true, script: "scripts/agents/content-generator.mjs", args: ["--run", meta.runId], next_after: "self_retry" };
    }
    return { ok: true, script: "scripts/render-persona-carousel.mjs", args: ["--persona", personaIdToUse, "--run", meta.runId] };
  }

  // For non-persona templates, expect runs/<id>/render-data.json from content-generator
  const renderDataPath = path.join(ROOT, "runs", meta.runId, "render-data.json");

  if (meta.format === "reel" || meta.pattern === "reel-tips-hold-to-reveal") {
    if (!fs.existsSync(renderDataPath)) {
      return { ok: true, script: "scripts/agents/content-generator.mjs", args: ["--run", meta.runId], next_after: "self_retry" };
    }
    return { ok: true, script: "scripts/templates/reel-tips.mjs", args: ["--data", renderDataPath, "--run", meta.runId] };
  }

  if (meta.pattern === "dado-punch-bryan-style" || meta.format === "image" || meta.slot_type === "dado-punch") {
    if (!fs.existsSync(renderDataPath)) {
      return { ok: true, script: "scripts/agents/content-generator.mjs", args: ["--run", meta.runId], next_after: "self_retry" };
    }
    return { ok: true, script: "scripts/templates/dado-punch.mjs", args: ["--data", renderDataPath, "--run", meta.runId] };
  }

  if (meta.pattern === "brand-manifesto" || meta.slot_type === "premium-manifesto") {
    if (!fs.existsSync(renderDataPath)) {
      return { ok: true, script: "scripts/agents/content-generator.mjs", args: ["--run", meta.runId], next_after: "self_retry" };
    }
    return { ok: true, script: "scripts/templates/brand-manifesto.mjs", args: ["--data", renderDataPath, "--run", meta.runId] };
  }

  if (meta.pattern === "biomarker-gap") {
    if (!fs.existsSync(renderDataPath)) {
      return { ok: true, script: "scripts/agents/content-generator.mjs", args: ["--run", meta.runId], next_after: "self_retry" };
    }
    return { ok: true, script: "scripts/templates/biomarker-gap.mjs", args: ["--data", renderDataPath, "--run", meta.runId] };
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
  console.log(`\n✓ Step complete.\n`);

  // Auto-retry self if route requested it (e.g. content-generator → render)
  if (route.next_after === "self_retry") {
    console.log(`  ↻ Auto-retrying generator after content-generator finished...\n`);
    const meta2 = readMeta(args.run);
    meta2.runId = args.run;
    const route2 = routeToRenderer(meta2);
    if (route2.ok && route2.next_after !== "self_retry") {
      console.log(`  → ${route2.script} ${route2.args.join(" ")}`);
      execSync(`node ${path.join(ROOT, route2.script)} ${route2.args.join(" ")}`, { cwd: ROOT, stdio: "inherit" });
      console.log(`\n✓ Render complete.\n`);
    } else if (route2.next_after === "self_retry") {
      console.error(`\n✗ Infinite self-retry detected. Aborting.\n`);
      process.exit(1);
    } else {
      console.error(`\n✗ Cannot route on retry: ${route2.reason}\n`);
      process.exit(1);
    }
  }
} catch (e) {
  console.error(`\n✗ Step failed: ${e.message}\n`);
  process.exit(1);
}
