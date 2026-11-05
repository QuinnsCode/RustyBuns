// The open world's frame budget (#3664): the walk from scripts/walk-budget.ts, held to what the last round reached, so the
// next change can't spend it unseen. It needs Chrome on a real GPU (Metal on a Mac), so it runs only with MM_BUDGET=1:
//   cd apps/mythic-masters && MM_BUDGET=1 bun test test/budget.test.ts
// A round that wins frames lowers these numbers in its PR; one that has to spend some says why there.
import { expect, setDefaultTimeout, test } from "bun:test";
import { walkBudget, type Row } from "../scripts/walk-budget.ts";

setDefaultTimeout(600_000);

/** Per viewport: the worst each number may be. Frame times in ms (a 60 Hz frame is 16.7), load in seconds, heap in MB
 * after a collection (it grows about 4 MB over the walk, the new region coming in, on main as on this branch).
 * Main before #3664 had 15 (desktop) and 19 (phone) frames over 50 ms on this walk, the worst 83 and 100 ms; round 3
 * brought both to none, the worst 34 ms: the goal, held. p95 17 is a 60 Hz frame plus its jitter (16.8).
 * Run it on a quiet machine: another worker's Chrome on the same Mac moves the load time by seconds. */
export const BUDGET: Record<Row["view"], { p95: number; max: number; over50: number; loadS: number; callsMax: number; heapGrowth: number }> = {
  desktop: { p95: 17, max: 50, over50: 0, loadS: 3, callsMax: 160, heapGrowth: 10 },
  phone: { p95: 17, max: 50, over50: 0, loadS: 3, callsMax: 120, heapGrowth: 10 },
};

test.skipIf(!process.env.MM_BUDGET)("a 90 s walk across a region border holds the frame budget at desktop and phone size", async () => {
  const rows = await walkBudget({ seconds: 90 });
  for (const r of rows) console.log(JSON.stringify(r));
  expect(rows.map((r) => r.view)).toEqual(["desktop", "phone"]);
  for (const r of rows) {
    const b = BUDGET[r.view];
    // the walk did what it says: the whole way, over the border
    expect(r.metres).toBeGreaterThan(1000);
    expect(r.regions.length).toBeGreaterThan(1);
    expect(r.noise).toEqual([]);
    expect({ view: r.view, p95: r.p95, max: r.max, over50: r.over50, loadS: r.loadS, callsMax: r.callsMax, heapGrowth: r.heapEnd - r.heapStart })
      .toEqual({ view: r.view, p95: Math.min(r.p95, b.p95), max: Math.min(r.max, b.max), over50: Math.min(r.over50, b.over50), loadS: Math.min(r.loadS, b.loadS), callsMax: Math.min(r.callsMax, b.callsMax), heapGrowth: Math.min(r.heapEnd - r.heapStart, b.heapGrowth) });
  }
});
