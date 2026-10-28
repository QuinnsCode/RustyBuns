// Jump to a state: a level, a tempo, a delay, a beat and a speed, from a URL (?level=5&beat=40&speed=2) or from
// an agent (window.delayedReaction.start, the dr_start tool). Pure: main.ts starts the run and the music from it.
import { int, num, obj, oneOf, opt, type Of } from "@rustybuns/util/guard";
import { createRun, LEVELS, makeChart, SPEED_CEILING, SPEED_FLOOR, type Chart, type Lane, type Run } from "./sim.ts";

export const Scenario = obj({
  level: int(1, LEVELS.length, 1),
  bpm: opt(num(60, 200)),
  delay: opt(int(1, 16)),       // beats between a call and its wall
  hint: opt(num(0, 1)),         // 0: no echo on the due beat
  beat: num(0, 512, 0),         // start this far into the song, walls before it already answered
  speed: num(SPEED_FLOOR, SPEED_CEILING, SPEED_FLOOR),
  lane: oneOf([0, 1, 2, 3] as const, 1),
});
export type Scenario = Of<typeof Scenario>;

const NUM = ["level", "bpm", "delay", "hint", "beat", "speed", "lane"];

/** The scenario a query string asks for, or null when it asks for none. `?level=3` alone is a scenario. */
export function fromSearch(search: string): Scenario | null {
  const q = new URLSearchParams(search), o: Record<string, number> = {};
  for (const k of NUM) { const v = q.get(k); if (v !== null && v.trim() !== "" && Number.isFinite(Number(v))) o[k] = Number(v); }
  return Object.keys(o).length ? Scenario(o) : null;
}

/** The link that lands in a scenario. */
export const toSearch = (s: Scenario) => `?${new URLSearchParams(Object.entries(s).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))}`;

/** The level's chart with the scenario's tempo, delay and hint, and no call whose wall would land after the song. */
export function chartOf(s: Scenario): Chart {
  const c = makeChart(s.level);
  const delay = s.delay ?? c.delay, end = c.bars * 4 - 1;
  return { ...c, bpm: s.bpm ?? c.bpm, delay, hint: s.hint ?? c.hint, calls: c.calls.filter((k) => k.beat + delay + k.hold <= end) };
}

/** A run standing at the scenario's beat: walls already due are answered, the runner is in its lane at its speed. */
export function runOf(s: Scenario): { run: Run; chart: Chart } {
  const chart = chartOf(s), run = createRun(chart);
  for (const c of chart.calls) {
    if (c.beat < s.beat) c.rung = true;
    if (c.due + c.hold <= s.beat) c.state = "hit";
  }
  run.beat = s.beat;
  run.speed = s.speed;
  run.lane = s.lane as Lane;
  run.step = { from: s.lane - 1.5, at: -Infinity };
  return { run, chart };
}
