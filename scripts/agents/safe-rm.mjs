// scripts/agents/safe-rm.mjs — Pre-flight checked delete wrapper
//
// Princípio Tan #4 retrospectivo: operações destrutivas NUNCA são geradas por
// LLM em loop dinâmico. Devem ser pre-computadas em lista estática + validadas
// via pre-flight determinístico + logged.
//
// Pre-flight checks:
//   1. Path absoluto (NÃO relativo)
//   2. Path NÃO é root, runs/, foundation/, scripts/, output/, ~/, /
//   3. Path EXISTE
//   4. File count expected (se fornecido)
//   5. Confirmação humana se env DESTRUCTIVE_CONFIRMED != "1"
//
// Soft-delete: por padrão MOVE pra runs/_archived/<timestamp>/ em vez de hard rm.
//
// Audit log: cada operação registrada em runs/_audit-log.jsonl
//
// CLI:
//   node scripts/agents/safe-rm.mjs --path /abs/path --expect-files 5 [--hard]
//   DESTRUCTIVE_CONFIRMED=1 node scripts/agents/safe-rm.mjs --path ...

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");

const FORBIDDEN_PATHS = [
  "/",
  process.env.HOME,
  ROOT,
  path.join(ROOT, "runs"),
  path.join(ROOT, "foundation"),
  path.join(ROOT, "scripts"),
  path.join(ROOT, "output"),
  path.join(ROOT, "personas"),
  path.join(ROOT, "assets"),
  path.join(ROOT, "node_modules"),
  path.join(ROOT, ".git"),
  path.join(ROOT, "decisoes"),
];

const AUDIT_LOG = path.join(ROOT, "runs", "_audit-log.jsonl");
const ARCHIVE_DIR = path.join(ROOT, "runs", "_archived");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function logAudit(entry) {
  ensureDir(path.dirname(AUDIT_LOG));
  fs.appendFileSync(AUDIT_LOG, JSON.stringify(entry) + "\n");
}

function countFilesRecursive(dirPath) {
  let count = 0;
  if (!fs.existsSync(dirPath)) return 0;
  const stat = fs.statSync(dirPath);
  if (!stat.isDirectory()) return 1;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.isDirectory()) count += countFilesRecursive(path.join(dirPath, entry.name));
    else count++;
  }
  return count;
}

export function safeRm(targetPath, opts = {}) {
  const { expectFiles, hard = false, agent = "unknown", reason = "no reason given" } = opts;
  const audit = {
    timestamp: new Date().toISOString(),
    agent,
    target: targetPath,
    expect_files: expectFiles,
    reason,
    result: null,
  };

  // 1. Path absoluto
  if (!path.isAbsolute(targetPath)) {
    audit.result = "REJECTED: path not absolute";
    logAudit(audit);
    throw new Error(`safe-rm REJECTED: path "${targetPath}" not absolute. Use absolute path only.`);
  }

  // 2. Path NÃO é forbidden
  const normalized = path.normalize(targetPath);
  if (FORBIDDEN_PATHS.some(f => f && (normalized === f || normalized === f + "/"))) {
    audit.result = "REJECTED: forbidden path";
    logAudit(audit);
    throw new Error(`safe-rm REJECTED: path "${normalized}" is in FORBIDDEN_PATHS. Nunca apaga raiz, dirs estruturais.`);
  }

  // 2.5. Path tem que estar DENTRO de runs/_archived (se já archived) OU dentro de runs/
  if (!normalized.startsWith(path.join(ROOT, "runs")) && !normalized.startsWith("/tmp/longevify-")) {
    audit.result = "REJECTED: path outside runs/ or /tmp/longevify-";
    logAudit(audit);
    throw new Error(`safe-rm REJECTED: path "${normalized}" outside runs/ ou /tmp/longevify-. Whitelist apenas.`);
  }

  // 3. Path EXISTE
  if (!fs.existsSync(normalized)) {
    audit.result = "NOOP: path does not exist";
    logAudit(audit);
    console.warn(`safe-rm NOOP: ${normalized} doesn't exist`);
    return { ok: true, action: "noop" };
  }

  // 4. File count check (se expectFiles fornecido)
  const actualCount = countFilesRecursive(normalized);
  if (expectFiles !== undefined && actualCount !== expectFiles) {
    audit.result = `REJECTED: file count mismatch (expected ${expectFiles}, found ${actualCount})`;
    logAudit(audit);
    throw new Error(`safe-rm REJECTED: ${normalized} has ${actualCount} files, expected ${expectFiles}.`);
  }
  audit.actual_files = actualCount;

  // 5. Confirmação
  if (process.env.DESTRUCTIVE_CONFIRMED !== "1") {
    audit.result = "REJECTED: DESTRUCTIVE_CONFIRMED env not set";
    logAudit(audit);
    throw new Error(`safe-rm REJECTED: set env DESTRUCTIVE_CONFIRMED=1 to authorize. Target: ${normalized} (${actualCount} files).`);
  }

  // EXECUÇÃO
  if (hard) {
    fs.rmSync(normalized, { recursive: true, force: true });
    audit.result = "HARD_DELETED";
    audit.method = "fs.rmSync";
  } else {
    // Soft-delete: move pra archive com timestamp
    ensureDir(ARCHIVE_DIR);
    const baseName = path.basename(normalized);
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const archivePath = path.join(ARCHIVE_DIR, `${ts}__${baseName}`);
    fs.renameSync(normalized, archivePath);
    audit.result = "ARCHIVED";
    audit.archive_path = archivePath;
    audit.method = "fs.renameSync";
  }

  logAudit(audit);
  return { ok: true, action: audit.result, audit };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs() {
  const a = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--path") out.path = a[++i];
    else if (a[i] === "--expect-files") out.expectFiles = parseInt(a[++i]);
    else if (a[i] === "--hard") out.hard = true;
    else if (a[i] === "--agent") out.agent = a[++i];
    else if (a[i] === "--reason") out.reason = a[++i];
  }
  if (!out.path) {
    console.error(`safe-rm — pre-flight checked delete wrapper

Usage: safe-rm.mjs --path <ABSOLUTE_PATH> [--expect-files N] [--hard] [--agent NAME] [--reason "..."]

Env:
  DESTRUCTIVE_CONFIRMED=1   — required to authorize

Behavior:
  Default = soft-delete (move to runs/_archived/<ts>__<name>/)
  --hard  = hard rm (irreversível)

Forbidden paths: /, $HOME, runs/, foundation/, scripts/, etc.
Whitelisted: paths inside runs/ or /tmp/longevify-*
`);
    process.exit(1);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArgs();
    const r = safeRm(args.path, args);
    console.log(`✓ ${r.action}`);
    if (r.audit?.archive_path) console.log(`  archive: ${r.audit.archive_path}`);
    process.exit(0);
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
}
