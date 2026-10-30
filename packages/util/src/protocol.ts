// Protocol versions: a store build stays installed for months, so the edge it calls says which client
// versions it still serves instead of breaking under them. Every client sends `pv` (its protocol version)
// in the query of its socket hello and its JSON calls; a build from before versions existed sends none,
// which reads as 0. The edge keeps a floor, the oldest version it still serves. A client below it gets an
// `Update` (HTTP 426 on a call, a socket that accepts, says it, and closes with `UPDATE_CLOSE`) and shows
// "Update to keep playing" with the store link, never a bare failure. Edge and page import this one file.
//
//   edge:  const old = tooOld(url, { min: 2, store });  if (old) return old.http();   // or old.socket()
//   page:  if (e.code === UPDATE_CLOSE) show(UPDATE_TEXT)                                // or readJson(res, Update)
import { int, obj, str, type Of } from "./guard.ts";
import { json } from "./http.ts";
import { refuseSocket } from "./room.ts";

/** The close code a socket ends with when the client is below the floor (4000s are ours to use). */
export const UPDATE_CLOSE = 4426;
/** What a page shows for it. */
export const UPDATE_TEXT = "Update to keep playing";

/** The query field a client sends its version in. */
export const PV = "pv";

/** What the edge answers a client that is too old: the floor it needs to reach and where to get it. */
export const Update = obj({ update: int(1, 1e6), store: str(2048, { dflt: "" }) });
export type Update = Of<typeof Update>;

/** The protocol version a client claims in `url`'s query; 0 when it sent none or something else. */
export const clientVersion = (url: URL): number => {
  const v = Number(url.searchParams.get(PV));
  return Number.isInteger(v) && v >= 0 && v <= 1e6 ? v : 0;
};

/** Null when the client at `url` is at or above the floor, else the reply that asks it to update. */
export function tooOld(url: URL, floor: { min: number; store: string }): { http(): Response; socket(): Response } | null {
  if (clientVersion(url) >= floor.min) return null;
  const body: Update = { update: floor.min, store: floor.store };
  return {
    http: () => json(body, 426, { "cache-control": "no-store" }),
    socket: () => refuseSocket(JSON.stringify(body), UPDATE_CLOSE, "update"),
  };
}
