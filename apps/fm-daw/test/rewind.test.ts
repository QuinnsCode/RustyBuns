// The wind-back ladder: a snapshot each minute, thinned so each rung (1 min to 1 day) always has one close behind it.
import { expect, test } from "bun:test";
import { MAX_SNAPS, MINUTE, RUNGS, pick, thin } from "../src/rewind.ts";

/** A sesh edited every minute for `n` minutes: the ages of the snapshots left, youngest first, and each rung's age. */
function jam(n: number) {
  let snaps: number[] = [], most = 0;
  for (let m = 0; m <= n; m++) { snaps = thin([...snaps, m], m); most = Math.max(most, snaps.length); }
  const rungs = RUNGS.map((r) => { const at = pick({ snaps, edited: n * MINUTE }, n * MINUTE, r); return typeof at === "number" ? n - at : at; });
  return { ages: snaps.map((at) => n - at).reverse(), rungs, most };
}

test.each([
  [3, [0, 1, 2, 3], [1, null, null, null, null, null, null]],
  [30, [0, 1, 2, 3, 4, 5, 6, 11, 16, 21, 30], [1, 5, 11, 21, 30, null, null]],
  [300, [0, 1, 2, 3, 4, 5, 6, 11, 16, 21, 31, 41, 61, 81, 121, 181, 241, 300], [1, 5, 11, 21, 61, 241, null]],
  [1500, [0, 1, 2, 3, 4, 5, 6, 11, 16, 21, 31, 41, 61, 81, 121, 181, 241, 301, 541, 781, 1021, 1261, 1500], [1, 5, 11, 21, 61, 241, 1500]],
  [4 * 1440, [0, 1, 2, 3, 4, 5, 6, 11, 16, 21, 31, 41, 61, 81, 121, 181, 241, 301, 481, 721, 961, 1201, 1441, 1681], [1, 5, 11, 21, 61, 241, 1441]],
] as const)("after %i minutes of edits the ladder keeps these snapshots", (n, ages, rungs) => {
  const got = jam(n);
  expect(got.ages).toEqual([...ages]);
  expect(got.rungs).toEqual([...rungs]);
  expect(got.most).toBeLessThanOrEqual(MAX_SNAPS);
});

test("a groove nobody touched since is the one playing now", () => {
  expect(pick({ snaps: [0, 1, 2], edited: 2.5 * MINUTE }, 30 * MINUTE, 20)).toBe("now");
  expect(pick({ snaps: [0, 1, 2], edited: 2.5 * MINUTE }, 3 * MINUTE, 1)).toBe(2);
});
