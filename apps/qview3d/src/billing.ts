// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// Shops pay for samples, in packs. A spike: the packs and prices below are placeholders until #4515 says what a
// sample costs in Meshy credits, and Stripe is wired but switched off until its keys exist.
//
//   GET  /api/orgs/<org>/billing    an admin: samples paid for and used, the packs, the receipts
//   POST /api/orgs/<org>/checkout   an admin buys a pack: Stripe's hosted page, or the test provider pays at once
//   POST /api/stripe-webhook        Stripe says a Checkout session was paid: the org gets its receipt
//
// A paid pack is a receipt (orgs/<org>/receipts/<id>.json), and an org's allowance is the samples in its org.json
// (set by hand: a trial, a deal) plus every receipt's. Nothing is read, added to and written back, so two payments
// landing at once can't lose one, and the receipt's id comes from the payment's id, so Stripe retrying a webhook
// counts it once. Who takes the money: Stripe when STRIPE_SECRET_KEY is set, else the test provider when
// BILLING_TEST is "1" (local dev and tests: nothing is charged), else checkout answers 501.
import { hex, sha256 } from "@rustybuns/util/bytes";
import { check, obj, opt, str } from "@rustybuns/util/guard";
import { parseJson, privateJson, readJson } from "@rustybuns/util/http";
import { verifyStripe } from "@rustybuns/util/stripe";
import { Billing, CheckoutReply, CheckoutRequest, Receipt, type Org, type Pack } from "./api.ts";
import { ID, receiptKey } from "./layout.ts";
import type { Env } from "./worker.ts";

/** PLACEHOLDER prices, in US cents, until #4515 gives the credits a sample costs. Change them here and nowhere else. */
export const PACKS: readonly Pack[] = [
  { id: "5", samples: 5, cents: 2_500 },
  { id: "20", samples: 20, cents: 8_000 },
  { id: "50", samples: 50, cents: 17_500 },
];
const packOf = (id: string | undefined) => PACKS.find((p) => p.id === id);

export const providerOf = (env: Env) => (env.STRIPE_SECRET_KEY ? "stripe" : env.BILLING_TEST === "1" ? "test" : undefined);

/** The part of a Stripe event this reads; the rest is dropped. */
const StripeEvent = obj({
  type: str(100),
  data: obj({ object: obj({ id: str(200), payment_status: opt(str(40)), client_reference_id: opt(str(200)), metadata: opt(obj({ org: opt(str(63)), pack: opt(str(20)) })) }) }),
});
const StripeSession = obj({ url: str(2000) });

async function receipts(env: Env, org: string): Promise<Receipt[]> {
  const out: Receipt[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.BUCKET.list({ prefix: `orgs/${org}/receipts/`, cursor });
    for (const o of page.objects) {
      const body = await env.BUCKET.get(o.key);
      const r = body && check(Receipt, parseJson(await body.text()));
      if (r) out.push(r);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out.sort((a, b) => b.at - a.at);
}

/** The samples an org may make in all: its org.json's own, plus every pack it paid for. */
export async function allowanceOf(env: Env, org: string, settings: Org): Promise<number> {
  return (settings.samples ?? 0) + (await receipts(env, org)).reduce((n, r) => n + r.samples, 0);
}

/** Record a paid pack, once per payment (`ref`). */
export async function grant(env: Env, org: string, pack: Pack, provider: Receipt["provider"], ref: string): Promise<Receipt> {
  const id = (await sha256(`${provider}:${ref}`)).slice(0, 24);
  const key = receiptKey(org, id);
  const had = await env.BUCKET.get(key);
  const old = had && check(Receipt, parseJson(await had.text()));
  if (old) return old;
  const r: Receipt = { id, pack: pack.id, samples: pack.samples, cents: pack.cents, provider, ref, at: Date.now() };
  await env.BUCKET.put(key, JSON.stringify(r), { httpMetadata: { contentType: "application/json" } });
  return r;
}

/** GET: what the admin page shows above the sample form. */
export async function billingRoute(env: Env, org: string, settings: Org, used: number, h: Record<string, string>): Promise<Response> {
  const list = await receipts(env, org);
  const allowance = (settings.samples ?? 0) + list.reduce((n, r) => n + r.samples, 0);
  return privateJson({ allowance, used, provider: providerOf(env), packs: [...PACKS], receipts: list.slice(0, 500) } satisfies Billing, 200, h);
}

/** POST: buy a pack. The price comes from PACKS, never from the page. */
export async function checkoutRoute(req: Request, env: Env, org: string, url: URL, h: Record<string, string>): Promise<Response> {
  const fail = (why: string, status: number) => privateJson({ error: why }, status, h);
  const pack = packOf((await readJson(req, CheckoutRequest))?.pack);
  if (!pack) return fail(`expected {pack}: one of ${PACKS.map((p) => p.id).join(", ")}`, 400);
  const back = `${url.origin}/admin.html?org=${encodeURIComponent(org)}`;
  const provider = providerOf(env);
  if (provider === "test") {
    const r = await grant(env, org, pack, "test", hex(crypto.getRandomValues(new Uint8Array(12))));
    return privateJson({ url: `${back}&paid=${r.id}`, receipt: r.id } satisfies CheckoutReply, 200, h);
  }
  if (provider !== "stripe") return fail("buying samples is not switched on here yet; ask hello@qntbr.com for more", 501);
  const form = new URLSearchParams({
    mode: "payment",
    client_reference_id: org,
    "metadata[org]": org,
    "metadata[pack]": pack.id,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(pack.cents),
    "line_items[0][price_data][product_data][name]": `QView3D: ${pack.samples} samples`,
    success_url: `${back}&paid=1`,
    cancel_url: back,
  });
  const res = await fetch(`${env.STRIPE_API_BASE ?? "https://api.stripe.com"}/v1/checkout/sessions`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const session = res.ok ? await readJson(res, StripeSession) : null;
  return session ? privateJson({ url: session.url } satisfies CheckoutReply, 200, h) : fail("could not start the checkout", 502);
}

/** POST from Stripe: a paid Checkout session becomes a receipt. Anything else is acknowledged and dropped. */
export async function stripeWebhook(req: Request, env: Env): Promise<Response> {
  if (!env.STRIPE_WEBHOOK_SECRET) return privateJson({ error: "payments are not set up" }, 501);
  const body = await req.text();
  if (!(await verifyStripe(body, req.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET))) return privateJson({ error: "bad signature" }, 400);
  const s = check(StripeEvent, parseJson(body));
  const session = s?.type === "checkout.session.completed" && s.data.object.payment_status === "paid" ? s.data.object : null;
  const org = session?.metadata?.org, pack = packOf(session?.metadata?.pack);
  if (session && org && ID.test(org) && org === session.client_reference_id && pack) await grant(env, org, pack, "stripe", session.id);
  return privateJson({ received: true });
}
