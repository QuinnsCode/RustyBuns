// The open world's frame budget (#3664): the walk from scripts/walk-budget.ts, held to what the last round reached, so the
// next change can't spend it unseen. It needs Chrome on a real GPU (Metal on a Mac), so it runs only with MM_BUDGET=1:
//   cd apps/mythic-masters && MM_BUDGET=1 bun test test/budget.test.ts
// A round that wins frames lowers these numbers in its PR; one that has to spend some says why there.
import { expect, setDefaultTimeout, test } from "bun:test";
import { walkBudget, type Row } from "../scripts/walk-budget.ts";

setDefaultTimeout(600_000);

/** Per viewport: the worst each number may be. Frame times in ms (a 60 Hz frame is 16.7), load in seconds, heap in MB.
 * Desktop's p95 sits on the vsync edge after round 1 (16.8 one run, 33.3 the next) while the plants draw 4.3 M
 * triangles unculled: lower it to 17 with the plant culling (#3664 point 4). */
export const BUDGET: Record<Row["view"], { p95: number; over50: number; loadS: number; callsMax: number; heapGrowth: number }> = {
  desktop: { p95: 34, over50: 10, loadS: 3, callsMax: 260, heapGrowth: 60 },
  phone: { p95: 17, over50: 8, loadS: 3, callsMax: 120, heapGrowth: 60 },
};

test.skipIf(!process.env.MM_BUDGET)("a 90 s walk across a region border holds the frame budget at desktop and phone size", async () => {
  const rows = await walkBudget({ seconds: 90 });
  expect(rows.map((r) => r.view)).toEqual(["desktop", "phone"]);
  for (const r of rows) {
    const b = BUDGET[r.view];
    // the walk did what it says: the whole way, over the border
    expect(r.metres).toBeGreaterThan(1000);
    expect(r.regions.length).toBeGreaterThan(1);
    expect(r.noise).toEqual([]);
    expect({ view: r.view, p95: r.p95, over50: r.over50, loadS: r.loadS, callsMax: r.callsMax, heapGrowth: r.heapEnd - r.heapStart })
      .toEqual({ view: r.view, p95: Math.min(r.p95, b.p95), over50: Math.min(r.over50, b.over50), loadS: Math.min(r.loadS, b.loadS), callsMax: Math.min(r.callsMax, b.callsMax), heapGrowth: Math.min(r.heapEnd - r.heapStart, b.heapGrowth) });
  }
});
