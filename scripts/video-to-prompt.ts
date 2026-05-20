/**
 * video-to-prompt.ts — Analisa vídeo via Gemini 2.5 Pro e gera prompts Longevify
 *
 * Uso:
 *   node --env-file=.env --import tsx/esm scripts/video-to-prompt.ts <url-ou-arquivo>
 *
 * Exemplos:
 *   ... video-to-prompt.ts https://www.instagram.com/p/DKaPfjnSYx7/
 *   ... video-to-prompt.ts ./output/stories/mushroom-breathing-v2.mp4
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");

const BRAND_MD  = fs.readFileSync(path.join(ROOT, "LONGEVIFY_BRAND.md"), "utf-8");
const OUT_DIR   = path.join(ROOT, "output/prompts");
fs.mkdirSync(OUT_DIR, { recursive: true });

const SYSTEM_PROMPT = `Você é um diretor de arte especialista em conteúdo premium de saúde e longevidade.

Analise este vídeo e extraia:
1) Estrutura narrativa cena a cena (duração estimada de cada cena, o que acontece)
2) Paleta de cores exata em hex (pelo menos 5 cores dominantes)
3) Tipo de iluminação e temperatura de cor (Kelvin estimado, direção, softness)
4) Movimento de câmera (estático, pan, tilt, zoom, handheld, drone etc)
5) Ritmo de edição (cortes por minuto, tipo de transição)
6) Tom emocional (adjetivos precisos, não genéricos)
7) Elementos de texto na tela (fontes, tamanho relativo, posição, cor, timing)

Depois gere:
a) Prompt otimizado para Seedance 2.0 em inglês (máx 200 palavras, focado em movimento de câmera e atmosfera)
b) Prompt para NB2 (fal-ai/nano-banana-2) para o frame principal em inglês (máx 100 palavras, sem texto na imagem)
c) Brief adaptado para a marca Longevify em português baseado no contexto da marca abaixo

---
CONTEXTO DA MARCA LONGEVIFY:
${BRAND_MD}
---

Formate a saída em Markdown bem estruturado com headers claros.`;

function downloadVideo(url: string): string {
  const tmpPath = `/tmp/vtop-${Date.now()}.mp4`;
  console.log("  ⬇️  Baixando vídeo com yt-dlp...");
  try {
    execSync(
      `yt-dlp -f "mp4/best[height<=1080]" -o "${tmpPath}" "${url}"`,
      { stdio: "pipe", timeout: 120000 }
    );
  } catch (e: any) {
    throw new Error(`yt-dlp falhou: ${e.stderr?.toString() ?? e.message}`);
  }
  if (!fs.existsSync(tmpPath)) throw new Error("yt-dlp não gerou o arquivo");
  console.log(`  ✅ Download: ${(fs.statSync(tmpPath).size / 1024 / 1024).toFixed(1)}MB`);
  return tmpPath;
}

async function analyzeVideoUrl(input: string): Promise<string> {
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

  // Tenta 2.5 Pro, cai para 2.0 Flash se quota estourar
  const models = ["gemini-2.5-pro", "gemini-2.0-flash"];

  const isRemote = input.startsWith("http://") || input.startsWith("https://");
  let   filePath = isRemote ? null : path.resolve(process.cwd(), input);

  // Baixa se for URL remota (Instagram, YouTube, etc.)
  if (isRemote) {
    filePath = downloadVideo(input);
  }

  if (!fs.existsSync(filePath!)) throw new Error(`Arquivo não encontrado: ${filePath}`);

  const data     = fs.readFileSync(filePath!);
  const base64   = data.toString("base64");
  const ext      = path.extname(filePath!).toLowerCase().replace(".", "");
  const mimeMap: Record<string, string> = {
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
    avi: "video/avi", mkv: "video/x-matroska",
  };
  const mimeType = mimeMap[ext] ?? "video/mp4";
  console.log(`  📎 Arquivo pronto (${(data.length / 1024 / 1024).toFixed(1)}MB)`);

  const contentParts = [
    { inlineData: { mimeType, data: base64 } },
    { text: SYSTEM_PROMPT },
  ];

  for (const modelName of models) {
    try {
      console.log(`  🧠 Analisando com ${modelName}...`);
      const model  = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent({ contents: [{ role: "user", parts: contentParts }] });
      console.log(`  ✅ Modelo usado: ${modelName}`);
      return result.response.text();
    } catch (e: any) {
      if (e.message?.includes("429") || e.message?.includes("quota")) {
        console.log(`  ⚠️  ${modelName} sem quota, tentando próximo...`);
        continue;
      }
      throw e;
    }
  }

  throw new Error("Todos os modelos Gemini sem quota. Ativa o billing em aistudio.google.com");
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("Uso: video-to-prompt.ts <url-ou-arquivo-local>");
    console.error("Ex:  video-to-prompt.ts https://example.com/video.mp4");
    console.error("Ex:  video-to-prompt.ts ./output/stories/mushroom-breathing-v2.mp4");
    process.exit(1);
  }

  if (!process.env.GOOGLE_API_KEY) {
    console.error("❌ GOOGLE_API_KEY não encontrada no .env");
    process.exit(1);
  }

  console.log(`\n🎬 Video-to-Prompt — Gemini 2.5 Pro`);
  console.log(`   Input: ${input}`);
  console.log("─".repeat(50));

  const analysis = await analyzeVideoUrl(input);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outFile   = path.join(OUT_DIR, `${timestamp}-video-analysis.md`);

  const content = `---
source: ${input}
model: gemini-2.5-pro
date: ${new Date().toISOString()}
---

${analysis}
`;

  fs.writeFileSync(outFile, content);

  console.log(`\n✅ Análise salva em:`);
  console.log(`   ${outFile}`);
  console.log("\n" + "─".repeat(50));
  console.log(analysis.slice(0, 500) + (analysis.length > 500 ? "\n\n[... ver arquivo completo]" : ""));
}

main().catch(e => { console.error("\n❌", e.message); process.exit(1); });
