// The 3D rooms' graphics settings (#6475): what a browser keeps, and music first's step-down rule.
import { describe, expect, test } from "bun:test";
import { audioStress, calm, govern, pickGraphics, PRESET, preset, qualityOf, STEPS, stepped, tweak, type Govern } from "../src/studio/graphics.ts";

describe("what a browser keeps", () => {
  test("?quality= first, then the kept knobs or an old low/high, else high unless a phone", () => {
    const mine = JSON.stringify(tweak(preset("medium", "picture"), { cap: 30 }));
    const cases: [string, string | null, boolean, string, string][] = [
      ["", null, false, "high", "music"],
      ["", null, true, "low", "music"],
      ["", "low", false, "low", "music"], // a visit before the settings
      ["?quality=ultra", null, true, "ultra", "music"],
      ["", mine, false, "custom", "picture"],
      ["?quality=high", mine, false, "high", "picture"], // the link picks the look, the browser keeps its priority
      ["", "{broken", true, "low", "music"],
      ["", JSON.stringify({ ...PRESET.high, scale: 9 }), false, "high", "music"], // out of range: not kept
    ];
    for (const [search, stored, phone, want, prio] of cases) {
      const g = pickGraphics(search, stored, phone);
      expect([search, stored, g.preset, g.priority]).toEqual([search, stored, want, prio]);
    }
  });
  test("a knob back where the preset has it names the preset again; low builds plain, the rest the full look", () => {
    expect(tweak(PRESET.high, { cap: 60 }).preset).toBe("custom");
    expect(tweak(tweak(PRESET.high, { cap: 60 }), { cap: 0 }).preset).toBe("high");
    expect([qualityOf(PRESET.low), qualityOf(PRESET.medium), qualityOf(PRESET.high)]).toEqual(["low", "high", "high"]);
  });
});

describe("music first: the step-down rule", () => {
  // a run of samples every half second: [frame ms, audio stress] -> the level after each
  const run = (samples: [number, number][], prio: "music" | "picture" = "music") => {
    let g: Govern = calm(0);
    return samples.map(([frameMs, audio], i) => (g = govern(g, { now: (i + 1) * 500, frameMs, audio }, prio)).level);
  };
  const slow = [60, 0] as [number, number], starving = [12, 1] as [number, number], fine = [10, 0] as [number, number], meh = [30, 0.2] as [number, number];
  test.each([
    ["slow frames step down once, then hold before the next", [slow, slow, slow, slow, slow, slow, slow], [1, 1, 1, 1, 1, 1, 2]],
    ["the audio falling behind steps down even when frames are quick", [starving, starving], [1, 1]],
    ["it never steps past the last level", Array(40).fill(slow), null],
    ["headroom has to last before a step back up", [slow, ...Array(12).fill(fine)], [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0]],
    ["in between neither steps down nor counts as headroom", [slow, ...Array(14).fill(meh)], Array(15).fill(1)],
    ["a busy frame resets the calm", [slow, ...Array(8).fill(fine), meh, ...Array(4).fill(fine)], [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]],
  ] as const)("%s", (_, samples, want) => {
    const got = run([...samples]);
    if (want) expect(got).toEqual([...want]);
    else expect(Math.max(...got)).toBe(STEPS);
  });
  test("picture first never steps down", () => {
    expect(run(Array(20).fill(slow), "picture").every((l) => l === 0)).toBe(true);
  });
  test("each level: the render scale first, then shadows held still, then 30 fps", () => {
    expect([0, 1, 2, 3].map((l) => stepped(PRESET.high, l))).toEqual([
      { scale: 1.5, freezeShadows: false, cap: 0 },
      { scale: 1.125, freezeShadows: false, cap: 0 },
      { scale: 0.75, freezeShadows: true, cap: 0 },
      { scale: 0.75, freezeShadows: true, cap: 30 },
    ]);
    expect(stepped(PRESET.low, 2)).toEqual({ scale: 0.5, freezeShadows: false, cap: 60 }); // nothing cast to freeze
  });
  test("the audio clock: on time is safe, a few percent behind or an underrun is trouble", () => {
    expect(audioStress(500, 500, 0)).toBe(0);
    expect(audioStress(500, 480, 0)).toBeGreaterThanOrEqual(0.5);
    expect(audioStress(500, 500, 1)).toBe(1);
    expect(audioStress(100, 0, 0)).toBe(0); // too short a window to say
  });
});
