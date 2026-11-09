// eqosys's front door for an app's token: who a token names, a socket's token and its 101, and CORS for an app's own page.
// Shared by eqosys's own routes (handle.ts) and Qollab's (qollab/routes.ts), so Qollab never reads a session cookie.
import { appOf, APPS, HOME, isLoopback, type QApp } from "./apps.ts";
import { loopbackOn, type Env, type Fetcher } from "./env.ts";
import { SOCKET_PROTOCOL } from "@rustybuns/util/eqosys";
import { audOf, jwksOf, TokenChecker, verify } from "@rustybuns/util/token";

/** Who a token says signed it: eqosys's own origin, the one apps verify against. */
export const issuer = (req: Request, conf: Env) => conf.BETTER_AUTH_URL ? new URL(conf.BETTER_AUTH_URL).origin : new URL(req.url).origin;

/**
 * Whether a token eqosys signed still stands: its account is there and nothing cut its app's tokens since it was signed (members.ts `cut`).
 * The signature, `aud` and `exp` are `verify`'s; this is what a signature can't know. A cut also takes a token signed in
 * the same second, which only a sign-in racing its own sign-out could have. Here, not in members.ts, so Qollab's Worker checks it without the auth library.
 */
export async function standing(conf: Env, sub: string, app: string, iat: number) {
  const row = await conf.DB.prepare(`SELECT (SELECT 1 FROM "user" WHERE id = ?) AS here, (SELECT MAX(before) FROM token_cuts WHERE user_id = ? AND app IN (?, '*')) AS cut`)
    .bind(sub, sub, app).first<{ here: number | null; cut: number | null }>();
  return !!row?.here && (row.cut === null || iat > row.cut);
}
/**
 * eqosys's own pages as an app (`aud: "eqosys"`, HOME_LIFE seconds, from /api/home-token): its one origin is eqosys's own.
 * Not in APPS, so it has no tile, sign-in or handoff; only the doors that pass `{ home: true }` (the spaces) take its token.
 */
export const homeApp = (req: Request, conf: Env): QApp => ({ id: HOME, name: "eqosys", kind: "suite", origins: [issuer(req, conf)], starts: [], genre: "Work & Tools" });
export const HOME_LIFE = 10 * 60;

/** A token's app and who it names, or null when it isn't one eqosys signed for a known app, or it outlived its account or a sign-out (`standing`). */
export async function tokenOf(req: Request, conf: Env, token: string | null | undefined, { home = false } = {}) {
  const aud = token ? audOf(token) : undefined;
  const app = home && aud === HOME ? homeApp(req, conf) : appOf(aud);
  const claims = token && app ? await (conf.EQOSYS ? checker(conf.EQOSYS, issuer(req, conf), app.id).check(token)
    : verify(token, await jwksOf(conf), { iss: issuer(req, conf), aud: app.id })) : null;
  return app && claims && await standing(conf, claims.sub, app.id, claims.iat) ? { app, who: { id: claims.sub, name: claims.name, app: app.id } } : null;
}
/**
 * In Qollab's own Worker (apps/qollab), which holds no key to check with: eqosys's public keys, read over its EQOSYS binding and kept
 * a few minutes (`TokenChecker`, refetched on a key id it hasn't seen, so a rotation lands at once). One checker an issuer and app.
 */
const checkers = new Map<string, TokenChecker>();
function checker(eqosys: Fetcher, iss: string, app: string) {
  const at = `${iss} ${app}`;
  let c = checkers.get(at);
  if (!c) checkers.set(at, c = new TokenChecker(iss, app, (url) => eqosys.fetch(url)));
  return c;
}
export const bearerOf =(req: Request) => /^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1];

/**
 * A socket's token. A page offers the subprotocols `eqosys` and the token (`SOCKET_PROTOCOL` in @rustybuns/util/eqosys), so the token
 * rides in a header, out of every access log a URL lands in. `?token=` still opens one for the iOS kit until it moves over.
 */
export function socketToken(req: Request): { token: string | null | undefined; offered: boolean } {
  const offered = (req.headers.get("sec-websocket-protocol") ?? "").split(",").map((p) => p.trim());
  if (offered[0] === SOCKET_PROTOCOL && offered[1]) return { token: offered[1], offered: true };
  return { token: new URL(req.url).searchParams.get("token"), offered: false };
}
/** The world's 101, naming the subprotocol the page offered first: a browser drops a socket whose answer names none of its offers. */
export function echoProtocol(res: Response, offered: boolean): Response {
  const webSocket: unknown = Reflect.get(res, "webSocket");
  if (!offered || res.status !== 101 || !webSocket) return res;
  const init: ResponseInit & { webSocket: unknown } = { status: 101, webSocket, headers: { "sec-websocket-protocol": SOCKET_PROTOCOL } };
  return new Response(null, init);
}

/** CORS for an app's own page calling /api/exchange or /api/hub (a game with no server of its own). */
const appOrigins = new Set(APPS.flatMap((a) => a.origins));
export function cors(req: Request, conf: Env): Record<string, string> {
  const origin = req.headers.get("origin");
  return origin && (appOrigins.has(origin) || (loopbackOn(conf) && isLoopback(origin)))
    ? { "access-control-allow-origin": origin, "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type, authorization", vary: "origin" }
    : {};
}
