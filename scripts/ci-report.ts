// Where the CI time goes: the last N days of `apps` and `typecheck` runs, read-only through `gh api`, as one
// short markdown report: queue waits and wall time per run, concurrency by hour of day, each job's median and
// p90 with its checkout / install / test split, failures per test (and how many were on PRs that didn't touch
// that app, the sign of a broken main or a flaky test), and what moving suites to a schedule would save.
//
//   bun scripts/ci-report.ts               last 7 days, markdown on stdout
//   bun scripts/ci-report.ts --days 3      a shorter window
//   bun scripts/ci-report.ts --no-logs     skip the failed jobs' logs (no per-test failure names)
//
// Finished runs, job lists, compares and logs are cached under $TMPDIR/ci-report-cache, so a second run is quick.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { arr, check, num, obj, opt, rec, str, type Guard, type Of } from "../packages/util/src/guard.ts";
import { help } from "./help.ts";

const REPO = "QuinnsCode/RustyBuns", WORKFLOWS = ["apps.yml", "typecheck.yml"];
const t = opt(str(60, { min: 0 })), name = str(500, { min: 0 });

const Step = obj({ name, conclusion: t, started_at: t, completed_at: t });
const Job = obj({ id: num(0, 1e15), run_id: num(0, 1e15), run_attempt: opt(num(0, 1e4)), name, status: name, conclusion: t, created_at: str(60), started_at: t, completed_at: t, steps: arr(Step, 500, { drop: true }) });
type Job = Of<typeof Job>;
const Sha = obj({ sha: str(64) });
const Run = obj({
  id: num(0, 1e15), name, event: name, head_branch: t, head_sha: str(64), status: t, conclusion: t, run_attempt: opt(num(0, 1e4)),
  created_at: str(60), updated_at: str(60),
  pull_requests: arr(obj({ number: num(0, 1e9), base: Sha, head: Sha }), 20, { drop: true }),
});
type Run = Of<typeof Run>;
const RunPage = obj({ total_count: num(0, 1e9), workflow_runs: arr(Run, 100, { drop: true }) });
const JobPage = obj({ total_count: num(0, 1e9), jobs: arr(Job, 100, { drop: true }) });
const Compare = obj({ files: arr(obj({ filename: str(1000) }), 3000, { drop: true }) });
const Pull = obj({ number: num(0, 1e9), created_at: str(60), head: obj({ ref: str(300) }) });
const PullPage = arr(Pull, 100, { drop: true });
type Pull = Of<typeof Pull>;

// ---------- gh, cached, a few at a time

const CACHE = join(tmpdir(), "ci-report-cache");
mkdirSync(CACHE, { recursive: true });
const keyOf = (path: string) => join(CACHE, path.replace(/[^a-z0-9]+/gi, "_").slice(0, 200));

let slots = 8;
const waiting: (() => void)[] = [];
async function gh(path: string, raw = false, tries = 4): Promise<string> {
  while (slots === 0) await new Promise<void>((r) => waiting.push(r));
  slots--;
  let err = "";
  try {
    for (let i = 0; i < tries; i++) {
      if (i) await Bun.sleep(1000 * 2 ** i);
      const p = Bun.spawn(["gh", "api", ...(raw ? ["--allow-escape-sequences"] : []), `repos/${REPO}/${path}`], { stdout: "pipe", stderr: "pipe" });
      const [out, e] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
      if (!(await p.exited)) return out;
      err = e.trim().slice(0, 200);
      if (/HTTP 4\d\d/.test(err)) break; // a 404 or 403 won't get better; a 5xx or a dropped stream might
    }
    throw new Error(`gh api ${path}: ${err}`);
  } finally { slots++; waiting.shift()?.(); }
}

/** A gh api reply through a guard; `keep` says whether it may be cached (only once it can't change). */
async function getJ<T>(path: string, g: Guard<T>, keep: (v: T) => boolean): Promise<T> {
  const file = keyOf(path);
  try { const v = check(g, JSON.parse(readFileSync(file, "utf8"))); if (v) return v; } catch { /* not cached */ }
  const v = check(g, JSON.parse(await gh(path)));
  if (!v) throw new Error(`gh api ${path}: unexpected shape`);
  if (keep(v)) writeFileSync(file, JSON.stringify(v));
  return v;
}

