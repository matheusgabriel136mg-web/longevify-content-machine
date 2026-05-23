// critic.mjs — Visual critic agent pra slides do Longevify
//
// Avalia cada slide-N.png de uma run contra:
//   - CLAUDE.md (regras consolidadas do brand)
//   - scripts/critic-rubric.md (hard/soft fails + scoring)
//   - feedback.json (history de rejeições/approvals)
//
// Output:
//   - runs/<run-id>/critic-report.json (estruturado)
//   - stdout: tabela com score por slide + issues
//   - exit 0 se all approved, 1 se any < 8 (loop iteration)
//
// Uso:
//   node scripts/critic.mjs --run 2026-05-22-001-ferritina-ferro-escondido
//   node scripts/critic.mjs --dir runs/foo/assets
//   node scripts/critic.mjs --run X --slide slide-3-sintomas.png  (single slide)

import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

// Manual .env loader (node --env-file falha em values com chars especiais)
const ENV_PATH = path.join(ROOT, ".env");
if (fs.existsSync(ENV_PATH)) {
  for (const line of fs.readFileSync(ENV_PATH, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const RUBRIC_PATH = path.join(ROOT, "scripts", "critic-rubric.md");
const TRAINING_PATH = path.join(ROOT, "scripts", "critic-training.md");
const CLAUDE_MD = path.join(ROOT, "CLAUDE.md");
const FEEDBACK_JSON = path.join(ROOT, "output", "feedback.json");

// ─── Args parse ───────────────────────────────────────────────────────────────
function parseArgs() {
  const a = process.argv.slice(2);
  const out = { single: null };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--run") out.runId = a[++i];
    else if (a[i] === "--dir") out.dir = a[++i];
    else if (a[i] === "--slide") out.single = a[++i];
    else if (a[i] === "--model") out.model = a[++i];
    else if (a[i] === "-v" || a[i] === "--verbose") out.verbose = true;
  }
  if (!out.runId && !out.dir) {
    console.error("Usage: node critic.mjs --run <run-id> | --dir <path> [--slide <filename>] [-v]");
    process.exit(1);
  }
  out.model = out.model || "claude-sonnet-4-6";
  return out;
}

const args = parseArgs();
const assetsDir = args.dir || path.join(ROOT, "runs", args.runId, "assets");
const runDir = path.dirname(assetsDir);

if (!fs.existsSync(assetsDir)) {
  console.error(`Assets dir não existe: ${assetsDir}`);
  process.exit(1);
}

// ─── Load context (CLAUDE.md + rubric + feedback) ────────────────────────────
const rubric = fs.readFileSync(RUBRIC_PATH, "utf-8");
const training = fs.existsSync(TRAINING_PATH) ? fs.readFileSync(TRAINING_PATH, "utf-8") : "";
const claudeMd = fs.readFileSync(CLAUDE_MD, "utf-8");
const feedbackRaw = fs.existsSync(FEEDBACK_JSON) ? fs.readFileSync(FEEDBACK_JSON, "utf-8") : "";

// ─── Pick slides ──────────────────────────────────────────────────────────────
const allSlides = fs.readdirSync(assetsDir)
  .filter(f => /^slide-\d+.*\.(png|jpe?g)$/i.test(f))
  .sort((a, b) => {
    const na = parseInt(a.match(/slide-(\d+)/)[1]);
    const nb = parseInt(b.match(/slide-(\d+)/)[1]);
    return na - nb;
  });

const slides = args.single ? allSlides.filter(s => s === args.single) : allSlides;

if (slides.length === 0) {
  console.error(`Nenhum slide-N.png em ${assetsDir}`);
  process.exit(1);
}

// ─── Detect slide type heurístico (filename pattern) ─────────────────────────
function detectType(filename) {
  const lower = filename.toLowerCase();
  if (lower.includes("cover") || /^slide-1[-.]/.test(lower)) return "cover";
  if (lower.includes("chart") || lower.includes("stat") || lower.includes("ferro") || lower.includes("vs")) return "stat";
  if (lower.includes("bloquead") || lower.includes("evite") || lower.includes("x-mark")) return "x-mark";
  if (lower.includes("sintoma") || lower.includes("como") || lower.includes("alavanca")) return "card-list";
  return "unknown";
}

// ─── Anthropic call ───────────────────────────────────────────────────────────
const anthropic = new Anthropic();

const SYSTEM_PROMPT = `Você é o crítico visual chefe do Longevify (marca de longevidade pt-BR, voice Mito+Aesop). Avalia slides de Instagram contra uma rubrica rígida. Sem amor, sem desculpa. Sempre output JSON.

═══ CLAUDE.md (regras do brand) ═══
${claudeMd}

═══ critic-rubric.md (régua de critica) ═══
${rubric}

═══ critic-training.md (padrões de ANTES/DEPOIS extraídos das sessões reais) ═══
${training}

═══ feedback.json (histórico recente de rejeições) ═══
${feedbackRaw.slice(0, 4000)}

═══ COMO RESPONDER ═══

═══ DECISÃO BINÁRIA: SHIP vs NO-SHIP ═══

Sua decisão principal é: **esse slide está pronto pra publicar no Instagram?**

A régua é Matheus-ground-truth: ele aprova slides com pequenas imperfeições cosméticas (dead-space subtil, copy sub borderline, etc) e SÓ rejeita quando hard fail real.

**SHIP (approved=true) se TODOS:**
- Zero hard_fails da lista (H1-H11)
- Composição lê visualmente como Longevify (warm taupe OR cover photo, Inter+Georgia, logo branca 25% bottom)
- Texto legível, sem overlap real com logo

**NO-SHIP (approved=false) se QUALQUER:**
- 1+ hard fail real
- Texto sobreposto à logo (não "perto", LITERALMENTE coberto)
- Crop bars LISAS visíveis (não cosmetic shading)
- Logo cor inconsistente intra-carrossel

**Soft fails NÃO bloqueiam ship.** Eles são feedback de melhoria. Aponte como advisory.

═══ FORMATO JSON ═══

{
  "slide": "<filename>",
  "slide_type": "cover" | "stat" | "card-list" | "x-mark" | "reel-frame" | "unknown",
  "score": <integer 0-10>,
  "ship": <bool>,
  "approved": <bool, alias de ship pra back-compat>,
  "blocking": [
    {"code": "H1|H2|...", "rule": "<nome>", "where": "<localização>", "detail": "<por que é blocking>"}
  ],
  "advisory": [
    {"code": "S1|S2|...", "rule": "<nome>", "where": "<área>", "suggestion": "<como melhoraria>"}
  ],
  "praise": ["<o que tá bom>"],
  "fix_notes": "<SÓ se ship=false: instruções concretas pra renderer. SE ship=true: string vazia.>"
}

Regras finais:
- ship = (blocking.length === 0). Soft issues NUNCA viram blocking.
- approved = ship (alias).
- score é diagnóstico (qualidade global), NÃO determina ship.
- Quando em dúvida sobre hard fail (e.g. Playfair vs Georgia, ou blur moderado vs detalhado), prefira NÃO classificar como blocking — vira advisory.
- NÃO invente coordenadas em px. Descreva proporção (e.g. "10% bottom").`;

// API tem limite de 5MB por imagem. PNG denso passa fácil → downsize pra JPEG.
async function prepareImage(imagePath) {
  const raw = fs.readFileSync(imagePath);
  if (raw.length < 4.5 * 1024 * 1024) {
    const ext = path.extname(imagePath).slice(1).toLowerCase();
    return { b64: raw.toString("base64"), mediaType: ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png" };
  }
  // Downsize: max 1440px maior dim + JPEG q88 (mantém detalhes pro critic ler)
  const meta = await sharp(imagePath).metadata();
  const maxSide = 1440;
  const resized = await sharp(imagePath)
    .resize(meta.width >= meta.height ? maxSide : null, meta.height > meta.width ? maxSide : null, { fit: "inside" })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  return { b64: resized.toString("base64"), mediaType: "image/jpeg" };
}

async function withRetry(fn, label, maxTries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      const msg = e.message || String(e);
      const transient = /overloaded|timed out|connection|529|502|503|504/i.test(msg);
      if (!transient || attempt === maxTries) throw e;
      const wait = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s
      console.error(`    ↻ ${label} retry ${attempt}/${maxTries-1} após ${wait}ms (${msg.slice(0,60)})`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

async function critique(slideName, imagePath) {
  const { b64, mediaType } = await prepareImage(imagePath);
  const slideType = detectType(slideName);

  // Contexto extra: tipo detectado + lista de slides anteriores (pra checar consistência intra-carrossel)
  const carouselContext = slides.length > 1
    ? `\n\nVocê está avaliando o slide \`${slideName}\` de um carrossel de ${slides.length} slides. Carrossel completo: ${slides.join(", ")}. Verifique CONSISTÊNCIA com os demais (logo cor/escala, headline-Y, paleta, padding lateral, tipografia).`
    : "";

  const userText = `Tipo heurístico detectado: \`${slideType}\` (pode corrigir se errei).${carouselContext}\n\nAvalie esse slide e retorne SÓ o JSON especificado.`;

  const msg = await withRetry(() => anthropic.messages.create({
    model: args.model,
    max_tokens: 2500,
    system: SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: b64 }},
        { type: "text", text: userText }
      ]
    }]
  }), slideName);

  const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("\n");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`Claude não retornou JSON pra ${slideName}:\n${text.slice(0, 500)}`);
  return JSON.parse(m[0]);
}

