// A web plugin track (#4899): the desk puts a Web Audio Module on a track, the track's notes reach it as MIDI in the
// page, and its sound comes into the audio thread's second input under the master. The page's pump, the rack
// (src/ui/wam.ts) and the worklet run together here; the module is a stand-in that notes what it's told, since a real
// one needs a browser's audio (scripts/web-plugin-check.ts plays Test Tone in Chrome).
import { test, expect } from "bun:test";
import { BLOCK, SR, posted, processor, useWorklet, type Proc } from "./worklet-kit.ts";
import { PluginPump, bouncePlugins } from "../src/ui/plugins.ts";
import { WamRack, paramId, siteOf, type Fader, type WamEvent } from "../src/ui/wam.ts";
import { loadMsg } from "../src/ui/load.ts";
import { demoProject } from "../src/presets.ts";
import { apply, type Op, type Project } from "../src/project.ts";
import { P, TRACKS } from "../src/engine/params.ts";
import { withValue, type TrackPlugin } from "../src/plugin-track.ts";
import type { ToWorklet } from "../src/engine/messages.ts";
import { bounceFrames, renderProject } from "../src/engine/offline.ts";
import { TsEngine } from "../src/engine/engine.ts";

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
    /** `seconds` of the left side out, the plugins' bus steady at `bus` (track 0's own channel at `tap`), the asks carried to the pump as the page would. */
    async play(seconds: number, bus = 0, tap = 0): Promise<number> {
      let last = 0;
      for (let at = 0; at < seconds * SR; at += BLOCK) {
        const L = new Float32Array(BLOCK), R = new Float32Array(BLOCK);
        const taps = Array.from({ length: TRACKS }, (_, t) => new Float32Array(BLOCK).fill(t === 0 ? tap : 0));
        (p as Proc).process([[new Float32Array(BLOCK)], [new Float32Array(BLOCK).fill(bus), new Float32Array(BLOCK).fill(bus)], [], taps], [[L, R]]);
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

test("a web plugin track goes down the sesh's live line, its own sound at its fader, as a CLAP track's does", async () => {
  const s = synth(), here = "https://fm-daw.example/synth.js";
  const d = desk({ path: here, index: 0, name: "synth", web: true, values: [] }, { [here]: s.module });
  d.op({ t: "param", track: 0, i: P.GAIN, v: 0.5 }, { t: "param", track: 0, i: P.GAIN, v: 0.5 });
  await d.settle();
  expect(d.pump.state.get(0)).toMatchObject({ error: null, starting: false });
  const from = posted.length;
  d.say({ t: "pluginSend", track: 0, on: true, web: true });          // online: the page sends what plays here
  await d.play(0.5, 0, 0.25);
  const slices = posted.slice(from).flatMap((m) => (m.t === "sound" && m.track === 0 ? [m.pcm] : []));
  expect(slices.length).toBeGreaterThan(2);
  for (const pcm of slices) expect([Math.min(...pcm), Math.max(...pcm)].map((x) => x.toFixed(4))).toEqual(["0.1250", "0.1250"]);   // the plugin, at the fader, and nothing else
  d.say({ t: "pluginSend", track: 0, on: false });
  const off = posted.length;
  await d.play(0.2, 0, 0.25);
  expect(posted.slice(off).some((m) => m.t === "sound")).toBe(false);
});

test("a bounce renders a web plugin track on an offline context of its own, and leaves out one from a site nobody said yes to", async () => {
  const told: WamEvent[] = [];
  const node = {
    connect() {},
    getParameterInfo: async () => ({ cutoff: { label: "Cutoff", type: "float", defaultValue: 0.5, minValue: 0, maxValue: 1 } }),
    getParameterValues: async () => ({ cutoff: { value: 0.5 } }),
    setParameterValues() {},
    scheduleEvents(...e: WamEvent[]) { told.push(...e); },
    destroy() {},
  };
  const mod = { default: { createInstance: async () => ({ audioNode: node }) } };
  const ours = "https://fm-daw.example/synth.js", theirs = "https://plugins.example/synth.js";
  let rendered = 0;
  const rack = new WamRack({
    now: () => 0, here: "https://fm-daw.example/", host: async () => "page", load: async () => mod,
    make: () => { throw new Error("a bounce doesn't use the page's audio"); }, fader: () => { throw new Error("nor its faders"); },
    // the offline context plays the note it was told: 0.3 on both sides from its frame on
    offline: (_sr, frames) => ({
      host: async () => "offline", make: (cls, g) => cls.createInstance(g, null), out() {},
      async render() {
        rendered++;
        const on = told.find((e) => e.type === "wam-midi"), pcm = new Float32Array(2 * frames);
        if (on) pcm.fill(0.3, 2 * Math.round(on.time * SR));
        return pcm;
      },
    }),
  });
  const project = (path: string): Project => {
    const p = apply(demoProject(), { t: "plugin", track: 0, plugin: { path, index: 0, name: "synth", web: true, values: [] } });
    return { ...p, space: 0, tracks: p.tracks.map((t, i) => (i === 0 ? { ...t, solo: true, notes: [{ s: 1, l: 1, m: 69, v: 1 }], auto: [], params: t.params.map((v, j) => (j === P.GAIN ? 1 : v)) } : t)) };
  };
  const secs = 2, frames = bounceFrames(project(ours), SR, secs), beat = 60 / project(ours).bpm;
  const { sound, missed } = await bouncePlugins(project(ours), SR, frames, undefined, rack);
  expect(missed).toEqual([]);
  // the track's note, at its beat on the offline context's clock
  expect(told.filter((e) => e.type === "wam-midi").map((e) => [e.data.bytes, Math.round(e.time / beat)])).toEqual([[[0x90, 69, 127], 1], [[0x80, 69, 0], 2]]);
  const out = renderProject(new TsEngine(SR), project(ours), SR, secs, 0.5, undefined, (t) => sound.get(t));
  const loudest = (a: Float32Array) => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  expect(loudest(out.subarray(0, 2 * Math.floor(beat * SR) - 128))).toBe(0);
  expect(loudest(out.subarray(2 * Math.ceil(beat * SR) + 128))).toBeGreaterThan(0.1);   // in the mix from its beat

  const away = await bouncePlugins(project(theirs), SR, frames, undefined, rack);
  expect(away.missed).toEqual(["synth (nobody here has said plugins.example may run code in this page)"]);
  expect(rendered).toBe(1);                                                                // never loaded
  expect((await bouncePlugins(project(ours), SR, frames)).missed).toEqual(["synth (a web plugin plays in FM DAW's own page)"]);
});
