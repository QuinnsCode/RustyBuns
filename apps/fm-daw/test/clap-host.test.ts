// A player's own CLAP plugin, hosted by the Rust engine (#5244): the desktop's native library is itself a `.clap`
// holding Test Tone, so the whole path (find it, open it, list it, start it, play it, move a slider) runs on it.
// The editor window itself is tried in the crate's own tests (src/clap/gui.rs), with a pretend editor swapped in.
// Skips (with a note) when the crate isn't built.
import { test, expect } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { candidates } from "@rustybuns/native";
import { openBundle, pluginFader, pluginFolders, scanPlugins, trackLevel } from "../src/engine/plugins.ts";
import { demoProject } from "../src/presets.ts";
import { apply, type Op } from "../src/project.ts";
import { levelOp, muteOp } from "../src/remote/remote.ts";
import { ownCopy, type PluginChoice } from "../src/plugin-track.ts";
import { findPlugins, renderPlugin, startPlugin, stopPlugin } from "../src/actions/plugins.ts";

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

test("a friend's groove plays this computer's own copy of the plugin, and without one says so", async () => {
  // the groove's maker keeps the plugin in their own folder; nobody else has that path
  const theirs = { path: "/Users/friend/Library/Audio/Plug-Ins/CLAP/Tone.clap", index: 0, name: "Tone", values: [] };
  const here: PluginChoice[] = [
    { path: "/Library/Audio/Plug-Ins/CLAP/Other.clap", index: 0, name: "Other", vendor: "", id: "com.example.other" },
    { path: "/Library/Audio/Plug-Ins/CLAP/Pack.clap", index: 3, name: "Tone", vendor: "", id: "com.example.tone" },
  ];
  expect(ownCopy({ ...theirs, id: "com.example.tone" }, here)).toBe(here[1]!);
  expect(ownCopy({ ...theirs, id: "com.example.missing" }, here)).toBeNull();
  expect(ownCopy(theirs, here)).toBeNull();                                         // a groove from before ids: the path is all it has
  expect(ownCopy(here[0]!, here)).toBe(here[0]!);
  // the same file name holding another plugin isn't a copy
  expect(ownCopy({ ...here[0]!, id: "com.example.tone" }, here)).toBe(here[1]!);

  if (!built) return console.log("  (rest skipped: cdylib not built; run `bun run build:native`)");
  const tone = (await findPlugins()).find((c) => c.name === "Test Tone")!;
  expect(tone.id).toBeTruthy();
  const started = await startPlugin(0, { ...theirs, id: tone.id }, SR);
  expect(started.error).toBeUndefined();
  expect(started.params.map((q) => q.name)).toEqual(["Level", "Shape"]);
  const block = await renderPlugin({ track: 0, frames: 512, events: [{ t: "on", key: 69, vel: 1 }] });
  expect(block.ok).toBe(true);
  expect(new Float32Array(Uint8Array.from(Buffer.from(block.pcm, "base64")).buffer).some((x) => Math.abs(x) > 0.01)).toBe(true);
  await stopPlugin(0);
  expect((await startPlugin(0, { ...theirs, id: "com.example.missing" }, SR)).error).toBe("Tone isn't on this computer");
});

test("a plugin track's fader and mute, from the desk or the remote, set the plugin's level in the mix", () => {
  // a plugin that plays a steady full-scale tone, so only the fader decides what the mix hears
  const fader = pluginFader((o, n) => { o.fill(1, 0, 2 * n); return true; });
  let p = demoProject();
  const t = 0;
  const level = (ops: Op[]) => {
    for (const op of ops) p = apply(p, op);
    fader.level(trackLevel(p, t));
    const out = new Float32Array(2 * SR);                         // a second: long enough for the fader to settle
    fader.mix(out, SR);
    return out[out.length - 1]!;
  };
  expect(level([levelOp(t, 0)])).toBe(0);
  expect(level([levelOp(t, 1)])).toBeCloseTo(1, 3);
  expect(level([levelOp(t, 0.5)])).toBeCloseTo(0.5, 3);
  expect(level([muteOp(t, true)])).toBeCloseTo(0, 3);
  expect(level([muteOp(t, false), { t: "track", track: 1, solo: true }])).toBeCloseTo(0, 3);
});

test("a plugin without an editor of its own says so, and turns no knobs itself", async () => {
  if (!built) return console.log("  (skipped: cdylib not built; run `bun run build:native`)");
  const b = await openBundle(built);
  if (typeof b === "string") throw new Error(b);
  const p = b.make(0, SR);
  if (typeof p === "string") throw new Error(p);
  expect(p.editor).toBeNull();
  expect(p.openEditor("Test Tone, track 1")).toBe("Test Tone has no editor of its own");
  p.noteOn(60, 1);
  p.render(new Float32Array(2 * 512), 512);
  expect(p.changes()).toEqual([]);
  p.free();
  expect(p.openEditor("again")).toBe("the plugin has stopped");
  expect(p.changes()).toEqual([]);
  b.close();
});

test("a file that isn't a plugin says why", async () => {
  if (!built) return console.log("  (skipped: cdylib not built; run `bun run build:native`)");
  const dir = mkdtempSync(join(tmpdir(), "clap-"));
  const junk = join(dir, "Broken.clap");
  writeFileSync(junk, "not a library");
  expect(await openBundle(junk)).toContain("couldn't load");
  expect(await openBundle(join(dir, "Gone.clap"))).toContain("couldn't load");
});

test("plugin folders follow the CLAP and VST3 specs per OS, CLAP_PATH first", () => {
  expect(pluginFolders("darwin", { CLAP_PATH: "/a:/b" }, "/Users/q")).toEqual(["/a", "/b",
    "/Users/q/Library/Audio/Plug-Ins/CLAP", "/Library/Audio/Plug-Ins/CLAP", "/Users/q/Library/Audio/Plug-Ins/VST3", "/Library/Audio/Plug-Ins/VST3"]);
  expect(pluginFolders("linux", {}, "/home/q")).toEqual(["/home/q/.clap", "/usr/lib/clap", "/home/q/.vst3", "/usr/lib/vst3", "/usr/local/lib/vst3"]);
  expect(pluginFolders("win32", { COMMONPROGRAMFILES: "C:/Common", LOCALAPPDATA: "C:/Local" }, "C:/q").filter((d) => d.endsWith("VST3")).length).toBe(2);
});
