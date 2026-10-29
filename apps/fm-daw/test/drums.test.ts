// The drum machine, Space and the liquid song: grooves land where they say,
// a kit swap keeps the pattern, and the whole song through Space stays under
// the ceiling.
import { test, expect, setDefaultTimeout } from "bun:test";
import { GROOVES, KITS, applyGroove, applyKit, laneNotes } from "../src/drums.ts";
import { nightShift } from "../src/songs.ts";
import { longTrail } from "../src/longtrail.ts";
import { P } from "../src/engine/params.ts";
import { demoProject } from "../src/presets.ts";
import { apply, sanitize } from "../src/project.ts";
import { TsEngine } from "../src/engine/engine.ts";
import { Space } from "../src/engine/space.ts";
import { CEILING } from "../src/engine/params.ts";
import { renderProject } from "../src/engine/offline.ts";

setDefaultTimeout(60_000);

test("a groove tiles across the loop and puts its fill in the last bar", () => {
  const roller = GROOVES[0];
  const snare = laneNotes(roller, 1, 4, 50);
  const bar = (b: number) => snare.filter((n) => n.s >= b * 4 && n.s < b * 4 + 4).map((n) => n.s - b * 4);
  expect(bar(0)).toEqual([1, 1.75, 3]);     // backbeats and a ghost
  expect(bar(3).length).toBeGreaterThan(bar(0).length); // the fill
  expect(laneNotes(roller, 1, 1, 50).map((n) => n.s)).toEqual([1, 1.75, 3]); // one bar: no fill
});

test("applying a groove and a kit is one project; the kit keeps the pattern", () => {
  const p = applyGroove({ ...demoProject(), bars: 2 }, GROOVES[0]);
  expect(p.bpm).toBe(174);
  expect(p.tracks[0].notes.map((n) => n.s)).toEqual([0, 2.5, 4, 6.5, 7.25]);
  const k = applyKit(p, KITS[1]);
  expect(k.tracks[3].name).toBe("Shaker");
  expect(k.tracks[0].notes.map((n) => n.s)).toEqual(p.tracks[0].notes.map((n) => n.s));
  expect(k.tracks[0].notes.every((n) => n.m === k.tracks[0].root)).toBe(true);
  expect(k.tracks[5]).toEqual(p.tracks[5]); // synths untouched
});

test("space is part of the project and survives the world's sanitizer", () => {
  const p = apply(demoProject(), { t: "global", space: 0.8 });
  expect(sanitize(JSON.parse(JSON.stringify(p)))!.space).toBe(0.8);
  expect(sanitize({ ...p, space: 9 })!.space).toBe(1);
  expect(sanitize({ ...p, space: undefined })!.space).toBe(0);
});

test("Night Shift through Space: audible, finite, under the ceiling", () => {
  const p = nightShift();
  expect(sanitize(p)).toEqual(p);
  const out = renderProject(new TsEngine(48000), p, 48000, 12, 1);
  let peak = 0, finite = true;
  for (const x of out) { finite &&= Number.isFinite(x); peak = Math.max(peak, Math.abs(x)); }
  expect(finite).toBe(true);
  expect(peak).toBeLessThanOrEqual(CEILING);
  expect(peak).toBeGreaterThan(0.2);
});

test("Space at full on a hot, broken signal stays clamped and recovers from NaN", () => {
  const s = new Space(48000);
  s.setAmount(1);
  const buf = new Float32Array(48000 * 2);
  for (let i = 0; i < buf.length; i++) buf[i] = i % 7 === 0 ? 0.89 : -0.89;
  buf[1000] = NaN;
  s.process(buf, buf.slice(), buf.length / 2);
  for (const x of buf) { expect(Number.isFinite(x)).toBe(true); expect(Math.abs(x)).toBeLessThanOrEqual(CEILING); }
});