async function getLog(jobId: number): Promise<string> {
  const file = keyOf(`log_${jobId}`);
  try { return readFileSync(file, "utf8"); } catch { /* not cached */ }
  const log = (await gh(`actions/jobs/${jobId}/logs`, true).catch(() => "")).replace(/\x1b\[[0-9;]*m/g, "");
  writeFileSync(file, log);
  return log;
}

// ---------- numbers

const ms = (a?: string) => (a ? Date.parse(a) : NaN);
const span = (a?: string, b?: string) => { const d = (ms(b) - ms(a)) / 60_000; return Number.isFinite(d) && d >= 0 ? d : 0; };
const pct = (xs: number[], p: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]!; };
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const m1 = (x: number) => x.toFixed(1);
const share = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "-");
const day = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** What a step is spent on. */
export function stepKind(step: string): "checkout" | "setup" | "install" | "test" | "other" {
  if (/^Post /.test(step) || /^Complete job$/.test(step)) return "other";
  if (/actions\/checkout/.test(step)) return "checkout";
  if (/bun install/.test(step)) return "install";
  if (/^Set up job$|setup-bun|rust-toolchain|rust-cache|setup-buildx|ghaction-github-runtime/.test(step)) return "setup";
  if (/ci-test-count|bun test|boot\.ts|typecheck|build:native|ci-containers|ci-apps|ci-guard|docs|site|boundary|conflict|migration/.test(step)) return "test";
  return "other";
}

/** The app a job tests, from its name: "test two-fronts 2/4" is two-fronts; the plain jobs map to the folder they test. */
export function appOf(job: string): string | undefined {
  const m = job.match(/^(?:test|containers) (\S+)/);
  if (m) return `apps/${m[1]}/`;
  return ({ packages: "packages/", scripts: "scripts/", hooks: ".claude/" } as Record<string, string>)[job];
}

