// scripts/agents/prepublish-alerts.mjs — T-15min pre-publish Telegram alert
//
// Roda a cada 5min via cron (systemd timer).
// Lê pipeline.db pra runs com scheduled_for entre now e now+20min.
// Pra cada um:
//   - Se ainda não foi alertado → push Telegram "Posto X em ~15min. Reply 'cancel <id>' OR /publish <id> pra confirmar."
//   - Registra alert em runs/_prepublish-alerts.json (anti-spam)
//
// Princípio Tan: deterministic select + push. Sem LLM.
// Princípio Longevify: NUNCA publica auto. Só alerta + aguarda founder.

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import Database from "better-sqlite3";

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

const PIPELINE_DB = path.join(ROOT, "runs", "_pipeline.db");
const ALERTS_STATE = path.join(ROOT, "runs", "_prepublish-alerts.json");
const AUDIT_LOG = path.join(ROOT, "runs", "_audit-log.jsonl");
const TELEGRAM_NOTIFY = path.join(ROOT, "scripts", "agents", "telegram-notify.mjs");

function audit(entry) {
  fs.mkdirSync(path.dirname(AUDIT_LOG), { recursive: true });
  fs.appendFileSync(AUDIT_LOG, JSON.stringify({ ts: new Date().toISOString(), agent: "prepublish-alerts", ...entry }) + "\n");
}

function loadAlerted() {
  if (!fs.existsSync(ALERTS_STATE)) return {};
  return JSON.parse(fs.readFileSync(ALERTS_STATE, "utf-8"));
}
function saveAlerted(s) {
  fs.writeFileSync(ALERTS_STATE, JSON.stringify(s, null, 2));
}

if (!fs.existsSync(PIPELINE_DB)) {
  console.error("pipeline.db missing — pipeline.mjs precisa ter rodado pelo menos 1x");
  process.exit(0);
}

const db = new Database(PIPELINE_DB, { readonly: true });
const now = Date.now();
const cutoff = now + 20 * 60 * 1000; // próximos 20min

const upcoming = db.prepare(`
  SELECT * FROM runs
  WHERE scheduled_for IS NOT NULL
    AND state IN ('approving', 'blocked', 'editing')
  ORDER BY scheduled_for ASC
`).all().filter(r => {
  const slot = new Date(r.scheduled_for).getTime();
  return slot > now && slot <= cutoff;
});
db.close();

if (upcoming.length === 0) {
  console.log(`(nenhum slot nos próximos 20min)`);
  process.exit(0);
}

const alerted = loadAlerted();
let sent = 0;
for (const r of upcoming) {
  const slotIso = r.scheduled_for;
  const key = `${r.run_id}__${slotIso}`;
  if (alerted[key]) continue; // já alertado

  const minutesAway = Math.round((new Date(slotIso).getTime() - now) / 60000);
  const msg = `🔔 *Pre-publish alert · T-${minutesAway}min*

Run: \`${r.run_id}\`
Slot: ${slotIso}
Pillar: P${r.pillar || "?"}
Persona: ${r.persona || "?"}
Format: ${r.format || "?"}

Pra publicar agora: reply \`/publish ${r.run_id}\` + \`/confirm\`
Pra abortar: ignore OR reply \`/cancel ${r.run_id}\``;

  try {
    execSync(`node ${TELEGRAM_NOTIFY} --alert "${msg.replace(/"/g, '\\"').replace(/\n/g, '\\n')}" warn`, { stdio: "ignore", timeout: 15000 });
    alerted[key] = new Date().toISOString();
    sent++;
    audit({ event: "prepublish_alert_sent", run_id: r.run_id, slot: slotIso, minutes_away: minutesAway });
    console.log(`  ✓ alerted ${r.run_id} (T-${minutesAway}min)`);
  } catch (e) {
    console.error(`  ✗ alert failed ${r.run_id}: ${e.message.slice(0, 100)}`);
  }
}

// Cleanup alerts older than 24h
for (const k of Object.keys(alerted)) {
  if (new Date(alerted[k]).getTime() < now - 24 * 3600 * 1000) delete alerted[k];
}
saveAlerted(alerted);

console.log(`\n✓ ${sent} alert(s) sent. ${upcoming.length} upcoming slots checked.`);
