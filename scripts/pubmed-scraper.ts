/**
 * pubmed-scraper.ts — busca papers recentes em PubMed por biomarcador.
 *
 * Usa NCBI E-utilities (gratuito, sem auth). Por biomarcador roda:
 *   esearch → IDs dos papers mais relevantes/recentes
 *   esummary → metadata (título, autores, journal, ano, DOI)
 *   efetch (opt) → abstracts em texto
 *
 * Output:
 *   output/pubmed/papers.json — dados estruturados por biomarcador
 *   output/pubmed/papers.md   — relatório legível pra usar como contexto no Claude
 *
 * Uso:
 *   npm run pubmed                          # default: todos os biomarcadores, últimos 3 anos
 *   npm run pubmed -- --years=5 --max=15    # ajustes
 *   npm run pubmed -- --no-abstracts        # só metadata (mais rápido)
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const OUT_DIR = path.join(ROOT, "output", "pubmed");
fs.mkdirSync(OUT_DIR, { recursive: true });

const args = process.argv.slice(2);
const yearsBack = Number(args.find((a) => a.startsWith("--years="))?.split("=")[1] ?? 3);
const maxPerBiomarker = Number(args.find((a) => a.startsWith("--max="))?.split("=")[1] ?? 10);
const skipAbstracts = args.includes("--no-abstracts");
const REQUEST_DELAY_MS = 350; // NCBI permite 3 req/sec sem auth

const NOW = new Date();
const MIN_YEAR = NOW.getFullYear() - yearsBack;

interface Biomarker {
  name: string;
  query: string;
  slug: string;
  pillar: 1 | 2 | 3 | 4; // qual pilar Longevify usa esse biomarcador
  context: string;       // por que importa (pra usar no Claude depois)
}

const BIOMARKERS: Biomarker[] = [
  // Pilar 2 — biomarcadores cardiovasculares "escondidos"
  { name: "ApoB", query: "apolipoprotein B AND (cardiovascular risk OR atherosclerosis) AND guidelines",
    slug: "apob", pillar: 2,
    context: "ApoB é mais preditivo de risco cardiovascular que LDL-C, mas labs convencionais ainda não pedem rotineiramente." },
  { name: "Lp(a)", query: "lipoprotein(a) AND cardiovascular AND (guidelines OR consensus)",
    slug: "lpa", pillar: 2,
    context: "Lp(a) é genético e independente de LDL — descoberto recentemente como fator de risco principal." },
  { name: "hs-CRP", query: "high-sensitivity C-reactive protein AND chronic inflammation AND longevity",
    slug: "hs-crp", pillar: 2,
    context: "Inflamação crônica silenciosa — preditor de doenças degenerativas." },
  { name: "Homocysteine", query: "homocysteine AND (cognitive decline OR cardiovascular)",
    slug: "homocysteine", pillar: 2,
    context: "Marcador independente de risco cardio + cognitivo, ligado a deficiência de B12/folato." },

  // Pilar 2 — tireoide e energia
  { name: "Reverse T3", query: "reverse T3 AND thyroid AND (fatigue OR euthyroid sick syndrome)",
    slug: "reverse-t3", pillar: 2,
    context: "TSH normal não exclui disfunção tireoideana — T3 reverso revela quanto T4 vira hormônio inativo." },
  { name: "Ferritin", query: "ferritin AND (iron deficiency OR fatigue OR brain fog)",
    slug: "ferritin", pillar: 2,
    context: "Pode-se ter ferro normal mas ferritina baixa — fonte comum de cansaço crônico não diagnosticado." },

  // Pilar 1 — terroir biológico brasileiro
  { name: "Vitamina D Brazil", query: "vitamin D deficiency AND (Brazil OR Brazilian population OR tropical)",
    slug: "vitamin-d-brazil", pillar: 1,
    context: "Brasileiro tem deficiência de vit D apesar do sol — ironia da urbanização tropical." },
  { name: "Magnesium", query: "magnesium deficiency AND (chronic disease OR sleep OR metabolic syndrome)",
    slug: "magnesium", pillar: 1,
    context: "Solo brasileiro empobrecido = deficiência de magnésio frequente, afeta sono e metabolismo." },

  // Pilar 4 — sintoma → biomarcador (vagueza → dado)
  { name: "Cortisol Diurnal", query: "cortisol diurnal rhythm AND (chronic stress OR burnout)",
    slug: "cortisol", pillar: 4,
    context: "Curva de cortisol mostra burnout invisível em exames pontuais." },
  { name: "HOMA-IR", query: "HOMA-IR AND insulin resistance AND prediabetes",
    slug: "homa-ir", pillar: 4,
    context: "Detecta resistência insulínica anos antes da glicemia em jejum dar problema." },
  { name: "HbA1c", query: "HbA1c AND prediabetes AND screening",
    slug: "hba1c", pillar: 4,
    context: "HbA1c entre 5.7-6.4% = prediabetes silenciosa — tradução clara de 'estou off'." },

  // Pilar 3 — falha do check-up
  { name: "Comprehensive Lab Panel", query: "comprehensive metabolic panel AND (preventive medicine OR early detection)",
    slug: "comprehensive-panel", pillar: 3,
    context: "Painéis básicos vs. expandidos: o que se perde no check-up convencional." },
  { name: "Women Cardiovascular", query: "women cardiovascular disease AND (sex-specific OR diagnosis disparity)",
    slug: "women-cv", pillar: 3,
    context: "Mulheres subdiagnosticadas em risco cardio — sintomas diferentes do padrão masculino." },
];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface PubmedSummary {
  pmid: string;
  title: string;
  authors: string[];
  journal: string;
  pubdate: string;
  year: number | null;
  doi: string | null;
  abstract?: string;
}

interface NCBIAuthor { name: string }
interface NCBIResultItem {
  uid: string;
  title?: string;
  authors?: NCBIAuthor[];
  fulljournalname?: string;
  pubdate?: string;
  elocationid?: string;
  articleids?: Array<{ idtype: string; value: string }>;
}

async function searchIds(b: Biomarker, max: number): Promise<string[]> {
  const params = new URLSearchParams({
    db: "pubmed",
    term: `${b.query} AND ("${MIN_YEAR}/01/01"[Date - Publication] : "${NOW.getFullYear()}/12/31"[Date - Publication])`,
    retmax: String(max),
    sort: "relevance",
    retmode: "json",
  });
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`esearch HTTP ${res.status}`);
  const data = (await res.json()) as { esearchresult: { idlist: string[] } };
  return data.esearchresult.idlist;
}

async function getSummaries(ids: string[]): Promise<PubmedSummary[]> {
  if (!ids.length) return [];
  const params = new URLSearchParams({
    db: "pubmed",
    id: ids.join(","),
    retmode: "json",
  });
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`esummary HTTP ${res.status}`);
  const data = (await res.json()) as { result: Record<string, NCBIResultItem | string[]> };

  const result: PubmedSummary[] = [];
  for (const id of ids) {
    const item = data.result[id] as NCBIResultItem | undefined;
    if (!item || !item.uid) continue;
    const yMatch = item.pubdate?.match(/\d{4}/);
    const doiEntry = item.articleids?.find((a) => a.idtype === "doi");
    result.push({
      pmid: item.uid,
      title: item.title?.replace(/\.$/, "") ?? "—",
      authors: item.authors?.map((a) => a.name) ?? [],
      journal: item.fulljournalname ?? "—",
      pubdate: item.pubdate ?? "",
      year: yMatch ? Number(yMatch[0]) : null,
      doi: doiEntry?.value ?? null,
    });
  }
  return result;
}

async function getAbstracts(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const params = new URLSearchParams({
    db: "pubmed",
    id: ids.join(","),
    rettype: "abstract",
    retmode: "text",
  });
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`efetch HTTP ${res.status}`);
  const text = await res.text();

  // Records separados por linha em branco. Cada record começa com "1. ", "2. ", etc.
  // PMID aparece no fim do record. Vamos parsear procurando "PMID: NNNNN"
  const records = text.split(/\n\n(?=\d+\.\s)/);
  const map = new Map<string, string>();
  for (const r of records) {
    const pmidM = r.match(/PMID:\s*(\d+)/);
    if (!pmidM) continue;
    // Abstract está entre o título/autores e PMID. Procuramos depois de DOI/journal e antes de PMID.
    const lines = r.split("\n");
    // Heurística: pega o parágrafo mais longo que não comece com "Author Information" / "Comment in"
    const paragraphs = r.split(/\n\s*\n/).filter((p) => p.trim().length > 80 && !/^(Author|Comment|Erratum|©)/i.test(p.trim()));
    const abstract = paragraphs.sort((a, b) => b.length - a.length)[0] ?? "";
    map.set(pmidM[1], abstract.replace(/\s+/g, " ").trim().slice(0, 1500));
  }
  return map;
}

interface BiomarkerResult {
  biomarker: string;
  slug: string;
  pillar: number;
  context: string;
  query: string;
  papers: PubmedSummary[];
}

function buildMarkdown(all: BiomarkerResult[]): string {
  const lines: string[] = [];
  lines.push(`# PubMed — papers por biomarcador`);
  lines.push("");
  lines.push(`> Gerado em ${new Date().toLocaleString("pt-BR")} · últimos ${yearsBack} anos · top ${maxPerBiomarker} por relevância`);
  lines.push("");

  const byPillar = new Map<number, BiomarkerResult[]>();
  for (const r of all) {
    if (!byPillar.has(r.pillar)) byPillar.set(r.pillar, []);
    byPillar.get(r.pillar)!.push(r);
  }

  for (const [pillar, list] of [...byPillar.entries()].sort((a, b) => a[0] - b[0])) {
    lines.push(`## Pilar ${pillar}`);
    lines.push("");
    for (const r of list) {
      lines.push(`### ${r.biomarker} (${r.papers.length} papers)`);
      lines.push("");
      lines.push(`> ${r.context}`);
      lines.push("");
      lines.push(`**Query:** \`${r.query}\``);
      lines.push("");
      for (const p of r.papers) {
        const authorsShort = p.authors.length > 3 ? `${p.authors.slice(0, 3).join(", ")} et al.` : p.authors.join(", ");
        lines.push(`- **${p.title}**`);
        lines.push(`  - ${authorsShort} · *${p.journal}* · ${p.year ?? p.pubdate}`);
        lines.push(`  - PMID: [${p.pmid}](https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/)${p.doi ? ` · DOI: ${p.doi}` : ""}`);
        if (p.abstract) {
          lines.push(`  - **Abstract:** ${p.abstract.slice(0, 600)}${p.abstract.length > 600 ? "…" : ""}`);
        }
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}

async function main() {
  console.log(`📚 PubMed scraper — ${BIOMARKERS.length} biomarcadores · últimos ${yearsBack} anos · top ${maxPerBiomarker}/cada`);
  console.log(`   Período: ${MIN_YEAR} → ${NOW.getFullYear()}`);
  console.log(`   Abstracts: ${skipAbstracts ? "não" : "sim"}`);
  console.log("");

  const all: BiomarkerResult[] = [];
  for (let i = 0; i < BIOMARKERS.length; i++) {
    const b = BIOMARKERS[i];
    process.stdout.write(`  [${i + 1}/${BIOMARKERS.length}] ${b.name} (P${b.pillar})... `);
    try {
      const ids = await searchIds(b, maxPerBiomarker);
      await sleep(REQUEST_DELAY_MS);
      const summaries = await getSummaries(ids);
      let abstracts = new Map<string, string>();
      if (!skipAbstracts && ids.length) {
        await sleep(REQUEST_DELAY_MS);
        try {
          abstracts = await getAbstracts(ids);
        } catch {
          // tolera falha de abstract
        }
      }
      for (const s of summaries) {
        const a = abstracts.get(s.pmid);
        if (a) s.abstract = a;
      }
      all.push({ biomarker: b.name, slug: b.slug, pillar: b.pillar, context: b.context, query: b.query, papers: summaries });
      process.stdout.write(`✅ ${summaries.length} papers\n`);
      await sleep(REQUEST_DELAY_MS);
    } catch (err) {
      process.stdout.write(`❌ ${(err as Error).message}\n`);
      all.push({ biomarker: b.name, slug: b.slug, pillar: b.pillar, context: b.context, query: b.query, papers: [] });
    }
  }

  const jsonPath = path.join(OUT_DIR, "papers.json");
  const mdPath = path.join(OUT_DIR, "papers.md");
  fs.writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), yearsBack, maxPerBiomarker, results: all }, null, 2));
  fs.writeFileSync(mdPath, buildMarkdown(all));

  const total = all.reduce((s, r) => s + r.papers.length, 0);
  console.log("");
  console.log(`✅ ${total} papers coletados de ${all.length} biomarcadores`);
  console.log(`   ${path.basename(jsonPath)} (${(fs.statSync(jsonPath).size / 1024).toFixed(0)}KB)`);
  console.log(`   ${path.basename(mdPath)} (${(fs.statSync(mdPath).size / 1024).toFixed(0)}KB)`);
}

main().catch((err) => {
  console.error("\n❌", err.message);
  process.exit(1);
});
