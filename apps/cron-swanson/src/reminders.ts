// What the page's commands and the CLI both ask: which alarm a name means, and which reminders are waiting to be
// ticked off or snoozed. No DOM, no Bun: the page and src/cli.ts import it.
import { Bad } from "@rustybuns/util/guard";
import type { Job, Run } from "./api.ts";

const DAY = 86_400_000;

/** The alarm `name` means: an exact name first, then the one name that holds the words. Says why when none or several do. */
export function findJob(jobs: Job[], name: string): Job {
  const q = name.trim().toLowerCase();
  const exact = jobs.filter((j) => j.name.toLowerCase() === q);
  const near = exact.length ? exact : jobs.filter((j) => j.name.toLowerCase().includes(q));
  if (near.length === 1) return near[0]!;
  throw new Bad(near.length ? `${near.length} alarms match "${q}": ${near.slice(0, 5).map((j) => j.name).join(", ")}` : `no alarm called "${q}"`);
}

/**
 * Reminders waiting on a person, newest first: each alarm's newest run, when it was a reminder from the last day
 * that nobody ticked off and isn't snoozed past `now`. `runs` is newest first, as /api/jobs sends them.
 */
export function waitingRuns(runs: Run[], now: number): Run[] {
  const newest = new Map<string, Run>();
  for (const r of runs) if (!newest.has(r.jobId)) newest.set(r.jobId, r);
  return [...newest.values()].filter((r) => r.status === "reminded" && r.doneAt === null && (r.snoozedUntil === null || r.snoozedUntil <= now) && r.firedAt > now - DAY);
}
