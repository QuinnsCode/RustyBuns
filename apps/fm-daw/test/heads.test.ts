// Q Amp's heads are one kit with Sound Guy Simulator (#6023): Qollab Studio builds each head from its tscircuit boards,
// the game from the same boards written as parts (`@rustybuns/gear/circuit` heads.ts). Played the same riff, every head
// sounds the same both ways, so the guitarist's amp at the show is the Q Brit 3 you play in Q Amp.
import { expect, setDefaultTimeout, test } from "bun:test";
import { HEADS, headRig, runRig } from "@rustybuns/gear/circuit";
import { AMPS, buildRig } from "../src/circuit/amps.ts";
import { riff } from "../src/circuit/riff.ts";

setDefaultTimeout(60_000);

const SR = 48000;

test("every Q Amp head plays the same from its boards as from the shared parts", () => {
  expect(AMPS.map((a) => a.name)).toEqual(HEADS.map((h) => h.name));
  const input = riff(SR).subarray(0, SR / 5);
  for (const h of HEADS) {
    const knobs = { ...h.knobs, noise: 0 };
    const boards = runRig(buildRig(h, knobs), input, SR, 2).out, parts = runRig(headRig(h, knobs), input, SR, 2).out;
    let diff = 0, peak = 0;
    for (let i = 0; i < boards.length; i++) {
      diff = Math.max(diff, Math.abs(boards[i]! - parts[i]!));
      peak = Math.max(peak, Math.abs(boards[i]!));
    }
    expect(peak).toBeGreaterThan(0.01);
    expect(diff / peak).toBeLessThan(1e-3);
  }
});
