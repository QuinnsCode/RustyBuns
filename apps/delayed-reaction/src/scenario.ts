// Jump to a state: a level, a tempo, a delay, a beat and a speed, from a URL (?level=5&beat=40&speed=2) or from
// an agent (window.delayedReaction.start, the dr_start tool). Pure: main.ts starts the run and the music from it.
import { int, num, obj, oneOf, opt, type Of } from "@rustybuns/util/guard";
import { STEMS } from "./audio.ts";
import { SETUP_NAMES, setupNamed, type Setup } from "./dub.ts";
import { createRun, LEVELS, makeChart, SPEED_CEILING, SPEED_FLOOR, type Chart, type Lane, type Run } from "./sim.ts";

export const Scenario = obj({
  level: int(1, LEVELS.length, 1),
  bpm: opt(num(60, 200)),
  delay: opt(int(1, 16)),       // beats between a call and its wall
  hint: opt(num(0, 1)),         // 0: no echo on the due beat
  beat: num(0, 512, 0),         // start this far into the song, walls before it already answered
  speed: num(SPEED_FLOOR, SPEED_CEILING, SPEED_FLOOR),
  lane: oneOf([0, 1, 2, 3] as const, 1),
  stem: opt(oneOf(STEMS)),      // hear only drums, bass, synth or the dub return
  setup: opt(oneOf(SETUP_NAMES)), // one of the arranged dub tracks (src/dub.ts): its tempo and length, unless bpm says otherwise
});
export type Scenario = Of<typeof Scenario>;

const NUM = ["level", "bpm", "delay", "hint", "beat", "speed", "lane"];

/** The scenario a query string asks for, or null when it asks for none. `?level=3` alone is a scenario. */
export function fromSearch(search: string): Scenario | null {
  const q = new URLSearchParams(search), o: Record<string, number> = {};
  for (const k of NUM) { const v = q.get(k); if (v !== null && v.trim() !== "" && Number.isFinite(Number(v))) o[k] = Number(v); }
  const stem = (STEMS as readonly string[]).includes(q.get("stem") ?? "") ? q.get("stem") : null;
  const setup = setupNamed(q.get("setup"))?.name ?? null;
  return Object.keys(o).length || stem || setup ? Scenario({ ...o, ...(stem ? { stem } : {}), ...(setup ? { setup } : {}) }) : null;
}

/** The link that lands in a scenario. */
export const toSearch = (s: Scenario) => `?${new URLSearchParams(Object.entries(s).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))}`;

/** The scenario's arranged track, or null when it plays the level's fixed loop. */
export const setupOf = (s: Scenario): Setup | null => setupNamed(s.setup);

/** The level's chart with the scenario's tempo, delay and hint (a setup's tempo, delay and length first), and no call whose
 *  wall would land after the song. */
export function chartOf(s: Scenario): Chart {
  const d = setupOf(s), over = { ...(d ? { bpm: d.bpm, delay: d.delay, bars: d.bars } : {}) };
  if (s.bpm) over.bpm = s.bpm;
  if (s.delay) over.delay = s.delay;
  const c = makeChart(s.level, undefined, over), end = c.bars * 4 - 1;
  return { ...c, hint: s.hint ?? c.hint, calls: c.calls.filter((k) => k.beat + c.delay + k.hold <= end) };
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
