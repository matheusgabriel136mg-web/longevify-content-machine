/**
 * publish-guard.ts — Estratégia de publish enforced.
 *
 * Bloqueia publish que viola a estratégia:
 *   1. Cadência: cada slot da semana tem 1 format específico
 *   2. Frequência: zero publish nas últimas 20h em qualquer canal
 *   3. Horário: respeita slot ±2h da janela ideal (fora disso, sugere agendar)
 *
 * Strategy lida em brands/<id>.json publish.schedule_brt.
 *
 * Uso programático:
 *   import { checkPublishStrategy } from "./lib/publish-guard";
 *   const { ok, reason, suggestion } = checkPublishStrategy({ runId, format });
 *   if (!ok) throw new Error(reason);
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { brand } from "./brand-loader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");

type Format = "carousel" | "reel" | "post" | "image" | "story";
type DayKey = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

const DAY_KEYS: DayKey[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export interface StrategyCheck {
  ok: boolean;
  reason?: string;
  suggestion?: string;
  nextSlot?: { day: DayKey; time: string; format: string };
}

function currentBRT(): { day: DayKey; hour: number; iso: string } {
  // BRT = UTC-3
  const now = new Date();
  const brtMs = now.getTime() - 3 * 3600 * 1000;
  const brt = new Date(brtMs);
  const day = DAY_KEYS[brt.getUTCDay()];
  return { day, hour: brt.getUTCHours(), iso: brt.toISOString() };
}

function lastPublishHoursAgo(): number | null {
  const runsDir = path.join(ROOT, "runs");
  if (!fs.existsSync(runsDir)) return null;
  let latest = 0;
  for (const d of fs.readdirSync(runsDir)) {
    if (d.startsWith("_") || d.startsWith(".")) continue;
    const coPath = path.join(runsDir, d, "content-object.md");
    if (!fs.existsSync(coPath)) continue;
    const content = fs.readFileSync(coPath, "utf-8");
    if (!/^state:\s*published/m.test(content)) continue;
    const stat = fs.statSync(coPath);
    if (stat.mtimeMs > latest) latest = stat.mtimeMs;
  }
  if (!latest) return null;
  return (Date.now() - latest) / 3600000;
}

function formatMatchesSlot(format: Format, slot: { format: string }): boolean {
  const f = format.toLowerCase();
  const sf = slot.format.toLowerCase();
  if (f === sf) return true;
  // Single image OK pra slot "post"; carousel OK pra slot "carousel"; etc.
  if ((f === "image" || f === "post") && (sf === "post" || sf === "single" || sf === "image")) return true;
  return false;
}

function findNextMatchingSlot(format: Format): { day: DayKey; time: string; format: string } | null {
  const schedule = (brand.publish as any).schedule_brt ?? {};
  const cur = currentBRT();
  const curIdx = DAY_KEYS.indexOf(cur.day);
  for (let offset = 0; offset < 7; offset++) {
    const dayIdx = (curIdx + offset) % 7;
    const day = DAY_KEYS[dayIdx];
    const slot = schedule[day];
    if (!slot || !slot.time || slot.type === "stories_only") continue;
    if (formatMatchesSlot(format, slot)) {
      // Se é o dia de hoje, confere se ainda dá tempo
      if (offset === 0) {
        const [h] = slot.time.split(":").map(Number);
        if (cur.hour >= h + 2) continue; // passou da janela
      }
      return { day, time: slot.time, format: slot.format };
    }
  }
  return null;
}

export function checkPublishStrategy(opts: { format: Format; force?: boolean }): StrategyCheck {
  if (opts.force) return { ok: true };

  // 1. Frequência: zero publish nas últimas 20h
  const hoursAgo = lastPublishHoursAgo();
  if (hoursAgo !== null && hoursAgo < 20) {
    const nextSlot = findNextMatchingSlot(opts.format);
    return {
      ok: false,
      reason: `Já publicamos há ${hoursAgo.toFixed(1)}h. Algoritmo IG penaliza 2 posts <24h.`,
      suggestion: nextSlot
        ? `Agenda pra ${nextSlot.day} ${nextSlot.time} BRT (slot oficial pra ${nextSlot.format}).`
        : "Aguarde 24h mínimo desde último publish.",
      nextSlot: nextSlot ?? undefined,
    };
  }

  // 2. Cadência: hoje é dia de format X?
  const schedule = (brand.publish as any).schedule_brt ?? {};
  const cur = currentBRT();
  const todaySlot = schedule[cur.day];

  if (!todaySlot || !todaySlot.time || todaySlot.type === "stories_only") {
    const nextSlot = findNextMatchingSlot(opts.format);
    return {
      ok: false,
      reason: `${cur.day} não tem slot de feed na cadência (${todaySlot?.type ?? "off"}).`,
      suggestion: nextSlot ? `Agenda pra ${nextSlot.day} ${nextSlot.time} BRT.` : "Sem slot disponível.",
      nextSlot: nextSlot ?? undefined,
    };
  }

  if (!formatMatchesSlot(opts.format, todaySlot)) {
    const nextSlot = findNextMatchingSlot(opts.format);
    return {
      ok: false,
      reason: `Hoje (${cur.day}) é slot de ${todaySlot.format}, não ${opts.format}.`,
      suggestion: nextSlot ? `Agenda esse ${opts.format} pra ${nextSlot.day} ${nextSlot.time} BRT.` : `Use format=${todaySlot.format} hoje.`,
      nextSlot: nextSlot ?? undefined,
    };
  }

  // 3. Horário: ±2h da janela ideal
  const [slotHour] = todaySlot.time.split(":").map(Number);
  const diff = Math.abs(cur.hour - slotHour);
  if (diff > 2) {
    return {
      ok: false,
      reason: `Hora atual ${cur.hour}h BRT — slot ideal é ${todaySlot.time} BRT (±2h). Diff: ${diff}h.`,
      suggestion: cur.hour < slotHour
        ? `Espera até ${todaySlot.time} BRT pra publicar (melhor engajamento).`
        : `Publica amanhã. Hoje passou da janela do slot.`,
    };
  }

  return { ok: true };
}

export function summarizeSchedule(): string {
  const schedule = (brand.publish as any).schedule_brt ?? {};
  const L: string[] = [];
  L.push("📅 Cadência semanal (brand config):");
  for (const day of DAY_KEYS.slice(1).concat(["sunday"]) as DayKey[]) {
    const s = schedule[day];
    if (!s) { L.push(`  ${day}: (sem config)`); continue; }
    L.push(`  ${day.padEnd(10)} ${s.time?.padEnd(6) ?? "—".padEnd(6)} ${s.format ?? s.type}`);
  }
  return L.join("\n");
}