test("automation: lines between points, jumps for cuts, and the sequencer sends each change once", async () => {
  const { Sequencer, laneAt } = await import("../src/engine/sequencer.ts");
  const b = Float64Array.of(0, 4, 4, 5, 5), v = Float64Array.of(0.2, 0.6, 0, 0, 0.6);
  expect(laneAt(b, v, 2)).toBeCloseTo(0.4);
  expect(laneAt(b, v, 4.5)).toBe(0);   // inside the cut
  expect(laneAt(b, v, 5)).toBe(0.6);   // back
  expect(laneAt(b, v, 9)).toBe(0.6);   // held past the end
  const sent: number[] = [];
  const e = { setParam: (_t: number, i: number, x: number) => { if (i === 31) sent.push(x); }, setMute() {}, setMaster() {}, setTempo() {}, setBend() {}, noteOn() {}, noteOff() {}, allOff() {}, panic() {}, click() {}, render() {}, meter() {} };
  const s = new Sequencer(e, 1000);
  s.bpm = 60; s.setLoopBeats(8);
  s.setAuto(0, [{ i: 31, pts: [[0, 0.5], [2, 0.5], [2, 0], [3, 0], [3, 0.5]] }]);
  s.play();
  const out = new Float32Array(256);
  for (let f = 0; f < 4000; f += 128) s.process(out, 128);
  expect(sent[0]).toBe(0.5);
  expect(sent).toContain(0);
  expect(sent.at(-1)).toBe(0.5);
  expect(sent.length).toBe(3); // flat stretches send nothing
});

test("an old 8-track project loads with four silent tracks added", () => {
  const old = { ...demoProject(), tracks: demoProject().tracks.slice(0, 8) };
  const p = sanitize(old)!;
  expect(p.tracks.length).toBe(12);
  expect(p.tracks[11].params[31]).toBe(0);
  expect(p.tracks[0]).toEqual(sanitize(demoProject())!.tracks[0]);
});

test("track filters: the hi-cut darkens and the low-cut thins, and at 0 they leave the sound alone", () => {
  const level = (hicut: number, locut: number) => {
    const e = new TsEngine(48000);
    e.setMaster(1);
    e.setParam(0, P.GAIN, 0.5); e.setParam(0, P.ratio(0), 1); e.setParam(0, P.level(0), 1); e.setParam(0, P.sustain(0), 1);
    e.setParam(0, P.HICUT, hicut); e.setParam(0, P.LOCUT, locut);
    e.noteOn(0, 1, 93, 1); // A6, 1760 Hz
    const out = new Float32Array(48000);
    e.render(out, 24000);
    let s = 0; for (let i = 24000; i < out.length; i++) s += out[i] * out[i];
    return Math.sqrt(s / 24000);
  };
  const open = level(0, 0);
  expect(open).toBeGreaterThan(0.05);
  expect(level(0.7, 0)).toBeLessThan(open * 0.1);  // hi-cut down near 160 Hz
  expect(level(0, 0.9)).toBeLessThan(open * 0.1);  // low-cut up near 10 kHz
  expect(level(0.05, 0.05)).toBeGreaterThan(open * 0.9);
});

test("Long Trail: ten minutes that fit the project limits, and its opening plays clean", () => {
  const p = longTrail();
  expect(p.bars * 4 / p.bpm).toBeGreaterThan(9.5);
  const q = sanitize(p)!;
  q.tracks.forEach((t, i) => { expect(t.notes.length).toBe(p.tracks[i].notes.length); expect(t.auto).toEqual(p.tracks[i].auto); });
  const out = renderProject(new TsEngine(48000), p, 48000, 12, 1);
  let peak = 0, finite = true;
  for (const x of out) { finite &&= Number.isFinite(x); peak = Math.max(peak, Math.abs(x)); }
  expect(finite).toBe(true);
  expect(peak).toBeLessThanOrEqual(CEILING);
  expect(peak).toBeGreaterThan(0.05);
});
