/**
 * render-carousel-sharp.ts — Renderer pixel-perfect via Sharp + SVG.
 *
 * Por quê: Higgsfield (gen image) erra typography brasileira — duplicações,
 * specs vazando, paleta inconsistente. Esse script ignora geração AI no visual
 * e compõe slides com tipografia controlada.
 *
 * Paleta LOCKED (override no aceito):
 *   bg = #1C3F3A (forest médio Longevify)
 *   text = #f8fffc (off-white)
 *   gold = #C89136 (numeração + números-âncora)
 *   sage = #557D6D (meta / micro)
 *
 * Output: runs/<run-id>/assets/slide-N.png (1080x1350, 4:5)
 *
 * Uso:
 *   npm run render-carousel-sharp -- --run 2026-05-21-001-gravidez-...
 *   npm run render-carousel-sharp -- --run X --slides "1,3,5"  (regen específicos)
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const W = 1080;
const H = 1350;
const PALETTE = {
  bg: "#1C3F3A",
  text: "#f8fffc",
  gold: "#C89136",
  sage: "#557D6D",
} as const;

const LOGO = path.join(ROOT, "assets/logo-horizontal-white.png");
const FONT_LIGHT = path.join(ROOT, "assets/fonts/DMSans-Light.ttf");
const FONT_REGULAR = path.join(ROOT, "assets/fonts/DMSans-Regular.ttf");
const FONT_MEDIUM = path.join(ROOT, "assets/fonts/DMSans-Medium.ttf");

interface Slide {
  n: number;
  total: number;
  kicker?: string;   // "01 / DOIS FATORES DECISIVOS" — ou só "01 / 05"
  headline: string;  // body text central
  emphasis?: string; // string a destacar em gold dentro do headline
  micro?: string;    // texto pequeno bottom (proof / source)
  layout?: "default" | "hero" | "two-column";
  twoCol?: { left: { heading: string; body: string }; right: { heading: string; body: string } };
}

interface CarouselSpec {
  runId: string;
  slides: Slide[];
}

// ─── SVG composer ─────────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]!));
}

/** Respeita \n manuais primeiro, depois quebra cada segmento por palavra. */
function wrapText(text: string, maxCharsPerLine: number): string[] {
  const segments = text.split(/\n/);
  const lines: string[] = [];
  for (const seg of segments) {
    if (!seg.trim()) { lines.push(""); continue; }
    const words = seg.split(/\s+/);
    let current = "";
    for (const w of words) {
      if ((current + " " + w).trim().length <= maxCharsPerLine) {
        current = (current + " " + w).trim();
      } else {
        if (current) lines.push(current);
        current = w;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function buildSlideSvg(slide: Slide): string {
  const padX = 96;
  // Single image (total=1): só mostra kicker sem "01/01"
  const numText = slide.total === 1
    ? (slide.kicker ?? "")
    : `${String(slide.n).padStart(2, "0")} / ${String(slide.total).padStart(2, "0")}${slide.kicker ? ` · ${slide.kicker}` : ""}`;

  let body = `
  <rect width="${W}" height="${H}" fill="${PALETTE.bg}"/>`;

  if (numText) {
    body += `
  <text x="${padX}" y="${110}"
    font-family="DM Sans" font-size="22" font-weight="400"
    fill="${PALETTE.gold}" letter-spacing="2.2">${escapeXml(numText.toUpperCase())}</text>`;
  }

  if (slide.layout === "two-column" && slide.twoCol) {
    // Reserva mais espaço: colunas mais estreitas, font menor, headings com wrap manual
    const gap = 60;
    const colW = (W - padX * 2 - gap) / 2;
    const colLeftX = padX;
    const colRightX = padX + colW + gap;
    const dividerX = padX + colW + gap / 2;

    body += `
    <line x1="${dividerX}" y1="380" x2="${dividerX}" y2="${H - 280}" stroke="${PALETTE.gold}" stroke-width="1" opacity="0.6"/>`;

    const HEADING_FONT = 36;
    const BODY_FONT = 24;
    const wrapLeft = wrapText(slide.twoCol.left.heading, 16);
    const wrapRight = wrapText(slide.twoCol.right.heading, 16);
    const wrapLeftBody = wrapText(slide.twoCol.left.body, 30);
    const wrapRightBody = wrapText(slide.twoCol.right.body, 30);

    const headingY = 500;
    wrapLeft.forEach((ln, i) => {
      body += `<text x="${colLeftX}" y="${headingY + i * (HEADING_FONT * 1.2)}" font-family="DM Sans" font-size="${HEADING_FONT}" font-weight="500" fill="${PALETTE.text}">${escapeXml(ln)}</text>`;
    });
    let yBody = headingY + wrapLeft.length * (HEADING_FONT * 1.2) + 36;
    wrapLeftBody.forEach((ln, i) => {
      body += `<text x="${colLeftX}" y="${yBody + i * (BODY_FONT * 1.4)}" font-family="DM Sans" font-size="${BODY_FONT}" font-weight="300" fill="${PALETTE.text}" opacity="0.8">${escapeXml(ln)}</text>`;
    });

    wrapRight.forEach((ln, i) => {
      body += `<text x="${colRightX}" y="${headingY + i * (HEADING_FONT * 1.2)}" font-family="DM Sans" font-size="${HEADING_FONT}" font-weight="500" fill="${PALETTE.text}">${escapeXml(ln)}</text>`;
    });
    yBody = headingY + wrapRight.length * (HEADING_FONT * 1.2) + 36;
    wrapRightBody.forEach((ln, i) => {
      body += `<text x="${colRightX}" y="${yBody + i * (BODY_FONT * 1.4)}" font-family="DM Sans" font-size="${BODY_FONT}" font-weight="300" fill="${PALETTE.text}" opacity="0.8">${escapeXml(ln)}</text>`;
    });
  } else {
    // Default: centered headline
    const fontSize = slide.layout === "hero" ? 112 : 58;
    const maxChars = slide.layout === "hero" ? 16 : 26;
    const wrapped = wrapText(slide.headline, maxChars);
    const lineH = fontSize * 1.12;
    const totalTextH = wrapped.length * lineH;
    const startY = (H - totalTextH) / 2 + fontSize * 0.4;

    wrapped.forEach((ln, i) => {
      // Highlight emphasis em gold se presente
      const hasEmph = slide.emphasis && ln.includes(slide.emphasis);
      if (hasEmph) {
        const parts = ln.split(slide.emphasis!);
        let cursor = 0;
        // Implementação simples: renderiza linha inteira em gold se a ênfase está nela
        body += `<text x="${W / 2}" y="${startY + i * lineH}" font-family="DM Sans" font-size="${fontSize}" font-weight="300" fill="${PALETTE.gold}" text-anchor="middle">${escapeXml(ln)}</text>`;
      } else {
        body += `<text x="${W / 2}" y="${startY + i * lineH}" font-family="DM Sans" font-size="${fontSize}" font-weight="300" fill="${PALETTE.text}" text-anchor="middle" letter-spacing="-1.2">${escapeXml(ln)}</text>`;
      }
    });

    if (slide.micro) {
      const microWrap = wrapText(slide.micro, 70);
      const microY = H - 260;
      microWrap.forEach((ln, i) => {
        body += `<text x="${W / 2}" y="${microY + i * 26}" font-family="DM Sans" font-size="18" font-weight="300" fill="${PALETTE.sage}" text-anchor="middle" font-style="italic">${escapeXml(ln)}</text>`;
      });
    }
  }

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

async function renderSlide(slide: Slide, outPath: string): Promise<void> {
  const svg = buildSlideSvg(slide);
  const svgBuffer = Buffer.from(svg);

  // Composite: bg + svg overlay + logo bottom-center
  let img = sharp(svgBuffer).resize(W, H);

  // Logo overlay
  if (fs.existsSync(LOGO)) {
    const logoW = Math.round(W * 0.25); // 25% width
    const logoBuf = await sharp(LOGO).resize(logoW).toBuffer();
    const meta = await sharp(logoBuf).metadata();
    const logoX = Math.round((W - logoW) / 2);
    const logoY = Math.round(H - (meta.height ?? 80) - 80);
    // Renderiza SVG primeiro, depois logo
    const baseBuf = await img.png().toBuffer();
    img = sharp(baseBuf).composite([{ input: logoBuf, left: logoX, top: logoY }]);
  }

  await img.png().toFile(outPath);
  console.log(`  ✓ ${path.basename(outPath)}`);
}

// ─── Slide spec parser (lê draft-package.md) ─────────────────────────────────

function parseRunSlides(runId: string): Slide[] {
  // Por enquanto: hardcoded specs por run-id (até integrar parser do md)
  const SPECS: Record<string, Slide[]> = {
    "2026-05-21-001-gravidez-idade-biologica-plot-twist": [
      { n: 1, total: 6, headline: "Envelhece 2.\nRejuvenesce 8.", layout: "hero", micro: "A gravidez vista pelo relógio biológico · Yale School of Medicine" },
      { n: 2, total: 6, kicker: "O CUSTO METABÓLICO", headline: "Gerar um humano impõe demanda celular intensa. Ao final da gestação, marcadores epigenéticos indicam aceleração média de ~2 anos.", micro: "Marcadores: DNAm PhenoAge, GrimAge" },
      { n: 3, total: 6, kicker: "TRÊS MESES DEPOIS", headline: "−8 anos abaixo do pico da gestação.", layout: "hero", micro: "Aos 3 meses pós-parto, a idade biológica não apenas estabiliza — ela cai." },
      { n: 4, total: 6, kicker: "DOIS FATORES DECISIVOS", headline: "", layout: "two-column", twoCol: { left: { heading: "IMC pré-gestacional", body: "mais elevado dificulta a recuperação celular." }, right: { heading: "Amamentação exclusiva", body: "acelera o retorno biológico." } } },
      { n: 5, total: 6, kicker: "A PERGUNTA EM ABERTO", headline: "O corpo retorna à linha de base — ou a gravidez deixa a mulher biologicamente mais jovem?", micro: "Kieran O'Donnell, Yale School of Medicine" },
      { n: 6, total: 6, kicker: "SUA IDADE BIOLÓGICA SE MOVE", headline: "Idade cronológica é fixa. Idade biológica responde a sono, dieta, treino, gestação, lactação.", micro: "Mapeá-la é o primeiro passo · link na bio" },
    ],
    "2026-05-21-001-mitocondria-idade-biologica": [
      { n: 1, total: 5, headline: "Duas idades.\nUma conta.", layout: "hero" },
      { n: 2, total: 5, kicker: "DECLÍNIO PROGRESSIVO", headline: "A função mitocondrial cai entre 7% e 10% por década depois dos 30.", micro: "Short et al., PNAS 2005" },
      { n: 3, total: 5, kicker: "MECANISMO", headline: "Mitocôndria saudável produz energia celular. Energia celular sustenta o tecido. Tecido sustentado sustenta o corpo.", micro: "A idade biológica começa na escala da célula" },
      { n: 4, total: 5, kicker: "FORA DO CHECK-UP", headline: "O exame de rotina entrega idade cronológica de graça. Idade biológica continua fora do laudo padrão.", micro: "HOMA-IR · lactato em esforço · VO2 máx · painéis epigenéticos" },
      { n: 5, total: 5, kicker: "A PERGUNTA MUDOU", headline: "Não é parecer mais novo.\nÉ ter energia mais nova.", layout: "hero", micro: "link na bio" },
    ],
    "2026-05-22-001-faixa-funcional-glicose": [
      { n: 1, total: 1, kicker: "FAIXA FUNCIONAL · 03", headline: "", layout: "two-column", twoCol: { left: { heading: "FAIXA LABORATÓRIO\n< 140 mg/dL", body: "referência ADA · padrão populacional" }, right: { heading: "FAIXA FUNCIONAL\n< 120 mg/dL", body: "Longevify · padrão preventivo" } } },
    ],
    "2026-05-24-001-overheard-apob-colesterol-bom": [
      { n: 1, total: 5, headline: '"Meu colesterol tá bom, doutor."', layout: "hero", micro: "— paciente, 42 anos, São Paulo" },
      { n: 2, total: 5, kicker: "O EXAME, LADO A LADO", headline: "Total 180 · LDL 95 · ApoB 132", layout: "hero", micro: "Mesmo lipidograma. Três leituras diferentes." },
      { n: 3, total: 5, kicker: "ApoB CONTA O QUE LDL NÃO CAPTA", headline: "LDL mede o colesterol dentro das partículas. ApoB mede as partículas.", micro: "Cada partícula com ApoB pode atravessar a parede da artéria." },
      { n: 4, total: 5, kicker: "FAIXA POPULACIONAL vs FUNCIONAL", headline: "", layout: "two-column", twoCol: { left: { heading: "POPULACIONAL\naté 130", body: "calibrado para a média da população" }, right: { heading: "FUNCIONAL\nabaixo de 90", body: "calibrado para quem quer evitar o evento" } } },
      { n: 5, total: 5, headline: "O exame entregou o número.\nNão entregou a leitura.", layout: "hero", micro: "Longevify · link na bio" },
    ],
  };
  if (!SPECS[runId]) throw new Error(`Sem spec hardcoded pra run-id: ${runId}`);
  return SPECS[runId];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let runId = "";
  let slidesFilter: number[] | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--run") runId = args[++i];
    else if (args[i] === "--slides") slidesFilter = args[++i].split(",").map((s) => parseInt(s.trim(), 10));
  }
  if (!runId) {
    console.error("Usage: npm run render-carousel-sharp -- --run <run-id> [--slides 1,3,5]");
    process.exit(1);
  }

  const runDir = path.join(ROOT, "runs", runId);
  const assetsDir = path.join(runDir, "assets");
  if (!fs.existsSync(runDir)) throw new Error(`Run dir não existe: ${runDir}`);
  fs.mkdirSync(assetsDir, { recursive: true });

  const slides = parseRunSlides(runId);
  const filtered = slidesFilter ? slides.filter((s) => slidesFilter!.includes(s.n)) : slides;

  console.log(`🎨 Render Sharp+SVG: ${runId}`);
  console.log(`   ${filtered.length} slide(s) · paleta ${PALETTE.bg} / ${PALETTE.gold} / ${PALETTE.text}`);

  for (const slide of filtered) {
    const isSingle = slide.total === 1;
    const filename = isSingle ? "single-image.png" : `slide-${slide.n}.png`;
    const out = path.join(assetsDir, filename);
    await renderSlide(slide, out);
  }

  console.log(`\n✓ Done. Assets em runs/${runId}/assets/`);
}

main().catch((err) => {
  console.error("\n❌ Falhou:", err.message);
  process.exit(1);
});
