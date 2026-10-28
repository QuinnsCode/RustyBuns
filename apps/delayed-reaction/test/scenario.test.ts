import { expect, test } from "bun:test";
import { fromSearch, runOf, toSearch } from "../src/scenario.ts";
import { advance, press } from "../src/sim.ts";

// The link a MANUAL RUN gives the owner: it lands mid-song, at speed, with the answered walls already behind.
test("a link lands in its state, and the rest of the song plays to a win", () => {
  const s = fromSearch("?level=5&beat=40&speed=2&delay=6&hint=0&lane=3")!;
  expect(toSearch(s)).toContain("level=5");
  const { run, chart } = runOf(s);
  expect([run.chart.level, run.beat, run.speed, run.lane, chart.delay, chart.hint]).toEqual([5, 40, 2, 3, 6, 0]);
  const behind = chart.calls.filter((c) => c.due + c.hold <= 40);
  expect(behind.length).toBeGreaterThan(0);
  expect(behind.every((c) => c.state === "hit")).toBe(true);
  for (const c of chart.calls.filter((k) => k.state === "pending")) {
    advance(run, Math.max(run.beat, c.beat));
    press(run, c.lane, Math.max(run.beat, c.due - 0.03));
  }
  advance(run, chart.bars * 4);
  expect(run.over).toBe("won");
});

test("no params is no scenario; nonsense is clamped", () => {
  expect(fromSearch("")).toBeNull();
  expect(fromSearch("?foo=1&level=abc")).toBeNull();
  const s = fromSearch("?level=99&beat=-5&speed=9")!;
  expect([s.level, s.beat, s.speed]).toEqual([6, 0, 2.5]);
});
