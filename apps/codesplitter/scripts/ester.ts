// Ester the tester, Mervin's pal. When the board's `--check` goes red she sorts every failing test by who owns it,
// so what blocks Mervin is either dropped, retried, handed to the PR that caused it, or named for a person.
//
//   main     fails on main too (this sandbox lacks the claude CLI, a native build...): not the board's, ignore.
//   flaky    failed once, passed on a rerun of just that run: note it, file an issue if it keeps happening.
//   own      the failure sits in an app a PR with red CI of its own touches: that PR fixes its own CI first.
//   wait     the same, but that PR's CI hasn't finished: hold it and rerun when its CI is done.
//   blocks   only the merged tree breaks it: the PRs that touched that app are the suspects, and the first stage
//            that breaks it (--check-stages) is the one to hold back.
//
// Pure: `triage` takes what the board already knows plus an optional rerun, so it is tested without installing.

import type { Stage } from "./mervin-board.ts";

export type Owner = "main" | "flaky" | "own" | "wait" | "blocks";
export interface Verdict { test: string; owner: Owner; prs: number[]; why: string }

/** `apps/foo: test name` to the app dir it ran in (`.` for repo-wide checks). */
const dirOf = (failure: string) => failure.split(": ")[0]!;

/** The PRs whose stages wrote a file under `dir` (all of them for a repo-wide run). */
function touching(stages: Stage[], dir: string, written: Set<string>) {
  return stages.filter((s) => s.files.some((f) => written.has(f.path) && f.tier !== "card" && (dir === "." || f.path.startsWith(`${dir}/`)))).map((s) => s.pr);
}

/**
 * Sorts `failed` (the merged tree's failures). `onMain` is what fails on main in the same sandbox, `rerun` the
 * failures left after running only the failing runs again (omit to skip flaky detection).
 */
export function triage(failed: string[], stages: Stage[], onMain: Set<string>, rerun?: Set<string>): Verdict[] {
  const written = new Set(stages.flatMap((s) => s.files.filter((f) => f.tier !== "card").map((f) => f.path)));
  return failed.map((test) => {
    if (onMain.has(test)) return { test, owner: "main", prs: [], why: "fails on main in this sandbox too" };
    if (rerun && !rerun.has(test)) return { test, owner: "flaky", prs: [], why: "passed on a rerun" };
    const prs = touching(stages, dirOf(test), written);
    const red = stages.filter((s) => prs.includes(s.pr) && s.ci === "fail");
    if (red.length) return { test, owner: "own", prs: red.map((s) => s.pr), why: `PR CI is already red (${red.flatMap((s) => s.failing ?? []).join(", ") || "failing"})` };
    const pending = stages.filter((s) => prs.includes(s.pr) && s.ci === "pending");
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
  const out = [`Ester: ${vs.length} failing, ${n("main")} not the board's, ${n("flaky")} flaky, ${n("own")} a PR's own red, ${n("wait")} waiting on CI, ${n("blocks")} block Mervin`];
  for (const v of vs.filter((v) => v.owner !== "main")) out.push(`  ${v.owner.padEnd(6)} ${v.test}  ${v.why}${v.prs.length ? `  (${v.prs.map((p) => `#${p}`).join(", ")})` : ""}`);
  return [...out, ...timing(runs, reran, stages)];
}

/** The PRs to hold back from the merge wave: every PR named by an own, wait or blocks verdict. */
export const hold = (vs: Verdict[]) => [...new Set(vs.filter((v) => v.owner !== "main" && v.owner !== "flaky").flatMap((v) => v.prs))].sort((a, b) => a - b);

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
export interface Row { pr: number; apps: string[]; pkgs: string[]; owners: Owner[]; clashed: boolean }

/** Rows from a board's stages, Ester's verdicts and Mervin's clashes (each clash marks every PR in it). */
export function rows(stages: (Stage & { pkgs?: string[] })[], vs: Verdict[], clashes: { prs: number[] }[]): Row[] {
  return stages.map((s) => ({
    pr: s.pr,
    apps: [...new Set(s.files.filter((f) => f.tier !== "card").map((f) => f.path.match(/^apps\/[^/]+/)?.[0]).filter((a): a is string => !!a))].sort(),
    pkgs: s.pkgs ?? [],
    owners: vs.filter((v) => v.prs.includes(s.pr)).map((v) => v.owner),
    clashed: clashes.some((c) => c.prs.includes(s.pr)),
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
