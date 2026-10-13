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
import { appendFileSync, statSync } from "node:fs";
import { normalize, relative } from "node:path";

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

/** The test files bun printed a header for, in order, and the last one. */
export function reported(out: string): { seen: Set<string>; last?: string } {
  const seen = new Set<string>();
  let last: string | undefined;
  for (const m of strip(out).matchAll(/^(\S.*):\s*$/gm)) {
    if (!TEST_FILE.test(m[1]!)) continue;
    last = normalize(m[1]!);
    seen.add(last);
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

if (import.meta.main) {
  let argv = process.argv.slice(2), minutes = 10;
  if (argv[0] === "--budget") { minutes = Number(argv[1]); argv = argv.slice(2); }
  const cmd = argv.join(" ");
  if (!cmd || !(minutes > 0)) throw new Error("usage: bun scripts/ci-test-count.ts [--budget <minutes>] <test command>");
  // Its own process group, so a hang kills bun's workers too, not just the shell.
  const child = Bun.spawn(["sh", "-c", cmd], { stdin: "inherit", stdout: "pipe", stderr: "pipe", detached: true });
  let out = "", timedOut = false;
  const budget = setTimeout(() => {
    timedOut = true;
    console.log(hung(out, testFiles(cmd), minutes, /\s--parallel\b/.test(cmd)));
    try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  }, minutes * 60_000);
  const pump = async (from: ReadableStream<Uint8Array>, to: NodeJS.WriteStream) => {
    const dec = new TextDecoder();
    const reader = from.getReader();
    for (let r = await reader.read(); !r.done; r = await reader.read()) { out += dec.decode(r.value, { stream: true }); to.write(r.value); }
  };
  await Promise.all([pump(child.stdout, process.stdout), pump(child.stderr, process.stderr)]);
  const code = await child.exited;
  clearTimeout(budget);
  const t = countOf(out);
  if (t) {
    console.log(notice(t));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Tests: ${t.pass} passed, ${t.fail} failed, ${t.skip} skipped\n`);
  }
  if (timedOut && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Tests hung: killed after ${minutes} min\n`);
  process.exit(timedOut ? 124 : code);
}
