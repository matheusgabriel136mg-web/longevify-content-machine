/**
 * generate-runner-editorial.ts
 * Imagem editorial premium 4:5 estilo campanha de longevidade.
 *
 * Pipeline:
 *   1. NB2 gera fundo: corredor na praia, motion blur, cinematic
 *   2. sharp composita:
 *      - Gradiente escuro no topo esquerdo (legibilidade do texto)
 *      - Headline Playfair Display (serif, branca)
 *      - Subtítulo DM Sans (sans, branca)
 *      - 6 pills glassmorphism com backdrop blur real
 */

import { fal }      from "@fal-ai/client";
import sharp        from "sharp";
import * as fs      from "fs";
import * as path    from "path";
import { fileURLToPath } from "url";

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, "..");
const FONTS_DIR  = path.join(ROOT, "assets/fonts");
const OUT_DIR    = path.join(ROOT, "output/stories");
const LOGO_PATH  = path.join(ROOT, "assets/logo-horizontal-white.png");
const TMP_RAW    = "/tmp/runner-raw.jpg";

fs.mkdirSync(OUT_DIR, { recursive: true });
fal.config({ credentials: process.env.FAL_KEY });

// ── Dimensões 4:5 ─────────────────────────────────────────────────────────────
const W = 1080, H = 1350;

// ── Fontes ────────────────────────────────────────────────────────────────────
function b64(file: string) {
  return fs.readFileSync(path.join(FONTS_DIR, file)).toString("base64");
}

const FONTS_CSS = () => `
  @font-face { font-family:'Playfair'; font-weight:400;
    src:url('data:font/ttf;base64,${b64("PlayfairDisplay-Regular.ttf")}') }
  @font-face { font-family:'Playfair'; font-weight:500;
    src:url('data:font/ttf;base64,${b64("PlayfairDisplay-Medium.ttf")}') }
  @font-face { font-family:'DMSans';   font-weight:300;
    src:url('data:font/ttf;base64,${b64("DMSans-Light.ttf")}') }
  @font-face { font-family:'DMSans';   font-weight:400;
    src:url('data:font/ttf;base64,${b64("DMSans-Regular.ttf")}') }
`;

// ── Etapa 1: gera fundo com NB2 ───────────────────────────────────────────────

