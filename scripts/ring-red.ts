// A red hourly ring (notes/RELEASE_RINGS.md step 4, #4491): find the squash commit that broke it, tell its PR's worker,
// and revert that one commit if no fix lands in 60 minutes. Main never freezes; the ring just stops promoting.
//
//   bun scripts/ring-red.ts            one pass: bisect a new red, or open the revert once it is due; says what it did
//   bun scripts/ring-red.ts --dry      the same reads and the bisect, but writes nothing to GitHub or the office
//
// The office Mac runs a pass every 10 minutes (scripts/mac/dev.rustybuns.ring-red.plist), from a clone of main.
//
// Bisect: the red SHA's run names its failing jobs (an app's suite, codeSplitter's suite, the packages, a darwin-arm64
// smoke); each becomes the command the hourly ran, run on Bob at a commit (`bun run builder`, scripts/remote-ci.ts).
// First the red SHA itself: if it passes on Bob the red is a flake or Linux-only, and nobody is blamed. Then a binary
// search over the squash commits since the last green names the first bad one, its PR (the `(#N)` at the end of a
// squash title) and the worker holding that PR (`office-workers tell`), and comments on the PR and on the open
// ci-hourly issue. That comment carries a marker line, which is all the state there is.
//
// Revert: 60 minutes after the blame, if the newest hourly run is still red and nothing since names the PR, Mervin's
// part: a revert of that one squash commit, made in a scratch clone (no worktree touched), pushed as ring-revert-<sha7>
// and opened as a PR against main. A revert that doesn't apply cleanly is said on the issue instead.
//
// Needs gh signed in, BUILDER_HOST for Bob, and office-workers on PATH (without it the PR comment still goes).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { arr, bool, nul, num, obj, opt, str } from "../packages/util/src/guard.ts";
import { help } from "./help.ts";
import { main as builder, NOT_RUN } from "./remote-ci.ts";
import { history, type Tested } from "./rings.ts";

const RING = "hourly";
/** How long the PR's worker has to land a fix before the revert. */
export const GRACE_MIN = 60;

const green = (s?: string) => /^success$/i.test(s ?? "");

/** The newest hourly run, if red: that SHA, the last green under it, and the commits between, oldest first (the red one
 *  last). `why` says why there is nothing to bisect. */
export function redRange(h: Tested[]): { red: string; green: string; candidates: string[] } | { why: string } {
  const at = h.findIndex((c) => c.state);
  if (at < 0) return { why: `no ${RING} run in main's last ${h.length} commits` };
  if (green(h[at]!.state)) return { why: `${RING} is green at ${h[at]!.sha.slice(0, 7)}` };
  if (/^pending$/i.test(h[at]!.state!)) return { why: `${RING} is still running on ${h[at]!.sha.slice(0, 7)}` };
  const g = h.findIndex((c, i) => i > at && green(c.state));
  if (g < 0) return { why: `red at ${h[at]!.sha.slice(0, 7)} and no green ${RING} in view to bisect from` };
  return { red: h[at]!.sha, green: h[g]!.sha, candidates: h.slice(at, g).map((c) => c.sha).reverse() };
}

export type Verdict = "pass" | "fail" | "skip";
/** The first bad commit of `candidates` (oldest first; the last is known bad, the commit under the first known good).
 *  undefined when a test couldn't run (Bob off): try again next pass. */
export async function bisect(candidates: string[], test: (sha: string) => Promise<Verdict>): Promise<string | undefined> {
  let lo = 0, hi = candidates.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const v = await test(candidates[mid]!);
    if (v === "skip") return undefined;
    if (v === "fail") hi = mid; else lo = mid + 1;
  }
  return candidates[hi];
}

