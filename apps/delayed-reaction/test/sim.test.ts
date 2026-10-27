import { expect, test } from "bun:test";
import { advance, createRun, dueLanes, GOOD, knockback, LEVELS, LIVES, makeChart, press, runnerX, SPEED_CEILING, SPEED_FLOOR, type Call, type Judgement, type Run } from "../src/sim.ts";

// A player who walks the chart: for each wall, step into its door `offset` beats from the due beat
// (skipping the ones `skip` says to), then let the clock run on. Returns every judgement on the way.
function walk(run: Run, calls: Call[], offset: number, skip = (_i: number) => false) {
  const out: Judgement[] = [];
  for (const [i, c] of calls.entries()) {
    out.push(...advance(run, Math.max(run.beat, c.beat))); // the call rings; its due beat is fixed now
    out.push(...advance(run, Math.max(run.beat, c.due - 0.3)));
    if (!skip(i)) out.push(...press(run, c.lane, c.due + offset));
    if (run.over) break;
  }
  return out;
}

// One run through a level, the way a player does it: into each door just before its wall arrives,
// staying put through the long ones. Then the same chart with a runner who never moves.
test("moving to each door on its due beat wins every level; standing still loses", () => {
  for (let level = 1; level <= LEVELS.length; level++) {
    const chart = makeChart(level);
    expect(chart.calls.length).toBeGreaterThan(15);
    for (const c of chart.calls) expect(c.due - c.beat).toBe(chart.delay);
    expect(makeChart(level)).toEqual(chart); // the same song every retry
    // One runner, one place: nothing is due while a long door is still open.
    for (const h of chart.calls.filter((c) => c.hold))
      expect(chart.calls.some((c) => c.due > h.due && c.due < h.due + h.hold)).toBe(false);

    const run = createRun(chart);
    const seen = walk(run, chart.calls, -0.03);
    seen.push(...advance(run, chart.bars * 4));
    expect(seen.some((j) => j.kind === "miss" || (j.kind === "release" && j.grade === "dropped"))).toBe(false);
    expect(run.over).toBe("won");
    expect(run.hits).toBe(chart.calls.length);
    expect(run.perfects).toBe(chart.calls.length);
    expect(run.lives).toBe(LIVES);

    const still = createRun(makeChart(level));
    for (let b = 0; b <= chart.bars * 4 && !still.over; b += 0.05) advance(still, b);
    expect(still.over).toBe("lost");
    expect(still.lane).toBe(1);
    expect(still.hits).toBeGreaterThan(0); // the doors that happened to be in lane 1 let them through
  }
});

test("moving to a door a wall too early bounces you off the wall before it", () => {
  const chart = makeChart(1);
  const run = createRun(chart);
  const i = chart.calls.findIndex((c, i) => i > 0 && c.lane !== chart.calls[i - 1]!.lane && c.lane !== 1 && c.due - chart.calls[i - 1]!.due >= 1);
  const [before, door] = [chart.calls[i - 1]!, chart.calls[i]!];
  walk(run, chart.calls.slice(0, i - 1), -0.03);
  advance(run, before.due - 0.6);
  const lives = run.lives, from = run.lane;

  // Off to the next door while the wall before it is still coming: a free sidestep, eased over a moment.
  const t = before.due - 0.5;
  expect(press(run, door.lane, t)).toEqual([{ kind: "move", lane: door.lane }]);
  expect(runnerX(run, t)).toBeCloseTo(from - 1.5);
  expect(Math.abs(runnerX(run, t + 0.07) - (door.lane - 1.5))).toBeLessThan(Math.abs(from - door.lane));
  expect(runnerX(run, t + 0.2)).toBe(door.lane - 1.5);

  // The wall before arrives with its door somewhere else: bounced, a life gone, knocked back for a beat.
  const j = advance(run, before.due + GOOD + 0.01);
  expect(j).toEqual([{ kind: "miss", call: before }]);
  expect(run.lives).toBe(lives - 1);
  expect(knockback(run, before.due + GOOD + 0.02)).toBeGreaterThan(0.9);
  expect(knockback(run, before.due + GOOD + 1.1)).toBe(0);

  // Still standing in the right door when its own wall comes: through, a good.
  const k = advance(run, door.due);
  expect(k).toEqual([{ kind: "hit", call: door, grade: "good", offset: 0 }]);
});

test("a long door is stayed in until it ends; leaving early drops it", () => {
  const chart = makeChart(3);
  const run = createRun(chart);
  const i = chart.calls.findIndex((c) => c.hold);
  const hold = chart.calls[i]!;
  walk(run, chart.calls.slice(0, i + 1), -0.03);
  expect(hold.state).toBe("held");
  expect(run.hits).toBe(i); // not counted until it ends
  const lives = run.lives;
  const away = ((hold.lane + 2) % 4) as typeof hold.lane;
  const j = press(run, away, hold.due + hold.hold / 2);
  expect(j[0]).toEqual({ kind: "release", call: hold, grade: "dropped" });
  expect(hold.state).toBe("missed");
  expect(run.lives).toBe(lives - 1);
});

