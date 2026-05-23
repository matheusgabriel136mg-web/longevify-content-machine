/**
 * bookmark-to-draft.ts — Transforma bookmarks em runs + drafts Longevify.
 *
 * Fluxo:
 *   1. Lê output/bookmarked-posts.json
 *   2. Cross-ref com output/analysis-* pra pegar caption/brand/viral
 *   3. Pra cada bookmark, cria runs/<id>/ com brief.md + idea.md + content-object.md
 *   4. Dispara writer.ts (já existente) pra gerar draft-package.md
 *   5. Marca bookmark como "drafted" em output/bookmarks-drafted.json (não duplica)
 *
 * Uso:
 *   npm run bookmark-to-draft -- --limit 10           # processa próximos 10 não-draftados
 *   npm run bookmark-to-draft -- --limit 5 --dry-run  # cria runs mas não chama Claude
 *   npm run bookmark-to-draft -- --postId XYZ         # processa só esse bookmark específico
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

interface ApifyPost {
  id: string;
  shortCode?: string;
  url?: string;
  brand?: string;
  caption?: string;
  format?: string;
  vsMedian?: number;
  isViral?: boolean;
}

// ─── Bookmarks state ──────────────────────────────────────────────────────────
const BOOKMARKS_PATH = path.join(ROOT, "output", "bookmarked-posts.json");
const DRAFTED_PATH = path.join(ROOT, "output", "bookmarks-drafted.json");

function loadBookmarks(): string[] {
  if (!fs.existsSync(BOOKMARKS_PATH)) return [];
  return JSON.parse(fs.readFileSync(BOOKMARKS_PATH, "utf-8")).ids ?? [];
}

function loadDrafted(): Record<string, { runId: string; draftedAt: string }> {
  if (!fs.existsSync(DRAFTED_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(DRAFTED_PATH, "utf-8")); }
  catch { return {}; }
}

function saveDrafted(map: Record<string, { runId: string; draftedAt: string }>): void {
  fs.mkdirSync(path.dirname(DRAFTED_PATH), { recursive: true });
  fs.writeFileSync(DRAFTED_PATH, JSON.stringify(map, null, 2));
}

// ─── Posts cross-ref ──────────────────────────────────────────────────────────
function loadAllPosts(): Map<string, ApifyPost> {
  const outDir = path.join(ROOT, "output");
  const dirs = fs.readdirSync(outDir).filter((d) => d.startsWith("analysis-")).sort().reverse();
  const map = new Map<string, ApifyPost>();
  for (const d of dirs) {
    const raw = path.join(outDir, d, "raw-posts.json");
    if (!fs.existsSync(raw)) continue;
    try {
      const arr = JSON.parse(fs.readFileSync(raw, "utf-8")) as ApifyPost[];
      for (const p of arr) {
        if (p.id && !map.has(p.id)) map.set(p.id, p);
      }
    } catch {}
  }
  return map;
}

// ─── Slug / Run-ID ────────────────────────────────────────────────────────────
function slugify(text: string, maxWords = 6): string {
  return text
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/).filter(Boolean).slice(0, maxWords).join("-")
    .slice(0, 50);
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function nextSeqForDate(date: string): number {
  const dir = path.join(ROOT, "runs");
  if (!fs.existsSync(dir)) return 1;
  const existing = fs.readdirSync(dir)
    .filter((d) => d.startsWith(date))
    .map((d) => {
      const m = d.match(/^\d{4}-\d{2}-\d{2}-(\d{3})-/);
      return m ? parseInt(m[1], 10) : 0;
    });
  return existing.length ? Math.max(...existing) + 1 : 1;
}

// ─── Pattern matcher (escolhe fórmula baseada na caption) ──────────────────────
type Pattern = "manifesto" | "sintoma-biomarker" | "newsletter-curadoria" | "ciencia-profunda" | "lifestyle-premium" | "biomarker-stat";

function matchPattern(post: ApifyPost): Pattern {
  const cap = (post.caption || "").toLowerCase();
  if (/health is broken|broken|status quo|reserved for|future of health/i.test(cap)) return "manifesto";
  if (/brain fog|breakouts|puffiness|crashes|fatigue|cansaço|low energy|don't have to|isn't your fault/i.test(cap)) return "sintoma-biomarker";
  if (/new knowledge|this week|learn how|guide|the more you know|what you need/i.test(cap)) return "newsletter-curadoria";
  if (/mitochondria|epigenetic|biological age|cell|biology|aging|gestation|telomere/i.test(cap)) return "ciencia-profunda";
  if (/soulcycle|equinox|crossfit|psl|holiday|every choice|vote|miles|optimize/i.test(cap)) return "lifestyle-premium";
  return "biomarker-stat"; // default: faixa + número
}

const PATTERN_BRIEFS: Record<Pattern, string> = {
  "manifesto": `Padrão: MANIFESTO CURTO (Superpower-coded).
- Declaração filosófica em 1-2 frases, sem dado, alta carga emocional
- 3-5 slides com punchy statements + cor de fundo única + tipografia grande
- Voz Aesop-poster: poucas palavras, espaço respira
- CTA implícito (não imperativo)`,

  "sintoma-biomarker": `Padrão: SINTOMA → BIOMARCADOR ESCONDIDO (Mito-coded).
- Slide 1: sintoma reconhecível como hook (ex: "Cansaço sem causa", "Brain fog")
- Slide 2: tensão — laudo "normal" mas algo está fora
- Slide 3: biomarcador escondido revelado (ex: ferritina, hs-CRP, T3 reverso) com FAIXA FUNCIONAL gold
- Slide 4: 3-4 sinais corporais reconhecíveis adicionais
- Slide 5: CTA "Painel Longevify mede o que o exame de rotina não pede"
- Pilar 2 puro`,

  "newsletter-curadoria": `Padrão: CURADORIA DA SEMANA (Function-coded).
- Carrossel 5-6 slides com 1 insight científico por slide
- Cada slide: número/dado + 1 frase contexto + atribuição (paper/autor se possível)
- Slide final: "Curadoria Longevify · semana N · link na bio"
- Voz Mito (precisão científica)`,

  "ciencia-profunda": `Padrão: CIÊNCIA PROFUNDA (Timeline-coded).
- 5-6 slides aprofundando 1 mecanismo biológico (ex: mitocondria, idade biológica)
- Slide 1: hook contra-intuitivo
- Slides 2-4: ciência em camadas (cell → tissue → organism)
- Slide 5: implicação prática Longevify
- Visual editorial premium, números científicos em gold`,

  "lifestyle-premium": `Padrão: LIFESTYLE PREMIUM + TÉCNICA (Superpower-coded).
- Conecta cultura aspiracional (Equinox/CrossFit/spa) com biomarker técnico
- Slide 1: cena cultural reconhecível (executiva-atleta)
- Slide 2-3: tradução técnica (que biomarker tá em jogo nessa cultura)
- Slide 4: faixa funcional do biomarker
- Slide 5: CTA pra exame Longevify`,

  "biomarker-stat": `Padrão: BIOMARCADOR + ESTATÍSTICA BR (Mito-coded).
- 5 slides curtos
- Slide 1: número-âncora gigante (ex: "70% dos brasileiros < 30 ng/mL")
- Slide 2: o que significa o número
- Slide 3: faixa funcional vs populacional
- Slide 4: sintoma típico associado
- Slide 5: CTA pra painel Longevify`,
};

// ─── Build run from bookmark ──────────────────────────────────────────────────
function buildRunFromBookmark(post: ApifyPost): string {
  const date = todayDate();
  const seq = String(nextSeqForDate(date)).padStart(3, "0");
  const firstLine = (post.caption || "").split("\n")[0];
  const slug = slugify(firstLine, 5) || `${post.brand?.toLowerCase().replace(/\s/g, "-")}-${post.shortCode ?? "post"}`;
  const runId = `${date}-${seq}-${slug}-bm`;
  const runDir = path.join(ROOT, "runs", runId);
  fs.mkdirSync(path.join(runDir, "assets"), { recursive: true });

  const pattern = matchPattern(post);
  const patternBrief = PATTERN_BRIEFS[pattern];

  // content-object.md
  // POLÍTICA 21/mai: SEMPRE carrossel — Matheus pediu não fazer reels por enquanto
  fs.writeFileSync(path.join(runDir, "content-object.md"), `---
id: ${runId}
route: bookmark-adapt
state: draft
pillar: 2
format: carousel
platforms: [instagram]
created_at: ${date}
updated_at: ${date}
next_action: verify
inspired_by_post: ${post.shortCode ?? post.id}-${post.brand?.toLowerCase().replace(/\s/g, "-")}
viral_multiplier: ${post.vsMedian?.toFixed(2) ?? "?"}
pattern: ${pattern}
---

# ${firstLine.slice(0, 80)}

## TL;DR
Adaptação Longevify pt-BR do post viral de ${post.brand} (${post.vsMedian?.toFixed(1)}x mediana).

## Why now
Bookmark prioritizado por Matheus. Pattern: ${pattern}.
`);

  // idea.md
  fs.writeFileSync(path.join(runDir, "idea.md"), `---
content_object: ${runId}
route_chosen: bookmark-adapt
route_reason: Adaptação BR do post viral ${post.brand} (${post.vsMedian?.toFixed(1)}x). Pattern: ${pattern}.
source: ${post.url ?? `https://instagram.com/p/${post.shortCode}`}
source_post_id: ${post.id}
hook_quality_score: ${Math.min(10, Math.round((post.vsMedian ?? 1) * 1.5))}
pillar_fit: 2
estimated_effort: 1
---

# Idea — adaptação BR

## Original (${post.brand} · ${post.vsMedian?.toFixed(1)}x)
${(post.caption ?? "").slice(0, 800)}

## Pattern detected
${pattern}

## Adaptação Longevify
Reescrever em pt-BR puro, voz Mito + Aesop, biomarker BR-mainstream se possível, ZERO persona excludente.
`);

  // brief.md
  fs.writeFileSync(path.join(runDir, "brief.md"), `---
content_object: ${runId}
format: carousel-5-slides
aspect: 4:5
voice: mito_aesop
language: pt-BR
foundation_loaded: [strategy.md, voice.md, pillars.md, master-avoid-slop.md]
---

# Brief — adaptação ${post.brand} ${post.vsMedian?.toFixed(1)}x

## Fonte original
${post.url ?? `https://instagram.com/p/${post.shortCode}`}

## Caption original (referência, NÃO copiar literal)
${(post.caption ?? "").slice(0, 1200)}

## Pattern: ${pattern}

${patternBrief}

## Voice constraints
- PT-BR puro, sem inglesismos exceto termos científicos consagrados (hs-CRP, ApoB)
- Mito (precisão técnica) + Aesop (restrição editorial)
- ZERO self-help, ZERO fear, ZERO promessa de cura
- ZERO persona excludente ("executivo paulistano que treina 5x") — usar referência ampla
- ZERO emoji decorativo, ZERO hashtag

## Estrutura
- 5 slides 4:5 (1080x1350)
- Slide 1: hook punch (max 6 palavras)
- Slide 2-4: desenvolvimento
- Slide 5: CTA editorial (link na bio)
- NÃO FAZER REEL. Sempre carrossel.

## Anti-slop
- NUNCA copiar literal o post original — adaptar voz Longevify
- NUNCA usar dados não-verificáveis
- NUNCA mencionar marca concorrente

## Verifier targets
- Pillar alignment ≥ 2/3
- Voice alignment ≥ 2/3
- Avoid-slop pass 3/3
- Hook strength ≥ 2/3
- Total ≥ 9/12
`);

  // feedback.md (empty placeholder)
  fs.writeFileSync(path.join(runDir, "feedback.md"), `# Feedback — ${runId}\n\n(vazio — preencher após aprovação)\n`);

  return runId;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let limit = 5;
  let dryRun = false;
  let specificPostId = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit") limit = parseInt(args[++i], 10);
    else if (args[i] === "--dry-run") dryRun = true;
    else if (args[i] === "--postId") specificPostId = args[++i];
  }

  const bookmarks = loadBookmarks();
  const drafted = loadDrafted();
  const allPosts = loadAllPosts();

  let pending: string[];
  if (specificPostId) {
    pending = [specificPostId];
  } else {
    pending = bookmarks.filter((id) => !drafted[id]).slice(0, limit);
  }

  console.log(`🔖 Bookmarks total: ${bookmarks.length}`);
  console.log(`✓ Já draftados: ${Object.keys(drafted).length}`);
  console.log(`→ Processando: ${pending.length}\n`);

  let success = 0, failed = 0;
  for (const postId of pending) {
    const post = allPosts.get(postId);
    if (!post) {
      console.log(`  ❌ ${postId} — não achei no snapshot`);
      failed++;
      continue;
    }
    console.log(`\n📝 ${post.brand} (${post.vsMedian?.toFixed(1)}x) — ${(post.caption || "").split("\n")[0].slice(0, 60)}`);

    const runId = buildRunFromBookmark(post);
    console.log(`   Run: ${runId}`);
    console.log(`   Pattern: ${matchPattern(post)}`);

    if (dryRun) {
      console.log(`   (dry-run — pulando writer)`);
      continue;
    }

    try {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");
      console.log(`   → writer...`);
      execSync(`node --import tsx/esm scripts/writer.ts --run "${runId}"`, {
        cwd: ROOT,
        env: { ...process.env, ANTHROPIC_API_KEY: apiKey },
        stdio: "pipe",
      });
      console.log(`   ✓ draft gerado`);
      drafted[postId] = { runId, draftedAt: new Date().toISOString() };
      saveDrafted(drafted);
      success++;
    } catch (e) {
      console.log(`   ❌ writer falhou: ${(e as Error).message.slice(0, 150)}`);
      failed++;
    }
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`✓ Success: ${success} · ❌ Failed: ${failed}`);
  console.log(`📁 Drafts em runs/`);
}

main().catch((err) => {
  console.error("\n❌ Falhou:", err.message);
  process.exit(1);
});
