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
  /** Workers Rate Limiting for /api/auth/*: 20 a minute per IP. Absent on the desktop. */
  AUTH_LIMIT?: { limit(o: { key: string }): Promise<{ success: boolean }> };
  /** Dynamic Workers for org scripts. Without it scripts answer 503. */
  LOADER?: WorkerLoaderLike;
  /** Signs sessions, salts org ids. Without it nobody signs in (every route answers 503). */
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  /** The one account above every org: sees every org, grants admins, never a member of any. */
  SUPER_ADMIN_EMAIL?: string;
  /** Cloudflare Email Sending. With EMAIL_FROM it turns on verification and reset links (auth.ts). */
  EMAIL?: { send(m: { from: string | { email: string; name?: string }; to: string; subject: string; text: string; html?: string }): Promise<unknown> };
  EMAIL_FROM?: string;
  /** artstewengine's address and this deployment's license: together they ask "have you paid?" (seal.ts). */
  ARTSTEW_URL?: string;
  QCRM_LICENSE?: string;
}

/** `s` safe inside HTML text and attributes. */
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const NAME ="qCRM";
export const VERSION = "0.1.4";

/** A JSON response. Private by default: CRM rows never sit in a shared cache. */
import { privateJson as json } from "@rustybuns/util/http";
export { json };

export const error = (status: number, message: string) => json({ error: message }, status);

// Small helpers every file may use; look here before writing a toHex or a digest again.
export { b64url, digest, hex, sha256 } from "@rustybuns/util/bytes";
/** `s` parsed as JSON, or `fallback`: one bad stored row spoils one entry, not the listing. */
export const parseJson = <T>(s: unknown, fallback: T): T => { try { return typeof s === "string" && s ? JSON.parse(s) : fallback; } catch { return fallback; } };

/** The request's JSON body, or null when it isn't one. */
export const readBody = async <T = Record<string, unknown>>(req: Request): Promise<T | null> => {
  try { const v = await req.json(); return v && typeof v === "object" ? (v as T) : null; } catch { return null; }
};
