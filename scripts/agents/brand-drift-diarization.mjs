// scripts/agents/brand-drift-diarization.mjs — Diarization #4 (mensal)
//
// Roda 1º dia do mês 03:00 UTC via systemd timer.
// Compara: voice publicada (últimos 30d de captions) vs voice declarada (voice.md)
// Output: runs/_briefs/brand-drift-YYYY-MM-DD.md + Telegram alert se gap > threshold
//
// Princípio Tan #5: 1-page diarization.
// Princípio Tan #4: extração das captions deterministic (grep MD), LLM SÓ pra comparison

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import Anthropic from "@anthropic-ai/sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");

// .env loader
const ENV_PATH = path.join(ROOT, ".env");
if (fs.existsSync(ENV_PATH)) {
  for (const line of fs.readFileSync(ENV_PATH, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const VOICE_MD = path.join(ROOT, "foundation", "voice.md");
const BRIEFS_DIR = path.join(ROOT, "runs", "_briefs");
const TELEGRAM_NOTIFY = path.join(ROOT, "scripts", "agents", "telegram-notify.mjs");
const RUNS_DIR = path.join(ROOT, "runs");

fs.mkdirSync(BRIEFS_DIR, { recursive: true });

// ─── Collect últimas N captions publicadas (deterministic) ───────────────────
function collectPublishedCaptions(daysBack = 30) {
  const cutoff = Date.now() - daysBack * 86400 * 1000;
  const out = [];
  if (!fs.existsSync(RUNS_DIR)) return out;
  for (const dir of fs.readdirSync(RUNS_DIR).filter(d => /^\d{4}-\d{2}-\d{2}/.test(d))) {
    const coPath = path.join(RUNS_DIR, dir, "content-object.md");
    if (!fs.existsSync(coPath)) continue;
    const co = fs.readFileSync(coPath, "utf-8");
    if (!/^state:\s*published/m.test(co)) continue;
    const publishedAt = (co.match(/^published_at:\s*(\S+)/m) ?? [, null])[1];
    if (!publishedAt || new Date(publishedAt).getTime() < cutoff) continue;
    const persona = (co.match(/^target_persona:\s*(\S+)/m) ?? [, "unknown"])[1];
    const pillar = parseInt((co.match(/^pillar:\s*(\d+)/m) ?? [, "0"])[1]);
    // Caption from draft-package.md
    const dpPath = path.join(RUNS_DIR, dir, "draft-package.md");
    if (!fs.existsSync(dpPath)) continue;
    const dp = fs.readFileSync(dpPath, "utf-8");
    const captionMatch = dp.match(/### Caption[^\n]*\n([\s\S]*?)(?=\n###|\n##|\n# |$)/);
    if (!captionMatch) continue;
    out.push({
      run_id: dir,
      published_at: publishedAt,
      persona, pillar,
      caption: captionMatch[1].trim().slice(0, 1200),
    });
  }
  return out.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
}

// ─── LLM comparison ─────────────────────────────────────────────────────────
async function diarizeBrandDrift(captions, voice, anthropic) {
  if (captions.length < 3) {
    return { sufficient: false, summary: `Only ${captions.length} captions in last 30d. Need ≥3 for drift analysis.` };
  }
  const captionsText = captions.map(c => `## ${c.run_id} (P${c.pillar} · ${c.persona})\n${c.caption}\n`).join("\n---\n");
  const prompt = `Você é o Brand Drift Diarizer. Compare voice REAL (últimas captions publicadas) vs voice DECLARADA (foundation/voice.md).

═══ DECLARED VOICE ═══
${voice.slice(0, 4500)}

═══ PUBLISHED CAPTIONS (últimos 30d, ${captions.length} posts) ═══
${captionsText.slice(0, 8000)}

═══ TAREFA ═══
Avalie 5 dimensões de drift (0 = sem drift, 10 = drift severo):

1. **Vocabulário** — usa léxico Longevify (biomarcadores, faixa funcional, painel) OU drift pra genérico healthtech?
2. **Tom** — sóbrio Mito+Aesop+Equinox OU drift pra self-help / fear / hype?
3. **Voice mode adequação** — usa mode certo por persona alvo OU usa 1 mode pra tudo?
4. **CTA discipline** — convite-inteligente OU drift pra "link na bio"/"compre agora"?
5. **Slop discipline** — passa avoid-slop OU drift pra emoji/exclamação/em-dash overuse?

Retorne SÓ JSON:
{
  "scores": {
    "vocabulario": <0-10>,
    "tom": <0-10>,
    "voice_mode_fit": <0-10>,
    "cta_discipline": <0-10>,
    "slop_discipline": <0-10>
  },
  "total_drift": <sum>,
  "severity": "OK" | "MINOR" | "MEDIUM" | "HIGH",
  "patterns_emergentes": ["<padrão observado emerge nas captions>"],
  "violations_specific": [{ "run_id": "...", "issue": "..." }],
  "recommendation": "<1-2 sentences ação concreta>",
  "alert_telegram": <bool>
}

Threshold severity:
- total ≥ 25 = HIGH (alert)
- total 15-24 = MEDIUM (alert)
- total 5-14 = MINOR (log)
- total < 5 = OK (no action)`;

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("\n");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { sufficient: true, error: "LLM no JSON", raw: text.slice(0, 500) };
  const cost = ((msg.usage?.input_tokens ?? 0) / 1e6) * 3 + ((msg.usage?.output_tokens ?? 0) / 1e6) * 15;
  return { sufficient: true, ...JSON.parse(m[0]), cost_usd: cost };
}

function composeBrief(captions, drift) {
  const today = new Date().toISOString().slice(0, 10);
  let md = `# Brand Drift Diarization · ${today}

> Diarization #4 monthly. Read-only.
> Compara voice publicada (${captions.length} posts últimos 30d) vs declarada (foundation/voice.md).

---

`;
  if (!drift.sufficient) {
    md += `## ⏳ Insufficient data\n\n${drift.summary}\n`;
    return md;
  }
  if (drift.error) {
    md += `## ⚠️ Error\n\n${drift.error}\n\n\`\`\`\n${drift.raw}\n\`\`\`\n`;
    return md;
  }
  md += `## 📊 Drift severity: **${drift.severity}** (total ${drift.total_drift}/50)\n\n`;
  md += `| Dimensão | Score 0-10 |\n|---|---|\n`;
  for (const [k, v] of Object.entries(drift.scores)) {
    md += `| ${k} | ${v} |\n`;
  }
  md += `\n## 🎯 Padrões emergentes\n\n`;
  for (const p of drift.patterns_emergentes || []) md += `- ${p}\n`;
  md += `\n## ⚠️ Violations específicas\n\n`;
  if (drift.violations_specific?.length) {
    for (const v of drift.violations_specific) md += `- \`${v.run_id}\`: ${v.issue}\n`;
  } else {
    md += `(nenhuma)\n`;
  }
  md += `\n## 💡 Recomendação\n\n${drift.recommendation}\n\n`;
  md += `---\n\n*Sample: ${captions.length} captions · cost ${drift.cost_usd?.toFixed(4) || "?"} USD*\n`;
  return md;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
console.log("\n🎭 Brand Drift Diarization (#4)\n");
const captions = collectPublishedCaptions(30);
console.log(`  ✓ ${captions.length} captions published last 30d`);

const voice = fs.existsSync(VOICE_MD) ? fs.readFileSync(VOICE_MD, "utf-8") : "";
console.log(`  ✓ voice.md loaded (${voice.length} chars)`);

if (captions.length < 3) {
  console.log(`  ⏳ Insufficient data — need ≥3 published captions in last 30d (have ${captions.length})\n`);
  const today = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(BRIEFS_DIR, `brand-drift-${today}.md`),
    `# Brand Drift Diarization · ${today}\n\nInsufficient data (${captions.length} captions < 3). Skipping.\n`);
  process.exit(0);
}

const anthropic = new Anthropic();
console.log(`  ⏳ LLM diarizing...`);
const drift = await diarizeBrandDrift(captions, voice, anthropic);

const md = composeBrief(captions, drift);
const today = new Date().toISOString().slice(0, 10);
const briefPath = path.join(BRIEFS_DIR, `brand-drift-${today}.md`);
fs.writeFileSync(briefPath, md);
console.log(`\n✅ Brief: ${path.relative(ROOT, briefPath)}`);

if (drift.alert_telegram && (drift.severity === "HIGH" || drift.severity === "MEDIUM")) {
  try {
    const alertMsg = `🎭 *Brand Drift Alert · ${drift.severity}*\n\n${drift.recommendation}\n\nDetail: ${path.relative(ROOT, briefPath)}`;
    execSync(`node ${TELEGRAM_NOTIFY} --alert "${alertMsg.replace(/"/g, '\\"').replace(/\n/g, '\\n')}" ${drift.severity === "HIGH" ? "critical" : "warn"}`, { stdio: "ignore", timeout: 15000 });
    console.log(`  ✓ Telegram alert sent (${drift.severity})`);
  } catch (e) { /* telegram not configured */ }
}

console.log(`\n   Cost: $${(drift.cost_usd || 0).toFixed(4)}\n`);
