// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// QView3D as a Shopify app: a store installs it with Shopify's own sign-in, and nothing is pasted. The app's own
// files for Shopify (its settings and the theme's app block) are in ../shopify/.
//
//   GET  /shopify?shop=<store>.myshopify.com           Shopify's "App URL" (/shopify/install too): sends the merchant to Shopify to approve
//   GET  /shopify/callback                             Shopify sends them back with a code (HMAC and state checked):
//                                                      the code becomes the store's token, sealed in D1, and they
//                                                      land on /orgs.html#shopify=<claim> to pick the shop it joins
//   POST /shopify/webhooks                             orders/create, app/uninstalled and the three privacy webhooks
//                                                      Shopify requires, each checked against X-Shopify-Hmac-Sha256
//   POST /api/orgs/<org>/shopify                       an admin connects the store the claim names (ShopifyLink -> ShopifyState)
//   GET  /api/orgs/<org>/shopify                       an admin: the store's products, and which show the customiser
//   PUT  /api/orgs/<org>/shopify/products              an admin picks them (ShopifyPicks -> ShopifyState)
//   GET  /api/shopify/block?shop=&handle=              the app block on a product page asks what to show (ShopifyBlock, or 404: nothing)
//
// eqosys stays the login: Shopify's sign-in proves who runs the store, the eqosys one who runs the org, and the
// connection is `shopify` on the org. The token never leaves this file. An order's lines carry the design id as the
// line item property "Design" (the block names the widget `properties[Design]`); orders/create hands them to the same
// takeOrder any store's POST .../orders uses (hooks.ts), then writes the print links onto the Shopify order.
import { b64url, hex, hmacHex, hmacSigned, unb64url } from "@rustybuns/util/bytes";
import { arr, check, int, num, obj, oneOf, opt, rec, str, type Guard, type Of } from "@rustybuns/util/guard";
import { parseJson, privateJson, json, readJson } from "@rustybuns/util/http";
import { ID } from "./layout.ts";
import { SHOP_DOMAIN, ShopifyLink, ShopifyPicks, type OrderLine, type OrderRequest, type ShopifyBlock, type ShopifyState } from "./api.ts";
import { later, seal, takeOrder, unseal, type Later } from "./hooks.ts";
import { runsShop, signedIn } from "./orgs.ts";
import { isAdmin } from "./samples.ts";
import { getOrg, getProduct, orgOfShopify, putOrg } from "./settings.ts";
import type { Env } from "./worker.ts";

/** Shopify's Admin API version these calls are written against. */
const API = "2026-10";
/** What the app asks a store for: its products (to pick from), and its orders (to read the design, and write the print links). */
export const SCOPES = "read_products,read_orders,write_orders";
/** The line item property the block puts the design id under. */
export const PROPERTY = "Design";
const STATE_S = 600, CLAIM_S = 3600;
const COOKIE = "qv_shopify";

const configured = (env: Env): env is Env & { SHOPIFY_API_KEY: string; SHOPIFY_API_SECRET: string; UPLOAD_SECRET: string } =>
  !!env.SHOPIFY_API_KEY && !!env.SHOPIFY_API_SECRET && !!env.UPLOAD_SECRET;
/** Where a store's admin answers: the store itself, or SHOPIFY_API_BASE (the tests' fake). */
const admin = (env: Env, shop: string) => env.SHOPIFY_API_BASE || `https://${shop}`;

// A short-lived note to ourselves, carried by the browser: the claim as base64url JSON, a dot, its HMAC.
const Ticket = obj({ use: oneOf(["state", "claim"] as const), shop: str(80, { re: SHOP_DOMAIN }), nonce: opt(str(64)), exp: num(0, 1e15) });
type Ticket = Of<typeof Ticket>;
const ticketKey = (env: Env) => `qview3d shopify|${env.UPLOAD_SECRET}`;
async function ticket(env: Env, t: Ticket) {
  const body = b64url(new TextEncoder().encode(JSON.stringify(t)));
  return `${body}.${await hmacHex(ticketKey(env), body)}`;
}
async function readTicket(env: Env, text: string | null, use: Ticket["use"]): Promise<Ticket | null> {
  const [body, sig] = (text ?? "").split(".");
  if (!body || !sig || !/^[0-9a-f]{64}$/.test(sig) || !(await hmacSigned(ticketKey(env), body, sig))) return null;
  let raw: string;
  try { raw = new TextDecoder().decode(unb64url(body)); } catch { return null; }
  const t = check(Ticket, parseJson(raw));
  return t && t.use === use && t.exp > Date.now() ? t : null;
}