async function generateBackground(): Promise<string> {
  if (fs.existsSync(TMP_RAW)) {
    console.log("  ⏭  Fundo já existe, reutilizando...");
    return TMP_RAW;
  }

  // Tenta GPT Image 2 — se falhar, usa fundo sintético
  console.log("  🖼  Tentando GPT Image 2...");
  const prompt = `
Premium health brand editorial photography. Motion blur action shot on a beach.
Dark silhouette of an athlete in motion wearing black shirt and light shorts,
occupying center-right of frame. Background: soft blue sky, low horizon, blurred
sand and ocean. Shallow depth of field, natural bokeh, analog film grain.
Cool blue-gray and teal ocean tones. Cinematic, premium aesthetic.
DSLR 85mm f/1.8 look. No text. No logos. Vertical portrait orientation.
`.trim();

  try {
    const r = await fal.subscribe("openai/gpt-image-2", {
      input: { prompt, image_size: "portrait_4_3", quality: "high",
               num_images: 1, output_format: "jpeg" },
      logs: false,
    }) as { data: { images: Array<{ url: string }> } };

    const url = r.data.images[0]?.url;
    if (url) {
      const res = await fetch(url);
      fs.writeFileSync(TMP_RAW, Buffer.from(await res.arrayBuffer()));
      console.log("  ✅ Fundo gerado via API");
      return TMP_RAW;
    }
  } catch {
    console.log("  ⚠️  API indisponível — usando fundo sintético (placeholder visual)");
  }

  // Fundo sintético: gradiente céu → areia → oceano + silhueta escura
  const bgSvg = `<svg width="${W}" height="${Math.round(W * 4/3)}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="#7fb3d3"/>
        <stop offset="45%"  stop-color="#a8c8e0"/>
        <stop offset="55%"  stop-color="#c8dde8"/>
        <stop offset="65%"  stop-color="#d4c4a0"/>
        <stop offset="80%"  stop-color="#b8a87c"/>
        <stop offset="100%" stop-color="#8899aa"/>
      </linearGradient>
      <filter id="blur1"><feGaussianBlur stdDeviation="18"/></filter>
      <filter id="blur2"><feGaussianBlur stdDeviation="8"/></filter>
      <filter id="noise">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" stitchTiles="stitch"/>
        <feColorMatrix type="saturate" values="0"/>
        <feBlend in="SourceGraphic" mode="soft-light"/>
      </filter>
    </defs>
    <!-- Fundo céu/areia/mar -->
    <rect width="${W}" height="${Math.round(W * 4/3)}" fill="url(#sky)"/>
    <!-- Horizonte suave -->
    <ellipse cx="${W * 0.5}" cy="${Math.round(W * 4/3 * 0.58)}" rx="${W * 0.9}" ry="60"
      fill="#9ab8c8" fill-opacity="0.4" filter="url(#blur1)"/>
    <!-- Silhueta corredor (forma aproximada) -->
    <g filter="url(#blur2)" opacity="0.88">
      <!-- Corpo -->
      <ellipse cx="${W * 0.68}" cy="${Math.round(W * 4/3 * 0.52)}" rx="95" ry="260"
        fill="#1a1a1a" transform="rotate(-8, ${W*0.68}, ${Math.round(W*4/3*0.52)})"/>
      <!-- Cabeça -->
      <circle cx="${W * 0.70}" cy="${Math.round(W * 4/3 * 0.29)}" r="55" fill="#1a1a1a"/>
      <!-- Braço dianteiro -->
      <ellipse cx="${W * 0.52}" cy="${Math.round(W * 4/3 * 0.48)}" rx="22" ry="100"
        fill="#1a1a1a" transform="rotate(-30, ${W*0.52}, ${Math.round(W*4/3*0.48)})"/>
      <!-- Perna dianteira -->
      <ellipse cx="${W * 0.60}" cy="${Math.round(W * 4/3 * 0.72)}" rx="26" ry="120"
        fill="#1a1a1a" transform="rotate(15, ${W*0.60}, ${Math.round(W*4/3*0.72)})"/>
    </g>
    <!-- Grain analógico -->
    <rect width="${W}" height="${Math.round(W * 4/3)}" fill="rgba(255,255,255,0.04)" filter="url(#noise)"/>
    <!-- Vinheta suave nas bordas -->
    <radialGradient id="vig" cx="50%" cy="50%" r="70%">
      <stop offset="0%"   stop-color="transparent"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.45)"/>
    </radialGradient>
    <rect width="${W}" height="${Math.round(W * 4/3)}" fill="url(#vig)"/>
  </svg>`;

  await sharp(Buffer.from(bgSvg), { density: 96 })
    .resize(W, Math.round(W * 4/3))
    .jpeg({ quality: 92 })
    .toFile(TMP_RAW);

  console.log("  ✅ Fundo sintético gerado");
  return TMP_RAW;
}

// ── Etapa 2: compositing ──────────────────────────────────────────────────────

