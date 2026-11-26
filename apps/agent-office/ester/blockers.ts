// One test red on PR after PR (a "blocker"), and what Mervin does about it: the PR that fixes it merges first, the PRs
// it holds wait instead of reading as failing, and once the fix lands they get main merged in so their checks rerun.
//
// A blocker is a `ci-blocker` issue (scripts/ci-report.ts files one, and so does Ester's spread watch). Its body carries
// the record as `<!-- blocker {"test":...,"prs":[...],"checks":[...]} -->` (`blockerMark`); an older ci-report issue
// without the mark is read from its test block and `PRs:` line. Mervin's board (apps/codesplitter/scripts/mervin-board.ts)
// orders and labels with it, the wall screens read his lines (screens/read.ts), and scripts/after.ts catches the held
// PRs up once the issue closes.
//
// No Bun, DOM or package imports: after.yml runs `bun scripts/after.ts` without an install, so the guard comes by path.

import { arr, check, int, opt, obj, str, type Of } from "../../../packages/util/src/guard.ts";

/** The label both filers put on a blocker issue. */
export const BLOCKER_LABEL = "ci-blocker";

/**
 * One blocker: the test (`file › name`), the open PRs it turned red, the checks it turns red (`test fm-daw`, lane
 * suffix left off; none known means any `test ...` check), the issue that tracks it and the PR that fixes it, once known.
 */
export const Blocker = obj({
  test: str(2000),
  prs: arr(int(1, 1e9), 500, { drop: true }),
  checks: opt(arr(str(200), 50, { drop: true })),
  issue: opt(int(1, 1e9)),
  fix: opt(int(1, 1e9)),
});
export type Blocker = Of<typeof Blocker>;

const MARK = /<!-- blocker (\{.*?\}) -->/s;

/** Text without its control characters (newlines and tabs stay), which in a terminal's paste would be keystrokes. */
export const noControls = (s: string) => s.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");

/** A test's name or log line made safe for an issue, a prompt or a terminal: no control characters, and it can't open an
 * HTML comment (a forged mark) or close a fence. */
export const inert = (s: string) => noControls(s).replaceAll("<!--", "<! --").replaceAll("-->", "-- >").replaceAll("```", "` ` `");

/** The record as a line for an issue body, read back by `blockerOf`. `<` and `>` are JSON escapes, so a name holding
 * `-->` neither ends the line early nor starts another. */
export const blockerMark = (b: Blocker) =>
  `<!-- blocker ${JSON.stringify({ test: b.test, prs: b.prs, ...(b.checks ? { checks: b.checks } : {}) }).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e")} -->`;

/** The blocker an issue describes (its number is the issue), or null when the body names none. */
export function blockerOf(issue: { number: number; body: string }): Blocker | null {
  const m = issue.body.match(MARK);
  if (m) {
    let v: unknown;
    try { v = JSON.parse(m[1]!); } catch { v = null; }
    const b = check(Blocker, v);
    if (b) return { ...b, issue: issue.number };
  }
  // ci-report's own body before the mark: the test in a fenced block, then `PRs: #1, #2`
  const test = issue.body.match(/```\n([^\n]+)\n```/)?.[1]?.trim(), prs = issue.body.match(/^PRs: (.*)$/m)?.[1];
  if (!test || !prs) return null;
  return { test, prs: [...prs.matchAll(/#(\d+)/g)].map((x) => Number(x[1])), issue: issue.number };
}

/** A PR as the board and after.ts see it: its number and the words a fix would carry. */
export interface PrText { number: number; title?: string; body?: string }

/**
 * The open PR that fixes a blocker: the one it names, else one whose title or body says `Fixes #<issue>` (or closes,
 * resolves), else one that names the issue at all. A PR the blocker holds isn't its fix, whatever it says.
 */
export function fixOf(b: Blocker, prs: PrText[]): number | undefined {
  if (b.fix) return b.fix;
  if (!b.issue) return undefined;
  const names = new RegExp(`#${b.issue}(?!\\d)`), closes = new RegExp(`\\b(?:fix|fixes|fixed|close|closes|closed|resolve|resolves|resolved)\\s+#${b.issue}(?!\\d)`, "i");
  const free = prs.filter((p) => !b.prs.includes(p.number));
  const said = (p: PrText) => `${p.title ?? ""}\n${p.body ?? ""}`;
  return (free.find((p) => closes.test(said(p))) ?? free.find((p) => names.test(said(p))))?.number;
}

/** The blockers with their fix filled in from the open PRs. */
export const withFixes = (bs: Blocker[], prs: PrText[]): Blocker[] => bs.map((b) => {
  const fix = fixOf(b, prs);
  return fix ? { ...b, fix } : b;
});

/** How many of the open PRs a blocker holds. */
export const holding = (b: Blocker, open: number[]) => b.prs.filter((n) => open.includes(n)).length;

/**
 * The merge order with each blocker's fix moved to the front, the one holding most PRs first; everything else keeps
 * its place. A fix ahead of the PRs it unblocks is the point: they can't go green until it lands.
 */
export function jumpLine<T extends { number: number }>(order: T[], bs: Blocker[]): T[] {
  const open = order.map((p) => p.number);
  const fixes = bs.filter((b) => b.fix && open.includes(b.fix)).sort((a, b) => holding(b, open) - holding(a, open)).map((b) => b.fix!);
  const front = [...new Set(fixes)].map((n) => order.find((p) => p.number === n)!);
  return [...front, ...order.filter((p) => !front.includes(p))];
}

/** Whether a failing check (`test fm-daw 2/3`) is one the blocker turns red. */
const covers = (b: Blocker, check: string) => {
  const suite = check.replace(/ \d+\/\d+$/, "");
  return b.checks?.length ? b.checks.includes(suite) : suite.startsWith("test ");
};

/**
 * Where a PR stands against the open blockers, from its failing checks. `held`: the blockers it is red on (it is in
 * their PRs and the check is theirs). `own`: failing checks no blocker explains. Red on held checks alone, it waits on
 * `on` (the fix, else the issue); with any check of its own it is failing, and both are shown.
 */
export function standing(pr: number, failing: string[], bs: Blocker[]): { held: Blocker[]; own: string[]; on?: number } {
  const mine = bs.filter((b) => b.prs.includes(pr));
  const own = failing.filter((c) => !mine.some((b) => covers(b, c)));
  const held = mine.filter((b) => failing.some((c) => covers(b, c)));
  const first = held[0];
  return { held, own, ...(first && !own.length ? { on: first.fix ?? first.issue } : {}) };
}

const ref = (b: Blocker) => (b.fix ? `#${b.fix}` : b.issue ? `#${b.issue}` : "a fix");

/**
 * Mervin's lines about blockers for one stage of his board, under its tally line: why a fix jumped the line, or that
 * a held PR waits rather than fails. screens/read.ts reads them back (`mervinBoard`).
 */
export function blockerLines(pr: number, failing: string[], bs: Blocker[], open: number[]): string[] {
  const out: string[] = [];
  for (const b of bs) if (b.fix === pr) out.push(`  jumps the line: fixes the red check holding ${holding(b, open)} PRs (${b.issue ? `#${b.issue} ` : ""}${b.test})`);
  const s = standing(pr, failing, bs);
  if (s.on) out.push(`  waiting on #${s.on}: red only on ${s.held.map((b) => b.test).join(", ")}; not its own failure`);
  else if (s.held.length) out.push(`  failing on its own (${s.own.join(", ")}), and also red on ${s.held.map((b) => `${b.test}, held by ${ref(b)}`).join("; ")}`);
  return out;
}
