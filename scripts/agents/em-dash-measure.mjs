// One-shot: measure em-dash density in all draft-package.md captions.
// Output: per-draft counts + distribution (mean/median/p90/max).

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");
const RUNS = path.join(ROOT, "runs");

function extractCaption(dp) {
  const m = dp.match(/#{2,3} Caption[^\n]*\n([\s\S]*?)(?=\n#{1,3} |$)/);
  return m ? m[1].trim() : null;
}

function countDashes(text) {
  const em = (text.match(/—/g) || []).length;            // U+2014
  const en = (text.match(/–/g) || []).length;            // U+2013
  const ascii = (text.match(/(^|\s)-(\s)/g) || []).length; // " - " (and start-of-string variant)
  return { em, en, ascii, total: em + en + ascii };
}

const rows = [];
for (const dir of fs.readdirSync(RUNS).sort()) {
  if (dir.startsWith("_")) continue;
  const dp = path.join(RUNS, dir, "draft-package.md");
  if (!fs.existsSync(dp)) continue;
  const text = fs.readFileSync(dp, "utf-8");
  const caption = extractCaption(text);
  if (!caption) {
    rows.push({ id: dir, error: "no Caption section" });
    continue;
  }
  const c = countDashes(caption);
  rows.push({ id: dir, caption_chars: caption.length, ...c });
}

console.log("\nPer-draft em-dash counts (Caption section):\n");
console.log("em  en  ascii  tot  chars  id");
for (const r of rows) {
  if (r.error) { console.log(`-   -   -      -    -      ${r.id}  (${r.error})`); continue; }
  console.log(`${String(r.em).padStart(2)}  ${String(r.en).padStart(2)}  ${String(r.ascii).padStart(2).padStart(5)}  ${String(r.total).padStart(2).padStart(3)}  ${String(r.caption_chars).padStart(5)}  ${r.id}`);
}

const totals = rows.filter(r => !r.error).map(r => r.total);
const ems = rows.filter(r => !r.error).map(r => r.em);
function stats(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const sum = arr.reduce((a, b) => a + b, 0);
  return {
    n: arr.length,
    mean: sum / arr.length,
    median: sorted[Math.floor(arr.length / 2)],
    p90: sorted[Math.floor(arr.length * 0.9)],
    max: sorted[sorted.length - 1],
    min: sorted[0],
  };
}

console.log("\nDistribution (em + en + ascii):", stats(totals));
console.log("Distribution (em-dash only — U+2014):", stats(ems));

// Histogram of total dashes
console.log("\nHistogram (total dashes per caption):");
const hist = {};
for (const t of totals) hist[t] = (hist[t] || 0) + 1;
for (const k of Object.keys(hist).sort((a, b) => Number(a) - Number(b))) {
  console.log(`  ${String(k).padStart(2)}: ${"#".repeat(hist[k])} (${hist[k]})`);
}
