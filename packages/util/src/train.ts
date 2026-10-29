// A merge train: PRs merge one at a time, each on a CI run of its head as it sits on today's main.
//
// GitHub's auto-merge trusts the last green run, even when main moved since. Two PRs that pass alone can break
// together without a conflict (one deletes a name, the other still uses it), and auto-merge lands the second on
// its stale green, breaking main (2026-10-29). The train looks at the PR at the head of the line: behind main,
// it updates the branch and waits; green on a head that is 0 behind main, it merges that exact head
// (`--match-head-commit`); red, it checks main's tip. A check that also fails on main isn't the PR's: the train
// holds and tells one worker. Otherwise the PR comes out of the line and its worker hears which check failed.
//
// The office's "Merge when ready" joins this line instead of turning on `--auto` (apps/agent-office/train/), and
// Mervin's `mervin-merge.ts --go` feeds it his wave. Everything goes through `gh`, so a fake runner tests it.
import { arr, check, num, obj, oneOf, opt, str, type Of } from "./guard.ts";

export type Method = "squash" | "merge" | "rebase";
export type State = "waiting" | "updating" | "checking" | "main-red" | "merged" | "pulled";

/** One PR in the line. `why` says what it waits on, or why it came out. */
export interface Spot {
  pr: number;
  state: State;
  why?: string;
  /** The head the train last looked at. */
  head?: string;
  method: Method;
  deleteBranch: boolean;
  /** When `head` was first seen, so a head CI never reports on doesn't hold the line for ever. */
  since?: number;
}

/** The PR as the train needs it: open or not, its head, whether it conflicts, and its checks on that head. */
export interface PrNow {
  state: "OPEN" | "MERGED" | "CLOSED";
  head: string;
  base: string;
  conflicts: boolean;
  checks: { name: string; state: "pass" | "fail" | "pending" }[];
}

/** What the train asks GitHub (`ghTrain` is the real one). */
export interface TrainGh {
  pr(n: number): Promise<PrNow>;
  /** How many commits `head` is behind `base`, and base's tip. */
  behind(head: string, base: string): Promise<{ by: number; tip: string }>;
  /** The checks that failed on a commit. */
  failingOn(sha: string): Promise<string[]>;
  update(n: number): Promise<void>;
  merge(n: number, method: Method, head: string, deleteBranch: boolean): Promise<void>;
}

export interface TrainDeps {
  gh: TrainGh;
  /** Sends a PR's worker one message; false when the PR has none. */
  tell?: (pr: number, text: string) => boolean;
  /** A line for the log. */
  say?: (line: string) => void;
  /** A PR merged. */
  merged?: (pr: number) => void;
  now?: () => number;
  /** A head no check has reported on for this long counts as having no CI, and merges. */
  quietMs?: number;
}

/** How many merged PRs the line keeps showing. */
const SHOWN = 5;

export class Train {
  private spots: Spot[] = [];
  /** Main's tip already told about, so a red main is one message, not one per PR. */
  private toldRed?: string;
  private busy = false;

  constructor(private deps: TrainDeps) {}

  /** Puts a PR at the back of the line (or back in, after it came out). */
  join(pr: number, method: Method = "squash", deleteBranch = false) {
    const at = this.spots.find((s) => s.pr === pr);
    if (at && at.state !== "pulled" && at.state !== "merged") return at;
    this.spots = this.spots.filter((s) => s.pr !== pr);
    const s: Spot = { pr, state: "waiting", method, deleteBranch };
    this.spots.push(s);
    this.say(`#${pr} joins the line, ${this.ahead(pr)} ahead`);
    return s;
  }

  leave(pr: number) {
    this.spots = this.spots.filter((s) => s.pr !== pr);
  }

  /** The whole line: who's moving first, then who came out, then the last merges. */
  line(): readonly Spot[] {
    return this.spots;
  }

  spot(pr: number) {
    return this.spots.find((s) => s.pr === pr);
  }

