// Cloudflare Email Sending off the edge: send() delivers nowhere. Each message lands as an .eml
// file in the data dir (open it in any mail client) and a line on stdout, so a sign-in link or a
// receipt the app mails is still there to read. Same sender check as the edge's
// allowed_sender_addresses.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EmailMessage } from "../shims.ts";

/** The Email Sending builder form: env.EMAIL.send({ from, to, subject, text, html }). */
export interface EmailBuilder {
  from: string | { email: string; name?: string };
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  headers?: Record<string, string>;
}

const addr = (a: string | { email: string; name?: string }) => typeof a === "string" ? a : a.email;
const list = (a: string | string[] | undefined) => a == null ? [] : Array.isArray(a) ? a : [a];

function compose(m: EmailBuilder): string {
  const from = typeof m.from === "string" ? m.from : m.from.name ? `${m.from.name} <${m.from.email}>` : m.from.email;
  const head: [string, string][] = [["From", from], ["To", list(m.to).join(", ")], ["Subject", m.subject], ["Date", new Date().toUTCString()], ["MIME-Version", "1.0"]];
  if (m.cc) head.push(["Cc", list(m.cc).join(", ")]);
  if (m.replyTo) head.push(["Reply-To", m.replyTo]);
  for (const [k, v] of Object.entries(m.headers ?? {})) head.push([k, v]);
  const lines = (h: [string, string][]) => h.map(([k, v]) => `${k}: ${v}`).join("\r\n");
  if (m.text != null && m.html != null) {
    const b = `rb-${crypto.randomUUID()}`;
    return `${lines([...head, ["Content-Type", `multipart/alternative; boundary="${b}"`]])}\r\n\r\n`
      + `--${b}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${m.text}\r\n`
      + `--${b}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${m.html}\r\n--${b}--\r\n`;
  }
  const type = m.html != null ? "text/html" : "text/plain";
  return `${lines([...head, ["Content-Type", `${type}; charset=utf-8`]])}\r\n\r\n${m.html ?? m.text ?? ""}\r\n`;
}

async function rawText(raw: EmailMessage["raw"]): Promise<string> {
  if (typeof raw === "string") return raw;
  return new Response(raw as BodyInit).text();
}

export class LocalSendEmail {
  constructor(readonly dir: string, readonly name = "EMAIL", readonly allowedSenderAddresses?: string[]) {}

  /** Writes the message to <dir>/<time>-<id>.eml and returns its id, as the edge returns a messageId. */
  async send(message: EmailMessage | EmailBuilder): Promise<{ messageId: string }> {
    const isRaw = message instanceof EmailMessage || "raw" in message;
    const from = isRaw ? (message as EmailMessage).from : addr((message as EmailBuilder).from);
    const to = isRaw ? [(message as EmailMessage).to] : [...list((message as EmailBuilder).to), ...list((message as EmailBuilder).cc), ...list((message as EmailBuilder).bcc)];
    if (this.allowedSenderAddresses?.length && !this.allowedSenderAddresses.includes(from))
      throw new Error(`${this.name}: ${from} isn't in allowed_sender_addresses`);
    const eml = isRaw ? await rawText((message as EmailMessage).raw) : compose(message as EmailBuilder);
    const messageId = crypto.randomUUID();
    mkdirSync(this.dir, { recursive: true });
    const file = join(this.dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${messageId.slice(0, 8)}.eml`);
    writeFileSync(file, eml);
    console.log(`[email] ${this.name}: ${from} -> ${to.join(", ")} (not sent; saved to ${file})`);
    return { messageId };
  }
}

export const sendEmail = (dir: string, name?: string, allowedSenderAddresses?: string[]) => new LocalSendEmail(dir, name, allowedSenderAddresses);
