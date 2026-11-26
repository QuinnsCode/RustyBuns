// The CI loop (#5565): every 30 minutes the office puts each open `ci-hourly` issue (the hourly ring opens one when it
// goes red, desktop-hourly.yml) on the floor's task queue, so a worker reproduces it on the builder and opens a PR
// with "Fixes #N". An issue is left alone while an open PR names it, while it is assigned (a hire assigns its issue, so
// a worker or a person has it, and one the loop's own worker gave up on isn't handed out again every half hour), and
// while the queue already holds it or ran it for the loop (clear the queue's finished tasks to try one again). At most `CAP` of the loop's tasks wait or run at once.
// Only floors whose checkout has the hourly ring's workflow are looked at. AGENT_OFFICE_CI_LOOP=off turns it off.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { arr, check, int, obj, str } from "@rustybuns/util/guard";
import { every } from "./every.ts";

export const BY = "CI loop";
export const CAP = 2;

const text = (max: number) => str(max, { min: 0, dflt: "" });
const Issues = arr(obj({ number: int(1, 1e9), title: text(400), assignees: arr(obj({ login: text(100) }), 50, { drop: true }) }), 100, { drop: true });
export type Issue = { number: number; title: string; assignees: { login: string }[] };
const Prs = arr(obj({ title: text(400), body: text(200_000) }), 1000, { drop: true });

/** What the loop needs of a floor's queue (the office's TaskQueue). */
export interface LoopFloor {
  id: string;
  dir: string;
  queue: {
    state(): { tasks: { issue?: number; status: string; addedBy: string }[] };
    add(prompt: string, by: string, title?: string, issue?: number): string | undefined;
  };
}

/** The issues to queue now: unassigned, named by no open PR, not on the queue and never run by the loop, oldest first, up to the cap. */
export function picks(issues: Issue[], prTexts: string[], tasks: { issue?: number; status: string; addedBy: string }[], cap = CAP): Issue[] {
  const live = tasks.filter((t) => t.status !== "done");
  const room = cap - live.filter((t) => t.addedBy === BY).length;
  if (room <= 0) return [];
  const named = new Set(prTexts.flatMap((t) => [...t.matchAll(/#(\d+)\b/g)].map((m) => Number(m[1]))));
  // the queue keeps finished tasks until someone clears it: one of ours that ended without a fix isn't run again
  const had = (n: number) => live.some((t) => t.issue === n) || tasks.some((t) => t.issue === n && t.addedBy === BY);
  return issues
    .filter((i) => !i.assignees.length && !named.has(i.number) && !had(i.number))
    .sort((a, b) => a.number - b.number)
    .slice(0, room);
}

/** What the worker who takes one is told. */
export const baton = (i: Issue) => `Hourly CI issue #${i.number}: ${i.title}.
The hourly ring (desktop-hourly.yml) went red and opened it. Read AGENTS.md, then the issue with \`bun run issue ${i.number} --full\`: it links the failed run and names the suites.
Find the failing test (a red lane's files: \`bun scripts/ci-apps.ts lanes <app>\`), reproduce it with \`bun run builder run apps/<app> bun test <file>\`, and fix the cause in one small PR from main. Don't skip or loosen the test to make it pass.
The PR body says "Fixes #${i.number}". If it doesn't reproduce, is a flake or is already fixed on main, comment on #${i.number} with the evidence and stop. Report back with "N of M done", the PR link and every leftover's link.`;

type Gh = (dir: string, args: string[]) => Promise<string>;
const gh: Gh = (dir, args) => new Promise((resolve, reject) =>
  execFile("gh", args, { cwd: dir, timeout: 30_000, maxBuffer: 16 << 20 }, (err, out) => err ? reject(err) : resolve(out)));

const json = (s: string): unknown => { try { return JSON.parse(s); } catch { return null; } };

/** One look at one floor: queue what `picks` names. Returns the issue numbers it queued. */
export async function loopOnce(floor: LoopFloor, run: Gh = gh): Promise<number[]> {
  const issues = check(Issues, json(await run(floor.dir, ["issue", "list", "--label", "ci-hourly", "--state", "open", "--json", "number,title,assignees"]))) ?? [];
  if (!issues.length) return [];
  const prs = check(Prs, json(await run(floor.dir, ["pr", "list", "--state", "open", "--limit", "300", "--json", "title,body"]))) ?? [];
  const queued: number[] = [];
  for (const i of picks(issues, prs.flatMap((p) => [p.title, p.body]), floor.queue.state().tasks)) {
    const err = floor.queue.add(baton(i), BY, `Fix hourly CI #${i.number}`, i.number);
    if (err) console.warn(`[rb] ci loop: #${i.number}: ${err}`);
    else queued.push(i.number);
  }
  return queued;
}

/** Every `everyMs`, the loop over each floor that has the hourly ring; the office starts it once. */
export function startCiLoop(floors: () => Iterable<LoopFloor>, toast: (floor: LoopFloor, message: string) => void, everyMs = 30 * 60_000) {
  return every(everyMs, async () => {
    for (const f of floors()) {
      if (!existsSync(path.join(f.dir, ".github", "workflows", "desktop-hourly.yml"))) continue;
      try {
        for (const n of await loopOnce(f)) toast(f, `The ${BY} queued issue #${n}: the hourly CI run is red`);
      } catch (e) { console.warn("[rb] ci loop:", (e as Error).message); }
    }
  }, { name: "ci loop", first: 60_000 });
}
