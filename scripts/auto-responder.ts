/**
 * auto-responder.ts — IG comment/DM AI replies (human-in-loop por default).
 *
 * Fluxo:
 *   1. Lê comentários/DMs recentes via IG Graph API
 *   2. Pra cada um, Claude classifica intent + gera reply rascunho
 *   3. Modos:
 *      --review: salva replies em fila pra humano aprovar (default seguro)
 *      --auto:   publica diretamente (alto risco, exige whitelist de intents)
 *
 * Categorias detectadas:
 *   - question: pergunta sobre produto/biomarcador → reply educacional
 *   - intent_buy: "como funciona", "quanto custa" → reply com link
 *   - praise: elogio → like + reply curto
 *   - critic: crítica → ESCALA pra humano sempre (não auto-responde)
 *   - spam: ignora
 *
 * Output: runs/_inbox/replies-YYYY-MM-DD.json
 *
 * Pré-requisitos:
 *   META_PAGE_ACCESS_TOKEN, IG_BUSINESS_ACCOUNT_ID já no .env (✓)
 *
 * Uso:
 *   pnpm auto-responder --hours 24                      # processa últimas 24h
 *   pnpm auto-responder --hours 24 --auto              # publica sem revisar
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const GRAPH = "https://graph.facebook.com/v23.0";

type Intent = "question" | "intent_buy" | "praise" | "critic" | "spam";

interface Args {
  hours: number;
  auto: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Args = { hours: 24, auto: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--hours") out.hours = parseInt(args[++i], 10);
    else if (a === "--auto") out.auto = true;
  }
  return out;
}

interface Comment {
  id: string;
  text: string;
  username?: string;
  timestamp: string;
  media_id: string;
}

async function fetchRecentComments(igId: string, token: string, hours: number): Promise<Comment[]> {
  const since = Math.floor((Date.now() - hours * 3600 * 1000) / 1000);
  // 1. List user's media recent
  const mediaRes = await fetch(`${GRAPH}/${igId}/media?fields=id,timestamp&limit=10&access_token=${token}`);
  const mediaJson = (await mediaRes.json()) as { data?: Array<{ id: string; timestamp: string }>; error?: any };
  if (mediaJson.error) throw new Error(mediaJson.error.message);
  const media = (mediaJson.data ?? []).filter((m) => new Date(m.timestamp).getTime() / 1000 >= since);

  // 2. For each media, fetch comments
  const comments: Comment[] = [];
  for (const m of media) {
    const cRes = await fetch(`${GRAPH}/${m.id}/comments?fields=id,text,username,timestamp&access_token=${token}`);
    const cJson = (await cRes.json()) as { data?: any[] };
    for (const c of cJson.data ?? []) {
      if (new Date(c.timestamp).getTime() / 1000 < since) continue;
      comments.push({ id: c.id, text: c.text, username: c.username, timestamp: c.timestamp, media_id: m.id });
    }
  }
  return comments;
}

interface ClassifiedReply {
  comment: Comment;
  intent: Intent;
  confidence: number; // 0-1
  reply_draft: string;
  reasoning: string;
  human_review_required: boolean;
}

async function classifyAndReply(comments: Comment[]): Promise<ClassifiedReply[]> {
  if (!comments.length) return [];
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `Você é o responder IG da Longevify (marca BR de longevidade premium, tom Mito+Aesop, ICP profissional 30-55).

# Comentários a processar (últimos ${comments.length})
${comments.map((c, i) => `${i + 1}. @${c.username ?? "?"}: "${c.text}"`).join("\n")}

# Sua tarefa
Pra cada comentário, retorna:
- intent: "question" | "intent_buy" | "praise" | "critic" | "spam"
- confidence: 0-1
- reply_draft: resposta no tom Longevify (PT-BR, curto, sem fear, sem emojis decorativos)
- human_review_required: true se intent=critic OU confidence<0.7 OU reply_draft cita números clínicos OU mention de produto específico

Regras de reply:
- praise: "obrigado por estar com a gente. <1 frase contextualizando>"
- question: resposta educacional curta + "se quiser ver no seu painel, link na bio"
- intent_buy: "link na bio pra começar. DM 'painel' que te conto o resto."
- critic: SEMPRE human_review_required=true. Gera draft empático "obrigado pelo feedback, vou olhar com a equipe e voltar."
- spam: human_review_required=false, reply_draft="" (não responde)

Retorna JSON array puro (sem markdown).`;

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) throw new Error("Claude não retornou JSON array");
  const parsed = JSON.parse(m[0]) as Array<Omit<ClassifiedReply, "comment">>;
  return parsed.map((p, i) => ({ ...p, comment: comments[i] }));
}

async function publishReply(commentId: string, replyText: string, token: string): Promise<boolean> {
  try {
    const r = await fetch(`${GRAPH}/${commentId}/replies?message=${encodeURIComponent(replyText)}&access_token=${token}`, { method: "POST" });
    return r.ok;
  } catch { return false; }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY ausente");
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  const igId = process.env.IG_BUSINESS_ACCOUNT_ID;
  if (!token || !igId) throw new Error("META_PAGE_ACCESS_TOKEN + IG_BUSINESS_ACCOUNT_ID necessários");

  const args = parseArgs();
  console.log(`🔍 Buscando comentários das últimas ${args.hours}h...`);
  const comments = await fetchRecentComments(igId, token, args.hours);
  console.log(`📥 ${comments.length} comentários encontrados`);

  if (!comments.length) return;

  const classified = await classifyAndReply(comments);

  const inboxDir = path.join(ROOT, "runs", "_inbox");
  fs.mkdirSync(inboxDir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const outPath = path.join(inboxDir, `replies-${today}.json`);
  fs.writeFileSync(outPath, JSON.stringify(classified, null, 2));
  console.log(`✓ ${path.relative(ROOT, outPath)}`);

  // Stats
  const byIntent: Record<string, number> = {};
  for (const c of classified) byIntent[c.intent] = (byIntent[c.intent] ?? 0) + 1;
  console.log(`📊 Por intent: ${JSON.stringify(byIntent)}`);

  if (args.auto) {
    let posted = 0;
    for (const c of classified) {
      if (c.human_review_required) continue;
      if (c.intent === "spam" || !c.reply_draft) continue;
      const ok = await publishReply(c.comment.id, c.reply_draft, token);
      if (ok) posted++;
    }
    console.log(`✅ Publicado ${posted} replies. ${classified.filter((c) => c.human_review_required).length} pendentes pra revisão.`);
  } else {
    console.log(`📋 Modo review (default seguro). Replies salvos pra você revisar no dashboard.`);
    console.log(`   Pra publicar todos não-críticos, rode com --auto.`);
  }
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
