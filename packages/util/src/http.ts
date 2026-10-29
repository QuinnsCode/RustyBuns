// JSON over HTTP, the same on both ends of the wire. A server answers with `json` (or `privateJson`
// when the reply is one person's data and must never sit in a shared cache). A page, or a server
// calling another, reads a reply with `readJson` or `getJson` through a guard from `./guard.ts`,
// so the reply's type is the one guard both sides import, not a cast each side made up.
//
//   // shared: const Owned = obj({ owned: arr(str(64), 1000) }); type Owned = Of<typeof Owned>;
//   // server: return json({ owned } satisfies Owned);
//   // page:   const got = await getJson("/api/owned", Owned);   // Owned | null
import { check, type Guard } from "./guard.ts";

/** A JSON reply. */
export const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });

/** A JSON reply that no cache may keep: one person's rows, a room code, a vote count. */
export const privateJson = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  json(body, status, { "cache-control": "no-store", ...headers });

/** `JSON.parse` that never throws: undefined when `text` isn't JSON. */
export const parseJson = (text: string | null | undefined): unknown => {
  if (!text) return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
};

/** A client's JSON body before anyone has checked it: the fields a route reads, each `unknown`. Bad JSON, or not an object, has none. */
export type Body<K extends string> = { [k in K]?: unknown };
export const readBody = async <K extends string>(req: Request): Promise<Body<K>> => {
  const v: unknown = await req.json().catch(() => null);
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Body<K>) : {};
};

/**
 * The JSON in a request or a reply, through a guard: the typed value, or null when it isn't JSON,
 * doesn't fit the guard, or (for a reply) the status wasn't ok.
 */
export async function readJson<T>(from: Request | Response, guard: Guard<T>): Promise<T | null> {
  if (from instanceof Response && !from.ok) return null;
  const v: unknown = await from.json().catch(() => undefined);
  return v === undefined ? null : check(guard, v);
}

/** Fetches `url` and reads the reply through a guard; null on a network error too. */
export async function getJson<T>(url: string, guard: Guard<T>, init?: RequestInit): Promise<T | null> {
  const res = await fetch(url, init).catch(() => null);
  return res ? readJson(res, guard) : null;
}
