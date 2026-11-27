// The open-air rigs (systems.ts): what a crew has to bring for them.
import { expect, test } from "bun:test";
import { POLE_M, STAND_M, SYSTEMS, SYSTEM_IDS, ampChannels, stackSources, stackWidth, topsMount } from "../src/index.ts";

test("a rig takes an amp channel a way of every passive box; a powered box brings its own", () => {
  // the horn stack: bin, mid-bass, and a two-way mid-high horn, a stack
  expect(ampChannels(SYSTEMS["dance-stack"], 4)).toBe(16);
  // tri-amped tops over a single-way bass bin
  expect(ampChannels(SYSTEMS["tri-amp"], 2)).toBe(8);
  // every box of the line array is powered, its subs too: no amp rack at all
  expect(ampChannels(SYSTEMS["line-array"], 4)).toBe(0);
});

test("every rig's tops sound from where they sit: on the subs, up a pole, or on a stand beside the subs", () => {
  const at = [2, -3] as const, yaw = 0.5, side = [Math.cos(yaw), -Math.sin(yaw)] as const;
  for (const id of SYSTEM_IDS) {
    const rig = SYSTEMS[id], on = stackSources(rig, { at, yaw }), pole = stackSources(rig, { at, yaw, tops: "pole" }), stands = stackSources(rig, { at, yaw, tops: "stands", out: -1 });
    expect(on.length, id).toBeGreaterThan(0);
    expect(pole.map((s) => s.pos.y - POLE_M), id).toEqual(on.map((s) => expect.closeTo(s.pos.y, 6)));
    const { side: off } = topsMount(rig, { tops: "stands", out: -1 });
    expect(off, id).toBeLessThan(-(stackWidth(rig) / 2));
    for (const [i, s] of stands.entries()) {
      // out to the stack's -x by the mount's offset, at the stand's height or above
      expect(s.pos.x, id).toBeCloseTo(at[0] + side[0] * off, 6);
      expect(s.pos.z, id).toBeCloseTo(at[1] + side[1] * off, 6);
      expect(s.pos.y, id).toBeGreaterThan(STAND_M);
      expect(s.yaw, id).toBe(on[i]!.yaw);
    }
  }
});
