// Runs a test command as-is and reports how many single tests passed, failed and were skipped, so the
// Agent Office PR board's health bar can count tests, not just CI checks (apps/agent-office/checks/).
//
//   bun scripts/ci-test-count.ts [--budget <minutes>] "bun test test"
//
// It reads bun test's closing summary (" 12 pass", " 1 fail", " 2 skip", summed if the command runs bun test more
// than once), prints it as a `::notice title=tests::12 pass, 1 fail, 2 skip` annotation on the job's check run
// (the office reads those back with `gh api .../check-runs/<id>/annotations`), adds a line to the job summary,
// and exits with the command's own code.
//
// A run that outlives its budget (10 minutes unless --budget says otherwise) hung: bun's per-test timeout misses a
// deadlock in shared setup or an event loop that never drains. Then it kills the whole process tree, names the
// files in a `::error title=hung::` annotation, and exits 124, well before the job's own timeout. The suspects
// come from bun's file headers ("test/foo.test.ts:"): one file at a time, the last header is the hung file;
// with --parallel, it's the last file to report plus the test files that never reported at all.
//
// A test that passes near its time limit times out on the next slower runner (room-setup.test.ts merged at 239 s of
// 240 and then timed out on every fm-daw PR, #5893). So each test's time ("(pass) a > b [1205.70ms]") is held up to
// its limit, read from its file: a timeout argument on the test, else the file's setDefaultTimeout, else the
// command's --timeout, else bun's 5 s. Over half the limit is a `::warning title=slow test::`. Over 80% in a test
// file the PR adds or changes (CHANGED_TESTS, repo-relative and space-separated, from ci-apps.ts's plan) is a
// `::error` that fails the step: make the test faster or split it, since a higher timeout only moves the cliff.
// A file the PR didn't touch only warns, so one slow test on main can't block every unrelated PR.
//
// Fail fast (#5920): a red run names its first failing file in a `::error title=first failure::` annotation. With LANE
// set (a split app's job name, "test fm-daw 2/6") and a GH_TOKEN that can read the run's jobs, it checks every 15 s
// whether another lane of the same app failed, and if so kills its tests and fails with `::error title=stopped::`.
// apps.yml's `apps` job reads both titles back to say which lane and file went red first.
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { join, normalize, relative } from "node:path";
import { MARK } from "./ci-group.ts";
import { arr, check, obj, opt, or, str, type Of } from "../packages/util/src/guard.ts";

export type TestCount = { pass: number; fail: number; skip: number };

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

/** bun test's summary lines, ANSI colours and all; undefined when there are none. */
export function countOf(out: string): TestCount | undefined {
  const t: TestCount = { pass: 0, fail: 0, skip: 0 };
  let seen = false;
  for (const m of strip(out).matchAll(/^\s*(\d+) (pass|fail|skip|todo)\s*$/gm)) {
    t[m[2] === "todo" ? "skip" : (m[2] as keyof TestCount)] += Number(m[1]);
    seen = true;
  }
  return seen ? t : undefined;
}

export const notice = (t: TestCount) => `::notice title=tests::${t.pass} pass, ${t.fail} fail, ${t.skip} skip`;

const TEST_FILE = /[._](test|spec)\.[cm]?[jt]sx?$/;

/** The test file a line of bun's output starts: "test/a.test.ts:", or on GitHub Actions "::group::test/a.test.ts:". */
function header(line: string): string | undefined {
  const m = line.match(/^(?:::group::)?(\S.*):\s*$/);
  return m && TEST_FILE.test(m[1]!) ? normalize(m[1]!) : undefined;
}

/** The test files bun printed a header for, in order, and the last one. */
export function reported(out: string): { seen: Set<string>; last?: string } {
  const seen = new Set<string>();
  let last: string | undefined;
  for (const line of strip(out).split("\n")) {
    const h = header(line);
    if (h) seen.add(last = h);
  }
  return { seen, last };
}

/** The test files a `bun test ...` command would run, relative to `cwd`: under each path it names, or matching
 * each filter that isn't a path, or everything under `cwd`. Skips node_modules and dot directories, like bun. */
