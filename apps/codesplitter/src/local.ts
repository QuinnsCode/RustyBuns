// The whole app in-process with the local twins: what the tests and the agents
// demo run against. The only server is the git one Artifacts remotes need. The desktop build wires the same pieces.

import { LocalArtifacts, applyD1Migrations, d1, durableObject, gitHttp, installCloudflareGlobals, queue, workerLoader } from "@rustybuns/shell-bun";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import worker, { FileDurableObject, GameRoom, RepoSearch, UserSettings } from "./worker.ts";

// Each queue here is consumed at once, not through the host scheduler: that one is the process's, and holds its slots for
// the CPU budget and for every other instance's deliveries, so in a busy test process a dig waited past a test's timeout (#1446).
const now = { run: (_priority: unknown, fn: (job?: any) => unknown) => Promise.resolve(fn()) } as any;

export async function local(extra: Record<string, unknown> = {}) {
  installCloudflareGlobals();
  // The tests claim check runs themselves, so the desktop's own runner stays off unless asked for.
  const env: any = { DB: d1(":memory:"), CHECKS_RUNNER: "off", ...extra };
  env.FILES = durableObject(FileDurableObject as any, env);
  env.GAMES = durableObject(GameRoom as any, env);
  env.SEARCH = durableObject(RepoSearch as any, env);
  env.SETTINGS = durableObject(UserSettings as any, env);
  // Webhook tries, consumed in-process as the desktop host does.
  env.HOOKS = queue(":memory:", "codesplitter-hooks");
  const stopHooks = env.HOOKS.consume((batch: any) => worker.queue(batch, env), { scheduler: now });
  // Queued requests' messages, likewise.
  env.JOBS = queue(":memory:", "codesplitter-jobs");
  const stopJobs = env.JOBS.consume((batch: any) => worker.queue(batch, env), { scheduler: now });
  // Fix tasks, likewise, in a queue of their own.
  env.FIXES = queue(":memory:", "codesplitter-fixes");
  const stopFixes = env.FIXES.consume((batch: any) => worker.queue(batch, env), { scheduler: now });
  // Level digs, likewise: an import's first step, and a big level's parts.
  env.LEVEL_DIGS = queue(":memory:", "codesplitter-level-digs");
  const stopDigs = env.LEVEL_DIGS.consume((batch: any) => worker.queue(batch, env), { maxRetries: 3, scheduler: now });
  // Artifacts: bare repos in a temp dir, behind a git HTTP server of their own.
  const dir = mkdtempSync(join(tmpdir(), "codesplitter-artifacts-"));
  // An `ARTIFACTS` passed in wins (scripts/fresh-check.ts brings Cloudflare's).
  const artifacts = new LocalArtifacts(dir, "codesplitters");
  env.ARTIFACTS ??= artifacts;
  const git = Bun.serve({ port: 0, fetch: (req) => gitHttp(req, [artifacts]) });
  git.unref();
  artifacts.remoteBase = `http://127.0.0.1:${git.port}`;
  // Code mode's programs run in the local Worker Loader. Off unless asked for (`LOADER: true`): the desktop has it on, tests that aren't about it want the plain tool list.
  if (extra.LOADER === true) env.LOADER = workerLoader(join(dir, "loader")); else delete env.LOADER;
  await applyD1Migrations(env.DB, join(import.meta.dir, "../migrations"));
  /** Call the app as `user` (a name, or null for logged out). */
  return Object.assign((user: string | null, path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (user) headers.set("cookie", [`cs_user=${user}`, headers.get("cookie")].filter(Boolean).join("; "));
    return worker.fetch(new Request("http://codesplitter.local" + path, { ...init, headers }), env);
  }, {
    artifacts: env.ARTIFACTS as LocalArtifacts,
    env,
    /** Stop the queue consumers and the git server, and delete the temp repos. */
    close() { stopHooks(); stopJobs(); stopFixes(); stopDigs(); git.stop(true); rmSync(dir, { recursive: true, force: true }); },
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