// Gradiente escuro no topo-esquerdo para legibilidade do texto
function svgGradient(): string {
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="tl" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="#000" stop-opacity="0.72"/>
      <stop offset="55%"  stop-color="#000" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#tl)"/>
</svg>`;
}

// Headline Playfair Display + subtítulo DM Sans
function svgTexts(): string {
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs><style>${FONTS_CSS()}</style></defs>

  <!-- Headline linha 1 -->
  <text x="72" y="190"
    font-family="Playfair" font-weight="400" font-size="80"
    fill="white" fill-opacity="0.97" letter-spacing="-1">Exames, sintomas &amp;</text>

  <!-- Headline linha 2 -->
  <text x="72" y="282"
    font-family="Playfair" font-weight="400" font-size="80"
    fill="white" fill-opacity="0.97" letter-spacing="-1">conversas</text>

  <!-- Subtítulo linha 1 -->
  <text x="72" y="340"
    font-family="DMSans" font-weight="300" font-size="32"
    fill="white" fill-opacity="0.82" letter-spacing="0.2">Tudo armazenado em um só lugar</text>
  <!-- Subtítulo linha 2 -->
  <text x="72" y="378"
    font-family="DMSans" font-weight="300" font-size="32"
    fill="white" fill-opacity="0.82" letter-spacing="0.2">enquanto sua saúde evolui.</text>
</svg>`;
}

