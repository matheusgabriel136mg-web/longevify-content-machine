/**
 * thumb-cache.ts — Best-effort download of competitor post thumbnails.
 *
 * Le output/analysis- snapshots, tenta baixar cada thumbnail e salva em
 * output/analysis-<id>/thumbs/<postId>.jpg. IG CDN URLs expiram após algumas
 * horas/dias então alguns 404 são esperados.
 *
 * Servidor depois serve via /api/thumb com fallback pra essas locais.
 *
 * Uso:
 *   pnpm thumb-cache                  # roda no último snapshot
 *   pnpm thumb-cache --all-snapshots  # roda em todos
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

interface RawPost {
  id: string;
  shortCode?: string;
  displayUrl?: string;
  images?: string[];
}

function findSnapshots(allSnapshots: boolean): string[] {
  const outDir = path.join(ROOT, "output");
  if (!fs.existsSync(outDir)) return [];
  const all = fs.readdirSync(outDir).filter((d) => d.startsWith("analysis-")).sort();
  return allSnapshots ? all.map((d) => path.join(outDir, d)) : all.slice(-1).map((d) => path.join(outDir, d));
}

async function downloadOne(url: string, outPath: string): Promise<boolean> {
  try {
    const r = await fetch(url, {
      headers: {
        Referer: "https://www.instagram.com/",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36",
      },
    });
    if (!r.ok) return false;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 1000) return false; // pequeno demais = provavelmente erro
    fs.writeFileSync(outPath, buf);
    return true;
  } catch {
    return false;
  }
}

async function processSnapshot(dir: string): Promise<void> {
  const rawPath = path.join(dir, "raw-posts.json");
  if (!fs.existsSync(rawPath)) return;
  const posts = JSON.parse(fs.readFileSync(rawPath, "utf-8")) as RawPost[];
  const thumbsDir = path.join(dir, "thumbs");
  fs.mkdirSync(thumbsDir, { recursive: true });

  console.log(`\n📁 ${path.basename(dir)} · ${posts.length} posts`);
  let ok = 0;
  let skip = 0;
  let fail = 0;

  // Limita concorrência manual (10 por vez)
  const batchSize = 10;
  for (let i = 0; i < posts.length; i += batchSize) {
    const batch = posts.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (p) => {
        const id = p.id || p.shortCode;
        if (!id) return;
        const outPath = path.join(thumbsDir, `${id}.jpg`);
        if (fs.existsSync(outPath) && fs.statSync(outPath).size > 1000) { skip++; return; }
        const url = p.displayUrl ?? p.images?.[0];
        if (!url) { fail++; return; }
        const success = await downloadOne(url, outPath);
        if (success) ok++; else fail++;
      })
    );
    process.stdout.write(`\r  baixadas: ${ok} · skip: ${skip} · fail: ${fail}`);
  }
  process.stdout.write("\n");
  console.log(`✓ ${path.basename(dir)}: ${ok} novas, ${skip} já existentes, ${fail} falharam`);
}

async function main() {
  const args = process.argv.slice(2);
  const allSnapshots = args.includes("--all-snapshots");
  const snapshots = findSnapshots(allSnapshots);
  if (!snapshots.length) {
    console.log("Sem snapshots em output/. Rode analyze-instagrams primeiro.");
    process.exit(0);
  }
  for (const dir of snapshots) await processSnapshot(dir);
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
