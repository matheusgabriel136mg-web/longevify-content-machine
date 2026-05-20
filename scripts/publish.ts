/**
 * publish.ts — Phase 7 Publisher (Instagram Graph API)
 *
 * Publica run aprovada (state: verified) no Instagram via Graph API.
 * Suporta: carousel, reel, story, image.
 *
 * Fluxo:
 *   1. Lê draft-package.md + assets/ da run
 *   2. Determina formato (frontmatter content-object.md ou --format)
 *   3. Upload assets pra Cloudinary (URL pública obrigatória pra Graph API)
 *   4. Cria media container(s) via IG Graph API
 *   5. Poll até FINISHED (reels demoram)
 *   6. Publish container → media_id
 *   7. Update content-object.md: state=published + post_url
 *
 * Pré-requisitos no .env:
 *   META_PAGE_ACCESS_TOKEN  — long-lived (gerado via scripts/instagram_publisher/get_token.py)
 *   IG_BUSINESS_ACCOUNT_ID  — id da conta IG Business (17 dígitos)
 *   CLOUDINARY_URL          — cloudinary://API_KEY:API_SECRET@CLOUD_NAME
 *
 * Uso:
 *   pnpm publish --run 2026-05-10-001-ferritina-corredora
 *   pnpm publish --run <id> --format carousel --dry-run
 *   pnpm publish --run <id> --caption-override "..."
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const GRAPH = "https://graph.facebook.com/v23.0";

type Format = "carousel" | "reel" | "story" | "image";

interface Args {
  run: string;
  format?: Format;
  captionOverride?: string;
  dryRun: boolean;
  verbose: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Partial<Args> = { dryRun: false, verbose: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--run") out.run = args[++i];
    else if (arg === "--format") out.format = args[++i] as Format;
    else if (arg === "--caption-override") out.captionOverride = args[++i];
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--verbose" || arg === "-v") out.verbose = true;
  }
  if (!out.run) {
    console.error("Usage: pnpm publish --run <run-id> [--format carousel|reel|story|image] [--caption-override TEXT] [--dry-run] [-v]");
    process.exit(1);
  }
  return out as Args;
}

function read(filePath: string): string {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  return fs.readFileSync(filePath, "utf-8");
}

// ────────────────────────────────────────────────────────────────────────────
// PARSING DRAFT + RUN
// ────────────────────────────────────────────────────────────────────────────

function detectFormat(contentObject: string, override?: Format): Format {
  if (override) return override;
  const m = contentObject.match(/^format:\s*(\S+)/m);
  if (!m) throw new Error("No format in content-object.md frontmatter and no --format override");
  const raw = m[1].toLowerCase();
  if (raw.startsWith("carousel")) return "carousel";
  if (raw === "reel") return "reel";
  if (raw === "story") return "story";
  if (raw === "post" || raw === "image") return "image";
  throw new Error(`Unsupported format: ${raw}`);
}

function extractCaption(draftContent: string): string {
  // Pega seção ### Caption ... até próxima header
  const m = draftContent.match(/### Caption[^\n]*\n([\s\S]*?)(?=\n###|\n##|\n# )/);
  if (!m) return "";
  let caption = m[1].trim();
  // Remove instruções/comments tipo "*(omitido — ...)*"
  caption = caption.replace(/^\*\([^)]*\)\*\s*$/gm, "").trim();
  // Append hashtags section if present
  const tagsMatch = draftContent.match(/### Hashtags[^\n]*\n([\s\S]*?)(?=\n###|\n##|\n# )/);
  if (tagsMatch) {
    const tags = tagsMatch[1]
      .trim()
      .replace(/^\*\([^)]*\)\*\s*$/gm, "")
      .trim();
    if (tags && !tags.startsWith("(") && !tags.startsWith("*")) {
      caption += "\n\n" + tags;
    }
  }
  return caption;
}

function collectAssets(runDir: string, format: Format): string[] {
  const assetsDir = path.join(runDir, "assets");
  if (!fs.existsSync(assetsDir)) throw new Error(`No assets/ in ${runDir}. Run visual-gen first.`);
  const files = fs
    .readdirSync(assetsDir)
    .filter((f) => /\.(png|jpg|jpeg|mp4)$/i.test(f))
    .sort()
    .map((f) => path.join(assetsDir, f));

  if (format === "carousel") {
    // Pega TODAS as imagens de slides
    const allSlides = files.filter((f) => /\.(png|jpg|jpeg)$/i.test(f) && /slide-\d+/i.test(path.basename(f)));
    if (allSlides.length === 0) throw new Error("No slide-*.png assets found for carousel");

    // Agrupa por número do slide. Para cada slide, prioriza:
    //   1. Arquivos com "-final" no nome (versão final)
    //   2. Versão mais alta (vN onde N é maior)
    //   3. Fallback: arquivo único
    const bySlide = new Map<number, string[]>();
    for (const f of allSlides) {
      const m = path.basename(f).match(/^slide-(\d+)/);
      if (!m) continue;
      const n = parseInt(m[1], 10);
      if (!bySlide.has(n)) bySlide.set(n, []);
      bySlide.get(n)!.push(f);
    }

    const versionOf = (f: string): number => {
      const m = path.basename(f).match(/-v(\d+)/);
      return m ? parseInt(m[1], 10) : 0;
    };

    const result: string[] = [];
    const slideNums = [...bySlide.keys()].sort((a, b) => a - b);
    for (const n of slideNums) {
      const candidates = bySlide.get(n)!;
      const finals = candidates.filter((f) => /-final\./.test(path.basename(f)));
      const pool = finals.length > 0 ? finals : candidates;
      // dentro do pool, escolhe maior versão (vN). Se sem vN, escolhe sem versão (presume mais recente).
      const sorted = pool.sort((a, b) => versionOf(b) - versionOf(a));
      result.push(sorted[0]);
    }
    return result;
  }
  if (format === "reel") {
    const reels = files.filter((f) => /\.mp4$/i.test(f));
    if (reels.length === 0) throw new Error("No .mp4 assets found for reel");
    return [reels[0]];
  }
  if (format === "story") {
    return [files[0]]; // first asset
  }
  if (format === "image") {
    const imgs = files.filter((f) => /\.(png|jpg|jpeg)$/i.test(f));
    return [imgs[0]];
  }
  throw new Error(`Unknown format: ${format}`);
}

// ────────────────────────────────────────────────────────────────────────────
// CLOUDINARY HOSTING
// ────────────────────────────────────────────────────────────────────────────

function parseCloudinaryUrl(url: string): { apiKey: string; apiSecret: string; cloudName: string } {
  // cloudinary://API_KEY:API_SECRET@CLOUD_NAME
  const m = url.match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
  if (!m) throw new Error("Invalid CLOUDINARY_URL format");
  return { apiKey: m[1], apiSecret: m[2], cloudName: m[3] };
}

async function uploadToCloudinary(filePath: string): Promise<string> {
  const url = process.env.CLOUDINARY_URL;
  if (!url) throw new Error("CLOUDINARY_URL not set (required for IG Graph API public URL)");
  const { apiKey, apiSecret, cloudName } = parseCloudinaryUrl(url);
  const isVideo = /\.mp4$/i.test(filePath);
  const resourceType = isVideo ? "video" : "image";

  const timestamp = String(Math.floor(Date.now() / 1000));
  const folder = "longevify-publish";
  const toSign = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
  const signature = crypto.createHash("sha1").update(toSign).digest("hex");

  const form = new FormData();
  const fileBuffer = fs.readFileSync(filePath);
  const fileBlob = new Blob([new Uint8Array(fileBuffer)]);
  form.append("file", fileBlob, path.basename(filePath));
  form.append("api_key", apiKey);
  form.append("timestamp", timestamp);
  form.append("signature", signature);
  form.append("folder", folder);

  const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`;
  const res = await fetch(uploadUrl, { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cloudinary upload failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { secure_url: string };
  return json.secure_url;
}

// ────────────────────────────────────────────────────────────────────────────
// IG GRAPH API
// ────────────────────────────────────────────────────────────────────────────

async function igPost(endpoint: string, data: Record<string, string>): Promise<any> {
  const body = new URLSearchParams(data);
  const res = await fetch(`${GRAPH}${endpoint}`, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  const json = await res.json();
  if (!res.ok || (json as any).error) {
    throw new Error(`Graph API error: ${JSON.stringify(json)}`);
  }
  return json;
}

async function igGet(endpoint: string, params: Record<string, string>): Promise<any> {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${GRAPH}${endpoint}?${query}`);
  const json = await res.json();
  if (!res.ok || (json as any).error) {
    throw new Error(`Graph API error: ${JSON.stringify(json)}`);
  }
  return json;
}

async function pollContainerReady(containerId: string, token: string, timeoutSec = 300): Promise<void> {
  const start = Date.now();
  while ((Date.now() - start) / 1000 < timeoutSec) {
    const r = await igGet(`/${containerId}`, {
      fields: "status_code,status",
      access_token: token,
    });
    const status = r.status_code;
    console.log(`  container status: ${status}`);
    if (status === "FINISHED") return;
    if (status === "ERROR") throw new Error(`Container errored: ${JSON.stringify(r)}`);
    if (status === "PUBLISHED") return;
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`Timeout waiting for container ${containerId}`);
}

async function publishCarousel(
  igId: string,
  token: string,
  imageUrls: string[],
  caption: string
): Promise<string> {
  console.log(`  creating ${imageUrls.length} carousel item containers...`);
  const childIds: string[] = [];
  for (const url of imageUrls) {
    const r = await igPost(`/${igId}/media`, {
      image_url: url,
      is_carousel_item: "true",
      access_token: token,
    });
    childIds.push(r.id);
  }
  console.log(`  children: ${childIds.join(", ")}`);

  console.log(`  creating carousel container...`);
  const carousel = await igPost(`/${igId}/media`, {
    media_type: "CAROUSEL",
    children: childIds.join(","),
    caption,
    access_token: token,
  });
  console.log(`  carousel container: ${carousel.id}`);
  await pollContainerReady(carousel.id, token);

  console.log(`  publishing...`);
  const published = await igPost(`/${igId}/media_publish`, {
    creation_id: carousel.id,
    access_token: token,
  });
  return published.id;
}

async function publishReel(igId: string, token: string, videoUrl: string, caption: string): Promise<string> {
  console.log(`  creating reel container...`);
  const r = await igPost(`/${igId}/media`, {
    media_type: "REELS",
    video_url: videoUrl,
    caption,
    access_token: token,
  });
  console.log(`  container: ${r.id} (waiting for video processing)`);
  await pollContainerReady(r.id, token);
  console.log(`  publishing...`);
  const published = await igPost(`/${igId}/media_publish`, {
    creation_id: r.id,
    access_token: token,
  });
  return published.id;
}

async function publishStory(igId: string, token: string, mediaUrl: string, isVideo: boolean): Promise<string> {
  console.log(`  creating story container...`);
  const params: Record<string, string> = {
    media_type: "STORIES",
    access_token: token,
  };
  if (isVideo) params.video_url = mediaUrl;
  else params.image_url = mediaUrl;
  const r = await igPost(`/${igId}/media`, params);
  console.log(`  container: ${r.id}`);
  await pollContainerReady(r.id, token);
  const published = await igPost(`/${igId}/media_publish`, {
    creation_id: r.id,
    access_token: token,
  });
  return published.id;
}

async function publishImage(igId: string, token: string, imageUrl: string, caption: string): Promise<string> {
  console.log(`  creating image container...`);
  const r = await igPost(`/${igId}/media`, {
    image_url: imageUrl,
    caption,
    access_token: token,
  });
  console.log(`  container: ${r.id}`);
  await pollContainerReady(r.id, token);
  const published = await igPost(`/${igId}/media_publish`, {
    creation_id: r.id,
    access_token: token,
  });
  return published.id;
}

// ────────────────────────────────────────────────────────────────────────────
// STATE + MAIN
// ────────────────────────────────────────────────────────────────────────────

function updateContentObjectPublished(runDir: string, mediaId: string, format: Format) {
  const filePath = path.join(runDir, "content-object.md");
  let content = fs.readFileSync(filePath, "utf-8");
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  content = content
    .replace(/^state: .*$/m, "state: published")
    .replace(/^updated_at: .*$/m, `updated_at: ${today}`)
    .replace(/^next_action: .*$/m, "next_action: feedback_24h");
  // Inject post_url into frontmatter if not present
  if (!content.match(/^published_media_id:/m)) {
    content = content.replace(
      /^---\n([\s\S]*?)\n---/,
      `---\n$1\npublished_media_id: ${mediaId}\npublished_at: ${now}\npublished_format: ${format}\n---`
    );
  } else {
    content = content
      .replace(/^published_media_id:.*$/m, `published_media_id: ${mediaId}`)
      .replace(/^published_at:.*$/m, `published_at: ${now}`);
  }
  if (content.includes("## State log")) {
    content = content.replace(
      "## State log",
      `## State log\n- ${today}: published as ${format} (media_id=${mediaId})`
    );
  }
  fs.writeFileSync(filePath, content);
}

async function main() {
  const args = parseArgs();
  const runDir = path.join(ROOT, "runs", args.run);
  if (!fs.existsSync(runDir)) {
    console.error(`Run not found: ${runDir}`);
    process.exit(1);
  }

  const draftPath = path.join(runDir, "draft-package.md");
  const contentObjectPath = path.join(runDir, "content-object.md");
  if (!fs.existsSync(draftPath)) {
    console.error(`draft-package.md not found`);
    process.exit(1);
  }

  const draft = read(draftPath);
  const contentObject = read(contentObjectPath);
  const format = detectFormat(contentObject, args.format);
  const caption = args.captionOverride ?? extractCaption(draft);

  console.log(`▶ Publishing ${args.run}`);
  console.log(`  format: ${format}`);
  console.log(`  caption length: ${caption.length} chars`);
  if (args.verbose) console.log(`\nCaption preview:\n${caption.substring(0, 400)}...\n`);

  const assets = collectAssets(runDir, format);
  console.log(`  assets: ${assets.length}`);
  assets.forEach((a) => console.log(`    - ${path.relative(ROOT, a)}`));

  if (args.dryRun) {
    console.log("\n[dry-run] would upload to Cloudinary and publish. Exiting.");
    return;
  }

  // Credentials check
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  const igId = process.env.IG_BUSINESS_ACCOUNT_ID;
  if (!token || !igId) {
    console.error("\n✗ Missing META_PAGE_ACCESS_TOKEN or IG_BUSINESS_ACCOUNT_ID in .env");
    console.error("  Run: cd scripts/instagram_publisher && python3 get_token.py");
    process.exit(1);
  }

  // Upload to Cloudinary
  console.log(`\n[1/3] Uploading assets to Cloudinary...`);
  const urls: string[] = [];
  for (let i = 0; i < assets.length; i++) {
    const a = assets[i];
    console.log(`  [${i + 1}/${assets.length}] ${path.basename(a)}...`);
    const url = await uploadToCloudinary(a);
    urls.push(url);
    console.log(`    → ${url}`);
  }

  // Publish
  console.log(`\n[2/3] Publishing on Instagram (${format})...`);
  let mediaId: string;
  if (format === "carousel") mediaId = await publishCarousel(igId, token, urls, caption);
  else if (format === "reel") mediaId = await publishReel(igId, token, urls[0], caption);
  else if (format === "story") mediaId = await publishStory(igId, token, urls[0], /\.mp4$/i.test(assets[0]));
  else mediaId = await publishImage(igId, token, urls[0], caption);

  console.log(`\n✓ Published! media_id: ${mediaId}`);

  // Update state
  console.log(`[3/3] Updating content-object state...`);
  updateContentObjectPublished(runDir, mediaId, format);
  console.log(`✓ State: published · next_action: feedback_24h`);
}

main().catch((err) => {
  console.error("\n✗ Publisher error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
