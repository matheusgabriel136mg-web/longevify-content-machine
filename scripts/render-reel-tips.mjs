// render-reel-tips.mjs — Reel Mito-style "Pressione e segure" pra Longevify
//
// Estrutura por card (clone do template Mito):
//   - White BG canvas (1080x1920)
//   - Header top center: "Pressione e segure" / "pra revelar sua dica:"
//   - Card centralizado: rounded corners, BG blur photo, título uppercase white,
//     tip text com lightbulb icon
//   - Wordmark Longevify bottom center
//
// Animação: cada card faz pop-in (scale 0.95 → 1.0, opacity 0 → 1) durante ~0.4s,
// hold por 2.6s, fade out 0.3s, próximo card pop-in. Total ~16-17s reel.
//
// Output:
//   - frames temporários em /tmp/longevify-reel-frames/
//   - mp4 final em runs/2026-05-27-001-reel-tips-mito-style/assets/reel.mp4
//
// Uso: node scripts/render-reel-tips.mjs

import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const W = 1080, H = 1920;          // IG reel portrait
const BG_WHITE = "#FAF7F0";        // cream white pra fundo
const DARK = "#1A1A1A";            // texto preto do header e wordmark
const CARD_W = 720;                // card width
const CARD_H = 980;                // card height
const CARD_X = (W - CARD_W) / 2;
const CARD_Y = 470;                // card top
const CARD_RADIUS = 36;

const RUN_DIR = path.join(ROOT, "runs", "2026-05-27-001-reel-tips-mito-style", "assets");
const TMP_DIR = "/tmp/longevify-reel-frames";
const HF_LOG_DIR = "/tmp/longevify-reel-bgs";
const LOGO_PATH = path.join(ROOT, "assets", "logo-horizontal-dark.png"); // wordmark dark sobre white

