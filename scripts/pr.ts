// A pull request's checks in one call: `bun run pr <n>` waits until every check has finished (polling here, not in
// the agent's turns), then prints one line per outcome and, for a failed check, the tail of its failed step's log,
// already stripped of timestamps and noise. One call in place of the `gh pr checks` / `sleep 30` / `gh run view
// --log-failed | grep` loop (2,285 such calls in 14 days of sessions, Dexter counted).
//
//   bun run pr 3155              wait (up to 20 min), then the summary
//   bun run pr 3155 --no-wait    the summary now
//   bun run pr 3155 --minutes 5  wait at most 5 min
//
// It also spots the GitHub miss from AGENTS.md (#2828): a head pushed minutes ago with no typecheck or apps run
// attached, which an empty commit won't fix and a rebase + force-with-lease does. A run that is only queued (no runner
// free yet) isn't in the PR's checks either, so before calling it a miss it asks Actions for runs on the head SHA (#4240).
// And a stuck check (#5391): its run finished minutes ago but the check still says running, so the PR can't merge until
// a new head starts a fresh run (`gh pr update-branch <n> --rebase`).
// A head that is the after workflow's merge of main (scripts/after.ts, committed as `rustybuns-after`) gets no run at
// all while after.yml pushes with its own token (#5733): it says so and that any push of your own starts CI.
// A red `apps` run on a worker's PR (office/<name>) costs that worker trust on the builder's dial (#5605, `learn` in ci-tier.ts).
import { classify, learn } from "./ci-tier.ts";
import { arr, bool, check, num, obj, oneOf, opt, str, type Of } from "../packages/util/src/guard.ts";

const text = (max: number) => opt(str(max, { min: 0 }));
/** `gh pr view --json` with FIELDS. A StatusContext (a non-Actions check) has `context` and `state` where a CheckRun has `name`, `status` and `conclusion`; `gh` leaves the others as "" or null. */
export const Pr = obj({
  number: num(1, 1e9), title: str(400, { min: 0 }), url: str(400), state: oneOf(["OPEN", "CLOSED", "MERGED"]), isDraft: bool(false), mergeable: str(40, { min: 0, dflt: "" }), mergeStateStatus: str(40, { min: 0, dflt: "" }),
  baseRefName: str(200), headRefName: str(200), headRefOid: str(64),
  statusCheckRollup: arr(obj({ name: text(200), status: text(40), conclusion: text(40), detailsUrl: text(400), workflowName: text(200), startedAt: text(40), completedAt: text(40), context: text(200), state: text(40) }), 500, { drop: true }),
  commits: arr(obj({ committedDate: str(40), authors: opt(arr(obj({ name: text(200) }), 20, { drop: true })) }), 500, { drop: true }),
});
export type Pr = Of<typeof Pr>;
export const FIELDS = "number,title,url,state,isDraft,mergeable,mergeStateStatus,baseRefName,headRefName,headRefOid,statusCheckRollup,commits";

export interface Outcome { name: string; outcome: "pass" | "fail" | "skip" | "pending" | "other"; seconds?: number; url?: string }

/** Each check as pass / fail / skip / pending, in rollup order. */
export function outcomes(pr: Pr): Outcome[] {
  return pr.statusCheckRollup.map((c) => {
    const name = c.name ?? c.context ?? "?", url = c.detailsUrl;
    const verdict = (c.conclusion ?? c.state ?? "").toUpperCase();
    const done = c.status ? c.status === "COMPLETED" : verdict !== "PENDING" && verdict !== "EXPECTED";
    const seconds = c.startedAt && c.completedAt ? Math.max(0, Math.round((Date.parse(c.completedAt) - Date.parse(c.startedAt)) / 1000)) : undefined;
    const outcome: Outcome["outcome"] = !done ? "pending" : verdict === "SUCCESS" ? "pass" : verdict === "SKIPPED" || verdict === "NEUTRAL" ? "skip" : verdict === "FAILURE" || verdict === "TIMED_OUT" || verdict === "ERROR" || verdict === "CANCELLED" || verdict === "ACTION_REQUIRED" || verdict === "STARTUP_FAILURE" ? "fail" : "other";
    return { name, outcome, seconds, url };
  });
}

