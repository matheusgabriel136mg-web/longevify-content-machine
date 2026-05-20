/**
 * visual-gen.ts — Phase 2.5 Visual Generator
 *
 * Lê draft-package.md de uma run, chama Claude pra produzir prompts Higgsfield
 * estruturados (1 por slide/asset), dispara jobs em paralelo via higgsfield CLI,
 * baixa outputs pra runs/<id>/assets/, atualiza state.
 *
 * Uso:
 *   pnpm visual-gen --run 2026-05-10-001-ferritina-corredora
 *   pnpm visual-gen --run <id> --dry-run        # gera prompts mas não chama Higgsfield
 *   pnpm visual-gen --run <id> --model sonnet   # default opus
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import { execSync, spawn } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const MODELS = {
  opus: "claude-opus-4-7",
  sonnet: "claude-sonnet-4-7",
} as const;

interface Args {
  run: string;
  model: keyof typeof MODELS;
  dryRun: boolean;
  verbose: boolean;
}

interface VisualJob {
  slot: string;            // "slide-1", "slide-2", "cover", "reel"...
  model: string;           // higgsfield model name (nano_banana_2, gpt_image_2, kling3_0, etc.)
  prompt: string;
  aspect_ratio: string;    // "4:5", "9:16", etc.
  resolution?: string;     // "1k" | "2k" | "4k"
  duration?: number;       // for video models
  mode?: string;           // pro | std for kling
  start_image?: string;    // path for video/image-to-image
  notes?: string;          // optional human-readable notes
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Partial<Args> = { model: "opus", dryRun: false, verbose: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--run") out.run = args[++i];
    else if (arg === "--model") out.model = args[++i] as keyof typeof MODELS;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--verbose" || arg === "-v") out.verbose = true;
  }
  if (!out.run) {
    console.error("Usage: pnpm visual-gen --run <run-id> [--model opus|sonnet] [--dry-run] [-v]");
    process.exit(1);
  }
  return out as Args;
}

function read(filePath: string): string {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  return fs.readFileSync(filePath, "utf-8");
}

const HIGGSFIELD_CATALOG = `
# Higgsfield models catalog

## Image models

### nano_banana_2 (Nano Banana Pro)
- type: image
- strengths: text overlay (especially PT-BR), premium editorial composition, glassmorphism, scientific aesthetic
- aspect_ratios: 1:1, 3:2, 2:3, 4:3, 3:4, 4:5, 5:4, 9:16, 16:9, 21:9
- resolutions: 1k, 2k, 4k
- cost: ~$0.40-0.50 per image
- best for: carousel slides with text, infographic-style, biomarker visuals, hero pieces with copy
- supports start_image for image-to-image edit

### gpt_image_2 (GPT Image 2)
- type: image
- strengths: photorealistic portraits, complex compositions, aesthetic mood pieces, environmental scenes
- aspect_ratios: 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3
- resolutions: 1k, 2k, 4k
- cost: ~$0.50-1.00 per image
- best for: portrait base, lifestyle scenes, aesthetic Pilar 1.2 hero pieces, athletic stills

### flux_kontext (Flux Kontext)
- type: image
- strengths: photorealistic, fast, image-to-image edits with semantic context
- aspect_ratios: 1:1, 16:9, 9:16, 4:3, 3:4
- cost: ~$0.10-0.20 per image
- best for: quick photoreal generation, photo edits

## Video models

### kling3_0 (Kling v3)
- type: video
- strengths: image-to-video with smooth motion, abstract animation, character motion
- aspect_ratios: 16:9, 9:16, 1:1
- duration: 5 (integer)
- mode: pro | std
- cost: ~$2-3 per 5s clip (pro mode)
- best for: reel motion from start-frame, abstract atmosphere

### veo3_1_lite (Google Veo 3.1 Lite)
- type: video
- strengths: cinematic motion, human action
- aspect_ratios: 16:9, 9:16
- duration: 4 | 6 | 8
- cost: ~$1-2 per clip
- best for: reels with action, scenes
`;

function buildSystemPrompt(): string {
  return `You are the Longevify Visual Generator.

Your job: take a draft-package.md (the Writer's output) and produce a JSON array of Higgsfield jobs that will materialize the visual brief into actual asset files.

# Rules of engagement

1. **Visual brief is law.** Every prompt you produce must honor the paleta, tipografia, logo position, anti-visuais declared in the Visual brief section of the draft.
2. **Per-slot prompts.** For carousels, one job per slide. For reels, one job for start-frame + one motion prompt. For single posts/stories, one job.
3. **Model selection.** Match model to slot need:
   - Slides with text overlay → nano_banana_2 (handles PT-BR text well)
   - Pure aesthetic hero pieces → gpt_image_2 (photorealistic) or nano_banana_2 (with light text)
   - Motion required → kling3_0 (image-to-video, needs start_image) or veo3_1_lite (text-to-video)
4. **Logo handling.** The Longevify wordmark logo is at:
   \`assets/logos/longevify-horizontal-white.png\` (98KB, white wordmark, transparent bg)
   For static images: prompt the model to RESERVE space at the position specified (e.g. "bottom-center, 80px from edge"). Logo overlay is added by a post-process step (ffmpeg/PIL) — DO NOT prompt the model to generate the logo glyph itself.
5. **Anti-visuais are absolute.** If draft brief lists "no tubo de ensaio azul", include "ABSOLUTELY NO test tubes" in the prompt's negative section.
6. **Paleta hex codes** go literally into the prompt.
7. **Typography specs** (DM Sans peso X) go literally into the prompt for text rendering models.

# Higgsfield models reference

${HIGGSFIELD_CATALOG}

# Output structure

Return ONLY a valid JSON array. No markdown fences, no preamble.

Schema per job:
\`\`\`
{
  "slot": "slide-1" | "slide-2" | ... | "cover" | "reel-start" | "reel-motion",
  "model": "nano_banana_2" | "gpt_image_2" | "flux_kontext" | "kling3_0" | "veo3_1_lite",
  "prompt": "Full Higgsfield prompt with composition, paleta hex, typography, anti-visuais",
  "aspect_ratio": "4:5" | "9:16" | "1:1" | etc.,
  "resolution": "2k",        // for image models
  "duration": 5,             // for video models
  "mode": "pro",             // for kling
  "start_image": "...",      // optional path for video/img-to-img
  "notes": "optional human note about this slot"
}
\`\`\`

Critical: output VALID JSON. Test in your head before responding.`;
}

function buildUserPrompt(draftContent: string, contentObject: string): string {
  return `# Run context

## content-object.md
\`\`\`
${contentObject}
\`\`\`

## draft-package.md (Writer output)
\`\`\`
${draftContent}
\`\`\`

# Task
Produce the JSON array of Higgsfield jobs for this run. Return ONLY valid JSON.`;
}

async function generatePrompts(args: Args): Promise<VisualJob[]> {
  const runDir = path.join(ROOT, "runs", args.run);
  const draftContent = read(path.join(runDir, "draft-package.md"));
  const contentObject = read(path.join(runDir, "content-object.md"));

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const anthropic = new Anthropic({ apiKey });

  const system = buildSystemPrompt();
  const user = buildUserPrompt(draftContent, contentObject);
  const model = MODELS[args.model];

  if (args.verbose) {
    console.log(`System prompt: ${system.length} chars`);
    console.log(`User prompt: ${user.length} chars`);
  }

  console.log(`→ Building visual prompts via ${model}...`);
  const t0 = Date.now();
  const response = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
  });
  const ms = Date.now() - t0;
  console.log(`✓ Prompts generated in ${(ms / 1000).toFixed(1)}s`);
  console.log(
    `  tokens — input: ${response.usage.input_tokens}` +
      (response.usage.cache_creation_input_tokens != null
        ? ` (cache write: ${response.usage.cache_creation_input_tokens})`
        : "") +
      (response.usage.cache_read_input_tokens != null
        ? ` (cache read: ${response.usage.cache_read_input_tokens})`
        : "") +
      ` · output: ${response.usage.output_tokens}`
  );

  const block = response.content[0];
  if (block.type !== "text") throw new Error(`Unexpected response: ${block.type}`);
  let text = block.text.trim();
  // Strip markdown fence if present
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  let jobs: VisualJob[];
  try {
    jobs = JSON.parse(text);
  } catch (e) {
    console.error("Failed to parse JSON. Raw response:");
    console.error(text);
    throw new Error("Invalid JSON from Claude");
  }
  if (!Array.isArray(jobs)) throw new Error("Response not an array");
  console.log(`  → ${jobs.length} job(s) planned`);
  return jobs;
}

function buildHiggsfieldCommand(job: VisualJob, runDir: string): string[] {
  const parts: string[] = ["generate", "create", job.model];
  parts.push("--prompt", job.prompt);
  parts.push("--aspect_ratio", job.aspect_ratio);
  if (job.resolution) parts.push("--resolution", job.resolution);
  if (job.duration != null) parts.push("--duration", String(job.duration));
  if (job.mode) parts.push("--mode", job.mode);
  if (job.start_image) {
    const imgPath = path.isAbsolute(job.start_image)
      ? job.start_image
      : path.join(ROOT, job.start_image);
    parts.push("--start-image", imgPath);
  }
  parts.push("--sound", "off"); // for videos; ignored for images
  parts.push("--wait");
  return parts;
}

function runHiggsfield(job: VisualJob, runDir: string, logPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = buildHiggsfieldCommand(job, runDir);
    // Strip --sound off for image models
    const isVideo = job.model === "kling3_0" || job.model.startsWith("veo3");
    const finalArgs = isVideo
      ? args
      : args.filter((a, i, arr) => a !== "--sound" && arr[i - 1] !== "--sound");
    const log = fs.createWriteStream(logPath);
    const proc = spawn("higgsfield", finalArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    proc.stdout.on("data", (d) => {
      const s = d.toString();
      output += s;
      log.write(s);
    });
    proc.stderr.on("data", (d) => log.write(d));
    proc.on("close", (code) => {
      log.end();
      if (code === 0) {
        // Last non-empty line is the URL
        const lines = output.trim().split("\n").filter((l) => l.startsWith("http"));
        if (lines.length === 0) {
          reject(new Error(`No URL in output. Log: ${logPath}`));
        } else {
          resolve(lines[lines.length - 1]);
        }
      } else {
        reject(new Error(`higgsfield exited ${code}. Log: ${logPath}`));
      }
    });
  });
}

async function downloadUrl(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("curl", ["-sSL", "-o", dest, url]);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`curl exited ${code}`));
    });
  });
}

async function executeJobs(jobs: VisualJob[], runDir: string): Promise<void> {
  const assetsDir = path.join(runDir, "assets");
  const logsDir = path.join(runDir, "visual-logs");
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });

  console.log(`\n→ Dispatching ${jobs.length} Higgsfield job(s) in parallel...`);
  const results = await Promise.allSettled(
    jobs.map(async (job, idx) => {
      const logPath = path.join(logsDir, `${job.slot}.log`);
      const t0 = Date.now();
      console.log(`  [${idx + 1}/${jobs.length}] ${job.slot} (${job.model}) → starting`);
      const url = await runHiggsfield(job, runDir, logPath);
      const ms = Date.now() - t0;
      console.log(`  [${idx + 1}/${jobs.length}] ${job.slot} → completed in ${(ms / 1000).toFixed(0)}s`);
      // Download
      const ext = job.model === "kling3_0" || job.model.startsWith("veo3") ? "mp4" : "png";
      const dest = path.join(assetsDir, `${job.slot}.${ext}`);
      await downloadUrl(url, dest);
      console.log(`  [${idx + 1}/${jobs.length}] ${job.slot} → saved ${path.relative(ROOT, dest)}`);
      return { slot: job.slot, url, dest };
    })
  );

  console.log(`\n=== Results ===`);
  let okCount = 0;
  let failCount = 0;
  for (const r of results) {
    if (r.status === "fulfilled") {
      okCount++;
      console.log(`  ✓ ${r.value.slot} → ${path.relative(ROOT, r.value.dest)}`);
    } else {
      failCount++;
      console.error(`  ✗ ${r.reason.message}`);
    }
  }
  console.log(`\n${okCount} succeeded · ${failCount} failed`);
  if (failCount > 0) process.exit(1);
}

function updateContentObjectState(runDir: string, jobs: VisualJob[]) {
  const filePath = path.join(runDir, "content-object.md");
  let content = fs.readFileSync(filePath, "utf-8");
  const today = new Date().toISOString().slice(0, 10);
  content = content
    .replace(/^state: .*$/m, "state: visuals-generated")
    .replace(/^updated_at: .*$/m, `updated_at: ${today}`)
    .replace(/^next_action: .*$/m, "next_action: verify");
  // Append state log
  if (content.includes("## State log")) {
    const slots = jobs.map((j) => j.slot).join(", ");
    content = content.replace(
      "## State log",
      `## State log\n- ${today}: visuals generated (${slots})`
    );
  }
  fs.writeFileSync(filePath, content);
}

async function main() {
  const args = parseArgs();
  const runDir = path.join(ROOT, "runs", args.run);
  if (!fs.existsSync(runDir)) {
    console.error(`Run not found: ${runDir}`);
    process.exit(1);
  }

  try {
    const jobs = await generatePrompts(args);

    // Save jobs JSON for reproducibility / debugging
    const jobsPath = path.join(runDir, "visual-jobs.json");
    fs.writeFileSync(jobsPath, JSON.stringify(jobs, null, 2));
    console.log(`  jobs saved → ${path.relative(ROOT, jobsPath)}`);

    if (args.dryRun) {
      console.log("\n--dry-run mode: skipping Higgsfield calls. Inspect visual-jobs.json.");
      return;
    }

    await executeJobs(jobs, runDir);
    updateContentObjectState(runDir, jobs);
    console.log(`\n✓ Done. Assets in runs/${args.run}/assets/`);
  } catch (err) {
    console.error("✗ Error:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
