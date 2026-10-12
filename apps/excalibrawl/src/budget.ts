// The hard stop on spend. Workers AI has no spending cap of its own, so the arena counts
// today's Clef calls and says no past DAILY_CALLS; after that, fighters sit out until
// midnight UTC.

/** Today's count and whether one more fits. Pure, so tests drive it. */
export function take(count: { day: string; n: number }, today: string, cap: number): { day: string; n: number; ok: boolean } {
  const n = count.day === today ? count.n : 0;
  return n < cap ? { day: today, n: n + 1, ok: true } : { day: today, n, ok: false };
}
