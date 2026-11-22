// Which release-ring lane a PR takes (notes/release-rings.html sections 3 and 4, #5429). Agents open hundreds of PRs a
// week, so a PR that scores 60 or more out of 100 (and touches no CI, deploy or secrets wiring) goes in the fast lane:
// `rings.ts pick daily` takes it after 1 green hourly in a row instead of 3. Every other PR is standby, the normal soak.
// The checks are the same in every lane; only the waiting changes. Express stays the owner's own label (#4586).
//
// The score, from facts we already measure (first guesses: tune them after a week of labels):
//   what it touches   one app +30, two or three apps +15, packages/, scripts/ or the lockfile 0, CI/deploy/secrets -25
//   tests bite        every test file it adds or edits fails on the old code (scripts/test-bites.ts): +25
//   lines its tests   of the changed source lines, its tests ran 80% or more +15, some +5
//   size              under 100 changed lines +15, 100 to 500 +5, over 500 -10 (lock and generated files left out)
//   its app's month   reverts on main touching its apps in 30 days (ring-red.ts reverts the PR that turned the hourly
//                     ring red): none +15, one 0, two or more -10
//
//   bun scripts/lane.ts [--base <ref>] [--facts <test-bites facts.json>] [--json]   the lane and the reason line
//   bun scripts/lane.ts ... --pr <n>                writes lane:fast or lane:standby on PR n (taking the other off)
//                                                   and keeps one comment on it with the reason (needs gh, GITHUB_REPOSITORY)
//
// The facts file is `bun scripts/test-bites.ts --lines --facts <file>`; without it the bites and lines parts score 0.
// CI's `bites` job in apps.yml runs both on every PR.
import { int, obj, type Of } from "../packages/util/src/guard.ts";
import { GENERATED } from "../packages/util/src/overlap.ts";
import { appOf } from "./app-dirs.ts";
import { help } from "./help.ts";

/** What `bun scripts/test-bites.ts --facts` writes. */
export const Bites = obj({ tests: int(0, Infinity), failOnBase: int(0, Infinity), changed: int(0, Infinity), unrun: int(0, Infinity) });
export type Bites = Of<typeof Bites>;

/** One changed file: its path and lines added plus deleted (`git diff --numstat`; a binary file counts 0). */
export type Changed = { path: string; lines: number };

export type Facts = { files: Changed[]; bites?: Bites; reverts: Record<string, number> };

export const LANES = ["fast", "standby"] as const;
export type Lane = (typeof LANES)[number];

/** The score a PR needs for the fast lane. */
export const FAST_AT = 60;

