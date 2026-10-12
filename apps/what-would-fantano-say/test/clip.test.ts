import { expect, test } from "bun:test";
import { CLIP_SECONDS, RATE, cut, encodeWav, loudestWindow, peaks } from "../src/clip.ts";
import { MAX_CLIP } from "../src/review.ts";

const song = (seconds: number, loudAt: number) =>
  Float32Array.from({ length: RATE * seconds }, (_, i) => (Math.abs(i / RATE - loudAt) < 5 ? 0.9 : 0.05) * Math.sin(i / 3));

test("the default window lands on the loud part", () => {
  const start = loudestWindow(song(120, 60), RATE);
  expect(start).toBeGreaterThan(60 - CLIP_SECONDS);
  expect(start).toBeLessThan(60);
});

test("a song shorter than the window starts at 0", () => {
  expect(loudestWindow(song(8, 4), RATE)).toBe(0);
});

test("cut stays inside the song", () => {
  const s = song(30, 10);
  expect(cut(s, RATE, 25).length).toBe(CLIP_SECONDS * RATE);
  expect(cut(s, RATE, -5)[0]).toBe(s[0]);
  expect(cut(song(5, 1), RATE, 0).length).toBe(5 * RATE);
});

test("a full clip encodes to a WAV that fits under the server's cap", () => {
  const wav = encodeWav(cut(song(60, 30), RATE, 20), RATE);
  expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe("RIFF");
  expect(new DataView(wav.buffer).getUint32(24, true)).toBe(RATE);
  const dataUrl = "data:audio/wav;base64," + Buffer.from(wav).toString("base64");
  expect(dataUrl.length).toBeLessThanOrEqual(MAX_CLIP);
});

test("peaks are normalised", () => {
  const p = peaks(song(20, 10), 50);
  expect(p.length).toBe(50);
  expect(Math.max(...p)).toBe(1);
});
