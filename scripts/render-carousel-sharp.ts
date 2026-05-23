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
  layout?: "default" | "hero" | "two-column" | "faixa-funcional";
  twoCol?: { left: { heading: string; body: string }; right: { heading: string; body: string } };
  faixa?: {
    biomarker: string;          // "GLICOSE PÓS-PRANDIAL"
    subBiomarker?: string;      // "medida 2 horas após a refeição"
    left: { label: string; number: string; unit: string; sub: string };  // {label: "FAIXA LABORATÓRIO", number: "< 140", unit: "mg/dL", sub: "referência ADA"}
    right: { label: string; number: string; unit: string; sub: string };
    footerLines?: string[];     // 2 linhas Georgia italic editorial
  };
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

  if (slide.layout === "faixa-funcional" && slide.faixa) {
    const f = slide.faixa;
    const centerX = W / 2;

    // BIOMARCADOR NAME (centro-topo)
    body += `<text x="${centerX}" y="280" font-family="DM Sans" font-size="42" font-weight="500" fill="${PALETTE.text}" text-anchor="middle" letter-spacing="2.4">${escapeXml(f.biomarker.toUpperCase())}</text>`;
    if (f.subBiomarker) {
      body += `<text x="${centerX}" y="325" font-family="DM Sans" font-size="20" font-weight="300" fill="${PALETTE.sage}" text-anchor="middle" font-style="italic">${escapeXml(f.subBiomarker)}</text>`;
    }

    // Two cols: laboratório (left, off-white) vs funcional (right, gold)
    const gap = 80;
    const colW = (W - padX * 2 - gap) / 2;
    const colLeftCenter = padX + colW / 2;
    const colRightCenter = padX + colW + gap + colW / 2;
    const dividerX = W / 2;
    const numberY = 620;

    // Divider
    body += `<line x1="${dividerX}" y1="430" x2="${dividerX}" y2="900" stroke="${PALETTE.gold}" stroke-width="1" opacity="0.5"/>`;

    // LEFT — laboratório (cream/off-white, mais discreto)
    body += `<text x="${colLeftCenter}" y="450" font-family="DM Sans" font-size="18" font-weight="500" fill="${PALETTE.text}" text-anchor="middle" letter-spacing="2.0" opacity="0.75">${escapeXml(f.left.label.toUpperCase())}</text>`;
    body += `<text x="${colLeftCenter}" y="${numberY}" font-family="DM Sans" font-size="148" font-weight="300" fill="${PALETTE.text}" text-anchor="middle" letter-spacing="-3">${escapeXml(f.left.number)}</text>`;
    body += `<text x="${colLeftCenter}" y="${numberY + 56}" font-family="DM Sans" font-size="26" font-weight="300" fill="${PALETTE.text}" text-anchor="middle" opacity="0.85">${escapeXml(f.left.unit)}</text>`;
    body += `<text x="${colLeftCenter}" y="${numberY + 130}" font-family="Georgia" font-size="18" font-style="italic" fill="${PALETTE.sage}" text-anchor="middle">${escapeXml(f.left.sub)}</text>`;

    // RIGHT — funcional (gold, destaque)
    body += `<text x="${colRightCenter}" y="450" font-family="DM Sans" font-size="18" font-weight="500" fill="${PALETTE.gold}" text-anchor="middle" letter-spacing="2.0">${escapeXml(f.right.label.toUpperCase())}</text>`;
    body += `<text x="${colRightCenter}" y="${numberY}" font-family="DM Sans" font-size="148" font-weight="300" fill="${PALETTE.gold}" text-anchor="middle" letter-spacing="-3">${escapeXml(f.right.number)}</text>`;
    body += `<text x="${colRightCenter}" y="${numberY + 56}" font-family="DM Sans" font-size="26" font-weight="300" fill="${PALETTE.gold}" text-anchor="middle" opacity="0.85">${escapeXml(f.right.unit)}</text>`;
    body += `<text x="${colRightCenter}" y="${numberY + 130}" font-family="Georgia" font-size="18" font-style="italic" fill="${PALETTE.gold}" text-anchor="middle" opacity="0.75">${escapeXml(f.right.sub)}</text>`;

    // Footer editorial 2 linhas
    if (f.footerLines) {
      const footY = 1010;
      f.footerLines.forEach((ln, i) => {
        body += `<text x="${centerX}" y="${footY + i * 30}" font-family="Georgia" font-size="22" font-style="italic" fill="${PALETTE.text}" text-anchor="middle" opacity="0.85">${escapeXml(ln)}</text>`;
      });
    }
  } else if (slide.layout === "two-column" && slide.twoCol) {
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

  // Logo overlay — trim + crop pra remover a linha decorativa do design original
  if (fs.existsSync(LOGO)) {
    // 1. Trim transparência → bbox real (2000x1148)
    // 2. Extract só os top 78% (corta a linha horizontal decorativa que mora no bottom)
    const trimmed = await sharp(LOGO).trim().toBuffer({ resolveWithObject: true });
    const tw = trimmed.info.width;
    const th = trimmed.info.height;
    const cropH = Math.round(th * 0.78); // mantém só wordmark, descarta underline
    const wordmarkBuf = await sharp(trimmed.data).extract({ left: 0, top: 0, width: tw, height: cropH }).toBuffer();

    // Redimensiona pra ~24% da largura do canvas
    const logoW = Math.round(W * 0.24);
    const logoBuf = await sharp(wordmarkBuf).resize(logoW).toBuffer();
    const meta = await sharp(logoBuf).metadata();
    const logoX = Math.round((W - logoW) / 2);
    const logoY = Math.round(H - (meta.height ?? 80) - 100);

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
      {
        n: 1, total: 1, kicker: "FAIXA FUNCIONAL · 03", headline: "",
        layout: "faixa-funcional",
        faixa: {
          biomarker: "Glicose pós-prandial",
          subBiomarker: "medida 2 horas após a refeição",
          left: { label: "Faixa laboratório", number: "< 140", unit: "mg/dL", sub: "referência ADA · padrão populacional" },
          right: { label: "Faixa funcional", number: "< 120", unit: "mg/dL", sub: "Longevify · padrão preventivo" },
          footerLines: [
            "A diferença entre as faixas não é estatística.",
            "É o intervalo silencioso onde a glicação acontece.",
          ],
        },
      },
    ],
    "2026-05-22-002-your-mitochondrias-favorite-headline-from-bm": [
      { n: 1, total: 5, headline: "A célula que decide\nse você envelhece bem.", layout: "hero", micro: "01 · mitocôndria" },
      { n: 2, total: 5, kicker: "O QUE É", headline: "Em cada célula, milhares delas. Pequenas usinas que viram o que você comeu hoje em energia pra treinar amanhã.", micro: "Energia. Recuperação. Resiliência. Tudo passa por elas." },
      { n: 3, total: 5, kicker: "COMO ENVELHECEM", headline: "Com o tempo, a usina perde rendimento. Produz menos ATP. Sinaliza inflamação de baixo grau — inflammaging.", micro: "O cansaço aos 45 raramente é preguiça. É bioenergética caindo." },
      { n: 4, total: 5, kicker: "O QUE DE FATO AJUDA", headline: "Zona 2 + força. Restrição calórica leve + jejum noturno. Sono profundo consistente.", micro: "Suplemento entra depois. Não antes." },
      { n: 5, total: 5, headline: "A pergunta não é se elas estão envelhecendo.\nÉ quão rápido.", layout: "hero", micro: "Painel Longevify mede inflamação, tireoide, metabolismo · link na bio" },
    ],
    "2026-05-21-008-ferritina-ferro-escondido": [
      { n: 1, total: 5, headline: "Ferro normal.\nFerritina baixa.", layout: "hero", micro: "O cansaço que o laudo não explica." },
      { n: 2, total: 5, kicker: "DOIS NÚMEROS · HISTÓRIAS DIFERENTES", headline: "Ferro sérico mede o que circula. Ferritina mede o que está guardado.", micro: "O check-up padrão olha o primeiro. Ignora o segundo — onde a deficiência começa." },
      {
        n: 3, total: 5, kicker: "FAIXA FUNCIONAL · FERRITINA",
        layout: "faixa-funcional", headline: "",
        faixa: {
          biomarker: "Ferritina sérica",
          subBiomarker: "estoque de ferro · ng/mL",
          left: { label: "Faixa laboratório", number: "15–150", unit: "ng/mL", sub: "referência populacional ampla" },
          right: { label: "Faixa funcional", number: "> 50", unit: "ng/mL (>70 atleta)", sub: "Longevify · padrão preventivo" },
          footerLines: [
            "Ferritina 32 aparece como 'normal' no laudo.",
            "Para o corpo que treina, é reserva no vermelho.",
          ],
        },
      },
      { n: 4, total: 5, kicker: "O CORPO AVISA ANTES DO LAUDO", headline: "Cansaço que o sono não resolve. Queda de cabelo. Frio nas extremidades. Falta de ar no treino leve.", micro: "Quatro sinais. Um número que os explica." },
      { n: 5, total: 5, headline: "Ferritina é um dos 100+.", layout: "hero", micro: "Painel Longevify mede o que o exame de rotina não pede · link na bio" },
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
