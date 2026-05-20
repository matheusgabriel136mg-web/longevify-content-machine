/**
 * browser-video-to-prompt.ts — Analisa vídeo no browser via Hyperbrowser + Claude Opus 4.7
 *
 * Uso:
 *   node --env-file=.env --import tsx/esm scripts/browser-video-to-prompt.ts <url>
 *
 * Exemplo:
 *   ... browser-video-to-prompt.ts https://www.instagram.com/p/DKaPfjnSYx7/
 *
 * Requer: ANTHROPIC_API_KEY no .env e Hyperbrowser MCP configurado
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs   from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");

const BRAND_MD  = fs.readFileSync(path.join(ROOT, "LONGEVIFY_BRAND.md"), "utf-8");
const OUT_DIR   = path.join(ROOT, "output/prompts");
const FRAMES_DIR = "/tmp/browser-frames";
fs.mkdirSync(OUT_DIR,    { recursive: true });
fs.mkdirSync(FRAMES_DIR, { recursive: true });

const SYSTEM_PROMPT = `Você é um diretor de arte especialista em conteúdo premium de saúde e longevidade.

Você receberá 8 frames capturados de um vídeo em intervalos de 2 segundos.

Analise os frames e extraia:
1) Estrutura narrativa cena a cena (o que muda entre os frames, duração estimada de cada cena)
2) Paleta de cores exata em hex (pelo menos 5 cores dominantes)
3) Tipo de iluminação e temperatura de cor (Kelvin estimado, direção, softness)
4) Movimento de câmera (inferido pelas diferenças entre frames: estático, pan, zoom etc)
5) Ritmo de edição (estimado pelos cortes visíveis entre os 8 frames)
6) Tom emocional (adjetivos precisos, não genéricos)
7) Elementos de texto na tela (fontes, tamanho relativo, posição, cor)

Depois gere:
a) Prompt otimizado para Seedance 2.0 em inglês (máx 200 palavras, focado em movimento de câmera e atmosfera)
b) Prompt para NB2 (fal-ai/nano-banana-2) para o frame principal em inglês (máx 100 palavras, sem texto na imagem)
c) Brief adaptado para a marca Longevify em português baseado no contexto da marca abaixo

---
CONTEXTO DA MARCA LONGEVIFY:
${BRAND_MD}
---

Formate a saída em Markdown bem estruturado com headers claros.`;

async function captureFramesWithPlaywright(url: string): Promise<string[]> {
  // Usa playwright se disponível, senão puppeteer
  const script = `
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page    = await browser.newPage();
  await page.setViewportSize({ width: 390, height: 844 }); // iPhone 14 Pro
  await page.goto('${url}', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  for (let i = 0; i < 8; i++) {
    await page.screenshot({ path: '${FRAMES_DIR}/frame-' + i + '.png', fullPage: false });
    await page.waitForTimeout(2000);
  }

  await browser.close();
})();
`;

  const scriptPath = "/tmp/capture-frames.cjs";
  fs.writeFileSync(scriptPath, script);

  try {
    execSync(`node ${scriptPath}`, { stdio: "inherit", timeout: 90000 });
    return Array.from({ length: 8 }, (_, i) => `${FRAMES_DIR}/frame-${i}.png`)
      .filter(f => fs.existsSync(f));
  } catch {
    throw new Error("Falha ao capturar frames. Verifique se playwright está instalado: npm install playwright");
  }
}

async function analyzeFramesWithClaude(framePaths: string[]): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const imageBlocks: Anthropic.ImageBlockParam[] = framePaths.map((fp, i) => {
    const data = fs.readFileSync(fp).toString("base64");
    return {
      type: "image",
      source: { type: "base64", media_type: "image/png", data },
    };
  });

  const frameLabels = framePaths.map((_, i) =>
    ({ type: "text" as const, text: `--- Frame ${i + 1} (t=${i * 2}s) ---` })
  );

  // Intercala label + imagem para cada frame
  const content: Anthropic.ContentBlockParam[] = [];
  for (let i = 0; i < framePaths.length; i++) {
    content.push(frameLabels[i]);
    content.push(imageBlocks[i]);
  }
  content.push({ type: "text", text: SYSTEM_PROMPT });

  const response = await client.messages.create({
    model:      "claude-opus-4-7",
    max_tokens: 4096,
    thinking:   { type: "adaptive" },
    messages:   [{ role: "user", content }],
  });

  return response.content
    .filter(b => b.type === "text")
    .map(b => (b as Anthropic.TextBlock).text)
    .join("\n");
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Uso: browser-video-to-prompt.ts <url>");
    console.error("Ex:  browser-video-to-prompt.ts https://www.instagram.com/p/DKaPfjnSYx7/");
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ ANTHROPIC_API_KEY não encontrada no .env");
    process.exit(1);
  }

  console.log(`\n🎬 Browser Video-to-Prompt — Claude Opus 4.7`);
  console.log(`   URL: ${url}`);
  console.log("─".repeat(50));

  console.log("  📸 Capturando 8 frames (intervalo 2s)...");
  const framePaths = await captureFramesWithPlaywright(url);
  console.log(`  ✅ ${framePaths.length} frames capturados`);

  console.log("  🧠 Analisando com Claude Opus 4.7...");
  const analysis = await analyzeFramesWithClaude(framePaths);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outFile   = path.join(OUT_DIR, `${timestamp}-browser-video-analysis.md`);

  const content = `---
source: ${url}
model: claude-opus-4-7
frames: ${framePaths.length}
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
