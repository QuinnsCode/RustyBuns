// Ester the tester, Mervin's pal. When the board's `--check` goes red she sorts every failing test by who owns it,
// so what blocks Mervin is either dropped, retried, handed to the PR that caused it, or named for a person.
//
//   main     fails on main too (this sandbox lacks the claude CLI, a native build...): not the board's, ignore.
//   flaky    failed once, passed on a rerun of just that run: note it, file an issue if it keeps happening.
//   own      the failure sits in an app a PR with red CI of its own touches: that PR fixes its own CI first.
//   wait     the same, but that PR's CI hasn't finished: hold it and rerun when its CI is done.
//   slow     the PR waits only on checks that always take long (10 min or more): merge on the fast checks, the
//            slow one is owed. It is not held.
//   blocks   only the merged tree breaks it: the PRs that touched that app are the suspects, and the first stage
//            that breaks it (--check-stages) is the one to hold back.
//
// Rows are kept in a JSONL file (`.mervin/ester-rows.jsonl`) so the ranking learns across runs.
//
// Pure: `triage` takes what the board already knows plus an optional rerun, so it is tested without installing.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CheckTime, Stage } from "./mervin-board.ts";

export type Owner = "main" | "flaky" | "own" | "wait" | "slow" | "blocks";
export interface Verdict { test: string; owner: Owner; prs: number[]; why: string }

/** `apps/foo: test name` to the app dir it ran in (`.` for repo-wide checks). */
const dirOf = (failure: string) => failure.split(": ")[0]!;

/** The PRs whose stages wrote a file under `dir` (all of them for a repo-wide run). */
function touching(stages: Stage[], dir: string, written: Set<string>) {
  return stages.filter((s) => s.files.some((f) => written.has(f.path) && f.tier !== "card" && (dir === "." || f.path.startsWith(`${dir}/`)))).map((s) => s.pr);
}

/** A check at or over this many seconds is slow, whatever the others take. */
export const SLOW_SECS = 600;

/**
 * The checks that are slow: those whose median finished time across the board's PRs reaches `limit`, or sits at least
 * five times the median of all checks. Judged by name, so a PR still running one is known slow before it finishes.
 */
export function slowChecks(stages: Stage[], limit = SLOW_SECS): Map<string, number> {
  const by = new Map<string, number[]>();
  for (const c of stages.flatMap((s) => s.checks ?? [])) if (c.done && c.secs) by.set(c.name, [...(by.get(c.name) ?? []), c.secs]);
  const mid = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  const med = new Map([...by].map(([name, xs]) => [name, mid(xs)] as const));
  const all = med.size ? mid([...med.values()]) : 0;
  return new Map([...med].filter(([, m]) => m >= limit || (med.size > 2 && m >= all * 5 && m >= 60)));
}

/** The checks a PR is still waiting on. */
const running = (s: Stage): CheckTime[] => (s.checks ?? []).filter((c) => !c.done);

/** True when everything a PR still waits on is slow: it can merge on its fast checks. */
export const onlySlow = (s: Stage, slow: Map<string, number>) => running(s).length > 0 && running(s).every((c) => slow.has(c.name));

/**
 * Sorts `failed` (the merged tree's failures). `onMain` is what fails on main in the same sandbox, `rerun` the
 * failures left after running only the failing runs again (omit to skip flaky detection).
 */
