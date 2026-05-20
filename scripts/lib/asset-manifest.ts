/**
 * asset-manifest.ts — Versioned asset tracker per run.
 *
 * Cada vez que visual-gen ou visual-qa produz um asset, chamamos
 * recordAsset() que escreve em runs/<id>/manifest.json:
 *   { slide: 1, version: "v1", hash: "sha256...", prompt_hash: "sha256...",
 *     path: "assets/slide-1-cover.png", created_at, current: true }
 *
 * `getCurrent(runId, slide)` retorna o asset ativo daquele slide.
 * `rollback(runId, slide, version)` marca outra versão como current.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

export interface AssetEntry {
  slide: number;
  version: string;
  hash: string;
  prompt_hash?: string;
  path: string;
  created_at: string;
  current: boolean;
  cost_usd?: number;
  qa_score?: number;
}

function manifestPath(runDir: string): string {
  return path.join(runDir, "manifest.json");
}

export function readManifest(runDir: string): AssetEntry[] {
  const p = manifestPath(runDir);
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, "utf-8")) as AssetEntry[];
}

function writeManifest(runDir: string, entries: AssetEntry[]): void {
  fs.writeFileSync(manifestPath(runDir), JSON.stringify(entries, null, 2));
}

export function hashFile(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

export function hashString(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
}

export function recordAsset(runDir: string, opts: {
  slide: number;
  assetPath: string;
  prompt?: string;
  cost_usd?: number;
  qa_score?: number;
}): AssetEntry {
  const entries = readManifest(runDir);
  // Marca anteriores do mesmo slide como NOT current
  for (const e of entries) if (e.slide === opts.slide) e.current = false;

  const existingForSlide = entries.filter((e) => e.slide === opts.slide).length;
  const version = `v${existingForSlide + 1}`;

  const entry: AssetEntry = {
    slide: opts.slide,
    version,
    hash: hashFile(path.join(runDir, opts.assetPath)),
    prompt_hash: opts.prompt ? hashString(opts.prompt) : undefined,
    path: opts.assetPath,
    created_at: new Date().toISOString(),
    current: true,
    cost_usd: opts.cost_usd,
    qa_score: opts.qa_score,
  };
  entries.push(entry);
  writeManifest(runDir, entries);
  return entry;
}

export function getCurrent(runDir: string, slide: number): AssetEntry | null {
  const entries = readManifest(runDir);
  return entries.find((e) => e.slide === slide && e.current) ?? null;
}

export function getAllCurrent(runDir: string): AssetEntry[] {
  return readManifest(runDir).filter((e) => e.current).sort((a, b) => a.slide - b.slide);
}

export function rollback(runDir: string, slide: number, version: string): AssetEntry {
  const entries = readManifest(runDir);
  const target = entries.find((e) => e.slide === slide && e.version === version);
  if (!target) throw new Error(`Versão ${version} não encontrada para slide ${slide}`);
  for (const e of entries) if (e.slide === slide) e.current = false;
  target.current = true;
  writeManifest(runDir, entries);
  return target;
}

export function listVersions(runDir: string, slide: number): AssetEntry[] {
  return readManifest(runDir).filter((e) => e.slide === slide).sort((a, b) => a.version.localeCompare(b.version));
}
