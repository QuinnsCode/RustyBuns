import { test, expect } from "bun:test";
import { Squash } from "../src/engine/squash.ts";
import { CEILING } from "../src/engine/params.ts";

const SR = 48000;
const sine = (amp: number, hz: number) => {
  const b = new Float32Array(SR * 2);
  for (let f = 0; f < SR; f++) b[f * 2] = b[f * 2 + 1] = amp * Math.sin((2 * Math.PI * hz * f) / SR);
  return b;
};
const rms = (b: Float32Array) => { let s = 0; for (let i = SR; i < b.length; i++) s += b[i] * b[i]; return Math.sqrt(s / (b.length - SR)); };

test("squash: quiet parts come up, loud ones come down and stay under the ceiling, 0 leaves the mix alone", () => {
  for (const [amp, hz, amount, move] of [[0.003, 1000, 1, "up"], [0.85, 80, 1, "down"], [0.85, 5000, 1, "down"], [0.3, 440, 0, "same"]] as const) {
    const before = sine(amp, hz), after = before.slice();
    const s = new Squash(SR);
    s.setAmount(amount);
    s.process(after, SR);
    const ratio = rms(after) / rms(before);
    let peak = 0;
    for (const x of after) peak = Math.max(peak, Math.abs(x));
    expect({ amp, hz, move, ok: peak <= CEILING && (move === "up" ? ratio > 1.8 : move === "down" ? ratio < 0.9 : ratio === 1) })
      .toEqual({ amp, hz, move, ok: true });
  }
});
