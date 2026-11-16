// The Worker's bindings as the app sees them, and the two helpers every route uses.
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = unknown>(column?: string): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
}
/** What a D1 query hands back: its rows, and what a write changed. */
export type D1Result<T> = { results: T[]; meta: { changes: number; last_row_id: number } };
/** The part of the D1 binding this app calls, and better-auth too (it wants `exec` and `batch`). */
export interface D1 { prepare(sql: string): D1Statement; batch<T = unknown>(stmts: D1Statement[]): Promise<D1Result<T>[]>; exec(sql: string): Promise<unknown> }

export interface Env {
  DB: D1;
  /** Workers Rate Limiting for sign-in: 10 a minute per IP. Absent locally. */
  AUTH_LIMIT?: { limit(o: { key: string }): Promise<{ success: boolean }> };
  /** Signs the admin session. Without it nobody signs in (every admin route answers 503). */
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  /** The one email that may make an account. */
  ADMIN_EMAIL?: string;
  /** Handed to a paid license so it can open the sealed engine. */
  ENGINE_KEY?: string;
}

export const NAME = "artstewengine";
export const VERSION = "0.1.0";

/** A JSON reply nobody caches: licenses and sign-ins are one person's. */
export { privateJson as json } from "@rustybuns/util/http";

/** A write from another site while a cookie is riding along: refuse it. */
export function crossSite(req: Request, conf: Env): boolean {
  if (req.method === "GET" || req.method === "HEAD") return false;
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  // A privacy setting can still make a browser send Origin: null on our own form; only Sec-Fetch-Site vouches for it then.
  if (origin === "null") return site !== "same-origin";
  const ours = new Set([new URL(req.url).origin, ...(conf.BETTER_AUTH_URL ? [new URL(conf.BETTER_AUTH_URL).origin] : [])]);
  return origin ? !ours.has(origin) : site === "cross-site";
}
