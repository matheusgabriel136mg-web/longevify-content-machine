// scripts/agents/formatTelegram.mjs — single source of truth for Telegram output.
//
// Mobile-first: iPhone width ~38 chars. No markdown tables (Telegram doesn't
// render columns in mobile). Vertical bullets. Emoji status badges.
//
// All bot commands + alerts + daily-brief route through this.
// No DB access — pure formatting. Callers gather data, pass it in.

const STATUS_LABEL = {
  blocked:    "🔒 aguarda",
  approving:  "⏳ aprovar",
  draft:      "✍️ rascunho",
  idea:       "💡 ideia",
  published:  "✅ no ar",
  publishing: "📤 publicando",
  editing:    "📝 editando",
  failed:     "❌ falhou",
};

const STATUS_EMOJI = {
  blocked:    "🔒",
  approving:  "⏳",
  draft:      "✍️",
  idea:       "💡",
  published:  "✅",
  publishing: "📤",
  editing:    "📝",
  failed:     "❌",
};

const DOW_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function formatStatusBadge(state) {
  return STATUS_LABEL[state] || `❓ ${state}`;
}

export function formatStatusEmoji(state) {
  return STATUS_EMOJI[state] || "❓";
}

// Telegram 'Markdown' (legacy) parse_mode escapes
export function escapeTelegramMarkdown(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/([_*`\[])/g, "\\$1");
}

// "2026-05-26-001-julia-persona" → "Julia persona"
// "ferritina" → "Ferritina"
// null/undefined → "(sem id)"
export function humanizeRunId(runId) {
  if (!runId) return "(sem id)";
  const stripped = String(runId).replace(/^\d{4}-\d{2}-\d{2}-\d{3}-/, "");
  const words = stripped.replace(/-/g, " ").trim();
  if (!words) return "(sem id)";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// "2026-05-26T19:00-03:00" → "Qua 26/05 19h"
// null/invalid → "📌 Backlog"
export function formatRelativeDate(iso) {
  if (!iso || iso === "null") return "📌 Backlog";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "📌 Backlog";
  const dow = DOW_PT[d.getDay()];
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = d.getHours();
  return `${dow} ${dd}/${mm} ${hh}h`;
}

// Single run as "Seg 24/05 10h · Julia persona (P4) · ⏳"
export function formatRun(r) {
  const date = formatRelativeDate(r.scheduled_for);
  const title = humanizeRunId(r.run_id);
  const pillar = r.pillar ? ` (P${r.pillar})` : "";
  const badge = formatStatusEmoji(r.state);
  return `${date} · ${title}${pillar} · ${badge}`;
}

// counts: [{state, n}, ...] → mobile bullets, marks biggest non-published bucket as gargalo
export function formatPipelineState(counts) {
  if (!counts?.length) return "_(sem runs ainda)_";
  const byState = Object.fromEntries(counts.map(c => [c.state, c.n]));
  const nonPub = counts.filter(c => c.state !== "published" && c.n > 0).sort((a, b) => b.n - a.n);
  const gargaloState = nonPub.length ? nonPub[0].state : null;
  const ORDER = ["published", "approving", "draft", "blocked", "idea", "editing", "publishing", "failed"];
  const lines = [];
  for (const s of ORDER) {
    if (byState[s] === undefined) continue;
    const marker = s === gargaloState ? "    ← gargalo" : "";
    lines.push(`${formatStatusBadge(s)}: ${byState[s]}${marker}`);
  }
  for (const c of counts) {
    if (!ORDER.includes(c.state)) lines.push(`${formatStatusBadge(c.state)}: ${c.n}`);
  }
  return lines.join("\n");
}

// Upcoming as numbered list. Honors actual count in header.
export function formatUpcomingRuns(upcoming, max = 5) {
  if (!upcoming?.length) return "_(queue vazia — rode idea-picker)_";
  return upcoming.slice(0, max).map((r, i) => `${i + 1}. ${formatRun(r)}`).join("\n");
}

// Editor decisions summary. 0 decisions → escalation line.
export function formatEditorDecisions(decisions, hoursWindow = 16) {
  if (!decisions || decisions.length === 0) {
    return `⚠️ Editor 0 decisões em ${hoursWindow}h\n   Labeling pendente desbloqueia.`;
  }
  const summary = decisions.reduce((acc, e) => {
    const dec = e?.decision?.decision || "?";
    acc[dec] = (acc[dec] || 0) + 1;
    return acc;
  }, {});
  const parts = Object.entries(summary).map(([k, v]) => `${k}: ${v}`).join(" · ");
  return `🤖 Editor (${hoursWindow}h): ${decisions.length} decisões\n   ${parts}`;
}

// Top N insights by save_rate.
export function formatInsightsTop(insights, max = 3) {
  if (!insights || !insights.ranked?.length) return "_(sem insights — rode ig-insights-scraper)_";
  return insights.ranked.slice(0, max).map((r, i) => {
    const title = humanizeRunId(r.run_id);
    const reach = r.reach || 0;
    const sharePct = ((r.share_rate || 0) * 100).toFixed(1);
    const vsMed = (r.vs_median || 0).toFixed(2);
    return `${i + 1}. ${title} (P${r.pillar || "?"}): ${reach} reach · ${sharePct}% share · vs.med ${vsMed}`;
  }).join("\n");
}

// Returns null when no flags — caller skips the whole section.
export function formatCriticalFlags(flags) {
  if (!flags?.length) return null;
  return flags.slice(0, 3).map(f => `• ${f.date}: critical drift`).join("\n");
}

// /status master composer — call with data already gathered.
export function composeStatus({ counts, upcoming, decisions, hoursWindow = 16 }) {
  const shown = Math.min(upcoming?.length || 0, 5);
  const upcomingHeader = shown > 0 ? `📅 *Próximos ${shown} posts*` : `📅 *Próximos posts*`;
  return [
    "📊 *Pipeline*",
    formatPipelineState(counts),
    "",
    upcomingHeader,
    formatUpcomingRuns(upcoming, 5),
    "",
    formatEditorDecisions(decisions, hoursWindow),
  ].join("\n");
}

// Daily brief Telegram-native composer. Markdown .md file is separate.
export function composeDailyBriefTelegram({
  today, counts, upcoming, decisions, insights, circuit, costToday, flags, synthesis, hoursWindow = 16,
}) {
  const parts = [`📋 *Daily Brief · ${today}*`, ""];

  const byState = Object.fromEntries((counts || []).map(c => [c.state, c.n]));
  const compact = ["published", "approving", "draft", "blocked", "idea"]
    .filter(s => byState[s] !== undefined)
    .map(s => `${formatStatusEmoji(s)} ${byState[s]}`)
    .join("  ");
  parts.push("📊 *Status*");
  if (compact) parts.push(`• ${compact}`);
  parts.push(`• cost $${(costToday || 0).toFixed(2)}/$40 · circuit ${circuit?.state || "?"}`);

  const shown = Math.min(upcoming?.length || 0, 5);
  parts.push("", shown > 0 ? `🎯 *Próximos ${shown} posts*` : `🎯 *Próximos posts*`);
  parts.push(formatUpcomingRuns(upcoming, 5));

  parts.push("", formatEditorDecisions(decisions, hoursWindow));

  if (insights && insights.n > 0) {
    const topN = Math.min(insights.ranked?.length || 0, 3);
    parts.push("", `📈 *Top ${topN} posts (${insights.n} medidos)*`);
    parts.push(formatInsightsTop(insights, 3));
  }

  const flagsStr = formatCriticalFlags(flags);
  if (flagsStr) {
    parts.push("", "🚨 *Flags*", flagsStr);
  }

  if (synthesis?.recommendation && synthesis.recommendation !== "Aguardar." && !synthesis.recommendation.startsWith("(")) {
    parts.push("", `💡 ${synthesis.recommendation}`);
  }

  return parts.join("\n");
}

// Pre-publish alert composer (called from prepublish-alerts.mjs).
export function composePrepublishAlert(r, minutesAway) {
  const title = humanizeRunId(r.run_id);
  return [
    `🔔 *T-${minutesAway}min · ${title}*`,
    "",
    `${formatRelativeDate(r.scheduled_for)} · P${r.pillar || "?"} · ${r.persona || "?"} · ${r.format || "?"}`,
    "",
    `Botões abaixo · ou /publish ${r.run_id} · ou /cancel ${r.run_id}`,
  ].join("\n");
}
