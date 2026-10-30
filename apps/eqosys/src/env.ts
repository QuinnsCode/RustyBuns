// The Worker's bindings as the app sees them, and the helpers every route uses.
import type { Hubs } from "./hub.ts";
export type Row = Record<string, unknown>;
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Row>(column?: string): Promise<T | null>;
  all<T = Row>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface D1 { prepare(sql: string): D1Statement; batch(stmts: D1Statement[]): Promise<unknown[]> }

export interface Env {
  DB: D1;
  /** Workers Rate Limiting for sign-in: 20 a minute per IP. Absent locally. */
  AUTH_LIMIT?: { limit(o: { key: string }): Promise<{ success: boolean }> };
  /** Signs sessions. Without it nobody signs in (every sign-in route answers 503). */
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  /** The one account that sees everyone and grants access. Optional. */
  SUPER_ADMIN_EMAIL?: string;
  /** Social sign-in, on when both halves of a provider are set (auth.ts). */
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Sign in with Apple: the Services ID, the client-secret JWT `bun scripts/apple-secret.ts` makes (good six months), and the app's bundle id for native sign-in. */
  APPLE_CLIENT_ID?: string;
  APPLE_CLIENT_SECRET?: string;
  APPLE_APP_BUNDLE_ID?: string;
  /** Signs the tokens /api/exchange hands apps: one EC P-256 private JWK (`sign` in @rustybuns/util/token). Without it, no token. */
  EQOSYS_SIGNING_KEY?: string;
  /** "1" lets a registered app's return URL be on localhost, 127.0.0.1 or [::1], for developing it locally. Off in production. */
  LOOPBACK_RETURNS?: string;
  /** One Durable Object a person: friends, presence and notifications (hub.ts). */
  HUB?: Hubs;
}

/** Loopback returns, for developing an app on this machine (LOOPBACK_RETURNS). */
export const loopbackOn = (conf: { LOOPBACK_RETURNS?: string }) => conf.LOOPBACK_RETURNS === "1";

export const NAME = "eqosys";
export const VERSION = "0.0.1";

/** A JSON reply nobody caches: accounts are one person's. */
export { privateJson as json } from "@rustybuns/util/http";
export { b64url, digest, sha256 } from "@rustybuns/util/bytes";

/** A write from another site while a cookie is riding along: refuse it. */
export function crossSite(req: Request, conf: Env): boolean {
  if (req.method === "GET" || req.method === "HEAD") return false;
  const origin = req.headers.get("origin");
  const ours = new Set([new URL(req.url).origin, ...(conf.BETTER_AUTH_URL ? [new URL(conf.BETTER_AUTH_URL).origin] : [])]);
  return origin ? !ours.has(origin) : req.headers.get("sec-fetch-site") === "cross-site";
}
