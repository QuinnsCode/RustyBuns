// A track's Amp insert: a guitar in through the armed track's amp on the audio thread, the take recorded dry
// and played back through the amp, and the project keeping the amp and its knobs.
import { expect, setDefaultTimeout, test } from "bun:test";
import { SR, posted, processor, run, useWorklet } from "./worklet-kit.ts";
import { AMPS } from "../src/circuit/amps.ts";
import { AMP_IDS, TrackAmp } from "../src/amp/track-amp.ts";
import { apply, decodeOp, sanitize } from "../src/project.ts";
import { opNeeds } from "../src/grants.ts";
import { TRACKS } from "../src/engine/params.ts";
import { check } from "@rustybuns/util/guard";

setDefaultTimeout(60_000);
useWorklet();

/** A plucked low E, as a guitar's pickup gives it: loud, then dying away. */
const pluck = (t: number) => 0.4 * Math.exp(-3 * t) * Math.sin(2 * Math.PI * 82.4 * t) * (1 + 0.5 * Math.sin(2 * Math.PI * 164.8 * t));

const rms = (x: Float32Array) => Math.sqrt(x.reduce((n, v) => n + v * v, 0) / x.length);
const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const lastTick = () => posted.findLast((m) => m.t === "tick");
const brit = check(TrackAmp, { amp: "brit", ...AMPS[0].knobs });
if (!brit) throw new Error("no amp");

test("a guitar through a track's amp: muted until Monitor, bounded and converged, recorded dry, the take replayed through the amp", async () => {
  const { p, say } = processor();
  say({ t: "tempo", bpm: 120, swing: 0, loopBeats: 4 });               // a 2 s loop
  say({ t: "master", gain: 1 });
  say({ t: "amp", track: 3, amp: brit });
  say({ t: "arm", track: 3, inLatency: 0 });

  // the input starts muted: nothing reaches the speakers until Monitor is on
  expect(peak(await run(p, 0.5, pluck))).toBe(0);
  say({ t: "monitor", on: true });
  const live = await run(p, 1, pluck);
  expect(rms(live)).toBeGreaterThan(0.05);
  expect(peak(live)).toBeLessThanOrEqual(0.89);                          // the amp's limiter: never past −1 dBFS
  expect(live.every(Number.isFinite)).toBe(true);
  expect(lastTick()).toMatchObject({ ampMisses: 0 });                    // every Newton step converged

  // a new arm (another track picked) turns Monitor back off
  say({ t: "arm", track: 3, inLatency: 0 });
  expect(peak(await run(p, 0.25, pluck))).toBe(0);

  // Rec takes the guitar dry, so the amp can change after
  say({ t: "rec", on: true });
  say({ t: "play", countIn: 0 });
  await run(p, 2.1, pluck);
  say({ t: "rec", on: false });
  say({ t: "stop" });
  await Promise.resolve();
  const take = posted.find((m) => m.t === "taken");
  if (take?.t !== "taken") throw new Error("no take");
  expect(take.track).toBe(3);
  expect(peak(take.pcm)).toBeCloseTo(peak(Float32Array.from({ length: 2 * SR }, (_, i) => pluck(i / SR))), 2);

  // the take plays back through the amp, and is dry again with the amp taken off
  say({ t: "take", track: 3, pcm: take.pcm, beat: 0 });
  say({ t: "play", countIn: 0 });
  const amped = await run(p, 1);
  say({ t: "amp", track: 3, amp: null });
  say({ t: "play", countIn: 0 });
  const dry = await run(p, 1);
  expect(rms(amped)).toBeGreaterThan(0.05);
  expect(peak(amped)).toBeLessThanOrEqual(0.89);
  expect(Math.abs(rms(amped) - rms(dry))).toBeGreaterThan(0.01);
});

test("the project keeps a track's amp: picked, knobs clamped, taken off, a desk (mix) edit", () => {
  expect(AMPS.map((a) => a.id).sort()).toEqual([...AMP_IDS].sort());
  const p = sanitize({ v: 1, bpm: 120, bars: 1, tracks: Array.from({ length: TRACKS }, () => ({ params: [], notes: [] })) });
  if (!p) throw new Error("bad project");
  const op = decodeOp({ t: "amp", track: 1, amp: { ...brit, gain: 14, amp: "clean" } });
  if (!op) throw new Error("refused");
  const on = apply(p, op);
  expect(on.tracks[1].amp).toMatchObject({ amp: "clean", gain: 10 });
  expect(sanitize(JSON.parse(JSON.stringify(on)))?.tracks[1].amp).toEqual(on.tracks[1].amp);
  expect(opNeeds(op)).toBe("mix");
  const off = decodeOp({ t: "amp", track: 1, amp: null });
  expect(off && "amp" in apply(on, off).tracks[1]).toBe(false);
  // an amp nobody makes reads as the first head, and a track saved without one reads as before
  expect(sanitize({ ...on, tracks: on.tracks.map((t, i) => (i === 1 ? { ...t, amp: { amp: "stack-of-ten" } } : t)) })?.tracks[1].amp?.amp).toBe("brit");
  expect("amp" in p.tracks[0]).toBe(false);
});
