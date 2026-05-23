// Gera 7 covers Higgsfield + composite + organiza em output/posts-review/
// Skip: glúteo (user dropped), ferritina (já publicado), mitocôndria (já tem)

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";

const ROOT = "/Users/mathe/Documents/Longev/Brand/Longevify/content-machine";
const REVIEW_DIR = path.join(ROOT, "output", "posts-review");
const COVERS_TMP = "/tmp/longevify-covers";
fs.mkdirSync(REVIEW_DIR, { recursive: true });
fs.mkdirSync(COVERS_TMP, { recursive: true });

const W = 1080, H = 1350;
const FOREST = "#1C3F3A";
const TEXT = "#f8fffc";
const GOLD = "#C89136";

// 7 drafts pra gerar cover (excluindo glúteo e ferritina já feitos)
const TARGETS = [
  {
    run: "2026-05-21-014-truebut-theres-a-plot-twist-bm",
    title: "Plot twist · gravidez",
    prompt: "Editorial cinematic close-up macro photograph, 4:5 vertical. Detail of pregnant womans hand on her abdomen in moody warm side light, deep forest green and warm amber color grade. Premium Vogue Brasil maternity editorial aesthetic. Golden hour Brazilian sun streaming. Generous negative space upper third for text overlay. Medium format, shallow depth of field, slight film grain. ABSOLUTELY NO text, logos, watermarks, baby visible, ultrasound, medical equipment, white background, pastel pink/blue, smiling face, cliche maternity stock.",
    headline: "Envelhece 2.\nRejuvenesce 8.",
    micro: "Yale School of Medicine",
    numeration: "01 / 06",
    gradientPos: "top",
  },
  {
    run: "2026-05-21-015-lets-take-it-back-to-bm",
    title: "Biologia · célula",
    prompt: "Editorial scientific macro photograph, 4:5 vertical. Real human cell fluorescence microscopy stained with deep teal and warm amber on dark forest background. Nature magazine cover quality, premium scientific publication aesthetic. Generous negative space upper area for text overlay. ABSOLUTELY NO text, logos, watermarks, cartoon cells, vector graphics, red colors, rainbow gradient, white background, anatomical labels, scale bars.",
    headline: "Volte à biologia\ndo ensino médio.",
    micro: "Quase toda célula depende de uma usina.",
    numeration: "01 / 05",
    gradientPos: "top",
  },
  {
    run: "2026-05-21-016-lets-zoom-out-your-biological-bm",
    title: "Idade biológica",
    prompt: "Editorial cinematic extreme macro of a single mature human iris in dramatic side light, 4:5 vertical. Deep forest greens and warm amber tones in the iris vascular pattern. Premium fashion magazine aesthetic. Generous negative space around for text overlay. Sharp focus iris center. ABSOLUTELY NO text, logos, watermarks, full face, glasses, makeup, white background, smiling.",
    headline: "A idade que importa\nnão está no RG.",
    micro: "Está dentro das suas células.",
    numeration: "01 / 05",
    gradientPos: "top",
  },
  {
    run: "2026-05-21-017-once-upon-a-time-your-bm",
    title: "Músculo · longevidade",
    prompt: "Editorial cinematic photograph of a strong adult forearm muscle definition holding nothing, 4:5 vertical. Golden hour rim light, deep forest green shadows, athletic but not gym. Premium fashion magazine aesthetic. Generous negative space upper third for text overlay. Shot on medium format, shallow depth of field. ABSOLUTELY NO text, logos, watermarks, weights, gym equipment, mirrors, smiling face, neon, white background, gloves.",
    headline: "Era uma vez,\no seu músculo.",
    micro: "A massa muscular conta a idade do corpo.",
    numeration: "01 / 05",
    gradientPos: "top",
  },
  {
    run: "2026-05-21-018-time-leaves-its-mark-on-bm",
    title: "44 e 60 · transições biológicas",
    prompt: "Editorial cinematic profile portrait of a mature 50 year old Brazilian person in pensive silhouette against warm golden hour light, deep forest shadow on one side, 4:5 vertical. Premium Vogue Brasil aesthetic. Generous negative space upper third for text overlay. Medium format, shallow depth of field. ABSOLUTELY NO text, logos, watermarks, frontal smile, jewelry, medical equipment, white background, gym.",
    headline: "Aos 44 e aos 60,\no corpo vira a página.",
    micro: "Não é metáfora. É molécula.",
    numeration: "01 / 05",
    gradientPos: "top",
  },
  {
    run: "2026-05-21-021-the-biggest-update-to-heart-bm",
    title: "ApoB · update guidelines",
    prompt: "Editorial cinematic anatomical macro photograph, 4:5 vertical. Real human chest skin detail in deep forest shadow with subtle warm amber pulse rim light. Premium Nature magazine aesthetic, scientific yet artistic. Generous negative space upper area for text overlay. ABSOLUTELY NO text, logos, watermarks, 3D rendered hearts, cartoon hearts, EKG lines, medical illustration, red color cliché, white background, anatomical labels.",
    headline: "A maior atualização\nem 10 anos.",
    micro: "E quase ninguém ouviu falar.",
    numeration: "01 / 05",
    gradientPos: "top",
  },
  {
    run: "2026-05-21-022-your-stress-response-system-has-bm",
    title: "Estresse · ponto de ruptura",
    prompt: "Editorial cinematic profile of a calm adult in meditation pose against deep forest backdrop, 4:5 vertical. Warm golden temple highlight, shallow depth of field. Premium Vogue Brasil aesthetic, pensive serenity. Generous negative space upper area for text overlay. ABSOLUTELY NO text, logos, watermarks, yoga cliche, gym, white background, glasses, frontal smile, neon, multiple subjects.",
    headline: "Seu sistema de\nestresse tem limite.",
    micro: "Quase todo mundo passa dele sem notar.",
    numeration: "01 / 05",
    gradientPos: "top",
  },
];

