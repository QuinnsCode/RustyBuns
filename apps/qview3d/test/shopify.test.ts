// A Shopify store installs QView3D against a fake Shopify: one click sends the merchant to approve, Shopify sends
// them back, the shop connects the store with the claim it landed with, picks a product, the theme's block learns
// what to show, an order with a design gets its print links written onto the Shopify order, and an uninstall lets go.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hex, hmacHex } from "@rustybuns/util/bytes";
import { OrderReply, Shop, ShopifyBlock, ShopifyState, SignReply } from "../src/api.ts";
import { DEMO_ADMIN, local } from "../src/local.ts";

setDefaultTimeout(20_000);

const SHOP = "fern-hats.myshopify.com", KEY = "client-id", SECRET = "client-secret", TOKEN = "shpat_fake-store-token";
const dir = mkdtempSync(join(tmpdir(), "qview3d-shopify-"));
const notes: { id: string; note: string; metafields: { key: string; value: string }[] }[] = [];
// The fake Shopify: it trades the code for a token, lists the store's products, and takes an order's note.
const shopify = Bun.serve({
  port: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    const body = (await req.json()) as { code?: string; client_secret?: string; query?: string; variables?: { input: (typeof notes)[number] } };
    if (path === "/admin/oauth/access_token") return body.code === "the-code" && body.client_secret === SECRET ? Response.json({ access_token: TOKEN, scope: "read_products,read_orders,write_orders" }) : new Response("no", { status: 400 });
    if (req.headers.get("x-shopify-access-token") !== TOKEN) return new Response("no", { status: 401 });
    if (body.query?.includes("orderUpdate")) { notes.push(body.variables!.input); return Response.json({ data: { orderUpdate: { userErrors: [] } } }); }
    return Response.json({ data: { shop: { primaryDomain: { url: "https://fernhats.com" } }, products: { nodes: [{ handle: "the-field-cap", title: "The Field Cap" }, { handle: "gift-card", title: "Gift card" }] } } });
  },
});
let app: Awaited<ReturnType<typeof local>>;
beforeAll(async () => { app = await local({ dir, env: { SHOPIFY_API_KEY: KEY, SHOPIFY_API_SECRET: SECRET, SHOPIFY_API_BASE: shopify.url.origin } }); });
afterAll(() => { app.stop(); shopify.stop(true); rmSync(dir, { recursive: true, force: true }); });

const admin = { authorization: `Bearer ${DEMO_ADMIN}` };
const call = (path: string, method: string, body?: unknown, h: Record<string, string> = admin) =>
  fetch(`${app.url}${path}`, { method, redirect: "manual", headers: { "content-type": "application/json", ...h }, body: body === undefined ? undefined : JSON.stringify(body) });
async function upload(kind: string, type: string, bytes: Uint8Array<ArrayBuffer>) {
  const s = SignReply(await (await call("/api/orgs/demo/uploads", "POST", { kind, type, size: bytes.length, sha256: hex(await crypto.subtle.digest("SHA-256", bytes)) })).json());
  if (!s.exists) expect((await fetch(s.put!.url, { method: "PUT", headers: s.put!.headers, body: bytes })).status).toBe(201);
  return s.key;
}
/** A webhook as Shopify sends it: the raw body's HMAC, base64, under the app's secret. */
async function webhook(topic: string, body: unknown, secret = SECRET) {
  const raw = JSON.stringify(body);
  const sig = Buffer.from(await hmacHex(secret, raw), "hex").toString("base64");
  return fetch(`${app.url}/shopify/webhooks`, { method: "POST", body: raw, headers: { "x-shopify-topic": topic, "x-shopify-shop-domain": SHOP, "x-shopify-hmac-sha256": sig } });
}

