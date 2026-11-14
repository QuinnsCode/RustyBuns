// Stripe's webhook signature, both ways: `verifyStripe` for the Worker that takes Stripe's events, and
// `signStripe` for a test (or a local stand-in) that sends one. Stripe signs `t.body` with HMAC-SHA256 and sends
// `Stripe-Signature: t=<seconds>,v1=<hex>`; an event older than five minutes is refused, so a replay goes nowhere.
import { hex } from "./bytes.ts";

const enc = new TextEncoder();

async function hmac(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}

/** Whether `header` (Stripe-Signature) signs `body` with `secret`, within five minutes of `now`. */
export async function verifyStripe(body: string, header: string | null, secret: string, now = Date.now()): Promise<boolean> {
  const parts = Object.fromEntries((header ?? "").split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  const got = parts.v1;
  if (!got || !Number.isFinite(t) || Math.abs(now / 1000 - t) > 300) return false;
  const want = await hmac(secret, `${t}.${body}`);
  return want.length === got.length && [...want].reduce((d, c, i) => d | (c.charCodeAt(0) ^ got.charCodeAt(i)), 0) === 0;
}

/** The Stripe-Signature header Stripe would send with `body`. */
export async function signStripe(body: string, secret: string, now = Date.now()): Promise<string> {
  const t = Math.floor(now / 1000);
  return `t=${t},v1=${await hmac(secret, `${t}.${body}`)}`;
}
