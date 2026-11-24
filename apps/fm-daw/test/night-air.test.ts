// The desert night under the music (src/studio/night-air.ts): crickets in trains of chirps at their pitch, a few a
// second, never a clock; the generator's hum louder as you walk up to it, 6 dB down each time the distance doubles.
import { expect, test } from "bun:test";
import { chirps, crackle, fireLevel, humLevel } from "../src/studio/night-air.ts";

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

test("the fire crackles: sharp pops over a quiet roar, loud at the pit and fading as you walk off", () => {
  const x = crackle(48000, 4, 7);
  let pops = 0, last = -1;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]!) > 0.15 && i - last > 480) { pops++; last = i; }
  expect(pops / 4).toBeGreaterThan(4); // several clear pops a second
  expect(fireLevel(1) / fireLevel(12)).toBeGreaterThan(7); // 18 dB down across the floor
});
