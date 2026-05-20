/**
 * overnight-generator.ts — Geração autônoma de drafts overnight.
 *
 * Roda via cron (02h BRT / 05h UTC) ou trigger manual. NÃO publica nada no IG —
 * apenas gera draft-package.md + brief.md + content-object.md em runs/, pra
 * Matheus revisar de manhã.
 *
 * Lógica (resumida):
 *   1. Detecta próximo slot da semana NÃO preenchido (varre runs/ e olha state).
 *   2. Escolhe fonte: bookmark não-usado > internal idea > zero-shot do pilar atrasado.
 *   3. Chama Claude (opus-4.7) com prompt caching no system + brand context.
 *   4. Salva 3 arquivos em runs/YYYY-MM-DD-NNN-<slug>/.
 *   5. Loga em output/overnight-runs.log.
 *
 * Uso:
 *   npm run overnight-gen                              # gera próximo slot real
 *   npm run overnight-gen -- --dry-run                 # roda sem gravar (preview)
 *   npm run overnight-gen -- --dry-run --slot tomorrow # força um slot específico
 *   npm run overnight-gen -- --slot monday             # força dia da semana
 *
 * Restrições estritas:
 *   - NÃO usa Higgsfield ou qualquer gerador visual (texto/copy só)
 *   - NÃO publica (publicar requer trigger humano explícito)
 *   - Exit 0 sempre que possível (workflow não derruba em erro de API)
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ───────────────────────────── tipos ─────────────────────────────

type Format = "carousel" | "reel" | "post";
type DayOfWeek =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

interface SlotSpec {
  day: DayOfWeek;
  date: string; // YYYY-MM-DD
  format: Format;
  time: string; // HH:mm BRT
  series_hint: string;
  pillar_hint: number; // 1-4 (sugerido, mas pode ser overridden)
}

interface BrandConfig {
  pillars: Array<{ n: number; name: string; quota_per_month: number }>;
  publish: {
    schedule_brt: Record<
      string,
      { type: string; time: string | null; format: string; series_hint: string }
    >;
  };
}

interface InternalIdea {
  id: string;
  title: string;
  biomarker_focus?: string;
  format_suggestion?: string;
  pillar: number;
  source_text?: string;
  hook_suggestions?: string[];
  angle?: string;
  status: string;
  notes?: string;
}

interface BookmarkedPostsFile {
  ids: string[];
  updated_at: string;
}

interface RawPost {
  id: string;
  caption?: string;
  url?: string;
  hashtags?: string[];
  type?: string;
  [k: string]: unknown;
}

interface SourceMaterial {
  kind: "bookmark" | "internal_idea" | "pillar_seed";
  pillar: number;
  title_hint: string;
  raw_text: string;
  metadata: Record<string, string>;
}

interface CLIArgs {
  dryRun: boolean;
  forcedSlot: string | null; // "tomorrow" | "monday" | etc
  model: string;
}

// ───────────────────────────── args ─────────────────────────────

function parseArgs(): CLIArgs {
  const argv = process.argv.slice(2);
  const out: CLIArgs = {
    dryRun: false,
    forcedSlot: null,
    model: "claude-opus-4-7",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--slot") out.forcedSlot = argv[++i];
    else if (a === "--model") out.model = argv[++i];
  }
  return out;
}

// ───────────────────────────── utils ─────────────────────────────

function readFileSafe(p: string): string {
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return "";
  }
}

function readJsonSafe<T>(p: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayName(d: Date): DayOfWeek {
  // toLocaleDateString com weekday=long em en-US dá "Monday", "Tuesday", etc.
  const name = d
    .toLocaleDateString("en-US", { weekday: "long", timeZone: "America/Sao_Paulo" })
    .toLowerCase() as DayOfWeek;
  return name;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

function log(msg: string) {
  const ts = new Date().toISOString();
  // Loga no stdout (vai pro GHA log) E no arquivo de log persistente.
  console.log(`[${ts}] ${msg}`);
  try {
    const logPath = path.join(ROOT, "output", "overnight-runs.log");
    fs.appendFileSync(logPath, `[${ts}] ${msg}\n`);
  } catch {
    /* swallow — log file não-crítico */
  }
}

