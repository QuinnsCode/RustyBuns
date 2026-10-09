// The whole app in-process with the local twins, no server: what the tests
// and the agents demo run against. The desktop build wires the same pieces.

import { applyD1Migrations, d1, durableObject, installCloudflareGlobals } from "@rustybuns/shell-bun";
import { join } from "node:path";
import worker, { FileDurableObject } from "./worker.ts";

export async function local() {
  installCloudflareGlobals();
  const env: any = { DB: d1(":memory:") };
  env.FILES = durableObject(FileDurableObject as any, env);
  await applyD1Migrations(env.DB, join(import.meta.dir, "../migrations"));
  /** Call the app as `user` (a name, or null for logged out). */
  return (user: string | null, path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (user) headers.set("cookie", `gc_user=${user}`);
    return worker.fetch(new Request("http://gitcode.local" + path, { ...init, headers }), env);
  };
}

export type Call = Awaited<ReturnType<typeof local>>;

/** The same caller shape over HTTP, for a running app (`--url`). */
export function remote(base: string, extraCookie = ""): Call {
  return (user, path, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("cookie", [user ? `gc_user=${user}` : "", extraCookie].filter(Boolean).join("; "));
    return fetch(base.replace(/\/$/, "") + path, { ...init, headers });
  };
}