/** CI, deploy and secrets wiring: never the fast lane. */
const WIRING = [/^\.github\//, /(^|\/)alchemy\.run\.ts$/, /(^|\/)wrangler\.(toml|jsonc?)$/, /(^|\/)\.env[^/]*$/, /deploy/i, /secret/i, /varlock/i];
/** Shared code: what every app runs on. */
const SHARED = [/^packages\//, /^scripts\//, /^package\.json$/, /(^|\/)bun\.lock$/, /^tsconfig[^/]*\.json$/, /^bunfig\.toml$/];
/** Words only: no app runs them. */
const DOCS = [/\.md$/, /^notes\//];

/** The apps `files` touch, sorted. */
export const appsOf = (files: string[]) => [...new Set(files.map(appOf).filter((a): a is string => !!a))].sort();

/** The score (0 to 100), its lane and the parts that made it, from `facts`. */
export function score(facts: Facts): { score: number; lane: Lane; wiring: boolean; parts: string[] } {
  const paths = facts.files.map((f) => f.path);
  const parts: string[] = [];
  let total = 0;
  const add = (n: number, why: string) => { total += n; parts.push(`${why} ${n >= 0 ? "+" : ""}${n}`); };

  const wiring = paths.filter((p) => WIRING.some((w) => w.test(p)));
  const apps = appsOf(paths);
  const shared = paths.some((p) => SHARED.some((s) => s.test(p)));
  const code = paths.filter((p) => !DOCS.some((d) => d.test(p)));
  if (wiring.length) add(-25, `CI/deploy/secrets wiring (${wiring[0]}${wiring.length > 1 ? ` +${wiring.length - 1}` : ""})`);
  else if (shared) add(0, "shared code");
  else if (apps.length === 1 || (!code.length && !apps.length)) add(30, apps.length ? `one app (${apps[0]})` : "words only");
  else if (apps.length <= 3) add(15, `${apps.length} apps`);
  else add(0, `${apps.length} apps`);

  const b = facts.bites;
  if (b && b.tests && b.failOnBase === b.tests) add(25, "tests bite");
  else parts.push(b?.tests ? `${b.tests - b.failOnBase} of ${b.tests} test files pass on the old code +0` : "no test changed +0");

  if (b?.changed) {
    const ran = (b.changed - b.unrun) / b.changed;
    add(ran >= 0.8 ? 15 : ran > 0 ? 5 : 0, `tests ran ${Math.round(ran * 100)}% of changed lines`);
  }

  const size = facts.files.filter((f) => !GENERATED.some((g) => g.test(f.path))).reduce((n, f) => n + f.lines, 0);
  add(size < 100 ? 15 : size <= 500 ? 5 : -10, `${size} lines`);

  if (apps.length) {
    const reverts = Math.max(...apps.map((a) => facts.reverts[a] ?? 0));
    add(reverts === 0 ? 15 : reverts === 1 ? 0 : -10, reverts ? `${reverts} revert${reverts === 1 ? "" : "s"} in 30 days` : "no reverts in 30 days");
  }

  const final = Math.max(0, Math.min(100, total));
  return { score: final, lane: final >= FAST_AT && !wiring.length ? "fast" : "standby", wiring: wiring.length > 0, parts };
}

/** The one line that goes on the PR. */
export function reasonLine(r: ReturnType<typeof score>): string {
  const why = r.wiring ? "touches CI/deploy/secrets wiring" : r.lane === "fast" ? `${FAST_AT} or more` : `under ${FAST_AT}`;
  return `lane:${r.lane} (score ${r.score}, ${why}): ${r.parts.join(", ")}`;
}

/** Changed files from `git diff --numstat` output. */
export function numstat(text: string): Changed[] {
  return text.split("\n").filter(Boolean).map((l) => {
    const [a = "0", d = "0", ...rest] = l.split("\t");
    return { path: rest.join("\t"), lines: (Number(a) || 0) + (Number(d) || 0) };
  });
}

/** Reverts per app from `git log --name-only --format=%x00%s` output: commits whose subject starts with "Revert". */
export function revertsByApp(log: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const commit of log.split("\0").filter(Boolean)) {
    const [subject = "", ...files] = commit.split("\n").filter(Boolean);
    if (!/^revert\b/i.test(subject)) continue;
    for (const app of appsOf(files)) out[app] = (out[app] ?? 0) + 1;
  }
  return out;
}

/** The marker line that finds this script's comment on a PR again. */
export const MARKER = "<!-- lane.ts -->";

if (import.meta.main) {
  help(import.meta.path);
  const argv = process.argv.slice(2);
  const flag = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const base = flag("--base") ?? "origin/main";
  const git = async (...args: string[]) => await Bun.$`git ${args}`.quiet().text();
  const fork = (await git("merge-base", base, "HEAD")).trim();
  const files = numstat(await git("diff", "--numstat", fork, "HEAD"));
  const reverts = revertsByApp(await git("log", "--since=30.days", "--name-only", "--format=%x00%s", base));
  const factsAt = flag("--facts");
  const bites = factsAt && await Bun.file(factsAt).exists() ? Bites(await Bun.file(factsAt).json()) : undefined;
  const r = score({ files, bites, reverts });
  const line = reasonLine(r);
  console.log(argv.includes("--json") ? JSON.stringify({ ...r, line }) : line);

  const pr = flag("--pr");
  if (pr !== undefined) {
    const repo = process.env.GITHUB_REPOSITORY ?? "";
    if (!/^\d+$/.test(pr) || !/^[\w.-]+\/[\w.-]+$/.test(repo)) { console.error("--pr <n> needs a number and GITHUB_REPOSITORY"); process.exit(2); }
    const other = LANES.find((l) => l !== r.lane)!;
    await Bun.$`gh label create ${`lane:${r.lane}`} --repo ${repo} --force --color ${r.lane === "fast" ? "0e8a16" : "c5def5"} --description ${`Release rings lane (scripts/lane.ts, #5429)`}`.quiet().nothrow();
    await Bun.$`gh api -X POST repos/${repo}/issues/${pr}/labels -f ${`labels[]=lane:${r.lane}`}`.quiet();
    await Bun.$`gh api -X DELETE ${`repos/${repo}/issues/${pr}/labels/lane:${other}`}`.quiet().nothrow();
    const body = `${MARKER}\n${line}`;
    const ids = (await Bun.$`gh api --paginate repos/${repo}/issues/${pr}/comments --jq ${`.[] | select(.body | startswith("${MARKER}")) | .id`}`.quiet().text()).split("\n").filter(Boolean);
    if (ids[0]) await Bun.$`gh api -X PATCH repos/${repo}/issues/comments/${ids[0]} -f body=${body}`.quiet();
    else await Bun.$`gh api -X POST repos/${repo}/issues/${pr}/comments -f body=${body}`.quiet();
    console.log(`#${pr} labelled lane:${r.lane}`);
  }
}
