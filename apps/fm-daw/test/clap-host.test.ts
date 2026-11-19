// A player's own CLAP plugin, hosted by the Rust engine (#5244): the desktop's native library is itself a `.clap`
// holding Test Tone, so the whole path (find it, open it, list it, start it, play it, move a slider) runs on it.
// Skips (with a note) when the crate isn't built.
import { test, expect } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { candidates } from "@rustybuns/native";
import { openBundle, pluginFolders, scanPlugins } from "../src/engine/plugins.ts";

const SR = 48000;
const built = candidates("fm_daw", {}).find(existsSync);

const peak = (render: (out: Float32Array, n: number) => boolean) => {
  const out = new Float32Array(2 * 4800);
  expect(render(out, 4800)).toBe(true);
  return out.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
};

test("a plugin found in the CLAP folder plays notes and its sliders move it", async () => {
  if (!built) return console.log("  (skipped: cdylib not built; run `bun run build:native`)");
  const home = mkdtempSync(join(tmpdir(), "clap-"));
  const folder = join(home, "Plug-Ins", "Synths");
  mkdirSync(folder, { recursive: true });
  copyFileSync(built, join(folder, "Test Tone.clap"));
  writeFileSync(join(folder, "readme.txt"), "not a plugin");

  const [path, ...rest] = scanPlugins([join(home, "Plug-Ins"), join(home, "missing")]);
  expect(rest).toEqual([]);
  const b = await openBundle(path!);
  if (typeof b === "string") throw new Error(b);
  expect(b.plugins.map((p) => [p.name, p.features])).toEqual([["Test Tone", ["instrument", "synthesizer"]]]);

  const p = b.make(0, SR);
  if (typeof p === "string") throw new Error(p);
  b.close(); // the plugin keeps its library
  expect(p.params().map((q) => [q.name, q.value, q.stepped])).toEqual([["Level", 0.8, false], ["Shape", 0, true]]);

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
  p.free();
  expect(p.render(new Float32Array(2), 1)).toBe(false);
});

test("a file that isn't a plugin says why", async () => {
  if (!built) return console.log("  (skipped: cdylib not built; run `bun run build:native`)");
  const dir = mkdtempSync(join(tmpdir(), "clap-"));
  const junk = join(dir, "Broken.clap");
  writeFileSync(junk, "not a library");
  expect(await openBundle(junk)).toContain("couldn't load");
  expect(await openBundle(join(dir, "Gone.clap"))).toContain("couldn't load");
});

test("plugin folders follow the CLAP spec per OS, CLAP_PATH first", () => {
  expect(pluginFolders("darwin", { CLAP_PATH: "/a:/b" }, "/Users/q")).toEqual(["/a", "/b", "/Users/q/Library/Audio/Plug-Ins/CLAP", "/Library/Audio/Plug-Ins/CLAP"]);
  expect(pluginFolders("linux", {}, "/home/q")).toEqual(["/home/q/.clap", "/usr/lib/clap"]);
  expect(pluginFolders("win32", { COMMONPROGRAMFILES: "C:/Common", LOCALAPPDATA: "C:/Local" }, "C:/q").length).toBe(2);
});