// ───────────────────────────── slot detection ─────────────────────────────

/**
 * Determina o próximo slot a ser preenchido.
 *
 * Estratégia:
 *   1. Se --slot foi forçado, usa ele.
 *   2. Senão, pega "tomorrow" no fuso BRT (rodando às 02h BRT, "amanhã" é o dia
 *      que precisa ter draft pronto pra publicar nas próximas horas).
 *   3. Skip se já existe um run com state=draft|verified|published pra esse dia.
 */
function pickNextSlot(args: CLIArgs, brand: BrandConfig): SlotSpec | null {
  // Resolve qual data alvo
  const targetDate = new Date();
  if (args.forcedSlot === "tomorrow" || args.forcedSlot === null) {
    targetDate.setDate(targetDate.getDate() + 1);
  } else if (args.forcedSlot === "today") {
    // mantém hoje
  } else {
    // tenta interpretar como dia da semana ("monday", "friday", ...)
    const target = args.forcedSlot.toLowerCase() as DayOfWeek;
    const days: DayOfWeek[] = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ];
    const targetIdx = days.indexOf(target);
    if (targetIdx === -1) {
      log(`[slot] valor inválido pra --slot: ${args.forcedSlot}. Usando 'tomorrow'.`);
      targetDate.setDate(targetDate.getDate() + 1);
    } else {
      // Avança até bater no dia da semana pedido
      while (dayName(targetDate) !== target) {
        targetDate.setDate(targetDate.getDate() + 1);
      }
    }
  }

  const day = dayName(targetDate);
  const dateStr = isoDate(targetDate);
  const scheduleEntry = brand.publish.schedule_brt[day];
  if (!scheduleEntry || scheduleEntry.type === "stories_only") {
    log(`[slot] ${dateStr} (${day}) é dia de descanso/stories-only. Skip.`);
    return null;
  }

  // Verifica se já existe run com state>=draft pra essa data
  const runsDir = path.join(ROOT, "runs");
  if (fs.existsSync(runsDir)) {
    const entries = fs.readdirSync(runsDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (!e.name.startsWith(dateStr)) continue;
      const coPath = path.join(runsDir, e.name, "content-object.md");
      const raw = readFileSafe(coPath);
      // Lê o state do frontmatter via regex bem simples
      const m = raw.match(/^state:\s*(\S+)/m);
      const state = m?.[1] ?? "";
      if (["draft", "verified", "published"].includes(state)) {
        log(`[slot] ${dateStr} já tem run ${e.name} com state=${state}. Skip.`);
        return null;
      }
    }
  }

  // Inferência de pilar baseada no series_hint
  let pillar = 2; // default seguro
  const hint = (scheduleEntry.series_hint ?? "").toLowerCase();
  if (hint.includes("pilar_1") || hint.includes("terroir")) pillar = 1;
  else if (hint.includes("dado") || hint.includes("stat")) pillar = 2;
  else if (hint.includes("caso_real") || hint.includes("falha")) pillar = 3;
  else if (hint.includes("sensa") || hint.includes("overheard")) pillar = 4;
  else if (hint.includes("deep_dive")) pillar = 2;

  return {
    day,
    date: dateStr,
    format: (scheduleEntry.format as Format) ?? "carousel",
    time: scheduleEntry.time ?? "19:00",
    series_hint: scheduleEntry.series_hint,
    pillar_hint: pillar,
  };
}

// ───────────────────────────── source selection ─────────────────────────────

/**
 * Escolhe a melhor fonte pro draft:
 *   1. Bookmark não-usado (cruza output/bookmarked-posts.json com analysis/raw-posts.json)
 *   2. Internal idea com status=queued
 *   3. Pillar seed (zero-shot baseado no pilar do slot)
 */