fs.mkdirSync(RUN_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

const FPS = 30;
const POP_IN_FRAMES = 3;         // 0.10s pop-in (sharp snap)
const HOLD_FRAMES = 28;          // 0.93s hold
const FADE_OUT_FRAMES = 3;       // 0.10s fade-out
const PER_CARD = POP_IN_FRAMES + HOLD_FRAMES + FADE_OUT_FRAMES; // 34 frames = 1.13s
// 8 cards * 34 = 272 frames = 9.07s

// ─── CONTEÚDO: 8 cards Longevify (pillars 1+2+3 mix) ──────────────────────────
const CARDS = [
  {
    title: "ALIMENTE\nSUA CURVA",
    tip: "Carbo com proteína e fibra. A glicose para de bater no teto.",
    bgKey: "nutrition",
  },
  {
    title: "ANCORE\nSEU RITMO",
    tip: "Acorde na mesma janela de 60min todo dia. O circadiano não negocia.",
    bgKey: "sleep",
  },
  {
    title: "INVISTA\nEM FERRO",
    tip: "Carne vermelha + vitamina C juntos. O estoque dobra.",
    bgKey: "ferro",
  },
  {
    title: "TREINE\nFORÇA",
    tip: "Cada década sem força custa 10% de massa magra. Comece hoje.",
    bgKey: "forca",
  },
  {
    title: "MOVA\nTODO DIA",
    tip: "20–30min de movimento leve. Inflamação aparece em hs-CRP antes da dor.",
    bgKey: "move",
  },
  {
    title: "CHEQUE\nSEU APOB",
    tip: "Colesterol total não mostra risco real. ApoB conta as partículas.",
    bgKey: "apob",
  },
  {
    title: "RESPIRE\nPELO NARIZ",
    tip: "Boca aberta no sono acende cortisol. Nariz acende o vagal.",
    bgKey: "respiracao",
  },
  {
    title: "PROTEJA\nSEU EIXO",
    tip: "Sem tela 90min antes do sono. Cortisol e tireoide reorganizam devagar.",
    bgKey: "hormones",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

// Carrega bg blur photo do Higgsfield (esperado em RUN_DIR/bg-<key>.png)
// Se ainda não baixou, retorna placeholder taupe sólido
async function loadCardBg(key) {
  const p = path.join(RUN_DIR, `bg-${key}.png`);
  if (!fs.existsSync(p)) {
    // Placeholder gradient taupe enquanto Higgsfield cozinha
    const svg = `<svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#A29B89"/>
        <stop offset="1" stop-color="#6B5E4E"/>
      </linearGradient></defs>
      <rect width="${CARD_W}" height="${CARD_H}" fill="url(#g)"/>
    </svg>`;
    return sharp(Buffer.from(svg)).png().toBuffer();
  }
  // Cover-fit + slight blur extra pra garantir o look dreamy
  return sharp(p)
    .resize(CARD_W, CARD_H, { fit: "cover", position: "center" })
    .blur(8)
    .png()
    .toBuffer();
}

// Aplica rounded-corner mask no card bg + gradient bottom pra dar contraste ao body tip
async function maskRounded(bgBuf) {
  const mask = Buffer.from(
    `<svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${CARD_W}" height="${CARD_H}" rx="${CARD_RADIUS}" ry="${CARD_RADIUS}" fill="white"/>
    </svg>`
  );
  // Gradient overlay: darker no bottom 45% pra body tip ler
  const grad = Buffer.from(
    `<svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#000" stop-opacity="0.18"/>
        <stop offset="0.4" stop-color="#000" stop-opacity="0.10"/>
        <stop offset="0.55" stop-color="#000" stop-opacity="0.35"/>
        <stop offset="1" stop-color="#000" stop-opacity="0.62"/>
      </linearGradient></defs>
      <rect width="${CARD_W}" height="${CARD_H}" fill="url(#g)" rx="${CARD_RADIUS}" ry="${CARD_RADIUS}"/>
    </svg>`
  );
  const masked = await sharp(bgBuf).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  return sharp(masked).composite([{ input: grad, top: 0, left: 0 }]).png().toBuffer();
}

// SVG overlay com título + tip dentro do card
function cardOverlaySvg(title, tip) {
  // Título: 3 ou 2 linhas, uppercase, peso pesado, branco
  const titleLines = title.split("\n");
  const titleFontSize = 88;
  const titleStartY = 160; // dentro do card local space

  let svg = `<svg width="${CARD_W}" height="${CARD_H}" xmlns="http://www.w3.org/2000/svg">`;

  // Título
  titleLines.forEach((ln, i) => {
    svg += `<text x="68" y="${titleStartY + i * titleFontSize * 1.05}" font-family="Inter, Helvetica, sans-serif" font-size="${titleFontSize}" font-weight="700" fill="#FFFFFF" letter-spacing="-2">${esc(ln)}</text>`;
  });

  // Tip: na metade inferior, com bullet circular outlined (lightbulb stylized)
  const tipY = CARD_H - 260;
  const bulbX = 78;
  const bulbY = tipY - 28;
  // Outlined circle como "lightbulb minimal"
  svg += `<circle cx="${bulbX}" cy="${bulbY}" r="22" fill="none" stroke="#FFFFFF" stroke-width="1.5" opacity="0.85"/>`;
  // Pequeno bulb shape interno (filament hint)
  svg += `<path d="M ${bulbX-7} ${bulbY-4} Q ${bulbX} ${bulbY-12} ${bulbX+7} ${bulbY-4} L ${bulbX+5} ${bulbY+6} L ${bulbX-5} ${bulbY+6} Z" fill="none" stroke="#FFFFFF" stroke-width="1.2" opacity="0.85"/>`;

  // Tip text (wrap mais wide, fonte um pouco maior pra readibility)
  const tipLines = wrapText(tip, 38);
  const tipFontSize = 32;
  tipLines.forEach((ln, i) => {
    svg += `<text x="128" y="${tipY + i * tipFontSize * 1.32}" font-family="Inter, sans-serif" font-size="${tipFontSize}" font-weight="500" fill="#FFFFFF" opacity="1.0">${esc(ln)}</text>`;
  });

  svg += `</svg>`;
  return Buffer.from(svg);
}

function wrapText(text, maxChars) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length <= maxChars) cur = (cur + " " + w).trim();
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// SVG do header (fixed para todos os frames). SEM play button — era artefato
// do screenshot IG do user, não parte do design Mito.
function chromeOverlaySvg() {
  const headerY = 180;
  let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<text x="${W/2}" y="${headerY}" font-family="Inter, sans-serif" font-size="46" font-weight="500" fill="${DARK}" text-anchor="middle" letter-spacing="-0.5">Pressione e segure</text>`;
  svg += `<text x="${W/2}" y="${headerY + 64}" font-family="Inter, sans-serif" font-size="46" font-weight="500" fill="${DARK}" text-anchor="middle" letter-spacing="-0.5">pra revelar sua dica:</text>`;
  svg += `</svg>`;
  return Buffer.from(svg);
}

// ─── LOGO wordmark Longevify bottom-center ────────────────────────────────────
async function loadLogo() {
  // Tenta logo dark; se não tem, usa o white com tinted preto
  let logoSrc;
  if (fs.existsSync(LOGO_PATH)) {
    logoSrc = LOGO_PATH;
  } else {
    // Fallback: logo-horizontal-white + negate pra ficar dark sobre bg branco
    logoSrc = path.join(ROOT, "assets", "logo-horizontal-white.png");
  }
  const trimmed = await sharp(logoSrc).trim().toBuffer({ resolveWithObject: true });
  const cropH = Math.round(trimmed.info.height * 0.78);
  let wordmark = await sharp(trimmed.data)
    .extract({ left: 0, top: 0, width: trimmed.info.width, height: cropH })
    .toBuffer();
  // Se veio do logo-white, inverte pra dark
  if (!fs.existsSync(LOGO_PATH)) {
    wordmark = await sharp(wordmark).negate({ alpha: false }).toBuffer();
  }
  const logoW = Math.round(W * 0.22);
  return sharp(wordmark).resize(logoW).toBuffer();
}

// ─── Compõe um frame específico ──────────────────────────────────────────────
async function renderFrame(cardIndex, framePhase, logoBuf, chromeBuf) {
  const card = CARDS[cardIndex];
  // Calcula opacity + scale do card baseado na phase
  let opacity = 1;
  let scale = 1;
  if (framePhase < POP_IN_FRAMES) {
    const t = framePhase / POP_IN_FRAMES;
    const e = easeOutCubic(t);
    opacity = e;
    scale = 0.93 + 0.07 * e;
  } else if (framePhase < POP_IN_FRAMES + HOLD_FRAMES) {
    opacity = 1;
    scale = 1;
  } else {
    const t = (framePhase - POP_IN_FRAMES - HOLD_FRAMES) / FADE_OUT_FRAMES;
    opacity = 1 - easeOutCubic(t);
    scale = 1; // mantém scale no fade-out
  }

  // BG branco
  let canvas = await sharp({
    create: { width: W, height: H, channels: 4, background: BG_WHITE },
  }).png().toBuffer();

  // Card composto (BG photo + rounded mask + content overlay)
  const cardBgRaw = await loadCardBg(card.bgKey);
  const cardBgMasked = await maskRounded(cardBgRaw);
  const contentOverlay = cardOverlaySvg(card.title, card.tip);
  let cardComposed = await sharp(cardBgMasked)
    .composite([{ input: contentOverlay, top: 0, left: 0 }])
    .png()
    .toBuffer();

  // Se scale != 1, redimensiona o card composto e ajusta posição
  let cardW = CARD_W, cardH = CARD_H, cardX = CARD_X, cardY = CARD_Y;
  if (scale !== 1) {
    cardW = Math.round(CARD_W * scale);
    cardH = Math.round(CARD_H * scale);
    cardX = Math.round(CARD_X + (CARD_W - cardW) / 2);
    cardY = Math.round(CARD_Y + (CARD_H - cardH) / 2);
    cardComposed = await sharp(cardComposed).resize(cardW, cardH).toBuffer();
  }

  // Aplica opacity ao card (sharp não tem opacity direta; convolui com alpha mask)
  if (opacity < 1) {
    const alpha = Math.round(255 * opacity);
    cardComposed = await sharp(cardComposed)
      .ensureAlpha()
      .composite([{
        input: Buffer.from(`<svg width="${cardW}" height="${cardH}"><rect width="${cardW}" height="${cardH}" fill="white" opacity="${opacity}"/></svg>`),
        blend: "dest-in",
      }])
      .png()
      .toBuffer();
  }

  // Composite: canvas (white) + card + chrome (header + play + wordmark)
  canvas = await sharp(canvas)
    .composite([{ input: cardComposed, top: cardY, left: cardX }])
    .png()
    .toBuffer();

  // Chrome overlay (header + play triangle no centro card)
  canvas = await sharp(canvas)
    .composite([{ input: chromeBuf, top: 0, left: 0 }])
    .png()
    .toBuffer();

  // Wordmark Longevify dark bottom center
  const logoMeta = await sharp(logoBuf).metadata();
  const logoX = Math.round((W - logoMeta.width) / 2);
  const logoY = H - logoMeta.height - 110;
  canvas = await sharp(canvas)
    .composite([{ input: logoBuf, top: logoY, left: logoX }])
    .png()
    .toBuffer();

  return canvas;
}

// ─── Main: render todos os frames ────────────────────────────────────────────
console.log(`🎬 Renderizando reel Mito-style · ${CARDS.length} cards · ${CARDS.length * PER_CARD} frames · ${(CARDS.length * PER_CARD / FPS).toFixed(1)}s\n`);

const logoBuf = await loadLogo();
const chromeBuf = await sharp(chromeOverlaySvg()).png().toBuffer();

let frameNum = 0;
for (let ci = 0; ci < CARDS.length; ci++) {
  for (let fp = 0; fp < PER_CARD; fp++) {
    const buf = await renderFrame(ci, fp, logoBuf, chromeBuf);
    const path0 = path.join(TMP_DIR, `f-${String(frameNum).padStart(4, "0")}.png`);
    fs.writeFileSync(path0, buf);
    frameNum++;
    if (frameNum % 30 === 0) process.stdout.write(`  ${frameNum} frames · `);
  }
}
console.log(`\n  ✓ ${frameNum} frames renderizados`);

// ─── Encode mp4 ──────────────────────────────────────────────────────────────
const outMp4 = path.join(RUN_DIR, "slide-1-reel.mp4");
console.log(`\n🎞 Encoding mp4...`);
execSync(
  `ffmpeg -y -framerate ${FPS} -i ${TMP_DIR}/f-%04d.png -fps_mode cfr -pix_fmt yuv420p -c:v libx264 -preset slow -crf 16 -movflags +faststart ${outMp4}`,
  { stdio: "pipe" }
);

const stats = fs.statSync(outMp4);
console.log(`✓ ${path.relative(ROOT, outMp4)} · ${(stats.size / 1024 / 1024).toFixed(2)} MB · ${frameNum} frames @ ${FPS}fps`);