// Uma pill glassmorphism
// px, py = posição top-left; label = texto uppercase
function pillSvg(px: number, py: number, label: string): string {
  const FONT_SIZE = 22;
  const PAD_X     = 18;
  const PAD_Y     = 14;
  const SQ        = 10;
  const GAP       = 10;
  // Estima largura pelo tamanho do texto (aprox 12px por char em 22px monospace)
  const textW     = label.length * 12.2;
  const pillW     = SQ + GAP + textW + PAD_X * 2;
  const pillH     = FONT_SIZE + PAD_Y * 2;

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs><style>${FONTS_CSS()}</style></defs>
  <!-- pill background -->
  <rect x="${px}" y="${py}" width="${pillW}" height="${pillH}" rx="10" ry="10"
    fill="rgba(15,20,18,0.72)" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>
  <!-- quadrado indicador -->
  <rect x="${px + PAD_X}" y="${py + PAD_Y + (FONT_SIZE - SQ)/2}"
    width="${SQ}" height="${SQ}" rx="2" fill="white" fill-opacity="0.9"/>
  <!-- label texto -->
  <text x="${px + PAD_X + SQ + GAP}" y="${py + PAD_Y + FONT_SIZE * 0.82}"
    font-family="'Courier New', Courier, monospace" font-size="${FONT_SIZE}"
    fill="white" fill-opacity="0.95" letter-spacing="0.5">${label}</text>
</svg>`;
}

// Aplica backdrop blur numa região e composita a pill por cima
async function compositePill(
  base: sharp.Sharp,
  px: number, py: number, label: string
): Promise<Buffer> {
  const FONT_SIZE  = 22;
  const PAD_X      = 18;
  const PAD_Y      = 14;
  const SQ         = 10;
  const GAP        = 10;
  const textW      = label.length * 12.2;
  const pillW      = Math.ceil(SQ + GAP + textW + PAD_X * 2);
  const pillH      = FONT_SIZE + PAD_Y * 2;

  // Garante que a pill não sai fora dos limites
  const safeX = Math.max(0, Math.min(px, W - pillW));
  const safeY = Math.max(0, Math.min(py, H - pillH));

  // Extrai região de trás da pill → blur → escurece
  const regionBuf = await base.clone()
    .extract({ left: safeX, top: safeY, width: pillW, height: pillH })
    .blur(8)
    .modulate({ brightness: 0.55 })
    .toBuffer();

  // SVG da pill sem fundo (só quadrado + texto)
  const textOnlySvg = `<svg width="${pillW}" height="${pillH}" xmlns="http://www.w3.org/2000/svg">
    <defs><style>${FONTS_CSS()}</style></defs>
    <rect width="${pillW}" height="${pillH}" rx="10" ry="10"
      fill="rgba(0,0,0,0.35)" stroke="rgba(255,255,255,0.14)" stroke-width="1"/>
    <rect x="${PAD_X}" y="${PAD_Y + (FONT_SIZE - SQ)/2}"
      width="${SQ}" height="${SQ}" rx="2" fill="white" fill-opacity="0.9"/>
    <text x="${PAD_X + SQ + GAP}" y="${PAD_Y + FONT_SIZE * 0.82}"
      font-family="'Courier New', Courier, monospace" font-size="${FONT_SIZE}"
      fill="white" fill-opacity="0.95" letter-spacing="0.5">${label}</text>
  </svg>`;

  // Composita texto sobre o fundo borrado
  const pillFinal = await sharp(regionBuf)
    .composite([{ input: Buffer.from(textOnlySvg), blend: "over" }])
    .png()
    .toBuffer();

  return pillFinal;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🖼  Editorial Runner — Longevify");
  console.log("─".repeat(50));

  // 1. Fundo
  const rawPath = await generateBackground();

  // 2. Base: redimensiona + grain
  console.log("  ✏️  Compositing...");
  // portrait_4_3 → crop para 4:5 (pega o centro)
  let base = sharp(rawPath).resize(W, Math.round(W * (4/3)), { fit: "fill" })
    .extract({ left: 0, top: Math.round((W * (4/3) - H) / 2), width: W, height: H });

  // 3. Gradiente + textos (como SVG layers)
  const layers: sharp.OverlayOptions[] = [
    { input: Buffer.from(svgGradient()), blend: "over" },
    { input: Buffer.from(svgTexts()),    blend: "over" },
  ];

  // 4. Pills glassmorphism (backdrop blur real)
  const pills: Array<{ x: number; y: number; label: string }> = [
    { x:  68, y: 430,  label: "RESULTADOS DE EXAMES" },
    { x: 620, y: 290,  label: "DIETA"                },
    { x: 598, y: 520,  label: "QUALIDADE DO SONO"    },
    { x:  68, y: 800,  label: "LESÃO ANTERIOR"       },
    { x:  68, y: 1060, label: "ROTINA DE EXERCÍCIOS" },
    { x: 520, y: 1180, label: "HISTÓRICO FAMILIAR"   },
  ];

  // Extrai fundo base para backdrop blur
  const baseForBlur = sharp(rawPath).resize(W, Math.round(W * (4/3)), { fit: "fill" })
    .extract({ left: 0, top: Math.round((W * (4/3) - H) / 2), width: W, height: H });

  for (const { x, y, label } of pills) {
    const pillBuf = await compositePill(baseForBlur, x, y, label);
    const pillW   = Math.ceil(label.length * 12.2 + 10 + 10 + 18 * 2);
    const pillH   = 22 + 14 * 2;
    layers.push({
      input: pillBuf,
      top:   Math.max(0, Math.min(y, H - pillH)),
      left:  Math.max(0, Math.min(x, W - pillW)),
      blend: "over",
    });
  }

  // 5. Logo (topo, pequeno, canto esquerdo)
  if (fs.existsSync(LOGO_PATH)) {
    const logoW   = 200;
    const logoMeta = await sharp(LOGO_PATH).metadata();
    const logoH   = Math.round(logoW * (logoMeta.height! / logoMeta.width!));
    const logoBuf = await sharp(LOGO_PATH)
      .resize(logoW, logoH)
      .png()
      .toBuffer();
    layers.push({ input: logoBuf, top: 52, left: 68, blend: "over" });
  }

  // 6. Grain analógico via ruído no canal alpha
  const grainSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <filter id="grain">
      <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
      <feBlend in="SourceGraphic" mode="multiply" result="blend"/>
      <feComposite in="blend" in2="SourceGraphic" operator="in"/>
    </filter>
    <rect width="${W}" height="${H}" fill="rgba(255,255,255,0.035)" filter="url(#grain)"/>
  </svg>`;
  layers.push({ input: Buffer.from(grainSvg), blend: "over" });

  // 7. Output
  const ts  = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const out = path.join(OUT_DIR, `${ts}-runner-editorial.jpg`);

  await base
    .composite(layers)
    .jpeg({ quality: 95, mozjpeg: true })
    .toFile(out);

  console.log(`\n✅ Imagem salva:`);
  console.log(`📁 ${out}`);
}

main().catch(e => { console.error("\n❌", e.message); process.exit(1); });