// ─── Dispatch Higgsfield jobs in parallel ─────────────────────────────────────
function dispatch(target) {
  return new Promise((resolve, reject) => {
    const logPath = path.join(COVERS_TMP, `${target.run}.log`);
    const proc = spawn("higgsfield", [
      "generate", "create", "nano_banana_2",
      "--prompt", target.prompt,
      "--aspect_ratio", "4:5",
      "--resolution", "2k",
      "--wait", "--wait-timeout", "5m",
    ], {
      stdio: ["ignore", fs.openSync(logPath, "w"), fs.openSync(logPath, "a")],
    });
    proc.on("exit", (code) => {
      const log = fs.readFileSync(logPath, "utf-8");
      const m = log.match(/https:\/\/[^\s]+\.png/);
      if (code === 0 && m) {
        target.url = m[0];
        resolve(target);
      } else {
        target.error = `exit ${code}`;
        reject(target);
      }
    });
  });
}

// ─── Composite ────────────────────────────────────────────────────────────────
async function compositeCover(target, bgPath, outPath) {
  const bgBuf = await sharp(bgPath).resize(W, H, { fit: "cover", position: "center" }).toBuffer();
  const padX = 80;

  const grad = target.gradientPos === "top"
    ? `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
         <stop offset="0%" stop-color="${FOREST}" stop-opacity="0.88"/>
         <stop offset="50%" stop-color="${FOREST}" stop-opacity="0.0"/>
       </linearGradient></defs>
       <rect width="${W}" height="${H}" fill="url(#g)"/>`
    : `<defs><linearGradient id="g" x1="0" y1="1" x2="0" y2="0">
         <stop offset="0%" stop-color="${FOREST}" stop-opacity="0.88"/>
         <stop offset="50%" stop-color="${FOREST}" stop-opacity="0.0"/>
       </linearGradient></defs>
       <rect width="${W}" height="${H}" fill="url(#g)"/>`;

  const wrap = (text, max) => {
    const segs = text.split("\n");
    const out = [];
    for (const seg of segs) {
      const words = seg.split(/\s+/);
      let cur = "";
      for (const w of words) {
        if ((cur + " " + w).trim().length <= max) cur = (cur + " " + w).trim();
        else { if (cur) out.push(cur); cur = w; }
      }
      if (cur) out.push(cur);
    }
    return out;
  };
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

  const headFont = 78;
  const hLines = wrap(target.headline, 22);
  const startY = 240;
  const textXml = hLines.map((ln, i) =>
    `<text x="${padX}" y="${startY + i * headFont * 1.12}" font-family="DM Sans, Helvetica, Arial, sans-serif" font-size="${headFont}" font-weight="300" fill="${TEXT}" letter-spacing="-1.5">${esc(ln)}</text>`
  ).join("");

  const microXml = target.micro
    ? `<text x="${padX}" y="${startY + hLines.length * headFont * 1.12 + 56}" font-family="Georgia, serif" font-size="24" font-style="italic" fill="${TEXT}" opacity="0.85">${esc(target.micro)}</text>`
    : "";

  const numXml = target.numeration
    ? `<text x="${padX}" y="120" font-family="DM Sans, Helvetica, Arial, sans-serif" font-size="22" font-weight="400" fill="${GOLD}" letter-spacing="2.5">${esc(target.numeration.toUpperCase())}</text>`
    : "";

  const overlaySvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${grad}${numXml}${textXml}${microXml}</svg>`;
  let img = sharp(bgBuf).composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }]);

  // Logo
  const LOGO = path.join(ROOT, "assets/logo-horizontal-white.png");
  if (fs.existsSync(LOGO)) {
    const trimmed = await sharp(LOGO).trim().toBuffer({ resolveWithObject: true });
    const cropH = Math.round(trimmed.info.height * 0.78);
    const wordmark = await sharp(trimmed.data).extract({ left: 0, top: 0, width: trimmed.info.width, height: cropH }).toBuffer();
    const logoW = Math.round(W * 0.24);
    const logoBuf = await sharp(wordmark).resize(logoW).toBuffer();
    const logoMeta = await sharp(logoBuf).metadata();
    const logoX = Math.round((W - logoW) / 2);
    const logoY = Math.round(H - (logoMeta.height ?? 80) - 80);
    const compBuf = await img.png().toBuffer();
    img = sharp(compBuf).composite([{ input: logoBuf, left: logoX, top: logoY }]);
  }

  await img.png().toFile(outPath);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
console.log(`🎨 Disparando ${TARGETS.length} covers Higgsfield em paralelo...`);
const settled = await Promise.allSettled(TARGETS.map(dispatch));
const ok = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);
const fail = settled.filter((s) => s.status === "rejected").map((s) => s.reason);
console.log(`\n✓ ${ok.length} ok · ✗ ${fail.length} falhou`);

console.log("\n📥 Baixando + compositando...");
for (const t of ok) {
  const reviewDir = path.join(REVIEW_DIR, t.run);
  fs.mkdirSync(reviewDir, { recursive: true });
  const rawPath = path.join(COVERS_TMP, `${t.run}-raw.png`);
  const composedPath = path.join(reviewDir, "slide-1.png");
  // Download
  const buf = await fetch(t.url).then((r) => r.arrayBuffer());
  fs.writeFileSync(rawPath, Buffer.from(buf));
  await compositeCover(t, rawPath, composedPath);
  console.log(`  ✓ ${t.run}/slide-1.png`);
}

console.log(`\n📁 Pasta de review: ${REVIEW_DIR}`);
