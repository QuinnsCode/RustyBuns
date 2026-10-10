// The whole app in-process with the local twins: what the tests and the agents
// demo run against. The only server is the git one Artifacts remotes need. The desktop build wires the same pieces.

import { LocalArtifacts, applyD1Migrations, d1, durableObject, gitHttp, installCloudflareGlobals, queue } from "@rustybuns/shell-bun";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import worker, { FileDurableObject, GameRoom } from "./worker.ts";

export async function local(extra: Record<string, unknown> = {}) {
  installCloudflareGlobals();
  const env: any = { DB: d1(":memory:"), ...extra };
  env.FILES = durableObject(FileDurableObject as any, env);
  env.GAMES = durableObject(GameRoom as any, env);
  // Webhook tries, consumed in-process as the desktop host does.
  env.HOOKS = queue(":memory:", "codesplitters-hooks");
  const stopHooks = env.HOOKS.consume((batch: any) => worker.queue(batch, env));
  // Queued requests' messages, likewise.
  env.JOBS = queue(":memory:", "codesplitters-jobs");
  const stopJobs = env.JOBS.consume((batch: any) => worker.queue(batch, env));
  // Level digs, likewise: an import's first step, and a big level's parts.
  env.LEVEL_DIGS = queue(":memory:", "codesplitters-level-digs");
  const stopDigs = env.LEVEL_DIGS.consume((batch: any) => worker.queue(batch, env), { maxRetries: 3 });
  // Artifacts: bare repos in a temp dir, behind a git HTTP server of their own.
  const dir = mkdtempSync(join(tmpdir(), "codesplitters-artifacts-"));
  // An `ARTIFACTS` passed in wins (scripts/fresh-check.ts brings Cloudflare's).
  const artifacts = new LocalArtifacts(dir, "codesplitters");
  env.ARTIFACTS ??= artifacts;
  const git = Bun.serve({ port: 0, fetch: (req) => gitHttp(req, [artifacts]) });
  git.unref();
  artifacts.remoteBase = `http://127.0.0.1:${git.port}`;
  await applyD1Migrations(env.DB, join(import.meta.dir, "../migrations"));
  /** Call the app as `user` (a name, or null for logged out). */
  return Object.assign((user: string | null, path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (user) headers.set("cookie", [`cs_user=${user}`, headers.get("cookie")].filter(Boolean).join("; "));
    return worker.fetch(new Request("http://codesplitters.local" + path, { ...init, headers }), env);
  }, {
    artifacts: env.ARTIFACTS as LocalArtifacts,
    env,
    /** Stop the queue consumers and the git server, and delete the temp repos. */
    close() { stopHooks(); stopJobs(); stopDigs(); git.stop(true); rmSync(dir, { recursive: true, force: true }); },
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
