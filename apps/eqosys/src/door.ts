// eqosys's front door for an app's token: who a token names, a socket's token and its 101, and CORS for an app's own page.
// Shared by eqosys's own routes (handle.ts) and Qollab's (qollab/routes.ts), so Qollab never reads a session cookie.
import { appOf, APPS, isLoopback } from "./apps.ts";
import { loopbackOn, type Env } from "./env.ts";
import { standing } from "./members.ts";
import { SOCKET_PROTOCOL } from "@rustybuns/util/eqosys";
import { audOf, jwksOf, verify } from "@rustybuns/util/token";

/** Who a token says signed it: eqosys's own origin, the one apps verify against. */
export const issuer = (req: Request, conf: Env) => conf.BETTER_AUTH_URL ? new URL(conf.BETTER_AUTH_URL).origin : new URL(req.url).origin;
/** A token's app and who it names, or null when it isn't one eqosys signed for a known app, or it outlived its account or a sign-out (members.ts `standing`). */
export async function tokenOf(req: Request, conf: Env, token: string | null | undefined) {
  const app = token ? appOf(audOf(token)) : undefined;
  const claims = token && app ? await verify(token, await jwksOf(conf), { iss: issuer(req, conf), aud: app.id }) : null;
  return app && claims && await standing(conf, claims.sub, app.id, claims.iat) ? { app, who: { id: claims.sub, name: claims.name, app: app.id } } : null;
}
export const bearerOf = (req: Request) => /^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1];

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
