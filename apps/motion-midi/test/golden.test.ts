// Rust and TS must render the same song to the same audio. Skips (with a note)
// when the cdylib isn't built, so contributors without Rust stay green.
import { test, expect } from "bun:test";
import demo from "../songs/demo.json";
import { compileSong, type SongJson } from "../src/engine/song.ts";
import { TsEngine } from "../src/engine/engine.ts";
import { bounce } from "../src/engine/bounce.ts";
import { createRustEngine } from "../src/engine/native.ts";

const song = compileSong(demo as SongJson);

test("ts engine renders the demo song, finite and non-silent", () => {
  const r = bounce(new TsEngine(song), 44100);
  expect(r.frames).toBeGreaterThan(44100 * 20);
  let peak = 0, finite = true;
  for (const x of r.audio) { finite &&= Number.isFinite(x); peak = Math.max(peak, Math.abs(x)); }
  expect(finite).toBe(true);
  expect(peak).toBeGreaterThan(0.1);
  expect(peak).toBeLessThanOrEqual(1);
});

test("rust matches ts sample for sample", async () => {
  const rust = await createRustEngine(song);
  if (!rust) { console.log("  (skipped: motion_midi not built; run `bun run build:native`)"); return; }
  const a = bounce(rust, 44100), b = bounce(new TsEngine(song), 44100);
  expect(a.frames).toBe(b.frames);
  let maxDiff = 0;
  for (let i = 0; i < a.audio.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a.audio[i] - b.audio[i]));
  console.log(`  max |rust - ts| = ${maxDiff.toExponential(2)} over ${a.frames} frames`);
  expect(maxDiff).toBeLessThan(1e-4);
});

test("rust rejects a malformed song instead of crashing", async () => {
  const rust = await createRustEngine(song);
  if (!rust) return;
  rust.free?.();
  await expect(createRustEngine(new Float32Array([9, 44100, 1]))).rejects.toThrow("rejected");
});