/** `gh run list --commit <sha> --json` with RUN_FIELDS: the head's workflow runs, queued ones included. */
export const Runs = arr(obj({ databaseId: opt(num(0, 1e15)), workflowName: str(200, { min: 0, dflt: "" }), status: str(40, { min: 0, dflt: "" }), conclusion: text(40), updatedAt: text(40) }), 200, { drop: true });
export type Runs = Of<typeof Runs>;
export const RUN_FIELDS = "databaseId,workflowName,status,conclusion,updatedAt";
const CI = /^(typecheck|apps)$/;

/** Where the head's typecheck and apps runs stand on Actions: none at all, waiting for a runner, running, or done. */
export function headRuns(runs: Runs): "none" | "queued" | "running" | "done" {
  const ci = runs.filter((r) => CI.test(r.workflowName));
  if (!ci.length) return "none";
  if (ci.some((r) => r.status === "in_progress")) return "running";
  return ci.some((r) => r.status !== "completed") ? "queued" : "done";
}

/** A run can finish a few seconds before its last job's check does; past this many seconds the check is stuck. */
export const STUCK_AFTER = 120;
/** Checks that still say running though their Actions run completed STUCK_AFTER seconds ago (#5391): GitHub lost the job's end, and only a new head clears it. */
export function stuck(pr: Pr, now = Date.now(), runs: Runs = []): Outcome[] {
  const done = new Set(runs.filter((r) => r.status === "completed" && r.databaseId && r.updatedAt && (now - Date.parse(r.updatedAt)) / 1000 > STUCK_AFTER).map((r) => String(r.databaseId)));
  return pr.state === "OPEN" ? outcomes(pr).filter((o) => o.outcome === "pending" && o.url && done.has(jobOf(o.url)?.run ?? "")) : [];
}

/** True once no check is still running. An open PR with no checks at all is not settled: they may not be attached yet. A run still queued or running on Actions keeps it unsettled. */
export const settled = (pr: Pr, now = Date.now(), runs: Runs = []) => {
  if (pr.state !== "OPEN") return true;
  const stage = headRuns(runs);
  if (stage === "queued" || stage === "running") return false;
  const jammed = new Set(stuck(pr, now, runs).map((o) => o.url));
  return (pr.statusCheckRollup.length > 0 && outcomes(pr).every((o) => o.outcome !== "pending" || jammed.has(o.url))) || missedRun(pr, now, runs);
};

/** How long ago the head commit was made, in seconds. */
const headAge = (pr: Pr, now: number) => { const t = pr.commits.at(-1)?.committedDate; return t ? (now - Date.parse(t)) / 1000 : 0; };
/** No typecheck or apps check in the PR's rollup. */
const unattached = (pr: Pr) => noCi(pr.statusCheckRollup);
/** The GitHub miss (#2828): the head is minutes old, neither the typecheck nor the apps workflow attached a check, and Actions has no run of either on the head SHA (a queued one is a wait, not a miss). */
export const MISS_AFTER = 120;
export const missedRun = (pr: Pr, now = Date.now(), runs: Runs = [], after = MISS_AFTER) =>
  pr.state === "OPEN" && headAge(pr, now) > after && unattached(pr) && headRuns(runs) === "none";
/** How long a head may go with no typecheck or apps check before Mervin's board marks it and tells its worker (#5838). */
export const STALL_AFTER = 600;
/** The board's plain-words line for a head with no checks: no rollup check names CI and no run on it, past STALL_AFTER; null otherwise. */
export const stallOf = (pr: Pr, now = Date.now(), runs: Runs = []) => !missedRun(pr, now, runs, STALL_AFTER) ? null
  : botHead(pr) ? "after-bot push, no checks will come: push one commit" : "GitHub miss (#2828): rebase onto origin/main and push --force-with-lease";
/** No typecheck or apps check in a rollup of named checks (the board's `gh pr list` rows). */
export const noCi = (rollup: { name?: string; workflowName?: string }[]) => !rollup.some((c) => CI.test(c.workflowName ?? "") || CI.test(c.name ?? ""));
/** The after workflow's git name (after.yml): its merge-main pushes start no checks while it pushes with the workflow's own token (#5733). */
export const AFTER_BOT = "rustybuns-after";
/** The head commit is the after workflow's merge of main. */
export const botHead = (pr: Pr) => (pr.commits.at(-1)?.authors ?? []).some((a) => a.name === AFTER_BOT);
/** What to do about a head with no run: the after bot's push needs one push of your own; GitHub's own miss needs a new merge-base. */
const missFix = (pr: Pr) => botHead(pr)
  ? `the head is the after workflow's merge of main (${AFTER_BOT}), and GitHub starts no checks for a push made with a workflow's own token (#5733). Push one commit of your own on top: git fetch origin && git checkout -B ${pr.headRefName} origin/${pr.headRefName} && git commit --allow-empty -m "Start CI" && git push origin ${pr.headRefName}`
  : "a GitHub miss (#2828). Rebase onto origin/main and git push --force-with-lease; an empty commit won't help.";