function pickSource(slot: SlotSpec): SourceMaterial {
  // (1) Bookmarks
  const bookmarks = readJsonSafe<BookmarkedPostsFile>(
    path.join(ROOT, "output", "bookmarked-posts.json"),
    { ids: [], updated_at: "" },
  );
  const usedIds = collectUsedBookmarkIds();
  const freshBookmarkIds = bookmarks.ids.filter((id) => !usedIds.has(id));

  if (freshBookmarkIds.length > 0) {
    // Acha o post no raw-posts.json mais recente
    const post = findRawPost(freshBookmarkIds);
    if (post) {
      return {
        kind: "bookmark",
        pillar: slot.pillar_hint,
        title_hint: (post.caption ?? "").slice(0, 60).replace(/\s+/g, " "),
        raw_text: post.caption ?? "(sem caption)",
        metadata: {
          bookmark_id: post.id,
          url: post.url ?? "",
          type: post.type ?? "",
        },
      };
    }
  }

  // (2) Internal idea
  const ideasFile = readJsonSafe<{ ideas: InternalIdea[] }>(
    path.join(ROOT, "output", "internal-ideas.json"),
    { ideas: [] },
  );
  const queuedIdeas = ideasFile.ideas.filter((i) => i.status === "queued");
  if (queuedIdeas.length > 0) {
    const idea = queuedIdeas[0];
    return {
      kind: "internal_idea",
      pillar: idea.pillar || slot.pillar_hint,
      title_hint: idea.title,
      raw_text: [
        `Title: ${idea.title}`,
        idea.biomarker_focus ? `Biomarker focus: ${idea.biomarker_focus}` : "",
        idea.angle ? `Angle: ${idea.angle}` : "",
        idea.hook_suggestions?.length
          ? `Hook candidates:\n${idea.hook_suggestions.map((h) => `  - ${h}`).join("\n")}`
          : "",
        idea.source_text ? `\nSource text:\n${idea.source_text}` : "",
        idea.notes ? `\nNotes: ${idea.notes}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: { idea_id: idea.id },
    };
  }

  // (3) Pillar seed (zero-shot baseado no pilar atrasado)
  return {
    kind: "pillar_seed",
    pillar: slot.pillar_hint,
    title_hint: `Pilar ${slot.pillar_hint} seed`,
    raw_text: `Slot pede formato ${slot.format} pra dia ${slot.day} (series hint: ${slot.series_hint}). Sem bookmark ou idea queued — gerar zero-shot puxando do pilar ${slot.pillar_hint}.`,
    metadata: { pillar_seed: String(slot.pillar_hint) },
  };
}

function collectUsedBookmarkIds(): Set<string> {
  // Varre runs/*/content-object.md procurando metadados de bookmark_id
  const used = new Set<string>();
  const runsDir = path.join(ROOT, "runs");
  if (!fs.existsSync(runsDir)) return used;
  for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const coPath = path.join(runsDir, entry.name, "content-object.md");
    const raw = readFileSafe(coPath);
    // Procura linha tipo "bookmark_id: 3890559992906883127"
    const m = raw.match(/bookmark_id:\s*(\d+)/);
    if (m) used.add(m[1]);
  }
  return used;
}

function findRawPost(ids: string[]): RawPost | null {
  // Acha a análise mais recente em output/analysis-*
  const outputDir = path.join(ROOT, "output");
  if (!fs.existsSync(outputDir)) return null;
  const dirs = fs
    .readdirSync(outputDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("analysis-"))
    .map((d) => d.name)
    .sort()
    .reverse();
  for (const d of dirs) {
    const rpPath = path.join(outputDir, d, "raw-posts.json");
    if (!fs.existsSync(rpPath)) continue;
    const posts = readJsonSafe<RawPost[]>(rpPath, []);
    for (const id of ids) {
      const found = posts.find((p) => p.id === id);
      if (found) return found;
    }
  }
  return null;
}

// ───────────────────────────── prompt building ─────────────────────────────

/**
 * Monta o system prompt — content frozen, cacheado.
 *
 * Ordem (prefix-stable):
 *   1. Brand foundation (LONGEVIFY_BRAND.md + BRAND_DEFAULTS.md + brand.json)
 *   2. Format/structure rules (carousel vs reel vs post)
 *
 * O cache_control fica na ÚLTIMA system block — assim tudo acima fica cacheado.
 */
function buildSystemBlocks(): Array<{
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}> {
  const brandMd = readFileSafe(path.join(ROOT, "LONGEVIFY_BRAND.md"));
  const defaultsMd = readFileSafe(path.join(ROOT, "BRAND_DEFAULTS.md"));
  const pillarsMd = readFileSafe(path.join(ROOT, "LONGEVIFY_PILLARS.md"));
  const brandJson = readFileSafe(path.join(ROOT, "brands", "longevify.json"));

  const role = `Você é o writer overnight da Longevify, uma marca brasileira de medicina de precisão (Pilar 1-4: Terroir BR, Biomarcador Escondido, Falha do Check-up, Sensação→Dado).

Sua missão: gerar UM draft completo (brief + draft-package + content-object) que Matheus possa revisar de manhã. NÃO publica nada — só gera markdown. Sem hashtags decorativas. Sem self-help. Sem fear. Sem clichês de saúde. PT-BR único.

Regras invioláveis:
- Tom Mito (precisão técnica) + Aesop (restrição editorial)
- Headline peso 300-400 — força vem do tamanho, não do bold
- Zero emoji (exceto 🇧🇷 ou ❄️ se contextualmente raro)
- Hook máx 90 chars · Title slide máx 4 palavras · Body slide máx 25 palavras
- CTA é convite, não imperativo ("link na bio" > "CLIQUE")
- Cores proibidas: red, amber, orange, #FFFFFF puro
- Anti-visual: jaleco, hospital, estetoscópio, gradient genérico, fundo branco

Retorna SEMPRE JSON puro (sem cercas markdown) com este schema:
{
  "title": "string (curto, descritivo)",
  "slug": "string-em-kebab-case-curto",
  "pillar": 1|2|3|4,
  "format": "carousel"|"reel"|"post",
  "tldr": "string 1-linha",
  "why_now": "string 1-2 frases justificando o post na semana",
  "hook_candidates": ["3-5 hooks alternativos, máx 90 chars cada"],
  "hook_chosen_idx": 0,
  "structure": {
    "slides": [{"role": "HOOK"|"PROOF"|"TURN"|"RESOLUTION"|"CTA", "headline": "string", "body": "string"}],
    "reel_beats": [{"timestamp": "0-2s"|"2-5s"|etc, "visual": "string", "text": "string"}]
  },
  "final_copy": {
    "headline": "string",
    "subhead": "string (opcional)",
    "body": "string (full slides ou roteiro)",
    "cta": "string",
    "caption": "string (máx 800 chars, editorial, zero hashtag decorativa)"
  },
  "proof_points": ["citações ou dados específicos com fonte"],
  "visual_brief": {
    "palette_hex": ["#hex", "#hex"],
    "typography_notes": "string",
    "logo_position": "bottom-center",
    "anti_visuals": ["lista de coisas a evitar neste post"]
  },
  "self_score": {
    "pillar_alignment": 0-3,
    "voice_alignment": 0-3,
    "avoid_slop": 0-3,
    "hook_strength": 0-3,
    "total": "X/12",
    "notes": "string curta"
  }
}

Use "structure.slides" se format=carousel ou post; use "structure.reel_beats" se format=reel.`;

  return [
    {
      type: "text",
      text: `# Longevify Brand Foundation\n\n## LONGEVIFY_BRAND.md\n${brandMd}\n\n## BRAND_DEFAULTS.md\n${defaultsMd}\n\n## LONGEVIFY_PILLARS.md\n${pillarsMd}\n\n## brands/longevify.json\n\`\`\`json\n${brandJson}\n\`\`\``,
    },
    {
      type: "text",
      text: role,
      // Cache breakpoint na última system block — tudo acima vira cache hit nas próximas runs.
      cache_control: { type: "ephemeral" },
    },
  ];
}

function buildUserPrompt(slot: SlotSpec, source: SourceMaterial): string {
  return `Gera o draft pro próximo slot Longevify.

## Slot
- Data: ${slot.date} (${slot.day})
- Horário publish: ${slot.time} BRT
- Formato: ${slot.format}
- Series hint: ${slot.series_hint}
- Pilar sugerido: ${slot.pillar_hint}

## Fonte
- Tipo: ${source.kind}
- Pilar resolvido: ${source.pillar}
- Title hint: ${source.title_hint}

### Raw material
${source.raw_text}

### Metadata
${Object.entries(source.metadata).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

## Output
Retorna SOMENTE o JSON descrito no system prompt. Nada antes, nada depois, sem cercas markdown.`;
}

// ───────────────────────────── Claude call ─────────────────────────────

interface DraftJSON {
  title: string;
  slug: string;
  pillar: number;
  format: Format;
  tldr: string;
  why_now: string;
  hook_candidates: string[];
  hook_chosen_idx: number;
  structure: {
    slides?: Array<{ role: string; headline: string; body: string }>;
    reel_beats?: Array<{ timestamp: string; visual: string; text: string }>;
  };
  final_copy: {
    headline: string;
    subhead?: string;
    body: string;
    cta: string;
    caption: string;
  };
  proof_points: string[];
  visual_brief: {
    palette_hex: string[];
    typography_notes: string;
    logo_position: string;
    anti_visuals: string[];
  };
  self_score: {
    pillar_alignment: number;
    voice_alignment: number;
    avoid_slop: number;
    hook_strength: number;
    total: string;
    notes: string;
  };
}

async function callClaude(
  args: CLIArgs,
  slot: SlotSpec,
  source: SourceMaterial,
): Promise<DraftJSON> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY não setada");

  const client = new Anthropic({ apiKey });
  const system = buildSystemBlocks();
  const userPrompt = buildUserPrompt(slot, source);

  log(`[claude] chamando ${args.model} (slot=${slot.date}/${slot.format}, source=${source.kind})`);

  // Streaming pra evitar timeout em max_tokens alto + tirar o final_message
  const stream = client.messages.stream({
    model: args.model,
    max_tokens: 16000,
    system,
    messages: [{ role: "user", content: userPrompt }],
  });

  const final = await stream.finalMessage();

  // Log de uso de cache
  log(
    `[claude] usage: input=${final.usage.input_tokens} cache_read=${final.usage.cache_read_input_tokens ?? 0} cache_write=${final.usage.cache_creation_input_tokens ?? 0} output=${final.usage.output_tokens}`,
  );

  // Extrai texto
  const textBlock = final.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Resposta sem bloco de texto");
  }
  const raw = textBlock.text.trim();

  // Claude às vezes envolve em ```json mesmo instruído ao contrário — strip defensivo.
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned) as DraftJSON;
  } catch (err) {
    log(`[claude] JSON parse FAILED. Raw output (primeiros 500 chars):\n${cleaned.slice(0, 500)}`);
    throw new Error(`JSON inválido: ${(err as Error).message}`);
  }
}

