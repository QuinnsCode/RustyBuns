import { describe, expect, test } from "bun:test";
import { analyze } from "../src/analyze.ts";

const RATE = 22050;

/** A click track: short decaying bursts of noise on every beat, over a quiet hum. */
function clicks(bpm: number, seconds: number, gain = 0.8): Float32Array {
  const out = new Float32Array(RATE * seconds);
  const every = Math.round((RATE * 60) / bpm);
  let seed = 1;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < out.length; i++) {
    const t = i % every;
    out[i] = 0.02 * Math.sin((2 * Math.PI * 220 * i) / RATE) + (t < 2000 ? gain * noise() * Math.exp(-t / 300) : 0);
  }
  return out;
}

const sine = (hz: number, seconds: number, amp = 0.5) =>
  Float32Array.from({ length: RATE * seconds }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / RATE));

describe("analyze", () => {
  test("finds the tempo of a click track", () => {
    for (const bpm of [90, 120, 150]) {
      const f = analyze(clicks(bpm, 20), RATE);
      expect(Math.abs(f.bpm - bpm)).toBeLessThanOrEqual(3);
      expect(f.pulse).toBeGreaterThan(0.3);
    }
  });

  test("a low sine is all bass and dark; a high one is neither", () => {
    const low = analyze(sine(60, 5), RATE), high = analyze(sine(4000, 5), RATE);
    expect(low.bass).toBeGreaterThan(0.8);
    expect(high.bass).toBeLessThan(0.05);
    expect(low.brightness).toBeLessThan(high.brightness);
  });

  test("a steady tone is brickwalled, loud-then-silent is dynamic", () => {
    expect(analyze(sine(440, 5), RATE).dynamicsDb).toBeLessThan(1);
    const swell = Float32Array.from({ length: RATE * 6 }, (_, i) => (i / (RATE * 6)) ** 3 * Math.sin((2 * Math.PI * 440 * i) / RATE));
    expect(analyze(swell, RATE).dynamicsDb).toBeGreaterThan(15);
  });

  test("measures length, level and silence", () => {
    const half = new Float32Array(RATE * 4);
    half.set(sine(440, 2, 1), 0);
    const f = analyze(half, RATE);
    expect(f.durationSec).toBe(4);
    expect(f.silence).toBeGreaterThan(0.35);
    expect(analyze(sine(440, 2, 1), RATE).loudnessDb).toBeCloseTo(-3, 0);
  });

  test("refuses a blip", () => {
    expect(() => analyze(new Float32Array(100), RATE)).toThrow();
  });
});
