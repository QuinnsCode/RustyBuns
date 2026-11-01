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
// attached, which an empty commit won't fix and a rebase + force-with-lease does.
import { arr, bool, check, num, obj, oneOf, opt, str, type Of } from "../packages/util/src/guard.ts";

const text = (max: number) => opt(str(max, { min: 0 }));
/** `gh pr view --json` with FIELDS. A StatusContext (a non-Actions check) has `context` and `state` where a CheckRun has `name`, `status` and `conclusion`; `gh` leaves the others as "" or null. */
export const Pr = obj({
  number: num(1, 1e9), title: str(400, { min: 0 }), url: str(400), state: oneOf(["OPEN", "CLOSED", "MERGED"]), isDraft: bool(false), mergeable: str(40, { min: 0, dflt: "" }), mergeStateStatus: str(40, { min: 0, dflt: "" }),
  baseRefName: str(200), headRefName: str(200), headRefOid: str(64),
  statusCheckRollup: arr(obj({ name: text(200), status: text(40), conclusion: text(40), detailsUrl: text(400), workflowName: text(200), startedAt: text(40), completedAt: text(40), context: text(200), state: text(40) }), 500, { drop: true }),
  commits: arr(obj({ committedDate: str(40) }), 500, { drop: true }),
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

/** True once no check is still running. An open PR with no checks at all is not settled: they may not be attached yet. */
export const settled = (pr: Pr, now = Date.now()) => pr.state !== "OPEN" || (pr.statusCheckRollup.length > 0 && outcomes(pr).every((o) => o.outcome !== "pending")) || missedRun(pr, now);

/** How long ago the head commit was made, in seconds. */
const headAge = (pr: Pr, now: number) => { const t = pr.commits.at(-1)?.committedDate; return t ? (now - Date.parse(t)) / 1000 : 0; };
/** The GitHub miss (#2828): the head is minutes old and neither the typecheck nor the apps workflow attached a run. */
export const MISS_AFTER = 120;
export const missedRun = (pr: Pr, now = Date.now()) =>
  pr.state === "OPEN" && headAge(pr, now) > MISS_AFTER && !pr.statusCheckRollup.some((c) => /^(typecheck|apps)$/.test(c.workflowName ?? "") || /^(typecheck|apps)$/.test(c.name ?? ""));

const dur = (s?: number) => (s === undefined ? "" : s >= 60 ? ` ${Math.floor(s / 60)}m${s % 60}s` : ` ${s}s`);

/** The summary: a header line, then one line per outcome kind (pass, skip, pending, fail) with the checks on it. */
export function summarize(pr: Pr, now = Date.now()): string[] {
  const merge = pr.state === "OPEN" ? ` ${pr.mergeStateStatus.toLowerCase()}${pr.isDraft ? " draft" : ""}` : "";
  const out = [`#${pr.number} ${pr.state}${merge} ${pr.baseRefName} <- ${pr.headRefName} ${pr.headRefOid.slice(0, 7)}  ${pr.title}`];
  const os = outcomes(pr), byKind = (k: Outcome["outcome"]) => os.filter((o) => o.outcome === k);
  if (!os.length) out.push(missedRun(pr, now) ? `  no typecheck or apps run attached ${Math.round(headAge(pr, now) / 60)} min after the push: a GitHub miss (#2828). Rebase onto origin/main and git push --force-with-lease; an empty commit won't help.` : "  no checks yet");
  for (const [kind, label] of [["pass", "pass"], ["skip", "skip"], ["other", "other"], ["pending", "running"]] as const) {
    const xs = byKind(kind);
    if (xs.length) out.push(`  ${label.padEnd(7)} ${xs.map((o) => o.name + (kind === "pass" ? dur(o.seconds) : "")).join(" | ")}`);
  }
  for (const o of byKind("fail")) out.push(`  FAIL    ${o.name}${dur(o.seconds)}  ${o.url ?? ""}`.trimEnd());
  if (os.length && missedRun(pr, now)) out.push("  no typecheck or apps run attached (#2828): rebase onto origin/main and git push --force-with-lease.");
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

const sh = async (...cmd: string[]) => { const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" }); const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]); return { code: await p.exited, out, err }; };

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
  while (wait && !settled(pr) && Date.now() < until) { await Bun.sleep(20_000); pr = await view(n); }
  console.log(summarize(pr).join("\n"));
  for (const o of outcomes(pr).filter((o) => o.outcome === "fail")) { const log = await failedLog(o.url); if (log.length) console.log(`--- ${o.name}\n${log.join("\n")}`); }
  if (wait && !settled(pr)) console.log(`  still running after ${minutes} min`);
  process.exit(outcomes(pr).some((o) => o.outcome === "fail") ? 1 : 0);
}