export function triage(failed: string[], stages: Stage[], onMain: Set<string>, rerun?: Set<string>, slow = new Map<string, number>()): Verdict[] {
  const written = new Set(stages.flatMap((s) => s.files.filter((f) => f.tier !== "card").map((f) => f.path)));
  return failed.map((test) => {
    if (onMain.has(test)) return { test, owner: "main", prs: [], why: "fails on main in this sandbox too" };
    if (rerun && !rerun.has(test)) return { test, owner: "flaky", prs: [], why: "passed on a rerun" };
    const prs = touching(stages, dirOf(test), written);
    const red = stages.filter((s) => prs.includes(s.pr) && s.ci === "fail");
    if (red.length) return { test, owner: "own", prs: red.map((s) => s.pr), why: `PR CI is already red (${red.flatMap((s) => s.failing ?? []).join(", ") || "failing"})` };
    const waiting = stages.filter((s) => prs.includes(s.pr) && s.ci === "pending");
    const pending = waiting.filter((s) => !onlySlow(s, slow));
    if (!pending.length && waiting.length) return { test, owner: "slow", prs: waiting.map((s) => s.pr), why: "PR CI is only waiting on slow checks: merge on the fast ones, the slow one is owed" };
    if (pending.length) return { test, owner: "wait", prs: pending.map((s) => s.pr), why: "PR CI hasn't finished: hold it, rerun when it has" };
    return { test, owner: "blocks", prs, why: prs.length ? "only the merged tree breaks it" : "no stage touched this app: check the install or lockfile" };
  });
}

const secs = (ms: number) => `${(ms / 1000).toFixed(0)}s`;

/**
 * How long things take, so she can weigh a rerun: this sandbox's slowest runs (`runs`, wall ms), what the flaky
 * rerun cost (`reran`, the runs it repeated, in ms; they go side by side so the slowest counts), and the slowest
 * CI check GitHub timed on each PR (`ciSecs`).
 */
export function timing(runs: { dir: string; cmd: string; ms: number }[], reran: number[], stages: Stage[]): string[] {
  const out: string[] = [];
  const slow = [...runs].sort((a, b) => b.ms - a.ms).slice(0, 3);
  if (slow.length) out.push(`  slowest runs: ${slow.map((r) => `${r.dir}: ${r.cmd} ${secs(r.ms)}`).join(", ")}`);
  if (reran.length) out.push(`  the flaky rerun took ${secs(Math.max(...reran))}`);
  const ci = stages.filter((s) => s.ciSecs).sort((a, b) => b.ciSecs! - a.ciSecs!).slice(0, 3);
  if (ci.length) out.push(`  slowest PR CI: ${ci.map((s) => `#${s.pr} ${Math.round(s.ciSecs! / 60)}m`).join(", ")}`);
  return out;
}

/** Ester's report: counts first, then what needs a person, then how long it all took. */
export function report(vs: Verdict[], runs: { dir: string; cmd: string; ms: number }[] = [], reran: number[] = [], stages: Stage[] = []): string[] {
  const n = (o: Owner) => vs.filter((v) => v.owner === o).length;
  const out = [`Ester: ${vs.length} failing, ${n("main")} not the board's, ${n("flaky")} flaky, ${n("own")} a PR's own red, ${n("wait")} waiting on CI, ${n("slow")} on slow checks, ${n("blocks")} block Mervin`];
  for (const v of vs.filter((v) => v.owner !== "main")) out.push(`  ${v.owner.padEnd(6)} ${v.test}  ${v.why}${v.prs.length ? `  (${v.prs.map((p) => `#${p}`).join(", ")})` : ""}`);
  return [...out, ...timing(runs, reran, stages)];
}

/** Where testing holds merging up, by check name: "3 PRs waiting on stress.ts (about 40 min)". Empty when nothing waits. */
export function waitLines(stages: Stage[], slow = slowChecks(stages)): string[] {
  const by = new Map<string, number[]>();
  for (const s of stages) for (const c of running(s)) by.set(c.name, [...(by.get(c.name) ?? []), s.pr]);
  const done = (name: string) => stages.flatMap((s) => s.checks ?? []).filter((c) => c.name === name && c.done && c.secs).map((c) => c.secs).sort((a, b) => a - b);
  const lines = [...by].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).map(([name, prs]) => {
    const t = done(name)[Math.floor(done(name).length / 2)];
    return `${prs.length} PR${prs.length === 1 ? "" : "s"} waiting on ${name}${t ? ` (about ${Math.max(1, Math.round(t / 60))} min${slow.has(name) ? ", slow: merge without it" : ""})` : ""}`;
  });
  return lines.length ? ["Ester: where testing holds merging up", ...lines.map((l) => `  ${l}`)] : [];
}