// ───────────────────────────── writers ─────────────────────────────

/**
 * Encontra próximo NNN sequencial pra essa data
 * (ex: se já existe 2026-05-20-001-*, retorna "002").
 */
function nextRunNumber(dateStr: string): string {
  const runsDir = path.join(ROOT, "runs");
  if (!fs.existsSync(runsDir)) return "001";
  let max = 0;
  for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const m = entry.name.match(new RegExp(`^${dateStr}-(\\d{3})-`));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return String(max + 1).padStart(3, "0");
}

function buildRunId(dateStr: string, title: string, slug: string): string {
  // Prioriza slug do JSON, fallback pro título slugificado
  const finalSlug = slug || slugify(title);
  const n = nextRunNumber(dateStr);
  return `${dateStr}-${n}-${finalSlug}`;
}

function writeContentObject(
  runId: string,
  slot: SlotSpec,
  draft: DraftJSON,
  source: SourceMaterial,
): string {
  const meta = Object.entries(source.metadata)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  return `---
id: ${runId}
route: ${source.kind === "bookmark" ? "rewrite" : source.kind === "internal_idea" ? "original" : "research"}
state: draft
pillar: ${draft.pillar}
format: ${draft.format}
platforms: [instagram]
created_at: ${slot.date}
updated_at: ${slot.date}
next_action: verify
source_kind: ${source.kind}
${meta}
---

# ${draft.title}

## TL;DR
${draft.tldr}

## Idea seed
${source.kind === "bookmark" ? `Adaptado de bookmark IG (id ${source.metadata.bookmark_id}).` : source.kind === "internal_idea" ? `Originado de internal-ideas.json (id ${source.metadata.idea_id}).` : `Zero-shot a partir do Pilar ${draft.pillar} pro slot ${slot.day}.`}

## Why now
${draft.why_now}

## Success criteria
- Pilar alignment: pilar ${draft.pillar}
- Hook target: ${draft.hook_candidates[draft.hook_chosen_idx] ?? draft.hook_candidates[0] ?? "(n/a)"}
- Format: ${draft.format} (slot ${slot.day} ${slot.time} BRT)

## Notes / sketches
Gerado automaticamente pelo overnight-generator em ${new Date().toISOString()}. Revisar voice, fact-check (se Pilar 2 ou 3), e visual antes de aprovar.

## State log
- ${slot.date}: draft gerado automaticamente (overnight-generator)
`;
}

