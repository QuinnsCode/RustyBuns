// The drum machine, Space and the liquid song: grooves land where they say,
// a kit swap keeps the pattern, and the whole song through Space stays under
// the ceiling.
import { test, expect, setDefaultTimeout } from "bun:test";
import { GROOVES, KITS, applyGroove, applyKit, laneNotes } from "../src/drums.ts";
import { nebulaDrift } from "../src/songs.ts";
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

test("Nebula Drift through Space: audible, finite, under the ceiling", () => {
  const p = nebulaDrift();
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
  s.process(buf, buf.length / 2);
  for (const x of buf) { expect(Number.isFinite(x)).toBe(true); expect(Math.abs(x)).toBeLessThanOrEqual(CEILING); }
});
