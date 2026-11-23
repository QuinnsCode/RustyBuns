// Q Keys, the sound wall's MIDI to CV and clock (WALL.md), as the room plays it: keys into Q Saw's V/Oct, a key held over
// another and let go, and its clock on the sesh's tempo, faster when the tempo is, slower when Div is turned down.
import { expect, setDefaultTimeout, test } from "bun:test";
import { Wall } from "../src/wall/wall.ts";

setDefaultTimeout(60_000);

const cable = (a: string, ja: string, b: string, jb: string) => ({ from: [a, ja] as [string, string], to: [b, jb] as [string, string] });

test("keys play Q Saw through Q Keys, and its clock runs on the sesh's tempo", () => {
  const wall = new Wall(48000);
  const patch = (div: number) => wall.set({
    modules: [{ id: "keys", kind: "keys", knobs: { div } }, { id: "vco", kind: "vco", knobs: {} }, { id: "out", kind: "out", knobs: {} }],
    cables: [cable("keys", "pitch", "vco", "voct"), cable("vco", "saw", "out", "in-l")],
    returns: [],
  });
  patch(0.5);
  wall.tempo(120, 0);
  const l = new Float32Array(128), r = new Float32Array(128);
  /** `seconds` of the wall: Q Keys' outputs at the end, and how many times its clock rose. */
  const play = (seconds: number) => {
    let last: Record<string, number> = wall.state().find((m) => m.id === "keys")?.outs ?? {}, rises = 0;
    for (let i = 0; i < seconds * 48000; i += 128) {
      wall.process(l, r, 128);
      const outs: Record<string, number> = wall.state().find((m) => m.id === "keys")?.outs ?? {};
      if (outs.clock > 5 && !(last.clock > 5)) rises++;
      last = outs;
    }
    return { outs: last, rises };
  };
  const read = (id: string) => wall.state().find((m) => m.id === id)?.read ?? {};

  // C3 is a volt (an octave over C2), so Q Saw an octave over its 0 V; a key held over it is two volts until let go.
  wall.note(48, 0.8);
  expect(play(0.05).outs).toMatchObject({ pitch: 1, gate: 10 });
  expect(read("vco").hz).toBeCloseTo(266.5, 0);
  wall.note(60, 1);
  const top = play(0.05).outs;
  expect(top).toMatchObject({ pitch: 2, gate: 10 });
  expect(top.vel).toBeCloseTo(8.19, 1);
  wall.note(60, 0);
  expect(play(0.05).outs).toMatchObject({ pitch: 1, gate: 10 });
  wall.note(48, 0);
  expect(play(0.05).outs).toMatchObject({ pitch: 1, gate: 0 });

  // Div in the middle is eighths: four a second at 120 bpm, eight at 240; turned down, quarters. Each starts between
  // clocks, so the first block isn't a rise.
  wall.tempo(120, 0.25);
  expect(play(1).rises).toBe(4);
  wall.tempo(240, 0.25);
  expect(play(1).rises).toBe(8);
  patch(0);
  wall.tempo(120, 0.75);
  expect(play(1).rises).toBe(2);
});
