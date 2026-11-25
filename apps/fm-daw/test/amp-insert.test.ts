// A track's Amp insert: a guitar in through the armed track's amp on the audio thread, the take recorded dry
// and played back through the amp, the track's synth through it in both engines and the bounce, and the project
// keeping the amp and its knobs.
import { expect, setDefaultTimeout, test } from "bun:test";
import { SR, posted, processor, run, useWorklet } from "./worklet-kit.ts";
import { AMPS } from "../src/circuit/amps.ts";
import { AMP_IDS, TrackAmp } from "../src/amp/track-amp.ts";
import { apply, audible, decodeOp, loopBeats, sanitize } from "../src/project.ts";
import { opNeeds } from "../src/grants.ts";
import { CEILING, TRACKS } from "../src/engine/params.ts";
import { check } from "@rustybuns/util/guard";
import { existsSync, readFileSync } from "node:fs";
import { nightShift } from "../src/songs.ts";
import { loadMsg } from "../src/ui/load.ts";
import { TsEngine, type FmEngine } from "../src/engine/engine.ts";
import { createNativeEngine } from "../src/engine/native.ts";
import { renderPattern } from "../src/engine/sequencer.ts";
import { renderProject } from "../src/engine/offline.ts";

setDefaultTimeout(30_000);
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
  say({ t: "take", track: 3, clips: [{ pcm: take.pcm, beat: 0 }] });
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

/** Night Shift's womp bass alone (track 5), with or without an amp, through the audio thread on `kind`'s engine. */
async function womp(kind: "ts" | "rust", amp: TrackAmp | null) {
  const song = nightShift();
  const { p, say } = processor();
  say(loadMsg({ ...song, tracks: song.tracks.map((t, i) => ({ ...t, solo: i === 5, amp: i === 5 && amp ? amp : undefined })) }));
  if (kind === "rust") {
    say({ t: "engine", kind, bytes: new Uint8Array(readFileSync(WASM)).buffer });
    for (let i = 0; i < 100 && !posted.some((m) => m.t === "engine"); i++) await Bun.sleep(10);
    expect(posted.find((m) => m.t === "engine")).toEqual({ t: "engine", kind });
  }
  say({ t: "master", gain: 0.6 });
  say({ t: "play", countIn: 0 });
  return run(p, 1.5);
}
const WASM = new URL("../public/fm_daw.wasm", import.meta.url);

test("a synth track through its amp: out of the engine's sum, after its Shape, bounded and converged, in both engines", async () => {
  const kinds = existsSync(WASM) ? (["ts", "rust"] as const) : (console.log("  (rust skipped: run `bun run build:native`)"), ["ts"] as const);
  const amped: Float32Array[] = [];
  for (const kind of kinds) {
    const dry = await womp(kind, null), wet = await womp(kind, brit);
    expect(lastTick()).toMatchObject({ ampMisses: 0, nans: 0 });          // every Newton step converged
    expect(rms(wet)).toBeGreaterThan(0.02);
    expect(peak(wet)).toBeLessThanOrEqual(CEILING);                        // never past −1 dBFS
    expect(wet.every(Number.isFinite)).toBe(true);
    let diff = 0;
    for (let i = 0; i < wet.length; i++) diff = Math.max(diff, Math.abs(wet[i] - dry[i]));
    expect(diff).toBeGreaterThan(0.05);                                    // the amp is heard, not summed in dry beside it
    amped.push(wet);
  }
  // the two engines hand the amp the same synth, so it plays the same
  if (amped.length === 2) {
    let d = 0;
    for (let i = 0; i < amped[0].length; i++) d = Math.max(d, Math.abs(amped[0][i] - amped[1][i]));
    console.log(`  amped womp: max |rust - ts| = ${d.toExponential(2)}`);
    expect(d).toBeLessThan(1e-3);
  }
});

test("the bounce plays a synth track through its amp too, the engine's taps the same in TS and Rust", async () => {
  const song = nightShift();
  const p = { ...song, tracks: song.tracks.map((t, i) => ({ ...t, solo: i === 5, amp: i === 5 ? brit : undefined })) };
  const ts = renderProject(new TsEngine(SR), p, SR, 1, 0.6);
  const dry = renderProject(new TsEngine(SR), { ...p, tracks: p.tracks.map((t) => ({ ...t, amp: undefined })) }, SR, 1, 0.6);
  expect(peak(ts)).toBeLessThanOrEqual(CEILING);
  expect(Math.abs(rms(ts) - rms(dry))).toBeGreaterThan(0.005);
  // the taps themselves, sample for sample: Rust's cdylib against TS
  const rust = await createNativeEngine(SR);
  if (!rust) return console.log("  (rust skipped: run `bun run build:native`)");
  const taps = (e: FmEngine) => {
    const got: number[] = [];
    renderPattern(e, SR, 1, (seq) => {
      p.tracks.forEach((t, ti) => { t.params.forEach((v, i) => e.setParam(ti, i, v)); seq.setNotes(ti, t.notes); e.setTap(ti, ti === 5); });
      seq.bpm = p.bpm; seq.setLoopBeats(loopBeats(p)); seq.setAudible(audible(p));
    }, undefined, (_, n, tp) => { for (let f = 0; f < n; f++) got.push(tp?.[f * TRACKS + 5] ?? NaN); }, true);
    return got;
  };
  const a = taps(rust), b = taps(new TsEngine(SR));
  rust.free?.();
  expect(rms(Float32Array.from(b))).toBeGreaterThan(0.01);
  let d = 0;
  for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
  expect(d).toBeLessThan(1e-4);
});
