// The server half of the health bar, built into rb-checks.js: the tally (checks/tally.ts), plus each finished check's
// single tests, when CI reported them. scripts/ci-test-count.ts leaves a `tests` notice on the job's check run;
// the check-run id is the job id at the end of the check's detailsUrl, and its annotations are one `gh api` call.
// A job that ran out of time leaves a `hung` error instead, naming the test file it hung in.
// A check run belongs to one head SHA and doesn't change once finished, so each is asked about once and cached:
// the first list after a run finishes starts the call, and the next one (a few seconds to 90s later) has the count.
import { execFile } from "node:child_process";
import { tally as tallyOf, type Check, type CheckTests, type TestCount } from "./tally.ts";

const JOB = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/\d+\/job\/(\d+)/;

/** "12 pass, 1 fail, 2 skip" from the check run's annotations, or undefined if CI left none. */
export function countOf(annotations: { title?: string | null; message?: string | null }[]): TestCount | undefined {
  const a = annotations.find((x) => x.title === "tests");
  const m = a?.message?.match(/(\d+) pass, (\d+) fail, (\d+) skip/);
  return m ? { pass: Number(m[1]), fail: Number(m[2]), skip: Number(m[3]) } : undefined;
}

/** Where a job that ran out of time hung, from its `hung` annotation: the last test file to report, else the first
 *  that never did, else the setup before any file. undefined when it didn't hang. */
export function hungOf(annotations: { title?: string | null; message?: string | null }[]): string | undefined {
  const m = annotations.find((x) => x.title === "hung")?.message;
  if (m == null) return undefined;
  return m.match(/last to report: ([^;]+)/)?.[1]!.trim() ?? m.match(/never reported: ([^,;(]+)/)?.[1]!.trim() ?? "setup";
}

/** What a check run's annotations say about its tests, or undefined if nothing. */
export function testsOf(annotations: { title?: string | null; message?: string | null }[]): CheckTests | undefined {
  const count = countOf(annotations), hung = hungOf(annotations);
  return count || hung ? { ...(count && { count }), ...(hung && { hung }) } : undefined;
}

const gh = (path: string) => new Promise<string>((resolve, reject) =>
  execFile("gh", ["api", path], { timeout: 15_000, maxBuffer: 4 << 20 }, (err, out) => err ? reject(err) : resolve(out)));

export class TestCounts {
  private known = new Map<string, CheckTests | null>();
  private queue: [string, string][] = [];
  private busy = 0;

  constructor(private api: (path: string) => Promise<string> = gh, private max = 3000, private parallel = 4) {}

  /** A finished check's tests and where it hung, if they're known yet; asks GitHub in the background if not. */
  of = (c: Check): CheckTests | undefined => {
    const m = c.detailsUrl?.match(JOB);
    if (!m || String(c.conclusion ?? "").toUpperCase() === "SKIPPED") return undefined;
    const id = m[2]!;
    const n = this.known.get(id);
    if (n !== undefined) return n ?? undefined;
    this.known.set(id, null);
    this.queue.push([m[1]!, id]);
    this.pump();
    return undefined;
  };

  private pump() {
    while (this.busy < this.parallel && this.queue.length) {
      const [repo, id] = this.queue.shift()!;
      this.busy++;
      this.api(`repos/${repo}/check-runs/${id}/annotations`)
        .then((out) => { const n = testsOf(JSON.parse(out)); if (n) this.known.set(id, n); })
        // a failed call is asked again on a later list
        .catch(() => this.known.delete(id))
        .finally(() => { this.busy--; this.pump(); });
    }
    // oldest first: check runs of PRs long gone
    for (const id of this.known.keys()) { if (this.known.size <= this.max) break; this.known.delete(id); }
  }
}

const counts = new TestCounts();

export const tally = (rollup: Check[] | null | undefined) => tallyOf(rollup, counts.of);
