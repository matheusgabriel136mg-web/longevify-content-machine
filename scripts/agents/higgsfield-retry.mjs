// scripts/agents/higgsfield-retry.mjs — Higgsfield wrapper with silent-fail recovery
//
// Higgsfield CLI tem bug: ~1/6 jobs falham silenciosamente (sem log).
// Wrapper:
//   1. Spawn job + capture PID
//   2. Wait pra log file aparecer com URL OR timeout
//   3. Se timeout sem URL: kill PID + relaunch (max 2 retries)
//   4. Se URL aparecer: download + return path
//
// Safety net E.
//
// CLI:
//   node scripts/agents/higgsfield-retry.mjs --prompt "..." --aspect-ratio 9:16 --out path.png
//   node scripts/agents/higgsfield-retry.mjs --batch jobs.json --out-dir runs/X/assets/

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { spawn, spawnSync } from "child_process";
import { promisify } from "util";
import { setTimeout as sleep } from "timers/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");

const TMP_BASE = "/tmp/longevify-hf-retry";
fs.mkdirSync(TMP_BASE, { recursive: true });

const DEFAULT_TIMEOUT_MS = 180 * 1000; // 3min per job
const MAX_RETRIES = 2;

// ─── Single job with retry ────────────────────────────────────────────────────
export async function higgsfieldGenerate({ prompt, aspectRatio = "1:1", resolution = "2k", model = "nano_banana_2", logName = null, outPath = null }) {
  const jobName = logName || `hf-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const logPath = path.join(TMP_BASE, `${jobName}.log`);

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    if (fs.existsSync(logPath)) fs.unlinkSync(logPath);

    // Spawn higgsfield generate
    const args = [
      "generate", "create", model,
      "--prompt", prompt,
      "--aspect_ratio", aspectRatio,
      "--resolution", resolution,
      "--wait",
    ];
    const child = spawn("higgsfield", args, {
      detached: false,
      stdio: ["ignore", fs.openSync(logPath, "w"), fs.openSync(logPath, "a")],
    });

    // Wait pra log ter URL OR timeout
    const start = Date.now();
    let urlFound = null;
    while (Date.now() - start < DEFAULT_TIMEOUT_MS) {
      await sleep(2000);
      if (!fs.existsSync(logPath)) continue;
      const content = fs.readFileSync(logPath, "utf-8");
      const m = content.match(/https:\/\/[^\s]+\.png/);
      if (m) { urlFound = m[0]; break; }
      // Check for error
      if (/Error:/i.test(content)) {
        console.error(`  ✗ ${jobName} attempt ${attempt} ERROR: ${content.slice(0, 200)}`);
        break;
      }
    }

    // Cleanup child if still running
    try { child.kill(); } catch {}

    if (urlFound) {
      // Download
      if (outPath) {
        try {
          spawnSync("curl", ["-sSo", outPath, urlFound], { stdio: "inherit" });
          return { ok: true, url: urlFound, path: outPath, attempts: attempt };
        } catch (e) {
          return { ok: false, reason: `download failed: ${e.message}`, url: urlFound, attempts: attempt };
        }
      }
      return { ok: true, url: urlFound, attempts: attempt };
    }

    if (attempt <= MAX_RETRIES) {
      console.log(`  ⏳ ${jobName} attempt ${attempt} silent fail. Retry ${attempt + 1}/${MAX_RETRIES + 1}...`);
    } else {
      return { ok: false, reason: "silent_fail_max_retries", attempts: attempt };
    }
  }
}

// ─── Batch (parallel) ─────────────────────────────────────────────────────────
export async function higgsfieldBatch(jobs, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const results = await Promise.all(jobs.map(j => higgsfieldGenerate({
    ...j,
    outPath: path.join(outDir, j.filename),
  })));
  return results;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs() {
  const a = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--prompt") out.prompt = a[++i];
    else if (a[i] === "--aspect-ratio") out.aspectRatio = a[++i];
    else if (a[i] === "--resolution") out.resolution = a[++i];
    else if (a[i] === "--model") out.model = a[++i];
    else if (a[i] === "--out") out.outPath = a[++i];
    else if (a[i] === "--name") out.logName = a[++i];
    else if (a[i] === "--batch") out.batch = a[++i];
    else if (a[i] === "--out-dir") out.outDir = a[++i];
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs();
  if (args.batch) {
    const jobs = JSON.parse(fs.readFileSync(args.batch, "utf-8"));
    const results = await higgsfieldBatch(jobs, args.outDir);
    console.log(JSON.stringify(results, null, 2));
    process.exit(results.every(r => r.ok) ? 0 : 1);
  } else if (args.prompt) {
    const result = await higgsfieldGenerate(args);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  } else {
    console.error("Usage: higgsfield-retry.mjs --prompt <s> --out <path> OR --batch <json> --out-dir <dir>");
    process.exit(1);
  }
}
