// scripts/agents/formatTelegram.test.mjs — unit tests for Telegram formatter.
// Run: node scripts/agents/formatTelegram.test.mjs

import assert from "node:assert/strict";
import {
  formatStatusBadge,
  formatStatusEmoji,
  escapeTelegramMarkdown,
  humanizeRunId,
  formatRelativeDate,
  formatRun,
  formatPipelineState,
  formatUpcomingRuns,
  formatEditorDecisions,
  formatInsightsTop,
  formatCriticalFlags,
  composeStatus,
  composeDailyBriefTelegram,
  composePrepublishAlert,
} from "./formatTelegram.mjs";

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); fail++; }
}

console.log("\nformatTelegram.mjs tests\n");

t("formatStatusBadge known states", () => {
  assert.equal(formatStatusBadge("blocked"), "🔒 aguarda");
  assert.equal(formatStatusBadge("published"), "✅ no ar");
});

t("formatStatusBadge unknown falls back", () => {
  assert.equal(formatStatusBadge("weird"), "❓ weird");
});

t("formatStatusEmoji", () => {
  assert.equal(formatStatusEmoji("approving"), "⏳");
  assert.equal(formatStatusEmoji("xxx"), "❓");
});

t("escapeTelegramMarkdown escapes _ * ` [", () => {
  assert.equal(escapeTelegramMarkdown("a_b*c`d[e"), "a\\_b\\*c\\`d\\[e");
});

t("escapeTelegramMarkdown null/undefined", () => {
  assert.equal(escapeTelegramMarkdown(null), "");
  assert.equal(escapeTelegramMarkdown(undefined), "");
});

t("humanizeRunId strips date prefix + capitalizes", () => {
  assert.equal(humanizeRunId("2026-05-26-001-julia-persona"), "Julia persona");
  assert.equal(humanizeRunId("2026-05-24-001-manifesto-jockey"), "Manifesto jockey");
});

t("humanizeRunId handles missing prefix", () => {
  assert.equal(humanizeRunId("ferritina"), "Ferritina");
  assert.equal(humanizeRunId("vit-d-brasil-dado"), "Vit d brasil dado");
});

t("humanizeRunId handles null", () => {
  assert.equal(humanizeRunId(null), "(sem id)");
  assert.equal(humanizeRunId(""), "(sem id)");
});

t("formatRelativeDate null → backlog", () => {
  assert.equal(formatRelativeDate(null), "📌 Backlog");
  assert.equal(formatRelativeDate("null"), "📌 Backlog");
  assert.equal(formatRelativeDate("not-a-date"), "📌 Backlog");
});

t("formatRelativeDate ISO date → 'Seg DD/MM HHh'", () => {
  // 2026-05-25 = Monday (Seg)
  const out = formatRelativeDate("2026-05-25T10:00:00-03:00");
  assert.match(out, /Seg 25\/05/);
  assert.match(out, /h$/);
});

t("formatRun composes line", () => {
  const r = { run_id: "2026-05-26-001-julia-persona", scheduled_for: "2026-05-26T19:00:00-03:00", pillar: 4, state: "approving" };
  const out = formatRun(r);
  assert.match(out, /Julia persona/);
  assert.match(out, /\(P4\)/);
  assert.match(out, /⏳/);
});

t("formatRun null slot becomes backlog", () => {
  const r = { run_id: "x-y", scheduled_for: null, pillar: 6, state: "blocked" };
  const out = formatRun(r);
  assert.match(out, /📌 Backlog/);
  assert.match(out, /🔒/);
});

t("formatPipelineState marks gargalo on biggest non-published", () => {
  const counts = [
    { state: "blocked", n: 14 },
    { state: "draft", n: 4 },
    { state: "published", n: 3 },
    { state: "idea", n: 1 },
  ];
  const out = formatPipelineState(counts);
  assert.match(out, /🔒 aguarda: 14    ← gargalo/);
  assert.match(out, /✅ no ar: 3/);
  assert.ok(!out.includes("✅ no ar: 3    ← gargalo"));
});

t("formatPipelineState empty", () => {
  assert.equal(formatPipelineState([]), "_(sem runs ainda)_");
});

t("formatUpcomingRuns honors max", () => {
  const runs = Array.from({ length: 10 }, (_, i) => ({
    run_id: `r-${i}`, scheduled_for: null, pillar: 1, state: "approving",
  }));
  const out = formatUpcomingRuns(runs, 3);
  assert.equal(out.split("\n").length, 3);
  assert.match(out, /^1\./);
  assert.match(out, /\n3\./);
});

t("formatUpcomingRuns empty", () => {
  assert.match(formatUpcomingRuns([], 5), /queue vazia/);
});

t("formatEditorDecisions 0 → escalation", () => {
  const out = formatEditorDecisions([], 16);
  assert.match(out, /Editor 0 decisões em 16h/);
  assert.match(out, /Labeling pendente/);
});

