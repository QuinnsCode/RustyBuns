// The effects loop's machines (src/circuit/machines.ts): what makes each one
// sound like the machine, checked on what comes out.
import { expect, setDefaultTimeout, test } from "bun:test";
import { Bbd, SpringReverb, TapeEcho } from "../src/circuit/machines.ts";

setDefaultTimeout(60_000);
const SR = 48000;

/** Where a burst's energy arrives, in seconds after `from`: the centre of the squared output's mass. */
function arrival(out: Float64Array, from: number, to: number): number {
  let e = 0, et = 0;
  for (let i = from; i < to; i++) { e += out[i] ** 2; et += out[i] ** 2 * (i - from); }
  return et / e / SR;
}

test("spring: the tank holds low notes back longer than high ones (the chirp)", () => {
  // A short tone burst at each pitch, through the wet path only; its first echo comes later when low.
  const first = (hz: number) => {
    const r = new SpringReverb(SR);
    r.set({ kind: "spring", dwell: 3, mix: 10 });
    const n = SR / 5, out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const x = i < SR * 0.004 ? 0.3 * Math.sin((2 * Math.PI * hz * i) / SR) * Math.sin((Math.PI * i) / (SR * 0.004)) : 0;
      out[i] = r.run(x) - x;
    }
    return arrival(out, 0, Math.round(SR * 0.09));
  };
  expect(first(200)).toBeGreaterThan(first(2500) + 0.01);
});

test("tape: turning Time glides the echo's pitch, and a runaway saturates instead of growing", () => {
  const t = new TapeEcho(SR);
  t.set({ kind: "tape", time: 0, repeats: 10, mix: 10, heads: [1, 3] });
  let peak = 0;
  for (let i = 0; i < SR * 4; i++) {
    const y = t.run(i < SR / 4 ? 0.5 * Math.sin((2 * Math.PI * 220 * i) / SR) : 0);
    if (i === SR) t.set({ kind: "tape", time: 10, repeats: 10, mix: 10, heads: [1, 3] });
    // A quarter-second after the turn the motor is still on its way down.
    if (i === SR + SR / 4) expect(t.tapeSpeed).toBeLessThan(0.19 * 0.75);
    if (i === SR + SR / 4) expect(t.tapeSpeed).toBeGreaterThan(0.19 / 4 * 1.2);
    if (i > SR * 3) peak = Math.max(peak, Math.abs(y));
    expect(Number.isFinite(y)).toBe(true);
  }
  // Still echoing three seconds on (it ran away), but held under a few volts by the rails and the tape.
  expect(peak).toBeGreaterThan(0.1);
  expect(peak).toBeLessThan(4);
});

test("bucket brigade: the delay is the stages over twice the clock, and the compander gives back each level it took", () => {
  // 4096 stages clocked for 60 ms, no repeats; a 40 ms note at a whisper and at full line level.
  for (const level of [0.01, 1]) {
    const b = new Bbd(SR);
    b.set({ kind: "bbd", mode: "delay", rate: 0, depth: 0 });
    expect(b.delaySeconds()).toBeCloseTo(0.06, 6);
    const n = SR / 5, out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const x = i < SR * 0.04 ? level * Math.sin((2 * Math.PI * 440 * i) / SR) : 0;
      out[i] = b.run(x) - x;
    }
    // The echo's middle lands 60 ms after the note's middle.
    expect(arrival(out, 0, n)).toBeCloseTo(0.02 + 0.06, 2);
    let peak = 0;
    for (let i = Math.round(SR * 0.08); i < Math.round(SR * 0.095); i++) peak = Math.max(peak, Math.abs(out[i]));
    expect(peak / level / 0.6).toBeCloseTo(1, 1); // the wet is 0.6 of the dry
  }
});
