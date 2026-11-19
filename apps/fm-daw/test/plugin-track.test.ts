// A plugin track (#5265): the desk puts a hosted CLAP plugin on a track, the track's notes go to it on the desktop
// host, and its sound comes back into the worklet's mix at the track's fader. The page's pump (src/ui/plugins.ts)
// carries it both ways, as in the app. The first test's host is a stand-in that plays a steady tone while a key is
// down, so only the routing decides what's heard; the second runs Test Tone, the desk's own native library, for real.
import { test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { candidates } from "@rustybuns/native";
import { SR, posted, processor, run, useWorklet, type Proc } from "./worklet-kit.ts";
import { PluginPump } from "../src/ui/plugins.ts";
import { loadMsg } from "../src/ui/load.ts";
import { demoProject } from "../src/presets.ts";
import { apply, audible, type Op, type Project } from "../src/project.ts";
import { P } from "../src/engine/params.ts";
import { PluginAskArgs, withValue, type BlockReply, type PluginEvent, type TrackPlugin } from "../src/plugin-track.ts";
import type { ToWorklet } from "../src/engine/messages.ts";

useWorklet();

const b64 = (a: Float32Array) => Buffer.from(a.buffer).toString("base64");

/** The page, the worklet and a host, run together: ops change the groove, `play` runs the audio and carries the asks. */
function desk(host: ConstructorParameters<typeof PluginPump>[2], plugin: TrackPlugin, onChanges?: ConstructorParameters<typeof PluginPump>[3]) {
  const { p, say } = processor();
  let proj: Project = apply(demoProject(), { t: "plugin", track: 0, plugin });
  const pump = new PluginPump((m: ToWorklet) => say(m), SR, host, onChanges);
  say(loadMsg(proj));
  say({ t: "master", gain: 1 });
  pump.sync(proj);
  let seen = 0;
  return {
    p, say, pump,
    get project() { return proj; },
    op(o: Op, msg?: ToWorklet) { proj = apply(proj, o); if (msg) say(msg); pump.sync(proj); },
    /** `seconds` of the left side, the asks on the way carried to the host and back as the page would. */
    async play(seconds: number): Promise<Float32Array> {
      const out = new Float32Array(Math.round(seconds * SR));
      const step = 512;
      for (let at = 0; at < out.length; at += step) {
        out.set((await run(p as Proc, step / SR)).subarray(0, Math.min(step, out.length - at)), at);
        for (; seen < posted.length; seen++) { const m = posted[seen]!; if (m.t === "pluginAsk") pump.ask(m); }
        for (let i = 0; i < 8; i++) await Promise.resolve();
      }
      return out;
    },
  };
}
const last = (a: Float32Array) => a[a.length - 1]!;

test("a plugin track plays its notes through the plugin at its fader; one that fails goes quiet and the mix plays on", async () => {
  const heard: PluginEvent[] = [];
  const down = new Set<number>();
  let failing = false, turned: { id: number; value: number }[] = [];
  const edited: { track: number; id: number; value: number }[] = [];
  const host = {
    startPlugin: async () => ({ params: [{ id: 7, name: "Level", module: "", min: 0, max: 1, default: 0.8, value: 0.8, stepped: false }], editor: true }),
    openPluginEditor: async () => ({}),
    renderPlugin: async (args: unknown): Promise<BlockReply> => {
      const a = PluginAskArgs(args);
      for (const e of a.events) { heard.push(e); if (e.t === "on") down.add(e.key); if (e.t === "off") down.delete(e.key); }
      if (failing) return { pcm: "", ok: false, error: "Steady stopped working" };
      const changes = turned; turned = [];
      return { pcm: b64(new Float32Array(2 * a.frames).fill(down.size ? 0.5 : 0)), ok: true, ...(changes.length ? { changes } : {}) };
    },
    stopPlugin: async () => {},
  };
  const d = desk(host, { path: "/plugins/Steady.clap", index: 0, name: "Steady", values: [] }, (track, cs) => { for (const c of cs) edited.push({ track, ...c }); });
  d.op({ t: "param", track: 0, i: P.GAIN, v: 0.5 }, { t: "param", track: 0, i: P.GAIN, v: 0.5 });

  expect(last(await d.play(0.2))).toBe(0);                          // nothing played, nothing heard (no FM voice either)
  expect(d.pump.state.get(0)?.params.map((q) => q.name)).toEqual(["Level"]);   // its sliders are the track's

  d.say({ t: "on", track: 0, midi: 69, vel: 1 });
  expect(last(await d.play(0.3))).toBeCloseTo(0.25, 3);             // the plugin's 0.5 at the fader's 0.5, and only that
  expect(heard).toContainEqual({ t: "on", key: 69, vel: 1 });

  d.op({ t: "param", track: 0, i: P.GAIN, v: 1 }, { t: "param", track: 0, i: P.GAIN, v: 1 });
  expect(last(await d.play(0.3))).toBeCloseTo(0.5, 3);
  d.op({ t: "track", track: 0, mute: true }, { t: "audible", mask: audible(apply(d.project, { t: "track", track: 0, mute: true })) });
  expect(Math.abs(last(await d.play(0.3)))).toBeLessThan(1e-3);
  d.op({ t: "track", track: 0, mute: false }, { t: "audible", mask: audible(apply(d.project, { t: "track", track: 0, mute: false })) });

  // a slider moved on the desk reaches the plugin, in order with the notes
  d.op({ t: "plugin", track: 0, plugin: withValue(d.project.tracks[0]!.plugin!, 7, 0.3) });
  d.say({ t: "off", track: 0, midi: 69 });
  expect(Math.abs(last(await d.play(0.3)))).toBeLessThan(1e-3);
  expect(heard.slice(-2)).toEqual([{ t: "set", id: 7, v: 0.3 }, { t: "off", key: 69 }]);
  expect(d.pump.state.get(0)?.params[0]?.value).toBe(0.3);

  // a knob turned in the plugin's own window comes back for the desk's slider
  expect(d.pump.state.get(0)?.editor).toBe(true);
  turned = [{ id: 7, value: 0.9 }];
  await d.play(0.1);
  expect(edited).toEqual([{ track: 0, id: 7, value: 0.9 }]);

  // the plugin fails: the track says so and goes quiet, and another track still plays
  failing = true;
  d.say({ t: "on", track: 0, midi: 60, vel: 1 });
  await d.play(0.1);
  expect(d.pump.state.get(0)?.error).toBe("Steady stopped working");
  d.say({ t: "on", track: 1, midi: 60, vel: 1 });
  const rest = await d.play(0.3);
  expect(rest.reduce((m, x) => Math.max(m, Math.abs(x)), 0)).toBeGreaterThan(0.01);

  // back to FM: the plugin is let go and the track's own voice plays its notes again
  d.op({ t: "plugin", track: 0, plugin: null }, { t: "plugin", track: 0, on: false });
  expect(d.pump.state.has(0)).toBe(false);
});

const built = candidates("fm_daw", {}).find(existsSync);

test("Test Tone, the desk's own library, plays a plugin track from the desk's track menu", async () => {
  if (!built) return console.log("  (skipped: cdylib not built; run `bun run build:native`)");
  const { pluginChoices } = await import("../src/ui/plugins.ts");
  const tone = (await pluginChoices()).find((c) => c.name === "Test Tone");
  expect(tone?.path).toBe(built);
  const d = desk(undefined, { path: tone!.path, index: tone!.index, name: tone!.name, values: [] });
  d.op({ t: "param", track: 0, i: P.GAIN, v: 1 }, { t: "param", track: 0, i: P.GAIN, v: 1 });
  await d.play(0.1);
  expect(d.pump.state.get(0)?.params.map((q) => q.name)).toEqual(["Level", "Shape"]);
  d.say({ t: "on", track: 0, midi: 69, vel: 1 });
  const on = await d.play(0.3);
  expect(on.subarray(-4800).reduce((m, x) => Math.max(m, Math.abs(x)), 0)).toBeGreaterThan(0.1);
  d.op({ t: "plugin", track: 0, plugin: withValue(d.project.tracks[0]!.plugin!, 0, 0) });   // Level to 0
  const off = await d.play(0.3);
  expect(off.subarray(-4800).reduce((m, x) => Math.max(m, Math.abs(x)), 0)).toBeLessThan(1e-3);
});
