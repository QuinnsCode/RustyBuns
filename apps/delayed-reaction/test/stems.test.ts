import { expect, test } from "bun:test";
import { fromSearch } from "../src/scenario.ts";
import { kicks, levels, offGrid, width, wav, lowShare } from "../src/stems.ts";

const RATE = 44100;
// A kick drum, roughly: a falling sine every `every` seconds, starting `at` seconds in.
function train(seconds: number, every: number, at = 0, gain = 0.8) {
  const l = new Float32Array(Math.round(seconds * RATE));
  for (let t = at; t < seconds; t += every) for (let i = 0; i < 0.2 * RATE; i++) {
    const k = Math.round(t * RATE) + i;
    if (k < l.length) l[k] = (l[k] ?? 0) + gain * Math.sin(2 * Math.PI * 55 * (i / RATE)) * Math.exp(-i / (0.05 * RATE));
  }
  return { l, r: l.slice(), rate: RATE };
}

test("a steady kick train sits on its grid; one that drifts does not", () => {
  const steady = train(8, 0.5, 0.25), found = kicks(steady.l, RATE);
  expect(found.length).toBe(16);
  expect(offGrid(found, 120, 0.25)).toBeLessThan(3);
  const loose = train(8, 0.5 * 1.01, 0.25);
  expect(offGrid(kicks(loose.l, RATE), 120, 0.25)).toBeGreaterThan(10);
});

test("levels count clipping, width tells mono from wide, lowShare tells sub from air", () => {
  const hot = train(1, 1, 0, 1.4);
  expect(levels(hot).clipped).toBeGreaterThan(0);
  expect(levels(train(1, 1)).clipped).toBe(0);
  const kick = train(1, 1);
  expect(width(kick)).toBeLessThan(-100);
  const wide = { ...kick, r: kick.l.map((v) => -v) };
  expect(width(wide)).toBeGreaterThan(40);
  const hiss = new Float32Array(RATE).map((_, i) => Math.sin(i * 2.5));
  expect(lowShare(kick.l, RATE, 120)).toBeGreaterThan(0.8);
  expect(lowShare(hiss, RATE, 120)).toBeLessThan(0.05);
});

test("a WAV has the header and length a player expects", () => {
  const out = wav(train(0.5, 1)), v = new DataView(out.buffer);
  expect(String.fromCharCode(...out.slice(0, 4))).toBe("RIFF");
  expect([v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true)]).toEqual([2, RATE, 32]);
  expect(out.length).toBe(44 + Math.round(0.5 * RATE) * 8);
});

test("a link can ask to hear one stem, and a wrong stem is dropped", () => {
  expect(fromSearch("?level=3&stem=bass")?.stem).toBe("bass");
  expect(fromSearch("?stem=drums")?.stem).toBe("drums");
  expect(fromSearch("?level=3&stem=banjo")?.stem).toBeUndefined();
});
