// The whole API in-process with the local twins (in-memory D1, an in-process hooks queue):
// what the tests run against. The desktop build wires the same pieces onto sqlite.
import { applyD1Migrations, d1, queue } from "@rustybuns/shell-bun";
import { join } from "node:path";
import { handleApi, handleQueue } from "./api.ts";
import type { Env } from "./env.ts";

const now = { run: (_priority: unknown, fn: (job?: any) => unknown) => Promise.resolve(fn()) } as any;

export const ORIGIN = "http://qcrm.local";

export async function local(extra: Record<string, unknown> = {}) {
  const env: any = { DB: d1(":memory:"), BETTER_AUTH_SECRET: "test-secret-".padEnd(40, "x"), BETTER_AUTH_URL: ORIGIN, ...extra };
  env.HOOKS = queue(":memory:", "qcrm-hooks");
  const stopHooks = env.HOOKS.consume((batch: any) => handleQueue(batch, env as Env), { scheduler: now });
  await applyD1Migrations(env.DB, join(import.meta.dir, "../migrations"));
  /** Call the API with a cookie string (or "" for signed out). */
  const call = (cookie: string, path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (cookie) headers.set("cookie", cookie);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    headers.set("origin", ORIGIN);
    return handleApi(new Request(ORIGIN + path, { ...init, headers }), env as Env);
  };
  return Object.assign(call, { env: env as Env, close() { stopHooks(); } });
}

export type Call = Awaited<ReturnType<typeof local>>;