/** Whether Shopify signed this link: `hmac` is the HMAC of every other parameter, sorted, under the app's secret. */
async function signedQuery(secret: string, q: URLSearchParams): Promise<boolean> {
  const sig = q.get("hmac") ?? "";
  const rest = [...q].filter(([k]) => k !== "hmac").sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("&");
  return /^[0-9a-f]{64}$/.test(sig) && hmacSigned(secret, rest, sig);
}

/** Whether Shopify signed this webhook: the header is the base64 HMAC of the raw body under the app's secret. */
export async function signedWebhook(secret: string, header: string | null, body: string): Promise<boolean> {
  let sig: string;
  try { sig = hex(Uint8Array.from(atob(header ?? ""), (c) => c.charCodeAt(0))); } catch { return false; }
  return sig.length === 64 && hmacSigned(secret, body, sig);
}

type ShopRow = { shop: string; token: string; scope: string; picks: string; installed: number };
const Picks = rec(str(63, { re: ID }), 250);
const shopRow = (env: Env, shop: string) => env.DB.prepare("SELECT shop, token, scope, picks, installed FROM shopify_shops WHERE shop = ?").bind(shop).first<ShopRow>();
const picksOf = (row: ShopRow) => check(Picks, parseJson(row.picks)) ?? {};

/** One Admin API GraphQL call as the store, its answer through `guard`; null when the token is gone or Shopify refuses. */
async function ask<T>(env: Env, row: ShopRow, guard: Guard<T>, query: string, variables: object = {}): Promise<T | null> {
  const token = await unseal(env, row.token);
  if (!token) return null;
  try {
    const res = await fetch(`${admin(env, row.shop)}/admin/api/${API}/graphql.json`, {
      method: "POST", signal: AbortSignal.timeout(10_000),
      headers: { "content-type": "application/json", "x-shopify-access-token": token },
      body: JSON.stringify({ query, variables }),
    });
    return res.ok ? await readJson(res, guard) : null;
  } catch { return null; }
}

// A store's first 250 products by title: plenty for a shop that customises a few. More than that waits for a search box.
const StoreReply = obj({ data: obj({
  shop: obj({ primaryDomain: obj({ url: str(300) }) }),
  products: obj({ nodes: arr(obj({ handle: str(255), title: str(255) }), 250) }),
}) });
const STORE = "{ shop { primaryDomain { url } } products(first: 250, sortKey: TITLE) { nodes { handle title } } }";
const NoteReply = obj({ data: obj({ orderUpdate: obj({ userErrors: arr(obj({ message: str(500) }), 20) }) }) });
const NOTE = "mutation($input: OrderInput!) { orderUpdate(input: $input) { userErrors { message } } }";

const TokenReply = obj({ access_token: str(300, { min: 1 }), scope: str(500) });
/** orders/create, the parts read: Shopify's id, its GraphQL id, the note so far, and each line's count and properties. */
const OrderHook = obj({
  id: int(1, Number.MAX_SAFE_INTEGER),
  admin_graphql_api_id: str(100),
  note: opt(str(5000)),
  line_items: arr(obj({ quantity: int(1, 10_000, 1), properties: opt(arr(obj({ name: str(255), value: str(1000) }), 100, { drop: true })) }), 250),
});
const Redact = obj({ orders_to_redact: opt(arr(int(1, Number.MAX_SAFE_INTEGER), 1000)) });