/** The PRs to hold back from the merge wave: every PR named by an own, wait or blocks verdict (not a slow one: it merges). */
export const hold = (vs: Verdict[]) => [...new Set(vs.filter((v) => v.owner !== "main" && v.owner !== "flaky" && v.owner !== "slow").flatMap((v) => v.prs))].sort((a, b) => a - b);

/** The packages whose version range differs between two package.json texts (null for a file that doesn't exist). */
export function packagesChanged(before: string | null, after: string | null): string[] {
  const deps = (text: string | null) => {
    try {
      const j = JSON.parse(text ?? "{}");
      return Object.assign({}, ...["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].map((k) => j[k] ?? {})) as Record<string, string>;
    } catch { return {}; }
  };
  const a = deps(before), b = deps(after);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((p) => a[p] !== b[p]).sort();
}

/** One row per PR on the board: the packages its manifests changed, how its failures were judged, whether it clashed. */
export interface Row {
  pr: number; apps: string[]; pkgs: string[]; owners: Owner[]; clashed: boolean;
  /** Slow checks still unfinished when the PR was on the board: owed if it merges without them. */
  owed?: string[];
  /** Finished checks (name, secs) and the names that failed, so a check's catch rate can be learned across runs. */
  checks?: CheckTime[]; failed?: string[];
}

/** Rows from a board's stages, Ester's verdicts and Mervin's clashes (each clash marks every PR in it). */
export function rows(stages: (Stage & { pkgs?: string[] })[], vs: Verdict[], clashes: { prs: number[] }[], slow = new Map<string, number>()): Row[] {
  return stages.map((s) => ({
    pr: s.pr,
    apps: [...new Set(s.files.filter((f) => f.tier !== "card").map((f) => f.path.match(/^apps\/[^/]+/)?.[0]).filter((a): a is string => !!a))].sort(),
    pkgs: s.pkgs ?? [],
    owners: vs.filter((v) => v.prs.includes(s.pr)).map((v) => v.owner),
    clashed: clashes.some((c) => c.prs.includes(s.pr)),
    owed: onlySlow(s, slow) ? running(s).map((c) => c.name) : [],
    checks: (s.checks ?? []).filter((c) => c.done && c.secs),
    failed: s.failing ?? [],
  }));
}

export interface Hurt { pkg: string; touches: number; broke: number; clashes: number; rate: number }

/** Per package: PRs touching it, how many were `blocks` or `own`, how many clashed, and clashes as a share of touches. */
export function hurting(rs: Row[]): Hurt[] {
  const by = new Map<string, Hurt>();
  for (const r of rs) for (const pkg of r.pkgs) {
    const h = by.get(pkg) ?? { pkg, touches: 0, broke: 0, clashes: 0, rate: 0 };
    h.touches++;
    if (r.owners.some((o) => o === "blocks" || o === "own")) h.broke++;
    if (r.clashed) h.clashes++;
    h.rate = h.clashes / h.touches;
    by.set(pkg, h);
  }
  return [...by.values()].sort((a, b) => b.broke + b.clashes - (a.broke + a.clashes) || b.rate - a.rate || a.pkg.localeCompare(b.pkg));
}

/** The "dependencies that hurt" list: only packages that broke a test or clashed. */
export function hurtLines(rs: Row[], top = 5): string[] {
  const h = hurting(rs).filter((x) => x.broke || x.clashes).slice(0, top);
  if (!h.length) return [];
  return ["Ester: dependencies that hurt", ...h.map((x) => `  ${x.pkg.padEnd(24)} ${x.touches} PR${x.touches === 1 ? "" : "s"}, ${x.broke} broke a test, ${x.clashes} clashed (${Math.round(x.rate * 100)}%)`)];
}

/**
 * Slow-lane debt: the PRs that merged without a slow check, grouped by check. Each check is owed one run against the
 * last green sha, not one per PR. `merged` is the PRs known to have merged (omit for every kept row).
 */
export function debt(rs: Row[], merged?: Set<number>): Map<string, number[]> {
  const by = new Map<string, number[]>();
  for (const r of rs) if (!merged || merged.has(r.pr)) for (const name of r.owed ?? []) by.set(name, [...(by.get(name) ?? []), r.pr]);
  return by;
}

/** The debt as board lines, with the sha to run each check against. Empty when nothing is owed. */
export function debtLines(rs: Row[], sha: string, merged?: Set<number>): string[] {
  const d = [...debt(rs, merged)].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  if (!d.length) return [];
  return ["Ester: slow-lane debt (run once, against the last green sha)", ...d.map(([name, prs]) => `  ${name}  owed by ${prs.map((p) => `#${p}`).join(", ")}  run it once against ${sha.slice(0, 9)}`)];
}

export interface Candidate { name: string; secs: number; ran: number; caught: number; score: number }

/**
 * Checks that might run on release only, worst value first. A check "catches" when it is the only one that failed on
 * a PR; the score is its median seconds x (1 - catch rate), so a long check that never catches anything leads.
 */
export function releaseOnly(rs: Row[], min = 5): Candidate[] {
  const by = new Map<string, { secs: number[]; caught: number }>();
  for (const r of rs) for (const c of r.checks ?? []) {
    const e = by.get(c.name) ?? { secs: [], caught: 0 };
    e.secs.push(c.secs);
    if (r.failed?.length === 1 && r.failed[0] === c.name) e.caught++;
    by.set(c.name, e);
  }
  return [...by].filter(([, e]) => e.secs.length >= min).map(([name, e]) => {
    const secs = [...e.secs].sort((a, b) => a - b)[Math.floor(e.secs.length / 2)]!;
    return { name, secs, ran: e.secs.length, caught: e.caught, score: Math.round(secs * (1 - e.caught / e.secs.length)) };
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/** The insight from the record, ending in a question to the owner (null until a check has run `min` times). */
export function insight(rs: Row[], min = 5): string | null {
  const c = releaseOnly(rs, min)[0];
  if (!c || c.secs < 60) return null;
  return `Ester: ${c.name} took about ${Math.max(1, Math.round(c.secs / 60))} min over ${c.ran} PRs and caught ${c.caught} that nothing else did. Run it only at release?`;
}

export interface Timed { name: string; ms: number }

/**
 * Splits tests into `n` shards of about equal total time (longest first onto the lightest shard). Per-test times come
 * from the ledger's junit reports (`Seen.ms`); a test with no time counts as `fallback` ms.
 */
export function shard(tests: Timed[], n: number, fallback = 100): Timed[][] {
  const out: { total: number; tests: Timed[] }[] = Array.from({ length: Math.max(1, n) }, () => ({ total: 0, tests: [] }));
  for (const t of [...tests].sort((a, b) => b.ms - a.ms || a.name.localeCompare(b.name))) {
    const lightest = out.reduce((m, x) => (x.total < m.total ? x : m));
    lightest.tests.push(t);
    lightest.total += t.ms || fallback;
  }
  return out.map((x) => x.tests);
}

/** Appends this run's rows to the JSONL `file`, one line per PR stamped with `at`. */
export function keep(file: string, rs: Row[], at = new Date().toISOString()) {
  if (!rs.length) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, rs.map((r) => JSON.stringify({ at, ...r })).join("\n") + "\n");
}

/** Every kept row, a PR's latest line standing for it (a rerun of the same PR replaces, not doubles, its row). */
export function kept(file: string): Row[] {
  if (!existsSync(file)) return [];
  const by = new Map<number, Row>();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    try {
      const { at: _at, ...r } = JSON.parse(line);
      if (typeof r.pr === "number") by.set(r.pr, r);
    } catch { /* a torn line is skipped */ }
  }
  return [...by.values()];
}
