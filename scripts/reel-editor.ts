/**
 * reel-editor.ts — Compõe reel via ffmpeg combinando slides + áudio + transições.
 *
 * MVP: pega assets/slide-*.png (ou current do manifest), monta vídeo 9:16
 * (1080x1920) com:
 *   - Cada slide visível 3s
 *   - Fade entre slides 0.3s
 *   - Áudio: ambient track de assets/audio/ (1ª faixa encontrada) OU silêncio
 *   - Logo overlay no último frame
 *
 * Output: runs/<id>/assets/reel-final.mp4
 *
 * Pré-requisito: ffmpeg instalado (brew install ffmpeg)
 *
 * Uso:
 *   pnpm reel-editor --run <id>
 *   pnpm reel-editor --run <id> --slide-duration 4   # default 3s
 *   pnpm reel-editor --run <id> --audio path/to.mp3  # override audio
 */

import { execSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

interface Args {
  run: string;
  slideDuration: number;
  audio?: string;
  aspect: "9:16" | "4:5" | "1:1";
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Partial<Args> = { slideDuration: 3, aspect: "9:16" };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--run") out.run = args[++i];
    else if (a === "--slide-duration") out.slideDuration = parseFloat(args[++i]);
    else if (a === "--audio") out.audio = args[++i];
    else if (a === "--aspect") out.aspect = args[++i] as Args["aspect"];
  }
  if (!out.run) { console.error("Usage: pnpm reel-editor --run <id> [--slide-duration N] [--audio PATH] [--aspect 9:16|4:5|1:1]"); process.exit(1); }
  return out as Args;
}

function ensureFfmpeg(): void {
  try { execSync("ffmpeg -version", { stdio: "ignore" }); } catch {
    console.error("❌ ffmpeg não instalado. Roda: brew install ffmpeg");
    process.exit(1);
  }
}

function dimsForAspect(aspect: Args["aspect"]): [number, number] {
  if (aspect === "9:16") return [1080, 1920];
  if (aspect === "4:5") return [1080, 1350];
  return [1080, 1080];
}

function findSlides(runDir: string): string[] {
  const assetsDir = path.join(runDir, "assets");
  if (!fs.existsSync(assetsDir)) throw new Error("Sem assets/. Roda visual-gen primeiro.");
  const files = fs.readdirSync(assetsDir).filter((f) => /^slide-\d+-.+\.(png|jpg|jpeg)$/.test(f));
  const bySlide = new Map<number, string[]>();
  for (const f of files) {
    const n = parseInt(f.match(/^slide-(\d+)/)![1], 10);
    if (!bySlide.has(n)) bySlide.set(n, []);
    bySlide.get(n)!.push(path.join(assetsDir, f));
  }
  const picked: string[] = [];
  for (const n of [...bySlide.keys()].sort((a, b) => a - b)) {
    const cand = bySlide.get(n)!;
    const finals = cand.filter((c) => /-final\./.test(c));
    const pool = finals.length ? finals : cand;
    pool.sort((a, b) => versionNum(b) - versionNum(a));
    picked.push(pool[0]);
  }
  return picked;
}

function versionNum(f: string): number {
  const m = path.basename(f).match(/-v(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function findAudio(runDir: string, override?: string): string | null {
  if (override && fs.existsSync(override)) return override;
  const candidates = [
    path.join(runDir, "assets", "audio"),
    path.join(ROOT, "assets", "audio"),
    path.join(ROOT, "brands", "longevify", "assets", "audio"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) {
      const f = fs.readdirSync(dir).find((x) => /\.(mp3|wav|m4a)$/.test(x));
      if (f) return path.join(dir, f);
    }
  }
  return null;
}

function buildFfmpegCommand(slides: string[], audio: string | null, outPath: string, duration: number, dims: [number, number]): string[] {
  const [w, h] = dims;
  const args: string[] = ["-y"];

  // Inputs: cada slide com loop=1 + duração
  for (const s of slides) {
    args.push("-loop", "1", "-t", String(duration), "-i", s);
  }
  if (audio) args.push("-i", audio);

  // Filter complex: scale cada slide + concat com xfade
  const filter: string[] = [];
  for (let i = 0; i < slides.length; i++) {
    filter.push(`[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=30[v${i}]`);
  }

  // Concat com xfade 0.3s
  if (slides.length === 1) {
    filter.push(`[v0]copy[vout]`);
  } else {
    let prev = "v0";
    for (let i = 1; i < slides.length; i++) {
      const out = i === slides.length - 1 ? "vout" : `xf${i}`;
      const offset = i * duration - 0.3 * i;
      filter.push(`[${prev}][v${i}]xfade=transition=fade:duration=0.3:offset=${offset.toFixed(2)}[${out}]`);
      prev = out;
    }
  }

  args.push("-filter_complex", filter.join(";"));
  args.push("-map", "[vout]");
  if (audio) args.push("-map", `${slides.length}:a`, "-shortest");
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", outPath);
  return args;
}

async function main() {
  ensureFfmpeg();
  const args = parseArgs();
  const runDir = path.join(ROOT, "runs", args.run);
  if (!fs.existsSync(runDir)) throw new Error(`Run não existe: ${runDir}`);

  const slides = findSlides(runDir);
  if (!slides.length) throw new Error("Nenhum slide encontrado");
  console.log(`🎞️  ${slides.length} slides · duração: ${args.slideDuration}s cada`);

  const audio = findAudio(runDir, args.audio);
  console.log(`🎵  Audio: ${audio ? path.basename(audio) : "(silêncio)"}`);

  const dims = dimsForAspect(args.aspect);
  const outPath = path.join(runDir, "assets", `reel-${args.aspect.replace(":", "x")}-final.mp4`);

  const cmdArgs = buildFfmpegCommand(slides, audio, outPath, args.slideDuration, dims);
  console.log(`\n🎬 ffmpeg ...`);
  const r = spawnSync("ffmpeg", cmdArgs, { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`ffmpeg falhou (exit ${r.status})`);

  const sizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2);
  console.log(`\n✅ Reel: ${path.relative(ROOT, outPath)} (${sizeMB} MB)`);
  console.log(`   Publica com: pnpm publish --run ${args.run} --format reel`);
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