function writeBrief(runId: string, slot: SlotSpec, draft: DraftJSON): string {
  const aspect = draft.format === "reel" ? "9:16" : "4:5";
  const slides = draft.structure.slides ?? [];
  const reelBeats = draft.structure.reel_beats ?? [];

  const structureSection =
    draft.format === "reel"
      ? reelBeats.map((b) => `- ${b.timestamp}: ${b.text} | visual: ${b.visual}`).join("\n")
      : slides.map((s, i) => `- Slide ${i + 1} (${s.role}): **${s.headline}** — ${s.body}`).join("\n");

  return `---
content_object: ${runId}
writer: ${slot.format === "reel" ? "opus-4.7-overnight-reel" : "opus-4.7-overnight"}
format: ${draft.format === "carousel" ? `carousel-${slides.length}-slides` : draft.format}
aspect: ${aspect}
foundation_loaded:
  - LONGEVIFY_BRAND.md
  - BRAND_DEFAULTS.md
  - LONGEVIFY_PILLARS.md
  - brands/longevify.json
target_metric: vsMedian >= 1.0
---

# Brief — ${draft.title}

## Format spec
- Type: ${draft.format}
- Length: ${draft.format === "reel" ? "15-20s" : `${slides.length} slides`}
- Aspect: ${aspect}
- Platforms: instagram

## Voice constraints
- PT-BR único, zero inglês exceto termos científicos consagrados
- Sem fear, sem self-help, sem promessa de cura
- Headline peso 300-400
- Vocabulário Longevify (biomarcadores, longevidade, inteligência de saúde, detecção precoce)

## Anti-slop atenção
${draft.visual_brief.anti_visuals.map((a) => `- ${a}`).join("\n")}

## Hook candidates
${draft.hook_candidates.map((h, i) => `${i + 1}. ${h}`).join("\n")}

Hook escolhido: #${draft.hook_chosen_idx + 1} — ${draft.hook_candidates[draft.hook_chosen_idx] ?? "(n/a)"}

## Structure
${structureSection}

## Visual brief
- Paleta: ${draft.visual_brief.palette_hex.join(", ")}
- Tipografia: ${draft.visual_brief.typography_notes}
- Logo position: ${draft.visual_brief.logo_position}
- Anti-visuais: ${draft.visual_brief.anti_visuals.join(", ")}
- **Visual gen: PENDENTE — Matheus decide manualmente (overnight gen é só copy).**

## Copy constraints
- Headline máx 12 palavras
- Subhead máx 25 palavras
- Body por slide máx 40 palavras
- CTA: convite, não ordem

## Proof points
${draft.proof_points.map((p) => `- ${p}`).join("\n") || "- (nenhum — gerar zero-shot, requer fact-check humano)"}

## Verifier targets
- Pilar alignment: ≥ 2/3
- Voice alignment: ≥ 2/3
- Avoid-slop pass: 3/3
- Hook strength: ≥ 2/3
- **Total: ≥ 9/12**
`;
}

