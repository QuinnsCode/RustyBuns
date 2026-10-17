// The Worker's bindings as the app sees them, and the two helpers every route uses.
// Keep this file importing nothing: src/openapi.ts and the tests lean on it.

export type Row = Record<string, unknown>;
export interface D1Result<T = Row> { results: T[]; success: boolean; meta: { changes?: number; last_row_id?: number } }
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Row>(column?: string): Promise<T | null>;
  all<T = Row>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}
export interface D1 {
  prepare(sql: string): D1Statement;
  batch<T = Row>(stmts: D1Statement[]): Promise<D1Result<T>[]>;
}

/** A webhook delivery: one message per try (src/webhooks.ts). */
export interface HookMessage { delivery: string; attempt: number }

export interface QueueLike<T> { send(body: T, opts?: { delaySeconds?: number }): Promise<void> }

/** Social sign-in, on when both halves are set (auth.ts). */
export interface SocialEnv { GITHUB_CLIENT_ID?: string; GITHUB_CLIENT_SECRET?: string; GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string }

/** The part of a dynamic Worker's code (worker_loader) this app writes, and of the loader it calls (scripts.ts). */
export interface WorkerCode { compatibilityDate?: string; mainModule: string; modules: Record<string, string>; env?: Record<string, unknown>; globalOutbound?: unknown }
export interface WorkerLoaderLike {
  get(id: string, code: () => WorkerCode | Promise<WorkerCode>): { getEntrypoint(): { fetch(input: string, init?: RequestInit): Promise<Response> } };
}

export interface Env extends SocialEnv {
  DB: D1;
  HOOKS?: QueueLike<HookMessage>;
  /** Dynamic Workers for org scripts. Without it scripts answer 503. */
  LOADER?: WorkerLoaderLike;
  /** Signs sessions, salts org ids. Without it nobody signs in (every route answers 503). */
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  /** The one account above every org: sees every org, grants admins, never a member of any. */
  SUPER_ADMIN_EMAIL?: string;
}

export const NAME = "qCRM";
export const VERSION = "0.1.4";

const CACHE = "no-store";
/** A JSON response. Private by default: CRM rows never sit in a shared cache. */
export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": CACHE, ...headers } });

export const error = (status: number, message: string) => json({ error: message }, status);

// Small helpers every file may use; look here before writing a toHex or a digest again.
export const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
export const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
/** The 32 raw bytes of `text`'s SHA-256. */
export const digest = async (text: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
/** `text`'s SHA-256 as 64 hex digits. */
export const sha256 = async (text: string) => hex(await digest(text));
/** `s` parsed as JSON, or `fallback`: one bad stored row spoils one entry, not the listing. */
export const parseJson = <T>(s: unknown, fallback: T): T => { try { return typeof s === "string" && s ? JSON.parse(s) : fallback; } catch { return fallback; } };

/** The request's JSON body, or null when it isn't one. */
export const readBody = async <T = Record<string, unknown>>(req: Request): Promise<T | null> => {
  try { const v = await req.json(); return v && typeof v === "object" ? (v as T) : null; } catch { return null; }
};
