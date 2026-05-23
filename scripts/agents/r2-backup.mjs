// scripts/agents/r2-backup.mjs — Cloudflare R2 backup (anti-disaster persistent)
//
// Roda daily via cron. Faz backup de arquivos críticos pro Cloudflare R2.
// Princípio: anti-disaster. Audit logs + state + foundation são canonical pra recovery.
//
// Pré-requisitos no .env:
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
//
// Lifecycle: bucket configurado pra mover objetos > 12 meses pra Glacier (manual setup).
//
// O que backupa (compactado em 1 tarball por dia):
//   - runs/_audit-log.jsonl
//   - runs/_pipeline.db
//   - runs/_insights.db
//   - runs/_queue.json
//   - runs/_circuit-state.json
//   - foundation/ (recursive)
//   - personas/ (recursive)
//   - decisoes/ (recursive)
//   - assets/icons/ (recursive — pequeno)
//
// CLI:
//   node scripts/agents/r2-backup.mjs

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

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

const R2_ACCOUNT = process.env.R2_ACCOUNT_ID;
const R2_KEY = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET || "longevify-cm-backups";

if (!R2_ACCOUNT || !R2_KEY || !R2_SECRET) {
  console.error(`⚠ R2 credentials missing in .env. Setup pending.

Pra ativar:
  1. Cloudflare → R2 → Create bucket "longevify-cm-backups"
  2. R2 → Manage R2 API tokens → Create token (read+write esse bucket)
  3. Add ao .env:
     R2_ACCOUNT_ID=<accountid>
     R2_ACCESS_KEY_ID=<keyid>
     R2_SECRET_ACCESS_KEY=<secret>
     R2_BUCKET=longevify-cm-backups
  4. Configure lifecycle: settings → Object lifecycle rule → "Move to Infrequent Access after 60d"
  5. Re-run este script
`);
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const TMP_TARBALL = `/tmp/longevify-backup-${today}.tar.gz`;
const R2_KEY_PATH = `daily/${today}.tar.gz`;

console.log(`\n📦 R2 Backup · ${today}\n`);

// 1. Coletar lista de arquivos
const filesToBackup = [
  "runs/_audit-log.jsonl",
  "runs/_pipeline.db",
  "runs/_insights.db",
  "runs/_queue.json",
  "runs/_circuit-state.json",
  "runs/_telegram-bot-state.json",
  "runs/_prepublish-alerts.json",
  "foundation",
  "personas",
  "decisoes",
  "assets/icons",
  "CLAUDE.md",
  "LONGEVIFY_PILLARS.md",
  ".gitignore",
];

const existing = filesToBackup.filter(f => fs.existsSync(path.join(ROOT, f)));
console.log(`  ${existing.length}/${filesToBackup.length} files/dirs to backup`);

// 2. Tarball
console.log(`  ⏳ Creating tarball ${TMP_TARBALL}...`);
try {
  execSync(`tar -czf ${TMP_TARBALL} -C ${ROOT} ${existing.map(f => `"${f}"`).join(" ")}`, { stdio: "pipe" });
  const stats = fs.statSync(TMP_TARBALL);
  console.log(`  ✓ tarball ${(stats.size / 1024 / 1024).toFixed(2)}MB`);
} catch (e) {
  console.error(`  ✗ tarball failed: ${e.message.slice(0, 200)}`);
  process.exit(1);
}

// 3. Upload via aws-cli (works with R2 S3-compatible endpoint)
// rclone seria alternativa — aws-cli vem com Ubuntu
const R2_ENDPOINT = `https://${R2_ACCOUNT}.r2.cloudflarestorage.com`;
console.log(`  ⏳ Uploading to R2 (${R2_BUCKET}/${R2_KEY_PATH})...`);
try {
  // Set creds via env
  const env = {
    ...process.env,
    AWS_ACCESS_KEY_ID: R2_KEY,
    AWS_SECRET_ACCESS_KEY: R2_SECRET,
    AWS_DEFAULT_REGION: "auto",
  };
  execSync(`aws s3 cp ${TMP_TARBALL} s3://${R2_BUCKET}/${R2_KEY_PATH} --endpoint-url ${R2_ENDPOINT}`, { env, stdio: "pipe" });
  console.log(`  ✓ uploaded`);
} catch (e) {
  console.error(`  ✗ R2 upload failed: ${e.message.slice(0, 300)}`);
  console.error(`  💡 Install aws-cli: apt install awscli OR use rclone alternative`);
  process.exit(1);
}

// 4. Cleanup local tarball
fs.unlinkSync(TMP_TARBALL);
console.log(`  ✓ local tarball cleaned`);

console.log(`\n✅ R2 backup complete: s3://${R2_BUCKET}/${R2_KEY_PATH}\n`);
console.log(`   Retrieve: aws s3 cp s3://${R2_BUCKET}/${R2_KEY_PATH} ./restore.tar.gz --endpoint-url ${R2_ENDPOINT}\n`);
