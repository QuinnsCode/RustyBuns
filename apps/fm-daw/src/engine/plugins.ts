// Host-only: a player's own CLAP plugins, run by the Rust host (native/crates/fm_daw/src/clap.rs) through bun:ffi
// (#5244). `pluginFolders` and `scanPlugins` find the `.clap` files where plugin installers put them; `openBundle`
// loads one and lists the plugins inside; `make` starts one, and from then on this side only sends notes and
// parameter changes, and asks for blocks of its sound (interleaved stereo, the layout `fm_render` writes).
// `openEditor` opens the plugin's own editor as a native window (#5267), and `changes` hands back the knobs turned in it.
// null from `clapLib` => no native build for this platform (or Cloudflare): no plugin tracks.
import { FFIType, ptr } from "bun:ffi";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadNative } from "@rustybuns/native";
import { arr, type Guard } from "@rustybuns/util/guard";
import { ParamChange, PluginInfo, PluginParam } from "../plugin-track.ts";
import { audible, type Project } from "../project.ts";
import { P } from "./params.ts";

export const clapSymbols = {
  fm_clap_error: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.u32 },
  fm_clap_open: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.ptr },
  fm_clap_close: { args: [FFIType.ptr], returns: FFIType.void },
  fm_clap_list: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.u32 },
  fm_clap_new: { args: [FFIType.ptr, FFIType.u32, FFIType.f64], returns: FFIType.ptr },
  fm_clap_free: { args: [FFIType.ptr], returns: FFIType.void },
  fm_clap_params: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.u32 },
  fm_clap_set_param: { args: [FFIType.ptr, FFIType.u32, FFIType.f64], returns: FFIType.void },
  fm_clap_note_on: { args: [FFIType.ptr, FFIType.u32, FFIType.f64, FFIType.u32], returns: FFIType.void },
  fm_clap_note_off: { args: [FFIType.ptr, FFIType.u32, FFIType.u32], returns: FFIType.void },
  fm_clap_render: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.u32 },
  fm_clap_editor: { args: [FFIType.ptr], returns: FFIType.u32 },
  fm_clap_open_editor: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.u32 },
  fm_clap_close_editor: { args: [FFIType.ptr], returns: FFIType.void },
  fm_clap_pump: { args: [FFIType.ptr], returns: FFIType.u32 },
  fm_clap_changes: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.u32 },
} as const;

type Lib = NonNullable<Awaited<ReturnType<typeof loadNative<typeof clapSymbols>>>>;
let lib: Lib | null | undefined;
export async function clapLib(): Promise<Lib | null> {
  if (lib === undefined) lib = await loadNative("fm_daw", clapSymbols);
  return lib;
}

export { ParamChange, PluginInfo, PluginParam } from "../plugin-track.ts";
/** A knob the plugin turned itself (in its own editor): the slider for `id` moves to `value`. */
/** How a plugin's own editor opens: in a window of its own, inside one of ours, or not at all here. */
export type EditorKind = "floating" | "window" | null;
/** How often an open editor's window gets its events, and what the plugin asked for is done. */
export const PUMP_MS = 16;

const enc = new TextEncoder(), dec = new TextDecoder();

/** Text the host writes into a buffer: it returns the length it needs, so a short buffer is grown once. */
function text(call: (out: Uint8Array | null, cap: number) => number): string {
  let buf = new Uint8Array(4096);
  let n = call(buf, buf.length);
  if (n > buf.length) { buf = new Uint8Array(n); n = call(buf, n); }
  return dec.decode(buf.subarray(0, n));
}
const json = <T>(g: Guard<T[]>, s: string): T[] => g(JSON.parse(s));
const lastError = (l: Lib) => text((o, c) => l.fm_clap_error(o ? ptr(o) : null, c)) || "unknown failure";

export interface HostedPlugin {
  readonly info: PluginInfo;
  /** The parameters a player may move, with their values now. */
  params(): PluginParam[];
  setParam(id: number, value: number): void;
  noteOn(key: number, velocity: number, channel?: number): void;
  noteOff(key: number, channel?: number): void;
  /** Adds `frames` of its sound into `out` (interleaved stereo). False once the plugin has failed: silent from then on. */
  render(out: Float32Array, frames: number): boolean;
  /** How its own editor opens here; null when it has none (or only one this OS can't hold yet). */
  readonly editor: EditorKind;
  /** Opens its editor as a native window titled `title` beside the app (or brings it forward); a string says why not.
   *  `onClose` runs when the player closes the window. */
  openEditor(title: string, onClose?: () => void): true | string;
  closeEditor(): void;
  /** Knobs it turned itself since last asked (last value per parameter), for the desk's sliders. Ask after `render`. */
  changes(): ParamChange[];
  free(): void;
}

export interface Bundle {
  readonly path: string;
  readonly plugins: PluginInfo[];
  /** Starts plugin `index`; a string says why it wouldn't. */
  make(index: number, sampleRate: number): HostedPlugin | string;
  /** Plugins already made keep the library loaded until they're freed. */
  close(): void;
}

