// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// Shops, set up signed in through eqosys rather than by hand in R2. A shop is an eqosys studio: QView3D's token
// names the person's studios and their role in each (eqosys APPS `studios`), so nobody pastes a key.
//
//   GET  /api/mine                          your studios, each with its org once there is one (Mine)
//   PUT  /api/orgs/<org>                    QView3D's owner (an owner or admin of eqosys's house studio) makes an org
//                                           for a studio, or changes its sites and samples allowance (OrgSetup)
//   PUT  /api/orgs/<org>/products/<id>      the shop's owner or admin, or an admin key, writes a product (Product)
//   POST /api/orgs/<org>/keys               the shop's owner or admin gets an admin key for a script, shown once
//
// meta/studios/<studio>.json names a studio's org, so /api/mine finds it without listing every org.
import { b64url, sha256 } from "@rustybuns/util/bytes";
import { obj, str } from "@rustybuns/util/guard";
import { privateJson, readJson } from "@rustybuns/util/http";
import { checkerFor, type Claims } from "@rustybuns/util/token";
import { ID, orgKey, productKey } from "./layout.ts";
import { APP, EQOSYS, Org, OrgSetup, Product, type KeyReply, type Mine } from "./api.ts";
import type { Env } from "./worker.ts";

/** eqosys's house studio (QNTBR): its owners and admins are QView3D's owner. */
export const HOUSE = "qntbr";
const KEYS_MAX = 20;

const studioKey = (studio: string) => `meta/studios/${studio}.json`;
const StudioOrg = obj({ org: str(63, { re: ID }) });
const asJson = { httpMetadata: { contentType: "application/json" } };

/** The person behind `authorization: Bearer <eqosys token>`, or null (no token, a key, or one eqosys didn't sign for us). */
export async function signedIn(req: Request, env: Env): Promise<Claims | null> {
  const m = (req.headers.get("authorization") ?? "").match(/^Bearer (\S+\.\S+\.\S+)$/);
  return m ? checkerFor(env.EQOSYS_URL || EQOSYS, APP).check(m[1]!) : null;
}

const runs = (c: Claims | null, studio: string | undefined) =>
  !!c && !!studio && (c.studios ?? []).some((s) => s.id === studio && (s.role === "owner" || s.role === "admin"));
/** QView3D's owner: an owner or admin of eqosys's house studio. */
export const isOwner = (c: Claims | null) => runs(c, HOUSE);
/** Whether `c` may manage `org`: its studio's owner or admin, or QView3D's owner. */
export const runsShop = (c: Claims | null, org: Org) => isOwner(c) || runs(c, org.studio);

async function readOrg(env: Env, org: string): Promise<Org | null> {
  const o = await env.BUCKET.get(orgKey(org));
  return o ? readJson(new Response(await o.text()), Org) : null;
}

async function products(env: Env, org: string) {
  const out: NonNullable<Mine["shops"][number]["org"]>["products"] = [];
  let cursor: string | undefined;
  do {
    const page = await env.BUCKET.list({ prefix: `orgs/${org}/products/`, cursor });
    for (const { key } of page.objects) {
      const id = key.slice(`orgs/${org}/products/`.length, -".json".length);
      const o = ID.test(id) ? await env.BUCKET.get(key) : null;
      const p = o ? await readJson(new Response(await o.text()), Product) : null;
      if (p && out.length < 200) out.push({ id, name: p.name, model: p.model, colors: p.colors });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

/** The routes above, or null when the request is none of them. */
export async function orgsRoute(req: Request, env: Env, h: Record<string, string>): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  const fail = (why: string, status: number) => privateJson({ error: why }, status, h);

  if (pathname === "/api/mine" && req.method === "GET") {
    const c = await signedIn(req, env);
    if (!c) return fail("sign in with eqosys", 401);
    const shops: Mine["shops"] = [];
    for (const s of c.studios ?? []) {
      const at = await env.BUCKET.get(studioKey(s.id));
      const id = at ? (await readJson(new Response(await at.text()), StudioOrg))?.org : undefined;
      const settings = id ? await readOrg(env, id) : null;
      // Shown only while the org still names this studio: an owner may have moved it since.
      const org = id && settings?.studio === s.id
        ? { id, origins: settings.origins, samples: settings.samples ?? 0, keys: settings.admins?.length ?? 0, products: await products(env, id) }
        : undefined;
      shops.push({ studio: s.id, name: s.name, role: s.role, ...(org ? { org } : {}) });
    }
    return privateJson({ owner: isOwner(c), shops } satisfies Mine, 200, h);
  }

  const m = pathname.match(/^\/api\/orgs\/([^/]+)(?:\/(products|keys)(?:\/([^/]+))?)?$/);
  if (!m) return null;
  const [, org, what, id] = m;
  const make = !what && req.method === "PUT", product = what === "products" && !!id && req.method === "PUT", key = what === "keys" && !id && req.method === "POST";
  if (!make && !product && !key) return null;
  if (!org || !ID.test(org)) return fail("an org id is lowercase letters, digits and dashes", 400);
  const c = await signedIn(req, env);

  if (make) {
    if (!isOwner(c)) return fail("only QView3D's owner makes orgs", c ? 403 : 401);
    const body = await readJson(req, OrgSetup);
    if (!body) return fail("expected {studio, origins: [https://...], samples}", 400);
    const was = await readOrg(env, org);
    const settings: Org = { origins: body.origins, samples: body.samples, studio: body.studio, ...(was?.admins ? { admins: was.admins } : {}) };
    await env.BUCKET.put(orgKey(org), JSON.stringify(settings), asJson);
    await env.BUCKET.put(studioKey(body.studio), JSON.stringify({ org }), asJson);
    return privateJson(settings, was ? 200 : 201, h);
  }

  const settings = await readOrg(env, org);
  if (!settings) return fail("unknown org", 404);

  if (key) {
    if (!runsShop(c, settings)) return fail("only the shop's owner or admin makes keys", c ? 403 : 401);
    const fresh = `qv_${b64url(crypto.getRandomValues(new Uint8Array(24)))}`;
    // The oldest key goes when there are KEYS_MAX already.
    const admins = [...(settings.admins ?? []), await sha256(fresh)].slice(-KEYS_MAX);
    await env.BUCKET.put(orgKey(org), JSON.stringify({ ...settings, admins }), asJson);
    return privateJson({ key: fresh } satisfies KeyReply, 201, h);
  }

  // A product: the shop signed in, or a script with one of its admin keys.
  const bearer = (req.headers.get("authorization") ?? "").match(/^Bearer (\S{8,200})$/)?.[1];
  const byKey = !c && !!bearer && (settings.admins ?? []).includes(await sha256(bearer));
  if (!byKey && !runsShop(c, settings)) return fail("only the shop's owner or admin, or its admin key, writes products", c || bearer ? 403 : 401);
  if (!id || !ID.test(id)) return fail("a product id is lowercase letters, digits and dashes", 400);
  const p = await readJson(req, Product);
  if (!p) return fail("expected {name, model, colors: [#rrggbb], glb?}", 400);
  if (p.glb && !p.glb.startsWith(`orgs/${org}/models/`)) return fail("glb: one of this org's sample models", 400);
  await env.BUCKET.put(productKey(org, id), JSON.stringify(p), asJson);
  return privateJson(p, 200, h);
}
