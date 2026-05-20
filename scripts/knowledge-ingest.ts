/**
 * knowledge-ingest.ts — Phase 5 Internal Knowledge Graph (ingest layer)
 *
 * Processa "second brain" do user (notas, voice memos, brain dumps) e alimenta
 * stores/inbox.md com entries estruturados pra Idea Gate.
 *
 * Suporta:
 *   - Markdown / texto (.md, .txt) → classifica direto via Claude
 *   - Áudio (.m4a, .mp3, .wav, .ogg) → transcreve via OpenAI Whisper → classifica
 *
 * Fluxo por arquivo:
 *   1. Detecta tipo (texto ou áudio)
 *   2. Se áudio: Whisper transcreve → salva .transcript.md
 *   3. Claude classifica: vale a pena? qual pilar? rota? insight extraído?
 *   4. Se vale a pena: append em foundation/stores/inbox.md
 *   5. Move arquivo pra internal-inputs/processed/ (idempotência)
 *
 * Uso:
 *   pnpm knowledge-ingest                       # processa tudo em internal-inputs/
 *   pnpm knowledge-ingest --file <path>          # 1 arquivo específico (mesmo se já processado)
 *   pnpm knowledge-ingest --dir <path>           # outra pasta
 *   pnpm knowledge-ingest --dry-run              # mostra plano sem chamadas API
 *   pnpm knowledge-ingest --model sonnet         # default sonnet (mais barato pra triagem)
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DEFAULT_INPUT_DIR = path.join(ROOT, "internal-inputs");

const MODELS = {
  opus: "claude-opus-4-7",
  sonnet: "claude-sonnet-4-7",
} as const;

const AUDIO_EXTS = new Set([".m4a", ".mp3", ".wav", ".ogg", ".mp4", ".webm"]);
const TEXT_EXTS = new Set([".md", ".txt"]);

interface Args {
  file?: string;
  dir: string;
  model: keyof typeof MODELS;
  dryRun: boolean;
  verbose: boolean;
  force: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Partial<Args> = { dir: DEFAULT_INPUT_DIR, model: "sonnet", dryRun: false, verbose: false, force: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--file") out.file = args[++i];
    else if (arg === "--dir") out.dir = args[++i];
    else if (arg === "--model") out.model = args[++i] as keyof typeof MODELS;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--verbose" || arg === "-v") out.verbose = true;
    else if (arg === "--force") out.force = true;
  }
  return out as Args;
}

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function read(p: string): string {
  if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
  return fs.readFileSync(p, "utf-8");
}

// ────────────────────────────────────────────────────────────────────────────
// WHISPER TRANSCRIPTION
// ────────────────────────────────────────────────────────────────────────────

async function transcribeAudio(filePath: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set (needed for Whisper)");
  const buffer = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)]), path.basename(filePath));
  form.append("model", "whisper-1");
  form.append("response_format", "text");
  form.append("language", "pt"); // Longevify content is in PT-BR

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Whisper error ${res.status}: ${text}`);
  }
  return await res.text();
}

// ────────────────────────────────────────────────────────────────────────────
// CLAUDE CLASSIFIER
// ────────────────────────────────────────────────────────────────────────────

function loadFoundationForClassifier(): string {
  const f = path.join(ROOT, "foundation");
  const parts = [
    read(path.join(f, "strategy.md")),
    read(path.join(f, "pillars.md")),
    read(path.join(f, "voice.md")),
    read(path.join(ROOT, "idea-gate.md")),
  ];
  return parts.join("\n\n---\n\n");
}

function buildClassifierSystemPrompt(foundation: string): string {
  return `You are the Longevify Knowledge Graph classifier.

You receive raw text from the user's second brain — notes, voice memo transcripts, observations, journal entries, brain dumps. Your job: decide whether it's worth turning into a content seed, and if so, structure it for the inbox.

# Rules

1. **High bar.** Most brain dumps are noise. Be skeptical. Only promote insights that genuinely connect to a pilar + have a hook angle + match ICP.
2. **Multiple insights per file.** A single voice memo can contain 0, 1, or many insights. Extract each separately.
3. **Route guess.** Based on the content, suggest: ORIGINAL (no external source), REPURPOSE (extends past Longevify content), RESEARCH (needs more study before posting).
4. **Pilar fit.** Match to 1 or 2 of the 6 pilares. If it doesn't fit any, mark as not worth keeping.
5. **Anti-slop check.** If the insight is generic health-tech wisdom or self-help-ish, reject.
6. **Output: JSON only.** Strict schema. No markdown fences.

# Output schema

\`\`\`
{
  "worth_keeping": <boolean>,
  "reason": "1-sentence reason (kept or rejected)",
  "insights": [
    {
      "type": "hook" | "observation" | "data" | "story" | "dor_articulada",
      "summary": "1-2 sentence summary",
      "raw_quote": "exact text from source if relevant",
      "pillar_fit": [<int>, ...],
      "route_suggestion": "ORIGINAL" | "REPURPOSE" | "RESEARCH",
      "hook_quality_score": <1-10>,
      "priority": "alta" | "média" | "baixa",
      "inbox_entry_md": "[YYYY-MM-DD] [brain-dump] [insight] — <1-line description with pilar tag>"
    }
  ]
}
\`\`\`

# Foundation (canonical reference)

${foundation}`;
}

interface ClassifierOutput {
  worth_keeping: boolean;
  reason: string;
  insights: Array<{
    type: string;
    summary: string;
    raw_quote: string;
    pillar_fit: number[];
    route_suggestion: string;
    hook_quality_score: number;
    priority: string;
    inbox_entry_md: string;
  }>;
}

async function classify(content: string, sourceName: string, args: Args): Promise<ClassifierOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const anthropic = new Anthropic({ apiKey });

  const foundation = loadFoundationForClassifier();
  const system = buildClassifierSystemPrompt(foundation);
  const user = `# Source: ${sourceName}

\`\`\`
${content}
\`\`\`

Classify and structure. Return JSON only.`;

  const model = MODELS[args.model];
  if (args.verbose) console.log(`  classifier: ${system.length} chars system, ${user.length} chars user`);

  const response = await anthropic.messages.create({
    model,
    max_tokens: 2048,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
  });

  const usage = response.usage;
  if (args.verbose) {
    console.log(
      `  tokens — input: ${usage.input_tokens}` +
        (usage.cache_creation_input_tokens != null ? ` (cache write: ${usage.cache_creation_input_tokens})` : "") +
        (usage.cache_read_input_tokens != null ? ` (cache read: ${usage.cache_read_input_tokens})` : "") +
        ` · output: ${usage.output_tokens}`
    );
  }

  const block = response.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type");
  let text = block.text.trim();
  if (text.startsWith("```")) text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("Invalid JSON from classifier:\n", text);
    throw new Error("Classifier returned invalid JSON");
  }
}

// ────────────────────────────────────────────────────────────────────────────
// INBOX APPEND
// ────────────────────────────────────────────────────────────────────────────

function appendToInbox(entries: string[]) {
  const inboxPath = path.join(ROOT, "foundation/stores/inbox.md");
  const existing = fs.existsSync(inboxPath) ? fs.readFileSync(inboxPath, "utf-8") : "";
  const newBlock = entries.join("\n");
  // Append before "## Entries" if exists, else append
  let updated: string;
  if (existing.includes("## Entries")) {
    updated = existing.replace("## Entries\n", `## Entries\n\n${newBlock}\n`);
    // Remove placeholder if present
    updated = updated.replace(/^>\s*Vazio até primeiro scrape ou brain dump\.\s*$/m, "");
  } else {
    updated = existing.trimEnd() + "\n\n" + newBlock + "\n";
  }
  fs.writeFileSync(inboxPath, updated);
}

// ────────────────────────────────────────────────────────────────────────────
// FILE PROCESSING
// ────────────────────────────────────────────────────────────────────────────

interface ProcessResult {
  file: string;
  type: "text" | "audio";
  classification: ClassifierOutput;
  inboxEntries: string[];
  errored?: string;
}

function fileHash(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex").substring(0, 16);
}

async function processFile(filePath: string, args: Args): Promise<ProcessResult> {
  const ext = path.extname(filePath).toLowerCase();
  const isAudio = AUDIO_EXTS.has(ext);
  const isText = TEXT_EXTS.has(ext);
  if (!isAudio && !isText) throw new Error(`Unsupported file type: ${ext}`);

  console.log(`\n▶ ${path.relative(ROOT, filePath)} (${isAudio ? "audio" : "text"})`);

  let content: string;
  if (isAudio) {
    const transcriptPath = filePath.replace(ext, ".transcript.md");
    if (fs.existsSync(transcriptPath)) {
      console.log(`  ✓ using cached transcript: ${path.relative(ROOT, transcriptPath)}`);
      content = read(transcriptPath);
    } else {
      if (args.dryRun) {
        console.log(`  [dry-run] would transcribe via Whisper`);
        return { file: filePath, type: "audio", classification: { worth_keeping: false, reason: "dry-run", insights: [] }, inboxEntries: [] };
      }
      console.log(`  → transcribing via Whisper...`);
      const t0 = Date.now();
      content = await transcribeAudio(filePath);
      console.log(`  ✓ transcribed in ${((Date.now() - t0) / 1000).toFixed(1)}s (${content.length} chars)`);
      fs.writeFileSync(transcriptPath, `# Transcript — ${path.basename(filePath)}\n\n${content}\n`);
      console.log(`  ✓ saved transcript: ${path.relative(ROOT, transcriptPath)}`);
    }
  } else {
    content = read(filePath);
  }

  if (args.dryRun) {
    console.log(`  [dry-run] would classify ${content.length} chars`);
    return { file: filePath, type: isAudio ? "audio" : "text", classification: { worth_keeping: false, reason: "dry-run", insights: [] }, inboxEntries: [] };
  }

  console.log(`  → classifying via ${MODELS[args.model]}...`);
  const t0 = Date.now();
  const classification = await classify(content, path.basename(filePath), args);
  console.log(`  ✓ classified in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  worth_keeping: ${classification.worth_keeping} — ${classification.reason}`);
  if (classification.worth_keeping) {
    console.log(`  insights: ${classification.insights.length}`);
    classification.insights.forEach((ins, i) => {
      console.log(`    [${i + 1}] ${ins.type} · pilar ${ins.pillar_fit.join(",")} · ${ins.route_suggestion} · hook ${ins.hook_quality_score}/10 · prio ${ins.priority}`);
    });
  }

  const inboxEntries = classification.worth_keeping
    ? classification.insights.map((i) => i.inbox_entry_md.trim())
    : [];

  // Save classification JSON for traceability
  const classifsDir = path.join(args.dir, "processed", ".classifications");
  ensureDir(classifsDir);
  const classifPath = path.join(classifsDir, path.basename(filePath) + ".json");
  fs.writeFileSync(classifPath, JSON.stringify({ source: filePath, hash: fileHash(filePath), classification }, null, 2));

  return { file: filePath, type: isAudio ? "audio" : "text", classification, inboxEntries };
}

function markProcessed(filePath: string, args: Args) {
  if (args.dryRun) return;
  const processedDir = path.join(args.dir, "processed");
  ensureDir(processedDir);
  const dest = path.join(processedDir, path.basename(filePath));
  fs.renameSync(filePath, dest);
  // Move transcript if exists
  const ext = path.extname(filePath).toLowerCase();
  if (AUDIO_EXTS.has(ext)) {
    const transcriptPath = filePath.replace(ext, ".transcript.md");
    if (fs.existsSync(transcriptPath)) {
      fs.renameSync(transcriptPath, path.join(processedDir, path.basename(transcriptPath)));
    }
  }
}

function getInputFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.join(dir, e.name))
    .filter((p) => {
      const ext = path.extname(p).toLowerCase();
      return (AUDIO_EXTS.has(ext) || TEXT_EXTS.has(ext)) && !p.endsWith(".transcript.md");
    });
}

async function main() {
  const args = parseArgs();
  ensureDir(args.dir);
  ensureDir(path.join(args.dir, "processed"));

  let files: string[];
  if (args.file) {
    files = [path.resolve(args.file)];
  } else {
    files = getInputFiles(args.dir);
  }

  if (files.length === 0) {
    console.log(`No files to process in ${args.dir}.`);
    console.log(`Drop .md/.txt (notes) or .m4a/.mp3/.wav (voice memos) into ${path.relative(ROOT, args.dir)}/`);
    return;
  }

  console.log(`Knowledge Ingest — ${files.length} file(s) found`);
  const allEntries: string[] = [];
  const summary: ProcessResult[] = [];

  for (const file of files) {
    try {
      const result = await processFile(file, args);
      summary.push(result);
      allEntries.push(...result.inboxEntries);
      if (!args.dryRun) markProcessed(file, args);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${msg}`);
      summary.push({ file, type: "text", classification: { worth_keeping: false, reason: msg, insights: [] }, inboxEntries: [], errored: msg });
    }
  }

  if (allEntries.length > 0 && !args.dryRun) {
    appendToInbox(allEntries);
    console.log(`\n✓ Appended ${allEntries.length} entry(ies) to foundation/stores/inbox.md`);
  }

  console.log(`\n=== Summary ===`);
  let kept = 0;
  let dropped = 0;
  let errored = 0;
  for (const r of summary) {
    if (r.errored) errored++;
    else if (r.classification.worth_keeping) kept++;
    else dropped++;
  }
  console.log(`  ${kept} kept · ${dropped} dropped · ${errored} errored`);
  console.log(`  total insights extracted: ${allEntries.length}`);
}

main().catch((err) => {
  console.error("✗ Knowledge ingest error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
