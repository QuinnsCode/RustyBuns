"use server";
// Runs on the desktop host: the plugin tracks' CLAP plugins (#5265). The page lists what's installed, starts one on a
// track, and then asks for its sound a block at a time, with the notes the worklet played since the last block
// (src/engine/plugin-route.ts). Only a `.clap` the scan found can be opened: loading one runs its code.
import { existsSync } from "node:fs";
import { candidates } from "@rustybuns/native";
import { check, int, num, str } from "@rustybuns/util/guard";
import { openBundle, scanPlugins, type Bundle, type HostedPlugin } from "../engine/plugins.ts";
import { PluginAskArgs, TrackPlugin, type BlockReply, type PluginChoice, type StartReply } from "../plugin-track.ts";

const bundles = new Map<string, Bundle>();
const playing = new Map<number, { plugin: HostedPlugin; failed: string | null }>();
let found: Set<string> = new Set();

async function bundle(path: string): Promise<Bundle | string> {
  const had = bundles.get(path);
  if (had) return had;
  const b = await openBundle(path);
  if (typeof b !== "string") bundles.set(path, b);
  return b;
}

/** Every plugin in the CLAP folders, for the track menu. A `.clap` that won't load is left out. */
export async function findPlugins(): Promise<PluginChoice[]> {
  // the desk's own native library is a `.clap` holding Test Tone: a dev build lists it, so there's always one to try
  const own = candidates("fm_daw", {}).find((p) => !p.startsWith("/$bunfs") && existsSync(p));
  found = new Set([...scanPlugins(), ...(own ? [own] : [])]);
  const out: PluginChoice[] = [];
  for (const path of found) {
    const b = await bundle(path);
    if (typeof b === "string") continue;
    b.plugins.forEach((p, index) => out.push({ path, index, name: p.name, vendor: p.vendor }));
  }
  return out;
}

/** Starts `plugin` on track `track` at the context's rate, with its moved sliders where they were. */
export async function startPlugin(track: unknown, plugin: unknown, sampleRate: unknown): Promise<StartReply> {
  const t = check(int(0, 63), track), p = check(TrackPlugin, plugin), sr = check(num(8000, 384000), sampleRate);
  if (t === null || !p || sr === null) return { params: [], editor: false, error: "not a plugin track" };
  stop(t);
  if (!found.has(p.path)) await findPlugins();
  if (!found.has(p.path)) return { params: [], editor: false, error: `${p.name} isn't in the CLAP folders any more` };
  const b = await bundle(p.path);
  if (typeof b === "string") return { params: [], editor: false, error: b };
  const made = b.make(p.index, sr);
  if (typeof made === "string") return { params: [], editor: false, error: made };
  for (const { id, v } of p.values) made.setParam(id, v);
  playing.set(t, { plugin: made, failed: null });
  return { params: made.params(), editor: made.editor !== null };
}

/** The next `frames` of track `track`'s plugin, after the notes and slider moves in `events`. */
export async function renderPlugin(args: unknown): Promise<BlockReply> {
  const a = check(PluginAskArgs, args);
  const p = a && playing.get(a.track);
  if (!a || !p) return { pcm: "", ok: false, error: "no plugin on this track" };
  if (p.failed) return { pcm: "", ok: false, error: p.failed };
  const { plugin } = p;
  for (const e of a.events) {
    if (e.t === "on") plugin.noteOn(e.key, e.vel);
    else if (e.t === "off") plugin.noteOff(e.key);
    else plugin.setParam(e.id, e.v);
  }
  const out = new Float32Array(2 * a.frames);
  if (!plugin.render(out, a.frames)) {
    p.failed = `${plugin.info.name} stopped working`;
    return { pcm: "", ok: false, error: p.failed };
  }
  const changes = plugin.changes();
  return { pcm: Buffer.from(out.buffer).toString("base64"), ok: true, ...(changes.length ? { changes } : {}) };
}

/** Frees track `track`'s plugin, if it has one. */
export async function stopPlugin(track: unknown): Promise<void> {
  const t = check(int(0, 63), track);
  if (t !== null) stop(t);
}
/** Opens track `track`'s plugin's own editor as a window beside the app (or brings it forward). */
export async function openPluginEditor(track: unknown, title: unknown): Promise<{ error?: string }> {
  const t = check(int(0, 63), track), name = check(str(200), title);
  const p = t === null ? undefined : playing.get(t);
  if (!p || name === null) return { error: "no plugin on this track" };
  const r = p.plugin.openEditor(name);
  return r === true ? {} : { error: r };
}

function stop(t: number) {
  playing.get(t)?.plugin.closeEditor();
  playing.get(t)?.plugin.free();
  playing.delete(t);
}
