// The test swarm's Worker (#4758): a queue of test jobs any of our Macs pulls from when GitHub is slow, and the
// `typecheck` and `apps` commit statuses once a SHA's suites are all green. Every route takes the swarm token, so
// only our own agents add jobs and only our own machines take them: no fork's code reaches a runner, which is why
// this isn't a GitHub self-hosted runner (scripts/ci-guard.ts).
//
//   POST /enqueue { sha, branch, suites }    an agent queues a SHA's suites (rows of scripts/ci-apps.ts)
//   POST /lease   { runner, seconds? }       a runner takes the oldest job, or { job: null }
//   POST /extend  { lease, seconds? }        still on it: the lease runs on
//   POST /report  { lease, ok, log }         how it went; 409 when the lease ran out first
//   GET  /jobs?sha=                          where each suite of a SHA stands
//   GET  /queue                              every job not finished, in lease order, with who holds it (the builder board)
import { json } from "@rustybuns/util/http";
import { sha256 } from "@rustybuns/util/bytes";
import type { QueueEnv } from "./queue.ts";

export { Queue } from "./queue.ts";

type Stub = { fetch(req: Request): Promise<Response> };
export type Env = QueueEnv & {
  QUEUE: { idFromName(name: string): unknown; get(id: unknown): Stub };
  /** The bearer token our agents and runners send. Unset, every route is shut. */
  SWARM_TOKEN?: string;
};

/** Compared as digests, so the time taken says nothing about how much of the token was right. */
async function allowed(req: Request, token: string): Promise<boolean> {
  const got = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  return !!got && (await sha256(got)) === (await sha256(token));
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (!env.SWARM_TOKEN) return json({ error: "the swarm has no token set" }, 503);
    if (!(await allowed(req, env.SWARM_TOKEN))) return json({ error: "not one of ours" }, 401);
    return env.QUEUE.get(env.QUEUE.idFromName("swarm")).fetch(req);
  },
};
