import { expect, test } from "bun:test";
import { advance, createRun, dueLanes, GOOD, inFlight, LEVELS, LIVES, makeChart, PERFECT, press, release } from "../src/sim.ts";

// One run through a level, the way a player does it: every call answered on its due beat, holds
// let go when they end. Then the same chart ignored: every call missed until the lives run out.
test("answering every call `delay` beats after it is called wins the level; ignoring them loses it", () => {
  for (let level = 1; level <= LEVELS.length; level++) {
    const chart = makeChart(level);
    expect(chart.calls.length).toBeGreaterThan(15);
    for (const c of chart.calls) expect(c.due - c.beat).toBe(chart.delay);
    expect(makeChart(level)).toEqual(chart); // the same song every retry

    const run = createRun(chart);
    const events = chart.calls.flatMap((c) => c.hold ? [{ at: c.due, c, down: true }, { at: c.due + c.hold, c, down: false }] : [{ at: c.due, c, down: true }]);
    events.sort((a, b) => a.at - b.at);
    for (const e of events) {
      advance(run, e.at - 0.01);
      const j = e.down ? press(run, e.c.lane, e.at + 0.03) : release(run, e.c.lane, e.at - 0.03);
      expect(j && j.kind !== "early" && j.kind !== "miss").toBe(true);
    }
    advance(run, chart.bars * 4);
    expect(run.over).toBe("won");
    expect(run.misses).toBe(0);
    expect(run.hits).toBe(chart.calls.length);
    expect(run.perfects).toBe(chart.calls.length);
    expect(run.lives).toBe(LIVES);

    const idle = createRun(makeChart(level));
    advance(idle, chart.bars * 4);
    expect(idle.over).toBe("lost");
    expect(idle.misses).toBe(LIVES);
    expect(idle.lives).toBe(0);
  }
});

test("a press is judged against its due beat, not the beat it was called on", () => {
  const chart = makeChart(1);
  const run = createRun(chart);
  const first = chart.calls[0]!;
  // On the call itself: nothing is due yet, so it's an early press that breaks the combo and costs 20.
  run.score = 100; run.combo = 3;
  expect(press(run, first.lane, first.beat)).toEqual({ kind: "early", lane: first.lane });
  expect(run.score).toBe(80);
  expect(run.combo).toBe(0);
  expect(first.state).toBe("pending");
  // A beat late is good, not perfect, and the sim says which way it was off.
  const j = press(run, first.lane, first.due + (PERFECT + GOOD) / 2);
  expect(j.kind).toBe("hit");
  if (j.kind === "hit") { expect(j.grade).toBe("good"); expect(j.offset).toBeGreaterThan(0); }
  expect(first.state).toBe("hit");
  // The queue: everything called and not yet answered.
  const mid = chart.calls[Math.floor(chart.calls.length / 2)]!;
  const q = inFlight(run, mid.beat + 0.1);
  expect(q.length).toBeGreaterThan(0);
  for (const c of q) expect(c.beat <= mid.beat + 0.1 && c.state === "pending").toBe(true);
});

test("a hold pressed on time but let go early is dropped", () => {
  const chart = makeChart(3);
  const run = createRun(chart);
  const hold = chart.calls.find((c) => c.hold)!;
  expect(press(run, hold.lane, hold.due).kind).toBe("hit");
  expect(hold.state).toBe("held");
  expect(run.hits).toBe(0); // not counted until it ends
  const j = release(run, hold.lane, hold.due + hold.hold / 2);
  expect(j).toEqual({ kind: "release", call: hold, grade: "dropped" });
  expect(hold.state).toBe("missed");
  expect(run.lives).toBe(LIVES - 1);
});

test("the pad to light is the lane whose key is in its window, and the echo hint fades out by level five", () => {
  const chart = makeChart(1);
  const run = createRun(chart);
  const first = chart.calls[0]!;
  expect(dueLanes(run, first.beat)).toEqual(new Set());
  expect(dueLanes(run, first.due)).toEqual(new Set([first.lane]));
  expect(dueLanes(run, first.due + GOOD + 0.01).has(first.lane)).toBe(false);
  expect(LEVELS.map((l) => l.hint > 0)).toEqual([true, true, true, true, false, false]);
});
