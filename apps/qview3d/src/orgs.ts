// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// Shops, set up signed in through eqosys rather than by hand. A shop is an eqosys studio: QView3D's token names the
// person's studios and their role in each (eqosys APPS `studios`), so nobody pastes a key. Settings live in D1 (settings.ts).
//
//   GET  /api/mine                          your studios, each with its org and products once there is one (Mine)
//   PUT  /api/orgs/<org>                    QView3D's owner (an owner or admin of eqosys's house studio) makes an org
//                                           for a studio, or changes its studio, sites and samples allowance (OrgSetup)
//   PUT  /api/orgs/<org>/sites              the shop's owner or admin changes the pages that may embed it (Sites)
//   PUT  /api/orgs/<org>/products/<id>      the shop's owner or admin, or an admin key, writes a product (Product)
//   POST /api/orgs/<org>/keys               the shop's owner or admin gets an admin key for a script, shown once
import { b64url, sha256 } from "@rustybuns/util/bytes";
import { privateJson, readJson } from "@rustybuns/util/http";
import { checkerFor, type Claims } from "@rustybuns/util/token";
import { ID } from "./layout.ts";
import { APP, EQOSYS, Org, OrgSetup, Product, Sites, zonesOf, type KeyReply, type Mine } from "./api.ts";
import { getOrg, listProducts, orgOfStudio, putOrg, putProduct } from "./settings.ts";
import type { Env } from "./worker.ts";

/** eqosys's house studio (QNTBR): its owners and admins are QView3D's owner. */
export const HOUSE = "qntbr";
const KEYS_MAX = 20;

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

/** The routes above, or null when the request is none of them. */
export async function orgsRoute(req: Request, env: Env, h: Record<string, string>): Promise<Response | null> {
  const url = new URL(req.url);
  const fail = (why: string, status: number) => privateJson({ error: why }, status, h);

  if (url.pathname === "/api/mine" && req.method === "GET") {
    const c = await signedIn(req, env);
    if (!c) return fail("sign in with eqosys", 401);
    const shops: Mine["shops"] = [];
    for (const s of c.studios ?? []) {
      const id = await orgOfStudio(env, s.id);
      const settings = id ? await getOrg(env, id) : null;
      const org = id && settings
        ? { id, origins: settings.origins, samples: settings.samples ?? 0, keys: settings.admins?.length ?? 0, products: await listProducts(env, id) }
        : undefined;
      shops.push({ studio: s.id, name: s.name, role: s.role, ...(org ? { org } : {}) });
    }
    return privateJson({ owner: isOwner(c), shops } satisfies Mine, 200, h);
  }

  const m = url.pathname.match(/^\/api\/orgs\/([^/]+)(?:\/(products|keys|sites)(?:\/([^/]+))?)?$/);
  if (!m) return null;
  const [, org, what, id] = m;
  const make = !what && req.method === "PUT", product = what === "products" && !!id && req.method === "PUT";
  const key = what === "keys" && !id && req.method === "POST", sites = what === "sites" && !id && req.method === "PUT";
  if (!make && !product && !key && !sites) return null;
  if (!org || !ID.test(org)) return fail("an org id is lowercase letters, digits and dashes", 400);
  const c = await signedIn(req, env);

  if (make) {
    if (!isOwner(c)) return fail("only QView3D's owner makes orgs", c ? 403 : 401);
    const body = await readJson(req, OrgSetup);
    if (!body) return fail("expected {studio, origins: [https://...], samples}", 400);
    const was = await getOrg(env, org);
    const settings: Org = { ...was, origins: body.origins, samples: body.samples, studio: body.studio };
    await putOrg(env, org, settings);
    return privateJson(settings, was ? 200 : 201, h);
  }

  const settings = await getOrg(env, org);
  if (!settings) return fail("unknown org", 404);

  if (key || sites) {
    if (!runsShop(c, settings)) return fail(`only the shop's owner or admin ${key ? "makes keys" : "changes its sites"}`, c ? 403 : 401);
    if (sites) {
      const body = await readJson(req, Sites);
      if (!body) return fail("expected {origins: [https://...]}, one site at least", 400);
      await putOrg(env, org, { ...settings, origins: body.origins });
      return privateJson({ origins: body.origins }, 200, h);
    }
    const fresh = `qv_${b64url(crypto.getRandomValues(new Uint8Array(24)))}`;
    // The oldest key goes when there are KEYS_MAX already.
    const admins = [...(settings.admins ?? []), await sha256(fresh)].slice(-KEYS_MAX);
    await putOrg(env, org, { ...settings, admins });
    return privateJson({ key: fresh } satisfies KeyReply, 201, h);
  }

  // A product: the shop signed in, or a script with one of its admin keys.
  const bearer = (req.headers.get("authorization") ?? "").match(/^Bearer (\S{8,200})$/)?.[1];
  const byKey = !c && !!bearer && (settings.admins ?? []).includes(await sha256(bearer));
  if (!byKey && !runsShop(c, settings)) return fail("only the shop's owner or admin, or its admin key, writes products", c || bearer ? 403 : 401);
  if (!id || !ID.test(id)) return fail("a product id is lowercase letters, digits and dashes", 400);
  const p = await readJson(req, Product);
  if (!p) return fail("expected {name, model, colors: [#rrggbb], glb?, zones?, print?, place?}", 400);
  if (p.glb && !p.glb.startsWith(`orgs/${org}/models/`)) return fail("glb: one of this org's sample models", 400);
  const wrong = p.print?.find((z) => !zonesOf(p.model).includes(z));
  if (wrong) return fail(`print: a ${p.model} has no ${wrong}`, 400);
  await putProduct(env, org, id, p, url.origin);
  return privateJson(p, 200, h);
}
