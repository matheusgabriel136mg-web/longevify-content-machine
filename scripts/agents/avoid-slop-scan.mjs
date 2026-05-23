// scripts/agents/avoid-slop-scan.mjs — Deterministic avoid-slop scanner
//
// Princípio Tan #4: filtra o ÓBVIO antes de LLM ser invocado.
// Input: draft text (string)
// Output: { violations: [...], score_deduction: float, action: "reject" | "deduct" | "ok" }
//
// CLI: node scripts/agents/avoid-slop-scan.mjs --text "draft text..."
//      node scripts/agents/avoid-slop-scan.mjs --file path/to/draft.md
//      node scripts/agents/avoid-slop-scan.mjs --run <run-id>  (reads draft-package.md Caption section)

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import YAML from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");
const RULES_PATH = path.join(ROOT, "foundation", "compliance", "avoid-slop.yaml");

const rules = YAML.parse(fs.readFileSync(RULES_PATH, "utf-8"));

export function scanAvoidSlop(text) {
  const violations = [];
  const lower = text.toLowerCase();

  // 1. banned phrases (substring)
  for (const p of rules.banned_phrases ?? []) {
    if (lower.includes(p.phrase.toLowerCase())) {
      violations.push({
        type: "phrase",
        phrase: p.phrase,
        severity: p.severity,
        category: p.category,
      });
    }
  }

  // 2. banned tokens (isolated word)
  for (const t of rules.banned_tokens ?? []) {
    const re = new RegExp(`\\b${escapeRegex(t.token.toLowerCase())}\\b`, "g");
    const matches = lower.match(re);
    if (matches?.length) {
      violations.push({
        type: "token",
        token: t.token,
        count: matches.length,
        severity: t.severity,
        category: t.category,
        note: t.note,
      });
    }
  }

  // 3. banned regex
  for (const r of rules.banned_regex ?? []) {
    try {
      const re = new RegExp(r.pattern, "g");
      const matches = text.match(re);
      if (matches?.length) {
        violations.push({
          type: "regex",
          pattern: r.pattern,
          count: matches.length,
          severity: r.severity,
          category: r.category,
          description: r.description,
        });
      }
    } catch (e) {
      console.warn(`  ⚠ invalid regex skipped: ${r.pattern}`);
    }
  }

  // 4. emoji policy
  const allowedEmojiSet = new Set(rules.emoji_policy?.allowed ?? []);
  const bannedEmojiSet = new Set(rules.emoji_policy?.banned ?? []);
  const emojiRegex = /\p{Extended_Pictographic}/gu;
  const allEmojis = text.match(emojiRegex) ?? [];

  for (const e of allEmojis) {
    if (bannedEmojiSet.has(e)) {
      violations.push({
        type: "emoji",
        emoji: e,
        severity: rules.emoji_policy.rules?.severity_if_banned ?? "grave",
        category: "banned-emoji",
      });
    }
  }
  const nonAllowedCount = allEmojis.filter(e => !allowedEmojiSet.has(e)).length;
  const maxPerPost = rules.emoji_policy?.rules?.max_per_post ?? 1;
  if (allEmojis.length > maxPerPost) {
    violations.push({
      type: "emoji-overuse",
      count: allEmojis.length,
      max: maxPerPost,
      severity: rules.emoji_policy.rules?.severity_if_over_max ?? "medio",
      category: "emoji-policy",
    });
  }

  // 5a. em-dash overuse (Padrão #1 capturado 2026-05-23: AI tell em quase todos drafts)
  // Counts U+2014 em-dash + U+2013 en-dash + " - " ASCII used-as-travessão.
  // Thresholds (calibrated from 21-draft sample, distribution mean 1.6 / median 2 / p90 3 / max 4):
  //   ≤1: pass · 2-3: medio (REVISE) · 4+: grave (REJECT auto)
  // See decisoes/2026-05-23-editor-calibration.md
  {
    const em = (text.match(/—/g) || []).length;
    const en = (text.match(/–/g) || []).length;
    const ascii = (text.match(/(^|\s)-(\s)/g) || []).length;
    const total = em + en + ascii;
    const REGEN_HINT = "Reduza travessões pra ≤1 por caption. Substitua por: (1) ponto final + frase nova; (2) dois pontos quando o que vem depois é definição ou expansão; (3) vírgula quando é aposição curta; (4) reescreva a frase pra eliminar a necessidade.";
    if (total >= 4) {
      violations.push({
        type: "em-dash-overuse",
        count: total,
        breakdown: { em, en, ascii },
        severity: "grave",
        category: "ai-tell",
        description: `Em-dash overuse (${total}) is a strong AI-writing tell. ${REGEN_HINT}`,
        regen_hint: REGEN_HINT,
      });
    } else if (total >= 2) {
      violations.push({
        type: "em-dash-overuse",
        count: total,
        breakdown: { em, en, ascii },
        severity: "medio",
        category: "ai-tell",
        description: `Em-dash overuse (${total}). ${REGEN_HINT}`,
        regen_hint: REGEN_HINT,
      });
    }
  }

  // 5. forbidden tom patterns
  for (const f of rules.forbidden_tom_patterns ?? []) {
    try {
      const re = new RegExp(f.pattern, "gi");
      const matches = text.match(re);
      if (matches?.length) {
        violations.push({
          type: "tom-pattern",
          pattern: f.pattern,
          matches: matches.slice(0, 3),
          severity: f.severity,
          category: f.category,
          description: f.description,
          requires_llm_check: f.requires_llm_check ?? false,
        });
      }
    } catch (e) {
      console.warn(`  ⚠ invalid tom regex skipped: ${f.pattern}`);
    }
  }

  // Compute deduction + action
  const graveCount = violations.filter(v => v.severity === "grave" && !v.requires_llm_check).length;
  const medioCount = violations.filter(v => v.severity === "medio").length;
  const leveCount = violations.filter(v => v.severity === "leve").length;

  const medioDeduction = Math.min(medioCount * rules.scoring.medio_violation_deduction, rules.scoring.max_deduction_medio);
  const leveDeduction = Math.min(leveCount * rules.scoring.leve_violation_deduction, rules.scoring.max_deduction_leve);
  const totalDeduction = medioDeduction + leveDeduction;

  let action = "ok";
  if (graveCount > 0) action = "reject";
  else if (totalDeduction > 0) action = "deduct";

  return {
    violations,
    grave_count: graveCount,
    medio_count: medioCount,
    leve_count: leveCount,
    score_deduction: totalDeduction,
    action,
  };
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    const dp = fs.readFileSync(dpPath, "utf-8");
    const m = dp.match(/### Caption[^\n]*\n([\s\S]*?)(?=\n###|\n##|\n# )/);
    text = m ? m[1].trim() : dp;
  } else {
    console.error("Usage: avoid-slop-scan.mjs --text <s> | --file <path> | --run <run-id>");
    process.exit(1);
  }

  const result = scanAvoidSlop(text);

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`\n🔍 Avoid-Slop Scan · action=${result.action.toUpperCase()}\n`);
    console.log(`  grave: ${result.grave_count} · medio: ${result.medio_count} · leve: ${result.leve_count}`);
    console.log(`  score deduction: -${result.score_deduction.toFixed(1)}\n`);
    if (result.violations.length) {
      console.log(`  Violations:`);
      for (const v of result.violations) {
        const tag = v.severity === "grave" ? "❌" : v.severity === "medio" ? "⚠️ " : "·";
        const desc = v.phrase || v.token || v.pattern || v.emoji || v.description;
        console.log(`    ${tag} [${v.severity}] [${v.category}] ${desc}${v.count ? ` (×${v.count})` : ""}`);
      }
    }
  }

  process.exit(result.action === "reject" ? 1 : 0);
}
