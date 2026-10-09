// The whole app in-process with the local twins: what the tests and the agents
// demo run against. The only server is the git one Artifacts remotes need. The desktop build wires the same pieces.

import { LocalArtifacts, applyD1Migrations, d1, durableObject, gitHttp, installCloudflareGlobals } from "@rustybuns/shell-bun";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import worker, { FileDurableObject } from "./worker.ts";

export async function local() {
  installCloudflareGlobals();
  const env: any = { DB: d1(":memory:") };
  env.FILES = durableObject(FileDurableObject as any, env);
  // Artifacts: bare repos in a temp dir, behind a git HTTP server of their own.
  env.ARTIFACTS = new LocalArtifacts(mkdtempSync(join(tmpdir(), "gitcode-artifacts-")), "gitcode");
  const git = Bun.serve({ port: 0, fetch: (req) => gitHttp(req, [env.ARTIFACTS]) });
  git.unref();
  env.ARTIFACTS.remoteBase = `http://127.0.0.1:${git.port}`;
  await applyD1Migrations(env.DB, join(import.meta.dir, "../migrations"));
  /** Call the app as `user` (a name, or null for logged out). */
  return Object.assign((user: string | null, path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (user) headers.set("cookie", `gc_user=${user}`);
    return worker.fetch(new Request("http://gitcode.local" + path, { ...init, headers }), env);
  }, { artifacts: env.ARTIFACTS as LocalArtifacts });
}

export type Call = (user: string | null, path: string, init?: RequestInit) => Promise<Response>;

/** The same caller shape over HTTP, for a running app (`--url`). */
export function remote(base: string, extraCookie = ""): Call {
  return (user, path, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("cookie", [user ? `gc_user=${user}` : "", extraCookie].filter(Boolean).join("; "));
    return fetch(base.replace(/\/$/, "") + path, { ...init, headers });
  };
}