export function testFiles(cmd: string, cwd = process.cwd()): string[] {
  const words = cmd.split(/\s+/);
  const at = words.indexOf("test");
  const args = at < 0 ? [] : words.slice(at + 1).filter((w) => w && !w.startsWith("-")).map((w) => w.replace(/^["']|["']$/g, ""));
  const under = (dir: string) => [...new Bun.Glob("**/*").scanSync({ cwd: `${cwd}/${dir}` })]
    .filter((f) => TEST_FILE.test(f) && !/(^|\/)(node_modules|\.[^/]*)\//.test(f))
    .map((f) => normalize(relative(cwd, `${cwd}/${dir}/${f}`)));
  const isPath = (a: string) => { try { return !!statSync(`${cwd}/${a}`); } catch { return false; } };
  const roots = args.filter(isPath), filters = args.filter((a) => !isPath(a));
  const files = new Set(roots.flatMap((r) => statSync(`${cwd}/${r}`).isDirectory() ? under(r) : [normalize(r)]));
  if (filters.length || !roots.length) for (const f of under(".")) if (!filters.length || filters.some((x) => f.includes(x))) files.add(f);
  return [...files].sort();
}

/** The `::error title=hung::` line for a run that ran out of budget. bun prints a file's header as it starts it,
 * one file at a time, so without --parallel the last header is the hung file and the silent ones never started. */
export function hung(out: string, files: string[], minutes: number, parallel: boolean): string {
  const { seen, last } = reported(out);
  const silent = parallel || !last ? files.filter((f) => !seen.has(f)) : [];
  const list = (fs: string[]) => fs.slice(0, 8).join(", ") + (fs.length > 8 ? ` (+${fs.length - 8} more)` : "");
  const parts = [last && `last to report: ${last}`, silent.length && `never reported: ${list(silent)}`].filter(Boolean);
  return `::error title=hung::Still running after ${minutes} min, killed. ${parts.join("; ") || "no test file reported"}`;
}

export type Timing = { file: string; test: string; ms: number };

/** Each test bun timed, under the file header it printed: "(pass) grp > name [1205.70ms]". A `ci-group: <dir>` line
 * starts another app, whose headers are relative to that dir. A file ends at `::endgroup::` and at bun's closing
 * "1 tests failed:" list, which repeats the failures with no header. */
export function timings(out: string): Timing[] {
  const got: Timing[] = [];
  let dir = "", file = "";
  for (const line of strip(out).split("\n")) {
    const at = line.indexOf(MARK);
    if (at >= 0) { dir = line.slice(at + MARK.length).trim(); file = ""; continue; }
    const h = header(line);
    if (h) { file = normalize(join(dir, h)); continue; }
    if (/^::endgroup::|^\d+ tests? (failed|skipped|todo):?\s*$/.test(line)) { file = ""; continue; }
    const t = line.match(/^\((?:pass|fail)\) (.+) \[([\d.]+)ms\]\s*$/);
    if (t && file) got.push({ file, test: t[1]!, ms: Number(t[2]) });
  }
  return got;
}

const num = (s: string) => Number(s.replace(/_/g, ""));

/** The index just past the `)` that closes the call whose `(` is at `open`, skipping strings and comments. */
function closeOf(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i]!;
    if (c === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); if (i < 0) return src.length; continue; }
    if (c === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i + 2) + 1; if (i <= 0) return src.length; continue; }
    if (c === '"' || c === "'" || c === "`") { for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++; continue; }
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i + 1;
  }
  return src.length;
}

export type Limits = { file: number; tests: { name: RegExp; ms: number }[] };

/** A test file's time limits: its setDefaultTimeout (else `fallback`), and each test that names its own, as
 * `test("name", fn, 30_000)` or `test("name", { timeout: 30_000 }, fn)`. A template name's `${...}` matches anything. */
