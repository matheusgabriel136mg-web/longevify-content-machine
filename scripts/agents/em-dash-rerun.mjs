// Re-run avoid-slop-scan on all 21 captioned drafts with new em-dash check.
// Reports which drafts would fail and the action distribution.

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { scanAvoidSlop } from "./avoid-slop-scan.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");
const RUNS = path.join(ROOT, "runs");

function extractCaption(dp) {
  const m = dp.match(/#{2,3} Caption[^\n]*\n([\s\S]*?)(?=\n#{1,3} |$)/);
  return m ? m[1].trim() : null;
}

const rows = [];
for (const dir of fs.readdirSync(RUNS).sort()) {
  if (dir.startsWith("_")) continue;
  const dp = path.join(RUNS, dir, "draft-package.md");
  if (!fs.existsSync(dp)) continue;
  const caption = extractCaption(fs.readFileSync(dp, "utf-8"));
  if (!caption) continue;
  const result = scanAvoidSlop(caption);
  const emDashViolation = result.violations.find(v => v.type === "em-dash-overuse");
  rows.push({ id: dir, action: result.action, em_count: emDashViolation?.count ?? 0, em_severity: emDashViolation?.severity ?? null, grave: result.grave_count, medio: result.medio_count });
}

console.log("\nRe-scan with em-dash check enabled:\n");
console.log("action    em em-sev  grave medio  id");
for (const r of rows) {
  const marker = r.action === "reject" ? "❌" : r.action === "deduct" ? "⚠️ " : "✓ ";
  console.log(`${marker} ${r.action.padEnd(7)} ${String(r.em_count).padStart(2)}  ${(r.em_severity || "-").padEnd(6)} ${String(r.grave).padStart(3)}   ${String(r.medio).padStart(3)}    ${r.id}`);
}

const byAction = rows.reduce((acc, r) => { acc[r.action] = (acc[r.action] || 0) + 1; return acc; }, {});
console.log("\nAction distribution:", byAction);

const byEmSev = rows.reduce((acc, r) => { const k = r.em_severity || "pass"; acc[k] = (acc[k] || 0) + 1; return acc; }, {});
console.log("Em-dash verdict distribution:", byEmSev);
