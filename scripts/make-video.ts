/**
 * make-video.ts
 *
 * Prompt → GPT Image 2 → sharp (texto + logo) → Seedance 2.0 → ffmpeg
 *
 * Uso: npm run make-video
 * Brief: scripts/video-brief.json
 */

import { fal }   from "@fal-ai/client";
import OpenAI    from "openai";
import sharp     from "sharp";
import { execSync } from "child_process";
import * as fs   from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");

fal.config({ credentials: process.env.FAL_KEY });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const LOGO_PATH  = path.join(ROOT, "assets/logo-horizontal-white.png");
const FONTS_DIR  = path.join(ROOT, "assets/fonts");
const FRAMES_DIR = path.join(ROOT, "output/frames");
const CLIPS_DIR  = path.join(ROOT, "output/clips");
const OUT_DIR    = path.join(ROOT, "output");

fs.mkdirSync(FRAMES_DIR, { recursive: true });
fs.mkdirSync(CLIPS_DIR,  { recursive: true });

// ── Types ─────────────────────────────────────────────────────────────────────

interface Frame {
  type:     "pergunta" | "resposta";
  text:     string;
  duration: number;
}

interface Brief {
  frames: Frame[];
  style:  string;
}

// ── GPT-4o: Prompt Engineering ────────────────────────────────────────────────

const BRAND_SYSTEM = `
Você é diretor de arte de uma health-tech brasileira premium chamada Longevify.
Missão: criar imagens de altíssima qualidade para redes sociais (Instagram Stories/Reels).

Identidade visual da marca:
- Paleta: preto profundo (#000F08), verde-teal (#5BAE9E), branco (#FFFFFF)
- Estética: premium, científico, humano, minimalista, cinematográfico
- Referência de estilo: Mito Health, Whoop, Function Health — saúde de elite

Ao receber um conceito de frame, gere um prompt para gerador de imagem (Imagen 4 / GPT Image 2).
O prompt deve ser em inglês e conter OBRIGATORIAMENTE:
1. Composição: de onde a forma vem, espaço negativo, proporção ocupada
2. Textura e material: translúcido, vítreo, orgânico, gasoso — seja específico
3. Paleta exata: nomes de cores e/ou hex aproximados
4. Iluminação: interna, backlit, difusa, direcional — seja específico
5. Acabamento: grain de filme, desfoque óptico, matte, glossy
6. Proibições explícitas: sem texto, sem rosto, sem logo, sem elementos médicos literais

Retorne SOMENTE o prompt de imagem, sem explicações, sem markdown.
`.trim();