export function limits(src: string, fallback: number): Limits {
  const d = src.match(/\bsetDefaultTimeout\(\s*([\d_]+)\s*\)/);
  const tests: Limits["tests"] = [];
  const call = /(\b(?:test|it)(?:\.\w+(?:\([^()]*\))?)*\(\s*)(["'`])((?:\\.|(?!\2)[^\\])*)\2/g;
  for (const m of src.matchAll(call)) {
    const open = m.index + m[1]!.lastIndexOf("(");
    const body = src.slice(open, closeOf(src, open));
    const ms = body.match(/,\s*([\d_]+)\s*,?\s*\)$/)?.[1]
      ?? body.slice(m.index + m[0].length - open).match(/^\s*,\s*\{[^{}]*\btimeout:\s*([\d_]+)/)?.[1]
      ?? body.match(/,\s*\{[^{}]*\btimeout:\s*([\d_]+)[^{}]*\}\s*,?\s*\)$/)?.[1];
    if (!ms) continue;
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const name = m[2] === "`" ? m[3]!.split(/\$\{[^}]*\}/).map(esc).join(".*") : esc(m[3]!);
    tests.push({ name: new RegExp(`(^| > )${name}$`), ms: num(ms) });
  }
  return { file: d ? num(d[1]!) : fallback, tests };
}

/** The test file of the first `(fail)` line, as a path under `cwd` (a group's `ci-group: <dir>` line counts), else the
 * last file bun started: a file that throws before its first test has no `(fail)` line, and with --bail nothing runs after it. */
export function firstFailure(out: string): string | undefined {
  let dir = "", file = "", last: string | undefined;
  for (const line of strip(out).split("\n")) {
    const at = line.indexOf(MARK);
    if (at >= 0) { dir = line.slice(at + MARK.length).trim(); file = ""; continue; }
    const h = header(line);
    if (h) { last = file = normalize(join(dir, h)); continue; }
    if (/^\d+ tests? (failed|skipped|todo):?\s*$/.test(line)) file = "";
    if (file && line.startsWith("(fail) ")) return file;
  }
  return last;
}

// A lane of a split app ("test fm-daw 2/6") stops once another lane of that app has failed (#5920): the check is red
// already, and the runner is freed. GitHub can't cancel one job of a matrix, so each lane asks the run's jobs list.
const Jobs = obj({ jobs: arr(obj({ name: str(300), conclusion: opt(str(40)), steps: or(arr(obj({ conclusion: opt(str(40)) }), 200), []) }), 100) });
export type Jobs = Of<typeof Jobs>["jobs"];

/** The first other lane of `lane`'s app ("test fm-daw 2/6" -> "test fm-daw k/6") that failed or has a failed step. */
export function failedSibling(jobs: Jobs, lane: string): string | undefined {
  const app = lane.match(/^(.*) \d+\/(\d+)$/);
  if (!app) return;
  const sibling = new RegExp(`^${app[1]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\d+/${app[2]}$`);
  return jobs.find((j) => j.name !== lane && sibling.test(j.name) && (j.conclusion === "failure" || j.steps.some((s) => s.conclusion === "failure")))?.name;
}

/** Polls the run's jobs every `everyMs` until `onFailed` gets a failed sibling of `lane`. Quiet and gone on any error,
 * or when the token's API allowance runs low: a lane never fails for want of the watch. Returns the stop function. */
function watchSiblings(lane: string, onFailed: (sibling: string) => void, everyMs = Number(process.env.LANE_POLL_MS) || 15_000): () => void {
  const { GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: run, GITHUB_RUN_ATTEMPT: attempt = "1", GH_TOKEN: token } = process.env;
  if (!repo || !run || !token || !/ \d+\/\d+$/.test(lane)) return () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    try {
      const r = await fetch(`${process.env.GITHUB_API_URL ?? "https://api.github.com"}/repos/${repo}/actions/runs/${run}/attempts/${attempt}/jobs?per_page=100`,
        { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" } });
      const jobs = r.ok ? check(Jobs, await r.json()) : null;
      if (!jobs) return console.log(`lane watch off: jobs list answered ${r.status}`);
      const hit = failedSibling(jobs.jobs, lane);
      if (hit) return onFailed(hit);
      if (Number(r.headers.get("x-ratelimit-remaining") ?? 1000) < 200) return console.log("lane watch off: API allowance low");
    } catch (e) { return console.log(`lane watch off: ${e instanceof Error ? e.message : e}`); }
    timer = setTimeout(tick, everyMs);
  };
  timer = setTimeout(tick, everyMs);
  return () => clearTimeout(timer);
}

export const limitOf = (l: Limits, test: string) => l.tests.find((t) => t.name.test(test))?.ms ?? l.file;

/** The command's own --timeout, else bun's default. */
export const cliTimeout = (cmd: string) => num(cmd.match(/--timeout[= ]([\d_]+)/)?.[1] ?? "5000");

/** A test's time against its limit: over 80% in a file the PR changed fails, over 50% warns, else nothing. */
export function judge(t: Timing, limit: number, changed: boolean): { fail: boolean; line: string } | undefined {
  const share = t.ms / limit;
  if (share <= 0.5) return;
  const fail = changed && share > 0.8;
  const s = (ms: number) => `${ms >= 10_000 ? Math.round(ms / 1000) : (ms / 1000).toFixed(1)} s`;
  const said = `${t.test} took ${s(t.ms)} of its ${s(limit)} limit (${Math.round(share * 100)}%).`;
  const then = fail ? " Make it faster or split it: raising the timeout isn't a fix, the next slower runner times it out."
    : share > 0.8 ? " A PR that changes this file fails on it." : " Over 80% fails a PR that changes this file.";
  return { fail, line: `::${fail ? "error" : "warning"} file=${t.file},title=slow test::${said}${then}` };
}

/** Every test over half its limit, with paths made repo-relative (`cwd` is where the command ran). */
export function slow(out: string, cmd: string, changed: Set<string>, cwd = process.cwd(), root = join(import.meta.dir, "..")) {
  const byFile = new Map<string, Limits>();
  const fallback = cliTimeout(cmd);
  return timings(out).flatMap((t) => {
    const file = relative(root, join(cwd, t.file));
    if (!byFile.has(file)) byFile.set(file, existsSync(join(root, file)) ? limits(readFileSync(join(root, file), "utf8"), fallback) : { file: fallback, tests: [] });
    const v = judge({ ...t, file }, limitOf(byFile.get(file)!, t.test), changed.has(file));
    return v ? [v] : [];
  });
}

if (import.meta.main) {
  let argv = process.argv.slice(2), minutes = 10;
  if (argv[0] === "--budget") { minutes = Number(argv[1]); argv = argv.slice(2); }
  const cmd = argv.join(" ");
  if (!cmd || !(minutes > 0)) throw new Error("usage: bun scripts/ci-test-count.ts [--budget <minutes>] <test command>");
  // Its own process group, so a hang kills bun's workers too, not just the shell.
  const child = Bun.spawn(["sh", "-c", cmd], { stdin: "inherit", stdout: "pipe", stderr: "pipe", detached: true });
  let out = "", timedOut = false, stoppedBy = "";
  const kill = () => { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } };
  const budget = setTimeout(() => {
    timedOut = true;
    console.log(hung(out, testFiles(cmd), minutes, /\s--parallel\b/.test(cmd)));
    kill();
  }, minutes * 60_000);
  // LANE is the job's name, set by apps.yml on a split app's lanes.
  const lane = process.env.LANE ?? "";
  const unwatch = watchSiblings(lane, (sibling) => { stoppedBy = sibling; kill(); });
  const pump = async (from: ReadableStream<Uint8Array>, to: NodeJS.WriteStream) => {
    const dec = new TextDecoder();
    const reader = from.getReader();
    for (let r = await reader.read(); !r.done; r = await reader.read()) { out += dec.decode(r.value, { stream: true }); to.write(r.value); }
  };
  await Promise.all([pump(child.stdout, process.stdout), pump(child.stderr, process.stderr)]);
  const code = await child.exited;
  clearTimeout(budget);
  unwatch();
  const say = (line: string) => process.env.GITHUB_STEP_SUMMARY && appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
  if (stoppedBy) {
    // apps.yml's `apps` job reads these two titles back off each failed lane to name the first failure.
    console.log(`::error title=stopped::${stoppedBy} failed first, so ${lane} stopped`);
    say(`Stopped: ${stoppedBy} failed first`);
  } else if (code && !timedOut) {
    const f = firstFailure(out), file = f && relative(join(import.meta.dir, ".."), join(process.cwd(), f));
    if (file) { console.log(`::error file=${file},title=first failure::${file}`); say(`First failure: ${file}`); }
  }
  const t = countOf(out);
  if (t) {
    console.log(notice(t));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Tests: ${t.pass} passed, ${t.fail} failed, ${t.skip} skipped\n`);
  }
  if (timedOut && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Tests hung: killed after ${minutes} min\n`);
  const verdicts = slow(out, cmd, new Set((process.env.CHANGED_TESTS ?? "").split(/\s+/).filter(Boolean)));
  for (const v of verdicts) console.log(v.line);
  const tooSlow = verdicts.filter((v) => v.fail).length;
  if (tooSlow && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Too slow: ${tooSlow} changed test(s) over 80% of their time limit\n`);
  process.exit(timedOut ? 124 : stoppedBy ? 1 : code || (tooSlow ? 1 : 0));
}
