/**
 * rebuild-md.ts — re-gera o markdown a partir do visual-dna-{brand}.json
 * incluindo os campos ricos do GPT-5 (artDirection) quando presentes.
 *
 * Uso:
 *   npm run -- rebuild-md superpower
 *   npm run -- rebuild-md mito-health
 *   npm run -- rebuild-md function-health
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);

const arg = process.argv[2];
if (!arg) throw new Error("Uso: rebuild-md <slug>  (superpower | mito-health | function-health)");

const slug = arg.toLowerCase();

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
  slides?: Array<{
    slideNum: number;
    role: string;
    composition: string;
    palette: string[];
    subject: string;
    textOverlay: string | null;
    mood: string;
    style: string;
    hookSignal: string;
    prompt: string;
  }>;
  meta: {
    isReelCover: boolean;
    analyzedAt: string;
    model: string;
    richModel?: string;
    richAt?: string;
  };
}

function findLatestAnalysisDir(): string {
  const dirs = fs
    .readdirSync(path.join(ROOT, "output"))
    .filter((n) => n.startsWith("analysis-"))
    .sort();
  if (!dirs.length) throw new Error("Nenhuma pasta analysis-*");
  return path.join(ROOT, "output", dirs[dirs.length - 1]);
}

function buildMd(dnas: VisualDna[]): string {
  const brand = dnas[0]?.brand ?? "—";
  const upgraded = dnas.filter((d) => d.meta.richModel).length;
  const lines: string[] = [];

  lines.push(`# Visual DNA — ${brand}`);
  lines.push("");
  lines.push(`> ${dnas.length} posts analisados · ${upgraded > 0 ? `**${upgraded} upgradeados com GPT-5 Vision** (prompts ricos + direção de arte)` : "Gemini 2.5 Flash"}`);
  lines.push(`> Gerado em ${new Date().toLocaleString("pt-BR")}`);
  lines.push("");

  // Stats
  const byFormat = dnas.reduce<Record<string, number>>((acc, d) => {
    acc[d.format] = (acc[d.format] ?? 0) + 1;
    return acc;
  }, {});
  lines.push(`**Formatos:** ${Object.entries(byFormat).map(([f, n]) => `${f}=${n}`).join(" · ")}`);
  lines.push("");

  // Ordena por vsMedian desc
  const sorted = [...dnas].sort((a, b) => b.vsMedian - a.vsMedian);

  for (const d of sorted) {
    const isRich = !!d.meta.richModel;
    const star = isRich ? "⭐" : "";
    lines.push(`---`);
    lines.push("");
    lines.push(`## ${star} [${d.format}] ${d.vsMedian.toFixed(2)}x — ${d.hookLine.slice(0, 90) || "(sem hook)"}`);
    lines.push("");
    lines.push(`**Link:** ${d.url}`);
    if (isRich) {
      lines.push(`**Modelo rico:** \`${d.meta.richModel}\` (${d.meta.richAt?.slice(0, 19) ?? "?"})`);
    }
    lines.push("");

    // Primary visual DNA
    lines.push(`### Visual DNA primário`);
    lines.push("");
    lines.push(`- **Composição:** ${d.primary.composition}`);
    lines.push(`- **Sujeito:** ${d.primary.subject}`);
    lines.push(`- **Mood:** ${d.primary.mood} · **Estilo:** ${d.primary.style}`);
    lines.push(`- **Paleta:** ${d.primary.palette.join(" · ")}`);
    if (d.primary.textOverlay) lines.push(`- **Texto na imagem:** "${d.primary.textOverlay}"`);
    if (d.meta.isReelCover) lines.push(`- *(análise é da capa do reel, não do vídeo interno)*`);
    lines.push("");

    lines.push(`### O que prende o olho`);
    lines.push("");
    lines.push(d.primary.hookSignal);
    lines.push("");

    // Prompt EN (rich quando upgradeado)
    lines.push(`### Prompt (reverse-engineered, EN)${isRich ? " — GPT-5" : ""}`);
    lines.push("");
    lines.push("```");
    lines.push(d.primary.prompt);
    lines.push("```");
    lines.push("");

    // Art direction (só rich)
    if (d.primary.artDirection) {
      lines.push(`### Direção de arte (PT)`);
      lines.push("");
      lines.push(d.primary.artDirection);
      lines.push("");
    }

    // Slides do carrossel
    if (d.slides && d.slides.length > 1) {
      lines.push(`### Slides do carrossel (${d.slides.length})`);
      lines.push("");
      for (const s of d.slides) {
        lines.push(`#### Slide ${s.slideNum}/${d.slides.length} — [${s.role}]`);
        lines.push(`- Composição: ${s.composition}`);
        lines.push(`- Sujeito: ${s.subject} · Mood: ${s.mood} · Estilo: ${s.style}`);
        if (s.textOverlay) lines.push(`- Texto: "${s.textOverlay}"`);
        lines.push(`- Paleta: ${s.palette.join(" · ")}`);
        lines.push(`- Prompt:`);
        lines.push("  ```");
        lines.push(`  ${s.prompt}`);
        lines.push("  ```");
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}

function main() {
  const dir = findLatestAnalysisDir();
  const jsonPath = path.join(dir, `visual-dna-${slug}.json`);
  if (!fs.existsSync(jsonPath)) throw new Error(`Não achei ${jsonPath}`);

  const dnas = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as VisualDna[];
  console.log(`📁 ${path.basename(jsonPath)} — ${dnas.length} posts`);

  const md = buildMd(dnas);
  const mdPath = jsonPath.replace(".json", ".md");
  fs.writeFileSync(mdPath, md);
  console.log(`✅ ${path.basename(mdPath)} (${(md.length / 1024).toFixed(0)}KB)`);
}

main();
