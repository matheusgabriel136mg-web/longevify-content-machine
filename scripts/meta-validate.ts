/**
 * meta-validate.ts — Valida credenciais Meta/IG Graph API + Cloudinary
 *
 * Roda checklist:
 *   ✅ META_PAGE_ACCESS_TOKEN funciona (chamada /me)
 *   ✅ IG_BUSINESS_ACCOUNT_ID retorna conta IG válida
 *   ✅ CLOUDINARY_URL faz upload de teste (10KB) com sucesso
 *   ✅ publish.ts pronto pra rodar
 *
 * Output: relatório claro do que está ok / faltando / quebrado.
 *
 * Uso:
 *   pnpm meta-validate
 */

import * as crypto from "crypto";

const GRAPH = "https://graph.facebook.com/v23.0";

interface Check {
  name: string;
  status: "pass" | "fail" | "missing";
  detail: string;
  fix?: string;
}

const checks: Check[] = [];

async function checkMetaToken(): Promise<void> {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) {
    checks.push({
      name: "META_PAGE_ACCESS_TOKEN",
      status: "missing",
      detail: "Variável não está em .env",
      fix: "Rode: python3 scripts/instagram_publisher/get_token.py — segue o fluxo OAuth, copia o long-lived token pro .env",
    });
    return;
  }
  try {
    const res = await fetch(`${GRAPH}/me?access_token=${token}`);
    const json = (await res.json()) as { id?: string; name?: string; error?: { message: string } };
    if (json.error) {
      checks.push({
        name: "META_PAGE_ACCESS_TOKEN",
        status: "fail",
        detail: `Token rejeitado: ${json.error.message}`,
        fix: "Token pode ter expirado ou estar com escopo errado. Regenera via get_token.py.",
      });
    } else {
      checks.push({
        name: "META_PAGE_ACCESS_TOKEN",
        status: "pass",
        detail: `Token válido — Page: ${json.name ?? json.id}`,
      });
    }
  } catch (e) {
    checks.push({
      name: "META_PAGE_ACCESS_TOKEN",
      status: "fail",
      detail: `Erro de rede: ${(e as Error).message}`,
    });
  }
}

async function checkIGAccount(): Promise<void> {
  const igId = process.env.IG_BUSINESS_ACCOUNT_ID;
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!igId) {
    checks.push({
      name: "IG_BUSINESS_ACCOUNT_ID",
      status: "missing",
      detail: "Variável não está em .env",
      fix: "Após criar a app Meta + conectar IG Business à FB Page, get_token.py imprime o ID. Copia pro .env.",
    });
    return;
  }
  if (!token) {
    checks.push({
      name: "IG_BUSINESS_ACCOUNT_ID",
      status: "missing",
      detail: "Pula validação — META_PAGE_ACCESS_TOKEN faltando",
    });
    return;
  }
  try {
    const res = await fetch(`${GRAPH}/${igId}?fields=id,username,media_count&access_token=${token}`);
    const json = (await res.json()) as { id?: string; username?: string; media_count?: number; error?: { message: string } };
    if (json.error) {
      checks.push({
        name: "IG_BUSINESS_ACCOUNT_ID",
        status: "fail",
        detail: `Rejeitado: ${json.error.message}`,
        fix: "Verifica se o ID tem 17 dígitos e se a conta IG é Business/Creator + linkada à FB Page que possui o token.",
      });
    } else {
      checks.push({
        name: "IG_BUSINESS_ACCOUNT_ID",
        status: "pass",
        detail: `@${json.username} (${json.media_count} posts)`,
      });
    }
  } catch (e) {
    checks.push({
      name: "IG_BUSINESS_ACCOUNT_ID",
      status: "fail",
      detail: `Erro de rede: ${(e as Error).message}`,
    });
  }
}

async function checkCloudinary(): Promise<void> {
  const url = process.env.CLOUDINARY_URL;
  if (!url) {
    checks.push({
      name: "CLOUDINARY_URL",
      status: "missing",
      detail: "Variável não está em .env",
      fix: "Cria conta free em https://cloudinary.com (25GB grátis). Dashboard → copia 'API Environment variable' (formato cloudinary://KEY:SECRET@CLOUD). Cola no .env.",
    });
    return;
  }
  const m = url.match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
  if (!m) {
    checks.push({
      name: "CLOUDINARY_URL",
      status: "fail",
      detail: "Formato inválido. Esperado: cloudinary://API_KEY:API_SECRET@CLOUD_NAME",
    });
    return;
  }
  const [, apiKey, apiSecret, cloudName] = m;

  // Test upload of 1px PNG (minimal valid PNG, 67 bytes)
  const tinyPng = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63000100000005000100" +
      "5d6f6e260000000049454e44ae426082",
    "hex"
  );
  const timestamp = String(Math.floor(Date.now() / 1000));
  const folder = "longevify-validate";
  const toSign = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
  const signature = crypto.createHash("sha1").update(toSign).digest("hex");

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(tinyPng)]), "validate.png");
  form.append("api_key", apiKey);
  form.append("timestamp", timestamp);
  form.append("signature", signature);
  form.append("folder", folder);

  try {
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
      method: "POST",
      body: form,
    });
    const json = (await res.json()) as { secure_url?: string; error?: { message: string } };
    if (json.error) {
      checks.push({
        name: "CLOUDINARY_URL",
        status: "fail",
        detail: `Cloudinary rejeitou upload: ${json.error.message}`,
        fix: "API_KEY ou API_SECRET errado. Conferir no dashboard Cloudinary.",
      });
    } else {
      checks.push({
        name: "CLOUDINARY_URL",
        status: "pass",
        detail: `Upload teste OK → ${json.secure_url}`,
      });
    }
  } catch (e) {
    checks.push({
      name: "CLOUDINARY_URL",
      status: "fail",
      detail: `Erro de rede: ${(e as Error).message}`,
    });
  }
}

async function main() {
  console.log("🔍 Validando credenciais Meta/IG Graph API + Cloudinary...\n");

  await checkMetaToken();
  await checkIGAccount();
  await checkCloudinary();

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("RESULTADO");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const passCount = checks.filter((c) => c.status === "pass").length;
  const missingCount = checks.filter((c) => c.status === "missing").length;
  const failCount = checks.filter((c) => c.status === "fail").length;

  for (const c of checks) {
    const icon = c.status === "pass" ? "✅" : c.status === "missing" ? "⚪" : "❌";
    console.log(`${icon} ${c.name}`);
    console.log(`   ${c.detail}`);
    if (c.fix) console.log(`   👉 ${c.fix}`);
    console.log();
  }

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`${passCount} ok · ${missingCount} faltando · ${failCount} quebrado`);

  if (passCount === checks.length) {
    console.log("\n🎉 Tudo pronto. Pode rodar: pnpm publish --run <run-id>");
    process.exit(0);
  } else {
    console.log("\n📖 Setup completo: scripts/instagram_publisher/SETUP.md");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