t("formatEditorDecisions aggregates by decision type", () => {
  const decisions = [
    { decision: { decision: "PASS" } },
    { decision: { decision: "PASS" } },
    { decision: { decision: "REVISE" } },
  ];
  const out = formatEditorDecisions(decisions);
  assert.match(out, /3 decisões/);
  assert.match(out, /PASS: 2/);
  assert.match(out, /REVISE: 1/);
});

t("formatInsightsTop", () => {
  const insights = {
    n: 5,
    ranked: [
      { run_id: "2026-05-10-001-ferritina", reach: 140, share_rate: 0.042, vs_median: 1.00, pillar: 2 },
      { run_id: "abc", reach: 50, share_rate: 0.01, vs_median: 0.4, pillar: 1 },
    ],
  };
  const out = formatInsightsTop(insights, 2);
  assert.match(out, /Ferritina \(P2\)/);
  assert.match(out, /140 reach/);
  assert.match(out, /4\.2% share/);
  assert.match(out, /vs\.med 1\.00/);
});

t("formatInsightsTop empty", () => {
  assert.match(formatInsightsTop(null), /sem insights/);
  assert.match(formatInsightsTop({ ranked: [], n: 0 }), /sem insights/);
});

t("formatCriticalFlags none → null (caller skips section)", () => {
  assert.equal(formatCriticalFlags([]), null);
  assert.equal(formatCriticalFlags(null), null);
});

t("formatCriticalFlags caps at 3", () => {
  const flags = Array.from({ length: 5 }, (_, i) => ({ date: `2026-05-2${i}`, path: "x" }));
  const out = formatCriticalFlags(flags);
  assert.equal(out.split("\n").length, 3);
});

t("composeStatus end-to-end (founder example structure)", () => {
  const counts = [
    { state: "blocked", n: 14 },
    { state: "approving", n: 7 },
    { state: "draft", n: 4 },
    { state: "published", n: 3 },
    { state: "idea", n: 1 },
  ];
  const upcoming = [
    { run_id: "2026-05-26-001-julia-persona", scheduled_for: "2026-05-25T10:00:00-03:00", pillar: 4, state: "approving" },
    { run_id: "x-y-vit-d-brasil-dado", scheduled_for: null, pillar: 2, state: "approving" },
  ];
  const out = composeStatus({ counts, upcoming, decisions: [], hoursWindow: 16 });
  assert.match(out, /📊 \*Pipeline\*/);
  assert.match(out, /🔒 aguarda: 14    ← gargalo/);
  assert.match(out, /📅 \*Próximos 2 posts\*/);
  assert.match(out, /1\. Seg 25\/05 10h · Julia persona \(P4\) · ⏳/);
  assert.match(out, /2\. 📌 Backlog/);
  assert.match(out, /Editor 0 decisões em 16h/);
  // No raw "null" anywhere
  assert.ok(!out.includes("null"));
});

t("composeDailyBriefTelegram structure", () => {
  const out = composeDailyBriefTelegram({
    today: "2026-05-23",
    counts: [
      { state: "published", n: 3 },
      { state: "approving", n: 7 },
      { state: "draft", n: 11 },
    ],
    upcoming: [
      { run_id: "2026-05-26-001-julia-persona", scheduled_for: "2026-05-25T10:00:00-03:00", pillar: 4, state: "approving" },
    ],
    decisions: [],
    insights: null,
    circuit: { state: "CLOSED" },
    costToday: 0,
    flags: [],
    synthesis: { pattern: "x", recommendation: "Aguardar." },
  });
  assert.match(out, /📋 \*Daily Brief · 2026-05-23\*/);
  assert.match(out, /✅ 3.*⏳ 7.*✍️ 11/s);
  assert.match(out, /cost \$0\.00\/\$40 · circuit CLOSED/);
  assert.match(out, /🎯 \*Próximos 1 posts\*/);
  // Skips recommendation when "Aguardar."
  assert.ok(!out.includes("💡 Aguardar."));
});

t("composeDailyBriefTelegram includes recommendation when meaningful", () => {
  const out = composeDailyBriefTelegram({
    today: "2026-05-23", counts: [], upcoming: [], decisions: [], insights: null,
    circuit: { state: "CLOSED" }, costToday: 0, flags: [],
    synthesis: { pattern: "x", recommendation: "Aumentar mix de P4 esta semana." },
  });
  assert.match(out, /💡 Aumentar mix de P4 esta semana\./);
});

t("composePrepublishAlert", () => {
  const r = { run_id: "2026-05-26-001-julia-persona", scheduled_for: "2026-05-26T19:00:00-03:00", pillar: 4, persona: "Julia", format: "carousel" };
  const out = composePrepublishAlert(r, 15);
  assert.match(out, /🔔 \*T-15min · Julia persona\*/);
  assert.match(out, /P4 · Julia · carousel/);
  assert.match(out, /\/publish 2026-05-26-001-julia-persona/);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
