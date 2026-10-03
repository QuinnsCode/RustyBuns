import { test, expect } from "bun:test";
import { Sequencer, swingWarp } from "../src/engine/sequencer.ts";
import { quantize } from "../src/quantize.ts";
import type { FmEngine } from "../src/engine/engine.ts";

function spy() {
  const log: string[] = [];
  const e: FmEngine = {
    setParam() {}, setMute() {}, setMaster() {}, allOff() {}, panic() {}, render() {}, meter() {},
    noteOn: (t, id, m) => log.push(`on ${t} ${m}`),
    noteOff: (t) => log.push(`off ${t}`),
    click: (a) => log.push(a ? "CLICK" : "click"),
  };
  return { e, log };
}

const run = (s: Sequencer, seconds: number) => { const out = new Float32Array(256); for (let f = 0; f < seconds * s.sr; f += 128) s.process(out, 128); };

test("swing leaves downbeats alone and delays the off-16th", () => {
  expect(swingWarp(0, 0.3)).toBe(0);
  expect(swingWarp(0.5, 0.3)).toBe(0.5);
  expect(swingWarp(0.25, 0.3)).toBeCloseTo(0.325);
  expect(swingWarp(0.75, 0)).toBe(0.75);
});

test("loops: a note at beat 0 of a 1-beat loop fires once per beat", () => {
  const { e, log } = spy();
  const s = new Sequencer(e, 1000);
  s.bpm = 60; s.setLoopBeats(1);
  s.setNotes(0, [{ s: 0, l: 0.5, m: 60, v: 1 }]);
  s.play();
  run(s, 3.05);
  expect(log.filter((x) => x.startsWith("on")).length).toBe(4);
  expect(log.filter((x) => x.startsWith("off")).length).toBe(3);
});

test("count-in clicks four times, then the pattern starts", () => {
  const { e, log } = spy();
  const s = new Sequencer(e, 1000);
  s.bpm = 60; s.setLoopBeats(4);
  s.setNotes(0, [{ s: 0, l: 0.5, m: 60, v: 1 }]);
  s.play(4);
  run(s, 3.9);
  expect(log.filter((x) => x.startsWith("on")).length).toBe(0);
  expect(log.filter((x) => x.toLowerCase() === "click").length).toBe(4);
  run(s, 0.2);
  expect(log.filter((x) => x.startsWith("on")).length).toBe(1);
});

test("recording places a held key at the loop position, minus latency", () => {
  const { e } = spy();
  const s = new Sequencer(e, 1000);
  s.bpm = 120; s.setLoopBeats(4); s.recording = true; s.latency = 0.05;
  const got: { s: number; l: number }[] = [];
  s.onRecord = (r) => got.push(r.note);
  s.play();
  run(s, 0.5);         // beat 1
  s.liveOn(5, 60, 0.8);
  run(s, 0.25);        // half a beat
  s.liveOff(5, 60);
  expect(got.length).toBe(1);
  expect(got[0].s).toBeCloseTo(1 - 0.1, 1);
  expect(got[0].l).toBeCloseTo(0.5, 1);
});

test("stop releases every sequenced note", () => {
  const { e, log } = spy();
  const s = new Sequencer(e, 1000);
  s.bpm = 60; s.setLoopBeats(4);
  s.setNotes(0, [{ s: 0, l: 3, m: 60, v: 1 }]);
  s.play(); run(s, 0.5); s.stop();
  expect(log.filter((x) => x.startsWith("off")).length).toBe(1);
});

test("quantize: full strength snaps, half strength keeps feel, wraps at the loop end", () => {
  const n = [{ s: 0.3, l: 0.25, m: 60, v: 1 }, { s: 3.95, l: 0.25, m: 62, v: 1 }];
  expect(quantize(n, 0.25, 1, 4).map((x) => x.s)).toEqual([0, 0.25]);
  const half = quantize(n, 0.25, 0.5, 4).map((x) => x.s);
  expect(half[0]).toBeCloseTo(0.275);
  expect(half[1]).toBeCloseTo(3.975);
  expect(quantize([{ s: 0.01, l: 1, m: 60, v: 0.5 }, { s: 0, l: 1, m: 60, v: 0.9 }], 0.25, 1, 4)).toEqual([{ s: 0, l: 1, m: 60, v: 0.9 }]);
});
