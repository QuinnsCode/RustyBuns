// A shop that has used its samples buys a pack and makes another, through the running Worker: first on the test
// provider (local dev: nothing charged), then the Stripe way, against a stand-in Stripe, with signed webhooks.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hex, sha256 } from "@rustybuns/util/bytes";
import { signStripe } from "@rustybuns/util/stripe";
import { Billing, CheckoutReply } from "../src/api.ts";
import { PACKS } from "../src/billing.ts";
import { DEMO_ADMIN, local } from "../src/local.ts";

setDefaultTimeout(20_000);

const WHSEC = "whsec_test";
const dirs: string[] = [];
const apps: Awaited<ReturnType<typeof local>>[] = [];
let sent: URLSearchParams[] = [];
const stripe = Bun.serve({
  port: 0,
  async fetch(req) {
    sent.push(new URLSearchParams(await req.text()));
    return Response.json({ id: "cs_test_1", url: "https://checkout.stripe.test/c/cs_test_1" });
  },
});

async function start(env: Parameters<typeof local>[0]["env"] = {}) {
  const dir = mkdtempSync(join(tmpdir(), "qview3d-billing-"));
  dirs.push(dir);
  const app = await local({ dir, standInSeconds: 0.3, env });
  apps.push(app);
  // A shop with no samples left: none in its org.json, none bought.
  await app.bindings.BUCKET.put("orgs/shop/org.json", JSON.stringify({ origins: ["https://shop.test"], admins: [await sha256(DEMO_ADMIN)], samples: 0 }));
  return app;
}
let test1: Awaited<ReturnType<typeof local>>, live: Awaited<ReturnType<typeof local>>, off: Awaited<ReturnType<typeof local>>;
beforeAll(async () => {
  test1 = await start();
  live = await start({ STRIPE_SECRET_KEY: "sk_test", STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_API_BASE: stripe.url.origin });
  off = await start({ BILLING_TEST: undefined });
});
afterAll(() => {
  for (const a of apps) a.stop();
  stripe.stop(true);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const admin = { authorization: `Bearer ${DEMO_ADMIN}` };
const post = (app: { url: string }, path: string, body: unknown, headers: Record<string, string> = admin) =>
  fetch(`${app.url}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const billing = async (app: { url: string }) => Billing(await (await fetch(`${app.url}/api/orgs/shop/billing`, { headers: admin })).json());

async function photo(app: { url: string }) {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const sha = hex(await crypto.subtle.digest("SHA-256", bytes));
  const s = (await (await post(app, "/api/orgs/shop/uploads", { kind: "photo", type: "image/jpeg", size: bytes.length, sha256: sha })).json()) as { key: string; put: { url: string; headers: Record<string, string> } };
  await fetch(s.put.url, { method: "PUT", headers: s.put.headers, body: bytes });
  return s.key;
}
const sample = async (app: { url: string }) => (await post(app, "/api/orgs/shop/models", { name: "Tote", photos: [await photo(app)] })).status;

test("out of samples, a shop buys a pack and makes one", async () => {
  expect(await sample(test1)).toBe(402);
  expect(await billing(test1)).toMatchObject({ allowance: 0, used: 0, provider: "test", receipts: [] });

  const res = await post(test1, "/api/orgs/shop/checkout", { pack: "5" });
  expect(res.status).toBe(200);
  const c = CheckoutReply(await res.json());
  expect(c.url).toContain(`/admin.html?org=shop&paid=${c.receipt}`);

  expect(await sample(test1)).toBe(202);
  const b = await billing(test1);
  expect(b).toMatchObject({ allowance: 5, used: 1 });
  expect(b.receipts).toEqual([expect.objectContaining({ id: c.receipt, pack: "5", samples: 5, cents: PACKS[0]!.cents, provider: "test" })]);
});

test.each([
  ["without the admin key", { pack: "5" }, {}, 401],
  ["a pack not on sale", { pack: "500" }, admin, 400],
  ["a price from the page", { pack: "5", cents: 1 }, admin, 200],
])("checkout: %s", async (_, body, headers, status) => {
  const res = await post(test1, "/api/orgs/shop/checkout", body, headers);
  expect(res.status).toBe(status);
  if (status === 200) expect((await billing(test1)).receipts[0]!.cents).toBe(PACKS[0]!.cents);
});

test("with Stripe: checkout names our price, and only a signed paid webhook adds the pack, once", async () => {
  sent = [];
  const c = CheckoutReply(await (await post(live, "/api/orgs/shop/checkout", { pack: "20" })).json());
  expect(c).toEqual({ url: "https://checkout.stripe.test/c/cs_test_1" });
  const form = sent[0]!;
  expect(form.get("line_items[0][price_data][unit_amount]")).toBe(String(PACKS[1]!.cents));
  expect([form.get("client_reference_id"), form.get("metadata[org]"), form.get("metadata[pack]")]).toEqual(["shop", "shop", "20"]);
  expect(await billing(live)).toMatchObject({ allowance: 0, provider: "stripe" });

  const event = (status: string, org = "shop") =>
    JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_test_1", payment_status: status, client_reference_id: org, metadata: { org, pack: "20" } } } });
  const hook = async (body: string, sig: string | null) =>
    (await fetch(`${live.url}/api/stripe-webhook`, { method: "POST", body, headers: sig ? { "stripe-signature": sig } : {} })).status;

  const paid = event("paid");
  expect(await hook(paid, null)).toBe(400);
  expect(await hook(paid, await signStripe(paid, "whsec_wrong"))).toBe(400);
  expect(await hook(paid, await signStripe(paid, WHSEC, Date.now() - 3_600_000))).toBe(400);
  expect(await hook(event("unpaid"), await signStripe(event("unpaid"), WHSEC))).toBe(200);
  expect((await billing(live)).allowance).toBe(0);

  expect(await hook(paid, await signStripe(paid, WHSEC))).toBe(200);
  expect(await hook(paid, await signStripe(paid, WHSEC))).toBe(200); // Stripe retries: still one pack
  const b = await billing(live);
  expect(b.allowance).toBe(20);
  expect(b.receipts).toEqual([expect.objectContaining({ samples: 20, provider: "stripe", ref: "cs_test_1" })]);
  expect(await sample(live)).toBe(202);
});

test("with no provider, buying is off and the page is told", async () => {
  expect((await billing(off)).provider).toBeUndefined();
  expect((await post(off, "/api/orgs/shop/checkout", { pack: "5" })).status).toBe(501);
  expect((await fetch(`${off.url}/api/stripe-webhook`, { method: "POST", body: "{}" })).status).toBe(501);
});
