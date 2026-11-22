// A web effect in a track's Insert (#5551): what comes back from it is panned by the track's PAN and sent to Space
// by its SEND, live (the worklet's fifth input) and in a bounce (renderProject's second pass, after the tap).
import { expect, setDefaultTimeout, test } from "bun:test";
import { BLOCK, SR, processor, useWorklet } from "./worklet-kit.ts";
import { loadMsg } from "../src/ui/load.ts";
import { demoProject } from "../src/presets.ts";
import { apply, type Project } from "../src/project.ts";
import { P, TRACKS } from "../src/engine/params.ts";
import { bounceFrames, renderProject, type BounceInserts } from "../src/engine/offline.ts";
import { TsEngine } from "../src/engine/engine.ts";
import { bounceInserts } from "../src/ui/plugins.ts";

setDefaultTimeout(60_000);
useWorklet();

const GAIN = { path: "builtin:gain", index: 0, name: "Gain (web)", web: true, values: [] };

/** Track `t` alone with a web effect in its Insert, at `pan` and `send`, holding a note for `beats`; no Squash. */
function alone(t: number, pan: number, send: number, space = 0, beats = 4): Project {
  const p = apply(demoProject(), { t: "insert", track: t, insert: GAIN });
  return { ...p, space, squash: 0, eqLinear: false, tracks: p.tracks.map((tr, i) => ({ ...tr, solo: i === t, mute: false, auto: [], ...(i === t ? { amp: undefined, notes: [{ s: 0, l: beats, m: 60, v: 1 }], params: tr.params.map((v, j) => (j === P.PAN ? pan : j === P.SEND ? send : v)) } : {}) })) };
}
const rms = (pcm: Float32Array, side: number, from: number, to: number) => { let e = 0; for (let f = from; f < to; f++) e += pcm[2 * f + side] ** 2; return Math.sqrt(e / (to - from)); };

/** The live desk: `seconds` with track `t`'s return steady at `v` on its two channels of the fifth input, then silent. */
function live(p: Project, t: number, seconds: number, v: number, quietAfter: number) {
  const { p: proc, say } = processor();
  say(loadMsg(p));
  say({ t: "master", gain: 1 });
  say({ t: "insert", track: t, on: true });
  const blocks = Math.round((seconds * SR) / BLOCK), out = new Float32Array(2 * blocks * BLOCK);
  for (let b = 0; b < blocks; b++) {
    const on = b * BLOCK < quietAfter * SR, back = Array.from({ length: 2 * TRACKS }, (_, c) => new Float32Array(BLOCK).fill(on && (c >> 1) === t ? v : 0));
    const L = new Float32Array(BLOCK), R = new Float32Array(BLOCK), fx = Array.from({ length: TRACKS }, () => new Float32Array(BLOCK));
    proc.process([[new Float32Array(BLOCK)], [], [], [], back], [[L, R], fx]);
    for (let f = 0; f < BLOCK; f++) { out[2 * (b * BLOCK + f)] = L[f]; out[2 * (b * BLOCK + f) + 1] = R[f]; }
  }
  return out;
}

test("live, an effect's return comes in down the track's PAN, and its SEND feeds Space", () => {
  const T = 3, centre = live(alone(T, 0, 0), T, 0.5, 0.2, 1), left = live(alone(T, -1, 0), T, 0.5, 0.2, 1);
  const n = centre.length >> 1, from = n >> 1;
  expect(rms(centre, 0, from, n)).toBeCloseTo(0.2, 2);                    // at centre it comes back as it went
  expect(rms(centre, 1, from, n)).toBeCloseTo(0.2, 2);
  expect(rms(left, 1, from, n)).toBeLessThan(0.002);                      // panned hard left: nothing on the right
  expect(rms(left, 0, from, n)).toBeGreaterThan(0.25);
  // the return stops at 0.25 s: with no SEND that's the end of it, with one Space rings on
  const dry = live(alone(T, 0, 0, 1), T, 1, 0.2, 0.25), sent = live(alone(T, 0, 1, 1), T, 1, 0.2, 0.25);
  const tail = Math.round(0.5 * SR), end = dry.length >> 1;
  expect(rms(dry, 0, tail, end)).toBeLessThan(0.001);
  expect(rms(sent, 0, tail, end)).toBeGreaterThan(0.002);
});

test("a bounce plays an FM track through its effect: Gain at 0.5 halves it, and PAN still places it", async () => {
  const T = 6, secs = 2, p = alone(T, 0, 0), frames = bounceFrames(p, SR, secs);
  const mix = async (q: Project, scale: number) => {
    const half = { bounceEffect: async (_: unknown, pcm: Float32Array) => pcm.map((x) => x * scale) };
    const tap = new Map<number, Float32Array>(), engine = () => new TsEngine(SR);
    const ins = await bounceInserts(q, SR, frames, async () => { renderProject(engine(), q, SR, secs, 0.5, undefined, undefined, null, { tap }); return tap; }, half);
    expect(ins.missed).toEqual([]);
    const fx: BounceInserts = { back: (t) => ins.back.get(t) };
    return renderProject(engine(), q, SR, secs, 0.5, undefined, undefined, null, fx);
  };
  const dry = renderProject(new TsEngine(SR), p, SR, secs, 0.5);
  const from = Math.round(0.25 * SR), to = Math.round(1.25 * SR), heard = rms(dry, 0, from, to);
  expect(heard).toBeGreaterThan(0.01);
  expect(rms(await mix(p, 1), 0, from, to) / heard).toBeCloseTo(1, 1);      // through Gain at 1: as loud as dry
  expect(rms(await mix(p, 0.5), 0, from, to) / heard).toBeCloseTo(0.5, 1);  // at 0.5: half
  const left = await mix(alone(T, -1, 0), 1);
  expect(rms(left, 1, from, to)).toBeLessThan(heard * 0.05);                 // panned hard left after the effect
  // an effect that won't play: named, and the track goes in dry
  const none = await bounceInserts(p, SR, frames, async () => new Map([[T, new Float32Array(frames)]]), null);
  expect(none.missed).toEqual(["Gain (web) (a web effect plays in FM DAW's own page)"]);
  expect(rms(renderProject(new TsEngine(SR), p, SR, secs, 0.5, undefined, undefined, null, { back: (t) => none.back.get(t) }), 0, from, to) / heard).toBeCloseTo(1, 2);
});
