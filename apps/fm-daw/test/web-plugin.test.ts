// A web plugin track (#4899): the desk puts a Web Audio Module on a track, the track's notes reach it as MIDI in the
// page, and its sound comes into the audio thread's second input under the master. The page's pump, the rack
// (src/ui/wam.ts) and the worklet run together here; the module is a stand-in that notes what it's told, since a real
// one needs a browser's audio (scripts/web-plugin-check.ts plays Test Tone in Chrome).
import { test, expect } from "bun:test";
import { BLOCK, SR, posted, processor, useWorklet, type Proc } from "./worklet-kit.ts";
import { PluginPump } from "../src/ui/plugins.ts";
import { WamRack, paramId, siteOf, type Fader } from "../src/ui/wam.ts";
import { loadMsg } from "../src/ui/load.ts";
import { demoProject } from "../src/presets.ts";
import { apply, type Op, type Project } from "../src/project.ts";
import { P } from "../src/engine/params.ts";
import { withValue, type TrackPlugin } from "../src/plugin-track.ts";
import type { ToWorklet } from "../src/engine/messages.ts";

useWorklet();

const URL_ = "https://plugins.example/synth/index.js";

/** A module as a site would serve it: one Cutoff slider, and a record of what the host told it. */
function synth() {
  const told = { midi: [] as number[][], cutoff: 0.5, destroyed: false };
  const node = {
    connect() {},
    getParameterInfo: async () => ({ cutoff: { id: "cutoff", label: "Cutoff", type: "float", defaultValue: 0.5, minValue: 0, maxValue: 1 } }),
    getParameterValues: async () => ({ cutoff: { id: "cutoff", value: told.cutoff, normalized: false } }),
    setParameterValues(v: Record<string, { value: number }>) { if (v.cutoff) told.cutoff = v.cutoff.value; },
    scheduleEvents(...events: { data: { bytes: number[] } }[]) { for (const e of events) told.midi.push(e.data.bytes); },
    destroy() { told.destroyed = true; },
  };
  return { told, module: { default: { createInstance: async () => ({ audioNode: node }) } } };
}

/** The page, the worklet and the rack: ops change the groove, `play` runs the audio with `bus` on the second input. */
function desk(plugin: TrackPlugin, modules: Record<string, unknown>) {
  const { p, say } = processor();
  const loaded: string[] = [], kept = new Map<string, string>();
  const fader: Fader & { made: number } = { made: 0, gain: { value: 0, setTargetAtTime(v) { this.value = v; } }, disconnect() {} };
  const rack = new WamRack({
    now: () => 0, here: "https://fm-daw.example/",
    host: async () => "group",
    load: async (url) => { loaded.push(url); return modules[url]; },
    make: (cls, group) => cls.createInstance(group, null),
    fader: () => { fader.made++; fader.gain.value = 0; return fader; },
    store: { getItem: (k) => kept.get(k) ?? null, setItem: (k, v) => void kept.set(k, v) },
  });
  let proj: Project = apply(demoProject(), { t: "plugin", track: 0, plugin });
  const pump = new PluginPump((m: ToWorklet) => say(m), SR, undefined, undefined, rack);
  say(loadMsg(proj));
  say({ t: "master", gain: 1 });
  pump.sync(proj);
  let seen = 0;
  const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  return {
    pump, loaded, fader, say, settle,
    get project() { return proj; },
    op(o: Op, msg?: ToWorklet) { proj = apply(proj, o); if (msg) say(msg); pump.sync(proj); },
    /** `seconds` of the left side out, the plugins' bus steady at `bus`, the asks carried to the pump as the page would. */
    async play(seconds: number, bus = 0): Promise<number> {
      let last = 0;
      for (let at = 0; at < seconds * SR; at += BLOCK) {
        const L = new Float32Array(BLOCK), R = new Float32Array(BLOCK);
        (p as Proc).process([[new Float32Array(BLOCK)], [new Float32Array(BLOCK).fill(bus), new Float32Array(BLOCK).fill(bus)]], [[L, R]]);
        last = L[BLOCK - 1]!;
        for (; seen < posted.length; seen++) { const m = posted[seen]!; if (m.t === "pluginAsk") pump.ask(m); }
        await settle();
      }
      return last;
    },
  };
}