/** The failing tests in a bun test log: "file › test name", each once, under the file whose group it printed in. */
export function failsOf(log: string): string[] {
  const out = new Set<string>(), seen = new Set<string>();
  let file = "";
  for (const line of log.split("\n")) {
    const body = line.replace(/^\S+Z /, "");
    const g = body.match(/^##\[group\](\S+\.(?:test|spec)\.[cm]?[jt]sx?):\s*$/);
    if (g) { file = g[1]!; continue; }
    const f = body.match(/^\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/);
    if (f && !seen.has(f[1]!)) { seen.add(f[1]!); out.add(`${file || "?"} › ${f[1]}`); }
    const h = body.match(/::error title=hung::.*?last to report: (\S+?)[;,]?\s/);
    if (h) out.add(`${h[1]} › (hung)`);
  }
  return [...out];
}

// ---------- fetch

async function runsOf(wf: string, days: number): Promise<Run[]> {
  const out: Run[] = [], today = new Date();
  // The runs list stops at 1,000 results per query, so ask one day at a time.
  await Promise.all(Array.from({ length: days + 1 }, async (_, i) => {
    const d = new Date(today.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    for (let page = 1; page <= 10; page++) {
      const r = await getJ(`actions/workflows/${wf}/runs?created=${d}&per_page=100&page=${page}`, RunPage, (v) => i > 0 && v.workflow_runs.every((x) => x.status === "completed"));
      out.push(...r.workflow_runs);
      if (r.workflow_runs.length < 100) break;
    }
  }));
  const since = today.getTime() - days * 86_400_000;
  return [...new Map(out.filter((r) => ms(r.created_at) >= since).map((r) => [r.id, r])).values()];
}

/** A run's jobs over every attempt. A rerun lists the jobs it didn't rerun again, with the first attempt's start
 * and end, so each (name, start, end) counts once. */
async function jobsOf(run: Run): Promise<Job[]> {
  const out = new Map<string, Job>();
  for (let page = 1, n = 0; page <= 10; page++) {
    const r = await getJ(`actions/runs/${run.id}/jobs?filter=all&per_page=100&page=${page}`, JobPage, (v) => run.status === "completed" && v.jobs.every((j) => j.status === "completed"));
    for (const j of r.jobs) { const k = j.started_at ? `${j.name}|${j.started_at}|${j.completed_at}` : String(j.id); if (!out.has(k)) out.set(k, j); }
    n += r.jobs.length;
    if (n >= r.total_count || r.jobs.length < 100) break;
  }
  return [...out.values()];
}

/** PRs opened since `since`, newest first: an old run's `pull_requests` comes back empty once its PR merged. */
async function pullsSince(since: number): Promise<Pull[]> {
  const out: Pull[] = [];
  for (let page = 1; page <= 30; page++) {
    const r = await getJ(`pulls?state=all&sort=created&direction=desc&per_page=100&page=${page}`, PullPage, () => false);
    out.push(...r);
    if (r.length < 100 || ms(r.at(-1)!.created_at) < since) break;
  }
  return out;
}

/** The PR a run was for: the one GitHub names, else the newest PR from its branch opened before the run (office branches get reused). */
function prFor(run: Run, pulls: Pull[]): { number: number; base: string } | undefined {
  const named = run.pull_requests[0];
  if (named) return { number: named.number, base: named.base.sha };
  if (run.event !== "pull_request") return undefined;
  const p = pulls.find((p) => p.head.ref === run.head_branch && ms(p.created_at) <= ms(run.created_at) + 60_000);
  return p && { number: p.number, base: "main" };
}

/** Which apps import each package, directly or through another package: what a packages/ change can actually break. */
function appsUsing(): Map<string, Set<string>> {
  const deps = (file: string) => { try { const j: unknown = JSON.parse(readFileSync(file, "utf8")); const d = check(obj({ name: opt(str(200)), dependencies: opt(rec(str(200), 200)), devDependencies: opt(rec(str(200), 200)) }), j); return d && { name: d.name, deps: Object.keys({ ...d.dependencies, ...d.devDependencies }) }; } catch { return undefined; } };
  const pkgs = new Map<string, string[]>(), apps = new Map<string, string[]>();
  for (const f of new Bun.Glob("packages/*/package.json").scanSync()) { const d = deps(f); if (d?.name) pkgs.set(f.split("/")[1]!, d.deps); }
  for (const f of new Bun.Glob("apps/*/package.json").scanSync()) { const d = deps(f); if (d) apps.set(f.split("/")[1]!, d.deps); }
  const nameOf = (dir: string) => `@rustybuns/${dir}`;
  const out = new Map<string, Set<string>>();
  for (const dir of pkgs.keys()) {
    const hit = new Set([nameOf(dir)]);
    for (let grew = true; grew;) { grew = false; for (const [d, ds] of pkgs) if (!hit.has(nameOf(d)) && ds.some((x) => hit.has(x))) { hit.add(nameOf(d)); grew = true; } }
    out.set(dir, new Set([...apps].filter(([, ds]) => ds.some((x) => hit.has(x))).map(([a]) => a)));
  }
  return out;
}

// ---------- report

type Row = { run: Run; wf: string; jobs: Job[]; pr?: { number: number; base: string } };
const ran = (j: Job) => j.conclusion !== "skipped" && !!j.started_at;

function perRun(rows: Row[], say: (s: string) => void) {
  say("## 1. Runs: queue, wall time, job-minutes\n");
  say("| workflow | runs | created → first job, p50 / p90 | queue wait per run, p50 / p90 (job-min) | wall, p50 / p90 / max | job-min per run, p50 / total |\n|---|---:|---:|---:|---:|---:|");
  for (const wf of WORKFLOWS) {
    const rs = rows.filter((r) => r.wf === wf && r.run.status === "completed").map(({ run, jobs }) => {
      const js = jobs.filter(ran);
      const first = Math.min(...js.map((j) => ms(j.started_at)));
      return {
        toFirst: Number.isFinite(first) ? (first - ms(run.created_at)) / 60_000 : 0,
        queue: sum(js.map((j) => span(j.created_at, j.started_at))),
        wall: span(run.created_at, new Date(Math.max(...js.map((j) => ms(j.completed_at)).filter(Number.isFinite), ms(run.created_at))).toISOString()),
        work: sum(js.map((j) => span(j.started_at, j.completed_at))),
      };
    });
    const c = (k: keyof (typeof rs)[number]) => rs.map((r) => r[k]);
    say(`| ${wf} | ${rs.length} | ${m1(pct(c("toFirst"), 0.5))} / ${m1(pct(c("toFirst"), 0.9))} min | ${m1(pct(c("queue"), 0.5))} / ${m1(pct(c("queue"), 0.9))} | ${m1(pct(c("wall"), 0.5))} / ${m1(pct(c("wall"), 0.9))} / ${m1(pct(c("wall"), 1))} min | ${m1(pct(c("work"), 0.5))} / ${Math.round(sum(c("work")))} |`);
  }
  const js = rows.flatMap((r) => r.jobs.filter(ran));
  const waits = js.map((j) => span(j.created_at, j.started_at));
  say(`\nEvery job: waited ${m1(pct(waits, 0.5))} min for a runner at the median, ${m1(pct(waits, 0.9))} at p90, ${m1(pct(waits, 1))} at most; ${Math.round(sum(waits))} job-min of waiting against ${Math.round(sum(js.map((j) => span(j.started_at, j.completed_at))))} job-min of work.`);
  const cancelled = rows.flatMap((r) => r.jobs).filter((j) => j.conclusion === "cancelled");
  const reruns = rows.flatMap((r) => r.jobs).filter((j) => (j.run_attempt ?? 1) > 1 && ran(j));
  say(`Cancelled jobs (a newer push, \`cancel-in-progress\`): ${cancelled.length}, ${Math.round(sum(cancelled.map((j) => span(j.started_at, j.completed_at))))} job-min already spent. Rerun attempts: ${reruns.length} jobs, ${Math.round(sum(reruns.map((j) => span(j.started_at, j.completed_at))))} job-min.\n`);

  // By hour of day: sweep minute by minute.
  const t0 = Math.min(...js.map((j) => ms(j.created_at))), now = Date.now(), n = Math.ceil((now - t0) / 60_000) + 1;
  const queued = new Int32Array(n + 1), running = new Int32Array(n + 1), runsQ = new Int32Array(n + 1);
  const at = (x: number) => Math.max(0, Math.min(n, Math.floor((x - t0) / 60_000)));
  for (const j of rows.flatMap((r) => r.jobs).filter((j) => j.conclusion !== "skipped")) {
    const c = ms(j.created_at), s = ms(j.started_at) || now, e = ms(j.completed_at) || now;
    queued[at(c)]++; queued[at(s)]--;
    if (j.started_at) { running[at(s)]++; running[at(e)]--; }
  }
  for (const { jobs } of rows) {
    const mins = new Set<number>();
    for (const j of jobs) if (j.conclusion !== "skipped") for (let m = at(ms(j.created_at)); m < at(ms(j.started_at) || now); m++) mins.add(m);
    for (const m of mins) runsQ[m]++;
  }
  for (let i = 1; i <= n; i++) { queued[i]! += queued[i - 1]!; running[i]! += running[i - 1]!; }
  const hours = Array.from({ length: 24 }, () => ({ q: [] as number[], r: [] as number[], rq: [] as number[] }));
  const todays = new Map<number, { q: number; r: number; rq: number }>(), today = day(new Date().toISOString());
  for (let i = 0; i < n; i++) {
    const d = new Date(t0 + i * 60_000), h = hours[d.getHours()]!;
    h.q.push(queued[i]!); h.r.push(running[i]!); h.rq.push(runsQ[i]!);
    if (day(d.toISOString()) === today) { const x = todays.get(d.getHours()) ?? { q: 0, r: 0, rq: 0 }; todays.set(d.getHours(), { q: Math.max(x.q, queued[i]!), r: Math.max(x.r, running[i]!), rq: Math.max(x.rq, runsQ[i]!) }); }
  }
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  say(`### By hour of day (${tz}), all ${Math.round(n / 1440)} days\n`);
  say(`Runs with a job waiting for a runner, mean / max; jobs waiting, mean / max; jobs running, max. Today's max in the last column.\n`);
  say("| hour | runs waiting | jobs waiting | jobs running, max | today: runs waiting / jobs running, max |\n|---|---:|---:|---:|---:|");
  const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);
  hours.forEach((h, i) => {
    const td = todays.get(i);
    say(`| ${String(i).padStart(2, "0")}:00 | ${m1(mean(h.rq))} / ${pct(h.rq, 1)} | ${m1(mean(h.q))} / ${pct(h.q, 1)} | ${pct(h.r, 1)} | ${td ? `${td.rq} / ${td.r}` : ""} |`);
  });
  const busy = [...running].filter((_, i) => queued[i]! > 0);
  say(`\nWhile any job was waiting, ${pct(busy, 0.5)} jobs were running at the median (${pct(busy, 0.9)} at p90; ${Math.max(...running)} at the very most, a GitHub burst). That is the account's concurrent-job ceiling: past it a run queues, however fast its tests are. Minutes with a job waiting: ${busy.length} of ${n} (${share(busy.length, n)}).\n`);
}

/** The job name without the shard: "test two-fronts 2/4" -> "test two-fronts". */
const suiteOf = (job: string) => job.replace(/ \d+\/\d+$/, "");

function perJob(rows: Row[], say: (s: string) => void) {
  say("## 2. Jobs: duration and where it goes\n");
  const by = new Map<string, { runs: Set<number>; d: number[]; k: Record<string, number> }>();
  for (const { run, jobs } of rows) for (const j of jobs.filter((j) => ran(j) && j.completed_at)) {
    const e = by.get(j.name) ?? { runs: new Set(), d: [], k: { checkout: 0, setup: 0, install: 0, test: 0, other: 0 } };
    e.runs.add(run.id); e.d.push(span(j.started_at, j.completed_at));
    for (const s of j.steps) e.k[stepKind(s.name)]! += span(s.started_at, s.completed_at);
    by.set(j.name, e);
  }
  const list = [...by].map(([n, e]) => ({ n, ...e, total: sum(e.d) })).sort((a, b) => b.total - a.total);
  say(`The 30 jobs with the most job-minutes (of ${list.length}).\n`);
  say("| job | runs | p50 | p90 | job-min | checkout | setup | install | test | other |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const e of list.slice(0, 30)) {
    const tot = sum(Object.values(e.k));
    say(`| ${e.n} | ${e.runs.size} | ${m1(pct(e.d, 0.5))} | ${m1(pct(e.d, 0.9))} | ${Math.round(e.total)} | ${share(e.k.checkout!, tot)} | ${share(e.k.setup!, tot)} | ${share(e.k.install!, tot)} | ${share(e.k.test!, tot)} | ${share(e.k.other!, tot)} |`);
  }
  const all = { checkout: 0, setup: 0, install: 0, test: 0, other: 0 } as Record<string, number>;
  for (const e of list) for (const k in all) all[k]! += e.k[k]!;
  const tot = sum(Object.values(all));
  say(`\nAcross every job: ${Object.entries(all).map(([k, v]) => `${k} ${Math.round(v)} min (${share(v, tot)})`).join(", ")}.\n`);
  return list;
}

/** The files a run's PR changed (against the base it was opened on, or main's merge-base for an old run). */
async function filesOf(row: Row): Promise<string[] | undefined> {
  if (!row.pr) return undefined;
  const c = await getJ(`compare/${row.pr.base}...${row.run.head_sha}`, Compare, () => true).catch(() => undefined);
  return c?.files.map((f) => f.filename);
}

/** The apps a change can break, the way scripts/ci-apps.ts decides it but scoped by imports: an app it touched, an app
 * that imports a package it touched, or "all" for the lockfile, the apps workflow, ci-apps.ts and root package.json. */
export function reach(files: string[], using: Map<string, Set<string>>): Set<string> | "all" {
  if (files.some((f) => /^(bun\.lock|package\.json|\.github\/workflows\/apps\.yml|scripts\/ci-apps\.ts)$/.test(f))) return "all";
  const out = new Set<string>();
  for (const f of files) {
    const a = f.match(/^apps\/([^/]+)\//)?.[1], p = f.match(/^packages\/([^/]+)\//)?.[1];
    if (a) out.add(a);
    if (p) for (const x of using.get(p) ?? []) out.add(x);
  }
  return out;
}

/** Whether a failed job's code was in the change's reach; undefined for typecheck and when the PR is unknown. */
function touchedBy(job: string, files: string[] | undefined, using: Map<string, Set<string>>): boolean | undefined {
  const dir = appOf(job);
  if (!files || !dir) return undefined;
  const r = reach(files, using);
  if (r === "all") return true;
  const app = dir.match(/^apps\/([^/]+)\//)?.[1];
  return app ? r.has(app) : files.some((f) => f.startsWith(dir));
}

type Fail = { job: string; suite: string; row: Row; at: string; touched?: boolean; tests: string[] };
const prKey = (r: Row) => r.pr?.number ?? r.run.head_branch ?? r.run.id;

async function failures(rows: Row[], using: Map<string, Set<string>>, logs: boolean, say: (s: string) => void): Promise<Fail[]> {
  say("## 3. Failures\n");
  const fails: Fail[] = [];
  await Promise.all(rows.flatMap((row) => row.jobs.filter((j) => j.conclusion === "failure" && j.name !== "apps").map(async (j) => {
    const touched = touchedBy(j.name, await filesOf(row), using);
    const tests = logs && /^test /.test(j.name) ? failsOf(await getLog(j.id)) : [];
    fails.push({ job: j.name, suite: suiteOf(j.name), row, at: j.completed_at ?? j.created_at, touched, tests });
  })));
  const by = new Map<string, Fail[]>();
  for (const f of fails) by.set(f.suite, [...(by.get(f.suite) ?? []), f]);
  const ranIn = new Map<string, number>();
  for (const { jobs } of rows) for (const n of new Set(jobs.filter(ran).map((j) => suiteOf(j.name)))) ranIn.set(n, (ranIn.get(n) ?? 0) + 1);
  say(`${fails.length} failed jobs. "Untouched" means the PR changed nothing that job tests (its app, a package the app imports, the lockfile): main was broken or the test is flaky. Shards are summed.\n`);
  say("| job | failed | of runs | on PRs that touched it | untouched | unknown | distinct PRs hit |\n|---|---:|---:|---:|---:|---:|---:|");
  for (const [n, fs] of [...by].sort((a, b) => b[1].length - a[1].length).slice(0, 25))
    say(`| ${n} | ${fs.length} | ${ranIn.get(n) ?? 0} | ${fs.filter((f) => f.touched === true).length} | ${fs.filter((f) => f.touched === false).length} | ${fs.filter((f) => f.touched === undefined).length} | ${new Set(fs.map((f) => prKey(f.row))).size} |`);
  const named = new Map<string, Fail[]>();
  for (const f of fails) for (const k of f.tests) named.set(k, [...(named.get(k) ?? []), f]);
  say(`\nThe failing tests by name (from the failed jobs' logs), most often first:\n`);
  say("| test | failed | untouched | PRs | days |\n|---|---:|---:|---:|---|");
  for (const [k, fs] of [...named].sort((a, b) => b[1].length - a[1].length).slice(0, 15))
    say(`| ${k.replace(/\|/g, "\\|").slice(0, 140)} | ${fs.length} | ${fs.filter((f) => f.touched === false).length} | ${new Set(fs.map((f) => prKey(f.row))).size} | ${[...new Set(fs.map((f) => day(f.at).slice(5)))].sort().join(", ")} |`);
  // The same test failing on 3+ PRs in one day is main broken (or a flake), whatever those PRs touched: a PR that
  // moved packages/util "touches" qcrm, yet didn't break its demo. A job with no test names counts only when untouched.
  const blocks = new Map<string, Fail[]>();
  for (const f of fails) for (const k of f.tests.length ? f.tests : f.touched === false ? [`${f.suite} (no test named in the log)`] : []) {
    const key = `${day(f.at)}\t${k}`;
    blocks.set(key, [...(blocks.get(key) ?? []), f]);
  }
  const big = [...blocks].map(([k, fs]) => ({ k, fs, prs: new Set(fs.map((f) => prKey(f.row))) })).filter((b) => b.prs.size >= 3).sort((a, b) => b.prs.size - a.prs.size);
  say(`\n### Tests that blocked many PRs at once\n\nThe same test failing on 3 or more PRs on one day, most PRs first; "untouched" counts the PRs that changed nothing it tests.\n`);
  say("| day | test | PRs blocked | untouched | first → last failure |\n|---|---|---:|---:|---|");
  for (const b of big.slice(0, 20)) {
    const [d, test] = b.k.split("\t"), times = b.fs.map((f) => f.at).sort();
    say(`| ${d} | ${test!.replace(/\|/g, "\\|").slice(0, 140)} | ${b.prs.size} | ${new Set(b.fs.filter((f) => f.touched === false).map((f) => prKey(f.row))).size} | ${hhmm(times[0]!)} → ${hhmm(times.at(-1)!)} |`);
  }
  if (!big.length) say("| - | none | | | |");
  say("");
  return fails;
}

async function suggestions(rows: Row[], jobs: ReturnType<typeof perJob>, fails: Fail[], using: Map<string, Set<string>>, days: number, say: (s: string) => void) {
  say("## 4. What to cut, with numbers\n");
  const total = sum(rows.flatMap((r) => r.jobs.filter(ran).map((j) => span(j.started_at, j.completed_at))));
  const kind = (j: Job, k: string) => sum(j.steps.filter((s) => stepKind(s.name) === k).map((s) => span(s.started_at, s.completed_at)));
  const done = rows.flatMap((r) => r.jobs.filter((j) => ran(j) && j.completed_at));
  const deep = /^(plan|scripts|containers-plan|containers .*)$/;
  const coDeep = done.filter((j) => deep.test(j.name)).map((j) => kind(j, "checkout")), coShallow = done.filter((j) => !deep.test(j.name)).map((j) => kind(j, "checkout"));
  const coSave = sum(coDeep) - coDeep.length * pct(coShallow, 0.5);
  say(`**Checkout depth.** The jobs with \`fetch-depth: 0\` (plan, scripts, containers-plan, containers) check out in ${Math.round(60 * pct(coDeep, 0.5))} s at the median against ${Math.round(60 * pct(coShallow, 0.5))} s for the shallow ones (the test jobs are already shallow). Making them shallow (plan needs only the merge-base: \`fetch-depth: 1\` plus \`git fetch --depth=200 origin main\`, or \`filter: blob:none\`) saves about **${Math.round(coSave)} job-min** (${share(coSave, total)}).\n`);

  const over = (j: Job) => kind(j, "checkout") + kind(j, "setup") + kind(j, "install");
  const tests = done.filter((j) => /^test /.test(j.name));
  const small = new Set(jobs.filter((e) => /^test /.test(e.n) && !/ \d+\/\d+$/.test(e.n) && pct(e.d, 0.5) < 1).map((e) => e.n));
  const smallOver = sum(tests.filter((j) => small.has(j.name)).map(over));
  say(`**Per-job overhead.** Checkout, setup and install are ${share(sum(done.map(over)), total)} of all job-minutes: each job pays ~${Math.round(60 * pct(done.map(over), 0.5))} s before its first test. ${small.size} app suites finish in under a minute at the median; run them six to a job (one checkout and install for six apps) and they keep five sixths of ${Math.round(smallOver)} overhead job-min: **${Math.round((smallOver * 5) / 6)} job-min** saved, and ${small.size - Math.ceil(small.size / 6)} fewer jobs in the queue per full run.\n`);

  // Runs that tested every app because packages/ or the lockfile moved: which apps actually import what changed?
  const appsRuns = rows.filter((r) => r.wf === "apps.yml" && r.run.status === "completed");
  const nTest = (r: Row) => new Set(r.jobs.filter((j) => ran(j) && /^test /.test(j.name)).map((j) => suiteOf(j.name))).size;
  const most = Math.max(0, ...appsRuns.map(nTest));
  const full = appsRuns.filter((r) => most > 5 && nTest(r) >= 0.8 * most);
  const testMin = (r: Row) => sum(r.jobs.filter((j) => ran(j) && /^test /.test(j.name)).map((j) => span(j.started_at, j.completed_at)));
  const why = new Map<string, number>();
  let scoped = 0, known = 0;
  for (const r of full) {
    const files = await filesOf(r);
    if (!files) continue;
    known++;
    const reachOf = reach(files, using);
    const shared = files.filter((f) => /^(packages\/[^/]+\/|bun\.lock$|package\.json$|\.github\/workflows\/apps\.yml$|scripts\/ci-apps\.ts$)/.test(f)).map((f) => f.match(/^packages\/[^/]+/)?.[0] ?? f);
    for (const s of new Set(shared)) why.set(s, (why.get(s) ?? 0) + 1);
    if (reachOf !== "all") scoped += sum(r.jobs.filter((j) => ran(j) && /^test /.test(j.name) && !reachOf.has(suiteOf(j.name).slice(5))).map((j) => span(j.started_at, j.completed_at)));
  }
  const fullMin = sum(full.map(testMin));
  say(`**Every app on a shared change.** ${full.length} of ${appsRuns.length} apps runs tested ${Math.round(0.8 * most)}+ of ${most} apps and spent ${Math.round(fullMin)} job-min on test jobs, ${share(fullMin, sum(appsRuns.map(testMin)))} of all test job-min. What set them off (${known} with a known PR): ${[...why].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k} ${n}${k.startsWith("packages/") ? ` (${using.get(k.slice(9))?.size ?? 0} importing apps)` : ""}`).join(", ")}. Testing only the apps that import a changed package (and still every app for the lockfile, the workflow and ci-apps.ts) saves **${Math.round(scoped)} job-min**; a nightly all-apps run catches what the import graph misses.\n`);

  // Suites that cost a lot and rarely caught a failure of their own: schedule them.
  const caught = new Map<string, number>(), noise = new Map<string, number>();
  for (const f of fails) if (f.touched !== undefined) { const m = f.touched ? caught : noise; m.set(f.suite, (m.get(f.suite) ?? 0) + 1); }
  const suites = new Map<string, { min: number; runs: Set<number> }>();
  for (const r of rows) for (const j of r.jobs.filter((j) => ran(j) && j.completed_at && /^test /.test(j.name))) {
    const s = suites.get(suiteOf(j.name)) ?? { min: 0, runs: new Set() };
    s.min += span(j.started_at, j.completed_at); s.runs.add(r.run.id);
    suites.set(suiteOf(j.name), s);
  }
  const ranked = [...suites].map(([n, s]) => ({ n, ...s, perRun: s.min / s.runs.size, caught: caught.get(n) ?? 0, noise: noise.get(n) ?? 0 })).sort((a, b) => b.min - a.min);
  const cand = ranked.filter((s) => s.perRun >= 1.5 && s.caught <= 2 && s.runs.size >= 10);
  say(`**Suites to run on a schedule.** A suite qualifies when one run of it costs 1.5+ job-min (shards summed), it ran in 10+ runs, and it caught at most 2 failures on PRs that touched it. Nightly costs one run a day; hourly (like \`desktop-hourly.yml\`) 24.\n`);
  say("| suite | runs | job-min per run | job-min | caught (touched) | untouched failures | nightly | hourly |\n|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const s of ranked.slice(0, 15)) say(`| ${s.n}${cand.includes(s) ? " **(schedule)**" : ""} | ${s.runs.size} | ${m1(s.perRun)} | ${Math.round(s.min)} | ${s.caught} | ${s.noise} | ${Math.round(s.perRun * days)} | ${Math.round(s.perRun * days * 24)} |`);
  const save = sum(cand.map((s) => s.min - s.perRun * days)), saveH = sum(cand.map((s) => s.min - s.perRun * days * 24));
  say(`\nMoving the ${cand.length} marked suites to nightly saves **${Math.round(save)} job-min** (${share(save, total)}); hourly saves ${Math.round(saveH)}. The cost: a break in one of them lands on main and shows up on the next scheduled run instead of on its PR, so the scheduled run has to open an issue someone picks up.\n`);
  say(`Of ${Math.round(total)} job-min in ${days} days, these overlap (a scheduled suite was also in the every-app runs), so don't add them up. Fewer and shorter jobs is what shortens the queue: the wait above comes from jobs past the concurrency ceiling, not from slow tests.\n`);
}

if (import.meta.main) {
  help(import.meta.path);
  const argv = process.argv.slice(2), days = Number(argv[argv.indexOf("--days") + 1]) || 7, logs = !argv.includes("--no-logs");
  const since = Date.now() - days * 86_400_000;
  const [runs, pulls] = await Promise.all([
    Promise.all(WORKFLOWS.map(async (wf) => (await runsOf(wf, days)).map((run) => ({ run, wf })))).then((x) => x.flat()),
    pullsSince(since - 14 * 86_400_000),
  ]);
  // A run whose job list GitHub won't hand over (a 502 that outlasts the retries) is left out and counted, not fatal.
  let missed = 0;
  const rows: Row[] = (await Promise.all(runs.map(async (r) => {
    const jobs = await jobsOf(r.run).catch((e: Error) => { missed++; console.error(e.message); return undefined; });
    return jobs && { ...r, jobs, pr: prFor(r.run, pulls) };
  }))).filter((r) => r !== undefined);
  const using = appsUsing();
  const out: string[] = [], say = (s: string) => out.push(s);
  say(`# CI report: ${WORKFLOWS.join(" and ")}, last ${days} days\n`);
  say(`${rows.length} runs (${WORKFLOWS.map((w) => `${rows.filter((r) => r.wf === w).length} ${w}`).join(", ")}), ${rows.reduce((n, r) => n + r.jobs.filter(ran).length, 0)} jobs that ran, ${day(new Date(since).toISOString())} to ${day(new Date().toISOString())}${missed ? `; ${missed} runs left out (GitHub wouldn't list their jobs)` : ""}. Times are ${Intl.DateTimeFormat().resolvedOptions().timeZone}. Made by \`bun scripts/ci-report.ts\`.\n`);
  perRun(rows, say);
  const jobs = perJob(rows, say);
  const fails = await failures(rows, using, logs, say);
  await suggestions(rows, jobs, fails, using, days, say);
  console.log(out.join("\n"));
}
