// Cloudflare entry: the built page as assets (served before this runs), and /walk, a party's socket into the room for
// the region it stands in (region.ts). The Worker is the only place identity is decided: the eqosys token in the
// query names the player, any identity header the client sent is dropped, and the room trusts only what this vouches.
// It is also the front door against abuse: a socket from someone else's page is refused (Origin), and one address
// can only open so many new rooms a minute (each new party and region is a new Durable Object).
import { RoomMintGate, originAllowed } from "@rustybuns/util/limits";
import { TokenChecker } from "@rustybuns/util/token";
import { APP, CODE, EQOSYS, roomOf } from "../net/wire.ts";
import { RegionRoom } from "./region.ts";
// workerd takes only handlers and Durable Object classes from this module.
export { RegionRoom };

interface Env {
  ASSETS: { fetch(r: Request): Promise<Response> };
  REGION: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } };
  /** The eqosys that signs players' tokens; the live one when unset. */
  EQOSYS_URL?: string;
}

/** Regions are numbered from 1; the continent has fewer than a hundred. */
const REGION = /^[1-9]\d?$/;
/** Per isolate, keyed by CF-Connecting-IP, which Cloudflare sets and a client cannot. */
const mintGate = new RoomMintGate();
const checkers = new Map<string, TokenChecker>();
function checkerFor(env: Env): TokenChecker {
  const origin = new URL(env.EQOSYS_URL || EQOSYS).origin;
  let c = checkers.get(origin);
  if (!c) { c = new TokenChecker(origin, APP); checkers.set(origin, c); }
  return c;
}
const clean = (s: string | undefined, max: number) => (s ?? "").replace(/\p{C}/gu, "").trim().slice(0, max);

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== "/walk") return env.ASSETS.fetch(req);
    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("websocket only", { status: 426 });
    if (!originAllowed(req.headers.get("Origin"), url)) return new Response("cross-origin websocket refused", { status: 403 });
    const code = (url.searchParams.get("party") ?? "").toUpperCase(), region = url.searchParams.get("region") ?? "";
    if (!CODE.test(code) || !REGION.test(region)) return new Response("bad party or region", { status: 400 });
    const claims = await checkerFor(env).check(url.searchParams.get("token") ?? "");
    if (!claims) return new Response("sign in again", { status: 401 });
    const room = roomOf(code, Number(region)), ip = req.headers.get("CF-Connecting-IP");
    if (ip && !mintGate.allow(ip, room, Date.now())) return new Response("too many new rooms, try again in a minute", { status: 429, headers: { "Retry-After": "60" } });

    const headers = new Headers(req.headers);
    for (const k of [...headers.keys()]) if (k.toLowerCase().startsWith("x-")) headers.delete(k); // never a client's word
    headers.set("X-User-Id", `eq:${claims.sub}`);
    headers.set("X-User-Name", clean(claims.name, 40) || "Walker");
    const lead = url.searchParams.get("lead") ?? "";
    // The token stays here: the room is told who, not handed the key.
    return env.REGION.get(env.REGION.idFromName(room)).fetch(new Request(`https://room/walk?lead=${encodeURIComponent(lead)}`, { headers }));
  },
};
