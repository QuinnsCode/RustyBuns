import { describe, expect, test } from "bun:test";
import { b64url } from "@rustybuns/util/bytes";
import { CEILING } from "../src/engine/params.ts";
import { clipCurve, dbGain, peerCeiling, PEER_DEFAULT, shaped } from "../src/studio/limiter.ts";
import { Band } from "../src/studio/band.ts";
import { FarSound } from "../src/studio/plugin-line.ts";
import { decodeServer } from "../src/project.ts";
import { demoProject } from "../src/presets.ts";
import { loadMsg } from "../src/ui/load.ts";
import { TAKE_RATE } from "../src/take.ts";
import { SR, processor, run, useWorklet } from "./worklet-kit.ts";

useWorklet();

const sine = (amp: number) => Array.from({ length: 4800 }, (_, i) => amp * Math.sin((2 * Math.PI * 440 * i) / 48000));
const peak = (xs: Iterable<number>) => { let m = 0; for (const x of xs) m = Math.max(m, Math.abs(x)); return m; };

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

  // Someone shouts into their guitar at full scale; this page hears them a loop late, so their slices play on the
  // audio thread. At "Quiet" (-12 dB) the shout comes out under -12; with no ceiling set it is far louder.
  test.each([[-12], [null]])("someone's slices heard a loop late keep to the listener's ceiling (%p)", async (db) => {
    const BPM = 120, START = 1000, PEER = 7, SLICE = 2400;
    const { p, say } = processor();
    const project = demoProject();
    say(loadMsg({ ...project, space: 0, bpm: BPM, bars: 2, tracks: project.tracks.map((t) => ({ ...t, notes: [], auto: [] })) }));
    say({ t: "master", gain: 1 });
    say({ t: "grid", ctx: 0, beat: START + 8 });
    say({ t: "peerCeiling", db });
    const band = new Band(() => ({ bpm: BPM, loopBeats: 8 }), () => 1e12);
    band.leading(true);
    const far = new FarSound(band, say);
    const tone = (k: number) => Int16Array.from({ length: SLICE }, (_, i) => Math.round(32767 * Math.sin((2 * Math.PI * 220 * (k * SLICE + i)) / TAKE_RATE)));
    const shout = Array.from({ length: 4 }, (_, k) => Band.slice(-1, START + (k * SLICE * BPM) / 60 / TAKE_RATE, tone(k), b64url));
    for (const e of [{ t: "guitar", track: -1 }, ...shout]) {
      const m = decodeServer({ t: "live", from: PEER, e });
      if (m?.t !== "live" || !far.heard(PEER, m.e)) throw new Error(`the live line turned ${e.t} away`);
    }
    const loud = peak((await run(p, 0.5)).subarray(0, SR * 0.2));
    if (db === null) expect(loud).toBeGreaterThan(dbGain(-6));
    else {
      expect(loud).toBeLessThanOrEqual(dbGain(db));
      expect(loud).toBeGreaterThan(dbGain(db) * 0.5);
    }
  });
});
