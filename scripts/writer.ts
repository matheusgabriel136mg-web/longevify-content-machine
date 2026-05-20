/**
 * writer.ts — Phase 2 Writer (Claude API)
 *
 * Lê brief.md + idea.md + content-object.md de uma run
 * Carrega Foundation completa como system prompt (com prompt caching)
 * Chama Claude API (Opus 4.7) e produz draft-package.md
 *
 * Uso:
 *   pnpm writer --run 2026-05-12-001-cortisol-atleta-br
 *   pnpm writer --run <id> --model sonnet     # default opus
 *   pnpm writer --run <id> --no-cache         # debug, força sem cache
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const MODELS = {
  opus: "claude-opus-4-7",
  sonnet: "claude-sonnet-4-6",
} as const;

interface Args {
  run: string;
  model: keyof typeof MODELS;
  noCache: boolean;
  verbose: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Partial<Args> = { model: "opus", noCache: false, verbose: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--run") out.run = args[++i];
    else if (arg === "--model") out.model = args[++i] as keyof typeof MODELS;
    else if (arg === "--no-cache") out.noCache = true;
    else if (arg === "--verbose" || arg === "-v") out.verbose = true;
  }
  if (!out.run) {
    console.error("Usage: pnpm writer --run <run-id> [--model opus|sonnet] [--no-cache] [-v]");
    process.exit(1);
  }
  if (!MODELS[out.model!]) {
    console.error(`Unknown model: ${out.model}. Use opus or sonnet.`);
    process.exit(1);
  }
  return out as Args;
}

function read(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf-8");
}

function loadFoundation(): string {
  const f = path.join(ROOT, "foundation");
  const sections = [
    { title: "Strategy", file: "strategy.md" },
    { title: "Voice", file: "voice.md" },
    { title: "Pillars", file: "pillars.md" },
    { title: "Master Avoid-Slop", file: "master-avoid-slop.md" },
    { title: "Source Watchlist", file: "source-watchlist.md" },
  ];
  const ideaGate = read(path.join(ROOT, "idea-gate.md"));
  const parts = sections.map((s) => `## ${s.title}\n\n${read(path.join(f, s.file))}`);
  parts.push(`## Idea Gate\n\n${ideaGate}`);

  // BRAND_DEFAULTS — opinionated decisions, override "A ou B?"
  const defaultsPath = path.join(ROOT, "BRAND_DEFAULTS.md");
  if (fs.existsSync(defaultsPath)) {
    parts.push(`## Brand Defaults (decisões opinativas — NÃO PERGUNTE, USE)\n\n${fs.readFileSync(defaultsPath, "utf-8")}`);
  }

  return `# LONGEVIFY FOUNDATION (canonical)\n\n${parts.join("\n\n---\n\n")}`;
}

function loadRunContext(runId: string): {
  contentObject: string;
  idea: string;
  brief: string;
  runDir: string;
} {
  const runDir = path.join(ROOT, "runs", runId);
  if (!fs.existsSync(runDir)) {
    throw new Error(`Run not found: ${runDir}. Run pnpm new-run first.`);
  }
  return {
    runDir,
    contentObject: read(path.join(runDir, "content-object.md")),
    idea: read(path.join(runDir, "idea.md")),
    brief: read(path.join(runDir, "brief.md")),
  };
}

function buildSystemPrompt(foundation: string): string {
  return `You are the Longevify Writer.

Your job: take a brief + idea (within a specific run), produce a draft-package.md following the Foundation strictly.

# Rules of engagement

1. **Foundation is law.** Every word you write must align with strategy, voice (SP × Mito base + Aesop/Equinox layers), pillars, and master avoid-slop.
2. **Refuse violations.** If the brief implies a master-avoid-slop violation, flag the issue and STOP. Don't fake the draft.
3. **Write in PT-BR.** Native, sotaque brasileiro, sem inglesismos exceto termos científicos consagrados.
4. **Self-rubric.** Before submitting, score your draft against the voice.md rubric (0-12 across 4 dimensions). Include the rubric output in your response. Target ≥ 9. If you score < 9, mark status as "revise" with specific issues to fix in a v2 pass.
5. **Format strictly.** Output ONLY valid markdown matching the draft-package.md template structure — frontmatter + sections. No preamble, no apologies, no commentary outside the markdown.

# Output structure (must match exactly)

\`\`\`
---
content_object: <id from brief>
draft_id: v1
status: pending_verify | revise
revisions: 0
verifier_score: <your self-score N/12>
---

# Draft — <title>

## Final copy

### Headline
<...>

### Subhead (if applicable)
<...>

### Body / slides
<full text — for carousel, label slides; for reel, scene-by-scene with timing>

### CTA
<final CTA, convite-inteligente>

### Caption (for IG, separate from visual)
<caption text>

### Hashtags / mentions (sparingly, optional)
<#tag — only if they serve a purpose>

## Visual brief
- Aspect: <9:16 | 4:5 | 1:1>
- Modo voice principal: <Superpower | Mito> + Camada: <Aesop | Equinox | none>
- Paleta sugerida: <hex codes baseados em voice.md>
- Tipografia: <DM Sans peso X, etc.>
- Logo position: <bottom center | canto inferior direito>
- Reference: <path/URL se aplicável>
- Anti-visuais: <específicos deste post>

## Self-rubric

### Scoring
- Pillar alignment (0-3): N — <reason>
- Voice alignment (0-3): N — <reason>
- Avoid-slop pass (0-3): N — <violations found if any>
- Hook strength (0-3): N — <reason>

**Total: N/12**

### Verdict
- ≥ 9: pending_verify → ready for external verifier
- 6-8: revise → list specific issues to fix
- < 6: would be reject — refuse to produce

### Revision notes (only if revise)
- <what to fix>
\`\`\`

# Foundation (canonical reference — load fully into your reasoning)

${foundation}`;
}

function buildUserPrompt(ctx: { contentObject: string; idea: string; brief: string }): string {
  return `# Run context

## content-object.md
\`\`\`
${ctx.contentObject}
\`\`\`

## idea.md
\`\`\`
${ctx.idea}
\`\`\`

## brief.md
\`\`\`
${ctx.brief}
\`\`\`

# Task
Generate the complete draft-package.md content following the system rules. Return ONLY the markdown (frontmatter + sections), nothing else.`;
}

async function generateDraft(args: Args): Promise<string> {
  const foundation = loadFoundation();
  const ctx = loadRunContext(args.run);
  const system = buildSystemPrompt(foundation);
  const user = buildUserPrompt(ctx);

  if (args.verbose) {
    console.log(`Foundation: ${foundation.length} chars`);
    console.log(`System prompt: ${system.length} chars`);
    console.log(`User prompt: ${user.length} chars`);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not set in env");
  }
  const anthropic = new Anthropic({ apiKey });

  const model = MODELS[args.model];
  console.log(`→ Calling ${model}${args.noCache ? " (no cache)" : " (with prompt caching)"}...`);
  const t0 = Date.now();

  const systemBlocks = args.noCache
    ? [{ type: "text" as const, text: system }]
    : [{ type: "text" as const, text: system, cache_control: { type: "ephemeral" as const } }];

  const response = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    system: systemBlocks,
    messages: [{ role: "user", content: user }],
  });

  const ms = Date.now() - t0;
  const usage = response.usage;
  console.log(`✓ Generated in ${(ms / 1000).toFixed(1)}s`);
  console.log(
    `  tokens — input: ${usage.input_tokens}` +
      (usage.cache_creation_input_tokens != null
        ? ` (cache write: ${usage.cache_creation_input_tokens})`
        : "") +
      (usage.cache_read_input_tokens != null
        ? ` (cache read: ${usage.cache_read_input_tokens})`
        : "") +
      ` · output: ${usage.output_tokens}`
  );

  const block = response.content[0];
  if (block.type !== "text") {
    throw new Error(`Unexpected response block type: ${block.type}`);
  }
  return block.text;
}

function saveDraft(runId: string, draft: string, runDir: string) {
  const draftPath = path.join(runDir, "draft-package.md");
  // Backup existing draft if present
  if (fs.existsSync(draftPath)) {
    const backupDir = path.join(runDir, "drafts");
    fs.mkdirSync(backupDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(draftPath, path.join(backupDir, `draft-${ts}.md`));
  }
  fs.writeFileSync(draftPath, draft);
  console.log(`✓ Saved ${path.relative(ROOT, draftPath)}`);
}

function updateContentObjectState(runDir: string) {
  const filePath = path.join(runDir, "content-object.md");
  let content = fs.readFileSync(filePath, "utf-8");
  const today = new Date().toISOString().slice(0, 10);
  content = content
    .replace(/^state: .*$/m, "state: draft")
    .replace(/^updated_at: .*$/m, `updated_at: ${today}`)
    .replace(/^next_action: .*$/m, "next_action: verify");
  fs.writeFileSync(filePath, content);
}

async function main() {
  const args = parseArgs();
  try {
    const draft = await generateDraft(args);
    const runDir = path.join(ROOT, "runs", args.run);
    saveDraft(args.run, draft, runDir);
    updateContentObjectState(runDir);
    console.log(`\n✓ Done. Open runs/${args.run}/draft-package.md to review.`);
  } catch (err) {
    console.error("✗ Error:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