/** The routes above, or null when the request is none of them. */
export async function shopifyRoute(req: Request, env: Env, ctx: Later, h: Record<string, string>): Promise<Response | null> {
  const url = new URL(req.url);
  const fail = (why: string, status: number) => privateJson({ error: why }, status, h);
  const off = () => fail("the Shopify app is not set up (SHOPIFY_API_KEY, SHOPIFY_API_SECRET)", 503);

  if (url.pathname === "/api/shopify/block" && req.method === "GET") {
    const shop = url.searchParams.get("shop") ?? "", handle = url.searchParams.get("handle") ?? "";
    if (!SHOP_DOMAIN.test(shop) || !handle) return fail("expected ?shop=<store>.myshopify.com&handle=<product>", 400);
    const row = await env.DB.prepare("SELECT o.id AS org, s.picks FROM orgs o JOIN shopify_shops s ON s.shop = o.shopify WHERE o.shopify = ? AND (o.expires IS NULL OR o.expires > ?) ORDER BY o.updated DESC LIMIT 1")
      .bind(shop, Date.now()).first<{ org: string; picks: string }>();
    const product = row ? (check(Picks, parseJson(row.picks)) ?? {})[handle] : undefined;
    if (!row || !product) return fail("this product has no customiser", 404);
    return json({ org: row.org, product } satisfies ShopifyBlock, 200, { ...h, "access-control-allow-origin": "*", "cache-control": "public, max-age=60" });
  }

  if ((url.pathname === "/shopify" || url.pathname === "/shopify/install") && req.method === "GET") {
    if (!configured(env)) return off();
    const shop = url.searchParams.get("shop") ?? "";
    if (!SHOP_DOMAIN.test(shop)) return fail("expected ?shop=<store>.myshopify.com", 400);
    if (url.searchParams.has("hmac") && !(await signedQuery(env.SHOPIFY_API_SECRET, url.searchParams))) return fail("this link wasn't signed by Shopify", 400);
    const nonce = b64url(crypto.getRandomValues(new Uint8Array(18)));
    const q = new URLSearchParams({ client_id: env.SHOPIFY_API_KEY, scope: SCOPES, redirect_uri: `${url.origin}/shopify/callback`, state: await ticket(env, { use: "state", shop, nonce, exp: Date.now() + STATE_S * 1000 }) });
    // The nonce rides in a cookie too, so the approval comes back to the browser that asked for it.
    return new Response(null, { status: 302, headers: { location: `${admin(env, shop)}/admin/oauth/authorize?${q}`, "set-cookie": `${COOKIE}=${nonce}; Path=/shopify; Max-Age=${STATE_S}; HttpOnly; Secure; SameSite=Lax`, "cache-control": "no-store" } });
  }

  if (url.pathname === "/shopify/callback" && req.method === "GET") {
    if (!configured(env)) return off();
    const q = url.searchParams, shop = q.get("shop") ?? "", code = q.get("code") ?? "";
    if (!SHOP_DOMAIN.test(shop) || !code || !(await signedQuery(env.SHOPIFY_API_SECRET, q))) return fail("this link wasn't signed by Shopify", 400);
    const state = await readTicket(env, q.get("state"), "state");
    const cookie = (req.headers.get("cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))?.[1];
    if (!state || state.shop !== shop || !state.nonce || state.nonce !== cookie) return fail("this install link ran out, or began in another browser: install the app from Shopify again", 400);
    const res = await fetch(`${admin(env, shop)}/admin/oauth/access_token`, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ client_id: env.SHOPIFY_API_KEY, client_secret: env.SHOPIFY_API_SECRET, code }),
    }).catch(() => null);
    const got = res?.ok ? await readJson(res, TokenReply) : null;
    if (!got) return fail("Shopify didn't hand over the store's access: install the app from Shopify again", 502);
    // A store that installs again keeps its picks.
    await env.DB.prepare("INSERT INTO shopify_shops (shop, token, scope, installed) VALUES (?, ?, ?, ?) ON CONFLICT (shop) DO UPDATE SET token = excluded.token, scope = excluded.scope")
      .bind(shop, await seal(env, got.access_token), got.scope, Date.now()).run();
    const claim = await ticket(env, { use: "claim", shop, exp: Date.now() + CLAIM_S * 1000 });
    return new Response(null, { status: 302, headers: { location: `${url.origin}/orgs.html#shopify=${claim}`, "set-cookie": `${COOKIE}=; Path=/shopify; Max-Age=0; HttpOnly; Secure; SameSite=Lax`, "cache-control": "no-store" } });
  }

  if (url.pathname === "/shopify/webhooks" && req.method === "POST") {
    if (!configured(env)) return off();
    const raw = await req.text();
    // Shopify wants a 401 for a webhook it didn't sign.
    if (!(await signedWebhook(env.SHOPIFY_API_SECRET, req.headers.get("x-shopify-hmac-sha256"), raw))) return fail("not signed by Shopify", 401);
    const shop = req.headers.get("x-shopify-shop-domain") ?? "", topic = req.headers.get("x-shopify-topic") ?? "";
    if (!SHOP_DOMAIN.test(shop)) return fail("unknown store", 400);
    // Shopify gives a webhook five seconds; print files take longer, so the order is worked on after the answer.
    if (topic === "orders/create") await later(ctx, order(env, ctx, shop, url.origin, raw));
    else if (topic === "app/uninstalled" || topic === "shop/redact") await forget(env, shop);
    else if (topic === "customers/redact") await redact(env, shop, raw);
    // customers/data_request: nothing to send. QView3D keeps no customer's name, email or address, only order and design ids.
    return privateJson({ ok: true }, 200, h);
  }

  const m = url.pathname.match(/^\/api\/orgs\/([^/]+)\/shopify(\/products)?$/);
  if (!m) return null;
  const org = m[1]!, products = !!m[2];
  const settings = ID.test(org) ? await getOrg(env, org) : null;
  if (!settings) return fail("unknown org", 404);
  if (!(await isAdmin(req, settings)) && !runsShop(await signedIn(req, env), settings)) return fail("only the shop's owner or admin connects a store", 401);
  if (settings.readOnly) return fail("the public demo connects no store", 403);
  if (!configured(env)) return off();

  if (!products && req.method === "POST") {
    const body = await readJson(req, ShopifyLink);
    const claim = body ? await readTicket(env, body.claim, "claim") : null;
    const row = claim ? await shopRow(env, claim.shop) : null;
    if (!claim || !row) return fail("this link from Shopify ran out: open the app from your Shopify admin again", 400);
    // One org per store: connecting it here takes it from wherever it was.
    const was = await orgOfShopify(env, claim.shop);
    const old = was && was !== org ? await getOrg(env, was) : null;
    if (was && old) await putOrg(env, was, { ...old, shopify: undefined });
    // The store's own pages may embed the org, at its myshopify.com address and the domain shoppers see.
    const store = await ask(env, row, StoreReply, STORE);
    const front = store ? URL.parse(store.data.shop.primaryDomain.url)?.origin : undefined;
    const origins = [...new Set([...settings.origins, `https://${claim.shop}`, ...(front ? [front] : [])])].slice(0, 50);
    await putOrg(env, org, { ...settings, shopify: claim.shop, origins });
    return privateJson(stateOf(row, store) satisfies ShopifyState, 200, h);
  }

  const row = settings.shopify ? await shopRow(env, settings.shopify) : null;
  if (!row) return fail("no Shopify store is connected: install QView3D from Shopify", 404);
  if (!products && req.method === "GET") {
    const store = await ask(env, row, StoreReply, STORE);
    if (!store) return fail("Shopify didn't answer for this store: open the app from your Shopify admin again", 502);
    return privateJson(stateOf(row, store) satisfies ShopifyState, 200, h);
  }
  if (products && req.method === "PUT") {
    const body = await readJson(req, ShopifyPicks);
    if (!body) return fail("expected {picks: [{handle, product}]}", 400);
    for (const p of body.picks) if (!(await getProduct(env, org, p.product))) return fail(`${p.product}: not one of this shop's products`, 400);
    const picks = Object.fromEntries(body.picks.map((p) => [p.handle, p.product]));
    await env.DB.prepare("UPDATE shopify_shops SET picks = ? WHERE shop = ?").bind(JSON.stringify(picks), row.shop).run();
    const kept = { ...row, picks: JSON.stringify(picks) };
    return privateJson(stateOf(kept, await ask(env, kept, StoreReply, STORE)) satisfies ShopifyState, 200, h);
  }
  return fail("not found", 404);
}

