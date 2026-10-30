// Protocol versions: a store build stays installed for months, so the edge it calls says which client
// versions it still serves instead of breaking under them. Every client sends `pv` (its protocol version)
// in the query of its socket hello and its JSON calls; a build from before versions existed sends none,
// which reads as 0. The edge keeps a floor, the oldest version it still serves. A client below it gets an
// `Update` (HTTP 426 on a call, a socket that accepts, says it, and closes with `UPDATE_CLOSE`) and shows
// "Update to keep playing" with the store link, never a bare failure. Edge and page import this one file.
//
//   edge:  const old = tooOld(url, { min: 2, store });  if (old) return old.http();   // or old.socket()
//   page:  if (e.code === UPDATE_CLOSE) show(UPDATE_TEXT)                                // or readJson(res, Update)
//
// A Steam build is the web page in a bundled-Chromium window. The shell appends `STORE_SHELL_UA` to the
// window's user agent (`userAgent + " " + STORE_SHELL_UA`), and the page asks `inStoreShell()` to hide what a
// store forbids (a "get the app" banner, a link out to a payment page). iOS is native SwiftUI, no page runs there.
import { int, obj, str, type Of } from "./guard.ts";
import { json } from "./http.ts";
import { refuseSocket } from "./room.ts";

/** The close code a socket ends with when the client is below the floor (4000s are ours to use). */
export const UPDATE_CLOSE = 4426;
/** What a page shows for it. */
export const UPDATE_TEXT = "Update to keep playing";
/** The text with the store link after it, for a page that has nowhere to put a button. */
export const updateNotice = (store: string): string => `${UPDATE_TEXT}: ${store}`;

/** An iOS App Store listing from its numeric id (`appStoreUrl(6740000000)`); Android joins it with a Play Store shape. */
export const appStoreUrl = (id: number): string => `https://apps.apple.com/app/id${id}`;

/** The query field a client sends its version in. */
export const PV = "pv";

/** What the edge answers a client that is too old: the floor it needs to reach and where to get it. */
export const Update = obj({ update: int(1, 1e6), store: str(2048, { dflt: "" }) });
export type Update = Of<typeof Update>;

/** The query a client adds to a socket hello or a JSON call: `new URLSearchParams({ ...who, ...pv(PROTOCOL) })`. */
export const pv = (version: number): Record<typeof PV, string> => ({ [PV]: String(version) });

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

/** The user-agent token a store shell's window appends to its own user agent; the version after the slash is the shell's. */
export const STORE_SHELL_UA = "RustyBunsShell";

/** True when `userAgent` carries the shell's token, as a whole word so a lookalike name does not count. */
export const inStoreShell = (userAgent: string = globalThis.navigator?.userAgent ?? ""): boolean =>
  new RegExp(`(^|\\s)${STORE_SHELL_UA}(/|\\s|$)`).test(userAgent);