  /** How many are in front of `pr`. */
  ahead(pr: number) {
    const moving = this.spots.filter(live);
    const i = moving.findIndex((s) => s.pr === pr);
    return i < 0 ? 0 : i;
  }

  /** True while something in the line can still move. */
  get moving() {
    return this.spots.some(live);
  }

  /** Looks at the head of the line once and moves it on if it can. */
  async step() {
    if (this.busy) return;
    this.busy = true;
    try {
      const s = this.spots.find(live);
      if (s) await this.look(s).catch((e: Error) => this.pull(s, `the train couldn't read it: ${e.message}`));
    } finally {
      this.busy = false;
    }
  }

  /** Steps every `every` ms until nothing moves. */
  async run(every = 15_000, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))) {
    while (this.moving) {
      await this.step();
      if (this.moving) await sleep(every);
    }
  }

  private async look(s: Spot) {
    const { gh } = this.deps;
    const p = await gh.pr(s.pr);
    if (p.state === "MERGED") return this.done(s, "merged elsewhere");
    if (p.state === "CLOSED") return this.pull(s, "closed");
    if (p.conflicts) return this.pull(s, "conflicts with main", `#${s.pr} conflicts with main, so the merge train took it out. ` +
      `Merge main into it (the rebuild-pr skill), push, and press Merge when ready again.`);
    const fresh = p.head !== s.head;
    if (fresh) Object.assign(s, { head: p.head, since: this.now() });
    const b = await gh.behind(p.head, p.base);
    if (b.by > 0) {
      // update-branch makes a new head; until it shows, the old one is still behind
      if (s.state === "updating" && !fresh) return;
      s.state = "updating";
      s.why = `${b.by} behind ${p.base}, updating`;
      this.say(`#${s.pr} is ${b.by} behind ${p.base}: updating it`);
      return gh.update(s.pr);
    }
    const failing = p.checks.filter((c) => c.state === "fail").map((c) => c.name);
    if (failing.length) {
      const onMain = new Set(await gh.failingOn(b.tip));
      if (failing.every((n) => onMain.has(n))) return this.mainRed(s, failing, b.tip, p.base);
      const mine = failing.filter((n) => !onMain.has(n));
      return this.pull(s, `${mine.join(", ")} failed on ${p.base}'s tip`, `#${s.pr} failed ${mine.join(", ")} on ${p.head.slice(0, 9)}, ` +
        `its head on ${p.base}'s tip ${b.tip.slice(0, 9)}, so the merge train took it out of the line. ${p.base} itself passes that check: ` +
        `something on ${p.base} since your last green run breaks with your change. Fix it, push, and press Merge when ready again.`);
    }
    const pending = p.checks.filter((c) => c.state === "pending").length;
    const quiet = !p.checks.length && this.now() - (s.since ?? 0) >= (this.deps.quietMs ?? 5 * 60_000);
    if (pending || (!p.checks.length && !quiet)) {
      s.state = "checking";
      s.why = pending ? `CI on ${p.head.slice(0, 9)}: ${pending} running` : `waiting for CI on ${p.head.slice(0, 9)}`;
      return;
    }
    this.say(`#${s.pr} green on ${p.base} ${b.tip.slice(0, 9)}: merging ${p.head.slice(0, 9)}`);
    await gh.merge(s.pr, s.method, p.head, s.deleteBranch);
    this.done(s, `merged on ${p.base} ${b.tip.slice(0, 9)}`);
  }

  private mainRed(s: Spot, failing: string[], tip: string, base: string) {
    s.state = "main-red";
    s.why = `${failing.join(", ")} fails on ${base} too; held until ${base} is fixed`;
    if (this.toldRed === tip) return;
    this.toldRed = tip;
    this.say(`${base} ${tip.slice(0, 9)} fails ${failing.join(", ")}: holding the line`);
    const text = `${base} is red at ${tip.slice(0, 9)}: ${failing.join(", ")} fails there, not only on #${s.pr}. ` +
      `The merge train is holding every PR until it passes. You're the one worker told: fix ${base} in its own PR ` +
      `(or say so if someone already is), and the line moves on by itself.`;
    // the first PR in the line whose worker can take it
    this.spots.filter(live).some((x) => this.deps.tell?.(x.pr, text));
  }

  private pull(s: Spot, why: string, message?: string) {
    Object.assign(s, { state: "pulled", why });
    this.say(`#${s.pr} out of the line: ${why}`);
    if (message) this.deps.tell?.(s.pr, message);
    this.tidy();
  }

  private done(s: Spot, why: string) {
    Object.assign(s, { state: "merged", why });
    this.deps.merged?.(s.pr);
    this.tidy();
  }

  /** Moving first, then out, then the last few merged. */
  private tidy() {
    const merged = this.spots.filter((s) => s.state === "merged").slice(-SHOWN);
    this.spots = [...this.spots.filter(live), ...this.spots.filter((s) => s.state === "pulled"), ...merged];
  }

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  private say(line: string) {
    this.deps.say?.(`merge train: ${line}`);
  }
}

