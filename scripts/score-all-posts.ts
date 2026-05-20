/**
 * score-all-posts.ts — Roda TRIBE v2 em TODOS os posts da última análise
 * (skipping os que já têm brain-score). Output usado pra calibrar modelo.
 *
 * Uso: npm run -- score-all-posts [--limit=N]
 *
 * Otimizações:
 *  - Skip posts já scored (checa output/brain-scores/)
 *  - Single python call → TRIBE model carrega 1x
 *  - Stem único por post (brand-shortcode-vsMed) pra rastrear
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);

const TRIBEV2_PYTHON = path.resolve(ROOT, "..", "tribev2", ".venv311", "bin", "python");
const OPTIMIZER = path.join(__dirname, "viral-optimizer.py");
const TMP_DIR = path.join(ROOT, "output", "tmp-all-assets");
const BRAIN_OUT = path.join(ROOT, "output", "brain-scores");

const args = process.argv.slice(2);
const limit = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 0);

interface Post {
  brand: string;
  format: "image" | "carousel" | "reel";
  vsMedian: number;
  isViral: boolean;
  displayUrl?: string;
  shortCode?: string;
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

function buildStem(p: Post, idx: number): string {
  const brandSlug = p.brand.toLowerCase().replace(/\s+/g, "-");
  const slug = `${brandSlug}-${String(idx + 1).padStart(3, "0")}-${p.shortCode ?? "x"}-${p.vsMedian.toFixed(2)}x`;
  return slug.replace(/[^a-z0-9-]/g, "");
}

function alreadyScored(stem: string): boolean {
  if (!fs.existsSync(BRAIN_OUT)) return false;
  const files = fs.readdirSync(BRAIN_OUT);
  // big3 stems usam o padrão `superpower-01-...`, etc.
  // Aqui buscamos qualquer asset cujo stem seja substring do report name
  return files.some((f) => f.includes(stem) && f.endsWith("-analysis.md"));
}

async function downloadImage(url: string, outPath: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(outPath, buf);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const dir = findLatestAnalysisDir();
  const raw = JSON.parse(fs.readFileSync(path.join(dir, "raw-posts.json"), "utf-8")) as Post[];

  fs.mkdirSync(TMP_DIR, { recursive: true });

  console.log(`📁 raw-posts.json: ${raw.length} posts em ${path.basename(dir)}`);

  // Identifica posts a processar
  const todo: Array<{ post: Post; stem: string; assetPath: string }> = [];
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    if (!p.displayUrl) continue;
    const stem = buildStem(p, i);
    if (alreadyScored(stem)) continue;
    const assetPath = path.join(TMP_DIR, `${stem}.jpg`);
    todo.push({ post: p, stem, assetPath });
  }

  console.log(`🎯 ${todo.length} posts pendentes (já scored: ${raw.length - todo.length})`);
  if (limit > 0 && todo.length > limit) {
    console.log(`⚠️  --limit=${limit} aplicado: cortando a ${limit}`);
    todo.length = limit;
  }

  if (!todo.length) {
    console.log("✅ Nada a fazer — tudo já scored");
    return;
  }

  // Download em paralelo (network-bound, OK)
  console.log(`📥 Baixando ${todo.length} imagens…`);
  let downloaded = 0;
  const BATCH = 10;
  for (let i = 0; i < todo.length; i += BATCH) {
    const slice = todo.slice(i, i + BATCH);
    await Promise.all(
      slice.map(async (t) => {
        if (fs.existsSync(t.assetPath)) {
          downloaded++;
          return;
        }
        const ok = await downloadImage(t.post.displayUrl!, t.assetPath);
        if (ok) downloaded++;
      })
    );
    process.stdout.write(`\r  ${Math.min(i + BATCH, todo.length)}/${todo.length}`);
  }
  process.stdout.write(`\n  ${downloaded} baixadas com sucesso\n`);

  const valid = todo.filter((t) => fs.existsSync(t.assetPath));
  if (!valid.length) {
    console.error("❌ Nenhuma imagem baixada");
    process.exit(1);
  }

  console.log(`\n🧠 TRIBE v2 em ${valid.length} posts (CPU-bound, ~2-5 min/post)…`);
  console.log(`    ETA: ${Math.round(valid.length * 3)}-${Math.round(valid.length * 5)} min total`);
  console.log(`    Iniciado: ${new Date().toLocaleString("pt-BR")}\n`);

  const result = spawnSync(
    TRIBEV2_PYTHON,
    [OPTIMIZER, ...valid.map((t) => t.assetPath)],
    { stdio: "inherit", cwd: ROOT }
  );

  if (result.status !== 0) {
    console.error(`❌ viral-optimizer exit ${result.status}`);
    process.exit(1);
  }

  console.log(`\n✅ Brain-score em ${valid.length} posts completo`);
  console.log(`   Finalizado: ${new Date().toLocaleString("pt-BR")}`);
  console.log(`   Próximo: rodar 'calibrate.py' pra treinar modelo`);
}

main().catch((err) => {
  console.error("\n❌", err.message);
  process.exit(1);
});
