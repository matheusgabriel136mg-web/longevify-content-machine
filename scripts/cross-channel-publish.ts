/**
 * cross-channel-publish.ts — Adapta caption por canal e publica em LinkedIn + X.
 *
 * MVP: chama Claude pra reescrever caption pra cada canal, publica via APIs.
 * Estado atual:
 *   - LinkedIn: SKELETON (precisa LINKEDIN_ACCESS_TOKEN + ORG_URN)
 *   - X (Twitter): SKELETON (precisa X_BEARER_TOKEN + thread support)
 *   - Substack: TODO
 *
 * Pré-requisitos (.env):
 *   LINKEDIN_ACCESS_TOKEN=...
 *   LINKEDIN_ORG_URN=urn:li:organization:...
 *   X_BEARER_TOKEN=...
 *   X_API_KEY=... X_API_SECRET=...
 *
 * Uso:
 *   pnpm cross-channel --run <id> --channels linkedin,x
 *   pnpm cross-channel --run <id> --channels linkedin --dry-run
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

type Channel = "linkedin" | "x" | "substack";

interface Args {
  run: string;
  channels: Channel[];
  dryRun: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Partial<Args> = { dryRun: false, channels: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--run") out.run = args[++i];
    else if (a === "--channels") out.channels = args[++i].split(",") as Channel[];
    else if (a === "--dry-run") out.dryRun = true;
  }
  if (!out.run || !out.channels?.length) {
    console.error("Usage: pnpm cross-channel --run <id> --channels linkedin,x [--dry-run]");
    process.exit(1);
  }
  return out as Args;
}

function extractIGCaption(draft: string): string {
  const m = draft.match(/### Caption[^\n]*\n([\s\S]*?)(?=\n###|\n##|\n# )/);
  return m ? m[1].trim() : "";
}

async function adaptCaption(igCaption: string, channel: Channel): Promise<string> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const channelRules: Record<Channel, string> = {
    linkedin: "Tom mais formal-editorial. ~1200-1500 chars. Paragrafação aérea. Sem hashtags decorativos. CTA sutil.",
    x: "Thread de 4-7 tweets. Cada tweet máx 280 chars. Hook no primeiro tweet. Cada tweet tem 1 ideia. Threaded com (1/N).",
    substack: "Newsletter premium. 600-1000 palavras. Headline + 3-4 subsections. Tom editorial Mito+Aesop. Email-friendly markdown.",
  };
  const prompt = `Adapte a caption do Instagram abaixo pro canal **${channel}**.

# Caption IG original
${igCaption}

# Regras do canal ${channel}
${channelRules[channel]}

# Voice Longevify (manter)
Mito + Aesop. PT-BR. Sem fear, sem self-help, sem corporativês.

Retorne SÓ a caption adaptada (sem preamble, sem comentários).`;

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });
  return msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim();
}

async function publishLinkedIn(caption: string, _runDir: string, dryRun: boolean): Promise<{ ok: boolean; url?: string; error?: string }> {
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  const orgUrn = process.env.LINKEDIN_ORG_URN;
  if (!token || !orgUrn) return { ok: false, error: "LINKEDIN_ACCESS_TOKEN + LINKEDIN_ORG_URN faltando no .env" };
  if (dryRun) return { ok: true, url: "(dry-run) would post to LinkedIn" };

  // POST /v2/ugcPosts
  const body = {
    author: orgUrn,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text: caption },
        shareMediaCategory: "NONE",
      },
    },
    visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
  };
  try {
    const r = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Restli-Protocol-Version": "2.0.0" },
      body: JSON.stringify(body),
    });
    if (!r.ok) return { ok: false, error: `LinkedIn ${r.status}: ${await r.text()}` };
    const j = (await r.json()) as { id?: string };
    return { ok: true, url: j.id ? `https://www.linkedin.com/feed/update/${j.id}` : undefined };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function publishX(caption: string, dryRun: boolean): Promise<{ ok: boolean; url?: string; error?: string }> {
  const bearer = process.env.X_BEARER_TOKEN;
  if (!bearer) return { ok: false, error: "X_BEARER_TOKEN faltando no .env" };
  if (dryRun) return { ok: true, url: "(dry-run) would post thread to X" };

  // Split caption em tweets (delim por \n\n ou por chars limit)
  const tweets: string[] = caption.split(/\n\n+/).filter((t) => t.trim());
  // TODO: implementar thread real via POST /2/tweets em sequência com in_reply_to_tweet_id
  return { ok: false, error: `X thread publish não implementado (${tweets.length} tweets prontos pra encadear)` };
}

async function publishSubstack(_caption: string, _dryRun: boolean): Promise<{ ok: boolean; error?: string }> {
  return { ok: false, error: "Substack não tem API pública oficial. Usa /publish/posts via session cookie (frágil). TODO." };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY ausente");
  const args = parseArgs();
  const runDir = path.join(ROOT, "runs", args.run);
  if (!fs.existsSync(runDir)) throw new Error(`Run não existe: ${runDir}`);

  const draftPath = path.join(runDir, "draft-package.md");
  if (!fs.existsSync(draftPath)) throw new Error("draft-package.md não encontrado");
  const igCaption = extractIGCaption(fs.readFileSync(draftPath, "utf-8"));
  if (!igCaption) throw new Error("Caption IG não encontrada no draft");

  const log: any[] = [];

  for (const channel of args.channels) {
    console.log(`\n━━━ ${channel.toUpperCase()} ━━━`);
    const adapted = await adaptCaption(igCaption, channel);

    // Salva versão adaptada
    fs.writeFileSync(path.join(runDir, `caption-${channel}.md`), adapted);
    console.log(`✓ Caption adaptada salva: caption-${channel}.md (${adapted.length} chars)`);

    let result: any;
    if (channel === "linkedin") result = await publishLinkedIn(adapted, runDir, args.dryRun);
    else if (channel === "x") result = await publishX(adapted, args.dryRun);
    else if (channel === "substack") result = await publishSubstack(adapted, args.dryRun);

    if (result?.ok) console.log(`✅ ${channel}: ${result.url ?? "ok"}`);
    else console.log(`❌ ${channel}: ${result?.error}`);
    log.push({ channel, ...result });
  }

  fs.writeFileSync(path.join(runDir, "cross-channel-log.json"), JSON.stringify(log, null, 2));
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