function writeDraftPackage(runId: string, draft: DraftJSON): string {
  return `---
content_object: ${runId}
draft_id: v1
status: pending_verify
revisions: 0
verifier_score: ${draft.self_score.total}
generated_by: overnight-generator
---

# Draft — ${draft.title}

## Final copy

### Headline
${draft.final_copy.headline}

### Subhead
${draft.final_copy.subhead ?? "(n/a)"}

### Body / slides
${draft.final_copy.body}

### CTA
${draft.final_copy.cta}

### Caption (IG)
${draft.final_copy.caption}

### Hashtags / mentions
*(omitir — hashtags decorativas violam padrão editorial)*

## Visual assets
- Master file: PENDENTE (overnight gen não produz visual — Matheus revisa manualmente)
- Aspect: ${draft.format === "reel" ? "9:16" : "4:5"}
- Logo overlay: bottom-center, ~25% width

## Self-rubric (writer self-score)

### Scoring
- Pillar alignment (0-3): ${draft.self_score.pillar_alignment}
- Voice alignment (0-3): ${draft.self_score.voice_alignment}
- Avoid-slop pass (0-3): ${draft.self_score.avoid_slop}
- Hook strength (0-3): ${draft.self_score.hook_strength}

**Total: ${draft.self_score.total}**

### Notes
${draft.self_score.notes}

### Verdict
- ≥ 9: APPROVED candidate → matheus aprova e move pra publish queue
- 6-8: REVISE → ajustes específicos antes de publicar
- < 6: REJECT → repensar

## Revision history
- v1 (${new Date().toISOString().slice(0, 10)}): geração automática overnight, self-score ${draft.self_score.total}
`;
}