test("a store installs, connects to its shop, picks a product, and an order's print links land on the Shopify order", async () => {
  // One click: Shopify's App URL sends the merchant to the store to approve.
  expect((await call("/shopify/install?shop=evil.example", "GET", undefined, {})).status).toBe(400);
  const start = await call(`/shopify/install?shop=${SHOP}`, "GET", undefined, {});
  expect(start.status).toBe(302);
  const approve = new URL(start.headers.get("location")!);
  expect(`${approve.origin}${approve.pathname}`).toBe(`${shopify.url.origin}/admin/oauth/authorize`);
  expect(approve.searchParams.get("client_id")).toBe(KEY);
  expect(approve.searchParams.get("redirect_uri")).toBe(`${app.url}/shopify/callback`);
  const cookie = start.headers.get("set-cookie")!.split(";")[0]!;

  // Shopify sends them back, signed. A link someone else made, or one opened in another browser, is refused.
  const back = async (secret: string) => {
    const q = new URLSearchParams({ code: "the-code", shop: SHOP, state: approve.searchParams.get("state")!, timestamp: "1790000000" });
    q.sort();
    return `/shopify/callback?${q}&hmac=${await hmacHex(secret, [...q].map(([k, v]) => `${k}=${v}`).join("&"))}`;
  };
  expect((await call(await back("not-the-secret"), "GET", undefined, { cookie })).status).toBe(400);
  expect((await call(await back(SECRET), "GET", undefined, {})).status).toBe(400);
  const landed = await call(await back(SECRET), "GET", undefined, { cookie });
  expect(landed.status).toBe(302);
  const page = new URL(landed.headers.get("location")!);
  expect(page.pathname).toBe("/orgs.html");
  const claim = new URLSearchParams(page.hash.slice(1)).get("shopify")!;

  // The shop, signed in (here: its key), connects the store. Its storefront may now embed the org; the token is never shown.
  expect((await call("/api/orgs/demo/shopify", "POST", { claim }, {})).status).toBe(401);
  expect((await call("/api/orgs/demo/shopify", "POST", { claim: `${claim}x` })).status).toBe(400);
  const linked = await call("/api/orgs/demo/shopify", "POST", { claim });
  expect(ShopifyState(await linked.json())).toEqual({ shop: SHOP, products: [{ handle: "the-field-cap", title: "The Field Cap" }, { handle: "gift-card", title: "Gift card" }] });
  const seen = await (await call("/api/orgs/demo", "GET")).text();
  expect(seen).not.toContain(TOKEN);
  expect(Shop(JSON.parse(seen))).toMatchObject({ shopify: SHOP, origins: expect.arrayContaining([`https://${SHOP}`, "https://fernhats.com"]) });

  // Product sync: the cap shows the customiser, the gift card doesn't. The theme's block asks from any page.
  expect((await call("/api/orgs/demo/shopify/products", "PUT", { picks: [{ handle: "the-field-cap", product: "no-such-product" }] })).status).toBe(400);
  const picked = ShopifyState(await (await call("/api/orgs/demo/shopify/products", "PUT", { picks: [{ handle: "the-field-cap", product: "field-cap" }] })).json());
  expect(picked.products[0]).toEqual({ handle: "the-field-cap", title: "The Field Cap", product: "field-cap" });
  const block = (handle: string) => fetch(`${app.url}/api/shopify/block?shop=${SHOP}&handle=${handle}`, { headers: { origin: "https://fernhats.com" } });
  expect(ShopifyBlock(await (await block("the-field-cap")).json())).toEqual({ org: "demo", product: "field-cap" });
  expect((await block("gift-card")).status).toBe(404);

  // A shopper saves a cap and buys two, with a plain gift card beside it. Shopify's orders/create arrives, signed.
  const layer = { texture: await upload("texture", "image/webp", new Uint8Array([7, 7])), original: await upload("original", "image/png", new Uint8Array([137, 80, 78, 71, 9])), u: 0.5, v: 0.5, scale: 0.6, rotation: 0 };
  const saved = await call("/api/orgs/demo/designs", "POST", { v: 1, model: "cap", color: "#1f2937", product: "field-cap", layers: [layer], camera: { azimuth: 0, polar: 1.2, distance: 5 } }, { origin: "https://fernhats.com" });
  const { id: design } = (await saved.json()) as { id: string };
  const order = { id: 5001, admin_graphql_api_id: "gid://shopify/Order/5001", note: "Gift wrap please", line_items: [{ quantity: 2, properties: [{ name: "Design", value: design }, { name: "Design link", value: "https://x" }] }, { quantity: 1, properties: [] }] };
  expect((await webhook("orders/create", order, "not-the-secret")).status).toBe(401);
  expect(notes).toHaveLength(0);
  expect((await webhook("orders/create", order)).status).toBe(200);
  expect(notes).toHaveLength(1);
  expect(notes[0]!.id).toBe("gid://shopify/Order/5001");
  expect(notes[0]!.note).toStartWith("Gift wrap please\n\nQView3D print files:");
  expect(notes[0]!.note).toContain(`2 x ${app.url}/admin.html#design=${design} (front)`);
  expect(JSON.parse(notes[0]!.metafields[0]!.value)).toMatchObject([{ design, qty: 2, zones: ["front"] }]);

  // Shopify sends it again: one note. The same order through the generic route is the one recorded.
  expect((await webhook("orders/create", order)).status).toBe(200);
  expect(notes).toHaveLength(1);
  expect(OrderReply(await (await call("/api/orgs/demo/orders", "POST", { id: "5001", lines: [{ design }] })).json())).toMatchObject({ fresh: false, lines: [{ design, qty: 2 }] });

  // The privacy webhooks answer; a customer's redact removes their order here. Then the store uninstalls.
  expect((await webhook("customers/data_request", { shop_domain: SHOP })).status).toBe(200);
  expect((await webhook("customers/redact", { orders_to_redact: [5001] })).status).toBe(200);
  expect(OrderReply(await (await call("/api/orgs/demo/orders", "POST", { id: "5001", lines: [{ design }] })).json()).fresh).toBe(true);
  expect((await webhook("app/uninstalled", { id: 1 })).status).toBe(200);
  expect((await block("the-field-cap")).status).toBe(404);
  expect((await call("/api/orgs/demo/shopify", "GET")).status).toBe(404);
  expect(Shop(await (await call("/api/orgs/demo", "GET")).json()).shopify).toBeUndefined();
  expect((await webhook("shop/redact", { shop_domain: SHOP })).status).toBe(200);
});