/** The PR a squash commit came from: the `(#N)` its title ends with. */
export const prOf = (subject: string) => Number(/\(#(\d+)\)\s*$/.exec(subject)?.[1]) || undefined;

export type Job = { label: string; dir: string; cmd: string };
const Row = obj({ app: str(200), shard: opt(str(500, { min: 0 })), test: opt(str(2000, { min: 0 })), prep: opt(str(2000, { min: 0 })), boot: opt(bool()) });
const Smoke = obj({ app: str(200), runner: str(200), target: str(200), smoke: str(2000) });
const Include = <T>(g: (v: unknown) => T) => obj({ include: arr(g, 1000) });

/** The commands Bob runs for the hourly's failing job names, as the workflow runs them (`apps` and `smoke` are
 *  `ci-apps.ts test` and `smoke` rows), and the names he can't run (another OS's smoke, a job that runs no tests). */
export function jobsFor(failed: string[], apps: unknown, smoke: unknown): { jobs: Job[]; cant: string[] } {
  const rows = Include(Row)(apps).include, smokes = Include(Smoke)(smoke).include;
  const jobs: Job[] = [], cant: string[] = [];
  for (const name of failed) {
    const t = /^test (\S+)(?: (.+))?$/.exec(name), s = /^smoke (\S+) (\S+)$/.exec(name);
    const row = t && rows.find((r) => r.app === t[1] && (r.shard || undefined) === t[2]);
    const sm = s && smokes.find((r) => r.app === s[1] && r.target === s[2] && r.runner.startsWith("macos") && r.target === "darwin-arm64");
    if (name === "suite") jobs.push({ label: name, dir: "apps/codesplitter", cmd: "bun test --parallel test" });
    else if (name === "packages") jobs.push({ label: name, dir: ".", cmd: "bun test packages" });
    else if (row) jobs.push({ label: name, dir: `apps/${row.app}`, cmd: [row.prep, row.test, row.boot ? "bun ../../scripts/boot.ts" : ""].filter(Boolean).join(" && ") });
    else if (sm) jobs.push({ label: name, dir: `apps/${sm.app}`, cmd: sm.smoke });
    else cant.push(name);
  }
  return { jobs, cant };
}

/** The marker in the blame comment: what was blamed, for which red, and when. No `pr`: it passed on Bob, nobody is blamed. */
export type Blame = { red: string; sha: string; pr?: number; at: number };
export const blameLine = (b: Blame) => `<!-- ring-red red=${b.red} sha=${b.sha} pr=${b.pr ?? 0} at=${new Date(b.at).toISOString()} -->`;
/** The newest blame in these comment bodies (oldest first, as GitHub lists them). */
export function lastBlame(bodies: string[]): Blame | undefined {
  for (const body of bodies.toReversed()) {
    const m = /<!-- ring-red red=([0-9a-f]{40}) sha=([0-9a-f]{40}) pr=(\d+) at=(\S+) -->/.exec(body);
    if (m && !Number.isNaN(Date.parse(m[4]!))) return { red: m[1]!, sha: m[2]!, pr: Number(m[3]) || undefined, at: Date.parse(m[4]!) };
  }
  return undefined;
}

/** Whether the revert is due now: the grace is up, the newest hourly run is still red, and no commit newer than the
 *  blamed one names its PR (a fix said so in its title). `newer` is the commits above it, newest first, with titles. */
export function revertDue(b: Blame, now: number, h: Tested[], newer: { sha: string; subject: string }[]): { due: boolean; why: string } {
  if (!b.pr) return { due: false, why: `nobody was blamed for ${b.red.slice(0, 7)}: a person reads the run` };
  const left = Math.ceil((b.at + GRACE_MIN * 60_000 - now) / 60_000);
  if (left > 0) return { due: false, why: `${left} min left for a fix to ${b.sha.slice(0, 7)}` };
  const newest = h.find((c) => c.state);
  if (!newest || green(newest.state)) return { due: false, why: `${RING} went green: no revert` };
  if (!h.some((c) => c.sha === b.sha)) return { due: false, why: `${b.sha.slice(0, 7)} isn't on main's recent line` };
  const fix = b.pr ? newer.find((c) => c.subject.includes(`#${b.pr}`)) : undefined;
  if (fix) return { due: false, why: `${fix.sha.slice(0, 7)} names #${b.pr}: waiting for the ${RING} run to test it` };
  return { due: true, why: `still red ${GRACE_MIN}+ min after blaming ${b.sha.slice(0, 7)}` };
}

// ---- GitHub, Bob and the office

const sh = (cmd: string[], cwd = ".") => Bun.$`${cmd}`.cwd(cwd).quiet().nothrow();
const text = async (cmd: string[], cwd?: string) => {
  const r = await sh(cmd, cwd);
  if (r.exitCode) throw new Error(`${cmd.slice(0, 3).join(" ")}: ${r.stderr.toString().trim().split("\n").at(-1)}`);
  return r.stdout.toString().trim();
};
const Statuses = arr(obj({ context: str(200), target_url: nul(str(2000)) }), 1000);
const Jobs = obj({ jobs: arr(obj({ name: str(300), conclusion: nul(str(40)) }), 1000) });
const Issues = arr(obj({ number: num(1, Number.MAX_SAFE_INTEGER) }), 10);
const Comments = obj({ comments: arr(obj({ body: str(Infinity, { min: 0 }) }), 10_000) });
const Workers = obj({ workers: arr(obj({ name: str(200), pr: opt(obj({ number: num(1, Number.MAX_SAFE_INTEGER) })) }), 1000) });

/** The names of the jobs that failed in the run behind the red SHA's ring status. */
async function failedJobs(repo: string, sha: string): Promise<string[]> {
  const url = Statuses(JSON.parse(await text(["gh", "api", `repos/${repo}/commits/${sha}/statuses?per_page=100`])))
    .find((s) => s.context === `ring/${RING}`)?.target_url ?? "";
  const run = /\/actions\/runs\/(\d+)/.exec(url)?.[1];
  if (!run) return [];
  const { jobs } = Jobs(JSON.parse(await text(["gh", "api", `repos/${repo}/actions/runs/${run}/jobs?per_page=100`])));
  return jobs.filter((j) => j.conclusion === "failure" || j.conclusion === "timed_out").map((j) => j.name);
}

/** Every job at `sha` on Bob: fail at the first that fails, skip when Bob couldn't take it. */
async function onBob(jobs: Job[], sha: string): Promise<Verdict> {
  process.env.BUILDER_WHO = "ring-red";
  for (const j of jobs) {
    console.log(`  ${sha.slice(0, 7)} ${j.label}`);
    const code = await builder(["run", j.dir, "sh", "-c", j.cmd], process.cwd(), sha);
    if (code === NOT_RUN) return "skip";
    if (code) return "fail";
  }
  return "pass";
}

const subject = (sha: string) => text(["git", "log", "-1", "--format=%s", sha]);

async function issueComments(repo: string): Promise<{ issue?: number; bodies: string[] }> {
  const [open] = Issues(JSON.parse(await text(["gh", "issue", "list", "-R", repo, "--label", "ci-hourly", "--state", "open", "--json", "number"])));
  if (!open) return { bodies: [] };
  const { comments } = Comments(JSON.parse(await text(["gh", "issue", "view", String(open.number), "-R", repo, "--json", "comments"])));
  return { issue: open.number, bodies: comments.map((c) => c.body) };
}

async function tellWorker(pr: number, msg: string): Promise<string> {
  const list = await sh(["office-workers", "list", "--json"]);
  if (list.exitCode) return "no office here to tell";
  const w = Workers(JSON.parse(list.stdout.toString())).workers.find((x) => x.pr?.number === pr);
  if (!w) return `no worker holds #${pr}`;
  const r = await sh(["office-workers", "tell", w.name, "--prompt", msg]);
  return r.exitCode ? `couldn't tell ${w.name}` : `told ${w.name}`;
}

/** The revert of one squash commit on main's tip, made in a scratch clone and pushed as its own branch. */
async function openRevert(repo: string, b: Blame, title: string, body: string): Promise<string> {
  const branch = `ring-revert-${b.sha.slice(0, 7)}`;
  const had = await text(["gh", "pr", "list", "-R", repo, "--head", branch, "--state", "all", "--json", "url", "-q", ".[0].url"]);
  if (had) return `already opened: ${had}`;
  const dir = mkdtempSync(`${tmpdir()}/ring-red-`);
  try {
    const remote = await text(["git", "remote", "get-url", "origin"]);
    await text(["git", "clone", "-q", "--shared", "--no-checkout", ".", dir]);
    await text(["git", "fetch", "-q", remote, "main"], dir);
    await text(["git", "checkout", "-q", "--detach", "FETCH_HEAD"], dir);
    const rv = await sh(["git", "-c", "user.name=Mervin", "-c", "user.email=mervin@users.noreply.github.com", "revert", "--no-edit", b.sha], dir);
    if (rv.exitCode) return "the revert doesn't apply cleanly on main: a person has to take it";
    await text(["git", "push", "-q", remote, `HEAD:refs/heads/${branch}`], dir);
    return await text(["gh", "pr", "create", "-R", repo, "--base", "main", "--head", branch, "--title", title, "--body", body]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function pass(dry: boolean): Promise<void> {
  const repo = process.env.GITHUB_REPOSITORY ?? await text(["gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
  await text(["git", "fetch", "-q", "origin", "main"]);
  const head = await text(["git", "rev-parse", "origin/main"]);
  const h = await history(repo, RING, head);
  const { issue, bodies } = await issueComments(repo);
  const say = async (body: string, where = issue) => {
    console.log(body.replace(/<!--.*-->\n?/g, ""));
    if (!dry && where) await sh(["gh", "issue", "comment", String(where), "-R", repo, "--body", body]);
  };
  const blame = lastBlame(bodies);
  const r = redRange(h);

  // A blame for this red stands (a newer red over the same range keeps it; "nobody blamed" holds for its own red only):
  // only the revert is left to decide.
  if (blame && "red" in r && r.candidates.includes(blame.sha) && (blame.pr || blame.red === r.red)) {
    const at = h.findIndex((c) => c.sha === blame.sha);
    const newer = await Promise.all(h.slice(0, Math.max(0, at)).map(async (c) => ({ sha: c.sha, subject: await subject(c.sha) })));
    const d = revertDue(blame, Date.now(), h, newer);
    console.log(d.why);
    if (!d.due) return;
    const title = `Revert ${await subject(blame.sha)}`.replace(/\s*\(#\d+\)\s*$/, "") + (blame.pr ? ` (reverts #${blame.pr})` : "");
    const body = `The ${RING} ring has been red ${GRACE_MIN}+ minutes since ${blame.sha.slice(0, 7)}${blame.pr ? ` (#${blame.pr})` : ""} was found to break it`
      + `${issue ? ` (#${issue})` : ""}, and no fix landed. This reverts that one squash commit so the ring can promote again; `
      + `the PR's work can come back with its fix.\n\nOpened by scripts/ring-red.ts (#4491).\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)`;
    const out = dry ? "(dry: no revert opened)" : await openRevert(repo, blame, title, body);
    await say(`Revert of ${blame.sha.slice(0, 7)}: ${out}`);
    if (blame.pr && /^https:/.test(out)) await say(`The ${RING} ring stayed red ${GRACE_MIN} min, so this PR's squash commit is being reverted: ${out}`, blame.pr);
    return;
  }
  if (!("red" in r)) return void console.log(r.why);

  // The rows the hourly's matrices come from: every app's suite (a diff from the root commit) and the smokes.
  const row = async (args: string[], key: string) => JSON.parse((await text(["bun", "scripts/ci-apps.ts", ...args])).split("\n").find((l) => l.startsWith(`${key}=`))?.slice(key.length + 1) ?? "{}");
  const failed = await failedJobs(repo, r.red);
  const { jobs, cant } = jobsFor(failed, await row(["test", await text(["git", "rev-list", "--max-parents=0", head])], "apps"), await row(["smoke"], "smoke"));
  if (!jobs.length) return void console.log(`red at ${r.red.slice(0, 7)}, but nothing Bob can run failed (${[...cant, ...failed].join(", ") || "no failed jobs read"})`);
  console.log(`red at ${r.red.slice(0, 7)}: ${r.candidates.length} commit(s) since green ${r.green.slice(0, 7)}; bisecting ${jobs.map((j) => j.label).join(", ")} on Bob`);
  const first = await onBob(jobs, r.red);
  if (first === "skip") return void console.log("Bob can't take it now: next pass");
  if (first === "pass") {
    // Marked so the next pass doesn't run the same red again; with no PR it never reverts.
    return void await say(`${r.red.slice(0, 7)} passes ${jobs.map((j) => j.label).join(", ")} on Bob: a flake or Linux-only, so nobody is blamed. A person reads the run.\n`
      + blameLine({ red: r.red, sha: r.red, at: Date.now() }));
  }
  const bad = await bisect(r.candidates, (sha) => onBob(jobs, sha));
  if (!bad) return void console.log("Bob can't take it now: next pass");
  const s = await subject(bad), pr = prOf(s);
  const b: Blame = { red: r.red, sha: bad, pr, at: Date.now() };
  const what = `${bad.slice(0, 7)} "${s}" breaks ${jobs.map((j) => j.label).join(", ")} (bisected on Bob over ${r.candidates.length} commit(s) since ${r.green.slice(0, 7)})`;
  const told = pr && !dry ? await tellWorker(pr, `The hourly ring is red since your PR #${pr} merged: ${what}. Land a fix within ${GRACE_MIN} minutes `
    + `(name #${pr} in its title) or Mervin opens a revert of ${bad.slice(0, 7)}.${issue ? ` See #${issue}.` : ""}`) : "nobody told";
  await say(`${what}. ${pr ? `#${pr}, ${told}.` : "No PR in its title."} A revert opens in ${GRACE_MIN} min if the ring is still red.${cant.length ? ` Not bisected: ${cant.join(", ")}.` : ""}\n${blameLine(b)}`);
  if (pr) await say(`The hourly ring is red: ${what}. Land a fix naming #${pr} within ${GRACE_MIN} min, or a revert of this squash commit opens.`, pr);
}

if (import.meta.main) {
  help(import.meta.path);
  await pass(process.argv.includes("--dry"));
}
