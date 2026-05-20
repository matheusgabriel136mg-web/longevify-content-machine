/**
 * brand-loader.ts — Loads active brand config from brands/<id>.json
 *
 * Defaults to "longevify". Override via BRAND env var.
 *
 * Usage:
 *   import { brand } from "./lib/brand-loader";
 *   console.log(brand.palette.bg_primary);
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");

export interface BrandConfig {
  id: string;
  name: string;
  domain: string;
  language: string;
  icp: { description: string; age_range: [number, number]; geo: string };
  palette: {
    bg_primary: string;
    text_primary: string;
    accent_gold: string;
    greens: string[];
    forbidden: string[];
  };
  typography: { primary: string; weights: Record<string, number>; italic_only_for?: string };
  logo: { file: string; cover_width_pct: number; internal_width_pct: number; position: string; padding_pct: number };
  pillars: Array<{ n: number; name: string; quota_per_month: number }>;
  voice: { primary: string; secondary?: string; forbidden: string[] };
  publish: { platforms: string[]; ideal_times_brt: string[]; cadence_per_week: { feed: number; stories: number } };
  budget: { daily_usd: number; monthly_usd: number; per_run_usd: number };
  competitors: Array<{ name: string; handle: string; tier: number }>;
}

function loadBrand(id: string): BrandConfig {
  const p = path.join(ROOT, "brands", `${id}.json`);
  if (!fs.existsSync(p)) throw new Error(`Brand config não encontrado: ${p}`);
  return JSON.parse(fs.readFileSync(p, "utf-8")) as BrandConfig;
}

const BRAND_ID = process.env.BRAND ?? "longevify";
export const brand: BrandConfig = loadBrand(BRAND_ID);