// ─── Main loop ────────────────────────────────────────────────────────────────
console.log(`\n🔍 Critic · ${slides.length} slide(s) · ${path.relative(ROOT, assetsDir)} · model=${args.model}\n`);

// Paralelizar slides com concurrency=2 (Anthropic rate limits)
async function processSlide(s) {
  try {
    const r = await critique(s, path.join(assetsDir, s));
    // Normalizar back-compat: approved == ship
    r.ship = r.ship ?? r.approved;
    r.approved = r.ship;
    r.blocking = r.blocking ?? r.hard_fails ?? [];
    r.advisory = r.advisory ?? r.soft_fails ?? [];
    const mark = r.ship ? "SHIP ✓" : "NO-SHIP ✗";
    const bk = r.blocking?.length ?? 0;
    const adv = r.advisory?.length ?? 0;
    console.log(`  ${s.padEnd(36)} ${r.score}/10 ${mark}  (${bk} blocking · ${adv} advisory)`);
    return r;
  } catch (e) {
    console.log(`  ${s.padEnd(36)} ERROR: ${e.message?.slice(0, 80)}`);
    return { slide: s, score: 0, error: e.message, ship: false, approved: false };
  }
}

async function runParallel(items, concurrency) {
  const out = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const r = await Promise.all(batch.map(processSlide));
    out.push(...r);
  }
  return out;
}

