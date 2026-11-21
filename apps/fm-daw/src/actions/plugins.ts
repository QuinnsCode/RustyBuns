"use server";
// Runs on the desktop host: the plugin tracks' CLAP and VST3 plugins (#5265, #5268). The page lists what's installed, starts one on a
// track, and then asks for its sound a block at a time, with the notes the worklet played since the last block
// (src/engine/plugin-route.ts). Only a `.clap` or `.vst3` the scan found can be opened: loading one runs its code.
import { existsSync } from "node:fs";
import { candidates } from "@rustybuns/native";
import { check, int, num, str } from "@rustybuns/util/guard";
import { openBundle, renderEvents, scanPlugins, type Bundle, type HostedPlugin } from "../engine/plugins.ts";
import { ownCopy, PluginAskArgs, TrackPlugin, type BlockReply, type PluginChoice, type StartReply } from "../plugin-track.ts";

const bundles = new Map<string, Bundle>();
const playing = new Map<number, { plugin: HostedPlugin; failed: string | null }>();
let found: PluginChoice[] = [];

async function bundle(path: string): Promise<Bundle | string> {
  const had = bundles.get(path);
  if (had) return had;
  const b = await openBundle(path);
  if (typeof b !== "string") bundles.set(path, b);
  return b;
}

/** Every plugin in the CLAP and VST3 folders, for the track menu. One that won't load is left out. */
export async function findPlugins(): Promise<PluginChoice[]> {
  // the desk's own native library is a `.clap` holding Test Tone: a dev build lists it, so there's always one to try
  const own = candidates("fm_daw", {}).find((p) => !p.startsWith("/$bunfs") && existsSync(p));
  const out: PluginChoice[] = [];
  for (const path of new Set([...scanPlugins(), ...(own ? [own] : [])])) {
    const b = await bundle(path);
    if (typeof b === "string") continue;
    b.plugins.forEach((p, index) => out.push({ path, index, name: p.name, vendor: p.vendor, id: p.id }));
  }
  found = out;
  return out;
}

/**
 * Starts `plugin` on track `track` (or a bounce's slot, BOUNCE_SLOT) at the context's rate, with its moved sliders where they were. The groove may be a
 * friend's, naming the `.clap` or `.vst3` in their folder: this computer's own copy of the same plugin plays (`ownCopy`).
 */
export async function startPlugin(track: unknown, plugin: unknown, sampleRate: unknown): Promise<StartReply> {
  const t = check(int(0, 63), track), p = check(TrackPlugin, plugin), sr = check(num(8000, 384000), sampleRate);
  if (t === null || !p || sr === null) return { params: [], editor: false, error: "not a plugin track" };
  stop(t);
  const mine = ownCopy(p, found) ?? ownCopy(p, await findPlugins());
  if (!mine) return { params: [], editor: false, error: `${p.name} isn't on this computer` };
  const b = await bundle(mine.path);
  if (typeof b === "string") return { params: [], editor: false, error: b };
  const made = b.make(mine.index, sr);
  if (typeof made === "string") return { params: [], editor: false, error: made };
  for (const { id, v } of p.values) made.setParam(id, v);
  playing.set(t, { plugin: made, failed: null });
  return { params: made.params(), editor: made.editor !== null };
}

/** The next `frames` of track `track`'s plugin, the notes and slider moves in `events` each on its frame of them. */
export async function renderPlugin(args: unknown): Promise<BlockReply> {
  const a = check(PluginAskArgs, args);
  const p = a && playing.get(a.track);
  if (!a || !p) return { pcm: "", ok: false, error: "no plugin on this track" };
  if (p.failed) return { pcm: "", ok: false, error: p.failed };
  const { plugin } = p;
  const out = renderEvents(plugin, a.events, a.frames);
  if (!out) {
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
