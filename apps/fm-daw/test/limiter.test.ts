import { describe, expect, test } from "bun:test";
import { CEILING } from "../src/engine/params.ts";
import { clipCurve, dbGain, peerCeiling, PEER_DEFAULT, shaped } from "../src/studio/limiter.ts";

const sine = (amp: number) => Array.from({ length: 4800 }, (_, i) => amp * Math.sin((2 * Math.PI * 440 * i) / 48000));
const peak = (xs: number[]) => Math.max(...xs.map(Math.abs));

describe("the jam room's limiters", () => {
  // a mic shouted into at full scale and then some (+12 dBFS), and the band's own loudest
  test.each([
    ["someone else's shout, at the default", dbGain(PEER_DEFAULT), 4],
    ["someone else's shout, at the quietest step", dbGain(-18), 4],
    ["the whole room, last before the speakers", CEILING, 4],
  ])("%s never passes its ceiling, and a quiet voice passes as it is", (_, ceiling, shout) => {
    const curve = clipCurve(ceiling);
    expect(peak(sine(shout).map((x) => shaped(curve, x)))).toBeLessThanOrEqual(ceiling);
    const quiet = sine(ceiling * 0.5);
    quiet.forEach((x) => expect(shaped(curve, x)).toBeCloseTo(x, 3));
  });

  test("the listener's setting: a kept step, else the default", () => {
    expect([peerCeiling("-12"), peerCeiling(null), peerCeiling("0"), peerCeiling("loud")]).toEqual([-12, PEER_DEFAULT, PEER_DEFAULT, PEER_DEFAULT]);
  });
});
