/**
 * capture-site.ts — Screenshot autônomo de seções do longevify.com.br
 *
 * Permite passar URLs + CSS selectors. Para cada selector, screenshota o
 * elemento em alta res (3x device scale) e salva em runs/<run-id>/assets/sources/.
 *
 * Útil pra posts tipo "Como funciona", "Antes/depois", "Novidades no app" —
 * onde a fonte visual é o próprio site.
 *
 * Uso:
 *   pnpm capture-site --run 2026-05-14-001-como-funciona-carousel --config path/to/capture.json
 *
 * Config JSON example:
 * {
 *   "url": "https://longevify.com.br",
 *   "viewport": { "width": 1440, "height": 900 },
 *   "selectors": [
 *     { "name": "como-funciona-card-1", "selector": ".howitworks-grid > div:nth-child(1)" },
 *     { "name": "como-funciona-card-2", "selector": ".howitworks-grid > div:nth-child(2)" }
 *   ]
 * }
 *
 * Se Playwright não estiver instalado, sugere comando.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

interface CaptureConfig {
  url: string;
  viewport?: { width: number; height: number };
  device_scale?: number;
  selectors: Array<{ name: string; selector: string; wait_for?: string }>;
}

interface Args {
  run: string;
  config: string;
  full_page: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Partial<Args> = { full_page: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--run") out.run = args[++i];
    else if (a === "--config") out.config = args[++i];
    else if (a === "--full-page") out.full_page = true;
  }
  if (!out.run || !out.config) {
    console.error("Usage: pnpm capture-site --run <run-id> --config <path-to-config.json> [--full-page]");
    process.exit(1);
  }
  return out as Args;
}

async function main() {
  const args = parseArgs();
  const runDir = path.join(ROOT, "runs", args.run);
  if (!fs.existsSync(runDir)) throw new Error(`Run não existe: ${runDir}`);

  const cfgPath = path.isAbsolute(args.config) ? args.config : path.join(ROOT, args.config);
  if (!fs.existsSync(cfgPath)) throw new Error(`Config não encontrado: ${cfgPath}`);
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as CaptureConfig;

  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error("❌ Playwright não instalado. Roda:");
    console.error("   npm install -D playwright && npx playwright install chromium");
    process.exit(1);
  }

  const sourcesDir = path.join(runDir, "assets", "sources");
  fs.mkdirSync(sourcesDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: cfg.viewport ?? { width: 1440, height: 900 },
    deviceScaleFactor: cfg.device_scale ?? 3,
  });
  const page = await context.newPage();

  console.log(`🌐 Navegando: ${cfg.url}`);
  await page.goto(cfg.url, { waitUntil: "networkidle", timeout: 30_000 });

  if (args.full_page) {
    const out = path.join(sourcesDir, "full-page.png");
    await page.screenshot({ path: out, fullPage: true });
    console.log(`✅ Full page → ${out}`);
  }

  for (const sel of cfg.selectors) {
    try {
      if (sel.wait_for) await page.waitForSelector(sel.wait_for, { timeout: 10_000 });
      const el = await page.$(sel.selector);
      if (!el) {
        console.log(`⚠️  Selector não encontrado: ${sel.selector} (skipping ${sel.name})`);
        continue;
      }
      const out = path.join(sourcesDir, `${sel.name}.png`);
      await el.screenshot({ path: out });
      console.log(`✅ ${sel.name} → ${out}`);
    } catch (e) {
      console.log(`❌ ${sel.name}: ${(e as Error).message}`);
    }
  }

  await browser.close();
  console.log(`\n📁 Sources salvos em: runs/${args.run}/assets/sources/`);
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
