// Real payments for the priced finishes, through Stripe Checkout (hosted page, so no card data touches us).
// The price comes from the CATALOG here, never from the page. A purchase is recorded only from Stripe's signed
// webhook, into a `Purchases` Durable Object per player id, so editing the browser's storage unlocks nothing.
import { hex } from "@rustybuns/util/bytes";
import { arr, check, obj, opt, str } from "@rustybuns/util/guard";
import { json, parseJson, readJson } from "@rustybuns/util/http";
import { CATALOG, type Part } from "../parts.ts";
import { CheckoutReply, OwnedReply, priceOf } from "../shop.ts";

export interface PayEnv {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  PURCHASES: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } };
}

export const UID = /^[A-Za-z0-9_-]{8,64}$/;
/** What the page sends to start a purchase. */
const CheckoutRequest = obj({ uid: str(64, { re: UID }), item: str(64) });
/** The part of a Stripe event this reads; the rest is dropped. */
const StripeEvent = obj({ type: str(), data: obj({ object: obj({ payment_status: opt(str()), client_reference_id: opt(str()), metadata: opt(obj({ item: opt(str()) })) }) }) });
/** What a `Purchases` object has stored: "part:id" keys, or nothing yet. */
const OwnedKeys = arr(str(64), 1000, { drop: true });

/** The item a "part:id" names when it is a real priced finish, else null. */
export function pricedItem(s: string): { part: Part; id: string; name: string; cents: number } | null {
  const [part, id] = s.split(":");
  const choice = (CATALOG[part as Part] as readonly { id: string; name: string }[] | undefined)?.find((c) => c.id === id);
  const cents = choice ? priceOf({ part: part as Part, id }) : 0;
  return choice && cents > 0 ? { part: part as Part, id, name: choice.name, cents } : null;
}

/** Stripe's `Stripe-Signature: t=...,v1=...` check: HMAC-SHA256 of `t.body`, within five minutes. */
export async function verifyStripe(body: string, header: string | null, secret: string, now = Date.now()): Promise<boolean> {
  const parts = Object.fromEntries((header ?? "").split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!parts.v1 || !Number.isFinite(t) || Math.abs(now / 1000 - t) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const want = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)));
  return want.length === parts.v1.length && want.split("").reduce((d, c, i) => d | (c.charCodeAt(0) ^ parts.v1.charCodeAt(i)), 0) === 0;
}

const wallet = (env: PayEnv, uid: string) => env.PURCHASES.get(env.PURCHASES.idFromName(uid));

export async function handlePay(req: Request, env: PayEnv, url: URL): Promise<Response | null> {
  if (url.pathname === "/api/owned" && req.method === "GET") {
    const uid = url.searchParams.get("uid") ?? "";
    return UID.test(uid) ? wallet(env, uid).fetch(new Request("https://wallet/")) : json({ error: "bad player id" }, 400);
  }
  if (url.pathname === "/api/checkout" && req.method === "POST") {
    if (!env.STRIPE_SECRET_KEY) return json({ error: "payments are not set up" }, 501);
    const order = await readJson(req, CheckoutRequest);
    const priced = order && pricedItem(order.item);
    if (!order || !priced) return json({ error: "bad item or player id" }, 400);
    const form = new URLSearchParams({
      mode: "payment",
      client_reference_id: order.uid,
      "metadata[item]": `${priced.part}:${priced.id}`,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(priced.cents),
      "line_items[0][price_data][product_data][name]": `Skate Tech Park ${priced.part}: ${priced.name}`,
      success_url: `${url.origin}/?paid=1`,
      cancel_url: `${url.origin}/`,
    });
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    const session = await readJson(res, CheckoutReply);
    return session ? json(session satisfies CheckoutReply) : json({ error: "could not start checkout" }, 502);
  }
  if (url.pathname === "/api/stripe-webhook" && req.method === "POST") {
    if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: "payments are not set up" }, 501);
    const body = await req.text();
    if (!(await verifyStripe(body, req.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET))) return json({ error: "bad signature" }, 400);
    const event = check(StripeEvent, parseJson(body));
    const s = event?.data.object, buyer = s?.client_reference_id, item = s?.metadata?.item;
    if (event?.type === "checkout.session.completed" && s?.payment_status === "paid" && buyer && UID.test(buyer) && item && pricedItem(item)) {
      await wallet(env, buyer).fetch(new Request("https://wallet/", { method: "POST", body: item }));
    }
    return json({ received: true });
  }
  return null;
}

/** One player's purchases. GET lists them, POST adds one ("part:id"). */
export class Purchases {
  constructor(private ctx: { storage: { get(k: string): Promise<unknown>; put(k: string, v: unknown): Promise<void> } }, _env: unknown) {}
  async fetch(req: Request): Promise<Response> {
    const owned = new Set(OwnedKeys(await this.ctx.storage.get("owned")));
    if (req.method === "POST") { owned.add(await req.text()); await this.ctx.storage.put("owned", [...owned]); }
    return json({ owned: [...owned] } satisfies OwnedReply);
  }
}
