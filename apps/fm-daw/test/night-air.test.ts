// The desert night under the music (src/studio/night-air.ts): crickets in trains of chirps at their pitch, a few a
// second, never a clock; the generator's hum louder as you walk up to it, 6 dB down each time the distance doubles.
import { expect, test } from "bun:test";
import { chirps, humLevel } from "../src/studio/night-air.ts";

test("crickets chirp in trains near 4.4 kHz, a train every 0.7 to 1 s; the generator's hum falls 6 dB per doubling past 3 m", () => {
  const rate = 48000, c = chirps(rate, 6, 1);
  // the trains: runs of sound with silence between, their starts 0.7 to 0.95 s apart
  const starts: number[] = [];
  let quiet = rate;
  for (let i = 0; i < c.length; i++) {
    if (Math.abs(c[i]!) > 1e-3) { if (quiet > rate * 0.3) starts.push(i / rate); quiet = 0; } else quiet++;
  }
  expect(starts.length).toBeGreaterThanOrEqual(5);
  for (let k = 1; k < starts.length; k++) {
    expect(starts[k]! - starts[k - 1]!).toBeGreaterThan(0.69);
    expect(starts[k]! - starts[k - 1]!).toBeLessThan(1.1);
  }
  // within a chirp, the pitch: zero crossings over its 14 ms
  const from = Math.round(starts[0]! * rate), len = Math.round(rate * 0.014);
  let crossings = 0;
  for (let i = from + 1; i < from + len; i++) if (Math.sign(c[i]!) !== Math.sign(c[i - 1]!) && c[i] !== 0) crossings++;
  const hz = crossings / 2 / 0.014;
  expect(hz).toBeGreaterThan(4000);
  expect(hz).toBeLessThan(4800);
  expect(humLevel(1)).toBe(humLevel(3));
  expect(20 * Math.log10(humLevel(12) / humLevel(6))).toBeCloseTo(-6.02, 1);
});
