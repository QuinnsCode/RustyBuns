// What the test swarm's routes take and answer (#4758): one guard per shape, imported by the Worker and by whoever
// calls it (`bun run builder join`, step 2). No Bun or DOM here.
import { arr, bool, int, nul, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";

/** A commit: GitHub's full 40-character SHA, so a status lands on exactly that commit. */
export const Sha = str(40, { min: 40, re: /^[0-9a-f]{40}$/ });
/** One row of what scripts/ci-apps.ts lists: "typecheck", an app ("codesplitter"), or an app's shard ("codesplitter:2/3"). */
export const Suite = str(80, { re: /^[a-z0-9][a-z0-9:/._-]*$/ });

/** POST /enqueue: every suite this SHA needs green. Enqueuing a SHA again adds suites and reruns the ones named. */
export const Enqueue = obj({ sha: Sha, branch: str(200, { min: 1 }), suites: arr(Suite, 200, { min: 1 }) });
export type Enqueue = Of<typeof Enqueue>;

/** POST /lease: a runner checks in for one job, held for `seconds` unless it reports or extends first. */
export const LeaseAsk = obj({ runner: str(80, { min: 1 }), seconds: opt(int(1, 3600)) });
export const Job = obj({ id: int(1, Number.MAX_SAFE_INTEGER), sha: Sha, branch: str(200), suite: Suite, lease: str(64), until: int(0, Number.MAX_SAFE_INTEGER) });
export type Job = Of<typeof Job>;
export const LeaseReply = obj({ job: nul(Job) });
export type LeaseReply = Of<typeof LeaseReply>;

/** POST /extend: a runner still on its job says so, and its lease runs `seconds` from now. */
export const Extend = obj({ lease: str(64, { min: 1 }), seconds: opt(int(1, 3600)) });
/** POST /report: how the suite went, with the end of its log (cut to the last 4000 characters by the runner). */
export const Report = obj({ lease: str(64, { min: 1 }), ok: bool(), log: str(4000, { dflt: "" }) });

/** A refused lease (ran out, or was never this runner's): the runner drops the job, which is someone else's now. */
export const Ok = obj({ ok: bool() });

export const STATES = ["queued", "leased", "passed", "failed"] as const;
/** GET /jobs?sha=: where each suite of a SHA stands. */
export const JobsReply = obj({
  jobs: arr(obj({ suite: Suite, state: oneOf(STATES), runner: str(80, { dflt: "" }), tries: int(0, 1e6), log: str(4000, { dflt: "" }) }), 200),
  posted: opt(oneOf(["success", "failure"])),
});
export type JobsReply = Of<typeof JobsReply>;

/** A lease runs this long when the runner doesn't say. */
export const LEASE_SECONDS = 600;
/** The commit statuses main's ruleset asks for. */
export const CONTEXTS = ["typecheck", "apps"] as const;
