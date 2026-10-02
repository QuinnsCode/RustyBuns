import { describe, expect, test } from "bun:test";
import { record, score, stars } from "../src/game/score.ts";

describe("score", () => {
  test("a quick clean find is near perfect", () => {
    expect(score({ seconds: 10, splats: 5, wrong: 0 })).toBe(920);
    expect(stars(920)).toBe(3);
  });
  test("never drops below the floor", () => {
    expect(score({ seconds: 600, splats: 400, wrong: 9 })).toBe(50);
    expect(stars(50)).toBe(1);
  });
  test("a wrong pick costs more than a dozen splats", () => {
    const base = { seconds: 20, splats: 10, wrong: 0 };
    expect(score({ ...base, wrong: 1 })).toBeLessThan(score({ ...base, splats: 22 }));
  });
});

describe("record", () => {
  test("tracks hunts, best score and fastest time per room", () => {
    const a = record({}, "0001", { seconds: 30, splats: 20, wrong: 1 });
    expect(a.newBest).toBe(true);
    const b = record(a.records, "0001", { seconds: 50, splats: 40, wrong: 2 });
    expect(b.newBest).toBe(false);
    expect(b.records["0001"]).toEqual({ hunts: 2, best: a.points, fastest: 30 });
    const c = record(b.records, "0001", { seconds: 8, splats: 2, wrong: 0 });
    expect(c.newBest).toBe(true);
    expect(c.records["0001"].fastest).toBe(8);
  });
});