const live = (s: Spot) => s.state !== "merged" && s.state !== "pulled";

// --- the real gh ---

const Rollup = arr(obj({
  name: opt(str(200)), context: opt(str(200)),
  status: opt(str(40)), conclusion: opt(str(40)), state: opt(str(40)),
}), 500, { drop: true });
const PrView = obj({
  state: oneOf(["OPEN", "MERGED", "CLOSED"]),
  headRefOid: str(64), baseRefName: str(255),
  mergeable: opt(str(40)),
  statusCheckRollup: opt(Rollup),
});
const Compare = obj({ behind_by: num(0, Infinity, 0), base_commit: obj({ sha: str(64) }) });
const Runs = obj({ check_runs: arr(obj({ name: str(200), conclusion: opt(str(40)) }), 1000, { drop: true }) });

const FAILED = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);

/** One check (a check run or a commit status) as pass, fail or pending. Skipped and neutral count as passed. */
export function checkOf(c: Of<typeof Rollup>[number]): PrNow["checks"][number] {
  const name = c.name ?? c.context ?? "check";
  const done = (c.conclusion ?? (c.state && c.state !== "PENDING" && c.state !== "EXPECTED" ? c.state : ""))?.toUpperCase();
  if (!done) return { name, state: "pending" };
  return { name, state: FAILED.has(done) ? "fail" : "pass" };
}

const parse = <T>(g: (v: unknown) => T, out: string, what: string): T => {
  const v = check(g, JSON.parse(out));
  if (v === null) throw new Error(`gh gave an unexpected ${what}`);
  return v;
};

/** The train's gh, through a runner that takes gh's arguments and resolves to its stdout. */
export function ghTrain(gh: (args: string[]) => Promise<string>, repo: string): TrainGh {
  return {
    async pr(n) {
      const p = parse(PrView, await gh(["pr", "view", String(n), "--repo", repo, "--json", "state,headRefOid,baseRefName,mergeable,statusCheckRollup"]), "PR");
      return {
        state: p.state, head: p.headRefOid, base: p.baseRefName, conflicts: p.mergeable === "CONFLICTING",
        checks: (p.statusCheckRollup ?? []).map(checkOf),
      };
    },
    async behind(head, base) {
      const c = parse(Compare, await gh(["api", `repos/${repo}/compare/${encodeURIComponent(base)}...${head}`]), "compare");
      return { by: c.behind_by, tip: c.base_commit.sha };
    },
    async failingOn(sha) {
      const r = parse(Runs, await gh(["api", `repos/${repo}/commits/${sha}/check-runs?per_page=100`]), "check runs");
      return r.check_runs.filter((c) => FAILED.has((c.conclusion ?? "").toUpperCase())).map((c) => c.name);
    },
    async update(n) {
      await gh(["pr", "update-branch", String(n), "--repo", repo]);
    },
    async merge(n, method, head, deleteBranch) {
      await gh(["pr", "merge", String(n), `--${method}`, "--repo", repo, "--match-head-commit", head, ...(deleteBranch ? ["--delete-branch"] : [])]);
    },
  };
}
