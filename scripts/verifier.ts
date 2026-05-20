/**
 * verifier.ts — Phase 4 Verifier
 *
 * Avalia um draft-package.md de forma INDEPENDENTE do writer:
 *   1. Programmatic scan — regex/heurística contra master-avoid-slop (banned phrases, em-dashes,
 *      exclamações, emojis banidos, CAPS, listicle markers)
 *   2. LLM rubric pass — Claude Sonnet (modelo diferente do writer Opus) com rubric 0-12 cega
 *      (não vê o self-score do writer)
 *   3. Aggregação — combina os 2 passes → verdict (approved | revise | reject)
 *   4. Comparação com writer self-score — flag se delta > 2 pontos
 *
 * Output: runs/<id>/verifier-report.md (frontmatter + body human-readable)
 *
 * Uso:
 *   pnpm verifier --run 2026-05-10-001-ferritina-corredora
 *   pnpm verifier --run <id> --model opus    # default sonnet (mais barato, judge independente)
 *   pnpm verifier --run <id> -v
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
  verbose: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Partial<Args> = { model: "sonnet", verbose: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--run") out.run = args[++i];
    else if (arg === "--model") out.model = args[++i] as keyof typeof MODELS;
    else if (arg === "--verbose" || arg === "-v") out.verbose = true;
  }
  if (!out.run) {
    console.error("Usage: pnpm verifier --run <run-id> [--model sonnet|opus] [-v]");
    process.exit(1);
  }
  return out as Args;
}

function read(filePath: string): string {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  return fs.readFileSync(filePath, "utf-8");
}

// ────────────────────────────────────────────────────────────────────────────
// PROGRAMMATIC SCANNER — espelho do master-avoid-slop.md (atualizar quando muda)
// ────────────────────────────────────────────────────────────────────────────

const BANNED_PHRASES = {
  grave: [
    // Promessa de cura, fear-mongering grave, atacar individual nominalmente
    "você pode ter (?:um |uma )?(?:doença|câncer|tumor|infarto|avc)",
    "prometemos cura",
    "vamos curar",
    "cura garantida",
  ],
  medium: [
    // Linguagem AI tells (§1)
    "no mundo agitado de hoje",
    "em um mundo cada vez mais",
    "no atual cenário",
    "na era da informação",
    "^atualmente,",
    "é inegável que",
    "vamos descobrir juntos",
    "embarque nessa jornada",
    "bem-vindo\\(a\\) ao",
    "bem-vindo ao",
    // Self-help / coaching (§2)
    "transforme sua vida",
    "desbloqueie sua melhor versão",
    "\\bcuide-se\\b",
    "\\bame-se\\b",
    "você merece (?:se cuidar|isso|ser feliz)",
    "empoderar",
    "jornada de autoconhecimento",
    // Startup-speak (§2)
    "game-changer",
    "\\binovador\\b(?!a)", // "inovador" mas não "inovadora" ou "inovadora "
    // Fear/urgency (§2)
    "última chance",
    "garanta já",
    "ofertas exclusivas",
    "por tempo limitado",
    "compre agora",
    // Empty motivational (§2)
    "a saúde é o maior tesouro",
    "prevenir é melhor que remediar",
    "movimento é vida",
    "você é o que come",
    "faça hoje o que outros não fazem",
    // Hooks proibidos (§5)
    "o segredo que ninguém te contou",
    "\\bPOV:\\B",
    "olha isso:",
    "^atenção:",
    "^spoiler:",
    "^real talk:",
    "^plot twist:",
    // Fechamentos banidos (§10)
    "para saber mais, acesse",
    "estamos juntos nessa jornada",
    "conte com a gente",
    "junte-se à revolução",
    "seja parte dessa transformação",
    "e aí, o que acharam",
    // Hooks suaves banidos
    "5 (?:dicas|coisas|maneiras|formas) (?:para|de)",
  ],
  light: [
    "salve este post",
    "comente aí embaixo",
    "salva pra ler depois",
    "manda pro grupo",
  ],
};

const BANNED_EMOJIS = ["✨", "🚀", "💪", "🔥", "💯", "🙌", "❤️‍🩹", "🧬", "📊", "📈", "📉"];

interface ScanResult {
  grave: string[];
  medium: string[];
  light: string[];
  metrics: {
    em_dash_max_per_paragraph: number;
    exclamations_in_body: number;
    banned_emojis_found: string[];
    caps_lock_lines: number;
  };
}

function programmaticScan(draftContent: string): ScanResult {
  // Separar frontmatter (não escaneia)
  const body = draftContent.replace(/^---\n[\s\S]*?\n---\n/, "");
  const lowerBody = body.toLowerCase();
  const result: ScanResult = {
    grave: [],
    medium: [],
    light: [],
    metrics: {
      em_dash_max_per_paragraph: 0,
      exclamations_in_body: 0,
      banned_emojis_found: [],
      caps_lock_lines: 0,
    },
  };

  // Phrase matching
  for (const phrase of BANNED_PHRASES.grave) {
    const re = new RegExp(phrase, "gi");
    if (re.test(lowerBody)) result.grave.push(phrase);
  }
  for (const phrase of BANNED_PHRASES.medium) {
    const re = new RegExp(phrase, "gi");
    if (re.test(lowerBody)) result.medium.push(phrase);
  }
  for (const phrase of BANNED_PHRASES.light) {
    const re = new RegExp(phrase, "gi");
    if (re.test(lowerBody)) result.light.push(phrase);
  }

  // Em-dash per paragraph
  const paragraphs = body.split(/\n\n+/);
  for (const para of paragraphs) {
    const dashes = (para.match(/—/g) || []).length;
    if (dashes > result.metrics.em_dash_max_per_paragraph) {
      result.metrics.em_dash_max_per_paragraph = dashes;
    }
  }
  if (result.metrics.em_dash_max_per_paragraph >= 3) {
    result.light.push(`Em-dash count: ${result.metrics.em_dash_max_per_paragraph} em 1 parágrafo (limite: 2)`);
  }

  // Exclamations in body (excluding caption — caption tolerates some informalidade)
  const bodyOnly = body.split(/### Caption|## Self-rubric/i)[0]; // só copy principal
  result.metrics.exclamations_in_body = (bodyOnly.match(/!/g) || []).length;
  if (result.metrics.exclamations_in_body > 0) {
    result.medium.push(`${result.metrics.exclamations_in_body} ponto(s) de exclamação em body copy editorial`);
  }

  // Banned emojis
  for (const emoji of BANNED_EMOJIS) {
    if (body.includes(emoji)) {
      result.metrics.banned_emojis_found.push(emoji);
      result.medium.push(`Emoji banido: ${emoji}`);
    }
  }

  // CAPS LOCK lines (>4 chars consecutivos em caps, excluindo acronyms conhecidos)
  const knownAcronyms = ["HRV", "ApoB", "VLDL", "LDL", "HDL", "HbA1c", "TSH", "T3", "T4",
    "PR", "CTA", "API", "AI", "SP", "BR", "EUA", "IG", "JSON", "URL", "PNG", "MP4", "SBC", "AHA"];
  const capsLines = body.split("\n").filter((line) => {
    const words = line.match(/\b[A-Z]{4,}\b/g) || [];
    return words.some((w) => !knownAcronyms.includes(w));
  });
  result.metrics.caps_lock_lines = capsLines.length;
  if (capsLines.length > 0) {
    result.light.push(`${capsLines.length} linha(s) com CAPS LOCK (use italics)`);
  }

  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// LLM RUBRIC PASS
// ────────────────────────────────────────────────────────────────────────────

function loadFoundationForVerifier(): string {
  const f = path.join(ROOT, "foundation");
  const parts = [
    read(path.join(f, "voice.md")),
    read(path.join(f, "pillars.md")),
    read(path.join(f, "master-avoid-slop.md")),
  ];
  return parts.join("\n\n---\n\n");
}

function buildVerifierSystemPrompt(foundation: string): string {
  return `You are the Longevify Verifier — INDEPENDENT judge of draft quality.

You receive a draft-package.md (Writer's output) and full Foundation. Your job: score it FRESH against the rubric. You see the writer's self-score in the draft frontmatter — IGNORE IT. Be skeptical. Apply the rubric rigorously.

# Rules

1. **Independent verdict.** Do not anchor to writer's self-score. Build your own from first principles.
2. **Skeptical lens.** The writer is incentivized to score 9+. Your job is to challenge that with rigor — find what the writer missed.
3. **Quote evidence.** When you flag a violation, quote the exact text from the draft.
4. **Differentiate severity.**
   - **Grave** (auto-reject): tom proibido, promessa de cura, fear-mongering, atacar médico nominalmente, alarmismo
   - **Medium** (each = -1 to score): vocabulário banido, hook proibido, anti-tema do pilar, AI tells
   - **Light** (each = -0.5): em-dash excess, emoji-de-mais, headline > 12 palavras, body slide > 50 palavras
5. **Output: JSON ONLY.** No markdown fences, no preamble. Strict schema below.

# Rubric (0-3 per item, total 0-12)

1. **Pillar alignment** — está claramente em 1 dos 6 pilares? Coerente com o framing/anti-temas do pilar declarado?
2. **Voice alignment** — soa como Longevify (SP×Mito base + Aesop/Equinox layers)? Ou genérico de health-tech?
3. **Avoid-slop pass** — passa pelo master-avoid-slop sem violações? (Comece de 3 e desconte por violation.)
4. **Hook strength** — primeira linha/visual segura por 2s? Tem stakes reais ou é genérico?

# Output schema (JSON only)

\`\`\`
{
  "score": {
    "pillar_alignment": <0-3>,
    "voice_alignment": <0-3>,
    "avoid_slop_pass": <0-3>,
    "hook_strength": <0-3>,
    "total": <0-12>
  },
  "violations": {
    "grave": [{"phrase": "...", "quote": "exact text from draft", "section": "Cap N from master-avoid-slop"}],
    "medium": [{"phrase": "...", "quote": "...", "section": "..."}],
    "light": [{"phrase": "...", "quote": "...", "section": "..."}]
  },
  "verdict": "approved" | "revise" | "reject",
  "reasoning": "1-2 paragraph explanation of verdict — what worked, what didn't",
  "revision_notes": ["specific fix 1", "specific fix 2"]
}
\`\`\`

Verdict rules:
- 1+ grave OR total < 6 → **reject**
- 2+ medium OR total 6-8 → **revise**
- Else → **approved**

# Foundation (canonical reference)

${foundation}`;
}

interface LLMVerdict {
  score: {
    pillar_alignment: number;
    voice_alignment: number;
    avoid_slop_pass: number;
    hook_strength: number;
    total: number;
  };
  violations: {
    grave: Array<{ phrase: string; quote: string; section: string }>;
    medium: Array<{ phrase: string; quote: string; section: string }>;
    light: Array<{ phrase: string; quote: string; section: string }>;
  };
  verdict: "approved" | "revise" | "reject";
  reasoning: string;
  revision_notes: string[];
}

async function llmVerify(draftContent: string, args: Args): Promise<LLMVerdict> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const anthropic = new Anthropic({ apiKey });

  const foundation = loadFoundationForVerifier();
  const system = buildVerifierSystemPrompt(foundation);
  const user = `# Draft to verify

\`\`\`
${draftContent}
\`\`\`

Return JSON only.`;

  const model = MODELS[args.model];
  if (args.verbose) {
    console.log(`Verifier system prompt: ${system.length} chars`);
    console.log(`Verifier user prompt: ${user.length} chars`);
  }
  console.log(`→ LLM verifier (${model})...`);
  const t0 = Date.now();
  const response = await anthropic.messages.create({
    model,
    max_tokens: 2048,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
  });
  const ms = Date.now() - t0;
  console.log(`✓ Verifier done in ${(ms / 1000).toFixed(1)}s`);
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
  if (block.type !== "text") throw new Error("Unexpected response type");
  let text = block.text.trim();
  if (text.startsWith("```")) text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("Invalid JSON from verifier:\n", text);
    throw new Error("LLM returned invalid JSON");
  }
}

// ────────────────────────────────────────────────────────────────────────────
// AGGREGATION + REPORT
// ────────────────────────────────────────────────────────────────────────────

function extractWriterSelfScore(draftContent: string): number | null {
  const m = draftContent.match(/verifier_score:\s*(\d+)\/12/);
  return m ? parseInt(m[1], 10) : null;
}

function aggregateVerdict(scan: ScanResult, llm: LLMVerdict): {
  finalVerdict: "approved" | "revise" | "reject";
  reason: string;
} {
  // Hard rules
  if (scan.grave.length > 0 || llm.violations.grave.length > 0 || llm.verdict === "reject") {
    return {
      finalVerdict: "reject",
      reason: `Grave violations detected. Programmatic: ${scan.grave.length} · LLM: ${llm.violations.grave.length} · LLM verdict: ${llm.verdict}`,
    };
  }
  const totalMedium = scan.medium.length + llm.violations.medium.length;
  if (llm.score.total < 9 || totalMedium >= 2 || llm.verdict === "revise") {
    return {
      finalVerdict: "revise",
      reason: `LLM total ${llm.score.total}/12 · medium violations (combined): ${totalMedium}`,
    };
  }
  return { finalVerdict: "approved", reason: `LLM ${llm.score.total}/12, no grave, ≤1 medium` };
}

function formatReport(args: {
  scan: ScanResult;
  llm: LLMVerdict;
  writerScore: number | null;
  final: { finalVerdict: string; reason: string };
}): string {
  const { scan, llm, writerScore, final } = args;
  const delta = writerScore != null ? llm.score.total - writerScore : null;
  const deltaWarn = delta != null && Math.abs(delta) > 2 ? " ⚠ delta > 2" : "";

  const sections: string[] = [];

  sections.push(`---
verifier_score: ${llm.score.total}/12
writer_self_score: ${writerScore != null ? writerScore + "/12" : "n/a"}
score_delta: ${delta != null ? (delta > 0 ? "+" : "") + delta : "n/a"}${deltaWarn}
verdict: ${final.finalVerdict}
violations_grave: ${scan.grave.length + llm.violations.grave.length}
violations_medium: ${scan.medium.length + llm.violations.medium.length}
violations_light: ${scan.light.length + llm.violations.light.length}
verified_at: ${new Date().toISOString()}
---

# Verifier Report

**Final verdict: ${final.finalVerdict.toUpperCase()}**
*${final.reason}*

## LLM Rubric (independent judge)

| Dimension | Score |
|---|---|
| Pillar alignment | ${llm.score.pillar_alignment}/3 |
| Voice alignment | ${llm.score.voice_alignment}/3 |
| Avoid-slop pass | ${llm.score.avoid_slop_pass}/3 |
| Hook strength | ${llm.score.hook_strength}/3 |
| **Total** | **${llm.score.total}/12** |

### Reasoning
${llm.reasoning}

## Programmatic scan

**Metrics:**
- Max em-dashes em um parágrafo: ${scan.metrics.em_dash_max_per_paragraph}
- Exclamações no body: ${scan.metrics.exclamations_in_body}
- Emojis banidos encontrados: ${scan.metrics.banned_emojis_found.join(", ") || "nenhum"}
- Linhas com CAPS LOCK: ${scan.metrics.caps_lock_lines}

**Violations detected:**
${formatViolationsList("Grave", scan.grave, llm.violations.grave)}
${formatViolationsList("Medium", scan.medium, llm.violations.medium)}
${formatViolationsList("Light", scan.light, llm.violations.light)}

## Score comparison

- Writer self-score: ${writerScore != null ? writerScore + "/12" : "n/a"}
- Verifier (LLM): ${llm.score.total}/12
- Delta: ${delta != null ? (delta > 0 ? "+" : "") + delta : "n/a"}${deltaWarn}

${delta != null && Math.abs(delta) > 2 ? "**⚠ Delta significativo — writer foi otimista demais ou pessimista demais. Revisar self-rubric.**" : ""}

## Revision notes${final.finalVerdict === "revise" ? "" : " (N/A)"}

${llm.revision_notes.map((n) => `- ${n}`).join("\n") || "(nenhuma — draft aprovado)"}
`);

  return sections.join("\n");
}

function formatViolationsList(
  label: string,
  scanList: string[],
  llmList: Array<{ phrase: string; quote: string; section: string }>
): string {
  if (scanList.length === 0 && llmList.length === 0) return `- ${label}: nenhuma ✓`;
  const lines = [`- **${label}:**`];
  for (const s of scanList) lines.push(`  - [programmatic] \`${s}\``);
  for (const v of llmList) {
    lines.push(`  - [llm] **${v.phrase}** (${v.section})`);
    if (v.quote) lines.push(`    > "${v.quote}"`);
  }
  return lines.join("\n");
}

function updateContentObjectState(runDir: string, verdict: string) {
  const filePath = path.join(runDir, "content-object.md");
  let content = fs.readFileSync(filePath, "utf-8");
  const today = new Date().toISOString().slice(0, 10);

  let newState: string;
  let nextAction: string;
  if (verdict === "approved") {
    newState = "verified";
    nextAction = "publish";
  } else if (verdict === "revise") {
    newState = "draft"; // back to writer
    nextAction = "rewrite_with_revision_notes";
  } else {
    newState = "draft";
    nextAction = "reject_back_to_idea_gate";
  }

  content = content
    .replace(/^state: .*$/m, `state: ${newState}`)
    .replace(/^updated_at: .*$/m, `updated_at: ${today}`)
    .replace(/^next_action: .*$/m, `next_action: ${nextAction}`);
  if (content.includes("## State log")) {
    content = content.replace(
      "## State log",
      `## State log\n- ${today}: verifier verdict ${verdict} → ${newState}`
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

  const draftPath = path.join(runDir, "draft-package.md");
  if (!fs.existsSync(draftPath)) {
    console.error(`draft-package.md not found in ${runDir}. Run writer first.`);
    process.exit(1);
  }

  try {
    const draftContent = read(draftPath);
    const writerScore = extractWriterSelfScore(draftContent);

    console.log(`▶ Verifying ${args.run}`);
    console.log(`  Writer self-score: ${writerScore != null ? writerScore + "/12" : "n/a"}`);

    console.log("\n[1/2] Programmatic scan...");
    const scan = programmaticScan(draftContent);
    console.log(`  Grave: ${scan.grave.length} · Medium: ${scan.medium.length} · Light: ${scan.light.length}`);

    console.log("\n[2/2] LLM rubric pass...");
    const llm = await llmVerify(draftContent, args);
    console.log(`  Score: ${llm.score.total}/12 · Verdict: ${llm.verdict}`);

    const final = aggregateVerdict(scan, llm);
    console.log(`\n=== Final verdict: ${final.finalVerdict.toUpperCase()} ===`);
    console.log(`  ${final.reason}`);

    const report = formatReport({ scan, llm, writerScore, final });
    const reportPath = path.join(runDir, "verifier-report.md");
    fs.writeFileSync(reportPath, report);
    console.log(`\n✓ Saved ${path.relative(ROOT, reportPath)}`);

    updateContentObjectState(runDir, final.finalVerdict);
    console.log(`✓ Updated content-object.md state`);
  } catch (err) {
    console.error("✗ Verifier error:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
