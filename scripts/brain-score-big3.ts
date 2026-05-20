/**
 * brain-score-big3.ts — TRIBE v2 nos virais dos 3 concorrentes.
 *
 * O que faz:
 *   1. Lê raw-posts.json (do output mais recente)
 *   2. Filtra top N virais por marca (Superpower, Mito Health, Function Health)
 *   3. Baixa displayUrl de cada post para tmp/
 *   4. Roda viral-optimizer.py em todos os assets
 *   5. Lê os relatórios gerados, extrai scores, monta tabela comparativa por marca
 *
 * Custo: zero $ (modelo local, weights já cacheados)
 * Tempo: ~30s-2min por inferência → top5 × 3 marcas = 15 posts → ~15-30 min total
 *
 * Uso:
 *   npm run -- brain-score-big3                 # default: top 5 por marca
 *   npm run -- brain-score-big3 -- --top=10     # top 10
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);

const TRIBEV2_PYTHON = path.resolve(ROOT, "..", "tribev2", ".venv311", "bin", "python");
const OPTIMIZER = path.join(__dirname, "viral-optimizer.py");
const TMP_DIR = path.join(ROOT, "output", "tmp-big3-assets");
const BRAIN_OUT = path.join(ROOT, "output", "brain-scores");

const BRANDS = ["Superpower", "Mito Health", "Function Health"];

const args = process.argv.slice(2);
const topN = Number(args.find((a) => a.startsWith("--top="))?.split("=")[1] ?? 5);

interface Post {
  brand: string;
  format: "image" | "carousel" | "reel";
  vsMedian: number;
  isViral: boolean;
  displayUrl?: string;
  shortCode?: string;
  url?: string;
  caption?: string;
}

function findLatestAnalysisDir(): string {
  const dirs = fs
    .readdirSync(path.join(ROOT, "output"))
    .filter((n) => n.startsWith("analysis-"))
    .sort();
  if (!dirs.length) throw new Error("Nenhuma pasta analysis-*");
  return path.join(ROOT, "output", dirs[dirs.length - 1]);
}

async function downloadImage(url: string, outPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buf);
}

interface Scores {
  visual: number;
  emotion: number;
  memory: number;
  social: number;
  viral: number;
}

function parseReport(reportPath: string): Scores | null {
  const text = fs.readFileSync(reportPath, "utf-8");
  const get = (label: string): number | null => {
    const m = text.match(new RegExp(`\\| ${label} \\| (\\d+)/100`));
    return m ? Number(m[1]) : null;
  };
  const viralM = text.match(/Viral Score: (\d+)\/100/);
  const v = viralM ? Number(viralM[1]) : null;
  const visual = get("Atenção visual");
  const emotion = get("Resposta emocional");
  const memory = get("Memorabilidade");
  const social = get("Engajamento social");
  if ([v, visual, emotion, memory, social].some((x) => x === null)) return null;
  return { viral: v!, visual: visual!, emotion: emotion!, memory: memory!, social: social! };
}

function findReport(stem: string): string | null {
  const files = fs
    .readdirSync(BRAIN_OUT)
    .filter((f) => f.endsWith(`-${stem}-analysis.md`))
    .sort();
  if (!files.length) return null;
  return path.join(BRAIN_OUT, files[files.length - 1]);
}

async function main() {
  const dir = findLatestAnalysisDir();
  console.log(`📁 Analisando virais de: ${path.basename(dir)}`);
  console.log(`🎯 Top ${topN} virais por marca`);

  const raw = JSON.parse(fs.readFileSync(path.join(dir, "raw-posts.json"), "utf-8")) as Post[];

  fs.mkdirSync(TMP_DIR, { recursive: true });

  // Selectiona top N virais por marca
  const selected: Array<Post & { _stem: string; _path: string }> = [];
  for (const brand of BRANDS) {
    const virals = raw
      .filter((p) => p.brand === brand && p.isViral && p.displayUrl)
      .sort((a, b) => b.vsMedian - a.vsMedian)
      .slice(0, topN);
    console.log(`  ${brand}: ${virals.length} virais selecionados (top ${topN})`);
    for (let i = 0; i < virals.length; i++) {
      const p = virals[i];
      const slug = `${brand.toLowerCase().replace(/\s+/g, "-")}-${String(i + 1).padStart(2, "0")}-${p.shortCode ?? "x"}-${p.vsMedian.toFixed(1)}x`;
      const stem = slug.replace(/[^a-z0-9-]/g, "");
      const filePath = path.join(TMP_DIR, `${stem}.jpg`);
      selected.push({ ...p, _stem: stem, _path: filePath });
    }
  }
  console.log(`📥 Baixando ${selected.length} imagens…`);

  for (let i = 0; i < selected.length; i++) {
    const p = selected[i];
    if (fs.existsSync(p._path)) {
      process.stdout.write(`  [${i + 1}/${selected.length}] ${p._stem} (cache)\n`);
      continue;
    }
    try {
      await downloadImage(p.displayUrl!, p._path);
      process.stdout.write(`  [${i + 1}/${selected.length}] ${p._stem} ✅\n`);
    } catch (err) {
      process.stdout.write(`  [${i + 1}/${selected.length}] ${p._stem} ❌ ${(err as Error).message}\n`);
    }
  }

  const validAssets = selected.filter((p) => fs.existsSync(p._path));
  if (!validAssets.length) {
    throw new Error("Nenhum asset baixado com sucesso");
  }

  console.log(`\n🧠 Rodando TRIBE v2 em ${validAssets.length} assets…`);
  console.log(`    (~30s-2min por inferência em CPU — total estimado: ${validAssets.length}-${validAssets.length * 2} min)`);

  // Roda em batch — passa todos os paths como args
  const result = spawnSync(
    TRIBEV2_PYTHON,
    [OPTIMIZER, ...validAssets.map((p) => p._path)],
    { stdio: "inherit", cwd: ROOT }
  );

  if (result.status !== 0) {
    console.error(`❌ viral-optimizer.py exit ${result.status}`);
    process.exit(1);
  }

  // Lê os reports e extrai scores
  console.log("\n📊 Aglutinando resultados por marca…");
  const byBrand = new Map<string, Array<{ post: Post; scores: Scores; stem: string }>>();
  for (const p of validAssets) {
    const reportPath = findReport(p._stem);
    if (!reportPath) {
      console.warn(`  ⚠️  Sem relatório pra ${p._stem}`);
      continue;
    }
    const scores = parseReport(reportPath);
    if (!scores) {
      console.warn(`  ⚠️  Falha ao parsear ${reportPath}`);
      continue;
    }
    const list = byBrand.get(p.brand) ?? [];
    list.push({ post: p, scores, stem: p._stem });
    byBrand.set(p.brand, list);
  }

  // Monta markdown comparativo
  const lines: string[] = [];
  lines.push("# Brain Score — Big 3 (TRIBE v2)");
  lines.push("");
  lines.push(`> Top ${topN} virais por marca · ${new Date().toLocaleString("pt-BR")}`);
  lines.push("");
  lines.push("## Resumo por marca");
  lines.push("");
  lines.push("| Marca | N | Viral médio | Atenção | Emoção | Memória | Social |");
  lines.push("|-------|---|------------:|--------:|-------:|--------:|-------:|");

  const brandSummary: Array<{ brand: string; avg: Scores; n: number }> = [];
  for (const brand of BRANDS) {
    const items = byBrand.get(brand) ?? [];
    if (!items.length) continue;
    const avg: Scores = {
      visual: items.reduce((s, x) => s + x.scores.visual, 0) / items.length,
      emotion: items.reduce((s, x) => s + x.scores.emotion, 0) / items.length,
      memory: items.reduce((s, x) => s + x.scores.memory, 0) / items.length,
      social: items.reduce((s, x) => s + x.scores.social, 0) / items.length,
      viral: items.reduce((s, x) => s + x.scores.viral, 0) / items.length,
    };
    brandSummary.push({ brand, avg, n: items.length });
    lines.push(
      `| **${brand}** | ${items.length} | ${avg.viral.toFixed(0)} | ${avg.visual.toFixed(0)} | ${avg.emotion.toFixed(0)} | ${avg.memory.toFixed(0)} | ${avg.social.toFixed(0)} |`
    );
  }

  lines.push("");
  lines.push("## Detalhe por post");
  for (const brand of BRANDS) {
    const items = (byBrand.get(brand) ?? []).sort((a, b) => b.scores.viral - a.scores.viral);
    if (!items.length) continue;
    lines.push("");
    lines.push(`### ${brand}`);
    lines.push("");
    lines.push("| vs.med | Formato | Viral | Atn | Emo | Mem | Soc | Hook | Link |");
    lines.push("|-------:|---------|------:|----:|----:|----:|----:|------|------|");
    for (const x of items) {
      const hook = (x.post.caption ?? "").split("\n")[0].slice(0, 60).replace(/\|/g, "\\|");
      const link = x.post.url ?? `https://instagram.com/p/${x.post.shortCode}`;
      lines.push(
        `| ${x.post.vsMedian.toFixed(2)}x | ${x.post.format} | **${x.scores.viral}** | ${x.scores.visual} | ${x.scores.emotion} | ${x.scores.memory} | ${x.scores.social} | ${hook} | [↗](${link}) |`
      );
    }
  }

  lines.push("");
  lines.push("## Insights");
  lines.push("");
  if (brandSummary.length === BRANDS.length) {
    const winnerViral = [...brandSummary].sort((a, b) => b.avg.viral - a.avg.viral)[0];
    const winnerEmotion = [...brandSummary].sort((a, b) => b.avg.emotion - a.avg.emotion)[0];
    const winnerSocial = [...brandSummary].sort((a, b) => b.avg.social - a.avg.social)[0];
    const winnerVisual = [...brandSummary].sort((a, b) => b.avg.visual - a.avg.visual)[0];
    const winnerMemory = [...brandSummary].sort((a, b) => b.avg.memory - a.avg.memory)[0];
    lines.push(`- 🏆 Maior viral score médio: **${winnerViral.brand}** (${winnerViral.avg.viral.toFixed(0)}/100)`);
    lines.push(`- 👁️  Mais atenção visual: **${winnerVisual.brand}** (${winnerVisual.avg.visual.toFixed(0)}/100)`);
    lines.push(`- ❤️  Maior emoção: **${winnerEmotion.brand}** (${winnerEmotion.avg.emotion.toFixed(0)}/100)`);
    lines.push(`- 🧠 Mais memorável: **${winnerMemory.brand}** (${winnerMemory.avg.memory.toFixed(0)}/100)`);
    lines.push(`- 🤝 Mais social: **${winnerSocial.brand}** (${winnerSocial.avg.social.toFixed(0)}/100)`);
  }

  const outPath = path.join(findLatestAnalysisDir(), `brain-score-big3-top${topN}.md`);
  fs.writeFileSync(outPath, lines.join("\n"), "utf-8");
  console.log(`\n✅ Relatório aglutinado: ${outPath}`);
}

main().catch((err) => {
  console.error("\n❌", err.message);
  process.exit(1);
});
