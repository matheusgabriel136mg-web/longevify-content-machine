/**
 * replicate-direct-openai.ts — image-to-image via OpenAI direto (gpt-image-1)
 *
 * Bypassa Higgsfield (que está 502 no gpt_image_2). Usa o OpenAI Images Edit API
 * com gpt-image-1 (mesmo modelo que ChatGPT usa internamente).
 *
 * Uso:
 *   npm run replicate -- --image=dashboard-images/foo.jpg --prompt-file=/tmp/prompt.txt --out=output/replications/foo
 */

import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);

const args = process.argv.slice(2);
const imagePath = args.find((a) => a.startsWith("--image="))?.split("=")[1];
const promptFile = args.find((a) => a.startsWith("--prompt-file="))?.split("=")[1];
const outDir = args.find((a) => a.startsWith("--out="))?.split("=")[1] ?? "output/replications/test";

if (!imagePath || !promptFile) {
  console.error("Usage: --image=PATH --prompt-file=PATH [--out=PATH]");
  process.exit(1);
}

const fullImage = path.isAbsolute(imagePath) ? imagePath : path.join(ROOT, imagePath);
const fullOut = path.isAbsolute(outDir) ? outDir : path.join(ROOT, outDir);
fs.mkdirSync(fullOut, { recursive: true });

const prompt = fs.readFileSync(promptFile, "utf-8").trim();

const client = new OpenAI();

async function main() {
  console.log(`🎨 OpenAI Images Edit (gpt-image-1)`);
  console.log(`   Image: ${fullImage}`);
  console.log(`   Prompt: ${prompt.length} chars`);
  console.log(`   Output: ${fullOut}`);
  console.log();

  const start = Date.now();
  const result = await client.images.edit({
    model: "gpt-image-1",
    image: fs.createReadStream(fullImage),
    prompt,
    size: "1024x1536", // 4:5 vertical
    n: 1,
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`✅ ${elapsed}s`);

  const data = result.data?.[0];
  if (!data) throw new Error("Sem data na resposta");

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outFile = path.join(fullOut, `gpt-image-1-${ts}.png`);

  if (data.b64_json) {
    fs.writeFileSync(outFile, Buffer.from(data.b64_json, "base64"));
    console.log(`💾 ${outFile}`);
  } else if (data.url) {
    const imgRes = await fetch(data.url);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    fs.writeFileSync(outFile, buf);
    console.log(`💾 ${outFile} (downloaded from URL)`);
  } else {
    console.error("Resposta sem b64_json nem url");
  }

  if (result.usage) {
    console.log(`📊 tokens: ${JSON.stringify(result.usage)}`);
  }
}

main().catch((err) => {
  console.error("\n❌", err.message);
  if (err.response?.data) console.error(err.response.data);
  process.exit(1);
});
