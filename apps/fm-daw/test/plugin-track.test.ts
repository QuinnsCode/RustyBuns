// A plugin track (#5265): the desk puts a hosted CLAP plugin on a track, the track's notes go to it on the desktop
// host, and its sound comes back into the worklet's mix at the track's fader. The page's pump (src/ui/plugins.ts)
// carries it both ways, as in the app. The first test's host is a stand-in that plays a steady tone while a key is
// down, so only the routing decides what's heard; the second runs Test Tone, the desk's own native library, for real.
// #5301: the plugin's sound goes down the track's strip (PAN, Shape, SEND), a note keeps its place inside a block,
// and a bounce has the plugin track in it, rendered by the host.
import { test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { candidates } from "@rustybuns/native";
import { BLOCK, SR, posted, processor, useWorklet } from "./worklet-kit.ts";
import { PluginPump, bouncePlugins } from "../src/ui/plugins.ts";
import { renderEvents } from "../src/engine/plugins.ts";
import { bounceFrames, renderProject } from "../src/engine/offline.ts";
import { TsEngine } from "../src/engine/engine.ts";
import { flatEq } from "../src/engine/eq.ts";
import { loadMsg } from "../src/ui/load.ts";
import { demoProject } from "../src/presets.ts";
import { apply, audible, type Op, type Project } from "../src/project.ts";
import { P } from "../src/engine/params.ts";
import { BOUNCE_SLOT, PluginAskArgs, withValue, type BlockReply, type PluginEvent, type TrackPlugin } from "../src/plugin-track.ts";
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
    /** `seconds` of both sides, the asks on the way carried to the host and back as the page would. */
    async both(seconds: number): Promise<[Float32Array, Float32Array]> {
      const n = Math.round(seconds * SR), left = new Float32Array(n), right = new Float32Array(n);
      for (let at = 0; at < n; at += BLOCK) {
        const L = new Float32Array(BLOCK), R = new Float32Array(BLOCK), fit = Math.min(BLOCK, n - at);
        p.process([[new Float32Array(BLOCK)]], [[L, R]]);
        left.set(L.subarray(0, fit), at); right.set(R.subarray(0, fit), at);
        for (; seen < posted.length; seen++) { const m = posted[seen]!; if (m.t === "pluginAsk") pump.ask(m); }
        for (let i = 0; i < 8; i++) await Promise.resolve();
      }
      return [left, right];
    },
    /** The left side of `both`. */
    async play(seconds: number): Promise<Float32Array> { return (await this.both(seconds))[0]; },
  };
}
const last = (a: Float32Array) => a[a.length - 1]!;
const peak = (a: Float32Array) => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

/** A host with one plugin for every slot: a steady 0.5 on both sides while a key is down, each event on its frame. */
function steadyHost() {
  const slots = new Map<number, Set<number>>();
  const started: number[] = [], stopped: number[] = [];
  return {
    started, stopped,
    startPlugin: async (slot: unknown) => { slots.set(Number(slot), new Set()); started.push(Number(slot)); return { params: [], editor: false }; },
    openPluginEditor: async () => ({}),
    renderPlugin: async (args: unknown): Promise<BlockReply> => {
      const a = PluginAskArgs(args), down = slots.get(a.track);
      if (!down) return { pcm: "", ok: false, error: "no plugin on this track" };
      const out = renderEvents({
        noteOn: (k) => { down.add(k); }, noteOff: (k) => { down.delete(k); }, setParam: () => {},
        render: (o, n) => { if (down.size) o.fill(0.5, 0, 2 * n); return true; },
      }, a.events, a.frames);
      return { pcm: b64(out!), ok: true };
    },
    stopPlugin: async (slot: unknown) => { slots.delete(Number(slot)); stopped.push(Number(slot)); },
  };
}
const STEADY: TrackPlugin = { path: "/plugins/Steady.clap", index: 0, name: "Steady", values: [] };

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
      for (const { at: _, ...e } of a.events) { heard.push(e); if (e.t === "on") down.add(e.key); if (e.t === "off") down.delete(e.key); }
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

test("a plugin track goes down its strip: PAN moves it across, its Shape filters it, SEND takes it to Space", async () => {
  const d = desk(steadyHost(), STEADY);
  const param = (i: number, v: number) => d.op({ t: "param", track: 0, i, v }, { t: "param", track: 0, i, v });
  param(P.GAIN, 0.5); param(P.PAN, -1); param(P.SEND, 0);
  d.say({ t: "space", amount: 0.5 });
  d.say({ t: "on", track: 0, midi: 69, vel: 1 });
  const [l, r] = await d.both(0.3);
  expect(last(l)).toBeCloseTo(0.5 * 0.5 * Math.SQRT2, 3);            // hard left: all of it on the left, as an FM voice pans
  expect(peak(r)).toBe(0);                                           // and none of it on the right
  param(P.PAN, 1);
  const [l2, r2] = await d.both(0.3);
  expect(Math.abs(last(l2))).toBeLessThan(1e-3);
  expect(last(r2)).toBeCloseTo(0.5 * 0.5 * Math.SQRT2, 3);
  param(P.PAN, 0);

  // the tail after the key lets go: none with SEND down, Space's with it up
  const tail = async (send: number) => {
    param(P.SEND, send);
    d.say({ t: "on", track: 0, midi: 69, vel: 1 });
    await d.play(0.3);
    d.say({ t: "off", track: 0, midi: 69 });
    await d.play(0.1);
    return peak(await d.play(0.2));
  };
  expect(await tail(0)).toBe(0);
  expect(await tail(1)).toBeGreaterThan(1e-3);
});

