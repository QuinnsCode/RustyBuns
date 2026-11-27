// A PR body's `Merge after #N` line, read by scripts/after.ts and the guard hook (.claude/hooks/guard.ts). It imports
// nothing, so the hooks CI job, which installs no packages, can load the guard without after.ts's Effect.

export const LINE = /^merge after (#\d+(?:(?:,\s*|\s+and\s+|\s+)#\d+)*)/im;

/** The PRs a body says to merge after, from its `Merge after #N` line (none without one). */
export function blockers(body: string): number[] {
  const m = body.match(LINE);
  return m ? [...m[1]!.matchAll(/#(\d+)/g)].map((x) => Number(x[1])) : [];
}