test("a web plugin from another site asks first, then plays the track's notes at its fader and comes in under the master", async () => {
  const s = synth();
  const d = desk({ path: URL_, index: 0, name: "synth", web: true, values: [] }, { [URL_]: s.module });
  d.op({ t: "param", track: 0, i: P.GAIN, v: 0.5 }, { t: "param", track: 0, i: P.GAIN, v: 0.5 });
  await d.settle();

  // nobody said plugins.example may run code here: nothing is fetched, and the track says which site wants in
  expect(d.loaded).toEqual([]);
  expect(d.pump.state.get(0)).toMatchObject({ site: "https://plugins.example", params: [] });
  d.say({ t: "on", track: 0, midi: 69, vel: 1 });
  await d.play(0.05);
  d.say({ t: "off", track: 0, midi: 69 });
  await d.play(0.05);
  expect(s.told.midi).toEqual([]);

  d.pump.trust(0, d.project);
  await d.settle();
  expect(d.loaded).toEqual([URL_]);
  expect(d.pump.state.get(0)).toMatchObject({ error: null, starting: false, params: [{ name: "Cutoff", value: 0.5, min: 0, max: 1 }] });
  expect(d.fader.gain.value).toBe(0.5);                               // its sound goes in at the track's fader

  d.say({ t: "on", track: 0, midi: 69, vel: 1 });
  await d.play(0.05);
  d.say({ t: "off", track: 0, midi: 69 });
  await d.play(0.05);
  expect(s.told.midi).toEqual([[0x90, 69, 127], [0x80, 69, 0]]);      // the track's notes, as MIDI

  const plug = d.project.tracks[0]!.plugin!;
  d.op({ t: "plugin", track: 0, plugin: withValue(plug, paramId("cutoff"), 0.9) });
  await d.play(0.05);
  expect(s.told.cutoff).toBe(0.9);                                    // a slider on the desk turns the plugin's

  expect(await d.play(0.2, 0.25)).toBeCloseTo(0.25, 3);               // what the plugins play is in the mix
  d.say({ t: "master", gain: 0.5 });
  expect(await d.play(0.2, 0.25)).toBeCloseTo(0.125, 3);             // under the master

  d.op({ t: "track", track: 0, mute: true }, { t: "audible", mask: d.project.tracks.map((_, i) => i !== 0) });
  expect(d.fader.gain.value).toBe(0);                                 // muted: its fader is down
  d.op({ t: "plugin", track: 0, plugin: null }, { t: "plugin", track: 0, on: false });
  await d.settle();
  expect(s.told.destroyed).toBe(true);                                // FM again: the plugin is gone
});

test("an address that isn't a plugin says so, and the page loads only https or its own", async () => {
  const d = desk({ path: "/wam/not-one.js", index: 0, name: "not one", web: true, values: [] }, { "https://fm-daw.example/wam/not-one.js": { default: {} } });
  await d.settle();
  expect(d.loaded).toEqual(["https://fm-daw.example/wam/not-one.js"]);   // the page's own site: no question asked
  expect(d.pump.state.get(0)?.error).toBe("that address isn't a Web Audio Module");
  expect(d.fader.made).toBe(0);

  const here = "https://fm-daw.example/";
  expect(["javascript:alert(1)", "http://plugins.example/x.js", "data:text/javascript,1", "file:///x.js"].map((p) => siteOf(p, here))).toEqual([null, null, null, null]);
  expect(siteOf("https://plugins.example/x.js", here)?.site).toBe("https://plugins.example");
  expect(siteOf("builtin:tone", here)).toEqual({ site: null, url: "builtin:tone" });
});
