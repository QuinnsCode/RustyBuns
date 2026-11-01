// Who a request is from, on the edge. A player who signed in through eqosys sends the token the page got from
// /api/exchange; anyone else sends the uid their tab made. Either way the Worker alone decides the id and name
// the World and the Matchmaker see. An eqosys id is "eq:" + their eqosys id, which UID cannot spell (no colon).
import { TokenChecker } from "@rustybuns/util/token";
import { APP, EQOSYS } from "../eqosys.ts";

export interface Who { uid: string; name: string }

const clean = (s: string | null, max: number) => (s ?? "").replace(/\p{C}/gu, "").trim().slice(0, max);
export const UID = /^[A-Za-z0-9_-]{8,64}$/;

/** One checker per isolate, for the eqosys the Worker is told about (EQOSYS_URL, else the live one). */
const checkers = new Map<string, TokenChecker>();
export function checkerFor(conf: { EQOSYS_URL?: string }, get?: (url: string) => Promise<Response>): TokenChecker {
  const origin = new URL(conf.EQOSYS_URL || EQOSYS).origin;
  let c = checkers.get(origin);
  if (!c) { c = new TokenChecker(origin, APP, get); checkers.set(origin, c); }
  return c;
}

/** The player behind `url`'s query: from `token` when eqosys signed it for this game (its name wins), else from `uid`. A bad token is a 401, a bad uid a 400. */
export async function whoIs(url: URL, conf: { EQOSYS_URL?: string }): Promise<Who | Response> {
  const token = url.searchParams.get("token");
  if (token !== null) {
    const claims = await checkerFor(conf).check(token);
    if (!claims) return new Response("sign in again", { status: 401 });
    return { uid: `eq:${claims.sub}`, name: clean(claims.name, 24) || "Spy" };
  }
  const uid = url.searchParams.get("uid") ?? "";
  if (!UID.test(uid)) return new Response("bad player id", { status: 400 });
  return { uid, name: clean(url.searchParams.get("name"), 24) || "Spy" };
}
