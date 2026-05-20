/**
 * build-dashboard.ts — junta visual-dna + raw-posts em dashboard-data.json
 * pra alimentar o dashboard estático.
 *
 * Uso: npm run build-dashboard
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);

interface RawPost {
  url?: string;
  shortCode?: string;
  displayUrl?: string;
  videoUrl?: string;
  images?: string[];
  childPosts?: Array<{ displayUrl?: string }>;
}

interface VisualDna {
  url: string;
  brand: string;
  format: "image" | "carousel" | "reel";
  vsMedian: number;
  caption: string;
  hookLine: string;
  primary: {
    composition: string;
    palette: string[];
    subject: string;
    textOverlay: string | null;
    mood: string;
    style: string;
    hookSignal: string;
    prompt: string;
    artDirection?: string;
  };
  slides?: Array<Record<string, unknown>>;
  meta: { isReelCover: boolean; richModel?: string };
}

function findLatestAnalysisDir(): string {
  const dirs = fs
    .readdirSync(path.join(ROOT, "output"))
    .filter((n) => n.startsWith("analysis-"))
    .sort();
  if (!dirs.length) throw new Error("Nenhuma pasta analysis-*");
  return path.join(ROOT, "output", dirs[dirs.length - 1]);
}

const IMAGES_DIR = path.join(ROOT, "dashboard-images");
const IMAGES_DIR_REL = "./dashboard-images"; // path relativo ao dashboard.html

function shortCodeFromUrl(url: string): string {
  const m = url.match(/\/p\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : url.split("/").pop()?.split("?")[0] ?? "unknown";
}

async function downloadIfMissing(url: string, dest: string): Promise<boolean> {
  if (fs.existsSync(dest)) return true;
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const dir = findLatestAnalysisDir();
  console.log(`📁 ${path.basename(dir)}`);

  fs.mkdirSync(IMAGES_DIR, { recursive: true });

  const raw = JSON.parse(fs.readFileSync(path.join(dir, "raw-posts.json"), "utf-8")) as RawPost[];
  const rawByUrl = new Map<string, RawPost>();
  for (const p of raw) {
    if (p.url) rawByUrl.set(p.url, p);
    if (p.shortCode) rawByUrl.set(`https://www.instagram.com/p/${p.shortCode}/`, p);
    if (p.shortCode) rawByUrl.set(`https://instagram.com/p/${p.shortCode}`, p);
  }

  const merged: Array<VisualDna & {
    displayUrl?: string;
    localImage?: string;
    videoUrl?: string;
    images?: string[];
    childImages?: string[];
    isRich: boolean;
  }> = [];

  let toDownload: Array<{ url: string; dest: string; setLocal: (p: string) => void }> = [];

  for (const [brandSlug, baseFile] of [
    ["superpower", "visual-dna-superpower"],
    ["mito-health", "visual-dna-mito-health"],
    ["function-health", "visual-dna-function-health"],
  ]) {
    // Carrega arquivo principal + qualquer split por formato (-reel, -carousel, -image)
    const candidates = [
      `${baseFile}.json`,
      `${baseFile}-reel.json`,
      `${baseFile}-carousel.json`,
      `${baseFile}-image.json`,
    ];
    const allDnas = new Map<string, VisualDna>();
    for (const fileName of candidates) {
      const filePath = path.join(dir, fileName);
      if (!fs.existsSync(filePath)) continue;
      const arr = JSON.parse(fs.readFileSync(filePath, "utf-8")) as VisualDna[];
      for (const d of arr) {
        // Última escrita ganha (arquivos -reel/-carousel são adicionais ao principal)
        const existing = allDnas.get(d.url);
        // Prefere o que tem richModel (GPT-5 v2)
        if (!existing || (d.meta?.richModel && !existing.meta?.richModel)) {
          allDnas.set(d.url, d);
        }
      }
    }
    if (!allDnas.size) {
      console.log(`  ⚠️  ${baseFile}*.json ausente — pula`);
      continue;
    }
    const dnas = [...allDnas.values()];
    console.log(`  ${brandSlug}: ${dnas.length} posts (mergeados de ${candidates.filter(c => fs.existsSync(path.join(dir, c))).length} arquivos)`);

    for (const d of dnas) {
      const rawMatch = rawByUrl.get(d.url);
      const childImages = rawMatch?.childPosts?.map((c) => c.displayUrl).filter(Boolean) as string[] | undefined;
      const sc = rawMatch?.shortCode ?? shortCodeFromUrl(d.url);
      const item: VisualDna & {
        displayUrl?: string;
        localImage?: string;
        videoUrl?: string;
        images?: string[];
        childImages?: string[];
        isRich: boolean;
      } = {
        ...d,
        displayUrl: rawMatch?.displayUrl,
        videoUrl: rawMatch?.videoUrl,
        images: rawMatch?.images,
        childImages,
        isRich: !!d.meta.richModel,
      };
      if (rawMatch?.displayUrl) {
        const fileName = `${brandSlug}-${sc}.jpg`;
        const destAbs = path.join(IMAGES_DIR, fileName);
        const destRel = `${IMAGES_DIR_REL}/${fileName}`;
        // Sempre seta o caminho local (mesmo se não baixado ainda — vamos baixar agora)
        item.localImage = destRel;
        toDownload.push({
          url: rawMatch.displayUrl,
          dest: destAbs,
          setLocal: () => {}, // já setado acima
        });
      }
      merged.push(item);
    }
  }

  // Download paralelo em batches
  console.log(`\n📥 Baixando ${toDownload.length} imagens (cache hits pulados)…`);
  const BATCH = 12;
  let done = 0, failed = 0;
  for (let i = 0; i < toDownload.length; i += BATCH) {
    const slice = toDownload.slice(i, i + BATCH);
    const results = await Promise.all(slice.map((t) => downloadIfMissing(t.url, t.dest)));
    for (const ok of results) {
      if (ok) done++;
      else failed++;
    }
    process.stdout.write(`\r  ${Math.min(i + BATCH, toDownload.length)}/${toDownload.length} (${done} ok, ${failed} fail)`);
  }
  process.stdout.write("\n");

  // Marca posts cuja imagem não baixou: zera localImage
  for (const item of merged) {
    if (item.localImage) {
      const abs = path.join(ROOT, item.localImage.replace("./", ""));
      if (!fs.existsSync(abs)) item.localImage = undefined;
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    analysisDir: path.basename(dir),
    total: merged.length,
    posts: merged,
  };

  const outPath = path.join(ROOT, "dashboard-data.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n✅ ${path.basename(outPath)} (${(JSON.stringify(out).length / 1024).toFixed(0)}KB · ${merged.length} posts · ${done} imgs cacheadas)`);
}

main();