async function buildImagePrompt(frame: Frame, style: string): Promise<string> {
  const userMsg = `
Estilo geral do vídeo: ${style}

Frame atual:
- Tipo: ${frame.type === "pergunta" ? "PERGUNTA (tom de dúvida, tensão, problema)" : "RESPOSTA (tom de clareza, alívio, solução)"}
- Texto que vai ser sobreposto: "${frame.text.replace(/\n/g, " ")}"
- Duração: ${frame.duration}s

Gere o prompt visual para o fundo deste frame. Lembre: o texto será adicionado em pós-produção — o fundo deve ter espaço negativo ou área escura onde o texto respira.
`.trim();

  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: BRAND_SYSTEM },
      { role: "user",   content: userMsg },
    ],
    temperature: 0.7,
    max_tokens: 500,
  });

  return res.choices[0].message.content?.trim() ?? style;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function download(url: string, dest: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Download failed: ${r.status}`);
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}

function b64font(name: string) {
  return fs.readFileSync(path.join(FONTS_DIR, name)).toString("base64");
}

const FONT_CSS = `
  @font-face { font-family:'DM'; font-weight:300;
    src:url('data:font/ttf;base64,${b64font("DMSans-Light.ttf")}') }
  @font-face { font-family:'DM'; font-weight:400;
    src:url('data:font/ttf;base64,${b64font("DMSans-Regular.ttf")}') }
  @font-face { font-family:'DM'; font-weight:500;
    src:url('data:font/ttf;base64,${b64font("DMSans-Medium.ttf")}') }
`;

// ── Dimensões (portrait 4:3 → 1024×1365 aprox, usamos 1080×1440) ─────────────
const W = 1080, H = 1440;

// ── Etapa 1: GPT Image 2 ─────────────────────────────────────────────────────

async function generateFrame(frame: Frame, style: string, outPath: string): Promise<string> {
  if (fs.existsSync(outPath)) {
    console.log(`    ⏭  ${path.basename(outPath)} já existe`);
    return outPath;
  }

  const prompt = `${style}. Abstract macro visual, no text visible, no letters, no words in image. Photorealistic, 9:16 vertical.`;

  const r = await fal.subscribe("openai/gpt-image-2", {
    input: {
      prompt,
      image_size:    "portrait_4_3",
      quality:       "high",
      num_images:    1,
      output_format: "jpeg",
    },
    logs: false,
  }) as { data: { images: Array<{ url: string }> } };

  const url = r.data.images[0]?.url;
  if (!url) throw new Error("GPT Image 2 não retornou imagem");
  await download(url, outPath);
  return outPath;
}

// ── Etapa 2: sharp — composita texto + logo ───────────────────────────────────

function svgPergunta(text: string): string {
  const lines  = text.split("\n");
  const FS     = 44;
  const LH     = FS * 1.5;
  const PAD    = 48;
  const cardW  = W - 120;
  const cardH  = lines.length * LH + PAD * 2;
  const cardX  = 60;
  const cardY  = Math.round(H * 0.38);
  const textY  = cardY + PAD + FS * 0.85;

  const tspans = lines.map((l, i) =>
    `<tspan x="${cardX + PAD}" dy="${i === 0 ? 0 : LH}">${l}</tspan>`
  ).join("");

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs><style>${FONT_CSS}</style></defs>
  <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}"
    rx="16" fill="#1C3F3A" fill-opacity="0.92"/>
  <text font-family="DM" font-weight="400" font-size="${FS}"
    fill="white" fill-opacity="0.95" y="${textY}">
    ${tspans}
  </text>
</svg>`;
}

function svgResposta(text: string): string {
  const lines = text.split("\n");
  const FS    = 48;
  const LH    = FS * 1.55;
  const startY = Math.round(H * 0.42);

  const tspans = lines.map((l, i) =>
    `<tspan x="${W / 2}" dy="${i === 0 ? 0 : LH}">${l}</tspan>`
  ).join("");

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs><style>${FONT_CSS}</style></defs>
  <text font-family="DM" font-weight="300" font-size="${FS}"
    fill="#5BAE9E" text-anchor="middle" letter-spacing="1"
    y="${startY}">
    ${tspans}
  </text>
</svg>`;
}

function svgTagline(): string {
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs><style>${FONT_CSS}</style></defs>
  <text x="${W / 2}" y="${H - 70}"
    font-family="DM" font-weight="300" font-size="28"
    fill="#7ab5a0" text-anchor="middle" letter-spacing="1">
    Sua inteligência de saúde.
  </text>
</svg>`;
}

async function compositeFrame(
  rawPath: string,
  frame: Frame,
  outPath: string
): Promise<string> {
  if (fs.existsSync(outPath)) {
    console.log(`    ⏭  ${path.basename(outPath)} já existe`);
    return outPath;
  }

  const textSvg = frame.type === "pergunta"
    ? svgPergunta(frame.text)
    : svgResposta(frame.text);

  const layers: sharp.OverlayOptions[] = [
    { input: Buffer.from(textSvg),    blend: "over" },
    { input: Buffer.from(svgTagline()), blend: "over" },
  ];

  // Logo
  if (fs.existsSync(LOGO_PATH)) {
    const logoW   = 240;
    const meta    = await sharp(LOGO_PATH).metadata();
    const logoH   = Math.round(logoW * (meta.height! / meta.width!));
    const logoBuf = await sharp(LOGO_PATH).resize(logoW, logoH).png().toBuffer();
    layers.push({
      input: logoBuf,
      top:   56,
      left:  Math.round((W - logoW) / 2),
      blend: "over",
    });
  }

  await sharp(rawPath)
    .resize(W, H, { fit: "cover", position: "center" })
    .composite(layers)
    .jpeg({ quality: 92 })
    .toFile(outPath);

  return outPath;
}

// ── Etapa 3: Seedance 2.0 ────────────────────────────────────────────────────

