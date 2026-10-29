// The Worker's bindings as the app sees them, and the helpers every route uses.
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
  /** Signs the tokens /api/exchange hands apps: one EC P-256 private JWK (token.ts). Without it, no token. */
  EQOSYS_SIGNING_KEY?: string;
  /** "1" lets a registered app's return URL be on localhost, 127.0.0.1 or [::1], for developing it locally. Off in production. */
  LOOPBACK_RETURNS?: string;
}

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
