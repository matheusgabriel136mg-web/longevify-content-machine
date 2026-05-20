/**
 * meta-wizard.ts — Interactive wizard pra configurar Meta App + IG publishing
 *
 * Roda passo-a-passo:
 *   1. Abre links no browser pros sites onde você precisa criar/copiar coisas
 *   2. Pede credenciais via stdin
 *   3. Valida cada uma antes de avançar
 *   4. Escreve direto no .env quando passa
 *
 * Uso:
 *   pnpm meta-wizard
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import * as crypto from "crypto";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");
const GRAPH = "https://graph.facebook.com/v23.0";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));
}

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
}

function readEnv(): Record<string, string> {
  if (!fs.existsSync(ENV_PATH)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(ENV_PATH, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function setEnv(key: string, value: string): void {
  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf-8") : "";
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(content)) {
    content = content.replace(re, `${key}=${value}`);
  } else {
    content = content.replace(/\n*$/, "\n") + `${key}=${value}\n`;
  }
  fs.writeFileSync(ENV_PATH, content);
}

async function step1AppCreation(): Promise<{ appId: string; appSecret: string }> {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("STEP 1/4 · Criar Meta App");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`
Vou abrir o Meta for Developers. Lá:
  1. Click "Create App" (canto superior direito)
  2. Use case: "Other"
  3. Type: "Business"
  4. Name: "Longevify Content Machine"
  5. Submit, aceita termos
  6. No app dashboard → Add Products → Instagram + Facebook Login for Business
  7. App Settings → Basic → copia App ID + App Secret (clica "Show")
`);
  await ask("[Enter] pra abrir https://developers.facebook.com/apps ...");
  openBrowser("https://developers.facebook.com/apps");

  const appId = (await ask("\nCola o App ID aqui: ")).trim();
  if (!/^\d{15,18}$/.test(appId)) throw new Error("App ID parece inválido (15-18 dígitos)");
  setEnv("META_APP_ID", appId);

  const appSecret = (await ask("Cola o App Secret aqui: ")).trim();
  if (appSecret.length < 30) throw new Error("App Secret parece curto demais");
  setEnv("META_APP_SECRET", appSecret);
  console.log("✅ META_APP_ID + META_APP_SECRET salvos em .env\n");
  return { appId, appSecret };
}

async function step2Permissions(): Promise<void> {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("STEP 2/4 · Habilitar permissions");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`
No dashboard da app → "Use cases" → "Add use case":
  • "Manage everything on your Page" → ON
  • "Instagram messaging and content publishing" → ON

Marca os scopes (cada um tem um toggle "Add to your app"):
  ☑ instagram_business_basic
  ☑ instagram_business_content_publish
  ☑ pages_show_list
  ☑ pages_read_engagement
`);
  await ask("[Enter] quando os 4 scopes estiverem ativos ...");
  console.log("✅\n");
}

async function step3Token(): Promise<{ token: string; igId: string }> {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("STEP 3/4 · Long-lived Page Access Token + IG ID");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`
Pré-requisito: sua conta IG é Business/Creator + linkada a uma FB Page.
Se não está: IG mobile → Settings → Account → Switch to Business → linka FB Page.

Agora vou rodar python3 scripts/instagram_publisher/get_token.py.
Ele:
  1. Abre browser
  2. Você loga no FB que controla a Page
  3. Autoriza a app
  4. Imprime PAGE_ACCESS_TOKEN + IG_BUSINESS_ACCOUNT_ID
`);
  await ask("[Enter] pra rodar get_token.py (precisa Python 3.8+) ...");

  const ok = await new Promise<boolean>((resolve) => {
    const proc = spawn("python3", ["scripts/instagram_publisher/get_token.py"], { cwd: ROOT, stdio: "inherit" });
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
  if (!ok) {
    console.log("\n⚠️  get_token.py falhou. Modo manual:");
    console.log("   1. Browser: https://developers.facebook.com/tools/explorer");
    console.log("   2. Login, escolhe sua app, gera User Token com os 4 scopes");
    console.log("   3. Pega o token e troca por long-lived via:");
    console.log("      GET /oauth/access_token?grant_type=fb_exchange_token&client_id=APPID&client_secret=APPSECRET&fb_exchange_token=USERTOKEN");
    console.log("   4. Lista Pages: GET /me/accounts?access_token=LONGUSERTOKEN");
    console.log("   5. Cada page tem `access_token` (Page Access Token — nunca expira) e `id`");
    console.log("   6. IG Business ID: GET /PAGEID?fields=instagram_business_account&access_token=PAGETOKEN");
  }

  const token = (await ask("\nCola o Page Access Token (long-lived): ")).trim();
  if (token.length < 80) throw new Error("Token parece curto demais");

  // Valida token
  const meRes = await fetch(`${GRAPH}/me?access_token=${token}`);
  const meJson = (await meRes.json()) as { id?: string; name?: string; error?: { message: string } };
  if (meJson.error) throw new Error(`Token rejeitado: ${meJson.error.message}`);
  console.log(`✅ Token válido — Page: ${meJson.name ?? meJson.id}`);
  setEnv("META_PAGE_ACCESS_TOKEN", token);

  const igId = (await ask("Cola o IG_BUSINESS_ACCOUNT_ID (17 dígitos): ")).trim();
  if (!/^\d{15,18}$/.test(igId)) throw new Error("IG ID parece inválido");

  const igRes = await fetch(`${GRAPH}/${igId}?fields=username,media_count&access_token=${token}`);
  const igJson = (await igRes.json()) as { username?: string; media_count?: number; error?: { message: string } };
  if (igJson.error) throw new Error(`IG ID rejeitado: ${igJson.error.message}`);
  console.log(`✅ IG conta: @${igJson.username} (${igJson.media_count} posts)`);
  setEnv("IG_BUSINESS_ACCOUNT_ID", igId);
  console.log();
  return { token, igId };
}

async function step4Cloudinary(): Promise<void> {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("STEP 4/4 · Cloudinary (hosting de imagens/vídeos)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`
Vou abrir o signup do Cloudinary. Plano Free dá 25GB de bandwidth/mês (sobra muito).

  1. Cria conta (pode usar Google login)
  2. No dashboard, em "API Environment variable", copia o formato:
     CLOUDINARY_URL=cloudinary://API_KEY:API_SECRET@CLOUD_NAME
`);
  await ask("[Enter] pra abrir https://cloudinary.com/users/register_free ...");
  openBrowser("https://cloudinary.com/users/register_free");

  const url = (await ask("\nCola o CLOUDINARY_URL completo: ")).trim();
  const m = url.match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
  if (!m) throw new Error("Formato inválido. Esperado: cloudinary://KEY:SECRET@CLOUD");
  const [, apiKey, apiSecret, cloudName] = m;

  // Smoke upload (1px PNG)
  const tinyPng = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63000100000005000100" +
      "5d6f6e260000000049454e44ae426082",
    "hex"
  );
  const timestamp = String(Math.floor(Date.now() / 1000));
  const folder = "longevify-wizard-test";
  const toSign = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
  const signature = crypto.createHash("sha1").update(toSign).digest("hex");
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(tinyPng)]), "test.png");
  form.append("api_key", apiKey);
  form.append("timestamp", timestamp);
  form.append("signature", signature);
  form.append("folder", folder);

  const upRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: "POST", body: form });
  const upJson = (await upRes.json()) as { secure_url?: string; error?: { message: string } };
  if (upJson.error) throw new Error(`Cloudinary rejeitou upload: ${upJson.error.message}`);
  console.log(`✅ Upload teste OK → ${upJson.secure_url}`);
  setEnv("CLOUDINARY_URL", url);
  console.log();
}

async function main() {
  console.log("🪄 Meta App Setup Wizard\n");
  console.log("Esse wizard vai configurar tudo que falta pra publish.ts funcionar.");
  console.log("Tempo estimado: ~30 minutos (quase tudo é cliques no browser).\n");

  const existing = readEnv();
  const skipApp = existing.META_APP_ID && existing.META_APP_SECRET;
  const skipToken = existing.META_PAGE_ACCESS_TOKEN && existing.IG_BUSINESS_ACCOUNT_ID;
  const skipCloud = existing.CLOUDINARY_URL;

  if (skipApp) console.log("ℹ️  META_APP_ID/SECRET já existem em .env — vou pular STEP 1.");
  if (skipToken) console.log("ℹ️  META_PAGE_ACCESS_TOKEN/IG_ID já existem — vou pular STEPS 2-3.");
  if (skipCloud) console.log("ℹ️  CLOUDINARY_URL já existe — vou pular STEP 4.");
  if (skipApp && skipToken && skipCloud) {
    console.log("\n✅ Tudo configurado. Rodando validação final...");
    rl.close();
    const proc = spawn("node", ["--import", "tsx/esm", "scripts/meta-validate.ts"], { cwd: ROOT, stdio: "inherit" });
    proc.on("close", (code) => process.exit(code ?? 0));
    return;
  }

  try {
    if (!skipApp) await step1AppCreation();
    if (!skipToken) await step2Permissions();
    if (!skipToken) await step3Token();
    if (!skipCloud) await step4Cloudinary();

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🎉 SETUP COMPLETO");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("\nPróximo passo:");
    console.log("  pnpm publish --run 2026-05-14-001-como-funciona-carousel --dry-run");
    console.log("  pnpm publish --run 2026-05-14-001-como-funciona-carousel\n");
  } catch (e) {
    console.error(`\n❌ Wizard parou: ${(e as Error).message}`);
    console.log("Roda de novo (pnpm meta-wizard) — o que já foi salvo no .env vai ser pulado.");
  } finally {
    rl.close();
  }
}

main();
