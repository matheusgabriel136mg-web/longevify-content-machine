/**
 * sample-non-virals.ts — Amostra 15 não-virais estratificados por marca
 * e roda viral-optimizer.py neles. Usado como contraste pro big3 (virais)
 * pra termos labeled samples (15 viral + 15 non-viral) na calibração.
 *
 * Uso: npm run -- sample-non-virals
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);

const TRIBEV2_PYTHON = path.resolve(ROOT, "..", "tribev2", ".venv311", "bin", "python");
const OPTIMIZER = path.join(__dirname, "viral-optimizer.py");
const TMP_DIR = path.join(ROOT, "output", "tmp-non-virals-assets");

const BRANDS = ["Superpower", "Mito Health", "Function Health"];
const PER_BRAND = 5; // 5 × 3 marcas = 15
const MAX_VS_MEDIAN = 1.5; // só não-virais

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

function pickRandom<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  while (out.length < n && copy.length) {
    const i = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(i, 1)[0]);
  }
  return out;
}

async function main() {
  const dir = findLatestAnalysisDir();
  const raw = JSON.parse(fs.readFileSync(path.join(dir, "raw-posts.json"), "utf-8")) as Post[];

  fs.mkdirSync(TMP_DIR, { recursive: true });

  const selected: Array<Post & { _stem: string; _path: string }> = [];
  for (const brand of BRANDS) {
    const candidates = raw.filter(
      (p) => p.brand === brand && !p.isViral && p.vsMedian < MAX_VS_MEDIAN && p.vsMedian > 0 && p.displayUrl
    );
    const picks = pickRandom(candidates, PER_BRAND);
    console.log(`  ${brand}: ${picks.length}/${candidates.length} não-virais sorteados`);
    for (let i = 0; i < picks.length; i++) {
      const p = picks[i];
      const slug = `nv-${brand.toLowerCase().replace(/\s+/g, "-")}-${String(i + 1).padStart(2, "0")}-${p.shortCode ?? "x"}-${p.vsMedian.toFixed(2)}x`;
      const stem = slug.replace(/[^a-z0-9-]/g, "");
      const filePath = path.join(TMP_DIR, `${stem}.jpg`);
      selected.push({ ...p, _stem: stem, _path: filePath });
    }
  }

  console.log(`\n📥 Baixando ${selected.length} imagens não-virais…`);
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

  const valid = selected.filter((p) => fs.existsSync(p._path));
  console.log(`\n🧠 TRIBE v2 em ${valid.length} não-virais…`);
  const result = spawnSync(
    TRIBEV2_PYTHON,
    [OPTIMIZER, ...valid.map((p) => p._path)],
    { stdio: "inherit", cwd: ROOT }
  );
  if (result.status !== 0) {
    console.error(`❌ exit ${result.status}`);
    process.exit(1);
  }
  console.log("\n✅ Brain-score em não-virais completo");
}

main().catch((err) => {
  console.error("\n❌", err.message);
  process.exit(1);
});
