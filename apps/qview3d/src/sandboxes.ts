// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// Sandboxes: a test shop QView3D's owner hands someone with one link, so they can try it with their own product before
// there is a shop for them. No eqosys account on their side: the link carries the org and an admin key.
//
//   POST /api/sandboxes   QView3D's owner makes one (SandboxRequest -> SandboxReply)
//   GET  /api/orgs/<org>  the org as its shop sees it (Shop): its admin key (the sandbox page), or the shop signed in
//
// A sandbox is an ordinary org with three differences: any page may embed it ("*", since a test page can be anywhere),
// it starts with one product so the preview works at once, and it ends (`expires`), after which every route reads it
// as unknown. Keep this as my shop on /try.html (POST /api/mine/shops with its key, signed in) turns it into a real
// one for the person's studio: same products, no end. QView3D's owner can still do it from /orgs.html with its org id.
import { b64url, hex, sha256 } from "@rustybuns/util/bytes";
import { privateJson, readJson } from "@rustybuns/util/http";
import { SandboxRequest, slug, type SandboxReply } from "./api.ts";
import { isOwner, runsShop, shopOf, signedIn, STARTER } from "./orgs.ts";
import { getOrg, getProduct, putOrg, putProduct } from "./settings.ts";
import { isAdmin } from "./samples.ts";
import type { Env } from "./worker.ts";

const DAY = 86_400_000;

/** The link to send: the sandbox page, the org and key in the fragment so they never reach a server log. */
export const sandboxLink = (origin: string, org: string, key: string) => `${origin}/try.html#${new URLSearchParams({ org, key })}`;

/** Make (or renew) sandbox `org` with admin key `key`, and its starter product unless it has one. */
export async function openSandbox(env: Env, org: string, key: string, o: { samples: number; days: number }): Promise<number> {
  const expires = Date.now() + o.days * DAY;
  await putOrg(env, org, { origins: ["*"], admins: [await sha256(key)], samples: o.samples, expires });
  if (!(await getProduct(env, org, STARTER.id))) await putProduct(env, org, STARTER.id, STARTER.product);
  return expires;
}

/** The routes above, or null when the request is neither. */
export async function sandboxRoute(req: Request, env: Env, h: Record<string, string>): Promise<Response | null> {
  const url = new URL(req.url);
  const fail = (why: string, status: number) => privateJson({ error: why }, status, h);

  if (url.pathname === "/api/sandboxes" && req.method === "POST") {
    const c = await signedIn(req, env);
    if (!isOwner(c)) return fail("only QView3D's owner hands out sandboxes", c ? 403 : 401);
    const body = await readJson(req, SandboxRequest);
    if (!body) return fail("expected {for?, samples?: 0 to 5, days?: 1 to 90}", 400);
    const org = ["try", slug(body.for ?? ""), hex(crypto.getRandomValues(new Uint8Array(3)))].filter(Boolean).join("-");
    const key = `qv_${b64url(crypto.getRandomValues(new Uint8Array(24)))}`;
    const expires = await openSandbox(env, org, key, { samples: body.samples ?? 1, days: body.days ?? 14 });
    return privateJson({ org, key, link: sandboxLink(url.origin, org, key), expires } satisfies SandboxReply, 201, h);
  }

  const m = req.method === "GET" && url.pathname.match(/^\/api\/orgs\/([a-z0-9][a-z0-9-]{0,62})$/);
  if (!m) return null;
  const settings = await getOrg(env, m[1]!);
  // A wrong key and an unknown org answer alike, so a guess learns nothing.
  if (!settings || !((await isAdmin(req, settings)) || runsShop(await signedIn(req, env), settings))) return fail("unknown org, or not your key", 404);
  return privateJson(await shopOf(env, m[1]!, settings), 200, h);
}