/** The store as its shop sees it: Shopify's products, each with its pick. With no answer from Shopify, the picks alone. */
function stateOf(row: ShopRow, store: Of<typeof StoreReply> | null): ShopifyState {
  const picks = picksOf(row);
  const listed = store?.data.products.nodes ?? Object.keys(picks).map((handle) => ({ handle, title: handle }));
  return { shop: row.shop, products: listed.map((p) => ({ ...p, ...(picks[p.handle] ? { product: picks[p.handle] } : {}) })) };
}

/** A design id as the widget makes it, read out of a line's properties. */
const DESIGN = /^[0-9a-f]{24}$/;

/** orders/create: the lines that carry a design become an order here, and the print links go onto the Shopify order. */
async function order(env: Env, ctx: Later, shop: string, origin: string, raw: string): Promise<void> {
  const o = check(OrderHook, parseJson(raw));
  const org = o ? await orgOfShopify(env, shop) : null;
  if (!o || !org) return;
  const lines: OrderRequest["lines"] = o.line_items.flatMap((l) => {
    const design = l.properties?.find((p) => p.name === PROPERTY)?.value ?? "";
    return DESIGN.test(design) ? [{ design, qty: l.quantity }] : [];
  }).slice(0, 100);
  if (!lines.length) return;
  const took = await takeOrder(env, ctx, org, origin, { id: String(o.id), lines });
  // Shopify sends a webhook again when unsure; the note is written the first time only.
  if ("error" in took) return console.error(`shopify order ${o.id} (${shop}): ${took.error}`);
  if (!took.reply.fresh) return;
  const row = await shopRow(env, shop);
  const wrote = row ? await ask(env, row, NoteReply, NOTE, { input: noteInput(o.admin_graphql_api_id, o.note, origin, took.reply.lines) }) : null;
  const errors = wrote?.data.orderUpdate.userErrors ?? [{ message: "no answer" }];
  if (errors.length) console.error(`shopify order ${o.id} (${shop}): the print links weren't written: ${errors.map((e) => e.message).join("; ")}`);
}

