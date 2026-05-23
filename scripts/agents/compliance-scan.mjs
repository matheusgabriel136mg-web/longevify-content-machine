// scripts/agents/compliance-scan.mjs — Deterministic CFM/Procon compliance scanner
//
// Princípio Tan #4: zero-tolerance words = reject sem LLM. Ambíguos = LLM second-pass.
// Princípio Brand CC circuit-breaker: hit em compliance = OPEN circuit (NÃO auto-publica)
//
// CLI: node scripts/agents/compliance-scan.mjs --text "..."
//      node scripts/agents/compliance-scan.mjs --file path
//      node scripts/agents/compliance-scan.mjs --run <run-id>

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import YAML from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");
const RULES_PATH = path.join(ROOT, "foundation", "compliance", "cfm-blocklist.yaml");

const rules = YAML.parse(fs.readFileSync(RULES_PATH, "utf-8"));

export function scanCompliance(text) {
  const violations = [];
  const flags = [];
  const lower = text.toLowerCase();

  // ─── 1. ZERO TOLERANCE words ──────────────────────────────────────────────
  for (const z of rules.zero_tolerance ?? []) {
    const re = new RegExp(`\\b${escapeRegex(z.word.toLowerCase())}\\b`, "g");
    const matches = lower.match(re);
    if (!matches?.length) continue;

    // Check permitted context exceptions
    let inException = false;
    for (const ex of z.permitted_context_exceptions ?? []) {
      if (lower.includes(ex.toLowerCase())) {
        // Conservative: if exception phrase found AND word count == ex occurrences, OK
        // For now: flag as ambiguous (LLM check)
        inException = true;
        break;
      }
    }

    violations.push({
      type: "zero-tolerance",
      word: z.word,
      count: matches.length,
      severity: z.severity,
      category: z.category,
      rationale: z.rationale,
      in_exception_context: inException,
      action: inException ? "llm_check" : "reject",
    });
  }

  // ─── 2. AMBIGUOUS patterns ────────────────────────────────────────────────
  for (const a of rules.ambiguous_patterns ?? []) {
    try {
      const re = new RegExp(a.pattern, "gi");
      const matches = text.match(re);
      if (matches?.length) {
        violations.push({
          type: "ambiguous-pattern",
          pattern: a.pattern,
          matches: matches.slice(0, 3),
          severity: a.severity,
          category: a.category,
          description: a.description,
          requires_llm_check: a.requires_llm_check ?? false,
          action: a.requires_llm_check ? "llm_check" : (a.severity === "grave" ? "reject" : "deduct"),
        });
      }
    } catch (e) {
      console.warn(`  ⚠ invalid pattern: ${a.pattern}`);
    }
  }

  // ─── 3. DISCLAIMER check ──────────────────────────────────────────────────
  for (const d of rules.disclaimer_required ?? []) {
    // Heuristic: if context matches, look for disclaimer text
    if (d.context.includes("biomarcador") && hasBiomarkerValue(text)) {
      const hasDisclaimer = text.toLowerCase().includes("interpretação clínica") ||
                            text.toLowerCase().includes("requer profissional habilitado");
      if (!hasDisclaimer) {
        flags.push({
          type: "missing-disclaimer",
          context: d.context,
          recommended: d.disclaimer,
          severity_if_missing: d.severity_if_missing,
        });
      }
    }
    if (d.context.includes("persona-bio")) {
      const looksPersonaBio = /conhe[çc]a a |persona|case study/i.test(text);
      if (looksPersonaBio) {
        const hasDisclaimer = /caso ilustrativo|resultados.*variam/i.test(text);
        if (!hasDisclaimer) {
          flags.push({
            type: "missing-disclaimer",
            context: d.context,
            recommended: d.disclaimer,
            severity_if_missing: d.severity_if_missing,
          });
        }
      }
    }
  }

  // ─── 4. ESCALATION decision ────────────────────────────────────────────────
  const zeroToleranceRejectCount = violations.filter(v => v.type === "zero-tolerance" && v.action === "reject").length;
  const ambiguousGraveCount = violations.filter(v => v.type === "ambiguous-pattern" && v.severity === "grave").length;

  let action = "ok";
  let escalation = null;

  if (zeroToleranceRejectCount > 0) {
    action = "reject";
    escalation = "cfm_risk_detected";
  } else if (ambiguousGraveCount >= 2) {
    action = "escalate";
    escalation = "cfm_risk_detected";
  } else if (ambiguousGraveCount === 1 || violations.some(v => v.action === "llm_check")) {
    action = "llm_check";
  } else if (violations.length > 0 || flags.length > 0) {
    action = "deduct";
  }

  return {
    violations,
    flags,
    zero_tolerance_count: zeroToleranceRejectCount,
    ambiguous_count: violations.filter(v => v.type === "ambiguous-pattern").length,
    missing_disclaimers: flags.length,
    action,
    escalation,
  };
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasBiomarkerValue(text) {
  // Heuristic: biomarker name + número com unidade
  return /(vitamina d|hs-?crp|ferritina|apob|hba1c|cortisol|hrv|vo2max|tsh|t3|t4)\b.{0,30}\d+(\.\d+)?\s*(ng\/m[lL]|mg\/d?[lL]|mg\/L|ml\/min|%)/i.test(text);
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs() {
  const a = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--text") out.text = a[++i];
    else if (a[i] === "--file") out.file = a[++i];
    else if (a[i] === "--run") out.run = a[++i];
    else if (a[i] === "--json") out.json = true;
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs();
  let text;
  if (args.text) text = args.text;
  else if (args.file) text = fs.readFileSync(args.file, "utf-8");
  else if (args.run) {
    const dpPath = path.join(ROOT, "runs", args.run, "draft-package.md");
    text = fs.readFileSync(dpPath, "utf-8");
  } else {
    console.error("Usage: compliance-scan.mjs --text <s> | --file <path> | --run <run-id>");
    process.exit(1);
  }

  const result = scanCompliance(text);

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`\n⚖️  Compliance Scan · action=${result.action.toUpperCase()}\n`);
    if (result.escalation) console.log(`  🚨 ESCALATION: ${result.escalation}`);
    console.log(`  zero-tolerance: ${result.zero_tolerance_count} · ambiguous: ${result.ambiguous_count} · missing disclaimers: ${result.missing_disclaimers}\n`);

    if (result.violations.length) {
      console.log(`  Violations:`);
      for (const v of result.violations) {
        const tag = v.action === "reject" ? "❌" : v.action === "llm_check" ? "⚠️ " : "·";
        console.log(`    ${tag} [${v.severity}] [${v.category}] ${v.word || v.description}`);
        if (v.rationale) console.log(`         ${v.rationale}`);
      }
    }
    if (result.flags.length) {
      console.log(`  Flags:`);
      for (const f of result.flags) {
        console.log(`    🏳️  [${f.severity_if_missing}] missing disclaimer: ${f.recommended}`);
      }
    }
  }

  process.exit(result.action === "reject" || result.action === "escalate" ? 1 : 0);
}