const start = Date.now();
const results = await runParallel(slides, 2);

const elapsed = ((Date.now() - start) / 1000).toFixed(1);

// ─── Aggregate report ─────────────────────────────────────────────────────────
const validScores = results.map(r => r.score ?? 0);
const report = {
  assets_dir: path.relative(ROOT, assetsDir),
  evaluated_at: new Date().toISOString(),
  model: args.model,
  elapsed_s: parseFloat(elapsed),
  total_slides: slides.length,
  ship_all: results.every(r => r.ship === true),
  all_approved: results.every(r => r.ship === true), // alias
  min_score: Math.min(...validScores),
  avg_score: validScores.reduce((a, b) => a + b, 0) / validScores.length,
  blocking_total: results.reduce((a, r) => a + (r.blocking?.length ?? 0), 0),
  advisory_total: results.reduce((a, r) => a + (r.advisory?.length ?? 0), 0),
  results
};

const reportPath = path.join(runDir, "critic-report.json");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

// ─── Stdout summary ───────────────────────────────────────────────────────────
console.log(`\n${"━".repeat(60)}`);
console.log(`${report.ship_all ? "✅ SHIP ALL" : "❌ HOLD"}  ·  min ${report.min_score}/10  ·  avg ${report.avg_score.toFixed(1)}/10`);
console.log(`Blocking: ${report.blocking_total}  ·  Advisory: ${report.advisory_total}  ·  ${elapsed}s`);
console.log(`Report: ${path.relative(ROOT, reportPath)}\n`);

if (!report.ship_all || args.verbose) {
  for (const r of results.filter(x => !x.ship || args.verbose)) {
    console.log(`\n  ${r.slide}  (${r.score}/10  ·  ${r.slide_type || "?"}  ·  ${r.ship ? "SHIP" : "NO-SHIP"})`);
    if (r.blocking?.length) {
      for (const f of r.blocking) console.log(`    ❌ BLOCKING ${f.code}  ${f.rule}  →  ${f.detail || f.where}`);
    }
    if (r.advisory?.length && args.verbose) {
      for (const f of r.advisory) console.log(`    ⚠️  advisory ${f.code}  ${f.rule}  →  ${f.where || f.suggestion}`);
    }
    if (r.fix_notes && !r.ship) console.log(`    🔧 ${r.fix_notes}`);
    if (args.verbose && r.praise?.length) {
      for (const p of r.praise) console.log(`    ✨ ${p}`);
    }
  }
  console.log();
}

process.exit(report.ship_all ? 0 : 1);
