/**
 * cost-guard.ts — Budget cap por run / dia / mês.
 *
 * Cada chamada de API (Claude, Higgsfield, Apify) registra custo via recordCost().
 * Antes de qualquer chamada cara, recordCost.checkBudget() retorna true/false.
 *
 * Limits configuráveis via BRAND_DEFAULTS.md ou env:
 *   BUDGET_DAILY_USD=10
 *   BUDGET_MONTHLY_USD=200
 *   BUDGET_PER_RUN_USD=5
 *
 * Storage: logs/cost-ledger.jsonl (1 linha por chamada)
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");

const LEDGER_PATH = path.join(ROOT, "logs", "cost-ledger.jsonl");
const DEFAULT_DAILY = parseFloat(process.env.BUDGET_DAILY_USD ?? "10");
const DEFAULT_MONTHLY = parseFloat(process.env.BUDGET_MONTHLY_USD ?? "200");
const DEFAULT_PER_RUN = parseFloat(process.env.BUDGET_PER_RUN_USD ?? "5");

export type Provider = "anthropic-opus" | "anthropic-sonnet" | "higgsfield-image" | "higgsfield-video" | "apify" | "cloudinary" | "other";

export interface CostRecord {
  ts: string;
  provider: Provider;
  usd: number;
  run?: string;
  phase?: string;
  details?: string;
}

// Pricing per call/unit (estimates 2026)
export const PRICING = {
  "anthropic-opus": { input_per_mtok: 15, output_per_mtok: 75 },
  "anthropic-sonnet": { input_per_mtok: 3, output_per_mtok: 15 },
  "higgsfield-image": { per_call: 0.5 }, // nano_banana_2
  "higgsfield-video": { per_call: 3.0 }, // seedance/kling 1080p 5s avg
  apify: { per_run: 0.5 }, // 80 posts scrape avg
  cloudinary: { per_upload: 0.001 },
  other: { per_call: 0 },
};

export function estimateAnthropicCost(model: "opus" | "sonnet", input_tokens: number, output_tokens: number): number {
  const p = model === "opus" ? PRICING["anthropic-opus"] : PRICING["anthropic-sonnet"];
  return (input_tokens / 1_000_000) * p.input_per_mtok + (output_tokens / 1_000_000) * p.output_per_mtok;
}

export function recordCost(record: Omit<CostRecord, "ts">): void {
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), ...record });
  fs.appendFileSync(LEDGER_PATH, line + "\n");
}

export function readLedger(): CostRecord[] {
  if (!fs.existsSync(LEDGER_PATH)) return [];
  return fs
    .readFileSync(LEDGER_PATH, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as CostRecord);
}

export function totalForRun(runId: string): number {
  return readLedger().filter((r) => r.run === runId).reduce((s, r) => s + r.usd, 0);
}

export function totalForDay(date: string = new Date().toISOString().slice(0, 10)): number {
  return readLedger().filter((r) => r.ts.startsWith(date)).reduce((s, r) => s + r.usd, 0);
}

export function totalForMonth(yyyymm: string = new Date().toISOString().slice(0, 7)): number {
  return readLedger().filter((r) => r.ts.startsWith(yyyymm)).reduce((s, r) => s + r.usd, 0);
}

export interface BudgetCheck {
  ok: boolean;
  reason?: string;
  current: { run: number; day: number; month: number };
  limits: { run: number; day: number; month: number };
}

export function checkBudget(opts: { runId?: string; estimatedUsd?: number } = {}): BudgetCheck {
  const est = opts.estimatedUsd ?? 0;
  const runUsed = opts.runId ? totalForRun(opts.runId) : 0;
  const dayUsed = totalForDay();
  const monthUsed = totalForMonth();
  const limits = { run: DEFAULT_PER_RUN, day: DEFAULT_DAILY, month: DEFAULT_MONTHLY };
  const current = { run: runUsed, day: dayUsed, month: monthUsed };

  if (opts.runId && runUsed + est > limits.run) {
    return { ok: false, reason: `Run budget excedido: $${(runUsed + est).toFixed(2)} > $${limits.run}`, current, limits };
  }
  if (dayUsed + est > limits.day) {
    return { ok: false, reason: `Daily budget excedido: $${(dayUsed + est).toFixed(2)} > $${limits.day}`, current, limits };
  }
  if (monthUsed + est > limits.month) {
    return { ok: false, reason: `Monthly budget excedido: $${(monthUsed + est).toFixed(2)} > $${limits.month}`, current, limits };
  }
  return { ok: true, current, limits };
}

export function assertBudget(opts: { runId?: string; estimatedUsd?: number } = {}): void {
  const check = checkBudget(opts);
  if (!check.ok) throw new Error(`BUDGET GUARD: ${check.reason}`);
}
