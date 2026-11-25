// A take through the real audio thread: the input recorded on an armed track while Rec
// is on, the page's 16-bit copy in chunks and back, then played on the track at its beat.
import { expect, test } from "bun:test";
import { MAX_TAKES, MIN_CLIP_FRAMES, TAKE_RATE, TakeInbox, TakeShelf, clipsOf, encodeTake, soundIds, toChunks } from "../src/take.ts";
import { SR, posted, processor, run, useWorklet } from "./worklet-kit.ts";
import { TsEngine } from "../src/engine/engine.ts";
import { renderProject } from "../src/engine/offline.ts";
import { apply, clipEnd, cutClip, decodeOp, deleteClip, moveClip, sanitize, slipClip, trimClip, type Project } from "../src/project.ts";
import { demoProject } from "../src/presets.ts";
import { TRACKS } from "../src/engine/params.ts";

useWorklet();

/** A 440 Hz tone from 0.5 s to 1 s, silence around it. */
const burst = (t: number) => (t >= 0.5 && t < 1 ? 0.5 * Math.sin(2 * Math.PI * 440 * t) : 0);

const rms = (x: Float32Array, a: number, b: number) => {
  const s = x.subarray(Math.round(a * SR), Math.round(b * SR));
  return Math.sqrt(s.reduce((n, v) => n + v * v, 0) / s.length);
};