/**
 * What goes on the Shopify order: a note the merchant reads on the order's page (a link per design to the print files
 * page, which asks them to sign in), and the same as a `qview3d.print_files` metafield for a fulfilment tool.
 */
export function noteInput(id: string, note: string | undefined, origin: string, lines: OrderLine[]) {
  const links = lines.map((l) => ({ design: l.design, qty: l.qty, page: `${origin}/admin.html#design=${l.design}`, plan: l.print, zones: l.sheets.map((s) => s.zone) }));
  const text = ["QView3D print files:", ...links.map((l) => `${l.qty} x ${l.page} (${l.zones.join(", ") || "nothing to print"})`)].join("\n");
  return {
    id,
    note: [note, text].filter(Boolean).join("\n\n").slice(0, 5000),
    metafields: [{ namespace: "qview3d", key: "print_files", type: "json", value: JSON.stringify(links) }],
  };
}

/** The store uninstalled (or Shopify says to erase it, 48 hours on): its token and picks go, and its org lets go of it. */
async function forget(env: Env, shop: string) {
  const org = await orgOfShopify(env, shop);
  const settings = org ? await getOrg(env, org) : null;
  if (org && settings) await putOrg(env, org, { ...settings, shopify: undefined });
  await env.DB.prepare("DELETE FROM shopify_shops WHERE shop = ?").bind(shop).run();
}

/** customers/redact: the customer's orders recorded here are removed. Their designs are files with no name on them. */
async function redact(env: Env, shop: string, raw: string) {
  const body = check(Redact, parseJson(raw));
  const org = await orgOfShopify(env, shop);
  if (!org || !body?.orders_to_redact?.length) return;
  await env.DB.batch(body.orders_to_redact.map((id) => env.DB.prepare("DELETE FROM orders WHERE org = ? AND id = ?").bind(org, String(id))));
}