// ───────────────────────────── main ─────────────────────────────

async function main() {
  const args = parseArgs();
  log(`[start] overnight-generator dry-run=${args.dryRun} forced-slot=${args.forcedSlot ?? "auto"}`);

  // 1. Carrega brand config
  const brand = readJsonSafe<BrandConfig>(path.join(ROOT, "brands", "longevify.json"), {
    pillars: [],
    publish: { schedule_brt: {} },
  });

  // 2. Detecta slot
  const slot = pickNextSlot(args, brand);
  if (!slot) {
    log("[done] nenhum slot pra preencher. Exit 0.");
    return 0;
  }
  log(`[slot] alvo: ${slot.date} (${slot.day}) format=${slot.format} pillar=${slot.pillar_hint}`);

  // 3. Escolhe fonte
  const source = pickSource(slot);
  log(`[source] tipo=${source.kind} pillar=${source.pillar} title="${source.title_hint}"`);

  // 4. Chama Claude
  let draft: DraftJSON;
  try {
    draft = await callClaude(args, slot, source);
  } catch (err) {
    log(`[claude] FALHOU: ${(err as Error).message}`);
    // Falha graceful — sai com 0 pro workflow não pintar de vermelho.
    return 0;
  }

  log(`[draft] gerado: "${draft.title}" pillar=${draft.pillar} score=${draft.self_score.total}`);

  // 5. Constrói run-id e escreve
  const runId = buildRunId(slot.date, draft.title, draft.slug);
  const runDir = path.join(ROOT, "runs", runId);

  if (args.dryRun) {
    log(`[dry-run] iria criar: ${runDir}`);
    log(`[dry-run] === content-object.md ===\n${writeContentObject(runId, slot, draft, source).slice(0, 600)}...`);
    log(`[dry-run] === draft-package.md ===\n${writeDraftPackage(runId, draft).slice(0, 600)}...`);
    return 0;
  }

  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "content-object.md"), writeContentObject(runId, slot, draft, source));
  fs.writeFileSync(path.join(runDir, "brief.md"), writeBrief(runId, slot, draft));
  fs.writeFileSync(path.join(runDir, "draft-package.md"), writeDraftPackage(runId, draft));

  log(`[write] criados 3 arquivos em runs/${runId}/`);
  log(`[done] overnight-generator OK. run-id=${runId}`);

  // Imprime o run-id no stdout pra GHA capturar (formato: "RUN_ID=...")
  console.log(`RUN_ID=${runId}`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    log(`[fatal] ${(err as Error).message}\n${(err as Error).stack ?? ""}`);
    // Mesmo em erro fatal, exit 0 — não derruba o cron.
    process.exit(0);
  });
