// Import MIDI (src/midi-file.ts): a .mid written byte by byte here is read into notes, beats as the file has them,
// then laid on the project's tracks as one set of edits.
import { expect, test } from "bun:test";
import { landMidi, MidiError, readMidi } from "../src/midi-file.ts";
import { apply, BEATS_PER_BAR } from "../src/project.ts";
import { demoProject } from "../src/presets.ts";

/** A variable-length quantity, as a MIDI file writes its numbers. */
function vlq(n: number): number[] {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
}
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
/** A track chunk from [delta, ...bytes] events, ended for it. */
const mtrk = (events: number[][]) => {
  const body = [...events.flatMap(([d, ...b]) => [...vlq(d), ...b]), 0, 0xff, 0x2f, 0];
  return [...ascii("MTrk"), ...u32(body.length), ...body];
};
const smf = (format: number, ppq: number, tracks: number[][]) =>
  new Uint8Array([...ascii("MThd"), ...u32(6), 0, format, 0, tracks.length, ppq >> 8, ppq & 255, ...tracks.flat()]);

test("a format 1 file: tempo track, running status, note-on at velocity 0, PPQ to beats unquantized", () => {
  const tempo = mtrk([[0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20]]); // 500000 us a beat: 120 BPM
  // 480 PPQ: C4 at 0 for a beat (a real note-off), E4 at 1.5 beats for 0.37 beats by running status and velocity 0
  const lead = mtrk([
    [0, 0xff, 0x03, 4, ...ascii("Lead")],
    [0, 0x90, 60, 100], [480, 0x80, 60, 0],
    [240, 0x90, 64, 127], [178, 64, 0],
  ]);
  const song = readMidi(smf(1, 480, [tempo, lead]));
  expect(song.bpm).toBe(120);
  expect(song.parts.map((p) => p.name)).toEqual(["Lead"]);
  const [c, e] = song.parts[0].notes;
  expect(c).toEqual({ s: 0, l: 1, m: 60, v: 100 / 127 });
  expect(e.s).toBe(1.5);
  expect(e.l).toBeCloseTo(178 / 480, 12);
  expect(e.v).toBe(1);
});

test("format 0 with two channels is two parts, and a note never let go ends with its track", () => {
  const one = mtrk([[0, 0x90, 36, 90], [0, 0x99, 42, 80], [96, 0x89, 42, 0], [96, 0x80, 36, 0], [0, 0x90, 38, 70], [192, 0xc0, 5]]);
  const song = readMidi(smf(0, 96, [one]));
  expect(song.parts.map((p) => [p.name, p.channel, p.notes.length])).toEqual([["Track 1 ch 1", 0, 2], ["Track 1 ch 10", 9, 1]]);
  expect(song.parts[0].notes[1]).toMatchObject({ s: 2, l: 2, m: 38 });
  expect(song.bpm).toBeNull();
});

test("a broken or wrong file says why", () => {
  expect(() => readMidi(new Uint8Array(ascii("RIFF....WAVE")))).toThrow(MidiError);
  expect(() => readMidi(smf(2, 96, [mtrk([[0, 0x90, 60, 1]])]))).toThrow(/format 2/);
  expect(() => readMidi(smf(1, 96, [mtrk([])]))).toThrow(/no notes/);
  expect(() => readMidi(smf(1, 96, [mtrk([[0, 0x90, 60, 1]])]).slice(0, 27))).toThrow(/ends too soon/);
});

test("landing: parts spread down from the picked track, the loop grows to fit, the tempo comes too, one undo's worth of ops", () => {
  const p = demoProject();
  const part = (m: number, beats: number) => ({ name: "x", channel: 0, notes: [{ s: 0, l: 1, m, v: 0.5 }, { s: beats - 1, l: 1, m, v: 0.5 }] });
  const long = p.bars * BEATS_PER_BAR + 8;
  const plan = { parts: [part(60, long), part(48, 4)], track: 10, at: 0, grow: true, tempo: true };
  const got = landMidi(p, plan, 97.6);
  const next = got.ops.reduce(apply, p);
  expect(next.bars).toBe(got.needBars);
  expect(next.bars).toBe(Math.ceil(long / BEATS_PER_BAR));
  expect(next.bpm).toBe(98);
  expect(next.tracks[10].notes.map((n) => n.s)).toEqual([0, long - 1]);
  expect(next.tracks[11].notes.map((n) => n.m)).toEqual([48, 48]);
  expect(got.cut).toBe(0);
  // not grown: what falls past the loop is counted, not lost without a word; a third part has no track left
  const kept = landMidi(p, { ...plan, parts: [...plan.parts, part(40, 4)], grow: false, tempo: false }, 97.6);
  expect(kept.cut).toBe(1);
  expect(kept.spare).toBe(1);
  expect(kept.ops.some((o) => o.t === "global")).toBe(false);
});

test("No instrument: an optional field, absent on every existing project, kept through a save", () => {
  const p = demoProject();
  expect(p.tracks.some((t) => "voiceless" in t)).toBe(false);
  const off = apply(p, { t: "voiceless", track: 2, on: true });
  expect(off.tracks[2].voiceless).toBe(true);
  expect(off.tracks[2].notes).toEqual(p.tracks[2].notes);
  const back = apply(off, { t: "voiceless", track: 2, on: false });
  expect("voiceless" in back.tracks[2]).toBe(false);
  expect(apply(off, { t: "replace", project: JSON.parse(JSON.stringify(off)) }).tracks[2].voiceless).toBe(true);
});