test("a plugin track plays through the track's own Shape", async () => {
  const d = desk(steadyHost(), STEADY);
  d.op({ t: "param", track: 0, i: P.GAIN, v: 0.5 }, { t: "param", track: 0, i: P.GAIN, v: 0.5 });
  d.say({ t: "on", track: 0, midi: 69, vel: 1 });
  expect(last(await d.play(0.3))).toBeCloseTo(0.25, 3);
  // a low cut takes the plugin's steady level away
  const cut = flatEq();
  cut[0] = { kind: "lowCut", f: 200, g: 0, q: Math.SQRT1_2, slope: 12, on: true };
  d.say({ t: "trackEq", track: 0, bands: cut });
  expect(Math.abs(last(await d.play(0.5)))).toBeLessThan(1e-3);
});

test("a note on a plugin track is heard as long after it's played wherever in a block that was", async () => {
  /** Frames from a key going down, `into` frames into a block of the host's, to its sound. */
  const wait = async (into: number) => {
    const d = desk(steadyHost(), STEADY);
    d.op({ t: "param", track: 0, i: P.GAIN, v: 1 }, { t: "param", track: 0, i: P.GAIN, v: 1 });
    await d.play(4096 / SR);
    const before = await d.play(into / SR);
    d.say({ t: "on", track: 0, midi: 69, vel: 1 });
    const out = await d.play(4096 / SR);
    expect(peak(before)).toBe(0);
    return out.findIndex((x) => x > 0.1);
  };
  const first = await wait(0);
  expect(first).toBeGreaterThan(0);
  expect(await wait(128)).toBe(first);
  expect(await wait(384)).toBe(first);
});

/** The demo groove with only track 0 heard: `plugin` on it, panned hard left, one note from beat 1 for a beat. */
function oneNote(plugin: TrackPlugin): Project {
  const p = apply(demoProject(), { t: "plugin", track: 0, plugin });
  return { ...p, space: 0, swing: 0, tracks: p.tracks.map((t, i) => (i === 0 ? { ...t, solo: true, notes: [{ s: 1, l: 1, m: 69, v: 1 }], params: t.params.map((v, j) => (j === P.PAN ? -1 : j === P.GAIN ? 1 : v)) } : t)) };
}
const sides = (pcm: Float32Array, from: number, to: number) => {
  const l = new Float32Array(to - from), r = new Float32Array(to - from);
  for (let f = from; f < to; f++) { l[f - from] = pcm[2 * f]!; r[f - from] = pcm[2 * f + 1]!; }
  return [l, r] as const;
};

test("a bounce has the plugin track in it: the host plays its notes, and it goes down the strip as in playback", async () => {
  const p = oneNote(STEADY), host = steadyHost(), secs = 2;
  const { sound, missed } = await bouncePlugins(p, SR, bounceFrames(p, SR, secs), host);
  expect(missed).toEqual([]);
  expect(host.started).toEqual([BOUNCE_SLOT]);                        // a copy of its own, let go after
  expect(host.stopped).toEqual([BOUNCE_SLOT]);
  const out = renderProject(new TsEngine(SR), p, SR, secs, 0.5, undefined, (t) => sound.get(t));
  const beat = (SR * 60) / p.bpm;
  const [quietL] = sides(out, 0, Math.floor(beat) - 64), [l, r] = sides(out, Math.ceil(beat) + 64, Math.floor(2 * beat) - 64), [afterL] = sides(out, Math.ceil(2 * beat) + 64, secs * SR);
  expect(peak(quietL)).toBe(0);                                      // the note starts on its beat,
  expect(Math.min(...l)).toBeCloseTo(0.5 * 0.5 * Math.SQRT2, 3);     // holds at the fader and master, on the left only,
  expect(peak(r)).toBe(0);
  expect(peak(afterL)).toBe(0);                                      // and ends on its beat

  // a host that can't play it: the bounce goes on without the track (not with its FM voice), and says which
  const none = await bouncePlugins(p, SR, bounceFrames(p, SR, secs), { ...host, startPlugin: async () => ({ params: [], editor: false, error: "plugins need the desktop app's native engine" }) });
  expect(none.missed).toEqual(["Steady (plugins need the desktop app's native engine)"]);
  expect(peak(renderProject(new TsEngine(SR), p, SR, secs, 0.5, undefined, (t) => none.sound.get(t)))).toBe(0);
});

test("a bounce of a groove with Test Tone on a track has the tone in it", async () => {
  if (!built) return console.log("  (skipped: cdylib not built; run `bun run build:native`)");
  const { pluginChoices } = await import("../src/ui/plugins.ts");
  const tone = (await pluginChoices()).find((c) => c.name === "Test Tone")!;
  const p = oneNote({ path: tone.path, index: tone.index, name: tone.name, values: [] }), secs = 2;
  const { sound, missed } = await bouncePlugins(p, SR, bounceFrames(p, SR, secs));
  expect(missed).toEqual([]);
  const out = renderProject(new TsEngine(SR), p, SR, secs, 0.5, undefined, (t) => sound.get(t));
  const beat = (SR * 60) / p.bpm;
  const [l, r] = sides(out, Math.ceil(beat) + 64, Math.floor(2 * beat) - 64);
  expect(peak(l)).toBeGreaterThan(0.05);
  expect(peak(r)).toBeLessThan(1e-6);
});
