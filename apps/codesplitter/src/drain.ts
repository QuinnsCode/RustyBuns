// Before a deploy: POST /api/admin/drain {in?: seconds, cancel?: true}, bearer DRAIN_SECRET (404 without it).
// Every room with someone in it (a socket's presence, a claim held, an agent run going) hears {t:"deploy-soon", at}
// and, when `at` comes, {t:"draining"}; from then on its file takes no new claims or places in line (file-do.ts drain).
// `rustybuns deploy --drain-url` calls it, waits out the warning, then deploys. { cancel: true } lifts it.

import { json, readBody, type Env } from "./env.ts";
import { toFile } from "./archive.ts";
import { sha256 } from "./util.ts";

/** Rooms a drain reaches in one call, so a busy site can't make one request fan out for ever. */
const MAX_ROOMS = 500;

/** The files with someone in them right now. */
export async function activeRooms(env: Env) {
  const q = async (sql: string) => ((await env.DB.prepare(sql).all()).results ?? []) as { owner: string; repo: string; path: string; branch: string | null }[];
  const rows = [
    ...await q("SELECT DISTINCT owner, repo, path, NULL AS branch FROM presence"),
    ...await q("SELECT DISTINCT owner, repo, path, NULL AS branch FROM held"),
    ...await q("SELECT DISTINCT owner, repo, path, branch FROM agent_runs WHERE status = 'running'"),
  ];
  const seen = new Map(rows.map((r) => [JSON.stringify([r.owner, r.repo, r.path, r.branch]), r]));
  return [...seen.values()].slice(0, MAX_ROOMS);
}

export async function drainRoutes(req: Request, env: Env, p: string[]): Promise<Response | null> {
  if (!(p[1] === "admin" && p[2] === "drain" && !p[3] && req.method === "POST")) return null;
  const secret = env.DRAIN_SECRET, given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  // Compared as digests so the check takes the same time wherever it differs.
  if (!secret || (await sha256(given)) !== (await sha256(secret))) return json({ error: "not found" }, 404);
  const b = await readBody<"in" | "cancel">(req), rooms = await activeRooms(env);
  const sent = await Promise.all(rooms.map((r) => toFile(env, r.owner, r.repo, r.path, "drain", "drain", { method: "POST", body: JSON.stringify(b.cancel ? { cancel: true } : { in: b.in }) }, "", r.branch ?? undefined)
    .then((res) => res.ok, () => false)));
  return json({ rooms: rooms.length, drained: sent.filter(Boolean).length, ...(b.cancel ? { cancelled: true } : { in: Number(b.in) || 0 }) });
}
