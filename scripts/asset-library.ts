/**
 * asset-library.ts — Indexed brand asset library with tag search.
 *
 * Scaneia brands/<id>/assets/ (PNG/JPG/MP4), gera manifest com:
 *   - path, dims, sha256
 *   - tags (auto via Claude vision OR manual via assets.json)
 *
 * Permite buscar: pnpm asset-library --search "tipografia gold" → retorna paths
 *
 * Output: brands/<id>/assets-manifest.json
 *
 * Uso:
 *   pnpm asset-library --index                          # rescan
 *   pnpm asset-library --search "fundo escuro"          # busca
 *   pnpm asset-library --tag-auto                       # tagger Claude vision
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { fileURLToPath } from "url";
import { brand } from "./lib/brand-loader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

interface Asset {
  path: string;
  hash: string;
  bytes: number;
  ext: string;
  tags: string[];
  description?: string;
  added_at: string;
  source?: string;
}

function manifestPath(brandId: string): string {
  return path.join(ROOT, "brands", `${brandId}-assets-manifest.json`);
}

function loadManifest(brandId: string): Asset[] {
  const p = manifestPath(brandId);
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf-8")) as Asset[]) : [];
}

function saveManifest(brandId: string, assets: Asset[]): void {
  fs.writeFileSync(manifestPath(brandId), JSON.stringify(assets, null, 2));
}

function hashFile(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex").slice(0, 16);
}

function* walk(dir: string): Generator<string> {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function indexAssets(brandId: string): Asset[] {
  const assetsRoot = path.join(ROOT, "brands", brandId, "assets");
  const existing = loadManifest(brandId);
  const byHash = new Map(existing.map((a) => [a.hash, a]));

  const updated: Asset[] = [];
  let found = 0;
  let added = 0;

  for (const filePath of walk(assetsRoot)) {
    const ext = path.extname(filePath).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".webp", ".mp4"].includes(ext)) continue;
    found++;
    const hash = hashFile(filePath);
    const rel = path.relative(ROOT, filePath);

    if (byHash.has(hash)) {
      const a = byHash.get(hash)!;
      a.path = rel; // update path se moveu
      updated.push(a);
    } else {
      added++;
      updated.push({
        path: rel,
        hash,
        bytes: fs.statSync(filePath).size,
        ext: ext.slice(1),
        tags: [],
        added_at: new Date().toISOString(),
      });
    }
  }

  saveManifest(brandId, updated);
  console.log(`📦 ${found} arquivos · ${added} novos · ${updated.length} total no manifest`);
  return updated;
}

async function autoTag(brandId: string, limit = 20): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY ausente");
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const assets = loadManifest(brandId);
  const untagged = assets.filter((a) => a.tags.length === 0 && /^(png|jpg|jpeg|webp)$/.test(a.ext)).slice(0, limit);
  console.log(`🏷️  Auto-tagging ${untagged.length} assets...`);

  for (const asset of untagged) {
    const filePath = path.join(ROOT, asset.path);
    if (!fs.existsSync(filePath)) continue;
    const b64 = fs.readFileSync(filePath).toString("base64");
    const mediaType = `image/${asset.ext === "jpg" ? "jpeg" : asset.ext}` as "image/png" | "image/jpeg" | "image/webp";

    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
          { type: "text", text: `Você é o curator do brand asset library da Longevify.
Olhe a imagem e retorne JSON puro com:
{ "tags": ["5-8 tags curtas"], "description": "1 frase descritiva" }

Tags úteis: paleta (forest-green, gold, sage), tipo (typography, microscopy, mockup, product, lifestyle), tema (biomarcador, exame, atleta, brasil), uso (cover, slide-interno, story, reel).` }
        ],
      }],
    });
    const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) continue;
    try {
      const parsed = JSON.parse(m[0]) as { tags: string[]; description: string };
      asset.tags = parsed.tags;
      asset.description = parsed.description;
      console.log(`  ✓ ${path.basename(asset.path)} → ${asset.tags.join(", ")}`);
    } catch { /* skip invalid */ }
  }

  saveManifest(brandId, assets);
  console.log(`✓ Manifest atualizado.`);
}

export function search(brandId: string, query: string): Asset[] {
  const assets = loadManifest(brandId);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return assets
    .map((a) => {
      const haystack = [...a.tags, a.description ?? "", a.path].join(" ").toLowerCase();
      const score = terms.reduce((s, t) => s + (haystack.includes(t) ? 1 : 0), 0);
      return { asset: a, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.asset);
}

async function main() {
  const args = process.argv.slice(2);
  const brandId = brand.id;

  if (args.includes("--index")) {
    indexAssets(brandId);
    return;
  }
  if (args.includes("--tag-auto")) {
    indexAssets(brandId);
    const limitIdx = args.indexOf("--limit");
    const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1] ?? "20", 10) : 20;
    await autoTag(brandId, limit);
    return;
  }
  const searchIdx = args.indexOf("--search");
  if (searchIdx >= 0) {
    const query = args[searchIdx + 1] ?? "";
    const results = search(brandId, query);
    console.log(`🔍 "${query}" → ${results.length} matches`);
    for (const r of results.slice(0, 20)) {
      console.log(`  ${r.path}`);
      if (r.tags.length) console.log(`    tags: ${r.tags.join(", ")}`);
      if (r.description) console.log(`    "${r.description}"`);
    }
    return;
  }
  console.log("Usage: pnpm asset-library --index | --tag-auto [--limit N] | --search <query>");
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
