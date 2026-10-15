// The app's side of the watchdog (#1562, watchdog/worker.ts), two routes:
//   GET  /api/health                 200 if the app answers and reads its database, else 503
//   POST /api/watchdog/rolled-back   {repo: "owner/name", from, to, at}: a rollback happened. Bearer WATCHDOG_SECRET.
// A rollback is told to the repo's hooks as a failed `deploy.finished`, the same event a deploy that
// failed sends, so it shows wherever deploys do. Without WATCHDOG_SECRET the second route is off.

import { json, readBody, type Env } from "./env.ts";
import { materializeOn } from "./branches.ts";
import { openFix } from "./heal.ts";
import { emit } from "./hooks.ts";
import { repoRow } from "./repos.ts";
import { sha256 } from "./util.ts";

export async function watchdogRoutes(req: Request, env: Env, p: string[]): Promise<Response | null> {
  if (p[1] === "health" && !p[2] && req.method === "GET") {
    const ok = await env.DB.prepare("SELECT 1 AS ok").first().then((r: unknown) => !!r).catch(() => false);
    return json({ ok }, ok ? 200 : 503);
  }
  if (!(p[1] === "watchdog" && p[2] === "rolled-back" && !p[3] && req.method === "POST")) return null;
  const secret = env.WATCHDOG_SECRET, given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  // Compared as digests so the check takes the same time wherever it differs.
  if (!secret || (await sha256(given)) !== (await sha256(secret))) return json({ error: "not found" }, 404);
  const b = await readBody<"repo" | "from" | "to" | "at">(req);
  const [owner, repo] = typeof b.repo === "string" ? b.repo.split("/") : [];
  if (!owner || !repo || typeof b.from !== "string" || typeof b.to !== "string") return json({ error: "repo (owner/name), from and to" }, 400);
  if (!(await repoRow(env, owner, repo, "1"))) return json({ error: "not found" }, 404);
  const at = typeof b.at === "number" ? b.at : Date.now(), who = await shippedBy(env, owner, repo, at);
  await env.DB.prepare("INSERT INTO rollbacks (owner, repo, from_version, to_version, deploy_id, commit_hash, branch, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(owner, repo, b.from, b.to, who.deploy, who.commit, who.branch, at).run();
  await emit(env, owner, repo, "deploy.finished", "watchdog", {
    deployment: { id: `rollback-${b.to.slice(0, 8)}`, sha: who.commit, environment: "production", task: "rollback", creator: { login: "watchdog" } },
    deployment_status: { state: "failure", environment: "production", environment_url: null, description: `rolled back from version ${b.from} to ${b.to}: the app failed its health check${who.branch ? `; shipped by branch ${who.branch}` : ""}` },
  });
  const fix = await rollbackFix(env, owner, repo, who.branch, b.from, b.to);
  return json({ ok: true, ...(fix && { fix }) });
}

/**
 * The fix task for a rollback: the branch that shipped it is merged, so openFix has nothing to work on there.
 * It opens on a fresh branch off main, `rollback-<to>`, on a file the shipping branch changed. Null when
 * self-healing is off, nothing is known of the shipping branch, or a fix task is running on it already.
 */
export async function rollbackFix(env: Env, owner: string, repo: string, shipped: string | null, from: string, to: string) {
  if (!shipped) return null;
  const changed = ((await env.DB.prepare("SELECT path FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? AND deleted = 0 AND blob IS NULL ORDER BY path LIMIT 20").bind(owner, repo, shipped).all()).results as { path: string }[]).map((r) => r.path);
  if (!changed.length) return null;
  const name = `rollback-${to.replace(/[^\w.-]/g, "").slice(0, 12) || "v"}`;
  await env.DB.prepare("INSERT OR IGNORE INTO branches (owner, repo, name, by, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)").bind(owner, repo, name, owner, Date.now()).run();
  const files: string[] = [];
  for (const f of changed) if ("ok" in (await materializeOn(env, owner, repo, name, f))) files.push(f);
  const path = files[0];
  if (!path) return null;
  const task = `The app failed its health check after branch ${shipped} shipped (version ${from}), and the watchdog rolled back to ${to}. Find what in ${shipped}'s changes broke it and fix it on this branch, built on main. Files it changed: ${files.join(", ")}.`;
  const r = await openFix(env, owner, repo, name, path, task, files.slice(1));
  return "id" in r ? { branch: name, task: r.id } : null;
}

/** The deploy live when the app broke (the last real one to finish by `at`), its commit, and the branch merged last before it. */
export async function shippedBy(env: Env, owner: string, repo: string, at: number) {
  const d = await env.DB.prepare("SELECT id, commit_hash, at FROM deploys WHERE owner = ? AND repo = ? AND trigger != 'preview' AND status = 'done' AND at <= ? ORDER BY at DESC LIMIT 1").bind(owner, repo, at).first();
  const b = d && await env.DB.prepare("SELECT name FROM branches WHERE owner = ? AND repo = ? AND status = 'merged' AND merged_at <= ? ORDER BY merged_at DESC LIMIT 1").bind(owner, repo, d.at as number).first();
  return { deploy: (d?.id as string) ?? null, commit: (d?.commit_hash as string) ?? null, branch: (b?.name as string) ?? null };
}

/** A repo's last rollbacks, newest first (for its deploy panel). */
export async function rollbacks(env: Env, owner: string, repo: string) {
  const { results } = await env.DB.prepare("SELECT from_version, to_version, deploy_id, commit_hash, branch, at FROM rollbacks WHERE owner = ? AND repo = ? ORDER BY at DESC LIMIT 10").bind(owner, repo).all();
  return results;
}
