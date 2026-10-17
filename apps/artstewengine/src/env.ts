// The Worker's bindings as the app sees them, and the two helpers every route uses.
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

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

/** A write from another site while a cookie is riding along: refuse it. */
export function crossSite(req: Request, conf: Env): boolean {
  if (req.method === "GET" || req.method === "HEAD") return false;
  const origin = req.headers.get("origin");
  const ours = new Set([new URL(req.url).origin, ...(conf.BETTER_AUTH_URL ? [new URL(conf.BETTER_AUTH_URL).origin] : [])]);
  return origin ? !ours.has(origin) : req.headers.get("sec-fetch-site") === "cross-site";
}