async function animateFrame(composedPath: string, frame: Frame, outPath: string): Promise<string> {
  if (fs.existsSync(outPath)) {
    console.log(`    ⏭  ${path.basename(outPath)} já existe`);
    return outPath;
  }

  const fileBytes = fs.readFileSync(composedPath);
  const file      = new File([fileBytes], path.basename(composedPath), { type: "image/jpeg" });
  const imageUrl  = await fal.storage.upload(file);

  const result = await fal.subscribe("bytedance/seedance-2.0/image-to-video", {
    input: {
      image_url:       imageUrl,
      duration:        frame.duration,
      motion_strength: 0.3,
      aspect_ratio:    "3:4",
    },
    logs: false,
    onQueueUpdate: (u) => {
      if (u.status === "IN_QUEUE")    process.stdout.write(`\r    ⌛ na fila...`);
      if (u.status === "IN_PROGRESS") process.stdout.write(".");
    },
  }) as { data: { video: { url: string } } };

  console.log();
  const videoUrl = result.data.video?.url;
  if (!videoUrl) throw new Error("Seedance não retornou vídeo");
  await download(videoUrl, outPath);
  return outPath;
}

// ── Etapa 4: ffmpeg ───────────────────────────────────────────────────────────

function concat(clipPaths: string[], outPath: string) {
  const listFile = path.join(CLIPS_DIR, "concat.txt");
  fs.writeFileSync(listFile, clipPaths.map(p => `file '${p}'`).join("\n"));

  // Usa filter_complex para fade entre clips
  const inputs  = clipPaths.map((p, i) => `-i "${p}"`).join(" ");
  const fade    = 0.3;
  let filter    = clipPaths.map((_, i) => `[${i}:v]fade=t=in:st=0:d=${fade},fade=t=out:st=999:d=${fade}[v${i}]`).join("; ");
  filter       += `; ${clipPaths.map((_, i) => `[v${i}]`).join("")}concat=n=${clipPaths.length}:v=1:a=0[out]`;

  execSync(
    `ffmpeg -y ${inputs} -filter_complex "${filter}" -map "[out]" ` +
    `-c:v libx264 -pix_fmt yuv420p -crf 16 -movflags +faststart "${outPath}"`,
    { stdio: "pipe" }
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const briefPath = path.join(__dirname, "video-brief.json");
  const brief: Brief = JSON.parse(fs.readFileSync(briefPath, "utf-8"));

  console.log("\n🎬 make-video — Longevify");
  console.log(`   ${brief.frames.length} frames no brief`);
  console.log("─".repeat(50));

  const clipPaths: string[] = [];

  for (const [i, frame] of brief.frames.entries()) {
    const n    = String(i + 1).padStart(2, "0");
    const tag  = frame.type === "pergunta" ? "❓" : "✅";
    console.log(`\n${tag} Frame ${n} — ${frame.type} (${frame.duration}s)`);
    console.log(`   "${frame.text.replace(/\n/, " ")}"`);

    const rawPath      = path.join(FRAMES_DIR, `frame-${n}.jpg`);
    const composedPath = path.join(FRAMES_DIR, `composed-${n}.jpg`);
    const clipPath     = path.join(CLIPS_DIR,  `clip-${n}.mp4`);

    console.log("  1. GPT-4o expandindo prompt...");
    const imagePrompt = await buildImagePrompt(frame, brief.style);
    console.log(`     📝 ${imagePrompt.slice(0, 120)}...`);

    console.log("  2. GPT Image 2...");
    await generateFrame(frame, imagePrompt, rawPath);
    console.log(`     ✅ ${path.basename(rawPath)}`);

    console.log("  3. Compositing texto + logo...");
    await compositeFrame(rawPath, frame, composedPath);
    console.log(`     ✅ ${path.basename(composedPath)}`);

    console.log("  4. Seedance 2.0...");
    await animateFrame(composedPath, frame, clipPath);
    console.log(`     ✅ ${path.basename(clipPath)}`);

    clipPaths.push(clipPath);
  }

  console.log("\n4. ffmpeg — concatenando...");
  const ts  = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const out = path.join(OUT_DIR, `${ts}-longevify.mp4`);
  concat(clipPaths, out);

  const total = brief.frames.reduce((a, f) => a + f.duration, 0);
  console.log(`\n✅ Pronto!`);
  console.log(`📁 ${out}`);
  console.log(`   ${brief.frames.length} clips · ${total}s total`);
}

main().catch(e => { console.error("\n❌", e.message); process.exit(1); });
