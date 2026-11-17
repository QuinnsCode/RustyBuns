// A take through the real audio thread: the input recorded on an armed track while Rec
// is on, the page's 16-bit copy in chunks and back, then played on the track at its beat.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { TakeInbox, encodeTake, toChunks } from "../src/take.ts";
import type { FromWorklet, ToWorklet } from "../src/engine/messages.ts";
import { TsEngine } from "../src/engine/engine.ts";
import { renderProject } from "../src/engine/offline.ts";
import { sanitize } from "../src/project.ts";
import { TRACKS } from "../src/engine/params.ts";

const SR = 48000, BLOCK = 128;
interface Proc { port: { onmessage: (e: { data: ToWorklet }) => void }; process(i: Float32Array[][], o: Float32Array[][]): boolean }
let Processor: new () => Proc;
const posted: FromWorklet[] = [];
const globals = ["sampleRate", "AudioWorkletProcessor", "registerProcessor"] as const;
beforeAll(async () => {
  Object.assign(globalThis, {
    sampleRate: SR,
    AudioWorkletProcessor: class { port = { postMessage: (m: FromWorklet) => posted.push(m), onmessage: null } },
    registerProcessor: (_: string, c: new () => Proc) => { Processor = c; },
  });
  await import("../src/engine/worklet.ts");
});
afterAll(() => { for (const g of globals) Reflect.deleteProperty(globalThis, g); });

/** A 440 Hz tone from 0.5 s to 1 s, silence around it. */
const burst = (t: number) => (t >= 0.5 && t < 1 ? 0.5 * Math.sin(2 * Math.PI * 440 * t) : 0);

async function run(p: Proc, seconds: number, input?: (t: number) => number, from = 0): Promise<Float32Array> {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let at = 0; at < out.length; at += BLOCK) {
    const x = new Float32Array(BLOCK).map((_, i) => input?.((from + at + i) / SR) ?? 0);
    const L = new Float32Array(BLOCK), R = new Float32Array(BLOCK);
    p.process([[x]], [[L, R]]);
    out.set(L.subarray(0, Math.min(BLOCK, out.length - at)), at);
  }
  await Promise.resolve();
  return out;
}
const rms = (x: Float32Array, a: number, b: number) => {
  const s = x.subarray(Math.round(a * SR), Math.round(b * SR));
  return Math.sqrt(s.reduce((n, v) => n + v * v, 0) / s.length);
};

test("record a pass of the loop onto a track, share it in chunks, and hear it there at its beat", async () => {
  const p = new Processor();
  const say = (m: ToWorklet) => p.port.onmessage({ data: m });
  say({ t: "tempo", bpm: 120, swing: 0, loopBeats: 6 });               // a 3 s loop: two chunks of sound
  say({ t: "master", gain: 1 });
  say({ t: "arm", track: 2, inLatency: 0 });
  say({ t: "rec", on: true });
  say({ t: "play", countIn: 0 });
  // a pass and a bit: the whole pass is the take, the bit cut short by Stop doesn't replace it
  await run(p, 3.5, burst);
  say({ t: "rec", on: false });
  say({ t: "stop" });
  await Promise.resolve();
  const takes = posted.filter((m) => m.t === "taken");
  expect(takes.length).toBe(1);
  const got = takes[0];
  if (got.t !== "taken") throw new Error("no take");
  expect(got).toMatchObject({ track: 2, beat: 0, rate: SR });
  expect(got.pcm.length).toBe(3 * SR);

  // the page keeps it at 24 kHz in 16 bits and sends it in chunks; the others put it back together
  const s16 = encodeTake(got.pcm, got.rate);
  const inbox = new TakeInbox();
  const chunks = toChunks("abcdefgh", s16);
  expect(chunks.length).toBeGreaterThan(1);
  let pcm: Float32Array | null = null;
  for (const c of [...chunks].reverse()) pcm = inbox.add(c);
  expect(pcm?.length).toBe(s16.length);

  // on the track a beat (0.5 s) later than it was played: the tone now sounds from 1 s to 1.5 s
  say({ t: "take", track: 2, pcm, beat: 1 });
  say({ t: "play", countIn: 0 });
  const heard = await run(p, 3);
  expect(rms(heard, 0.05, 0.95)).toBeLessThan(0.01);
  expect(rms(heard, 1.05, 1.45)).toBeGreaterThan(0.3);
  expect(rms(heard, 1.55, 2.95)).toBeLessThan(0.01);
  // muted with its track
  say({ t: "audible", mask: Array.from({ length: 12 }, (_, i) => i !== 2) });
  say({ t: "play", countIn: 0 });
  expect(rms(await run(p, 2), 1.05, 1.45)).toBeLessThan(0.01);
});

test("the take starts where the player heard the groove: the input's lateness is taken off", async () => {
  const p = new Processor();
  const say = (m: ToWorklet) => p.port.onmessage({ data: m });
  posted.length = 0;
  say({ t: "tempo", bpm: 120, swing: 0, loopBeats: 4 });
  say({ t: "arm", track: 0, inLatency: 0.25 });                        // half a beat late
  say({ t: "rec", on: true });
  say({ t: "play", countIn: 0 });
  await run(p, 0.5, burst);
  say({ t: "stop" });
  await Promise.resolve();
  expect(posted.find((m) => m.t === "taken")).toMatchObject({ track: 0, beat: 3.5 });
});

test("a bounce has the takes in it: at their beat, as playback has them, and not on a muted track", () => {
  const s16 = encodeTake(Float32Array.from({ length: 2 * SR }, (_, i) => burst(i / SR)), SR);
  const sound = Float32Array.from(s16, (v) => v / 32767);
  const tracks = Array.from({ length: TRACKS }, (_, i) => ({ params: [], notes: [], ...(i === 2 ? { take: { id: "abcdefgh", beat: 1, frames: s16.length } } : {}) }));
  const p = sanitize({ v: 1, bpm: 120, bars: 1, tracks });
  if (!p) throw new Error("bad project");
  const left = (x: Float32Array) => x.filter((_, i) => i % 2 === 0);
  const bounce = (q = p) => left(renderProject(new TsEngine(SR), q, SR, 2, 1, (id) => (id === "abcdefgh" ? sound : undefined)));
  // a beat (0.5 s) later than it was played: the tone from 1 s to 1.5 s
  const out = bounce();
  expect(rms(out, 0.05, 0.95)).toBeLessThan(0.01);
  expect(rms(out, 1.05, 1.45)).toBeGreaterThan(0.3);
  expect(rms(out, 1.55, 1.95)).toBeLessThan(0.01);
  expect(rms(bounce({ ...p, tracks: p.tracks.map((t, i) => (i === 2 ? { ...t, mute: true } : t)) }), 1.05, 1.45)).toBeLessThan(0.01);
});