/** Opens a `.clap` (a file, or a macOS bundle folder); a string says why it couldn't. */
export async function openBundle(path: string): Promise<Bundle | string> {
  const l = await clapLib();
  if (!l) return "plugins need the desktop app's native engine";
  const p = enc.encode(path);
  const h = l.fm_clap_open(p.length ? ptr(p) : null, p.length);
  if (!h) return lastError(l);
  let open = true;
  const plugins = json(arr(PluginInfo, 256), text((o, c) => l.fm_clap_list(h, o ? ptr(o) : null, c)));
  return {
    path, plugins,
    make(index, sampleRate) {
      const info = plugins[index];
      if (!open || !info) return "no plugin there";
      const ph = l.fm_clap_new(h, index >>> 0, sampleRate);
      if (!ph) return lastError(l);
      let alive = true;
      let pump: ReturnType<typeof setInterval> | undefined, closed: (() => void) | undefined;
      const stop = () => { clearInterval(pump); pump = undefined; const c = closed; closed = undefined; c?.(); };
      const editor = ([null, "floating", "window"] as const)[l.fm_clap_editor(ph)] ?? null;
      return {
        editor,
        openEditor(title, onClose) {
          if (!alive) return "the plugin has stopped";
          const t = enc.encode(title);
          if (l.fm_clap_open_editor(ph, t.length ? ptr(t) : null, t.length) !== 1) return lastError(l);
          if (onClose) closed = onClose;
          pump ??= setInterval(() => { if (!alive || l.fm_clap_pump(ph) !== 1) stop(); }, PUMP_MS);
          return true;
        },
        closeEditor: () => { if (alive) l.fm_clap_close_editor(ph); clearInterval(pump); pump = undefined; closed = undefined; },
        changes: () => alive ? json(arr(ParamChange, 4096), text((o, c) => l.fm_clap_changes(ph, o ? ptr(o) : null, c))) : [],
        info,
        params: () => alive ? json(arr(PluginParam, 4096), text((o, c) => l.fm_clap_params(ph, o ? ptr(o) : null, c))) : [],
        setParam: (id, v) => { if (alive && Number.isFinite(v)) l.fm_clap_set_param(ph, id >>> 0, v); },
        noteOn: (k, v, ch = 0) => { if (alive) l.fm_clap_note_on(ph, k >>> 0, v, ch >>> 0); },
        noteOff: (k, ch = 0) => { if (alive) l.fm_clap_note_off(ph, k >>> 0, ch >>> 0); },
        render: (out, frames) => alive && l.fm_clap_render(ph, ptr(out), Math.min(frames, out.length >> 1) >>> 0) === 1,
        free: () => { if (alive) { clearInterval(pump); pump = undefined; closed = undefined; alive = false; l.fm_clap_free(ph); } },
      };
    },
    close: () => { if (open) { open = false; l.fm_clap_close(h); } },
  };
}

/** Where CLAP installers put plugins on each OS (the CLAP spec's list), `CLAP_PATH` first. */
export function pluginFolders(platform = process.platform, env: Record<string, string | undefined> = process.env, home = homedir()): string[] {
  const sep = platform === "win32" ? ";" : ":";
  const extra = (env.CLAP_PATH ?? "").split(sep).filter(Boolean);
  if (platform === "darwin") return [...extra, join(home, "Library/Audio/Plug-Ins/CLAP"), "/Library/Audio/Plug-Ins/CLAP"];
  if (platform === "win32") {
    return [...extra, ...[env.COMMONPROGRAMFILES && join(env.COMMONPROGRAMFILES, "CLAP"), env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Programs/Common/CLAP")]
      .filter((d): d is string => !!d)];
  }
  return [...extra, join(home, ".clap"), "/usr/lib/clap"];
}

/** Every `.clap` in these folders and the folders inside them (a few deep), each once. A folder that isn't there is skipped. */
export function scanPlugins(folders: string[] = pluginFolders(), depth = 4): string[] {
  const found = new Set<string>();
  const walk = (dir: string, left: number) => {
    let names: string[];
    try { names = readdirSync(dir); } catch { return; }
    for (const n of names.sort()) {
      const p = join(dir, n);
      if (n.toLowerCase().endsWith(".clap")) { found.add(p); continue; }
      if (left > 0) { try { if (statSync(p).isDirectory()) walk(p, left - 1); } catch { /* gone or unreadable */ } }
    }
  };
  for (const f of folders) walk(f, depth);
  return [...found];
}

/** How fast a plugin track's level follows its fader, per sample: the native desk's GAIN_SMOOTH, so the two sound alike. */
const GAIN_SMOOTH = 0.002;

/** The level a track's fader asks for: its GAIN, or 0 while it's muted or another track is soloed. */
export function trackLevel(p: Project, track: number): number {
  const g = audible(p)[track] ? p.tracks[track]?.params[P.GAIN] ?? 0 : 0;
  return Number.isFinite(g) ? Math.max(0, Math.min(1, g)) : 0;
}

/**
 * A plugin track's fader (#5274): the plugin's sound joins the mix scaled by the track's level, eased so a move
 * doesn't click. The desk and the remote both send `param` GAIN and `track` mute, so neither needs a plugin case:
 * `level(trackLevel(project, t))` after each op, `mix` once a block.
 */
export function pluginFader(play: (out: Float32Array, frames: number) => boolean) {
  let now = 0, target = 0, buf = new Float32Array(0);
  return {
    level(v: number) { target = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0; },
    /** Adds `frames` of the plugin, at its level, into `out` (interleaved stereo). False once the plugin has failed. */
    mix(out: Float32Array, frames: number): boolean {
      const n = Math.min(frames, out.length >> 1);
      if (buf.length < 2 * n) buf = new Float32Array(2 * n); else buf.fill(0, 0, 2 * n);
      const ok = play(buf, n);
      for (let f = 0; f < n; f++) {
        now += (target - now) * GAIN_SMOOTH;
        out[2 * f] = out[2 * f]! + buf[2 * f]! * now;
        out[2 * f + 1] = out[2 * f + 1]! + buf[2 * f + 1]! * now;
      }
      return ok;
    },
  };
}
