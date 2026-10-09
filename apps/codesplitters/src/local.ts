// The whole app in-process with the local twins: what the tests and the agents
// demo run against. The only server is the git one Artifacts remotes need. The desktop build wires the same pieces.

import { LocalArtifacts, applyD1Migrations, d1, durableObject, gitHttp, installCloudflareGlobals } from "@rustybuns/shell-bun";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import worker, { FileDurableObject, GameRoom } from "./worker.ts";

export async function local(extra: Record<string, string> = {}) {
  installCloudflareGlobals();
  const env: any = { DB: d1(":memory:"), ...extra };
  env.FILES = durableObject(FileDurableObject as any, env);
  env.GAMES = durableObject(GameRoom as any, env);
  // Artifacts: bare repos in a temp dir, behind a git HTTP server of their own.
  const dir = mkdtempSync(join(tmpdir(), "codesplitters-artifacts-"));
  env.ARTIFACTS = new LocalArtifacts(dir, "codesplitters");
  const git = Bun.serve({ port: 0, fetch: (req) => gitHttp(req, [env.ARTIFACTS]) });
  git.unref();
  env.ARTIFACTS.remoteBase = `http://127.0.0.1:${git.port}`;
  await applyD1Migrations(env.DB, join(import.meta.dir, "../migrations"));
  /** Call the app as `user` (a name, or null for logged out). */
  return Object.assign((user: string | null, path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (user) headers.set("cookie", [`cs_user=${user}`, headers.get("cookie")].filter(Boolean).join("; "));
    return worker.fetch(new Request("http://codesplitters.local" + path, { ...init, headers }), env);
  }, {
    artifacts: env.ARTIFACTS as LocalArtifacts,
    env,
    /** Stop the git server and delete the temp repos. */
    close() { git.stop(true); rmSync(dir, { recursive: true, force: true }); },
  });
}

export type Call = (user: string | null, path: string, init?: RequestInit) => Promise<Response>;

/** The same caller shape over HTTP, for a running app (`--url`). */
export function remote(base: string, extraCookie = ""): Call {
  return (user, path, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("cookie", [user ? `cs_user=${user}` : "", extraCookie].filter(Boolean).join("; "));
    return fetch(base.replace(/\/$/, "") + path, { ...init, headers });
  };
}
