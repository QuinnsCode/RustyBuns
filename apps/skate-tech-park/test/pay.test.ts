// The Stripe side: a purchase counts only from a correctly signed "paid" webhook, priced by the catalog and not the page.
import { expect, test } from "bun:test";
import { Purchases, handlePay, type PayEnv } from "../src/edge/pay.ts";

const SECRET = "whsec_test", UID = "player-abcdef12";

function env(): PayEnv & { stores: Map<string, Map<string, unknown>> } {
  const stores = new Map<string, Map<string, unknown>>();
  return {
    stores, STRIPE_SECRET_KEY: "sk_test", STRIPE_WEBHOOK_SECRET: SECRET,
    PURCHASES: {
      idFromName: (n) => n,
      get: (id) => {
        const m = stores.get(id as string) ?? new Map();
        stores.set(id as string, m);
        const p = new Purchases({ storage: { get: async (k) => m.get(k), put: async (k, v) => void m.set(k, v) } }, {});
        return { fetch: (r) => p.fetch(r) };
      },
    },
  };
}
async function sign(body: string, t = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`))), (b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${t},v1=${mac}`;
}
const call = async (e: PayEnv, path: string, init?: RequestInit) => (await handlePay(new Request("https://x" + path, init), e, new URL("https://x" + path)))!;
const paid = (item: string, status = "paid") => JSON.stringify({ type: "checkout.session.completed", data: { object: { payment_status: status, client_reference_id: UID, metadata: { item } } } });
const owned = async (e: PayEnv) => ((await (await call(e, `/api/owned?uid=${UID}`)).json()) as { owned: string[] }).owned;

test("a signed paid webhook unlocks the item; unsigned, stale, unpaid or unpriced ones do not", async () => {
  const e = env();
  const hook = async (body: string, sig: string | null) => (await call(e, "/api/stripe-webhook", { method: "POST", body, headers: sig ? { "Stripe-Signature": sig } : {} })).status;
  const good = paid("trucks:gold");
  expect(await hook(good, null)).toBe(400);
  expect(await hook(good, await sign(good + " "))).toBe(400);
  expect(await hook(good, await sign(good, Math.floor(Date.now() / 1000) - 3600))).toBe(400);
  expect(await owned(e)).toEqual([]);
  expect(await hook(paid("trucks:gold", "unpaid"), await sign(paid("trucks:gold", "unpaid")))).toBe(200);
  expect(await hook(paid("deck:sunset"), await sign(paid("deck:sunset")))).toBe(200); // free: nothing to record
  expect(await owned(e)).toEqual([]);
  expect(await hook(good, await sign(good))).toBe(200);
  expect(await owned(e)).toEqual(["trucks:gold"]);
});

test("checkout refuses free or unknown items and unset payments, and asks Stripe for the catalog price", async () => {
  const e = env();
  const post = (item: string, env: PayEnv = e) => call(env, "/api/checkout", { method: "POST", body: JSON.stringify({ uid: UID, item }) });
  expect((await post("deck:sunset")).status).toBe(400);
  expect((await post("nope:x")).status).toBe(400);
  expect((await post("trucks:gold", { ...e, STRIPE_SECRET_KEY: undefined })).status).toBe(501);
  const real = globalThis.fetch;
  let sent = "";
  globalThis.fetch = (async (_u: unknown, init: RequestInit) => ((sent = String(init.body)), Response.json({ url: "https://checkout.stripe.test/s" }))) as typeof fetch;
  try {
    const res = await post("trucks:gold");
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.test/s" });
    expect(new URLSearchParams(sent).get("line_items[0][price_data][unit_amount]")).toBe("99");
    expect(new URLSearchParams(sent).get("client_reference_id")).toBe(UID);
  } finally { globalThis.fetch = real; }
});
