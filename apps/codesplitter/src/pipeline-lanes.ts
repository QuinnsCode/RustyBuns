// Layout: the pipeline's lanes driving the checks: each lane's count kept per repo in D1, and Ester's call on a change's files
/**
 * A repo with a `codesplitter.pipeline.json` on main (pipeline.ts) has its checks queued by lane (checks.ts):
 * only the lanes whose call is `run` or `depart` queue anything. A lane with a `run` command queues that command
 * as a check named after the lane; one without queues the repo's own checks (codesplitter.ci or package.json). A
 * bus with no command departs into an AI pass, which queues no check. A repo with no pipeline file keeps the plain
 * queue: the default pipeline is one lane that runs everything.
 *
 * Each lane's count since it last ran lives in `lane_counts`, so nobody passes counts in. A branch's checks read
 * them; a change landing on main (a commit, a merge) moves them on with tally(), and a release cut (cutRelease in
 * checks.ts: the pipeline's Release button, or a version tag made here) runs every often and release lane and sends
 * every bus off, so they all start again at 0.
 */

import { type Env } from "./env.ts";
import { repoPipeline } from "./pipeline-hooks.ts";
import { PIPELINE_FILE, laneCall, tally, type Lane, type LaneCall } from "./pipeline.ts";

/** Each lane's count since it last ran in this repo. */
export async function laneCounts(env: Env, owner: string, repo: string): Promise<Record<string, number>> {
  const { results } = await env.DB.prepare("SELECT lane, n FROM lane_counts WHERE owner = ? AND repo = ?").bind(owner, repo).all<{ lane: string; n: number }>();
  return Object.fromEntries(results.map((r) => [r.lane, r.n]));
}

/** A change landed: each lane's count moves on (a lane that ran starts again at 0). */
export async function keepCounts(env: Env, owner: string, repo: string, calls: LaneCall[]) {
  const before = await laneCounts(env, owner, repo), after = tally(before, calls);
  const moved = Object.entries(after).filter(([lane, n]) => before[lane] !== n);
  if (!moved.length) return;
  const put = env.DB.prepare("INSERT INTO lane_counts (owner, repo, lane, n) VALUES (?, ?, ?, ?) ON CONFLICT (owner, repo, lane) DO UPDATE SET n = excluded.n");
  await env.DB.batch(moved.map(([lane, n]) => put.bind(owner, repo, lane, n)));
}

/** Ester's call on each of the repo's lanes for a change touching `files` (or a release being cut: every often and release lane runs, every bus leaves), or null without a pipeline file (or with one that doesn't parse). */
export async function laneCalls(env: Env, owner: string, repo: string, files: string[], release = false): Promise<{ lane: Lane; call: LaneCall }[] | null> {
  const p = await repoPipeline(env, owner, repo).catch(() => null);
  if (!p || "error" in p || p.source !== PIPELINE_FILE) return null;
  const counts = await laneCounts(env, owner, repo);
  return (p.pipeline.lanes ?? []).map((lane) => ({ lane, call: laneCall(lane, { files, counts, release }) }));
}
