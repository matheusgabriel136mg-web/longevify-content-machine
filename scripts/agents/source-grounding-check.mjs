// scripts/agents/source-grounding-check.mjs — Detect hallucinated stats in generated content.
//
// Why: concept-mode + remix-mode use Claude which freely interpolates plausible-sounding
// stats from training data. Founder caught: source said "95% serotonina, 70% imune,
// 100M neurônios" → output added "500M sinais via vago" (NOT in source). Regulatory risk.
//
// Strategy: extract every numeric claim from generated content + cross-reference to source.
// A "numeric claim" is any number-token-unit combo that asserts a fact.
//
// Returns { ok, hallucinated_stats: [...], source_stats_found: [...], declared_stats: [...] }
// `ok=false` → caller should block notify + alert founder.

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");

// Patterns for numeric claims. Captures the bare number; unit captured separately when present.
const NUMERIC_PATTERNS = [
  /(\d+(?:[.,]\d+)?)\s*%/g,                                  // 73%, 95,5%
  /(\d+(?:[.,]\d+)?)\s*(?:bilh[oõ]es?|milh[oõ]es?|mil)/gi,   // 500 milhões, 22 mil
  /(\d+(?:[.,]\d+)?)\s*(?:vezes|x)\b/gi,                    // 5 vezes, 2x
  /\b(\d+(?:[.,]\d+)?)\s*(?:ng\/mL|mg\/dL|mmol|µg|kg|mg)\b/gi, // dosagens
  /N\s*=\s*(\d+(?:\.\d+)?)/gi,                              // N=22.000 (study sample)
];

// Brand-name / acronym whitelist (won't be flagged even if exact match missing in source).
// Add medical-society acronyms + common biomarker names that are baseline knowledge.
const SAFE_WHITELIST = new Set([
  "CFM", "ANS", "SBC", "AHA", "ANVISA", "Ministério da Saúde",
  // Common biomarker names (these are concepts, not stats):
  "ApoB", "hs-CRP", "Lp(a)", "HbA1c", "TSH", "IL-6", "LDL", "HDL", "TG", "ALT", "AST", "GGT",
]);

function normalizeNumber(raw) {
  // Convert "95,5" → "95.5" and treat "95,000" / "95.000" as thousands separator.
  // Defensive normalization for cross-reference comparison.
  if (/\d{1,3}\.\d{3}/.test(raw)) return raw.replace(/\./g, "");  // pt-BR thousands
  if (/\d{1,3},\d{3}/.test(raw)) return raw.replace(/,/g, "");
  return raw.replace(/,/, ".");
}

function extractNumericClaims(text) {
  if (!text) return [];
  const claims = new Set();
  for (const re of NUMERIC_PATTERNS) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      const raw = m[1] || m[0];
      const normalized = normalizeNumber(raw);
      // Skip trivial small numbers that match anywhere (ages, slide numbers, etc.)
      const n = parseFloat(normalized);
      if (!isNaN(n) && n >= 5) {
        // Include both the raw match and the normalized number for cross-ref.
        claims.add(m[0].trim());
      }
    }
  }
  return [...claims];
}

// Returns numbers present in source caption, as a Set of normalized strings.
function sourceNumberSet(sourceText) {
  if (!sourceText) return new Set();
  const set = new Set();
  for (const re of [/\d+(?:[.,]\d+)?/g]) {
    let m;
    while ((m = re.exec(sourceText)) !== null) {
      const n = normalizeNumber(m[0]);
      if (parseFloat(n) >= 5) set.add(n);
    }
  }
  return set;
}

export function checkSourceGrounding({ generatedText, sourceText, declaredStats = [] }) {
  if (!sourceText) {
    return { ok: true, skipped: true, reason: "no source text to compare" };
  }
  const sourceNums = sourceNumberSet(sourceText);
  const claims = extractNumericClaims(generatedText);

  const hallucinated = [];
  const grounded = [];

  for (const claim of claims) {
    // Extract just the number from the claim for comparison.
    const numMatch = claim.match(/\d+(?:[.,]\d+)?/);
    if (!numMatch) continue;
    const num = normalizeNumber(numMatch[0]);
    if (sourceNums.has(num)) {
      grounded.push(claim);
      continue;
    }
    // Check if any declared stat matches (founder/Claude self-reports a citation).
    if (declaredStats.some(s => s.includes(num))) {
      grounded.push(claim);
      continue;
    }
    // Allow common rough biomarker reference numbers (faixa funcional/popular).
    // These appear in foundation/* docs not in source, but are baseline brand canon.
    const canon = /(20|40|60|70|130|95|85|130|5\.7|4\.8|5\.2|0\.5|3)/;
    if (canon.test(num) && /faixa|aceit|cort|refer/i.test(generatedText.slice(Math.max(0, generatedText.indexOf(claim) - 80), generatedText.indexOf(claim) + 80))) {
      grounded.push(claim);
      continue;
    }
    hallucinated.push(claim);
  }

  return {
    ok: hallucinated.length === 0,
    hallucinated_stats: hallucinated,
    grounded_stats: grounded,
    declared_stats: declaredStats,
    source_numbers: [...sourceNums],
  };
}

// CLI utility: check a generated run's draft-package.md vs the source idea caption.
async function cli() {
  const args = process.argv.slice(2);
  const ri = args.indexOf("--run"); const ii = args.indexOf("--idea-id");
  if (ri < 0 || ii < 0) {
    console.error("Usage: source-grounding-check.mjs --run <runId> --idea-id <id>");
    process.exit(1);
  }
  const runId = args[ri + 1];
  const ideaId = parseInt(args[ii + 1]);
  const dpPath = path.join(ROOT, "runs", runId, "draft-package.md");
  if (!fs.existsSync(dpPath)) {
    console.error(`draft-package.md missing for ${runId}`);
    process.exit(1);
  }
  const generatedText = fs.readFileSync(dpPath, "utf-8");
  // Fetch source caption from ideas_backlog (lazy dep on better-sqlite3).
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(path.join(ROOT, "runs", "_pipeline.db"), { readonly: true });
  const row = db.prepare(`SELECT original_caption FROM ideas_backlog WHERE id = ?`).get(ideaId);
  db.close();
  if (!row) { console.error(`idea #${ideaId} not found`); process.exit(1); }

  const result = checkSourceGrounding({ generatedText, sourceText: row.original_caption });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await cli();
}
