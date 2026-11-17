// A singer's mic and the wedge at her feet, as a monitor engineer meets them: push the send for "more me" and it rings
// at the mic's presence peak; a notch there, or turning the wedge off the mic, stops it.
import { expect, test } from "bun:test";
import { type EqBand, type Mic, feedback, pickup, source } from "../src/index.ts";

// The mic in front of the singer's mouth pointing back at her; the wedge on the floor a metre out, aimed up at her head.
const mic: Mic = { pos: { x: 0, y: 1.6, z: 1.75 }, yaw: Math.PI, pitch: 0, pattern: "cardioid" };
const wedge = (turn = 0) => source("wedge-12", { x: 0, y: 0.2, z: 2.7 }, { yaw: Math.PI + turn, pitch: 0.85 });
const loop = (sendDb: number, o: { turn?: number; eq?: EqBand[]; mic?: Partial<Mic> } = {}) =>
  feedback({ mic: { ...mic, ...o.mic }, gainDb: 0, eq: o.eq ?? [], wedges: [{ wedge: wedge(o.turn), sendDb }] });

test("more send rings at the presence peak; a notch there or turning the wedge stops it", () => {
  expect(loop(4).ringing).toEqual([]);
  const pushed = loop(8);
  expect(pushed.ringing).toEqual([5000]);
  expect(pushed.margin).toBeLessThan(0);
  expect(loop(8, { eq: [{ hz: 5000, db: -9, q: 4 }] }).ringing).toEqual([]);
  // A notch a band off does nothing for it.
  expect(loop(8, { eq: [{ hz: 2500, db: -9, q: 4 }] }).ringing).toEqual([5000]);
  expect(loop(8, { turn: 0.6 }).ringing).toEqual([]);
});

test("each step of send is a dB of loop gain, and a mic pointed at the wedge or an omni has far less to give", () => {
  expect(loop(5).margin - loop(6).margin).toBeCloseTo(1, 6);
  const atWedge = loop(0, { mic: { yaw: 0, pitch: -0.9 } });
  expect(atWedge.ringing.length).toBeGreaterThan(0);
  expect(loop(0, { mic: { pattern: "omni" } }).margin).toBeLessThan(loop(0).margin - 6);
  // A cardioid's back hears the low mids better than the highs, as a real one does.
  expect(pickup("cardioid", 0.75 * Math.PI, 125)).toBeGreaterThan(pickup("cardioid", 0.75 * Math.PI, 4000));
});
