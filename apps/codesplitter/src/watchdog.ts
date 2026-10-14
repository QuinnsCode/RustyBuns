// The app's side of the watchdog (#1562, watchdog/worker.ts), two routes:
//   GET  /api/health                 200 if the app answers and reads its database, else 503
//   POST /api/watchdog/rolled-back   {repo: "owner/name", from, to, at}: a rollback happened. Bearer WATCHDOG_SECRET.
// A rollback is told to the repo's hooks as a failed `deploy.finished`, the same event a deploy that
// failed sends, so it shows wherever deploys do. Without WATCHDOG_SECRET the second route is off.

import { json, readBody, type Env } from "./env.ts";
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
  await emit(env, owner, repo, "deploy.finished", "watchdog", {
    deployment: { id: `rollback-${b.to.slice(0, 8)}`, sha: null, environment: "production", task: "rollback", creator: { login: "watchdog" } },
    deployment_status: { state: "failure", environment: "production", environment_url: null, description: `rolled back from version ${b.from} to ${b.to}: the app failed its health check` },
  });
  return json({ ok: true });
}
