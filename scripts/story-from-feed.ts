/**
 * story-from-feed.ts — Gera backlog de stories adaptadas dos posts virais SP/Mito.
 *
 * Workflow:
 *   1. Lê raw-posts.json do snapshot mais recente
 *   2. Filtra: format=image OU primeiro slide de carousel (cover)
 *   3. Ranqueia por vsMedian desc
 *   4. Pra cada top N: Claude adapta hook pro tom Longevify pt-BR
 *   5. Higgsfield gera visual 9:16 (1080x1920) ultra-sofisticado em paleta forest+gold
 *   6. Salva em runs/_stories-backlog/YYYY-MM-DD-<n>-<slug>/
 *
 * Output: backlog de N stories prontos pra revisar/postar.
 *
 * Uso:
 *   pnpm story-from-feed --count 14                  # gera 14 stories
 *   pnpm story-from-feed --count 7 --brand Mito      # só Mito Health
 *   pnpm story-from-feed --dry-run --count 5         # só captions, sem visual
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

interface Args {
  count: number;
  brand?: string;
  dryRun: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Args = { count: 14, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--count") out.count = parseInt(args[++i], 10);
    else if (a === "--brand") out.brand = args[++i];
    else if (a === "--dry-run") out.dryRun = true;
  }
  return out;
}

interface RawPost {
  id: string;
  brand?: string;
  caption?: string;
  format?: "image" | "carousel" | "reel";
  vsMedian?: number;
  url?: string;
  shortCode?: string;
}

interface StoryDraft {
  source_post_id: string;
  source_brand: string;
  source_vsmedian: number;
  source_url: string;
  source_format: string;
  original_caption_excerpt: string;
  adapted_hook: string;
  adapted_subline: string;
  visual_prompt: string;
  caption_pt: string;
  why_this_works: string;
}

function findLatestAnalysis(): string {
  const outDir = path.join(ROOT, "output");
  const dirs = fs.readdirSync(outDir).filter((d) => d.startsWith("analysis-")).sort();
  if (!dirs.length) throw new Error("Sem snapshot em output/analysis-*");
  return path.join(outDir, dirs[dirs.length - 1]);
}

function loadCandidates(brand?: string): RawPost[] {
  const dir = findLatestAnalysis();
  const posts = JSON.parse(fs.readFileSync(path.join(dir, "raw-posts.json"), "utf-8")) as RawPost[];
  const brandFilter = brand ? [brand] : ["Superpower", "Mito Health"];
  // Filtra: single image OU carousel (Apify só guarda a cover = OK)
  return posts
    .filter((p) => p.brand && brandFilter.includes(p.brand))
    .filter((p) => p.format !== "reel") // stories vêm de single ou carousel cover, não de reel
    .filter((p) => (p.vsMedian ?? 0) >= 1.2) // só posts acima da média
    .sort((a, b) => (b.vsMedian ?? 0) - (a.vsMedian ?? 0));
}

async function adaptStory(post: RawPost): Promise<StoryDraft> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Carrega voice preferences pra Claude saber o tom
  const voicePrefs = fs.existsSync(path.join(ROOT, "foundation", "voice-preferences.md"))
    ? fs.readFileSync(path.join(ROOT, "foundation", "voice-preferences.md"), "utf-8").slice(0, 4000)
    : "";

  const prompt = `Você é o adapter de stories da Longevify. Pegue o post viral da ${post.brand} abaixo e adapte pra uma story Longevify ultra-sofisticada em pt-BR.

# Voice preferences Longevify (regras aprendidas)
${voicePrefs}

# Post original
Marca: ${post.brand}
Format: ${post.format}
vsMedian: ${post.vsMedian?.toFixed(2)}x
Caption (primeiras 600 chars): ${(post.caption ?? "").slice(0, 600)}

# Sua tarefa
Crie uma story 9:16 Longevify adaptada. NÃO traduza literal — REINTERPRETE o ângulo.

Retorne JSON puro (sem markdown):
{
  "adapted_hook": "1 frase pt-BR, max 12 palavras, com palavra-pivô em italic (marca com *asteriscos*). Tom Mito+Aesop.",
  "adapted_subline": "1-2 frases pt-BR complementando o hook, max 20 palavras, off-white 60% opacity",
  "visual_prompt": "Prompt detalhado em INGLÊS pra Higgsfield gerar imagem 9:16 (1080x1920). Paleta: deep forest #000F08 background, off-white #f8fffc text, gold #C89136 accent. Tipografia: DM Sans Light (NUNCA serif). Composição centralizada vertical (text block ocupa center 60% canvas, 20% top + 20% bottom em forest preto). Bottom 15% reservado pra logo overlay (NÃO desenhar logo, deixar espaço vazio). Anti: pure white, red, amber, orange, drop shadows, neon, pessoas, faces, hands, medical icons.",
  "caption_pt": "Caption pt-BR pra acompanhar a story (200-400 chars). 1 frase hook + 1-2 frases contextualizando + CTA implícito.",
  "why_this_works": "1-2 frases por que esse adaptamento funciona pro ICP brasileiro premium."
}

CRÍTICO:
- adapted_hook NÃO pode citar dados americanos sem adaptação (RDA proteína EUA, %s americanos, etc.) — substitua por dado brasileiro OR linguagem universal
- Visual prompt deve incluir EXPLICITAMENTE o texto pt-BR adaptado pra Higgsfield renderizar
- Adaptação cultural obrigatória: "call your mom" → "ligue pra sua mãe"; "annual physical" → "check-up anual"; etc.`;

  const msg = await anthropic.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 2500,
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
  const jm = text.match(/\{[\s\S]*\}/);
  if (!jm) throw new Error("Claude não retornou JSON:\n" + text);
  const parsed = JSON.parse(jm[0]);

  return {
    source_post_id: post.id,
    source_brand: post.brand ?? "?",
    source_vsmedian: post.vsMedian ?? 0,
    source_url: post.url ?? `https://instagram.com/p/${post.shortCode ?? ""}`,
    source_format: post.format ?? "image",
    original_caption_excerpt: (post.caption ?? "").slice(0, 200),
    ...parsed,
  };
}

async function generateVisual(draft: StoryDraft, outPath: string): Promise<boolean> {
  try {
    const cmd = `higgsfield generate create nano_banana_2 --prompt ${JSON.stringify(draft.visual_prompt)} --aspect_ratio 9:16 --resolution 2k --wait`;
    const out = execSync(cmd, { encoding: "utf-8", timeout: 300_000 });
    const m = out.match(/https?:\/\/\S+\.(png|jpg|jpeg)/);
    if (!m) return false;
    execSync(`curl -sL "${m[0]}" -o ${JSON.stringify(outPath)}`);
    return fs.existsSync(outPath) && fs.statSync(outPath).size > 10000;
  } catch (e) {
    console.error(`  ❌ Higgsfield fail: ${(e as Error).message.slice(0, 200)}`);
    return false;
  }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY ausente");
  const args = parseArgs();

  const candidates = loadCandidates(args.brand);
  console.log(`📥 ${candidates.length} candidatos (vsMedian ≥ 1.2x)`);
  if (!candidates.length) { console.log("Sem candidatos."); return; }

  const picks = candidates.slice(0, args.count);
  console.log(`🎯 Adaptando top ${picks.length}...`);

  const backlogDir = path.join(ROOT, "runs", "_stories-backlog");
  fs.mkdirSync(backlogDir, { recursive: true });

  const today = new Date().toISOString().slice(0, 10);
  const summary: any[] = [];

  for (let i = 0; i < picks.length; i++) {
    const post = picks[i];
    const num = String(i + 1).padStart(2, "0");
    const slug = crypto.createHash("md5").update(post.id).digest("hex").slice(0, 8);
    const storyDir = path.join(backlogDir, `${today}-${num}-${slug}`);
    fs.mkdirSync(storyDir, { recursive: true });

    console.log(`\n[${i + 1}/${picks.length}] ${post.brand} · ${post.vsMedian?.toFixed(1)}x`);

    let draft: StoryDraft;
    try {
      draft = await adaptStory(post);
      console.log(`  → "${draft.adapted_hook}"`);
    } catch (e) {
      console.error(`  ❌ adapt fail: ${(e as Error).message.slice(0, 100)}`);
      continue;
    }

    fs.writeFileSync(path.join(storyDir, "draft.json"), JSON.stringify(draft, null, 2));
    fs.writeFileSync(path.join(storyDir, "visual-prompt.txt"), draft.visual_prompt);

    if (!args.dryRun) {
      const imgPath = path.join(storyDir, "story.png");
      const ok = await generateVisual(draft, imgPath);
      if (ok) console.log(`  ✓ visual ok (${(fs.statSync(imgPath).size / 1024).toFixed(0)}KB)`);
      else console.log(`  ⚠️  visual falhou — re-rodar manualmente`);
    }

    summary.push({
      story: `${today}-${num}-${slug}`,
      source_brand: draft.source_brand,
      source_vsmedian: draft.source_vsmedian,
      hook: draft.adapted_hook,
    });
  }

  const summaryPath = path.join(backlogDir, `${today}-summary.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  console.log(`\n📁 ${path.relative(ROOT, backlogDir)}/`);
  console.log(`   ${summary.length} stories no backlog`);
  console.log(`   summary: ${path.relative(ROOT, summaryPath)}`);
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
