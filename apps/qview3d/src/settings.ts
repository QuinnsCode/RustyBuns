// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// Org and product settings, in D1 (migrations/): which sites embed an org, its admin keys, samples and eqosys studio;
// each product's name, model, colours, print zones and default placement. A sandbox org also has an end (expires). Files stay in R2 (layout.ts).
//
// A fresh deploy's migrations seed the demo org and its products (0002_demo.sql, made from demo.ts by
// scripts/demo-sql.ts), so the demo works from D1 with nothing to do by hand. An org then enters its own on /orgs.html.
//
// The widget's product read goes through the Workers Cache API first (cachedProduct), kept a minute, so a shop's page
// load doesn't wait on D1; a save purges that product's entry. The purge reaches this location's cache only: elsewhere
// an old entry lives out its minute, which is the most a shopper can see an old colour for. Cloudflare keeps no Cache API
// entries on *.workers.dev, so there every read goes to D1 (one indexed row) until the Worker has a custom domain.
import { check, type Guard } from "@rustybuns/util/guard";
import { Org, Product } from "./api.ts";

/** The part of D1 this Worker uses: the real binding, or shell-bun's sqlite twin (local.ts). */
export interface Db {
  prepare(sql: string): Stmt;
  batch(stmts: Stmt[]): Promise<unknown>;
}
interface Stmt {
  bind(...values: unknown[]): Stmt;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

/** The part of the Cache API the product read uses: caches.default, or the twin's stand-in. */
export interface SettingsCache {
  match(req: Request): Promise<Response | undefined>;
  put(req: Request, res: Response): Promise<void>;
  delete(req: Request): Promise<boolean>;
}

export interface SettingsEnv {
  DB: Db;
  /** Local twin only: stands in for caches.default, which Bun lacks. */
  SETTINGS_CACHE?: SettingsCache;
}

const TTL_S = 60;
type OrgRow = { origins: string; admins: string; samples: number; studio: string | null; read_only: number; expires: number | null };

const json = (text: string): unknown => { try { return JSON.parse(text); } catch { return null; } };
const parsed = <T>(g: Guard<T>, text: string): T | null => check(g, json(text));

/** An org's settings, or null when there is none or it was a sandbox that ran out (then it is unknown everywhere). */
export async function getOrg(env: SettingsEnv, id: string): Promise<Org | null> {
  const r = await env.DB.prepare("SELECT origins, admins, samples, studio, read_only, expires FROM orgs WHERE id = ?").bind(id).first<OrgRow>();
  if (!r || (r.expires !== null && r.expires < Date.now())) return null;
  return check(Org, { origins: json(r.origins), admins: json(r.admins), samples: r.samples, studio: r.studio, readOnly: !!r.read_only || undefined, expires: r.expires ?? undefined });
}

export async function putOrg(env: SettingsEnv, id: string, o: Org): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO orgs (id, origins, admins, samples, studio, read_only, expires, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET origins = excluded.origins, admins = excluded.admins, samples = excluded.samples,
       studio = excluded.studio, read_only = excluded.read_only, expires = excluded.expires, updated = excluded.updated`,
  ).bind(id, JSON.stringify(o.origins), JSON.stringify(o.admins ?? []), o.samples ?? 0, o.studio ?? null, o.readOnly ? 1 : 0, o.expires ?? null, Date.now()).run();
}

/** The org a studio runs, the one set most lately when an owner moved it between orgs. */
export async function orgOfStudio(env: SettingsEnv, studio: string): Promise<string | null> {
  const r = await env.DB.prepare("SELECT id FROM orgs WHERE studio = ? ORDER BY updated DESC LIMIT 1").bind(studio).first<{ id: string }>();
  return r?.id ?? null;
}

export async function getProduct(env: SettingsEnv, org: string, id: string): Promise<Product | null> {
  const r = await env.DB.prepare("SELECT body FROM products WHERE org = ? AND id = ?").bind(org, id).first<{ body: string }>();
  return r ? parsed(Product, r.body) : null;
}

export async function listProducts(env: SettingsEnv, org: string, max = 200): Promise<{ id: string; product: Product }[]> {
  const { results } = await env.DB.prepare("SELECT id, body FROM products WHERE org = ? ORDER BY id LIMIT ?").bind(org, max).all<{ id: string; body: string }>();
  return results.flatMap((r) => { const product = parsed(Product, r.body); return product ? [{ id: r.id, product }] : []; });
}

/**
 * Write a product and purge its cached settings on `origin` (this host), so the next page load reads the new ones.
 * A sample's new product has nothing cached yet (misses aren't kept), so it passes no origin.
 */
export async function putProduct(env: SettingsEnv, org: string, id: string, p: Product, origin?: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO products (org, id, body, updated) VALUES (?, ?, ?, ?)
     ON CONFLICT (org, id) DO UPDATE SET body = excluded.body, updated = excluded.updated`,
  ).bind(org, id, JSON.stringify(p), Date.now()).run();
  if (origin) await cacheOf(env)?.delete(cacheKey(origin, org, id));
}

const cacheOf = (env: SettingsEnv): SettingsCache | undefined =>
  env.SETTINGS_CACHE ?? (typeof caches !== "undefined" ? (caches as unknown as { default?: SettingsCache }).default : undefined);
// One entry per product on this host, whatever page or query asked for it.
const cacheKey = (origin: string, org: string, id: string) => new Request(`${origin}/__settings/${org}/${id}`);

/** A product's settings for the widget: the cache's copy when it has one, else D1's, kept for a minute. */
export async function cachedProduct(env: SettingsEnv, org: string, id: string, origin: string): Promise<Product | null> {
  const cache = cacheOf(env), key = cacheKey(origin, org, id);
  const hit = await cache?.match(key);
  if (hit) return parsed(Product, await hit.text());
  const p = await getProduct(env, org, id);
  if (p) await cache?.put(key, new Response(JSON.stringify(p), { headers: { "content-type": "application/json", "cache-control": `public, max-age=${TTL_S}` } }));
  return p;
}
