/**
 * filter-visual-dna.ts — filtra posts "tralha" do visual-dna pra deixar só
 * o conteúdo visualmente picante (carrosséis fodas, reels fodas, imagens fodas).
 *
 * Lê visual-dna-{brand}.json, manda cada post pro Claude classificar:
 *   - category: designed-graphic | lifestyle-photo | data-viz | talking-head | generic | meme
 *   - visualValue: 1-5 (1 = sem valor de inspiração visual / 5 = ouro)
 *
 * Output: visual-dna-{brand}-filtered.json (só posts com visualValue ≥ 3)
 *         + visual-dna-{brand}-classified.json (todos com a classificação)
 *
 * Uso:
 *   npm run -- filter-visual-dna                    # roda nos 3 (SP+Mito+Function)
 *   npm run -- filter-visual-dna -- superpower      # só uma marca
 *   npm run -- filter-visual-dna -- --min=4         # threshold mais alto
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);

const args = process.argv.slice(2);
const minScore = Number(args.find((a) => a.startsWith("--min="))?.split("=")[1] ?? 3);
const onlyBrand = args.find((a) => !a.startsWith("--"));

const BRAND_FILES: Record<string, string> = {
  "superpower": "visual-dna-superpower.json",
  "mito-health": "visual-dna-mito-health.json",
  "function-health": "visual-dna-function-health.json",
};

const client = new Anthropic();

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
  };
  slides?: Array<{
    slideNum: number;
    role: string;
    composition: string;
    subject: string;
    style: string;
    [k: string]: unknown;
  }>;
  meta: { isReelCover: boolean; analyzedAt: string; model: string };
}

interface Classification {
  category: "designed-graphic" | "lifestyle-photo" | "data-viz" | "talking-head" | "generic" | "meme";
  visualValue: 1 | 2 | 3 | 4 | 5;
  reason: string;
}

function buildPrompt(d: VisualDna): string {
  const slidesInfo = d.slides
    ? `Slides do carrossel (${d.slides.length}):\n` +
      d.slides
        .slice(0, 5)
        .map(
          (s) =>
            `  Slide ${s.slideNum} [${s.role}]: subject="${s.subject}", style="${s.style}", composition="${s.composition}"`
        )
        .join("\n")
    : "";

  return `Você está classificando posts de Instagram pra mineração visual — queremos PEGAR só o que serve de inspiração visual real (designed-graphic, lifestyle-photo, data-viz, meme criativo) e DESCARTAR o que é talking-head sem produção (entrevista frente à câmera, founder falando) ou conteúdo genérico sem identidade visual.

Post:
- Marca: ${d.brand}
- Formato: ${d.format}
- viralizou ${d.vsMedian.toFixed(2)}x a mediana da marca
- Hook (1ª linha caption): "${d.hookLine.slice(0, 200)}"
- Subject: ${d.primary.subject}
- Style: ${d.primary.style}
- Mood: ${d.primary.mood}
- Composition: ${d.primary.composition}
- Hook signal: ${d.primary.hookSignal}
- Capa de reel: ${d.meta.isReelCover ? "sim" : "não"}
${slidesInfo}

Responda APENAS JSON (sem markdown, sem texto antes/depois):
{
  "category": "designed-graphic|lifestyle-photo|data-viz|talking-head|generic|meme",
  "visualValue": 1-5,
  "reason": "1 frase curta justificando"
}

Definições:
- designed-graphic: tipografia/layout intencional, cards bem feitos, infográfico bonito → quase sempre alto valor (4-5)
- lifestyle-photo: fotografia editorial real, produto, natureza, cena de vida com curadoria → 3-5
- data-viz: gráficos, números grandes, dashboards reais → 3-5
- meme: culturalmente referencial, fundo de meme template → 2-3 (ok se for criativo, mas não é DNA da Longevify)
- talking-head: founder/médico/influencer falando frente à câmera, capa de reel com pessoa → 1-2 (descartar)
- generic: foto de stock, frase aleatória sobre fundo plano sem design, conteúdo sem identidade → 1-2

visualValue:
- 1 = lixo total, ignora completamente
- 2 = fraco, só serve de exemplo do que NÃO fazer
- 3 = ok, talvez sirva de referência secundária
- 4 = forte, copia esse style
- 5 = ouro, replica esse exato approach`;
}

function parseJson(text: string): Classification | null {
  const cleaned = text.replace(/```(?:json)?\s*/g, "").replace(/```\s*$/g, "").trim();
  try {
    return JSON.parse(cleaned) as Classification;
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as Classification;
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function classify(d: VisualDna): Promise<Classification | null> {
  const prompt = buildPrompt(d);
  try {
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { text: string }).text)
      .join("");
    return parseJson(text);
  } catch (err) {
    console.error(`  ❌ Claude err: ${(err as Error).message.slice(0, 80)}`);
    return null;
  }
}

function findLatestAnalysisDir(): string {
  const dirs = fs
    .readdirSync(path.join(ROOT, "output"))
    .filter((n) => n.startsWith("analysis-"))
    .sort();
  if (!dirs.length) throw new Error("Nenhuma pasta analysis-*");
  return path.join(ROOT, "output", dirs[dirs.length - 1]);
}

async function processFile(analysisDir: string, fileName: string, brandKey: string) {
  const inputPath = path.join(analysisDir, fileName);
  if (!fs.existsSync(inputPath)) {
    console.log(`⚠️  ${fileName} não existe ainda — pula`);
    return;
  }

  const dnas = JSON.parse(fs.readFileSync(inputPath, "utf-8")) as VisualDna[];
  console.log(`\n🔍 ${fileName} — ${dnas.length} posts`);

  const classifications: Array<{ dna: VisualDna; cls: Classification }> = [];
  for (let i = 0; i < dnas.length; i++) {
    const d = dnas[i];
    process.stdout.write(`  [${i + 1}/${dnas.length}] ${d.format} ${d.vsMedian.toFixed(1)}x ... `);
    const cls = await classify(d);
    if (cls) {
      classifications.push({ dna: d, cls });
      const emoji = cls.visualValue >= 4 ? "🔥" : cls.visualValue === 3 ? "✅" : "🗑️";
      process.stdout.write(`${emoji} ${cls.category} (${cls.visualValue}/5)\n`);
    } else {
      process.stdout.write(`⚠️  sem resposta\n`);
    }
  }

  // Salva todos com classificação
  const classifiedPath = inputPath.replace(".json", "-classified.json");
  const classifiedData = classifications.map(({ dna, cls }) => ({
    ...dna,
    classification: cls,
  }));
  fs.writeFileSync(classifiedPath, JSON.stringify(classifiedData, null, 2));

  // Salva só os filtrados (visualValue >= minScore)
  const filteredPath = inputPath.replace(".json", "-filtered.json");
  const filtered = classifiedData.filter((d) => d.classification.visualValue >= minScore);
  fs.writeFileSync(filteredPath, JSON.stringify(filtered, null, 2));

  // Stats
  const byCategory: Record<string, number> = {};
  const byValue: Record<number, number> = {};
  for (const { cls } of classifications) {
    byCategory[cls.category] = (byCategory[cls.category] ?? 0) + 1;
    byValue[cls.visualValue] = (byValue[cls.visualValue] ?? 0) + 1;
  }

  console.log(`\n  📊 Por categoria:`);
  for (const [cat, n] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
    console.log(`     ${cat}: ${n}`);
  }
  console.log(`  📊 Por visualValue:`);
  for (const v of [5, 4, 3, 2, 1]) {
    if (byValue[v]) console.log(`     ${v}/5: ${byValue[v]}`);
  }
  console.log(`  ✅ Filtrado (≥${minScore}): ${filtered.length}/${dnas.length} posts → ${path.basename(filteredPath)}`);
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY não setada");

  const dir = findLatestAnalysisDir();
  console.log(`📁 ${path.basename(dir)} — threshold visualValue ≥ ${minScore}`);

  const targets = onlyBrand
    ? Object.entries(BRAND_FILES).filter(([k]) => k === onlyBrand)
    : Object.entries(BRAND_FILES);

  for (const [key, file] of targets) {
    await processFile(dir, file, key);
  }

  console.log("\n✅ Completo");
}

main().catch((err) => {
  console.error("\n❌", err.message);
  process.exit(1);
});
