// The open world's frame budget (#3664): the walk from scripts/walk-budget.ts, held to what the last round reached, so the
// next change can't spend it unseen. It needs Chrome on a real GPU (Metal on a Mac), so it runs only with MM_BUDGET=1:
//   cd apps/mythic-masters && MM_BUDGET=1 bun test test/budget.test.ts
// A round that wins frames lowers these numbers in its PR; one that has to spend some says why there.
import { expect, setDefaultTimeout, test } from "bun:test";
import { walkBudget, type Row } from "../scripts/walk-budget.ts";

setDefaultTimeout(1_200_000);
const r1 = (x: number) => +x.toFixed(1);

/** Per viewport: the worst each number may be. Frame times in ms (a 60 Hz frame is 16.7), load in seconds, heap in MB
 * after a collection (it grows about 4 MB over the walk, the new region coming in, on main as on this branch).
 * Main before #3664 had 15 (desktop) and 19 (phone) frames over 50 ms on this walk, the worst 83 and 100 ms; round 3
 * brought both to none, the worst 34 ms: the goal, held. p95 17 is a 60 Hz frame plus its jitter (16.8).
 * Run it on a quiet machine: another worker's Chrome on the same Mac moves the load time by seconds. */
export const BUDGET: Record<Row["view"], { p95: number; max: number; over50: number; loadS: number; callsMax: number; heapGrowth: number }> = {
  desktop: { p95: 17, max: 50, over50: 0, loadS: 3, callsMax: 160, heapGrowth: 10 },
  phone: { p95: 17, max: 50, over50: 0, loadS: 3, callsMax: 120, heapGrowth: 10 },
};

/** With a party of six (five friends, fifteen beasts more), per viewport: its own frame limits, and what it may add to the
 * same walk alone (draw calls at the busiest frame, heap after a collection). Before #3709's round 5 the party halved the
 * frame rate (p50 33 ms, 95 and 23 frames over 50 ms); a friend's line-up posing every other frame brought p50 back to a
 * 60 Hz frame. #3796 round 6 draws a friend's beasts merged, one mesh each (about 2 calls in place of 7), so the party adds
 * 51 calls (desktop, from 131) and 20 (phone, from 102) on the builder. Still to win (the goal in the issue: p95 under 16.7
 * and at most 12 calls more): desktop's p95 is 33 ms, and the friends' figures and humming ground. The heap: 12 to 15 MB of 60. */
export const PARTY: Record<Row["view"], { p95: number; max: number; over50: number; calls: number; heapMB: number }> = {
  desktop: { p95: 34, max: 50, over50: 0, calls: 55, heapMB: 60 },
  phone: { p95: 34, max: 51, over50: 1, calls: 30, heapMB: 60 },
};

test.skipIf(!process.env.MM_BUDGET)("a 90 s walk across a region border holds the frame budget at desktop and phone size, alone and with a party of six", async () => {
  const rows = await walkBudget({ seconds: 90, parties: [1, 6] });
  for (const r of rows) console.log(JSON.stringify(r));
  expect(rows.map((r) => `${r.view} ${r.party}`)).toEqual(["desktop 1", "desktop 6", "phone 1", "phone 6"]);
  for (const r of rows) {
    // a party's busiest frame may draw what the walk alone may, plus what the party may add
    const b = r.party === 1 ? BUDGET[r.view] : { ...BUDGET[r.view], ...PARTY[r.view], callsMax: BUDGET[r.view].callsMax + PARTY[r.view].calls, heapGrowth: Infinity };
    // the walk did what it says: the whole way, over the border
    expect(r.metres).toBeGreaterThan(1000);
    expect(r.regions.length).toBeGreaterThan(1);
    expect(r.noise).toEqual([]);
    expect({ view: r.view, p95: r.p95, max: r.max, over50: r.over50, loadS: r.loadS, callsMax: r.callsMax, heapGrowth: r.heapEnd - r.heapStart })
      .toEqual({ view: r.view, p95: Math.min(r.p95, b.p95), max: Math.min(r.max, b.max), over50: Math.min(r.over50, b.over50), loadS: Math.min(r.loadS, b.loadS), callsMax: Math.min(r.callsMax, b.callsMax), heapGrowth: Math.min(r.heapEnd - r.heapStart, b.heapGrowth) });
    if (r.party === 1) continue;
    // the party's cost over the same walk alone: draw calls at the busiest frame, and the heap after a collection at the end
    const solo = rows.find((x) => x.view === r.view && x.party === 1)!;
    const added = { view: r.view, calls: r.callsMax - solo.callsMax, heapMB: r1(r.heapEnd - solo.heapEnd) }, cap = PARTY[r.view];
    expect(added).toEqual({ view: r.view, calls: Math.min(added.calls, cap.calls), heapMB: Math.min(added.heapMB, cap.heapMB) });
  }
});
