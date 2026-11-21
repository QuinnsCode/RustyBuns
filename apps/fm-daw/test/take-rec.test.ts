// Rec in the jam room (src/studio/take-rec.ts): a friend's guitar goes out as stamped Opus slices (opus.test.ts's
// stand-in codec, 16-bit inside), through the World's guard into this page's FarSound, and R lays one loop of it on
// their track as a take, on the bar Rec started from, sample for sample, even while this page hears them on the call.
import { expect, test } from "bun:test";
import { OPUS_LAG, OpusOut, type MakeDecoder, type MakeEncoder } from "../src/studio/opus.ts";
import { FarSound } from "../src/studio/plugin-line.ts";
import { Band } from "../src/studio/band.ts";
import { Recorder, takeTrack } from "../src/studio/take-rec.ts";
import { apply, decodeServer, loopBeats, type Live, type Project } from "../src/project.ts";
import { demoProject } from "../src/presets.ts";
import { TAKE_RATE, TakeInbox, type TakeBytes } from "../src/take.ts";
import type { ToWorklet } from "../src/engine/messages.ts";

const PACKET = 480, SLICE = 2400, FRIEND = 4;
const encoder: MakeEncoder = (packet) => {
  let buf: number[] = Array(OPUS_LAG).fill(0), at = 0;
  return {
    encode(pcm) {
      buf.push(...pcm);
      while (buf.length >= PACKET) { packet(new Uint8Array(Int16Array.from(buf.slice(0, PACKET)).buffer), at, PACKET); buf = buf.slice(PACKET); at += PACKET; }
    },
    close() {},
  };
};
const decoder: MakeDecoder = (pcm) => ({ decode(d) { pcm(Float32Array.from(new Int16Array(d.slice().buffer), (v) => v / 32767)); }, close() {} });
/** The friend's guitar: sample `i` of their stream. */
const tone = (i: number) => 0.4 * Math.sin((2 * Math.PI * 330 * i) / TAKE_RATE);

/** This page in the sesh, listening as it comes: the live line in, Rec on its FarSound, the takes it lands applied. */
function page(p: Project) {
  let beat = 1001, project = p;
  const band = new Band(() => ({ bpm: project.bpm, loopBeats: loopBeats(project) }), () => 1e12);
  band.leading(true);
  band.listen = "now";
  const played: ToWorklet[] = [], said: string[] = [], chunks: TakeBytes[] = [], sound = new Map<string, Float32Array>();
  const far = new FarSound(band, (m) => played.push(m));
  far.decodeWith(decoder);
  const rec = new Recorder({
    project: () => project, beat: () => beat, say: (s) => said.push(s),
    land(track, take, c, pcm) { chunks.push(...c); sound.set(take.id, pcm); project = apply(project, { t: "take", track, take }); },
  });
  far.tap = rec;
  const hear = (e: Live) => {
    const m = decodeServer({ t: "live", from: FRIEND, e });
    if (m?.t !== "live") throw new Error(`the live line turned ${e.t} away`);
    far.heard(FRIEND, m.e);
  };
  return { rec, hear, played, said, chunks, sound, project: () => project, at: (b: number) => { beat = b; } };
}

/** The friend playing from beat `from` for `slices` slices into live-line track `line`, out through Opus. */
function friend(line: number, from: number, slices: number, bpm: number, hear: (e: Live) => void) {
  const out = new OpusOut(encoder, hear, () => bpm, () => line);
  hear({ t: "guitar", track: line });
  for (let k = 0; k < slices; k++) out.slice(from + (k * SLICE * bpm) / 60 / TAKE_RATE, Int16Array.from({ length: SLICE }, (_, i) => Math.round(tone(k * SLICE + i) * 32767)));
}

test("R records one loop of a friend's guitar onto their track, from the next bar, as everyone will hear it", () => {
  const p0 = { ...demoProject(), bpm: 120 }, line = p0.tracks.findIndex((t) => t.kind === "synth");
  const me = page(p0), bpm = p0.bpm, loop = loopBeats(p0);
  me.rec.start(FRIEND, line, "Ben's guitar");
  expect(me.said.at(-1)).toContain(`Ben's guitar onto ${p0.tracks[line].name}`);
  expect(me.rec.state()?.from).toBe(1004);
  // they play from beat 1000, past a whole loop after the bar Rec waits for
  friend(line, 1000, Math.ceil(((loop + 6) * 60 * TAKE_RATE) / bpm / SLICE), bpm, me.hear);

  const take = me.project().tracks[line].take!;
  expect(me.rec.state()).toBeNull();
  expect(take.beat).toBe(1004 % loop);
  expect(take.frames).toBe(Math.round(((loop * 60) / bpm) * TAKE_RATE));
  expect(me.said.at(-1)).toMatch(/^A take on /);
  // listening as it comes, the friend is heard on the call: Rec decodes their slices without playing them twice
  expect(me.played).toEqual([]);
  // the take is their stream from beat 1004 on, and the sesh gets the same sound in its chunks
  const pcm = me.sound.get(take.id)!, startAt = ((1004 - 1000) * 60 * TAKE_RATE) / bpm;
  for (const i of [0, 1, 777, 50_000, take.frames - 1]) expect(pcm[i]).toBeCloseTo(tone(startAt + i), 3);
  const inbox = new TakeInbox();
  const got = me.chunks.map((c) => inbox.add(c)).at(-1);
  expect(got).toEqual(pcm);
});

test("a mic from the booth (straight in) lands on the first track with no take; unplugging lands what came in", () => {
  const p0 = { ...demoProject(), bpm: 120 }, first = p0.tracks.findIndex((t) => !t.take);
  const me = page(p0), bpm = p0.bpm;
  me.rec.start(FRIEND, -1, "Ana's mic");
  // two beats in from the bar, she pulls the mic out
  friend(-1, 1004, Math.round((2 * 60 * TAKE_RATE) / bpm / SLICE), bpm, me.hear);
  me.hear({ t: "guitar", track: null });
  me.rec.unplugged(FRIEND);
  const take = me.project().tracks[first].take!;
  expect(take.beat).toBe(1004 % loopBeats(p0));
  expect(Math.abs(take.frames - TAKE_RATE)).toBeLessThan(SLICE);
  // Rec that hears nothing lands nothing
  me.rec.start(FRIEND, 2, "Ana's guitar");
  me.at(1004 + 3 * loopBeats(p0));
  me.rec.tick();
  expect(me.said.at(-1)).toBe("Rec: nothing came in, no take");
});

test("which track a take lands on", () => {
  const p = demoProject(), withTakes = (n: number) => p.tracks.reduce((q, _, i) => (i < n ? apply(q, { t: "take", track: i, take: { id: `take000${i}`, beat: 0, frames: 10 } }) : q), p);
  const rows: [Project, number, number | undefined, number | string][] = [
    [p, 2, undefined, 2],                      // a guitar plugged into track 2
    [withTakes(1), -1, undefined, 1],          // a mic: the first track with no take
    [withTakes(1), -1, 3, 3],                  // the leader picks one
    [withTakes(4), 2, 1, 1],                   // a track with a take already: recorded over
    [withTakes(4), 5, undefined, "The sesh holds 4 takes at most"],
  ];
  for (const [proj, plugged, pick, want] of rows) expect(takeTrack(proj, plugged, pick)).toBe(want);
});