test("record a pass of the loop onto a track, share it in chunks, and hear it there at its beat", async () => {
  const { p, say } = processor();
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
  say({ t: "take", track: 2, clips: pcm ? [{ pcm, beat: 1 }] : [] });
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
  const { p, say } = processor();
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

// ---- clips: a take cut, trimmed and slipped, its sound stored once ----
const ID = "abcdefgh", BPM = 120, FPB = (60 / BPM) * TAKE_RATE;
const withTake = (take: object, more: object[] = []) => {
  const tracks = Array.from({ length: TRACKS }, (_, i) => ({ params: [], notes: [], ...(i === 2 ? take : {}), ...more[i] }));
  const p = sanitize({ v: 1, bpm: BPM, bars: 2, tracks });
  if (!p) throw new Error("bad project");
  return p;
};

test("a take nobody cut reads as it did; cut, trimmed and slipped it becomes clips of one sound, and whole again it is a take", () => {
  const take = { id: ID, beat: 1, frames: 2 * TAKE_RATE };                   // 2 s: four beats at 120
  const p = withTake({ take });
  expect(p.tracks[2].take).toEqual(take);
  expect(p.tracks[2].clips).toBeUndefined();
  expect(sanitize(JSON.parse(JSON.stringify(p)))).toEqual(p);

  // cut on beat 3: two clips sharing the sound, one sound in the sesh
  const cut = cutClip(clipsOf(p.tracks[2]), 3, BPM);
  expect(cut).toEqual([{ id: ID, beat: 1, frames: take.frames, to: 2 * FPB }, { id: ID, beat: 3, frames: take.frames, from: 2 * FPB }]);
  const q = apply(p, { t: "clips", track: 2, clips: [...cut] });
  expect(q.tracks[2].take).toBeUndefined();
  expect(soundIds(q)).toEqual(new Set([ID]));
  expect(sanitize(JSON.parse(JSON.stringify(q)))).toEqual(q);
  // a cut off every clip, or one leaving a piece too short, changes nothing
  expect(cutClip(cut, 0.5, BPM)).toBe(cut);
  expect(cutClip(cut, 3.001, BPM)).toBe(cut);

  // trim the second's start later: it starts later in the loop and later in the sound, which stays put in time
  const trimmed = trimClip(cut, 1, "start", 3.5, BPM);
  expect(trimmed[1]).toEqual({ id: ID, beat: 3.5, frames: take.frames, from: 2.5 * FPB });
  // trims are floats, and stop at the sound's own edges and at the shortest clip
  expect(trimClip(cut, 1, "start", 0, BPM)[1]).toEqual({ id: ID, beat: 1, frames: take.frames });
  expect(trimClip(cut, 1, "end", 99, BPM)[1]).toEqual(cut[1]);
  expect(trimClip(cut, 0, "end", 0, BPM)[0]).toEqual({ id: ID, beat: 1, frames: take.frames, to: MIN_CLIP_FRAMES });
  expect(trimClip(cut, 0, "end", 2.123, BPM)[0].to).toBeCloseTo(1.123 * FPB, 6);

  // slip: the window stays, the sound under it moves (later by a quarter beat), and stops at the sound's start
  const slipped = slipClip(trimmed, 1, 0.25, BPM);
  expect(slipped[1]).toEqual({ id: ID, beat: 3.5, frames: take.frames, from: 2.25 * FPB, to: 3.75 * FPB });
  expect(clipEnd(slipped[1], BPM)).toBe(clipEnd(trimmed[1], BPM));
  expect(slipClip(cut, 0, 1, BPM)[0]).toEqual(cut[0]);
  expect(moveClip(cut, 1, 6)[1].beat).toBe(6);

  // the second deleted and the first trimmed back out: the whole sound again, so a take once more
  const whole = trimClip(deleteClip(cut, 1), 0, "end", 99, BPM);
  expect(apply(q, { t: "clips", track: 2, clips: [...whole] }).tracks[2]).toEqual(p.tracks[2]);
  // past the loop's end, or a window outside its sound, isn't taken
  expect(apply(q, { t: "clips", track: 2, clips: [{ ...cut[0], beat: 8 }] })).toBe(q);
  expect(decodeOp({ t: "clips", track: 2, clips: [{ id: ID, beat: 0, frames: 1000, from: 990 }] })).toBeNull();
});

test("the sesh's cap counts sounds: cuts of one sound on another track are free, a fifth sound isn't", () => {
  const ids = ["aaaaaaaa", "bbbbbbbb", "cccccccc", "dddddddd"];
  const p = withTake({}, ids.map((id, i) => ({ take: { id, beat: i, frames: TAKE_RATE } })));
  expect(soundIds(p).size).toBe(MAX_TAKES);
  const more = apply(p, { t: "clips", track: 5, clips: [{ id: "aaaaaaaa", beat: 0, frames: TAKE_RATE, to: TAKE_RATE / 2 }, { id: "bbbbbbbb", beat: 2, frames: TAKE_RATE }] });
  expect(more.tracks[5].clips?.length).toBe(2);
  expect(apply(more, { t: "take", track: 6, take: { id: "eeeeeeee", beat: 0, frames: TAKE_RATE } })).toBe(more);
  // landing a new take where the only clip of a sound was replaces it
  expect(apply(p, { t: "take", track: 3, take: { id: "eeeeeeee", beat: 0, frames: TAKE_RATE } }).tracks[3].take?.id).toBe("eeeeeeee");
});

test("a clip plays only inside its window, live and in the bounce alike: slipped onto the beat, cut short, the cut never clicks", async () => {
  // the sound: silence, then a tone from 0.1 s to 0.4 s (a hit played 0.1 s late)
  const s16 = encodeTake(Float32Array.from({ length: 2 * SR }, (_, i) => (i >= 0.1 * SR && i < 0.4 * SR ? 0.5 * Math.sin(2 * Math.PI * 440 * (i / SR)) : 0)), SR);
  const sound = Float32Array.from(s16, (v) => v / 32767);
  const p0 = withTake({ take: { id: ID, beat: 1, frames: s16.length } });
  // laid on beat 1 (0.5 s) the hit is at 0.6 s. Keep its first bar-half (cut on beat 2, drop the rest: a window
  // can't slip past its sound's end), slip the sound a fifth of a beat earlier, onto the beat, then cut on beat 1.25
  const half = deleteClip(cutClip(clipsOf(p0.tracks[2]), 2, BPM), 1);
  const clips = deleteClip(cutClip(slipClip(half, 0, -0.2, BPM), 1.25, BPM), 1);
  const p = apply(p0, { t: "clips", track: 2, clips: [...clips] });
  expect(p.tracks[2].clips?.length).toBe(1);

  const bounced = renderProject(new TsEngine(SR), p, SR, 2, 1, (id) => (id === ID ? sound : undefined)).filter((_, i) => i % 2 === 0);
  const { p: proc, say } = processor();
  say({ t: "tempo", bpm: BPM, swing: 0, loopBeats: 8 });
  say({ t: "master", gain: 1 });
  const shelf = new TakeShelf();
  shelf.keep(ID, sound);
  shelf.sync(p, say);
  say({ t: "play", countIn: 0 });
  const live = await run(proc, 2);

  for (const out of [live, bounced]) {
    expect(rms(out, 0.05, 0.49)).toBeLessThan(0.01);               // nothing before the beat
    expect(rms(out, 0.51, 0.62)).toBeGreaterThan(0.3);             // the hit, on the beat
    expect(rms(out, 0.63, 1.95)).toBeLessThan(0.01);               // cut at 0.625 s
    // the cut fades out over 3 ms rather than stopping dead mid-wave
    const tail = out.subarray(Math.round(0.6245 * SR), Math.round(0.625 * SR));
    expect(Math.max(...tail.map(Math.abs))).toBeLessThan(0.1);
  }
  let most = 0;
  for (let i = 0; i < live.length; i++) most = Math.max(most, Math.abs(live[i] - bounced[i]));
  expect(most).toBeLessThan(1e-4);
});

test("No instrument in the bounce: the track's notes make no sound, its take still plays", () => {
  const demo = demoProject();
  const bounce = (q: Project) => renderProject(new TsEngine(SR), q, SR, 2, 1);
  const loud = (x: Float32Array) => Math.sqrt(x.reduce((n, v) => n + v * v, 0) / x.length);
  expect(loud(bounce(demo))).toBeGreaterThan(0.01);
  expect(loud(bounce({ ...demo, tracks: demo.tracks.map((t) => ({ ...t, voiceless: true as const })) }))).toBeLessThan(1e-4);
  const s16 = encodeTake(Float32Array.from({ length: 2 * SR }, (_, i) => burst(i / SR)), SR);
  const sound = Float32Array.from(s16, (v) => v / 32767);
  const one = sanitize({ v: 1, bpm: 120, bars: 1, tracks: Array.from({ length: TRACKS }, (_, i) => ({ params: [], notes: [], ...(i === 2 ? { voiceless: true, take: { id: "abcdefgh", beat: 1, frames: s16.length } } : {}) })) });
  if (!one) throw new Error("bad project");
  const out = renderProject(new TsEngine(SR), one, SR, 2, 1, (id) => (id === "abcdefgh" ? sound : undefined)).filter((_, i) => i % 2 === 0);
  expect(rms(out, 1.05, 1.45)).toBeGreaterThan(0.3);
});