test("the pad to light is the lane whose door is in its window, and the echo hint fades out by level five", () => {
  const chart = makeChart(1);
  const run = createRun(chart);
  const first = chart.calls[0]!;
  expect(dueLanes(run, first.beat)).toEqual(new Set());
  expect(dueLanes(run, first.due - 0.1)).toEqual(new Set([first.lane]));
  expect(dueLanes(run, first.due + GOOD + 0.01).has(first.lane)).toBe(false);
  expect(LEVELS.map((l) => l.hint > 0)).toEqual([true, true, true, true, false, false]);
});

// Speed: every door taken on time boosts the run, every wall cuts it, and between them it drifts back
// to the floor. A clean player ends up flying; one who's late and skips walls never gets going.
test("a perfect run climbs to the speed ceiling, a sloppy one sits near the floor, and speed stays in bounds", () => {
  const play = (level: number, sloppy: boolean) => {
    const chart = makeChart(level);
    const run = createRun(chart);
    expect(run.speed).toBe(SPEED_FLOOR);
    const seen: number[] = [];
    for (const [i, c] of chart.calls.entries()) {
      walk(run, [c], sloppy ? GOOD - 0.02 : -0.03, () => sloppy && i % 2 === 0);
      seen.push(run.speed);
      if (run.over) break;
    }
    return seen;
  };
  for (let level = 1; level <= LEVELS.length; level++) {
    const clean = play(level, false), messy = play(level, true);
    for (const s of [...clean, ...messy]) { expect(s).toBeGreaterThanOrEqual(SPEED_FLOOR); expect(s).toBeLessThanOrEqual(SPEED_CEILING); }
    expect(Math.max(...clean)).toBe(SPEED_CEILING);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(messy)).toBeLessThan(SPEED_FLOOR + 0.3);
    expect(mean(clean)).toBeGreaterThan(mean(messy) + 0.5);
  }
});

// A boost pulls the next answer in: a call that rings while you're fast is due sooner, in half beats, and the
// pad light and the echo hint (both read the due beat) land on the new one. A call that rang slow keeps its beat.
test("a call that rings at speed is due sooner, on the half beat, and the lit pad follows it", () => {
  const chart = makeChart(3);
  const run = createRun(chart);
  const taps = chart.calls.filter((c) => !c.hold);
  const slow = taps[0]!;
  advance(run, slow.beat);
  expect(slow.due).toBe(slow.beat + chart.delay); // rang at the floor: no pull

  // A call well after the first wall has passed, rung at full speed.
  const fast = taps.find((c) => c.beat > slow.due + 2)!;
  advance(run, fast.beat - 0.01);
  run.speed = SPEED_CEILING;
  advance(run, fast.beat);
  const pull = fast.beat + chart.delay - fast.due;
  expect(pull).toBeGreaterThan(0);
  expect(pull * 2).toBe(Math.round(pull * 2));
  const nominal = fast.beat + chart.delay;
  expect(dueLanes(run, fast.due).has(fast.lane)).toBe(true);
  expect(dueLanes(run, nominal - 0.1).has(fast.lane)).toBe(false);

  // The wall arrives on the pulled-in beat: step into its door then and you're through.
  const lives = run.lives; // the walls skipped on the way here already cost theirs
  advance(run, fast.due - 0.3);
  const before = run.lives;
  press(run, fast.lane, fast.due);
  expect(lives).toBeGreaterThanOrEqual(before);
  expect(fast.state).toBe("hit");
  expect(run.lives).toBe(before);
});

test("a run that keeps boosting is harder: walls come sooner, never stacked or inside a long door", () => {
  for (let level = 1; level <= LEVELS.length; level++) {
    const chart = makeChart(level);
    const run = createRun(chart);
    walk(run, chart.calls, -0.03);
    advance(run, chart.bars * 4);
    expect(run.over).toBe("won"); // still answerable by someone who keeps up
    const pulled = chart.calls.filter((c) => c.due < c.beat + chart.delay);
    expect(pulled.length).toBeGreaterThan(chart.calls.length / 4);
    const sorted = [...chart.calls].sort((a, b) => a.due - b.due);
    for (const [i, c] of sorted.entries()) {
      expect(c.due).toBeGreaterThan(c.beat + 1);
      const prev = sorted[i - 1];
      if (prev) expect(c.due).toBeGreaterThanOrEqual(prev.due + prev.hold + 0.5);
    }
  }
});
