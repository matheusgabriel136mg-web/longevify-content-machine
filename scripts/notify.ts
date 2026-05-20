/**
 * notify.ts — Multi-channel notification (macOS, email, Slack opcionais)
 *
 * Usado pelo pipeline + cron jobs pra avisar quando algo está pronto/falhou.
 *
 * Canais (configurados via .env):
 *   - macOS notification (sempre, se rodando em darwin)
 *   - Email SMTP (se SMTP_HOST + SMTP_USER + SMTP_PASS + NOTIFY_EMAIL_TO definidos)
 *   - Slack webhook (se SLACK_WEBHOOK_URL definido)
 *
 * Sempre escreve em logs/notifications.log
 *
 * Uso CLI:
 *   pnpm notify --title "Pipeline pronto" --message "como-funciona ready"
 *   pnpm notify --title X --message Y --level info|success|warn|error
 *
 * Uso programático (import):
 *   import { notify } from "./notify";
 *   await notify({ title, message, level: "success" });
 */

import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

export type NotifyLevel = "info" | "success" | "warn" | "error";

export interface NotifyArgs {
  title: string;
  message: string;
  level?: NotifyLevel;
  url?: string;
}

const ICONS: Record<NotifyLevel, string> = {
  info: "💬",
  success: "✅",
  warn: "⚠️",
  error: "❌",
};

const SOUNDS: Record<NotifyLevel, string> = {
  info: "Tink",
  success: "Glass",
  warn: "Funk",
  error: "Basso",
};

function macNotify(args: NotifyArgs): void {
  if (process.platform !== "darwin") return;
  const escapedTitle = args.title.replace(/"/g, '\\"');
  const escapedMsg = args.message.replace(/"/g, '\\"');
  const sound = SOUNDS[args.level ?? "info"];
  spawn("osascript", ["-e", `display notification "${escapedMsg}" with title "${escapedTitle}" sound name "${sound}"`], { stdio: "ignore" }).unref();
}

async function emailNotify(args: NotifyArgs): Promise<void> {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const to = process.env.NOTIFY_EMAIL_TO;
  if (!host || !user || !pass || !to) return;

  let nodemailer;
  try {
    nodemailer = await import("nodemailer");
  } catch {
    // nodemailer não instalado — silencioso (opcional)
    return;
  }
  const transport = nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT ?? "587", 10),
    secure: false,
    auth: { user, pass },
  });
  const icon = ICONS[args.level ?? "info"];
  await transport.sendMail({
    from: user,
    to,
    subject: `${icon} ${args.title}`,
    text: `${args.message}${args.url ? "\n\n" + args.url : ""}`,
  });
}

async function slackNotify(args: NotifyArgs): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  const icon = ICONS[args.level ?? "info"];
  const text = `${icon} *${args.title}*\n${args.message}${args.url ? "\n<" + args.url + ">" : ""}`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {
    // silencioso
  }
}

function appendLog(args: NotifyArgs): void {
  const logDir = path.join(ROOT, "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, "notifications.log");
  const line = `${new Date().toISOString()}\t${args.level ?? "info"}\t${args.title}\t${args.message}${args.url ? "\t" + args.url : ""}\n`;
  fs.appendFileSync(logPath, line);
}

export async function notify(args: NotifyArgs): Promise<void> {
  appendLog(args);
  macNotify(args);
  await Promise.all([emailNotify(args), slackNotify(args)]);
}

// CLI entrypoint
async function cli() {
  const argv = process.argv.slice(2);
  const out: Partial<NotifyArgs> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--title") out.title = argv[++i];
    else if (a === "--message") out.message = argv[++i];
    else if (a === "--level") out.level = argv[++i] as NotifyLevel;
    else if (a === "--url") out.url = argv[++i];
  }
  if (!out.title || !out.message) {
    console.error("Usage: pnpm notify --title X --message Y [--level info|success|warn|error] [--url URL]");
    process.exit(1);
  }
  await notify(out as NotifyArgs);
  console.log("✅ notification sent");
}

// Só roda CLI se invocado diretamente
const invoked = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invoked) cli().catch((e) => { console.error("❌", e); process.exit(1); });