/** Whether to ask Actions for the head's runs: the rollup has no typecheck or apps check yet, or a check still runs (it may be stuck). */
export const needRuns = (pr: Pr) => pr.state === "OPEN" && (unattached(pr) || outcomes(pr).some((o) => o.outcome === "pending"));

const dur = (s?: number) => (s === undefined ? "" : s >= 60 ? ` ${Math.floor(s / 60)}m${s % 60}s` : ` ${s}s`);

/** The summary: a header line, then one line per outcome kind (pass, skip, pending, fail) with the checks on it. */
export function summarize(pr: Pr, now = Date.now(), runs: Runs = []): string[] {
  const merge = pr.state === "OPEN" ? ` ${pr.mergeStateStatus.toLowerCase()}${pr.isDraft ? " draft" : ""}` : "";
  const out = [`#${pr.number} ${pr.state}${merge} ${pr.baseRefName} <- ${pr.headRefName} ${pr.headRefOid.slice(0, 7)}  ${pr.title}`];
  const os = outcomes(pr), byKind = (k: Outcome["outcome"]) => os.filter((o) => o.outcome === k);
  const queued = unattached(pr) ? runs.filter((r) => CI.test(r.workflowName) && r.status !== "completed") : [];
  if (queued.length) out.push(`  queued  ${queued.map((r) => r.workflowName).join(" | ")}  waiting for a runner, not a miss: don't push`);
  else if (!os.length && pr.mergeStateStatus === "DIRTY") out.push("  no runs: it conflicts with main, and GitHub runs no checks until it merges cleanly. Rebase onto origin/main (only your own commits) and git push --force-with-lease.");
  else if (!os.length) out.push(missedRun(pr, now, runs) ? `  no typecheck or apps run attached ${Math.round(headAge(pr, now) / 60)} min after the push: ${missFix(pr)}` : "  no checks yet");
  const jammed = stuck(pr, now, runs), jammedUrls = new Set(jammed.map((o) => o.url));
  for (const [kind, label] of [["pass", "pass"], ["skip", "skip"], ["other", "other"], ["pending", "running"]] as const) {
    const xs = byKind(kind).filter((o) => kind !== "pending" || !jammedUrls.has(o.url));
    if (xs.length) out.push(`  ${label.padEnd(7)} ${xs.map((o) => o.name + (kind === "pass" ? dur(o.seconds) : "")).join(" | ")}`);
  }
  if (jammed.length) out.push(`  STUCK   ${jammed.map((o) => o.name).join(" | ")}  its run finished but the check still says running, so the PR can't merge (#5391). A new head clears it: gh pr update-branch ${pr.number} --rebase`);
  for (const o of byKind("fail")) out.push(`  FAIL    ${o.name}${dur(o.seconds)}  ${o.url ?? ""}`.trimEnd());
  if (os.length && missedRun(pr, now, runs)) out.push(`  no typecheck or apps run attached: ${missFix(pr)}`);
  return out;
}

/** The run and job ids in an Actions details URL. */
export const jobOf = (url: string) => { const m = /\/actions\/runs\/(\d+)\/job\/(\d+)/.exec(url); return m ? { run: m[1]!, job: m[2]! } : null; };

/** The last `keep` lines of a `gh run view --log-failed` log worth reading: the job/step/timestamp prefix, colour codes, group markers and blank lines gone. */
export function trimLog(log: string, keep = 40): string[] {
  const lines = log.split("\n")
    .map((l) => l.replace(/^[^\t]*\t[^\t]*\t/, "").replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, "").replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trimEnd())
    .filter((l) => l && !/^##\[(group|endgroup|debug)\]/.test(l) && !/^Post job cleanup\.?$|^Cleaning up orphan processes$/.test(l));
  const tail = lines.slice(-keep);
  return lines.length > keep ? [`… ${lines.length - keep} earlier lines`, ...tail] : tail;
}

