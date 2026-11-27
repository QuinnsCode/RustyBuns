// The Worker's bindings as the app sees them, and the two helpers every route uses.
// Keep this file importing nothing at run time (a type import is fine): src/openapi.ts and the tests lean on it.
import type { WorkerLoaderLike } from "@rustybuns/util/codemode";

/** A table row, or an entity's fields before `validate` (crm.ts) checks them against ENTITIES: the one shapeless bag the app passes around. */
export type Row = Record<string, unknown>;
export interface D1Result<T = Row> { results: T[]; success: boolean; meta: { changes: number; last_row_id: number } }
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Row>(column?: string): Promise<T | null>;
  all<T = Row>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}
export interface D1 {
  prepare(sql: string): D1Statement;
  batch<T = Row>(stmts: D1Statement[]): Promise<D1Result<T>[]>;
  exec(sql: string): Promise<unknown>;
}

/** A webhook delivery: one message per try (src/webhooks.ts). */
export interface HookMessage { delivery: string; attempt: number }

export interface QueueLike<T> { send(body: T, opts?: { delaySeconds?: number }): Promise<void> }

/** Social sign-in, on when both halves are set (auth.ts). */
export interface SocialEnv { GITHUB_CLIENT_ID?: string; GITHUB_CLIENT_SECRET?: string; GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string }

/** The loader scripts.ts runs a script in: one type with code mode's (util/codemode). */
export type { WorkerLoaderLike };

/** The part of an R2 bucket the demo snapshot uses (demo-snapshot.ts). */
export interface BucketLike {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(key: string, value: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string; contentEncoding?: string } }): Promise<unknown>;
}

/** The part of an R2 bucket files on rows use (files.ts): the shell-bun twin on the desktop and in tests. */
export interface FilesBucket {
  get(key: string): Promise<{ body: ReadableStream; text(): Promise<string> } | null>;
  put(key: string, value: Uint8Array, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  delete(keys: string | string[]): Promise<unknown>;
  list(opts: { prefix: string; cursor?: string; limit?: number }): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>;
}

export interface Env extends SocialEnv {
  DB: D1;
  HOOKS?: QueueLike<HookMessage>;
  /** Workers Rate Limiting for /api/auth/*: 20 a minute per IP. Absent on the desktop. */
  AUTH_LIMIT?: { limit(o: { key: string }): Promise<{ success: boolean }> };
  /** R2: the demo's one shared dataset, gzipped JSON (demo-snapshot.ts). Absent on the desktop and in tests: built in memory. */
  DEMO?: BucketLike;
  /** R2: files on contacts, companies and deals (files.ts). Without it the files routes answer 503. */
  FILES?: FilesBucket;
  /** Dynamic Workers for org scripts. Without it scripts answer 503. */
  LOADER?: WorkerLoaderLike;
  /** Signs sessions, salts org ids. Without it nobody signs in (every route answers 503). */
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  /** Where eqosys is: set, the sign-in page offers "Continue with eqosys" (auth.ts). Its callback is registered in eqosys's APPS. */
  EQOSYS_URL?: string;
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
import { esc } from "@rustybuns/util";
export { esc };

export const NAME ="qCRM";
export const VERSION = "0.1.4";

import { arr, Bad, check, isRecord, obj, str, type Guard } from "@rustybuns/util/guard";
/** A JSON response. Private by default: CRM rows never sit in a shared cache. */
import { privateJson as json } from "@rustybuns/util/http";
export { json };

/** What every refusal here answers: `{ error }`. */
export const ErrorReply = obj({ error: str(2000) });
export const error = (status: number, message: string) => json({ error: message }, status);

// Small helpers every file may use; look here before writing a toHex or a digest again.
export { b64url, digest, hex, hmacHex, sha256 } from "@rustybuns/util/bytes";
/**
 * `s` parsed as JSON and through `g`, or `fallback`: one bad stored row spoils one entry, not the listing.
 * Without a guard it is `unknown`, for a stored value that is only passed on (a change's data, a run's result).
 */
export function parseJson(s: unknown, fallback: null): unknown;
export function parseJson<T>(s: unknown, fallback: T, g: Guard<T>): T;
export function parseJson<T>(s: unknown, fallback: T, g?: Guard<T>): unknown {
  let v: unknown;
  try { v = typeof s === "string" && s ? JSON.parse(s) : fallback; } catch { return fallback; }
  return g ? (check(g, v) ?? fallback) : v;
}
/** A stored list of strings: a webhook's events, a row's tags, a client's redirect URIs. */
export const Strings = arr(str(Infinity, { min: 0 }), 10_000);

/** The request's JSON body when it is an object, its fields still to be checked (`need` below does both); null otherwise. */
export const readBody = async (req: Request): Promise<Row | null> => {
  try { const v: unknown = await req.json(); return isRecord(v) ? v : null; } catch { return null; }
};

/** The request's JSON body through `g`, or the 400 that says what's wrong in the guard's words. A body that isn't a JSON object reads as `{}`, so the answer names the first field it needs. */
export async function need<T>(req: Request, g: Guard<T>): Promise<T | Response> {
  return needOf((await readBody(req)) ?? {}, g);
}
/** `v` through `g`, or the 400 it explains. */
export function needOf<T>(v: unknown, g: Guard<T>): T | Response {
  try { return g(v); } catch (e) { if (e instanceof Bad) return error(400, e.message); throw e; }
}
/** A name a person typed: trimmed, cut to `max`, and not blank; `why` is what the 400 says. */
export const named = (max: number, why: string): Guard<string> => (v) => {
  const s = typeof v === "string" ? v.trim().slice(0, max) : "";
  if (!s) throw new Bad(why);
  return s;
};
