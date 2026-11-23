// A player's own VST3 plugin, hosted by the Rust engine behind the CLAP host's surface (#5268): the desktop's native
// library also exports `GetPluginFactory` holding Test Tone (VST3), so it is laid out as a `.vst3` bundle the way an
// installer leaves one, found, opened, started, played and moved from here exactly as a CLAP is. The host's own
// pieces (the processor and controller kept in step, the ids) are tried in the crate's tests, run at the end.
// Skips (with a note) when the crate isn't built.
import { test, expect, setDefaultTimeout } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { candidates } from "@rustybuns/native";
import { openBundle, scanPlugins } from "../src/engine/plugins.ts";

setDefaultTimeout(300_000); // the cargo run compiles the crate's tests the first time

const SR = 48000;
const built = candidates("fm_daw", {}).find(existsSync);

/** Where a `.vst3` bundle keeps its library on this OS. */
function inside(bundle: string): string {
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  if (process.platform === "darwin") return join(bundle, "Contents", "MacOS", "Test Tone");
  if (process.platform === "win32") return join(bundle, "Contents", `${arch === "aarch64" ? "arm64" : arch}-win`, "Test Tone.vst3");
  return join(bundle, "Contents", `${arch}-linux`, "Test Tone.so");
}

const peak = (render: (out: Float32Array, n: number) => boolean) => {
  const out = new Float32Array(2 * 4800);
  expect(render(out, 4800)).toBe(true);
  return out.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
};

test("a VST3 found in the VST3 folder plays notes and its sliders move it, as a CLAP does", async () => {
  if (!built) return console.log("  (skipped: cdylib not built; run `bun run build:native`)");
  const home = mkdtempSync(join(tmpdir(), "vst3-"));
  const bundle = join(home, "VST3", "Synths", "Test Tone.vst3");
  mkdirSync(dirname(inside(bundle)), { recursive: true });
  copyFileSync(built, inside(bundle));

  expect(scanPlugins([join(home, "VST3")])).toEqual([bundle]); // the bundle, not the library inside it
  const b = await openBundle(bundle);
  if (typeof b === "string") throw new Error(b);
  expect(b.plugins.map((p) => [p.name, p.vendor, p.features])).toEqual([["Test Tone (VST3)", "RustyBuns", ["instrument", "synth"]]]);
  expect(b.plugins[0]!.id).toMatch(/^[0-9A-F]{32}$/); // its class id: what a friend's groove finds it by

  const p = b.make(0, SR);
  if (typeof p === "string") throw new Error(p);
  b.close(); // the plugin keeps its library
  // the controller learned the processor's settings; a stepped one is 0..steps, like a CLAP switch
  expect(p.params().map((q) => [q.name, q.value, q.max, q.stepped])).toEqual([["Level", 0.8, 1, false], ["Shape", 0, 1, true]]);

  const play = (o: Float32Array, n: number) => p.render(o, n);
  expect(peak(play)).toBe(0);
  p.noteOn(69, 1);
  expect(peak(play)).toBeGreaterThan(0.1);
  p.setParam(0, 0);
  expect(peak(play)).toBe(0);
  p.setParam(0, 1);
  p.setParam(1, 1);
  expect(peak(play)).toBeCloseTo(0.25, 5); // one square voice at full level
  expect(p.params().map((q) => q.value)).toEqual([1, 1]);
  p.noteOff(69);
  expect(peak(play)).toBe(0);

  expect(p.editor).toBeNull();
  // its controller makes no view (and off macOS FM DAW has no window to hold one yet)
  expect(p.openEditor("Test Tone, track 1")).toContain(process.platform === "darwin" ? "has no editor of its own" : "macOS for now");
  expect(p.changes()).toEqual([]);
  p.free();
  expect(p.render(new Float32Array(2), 1)).toBe(false);
});

test("the host's own VST3 pieces pass the crate's tests", () => {
  if (!Bun.which("cargo")) return console.log("  (skipped: no cargo)");
  const r = Bun.spawnSync(["cargo", "test", "--quiet", "--manifest-path", "native/Cargo.toml", "--lib", "--", "vst3::", "hosted::"], {
    cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe",
  });
  if (r.exitCode !== 0) throw new Error(`cargo test failed:\n${r.stdout.toString()}\n${r.stderr.toString()}`);
});
