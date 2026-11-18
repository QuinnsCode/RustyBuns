// Q Amp's 3D stage (src/amp/stage3d.ts) driven as the page drives it each frame,
// without a renderer: the tubes follow the amp, glow with their stage, the cones push
// with the output, and the lights follow the low mids and the highs.
import { expect, test } from "bun:test";
import { buildStage } from "../src/amp/stage3d.ts";
import { lightLevels } from "../src/amp/screens.ts";
import { AMPS } from "../src/circuit/amps.ts";

const quiet = { pre: [0, 0, 0, 0], power: 0, push: 0, lowMid: 0, high: 0 };

test("playing lights the tubes and the stage, switching amps brings its own tubes", () => {
  const lead = AMPS.find((a) => a.id === "lead") ?? AMPS[0];
  const stage = buildStage({ preTubes: lead.stages.length, powerTubes: lead.powerTubes, pedals: ["drive", "fuzz"] });
  stage.update(quiet);
  const still = stage.state();
  expect(still.tubes).toEqual({ pre: lead.stages.length, power: lead.powerTubes });
  expect(still.pedals).toEqual(["drive", "fuzz"]);

  // V1 swinging hard, the output loud, a low-mid chord.
  stage.update({ pre: [1, 0.2, 0, 0], power: 0.8, push: 0.9, lowMid: 0.9, high: 0.1 });
  const loud = stage.state();
  expect(loud.filaments[0]).toBeGreaterThan(loud.filaments[1]);
  expect(loud.filaments[1]).toBeGreaterThan(still.filaments[1]);
  expect(loud.filaments.at(-1)).toBeGreaterThan(still.filaments.at(-1) ?? 0); // a power tube
  expect(loud.push).toBeCloseTo(0.9);
  expect(loud.lights.warm).toBeGreaterThan(still.lights.warm * 3);
  expect(loud.lights.cool).toBeLessThan(loud.lights.warm);

  // Another amp: its own count of tubes, and the walls follow the screens' layout.
  for (const amp of AMPS) {
    stage.setAmp({ preTubes: amp.stages.length, powerTubes: amp.powerTubes, pedals: [] });
    expect(stage.state().filaments).toHaveLength(amp.stages.length + amp.powerTubes);
  }
  stage.setWalls([null, null]);
  expect(stage.state().walls).toBe(2);
  stage.setWalls([null]);
  expect(stage.state().walls).toBe(1);
  stage.dispose();
});

test("the lights read the low mids and the highs off the analyser", () => {
  const sr = 48000, bins = 1024, binHz = sr / 2 / bins;
  const frame = (hz: number) => {
    const db = new Float32Array(bins).fill(-120);
    db[Math.round(hz / binHz)] = -20;
    return lightLevels(db, sr);
  };
  const low = frame(400), high = frame(8000), mid = frame(1800);
  expect(low.lowMid).toBeCloseTo(1);
  expect(low.high).toBe(0);
  expect(high.high).toBeCloseTo(1);
  expect(high.lowMid).toBe(0);
  expect(mid).toEqual({ lowMid: 0, high: 0 });
});
