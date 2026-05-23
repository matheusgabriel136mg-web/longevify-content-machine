// scripts/agents/queue.mjs — Queue manager
//
// Read/write runs/_queue.json. Source of truth do que vai ser publicado.
//
// Shape de cada item:
// {
//   "id": "2026-05-24-001-manifesto-jockey",
//   "slot": "2026-05-25T19:00-03:00",
//   "format": "carousel",  // carousel | reel | single | story
//   "type": "manifesto",   // brand-manifesto | persona-bio | biomarker-stat | reel-tips | etc
//   "brief": "Manifesto Longevify ancorado na cover Jockey GPT-generated",
//   "status": "draft" | "rendering" | "critic_review" | "ready" | "scheduled" | "published" | "blocked",
//   "blocked_reason": "esperando capa GPT em ~/Downloads",
//   "external_assets": ["cover.png"],  // arquivos que dependem de input externo
//   "created_at": "...",
//   "updated_at": "..."
// }

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..", "..");
const QUEUE_PATH = path.join(ROOT, "runs", "_queue.json");

export function readQueue() {
  if (!fs.existsSync(QUEUE_PATH)) return { items: [], updated_at: null };
  return JSON.parse(fs.readFileSync(QUEUE_PATH, "utf-8"));
}

export function writeQueue(q) {
  q.updated_at = new Date().toISOString();
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(q, null, 2));
}

export function upsertItem(item) {
  const q = readQueue();
  const idx = q.items.findIndex(i => i.id === item.id);
  const now = new Date().toISOString();
  if (idx === -1) {
    q.items.push({ ...item, created_at: now, updated_at: now });
  } else {
    q.items[idx] = { ...q.items[idx], ...item, updated_at: now };
  }
  writeQueue(q);
  return item.id;
}

export function getItem(id) {
  return readQueue().items.find(i => i.id === id);
}

export function nextUnfinished() {
  const q = readQueue();
  // Prioriza por slot (mais próximo primeiro) e status não-terminal
  const open = q.items
    .filter(i => !["published", "blocked"].includes(i.status))
    .sort((a, b) => new Date(a.slot) - new Date(b.slot));
  return open[0];
}

export function pendingExternalAssets() {
  const q = readQueue();
  const blocked = [];
  for (const it of q.items) {
    if (it.status === "blocked" && it.external_assets) {
      for (const asset of it.external_assets) {
        const target = path.join(ROOT, "runs", it.id, "assets", asset);
        if (!fs.existsSync(target)) blocked.push({ item: it.id, expects: asset, target });
      }
    }
  }
  return blocked;
}

export function markStatus(id, status, extra = {}) {
  const q = readQueue();
  const it = q.items.find(i => i.id === id);
  if (!it) throw new Error(`Item ${id} não está na queue`);
  it.status = status;
  it.updated_at = new Date().toISOString();
  Object.assign(it, extra);
  writeQueue(q);
}

// CLI: node queue.mjs list | next | status <id> <new_status>
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (cmd === "list") {
    const q = readQueue();
    console.log(`📋 Queue (${q.items.length} items, atualizada ${q.updated_at ?? "—"})\n`);
    for (const it of q.items) {
      console.log(`  ${it.status.padEnd(14)}  ${it.id.padEnd(48)}  slot ${it.slot ?? "—"}`);
    }
  } else if (cmd === "next") {
    const n = nextUnfinished();
    console.log(n ? JSON.stringify(n, null, 2) : "queue vazia");
  } else if (cmd === "status") {
    markStatus(args[1], args[2]);
    console.log(`✓ ${args[1]} → ${args[2]}`);
  } else if (cmd === "pending-assets") {
    console.log(JSON.stringify(pendingExternalAssets(), null, 2));
  } else {
    console.log("Usage: queue.mjs list | next | status <id> <status> | pending-assets");
  }
}
