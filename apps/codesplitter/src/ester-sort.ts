// Ester's sort of one red check, the rule both sides of her share: `scripts/ester.ts` asks it about the merged tree's
// failures on Mervin's sandbox board (GitHub PRs, ids are PR numbers), and `ester-checks.ts` asks it about a
// codeSplitter branch's own check runs (ids are branch names). Each side gathers the facts its own way; the order the
// facts are weighed in lives here once. Imports nothing.
//
//   main     fails on main too: not the change's, ignore it.
//   flaky    passed on a rerun, or a person said this check is flaky (her memory): note it, don't hold for it.
//   wait     main's own run of it hasn't finished, or a suspect's CI hasn't: hold, rerun when it has.
//   own      a suspect's own CI is already red: that change fixes its own CI first.
//   slow     every suspect waits only on checks that always take long: merge on the fast ones, the slow one is owed.
//   blocks   only the changes together break it: the suspects are held back.

export type Owner = "main" | "flaky" | "own" | "wait" | "slow" | "blocks";
export interface Verdict<Id = number> { test: string; owner: Owner; prs: Id[]; why: string }

export interface Facts<Id = number> {
  /** It fails on main too. */
  onMain: boolean;
  /** Main's own run of it hasn't finished, so whether main fails it too isn't known yet. */
  mainRunning?: boolean;
  /** It passed when run again (left out: no rerun to go by). */
  passedOnRerun?: boolean;
  /** A person ruled this check flaky, in words ("you said so on 2026-11-09"). */
  saidFlaky?: string;
  /** The suspects: the changes that could have broken it. */
  suspects: Id[];
  /** Suspects whose own CI is already red, and what's failing there. */
  red: Id[]; redWhy?: string;
  /** Suspects whose CI is still going, and those of them waiting only on slow checks. */
  pending: Id[]; slowOnly?: Id[];
}

/** One red check, sorted. */
export function sortRed<Id>(test: string, f: Facts<Id>): Verdict<Id> {
  if (f.onMain) return { test, owner: "main", prs: [], why: "fails on main too" };
  if (f.passedOnRerun) return { test, owner: "flaky", prs: [], why: "passed on a rerun" };
  if (f.saidFlaky) return { test, owner: "flaky", prs: [], why: f.saidFlaky };
  if (f.mainRunning) return { test, owner: "wait", prs: [], why: "main's own run of it hasn't finished: rerun when it has" };
  if (f.red.length) return { test, owner: "own", prs: f.red, why: `CI is already red (${f.redWhy || "failing"})` };
  const slow = new Set(f.slowOnly ?? []);
  const pending = f.pending.filter((p) => !slow.has(p));
  if (!pending.length && f.pending.length) return { test, owner: "slow", prs: f.pending, why: "CI is only waiting on slow checks: merge on the fast ones, the slow one is owed" };
  if (pending.length) return { test, owner: "wait", prs: pending, why: "CI hasn't finished: hold it, rerun when it has" };
  return { test, owner: "blocks", prs: f.suspects, why: f.suspects.length ? "only the changes together break it" : "nothing touched it: check the install or lockfile" };
}
