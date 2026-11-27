// Soundcheck at the guitar amp: walk up to it, dime the gain, and the show's guitar is the DI baked through it (what
// the page's worker runs): grittier than the same stem through the amp turned down, at the stem's own level, and
// looping without a click. Once the band is on, the amp is theirs.
import { expect, setDefaultTimeout, test } from "bun:test";
import { head } from "@rustybuns/gear/circuit";
import { SET_LIST, SHOW, atAmp, newDesk, newShow, setAmp, showState, startShow } from "../src/venues/show.ts";
import { newWorld, walkTo } from "../src/sim.ts";
import { BAKE_RATE, bakeGuitar } from "../src/audio/amp.ts";
import { stems } from "../src/audio/stems.ts";

setDefaultTimeout(30_000);

/** Sign changes a second: more of them is more upper harmonics (the amp's clipping, the treble). */
const crossings = (x: Float32Array) => {
  let c = 0;
  for (let i = 1; i < x.length; i++) if ((x[i - 1]! < 0) !== (x[i]! < 0)) c++;
  return (c / x.length) * BAKE_RATE;
};
const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

test("set the amp at soundcheck, and the guitar baked through it is grittier at the same level; after doors it's the band's", () => {
  const w = newWorld(SHOW), s = newShow();
  expect(setAmp(w, s, "gain", 4)).toEqual({ ok: false, why: "the guitar amp is out of reach" });
  walkTo(w, -1.8, 4.5);
  walkTo(w, -1.6, 1.6);
  expect(atAmp(w)).toBe(true);
  expect(setAmp(w, s, "gain", 4)).toEqual({ ok: true });
  expect(setAmp(w, s, "gain", 4)).toEqual({ ok: true });
  expect(showState(w, newDesk(), s).amp.gain).toBe(10);
  // The head on the stage is Qollab Studio's Q Brit 3, from the kit both games share.
  expect(showState(w, newDesk(), s).head).toBe(head("brit").name);

  const di = stems(BAKE_RATE, SET_LIST[1]!).guitar;
  const hot = bakeGuitar(di, BAKE_RATE, s.amp), low = bakeGuitar(di, BAKE_RATE, { ...s.amp, gain: 2 });
  expect(hot.length).toBe(di.length);
  expect(hot.every(Number.isFinite)).toBe(true);
  expect(crossings(hot)).toBeGreaterThan(1.3 * crossings(low));
  expect(rms(hot)).toBeCloseTo(rms(di), 3);
  // The seam: the loop's last sample into its first is no bigger a step than the loop takes anywhere else.
  let step = 0;
  for (let i = 1; i < hot.length; i++) step = Math.max(step, Math.abs(hot[i]! - hot[i - 1]!));
  expect(Math.abs(hot[0]! - hot[hot.length - 1]!)).toBeLessThan(step);

  expect(startShow(s)).toEqual({ ok: true });
  expect(setAmp(w, s, "gain", -4)).toEqual({ ok: false, why: "the band is playing: set the amp at soundcheck" });
});
