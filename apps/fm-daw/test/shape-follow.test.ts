// Shape follows the automation (#4529): while a lane moves the master EQ, the worklet tells the page what plays,
// and the master's Shape draws its dots and curve there instead of where the EQ was saved.
import { test, expect } from "bun:test";
import { posted, processor, run, useWorklet } from "./worklet-kit.ts";
import { eqLane, flatEq, type EqBand, type EqDoc } from "../src/engine/eq.ts";
import { loadMsg } from "../src/ui/load.ts";
import { demoProject } from "../src/presets.ts";
import { loopBeats, punchLane } from "../src/project.ts";
import { playedOver } from "../src/ui/Shape.tsx";

useWorklet();

const bell = (b: Partial<EqBand> = {}): EqBand => ({ kind: "bell", f: 1000, g: 0, q: 1, slope: 12, on: true, ...b });
const doc = (...bs: (EqBand | null)[]): EqDoc => flatEq().map((_, i) => bs[i] ?? null);

test("a lane sweeping a bell's gain: the page hears each new EQ as it plays, the dot follows, and an edit puts it back as saved", async () => {
  const saved = doc(bell());
  const p0 = { ...demoProject(), eq: saved }, L = loopBeats(p0);
  // the gain ramps from -12 to +12 dB over the loop
  const lanes = punchLane([], eqLane(0, "g"), [[0, -12], [L, 12]]);
  const { p, say } = processor();
  say(loadMsg({ ...p0, eqAuto: lanes }));
  say({ t: "play", countIn: 0 });
  await run(p, 1);
  const played = () => posted.flatMap((m) => (m.t === "eqPlayed" ? [m.doc] : []));
  const gains = played().map((d) => d?.[0]?.g);
  // a few changes a second, never the same EQ twice in a row, and climbing with the lane
  expect(gains.length).toBeGreaterThan(5);
  expect(gains.every((g, i) => typeof g === "number" && (i === 0 || g > gains[i - 1]!))).toBe(true);
  expect(gains[0]).toBeLessThan(-6);
  // what Shape draws: the saved band, at the gain playing now
  const now = played().at(-1)!;
  const shown = playedOver(saved, now);
  expect(shown[0]).toEqual({ ...bell(), g: now[0]!.g });
  expect(shown.slice(1)).toEqual(saved.slice(1));

  // an edit (the lanes gone): the EQ plays as saved, and the page is told so once
  posted.length = 0;
  say({ t: "eq", bands: saved, lanes: [] });
  await run(p, 0.5);
  expect(played()).toEqual([null]);
  expect(playedOver(saved, null)).toBe(saved);
});

test("a played EQ from before an edit doesn't move a band that changed since", () => {
  const played = doc(bell({ g: 9 }), bell({ f: 200, g: -6 }));
  // band 1 was switched to a shelf and band 2 bypassed before the worklet caught up: both stay as saved
  const now = doc(bell({ kind: "highShelf" }), bell({ f: 200, on: false }));
  expect(playedOver(now, played)).toEqual(now);
});