/** A worker's red GitHub `apps` run, for the trust dial: who (office/<name>), its Actions run and when it ended. Not a worker's branch, or no red apps job (a cancelled one is a newer push, not a red): nothing. */
export function appsRed(pr: Pr): { who: string; run: string; at: number } | undefined {
  const who = /^office\/(.+)$/.exec(pr.headRefName)?.[1];
  if (!who) return undefined;
  const all = outcomes(pr);
  const i = all.findIndex((o, j) => o.outcome === "fail" && pr.statusCheckRollup[j]?.workflowName === "apps" && pr.statusCheckRollup[j]?.conclusion !== "CANCELLED");
  const run = i >= 0 && all[i]!.url ? jobOf(all[i]!.url!)?.run : undefined;
  if (!run) return undefined;
  const end = Date.parse(pr.statusCheckRollup[i]!.completedAt ?? "");
  return { who, run, at: Number.isFinite(end) ? end : Date.now() };
}

const sh = async (...cmd: string[]) => { const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" }); const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]); return { code: await p.exited, out, err }; };

/** The head SHA's workflow runs on Actions (empty when gh can't say). */
export async function runsOn(sha: string): Promise<Runs> {
  const r = await sh("gh", "run", "list", "--commit", sha, "--json", RUN_FIELDS, "-L", "50");
  if (r.code) return [];
  try { return check(Runs, JSON.parse(r.out)) ?? []; } catch { return []; }
}

export async function view(n: number): Promise<Pr> {
  const r = await sh("gh", "pr", "view", String(n), "--json", FIELDS);
  if (r.code) throw new Error(r.err.trim() || `gh pr view ${n} failed`);
  const pr = check(Pr, JSON.parse(r.out));
  if (!pr) throw new Error(`gh pr view ${n}: unexpected shape`);
  return pr;
}

/** The failed step's log tail for one failed check (empty when the check isn't an Actions job). */
export async function failedLog(url: string | undefined, keep = 40): Promise<string[]> {
  const ids = url && jobOf(url);
  if (!ids) return [];
  const r = await sh("gh", "run", "view", ids.run, "--job", ids.job, "--log-failed");
  return trimLog(r.out || r.err, keep);
}

if (import.meta.main) {
  const args = process.argv.slice(2), n = Number(args.find((a) => /^\d+$/.test(a)));
  if (!n) { console.error("usage: bun run pr <number> [--no-wait] [--minutes <m>]"); process.exit(2); }
  const wait = !args.includes("--no-wait"), minutes = Number(args[args.indexOf("--minutes") + 1]) || 20, until = Date.now() + minutes * 60_000;
  let pr = await view(n).catch((e: Error) => { console.error(e.message); process.exit(2); });
  const look = async () => (needRuns(pr) ? runsOn(pr.headRefOid) : []);
  let runs = await look();
  while (wait && !settled(pr, Date.now(), runs) && Date.now() < until) { await Bun.sleep(20_000); pr = await view(n); runs = await look(); }
  console.log(summarize(pr, Date.now(), runs).join("\n"));
  // GitHub hasn't started the checks: the test swarm (apps/test-swarm) can run them on our own Macs instead.
  if (pr.state === "OPEN" && unattached(pr) && process.env.SWARM_URL) console.log("  GitHub is slow: `bun run builder queue` from the PR's branch sends its suites to the test swarm");
  for (const o of outcomes(pr).filter((o) => o.outcome === "fail")) { const log = await failedLog(o.url); if (log.length) console.log(`--- ${o.name}\n${log.join("\n")}`); }
  const red = appsRed(pr);
  if (red) {
    const diff = await sh("gh", "pr", "diff", String(n), "--name-only");
    const tier = classify(diff.code ? [] : diff.out.split("\n").filter(Boolean));
    if (!diff.code && (await learn({ ...red, tier, passed: false }).catch(() => false))) console.log(`  trust dial: ${red.who}'s next tier ${tier} builder run is the whole suite (red apps run ${red.run})`);
  }
  if (wait && !settled(pr, Date.now(), runs)) console.log(`  still running after ${minutes} min`);
  process.exit(outcomes(pr).some((o) => o.outcome === "fail") || stuck(pr, Date.now(), runs).length ? 1 : 0);
}
