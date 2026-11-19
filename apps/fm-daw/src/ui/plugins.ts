// The page's side of a plugin track (#5265): it starts each track's plugin on the desktop host, carries the worklet's
// asks to the host (src/actions/plugins.ts) and the blocks back, and keeps what the desk shows (the sliders, and why
// a plugin stopped). Each track's calls go one after another, so its notes reach the plugin in the order played.
import { useSyncExternalStore } from "react";
import { check } from "@rustybuns/util/guard";
import { findPlugins, openPluginEditor, renderPlugin, startPlugin, stopPlugin } from "../actions/plugins.ts";
import { BlockReply, EditorReply, PluginChoices, StartReply, type ParamChange, type PluginChoice, type PluginParam, type TrackPlugin } from "../plugin-track.ts";
import type { Project } from "../project.ts";
import type { FromWorklet, ToWorklet } from "../engine/messages.ts";

/** What the desk shows for a plugin track: its sliders once it's running, or why it isn't. */
export interface PluginShown { name: string; params: PluginParam[]; error: string | null; starting: boolean; editor: boolean }

/** A block off the wire as samples (little-endian f32, what every desktop is). */
export function fromBase64(s: string): Float32Array {
  const bin = atob(s), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer, 0, bytes.length >> 2);
}

/** The plugins on this computer, for the track menu; none off the desktop. */
export async function pluginChoices(): Promise<PluginChoice[]> {
  try { return check(PluginChoices, await findPlugins()) ?? []; } catch { return []; }
}

const keyOf = (p: TrackPlugin) => `${p.path}#${p.index}`;
const why = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^action [^:]+: \d+ /, "");

export class PluginPump {
  private running = new Map<number, { key: string; values: Map<number, number>; chain: Promise<unknown> }>();
  private shown = new Map<number, PluginShown>();
  private subs = new Set<() => void>();
  private snapshot: ReadonlyMap<number, PluginShown> = new Map();

  constructor(private send: (m: ToWorklet, transfer?: Transferable[]) => void, private sampleRate: number,
    private host = { renderPlugin, startPlugin, stopPlugin, openPluginEditor },
    /** Knobs turned in a plugin's own editor (#5267): the desk moves its sliders to match. */
    private onChanges: (track: number, changes: ParamChange[]) => void = () => {}) {}

  /** Opens track `t`'s plugin's own window; a string says why it couldn't. */
  async openEditor(t: number, title: string): Promise<string | null> {
    const r = await this.host.openPluginEditor(t, title).then((v) => check(EditorReply, v), (e) => ({ error: why(e) }));
    return r ? r.error ?? null : "the host sent back something else";
  }

  /** Each track's plugin as the project says: started, stopped, or its moved sliders sent on. */
  sync(p: Project) {
    p.tracks.forEach((tr, t) => {
      const run = this.running.get(t), plug = tr.plugin;
      if (!plug) { if (run) this.stop(t); return; }
      if (!run || run.key !== keyOf(plug)) { this.start(t, plug); return; }
      for (const { id, v } of plug.values) {
        if (run.values.get(id) === v) continue;
        run.values.set(id, v);
        this.send({ t: "pluginParam", track: t, id, v });
        const s = this.shown.get(t);
        if (s) this.show(t, { ...s, params: s.params.map((q) => (q.id === id ? { ...q, value: v } : q)) });
      }
    });
  }

  /** The worklet wants more of a track's sound: the host renders it after the notes, and the block goes back in. */
  ask(m: Extract<FromWorklet, { t: "pluginAsk" }>) {
    const run = this.running.get(m.track);
    const back = (pcm: Float32Array, ok: boolean) => this.send({ t: "pluginBlock", track: m.track, pcm, ok }, [pcm.buffer]);
    if (!run) return back(new Float32Array(0), false);
    run.chain = run.chain.then(async () => {
      if (this.running.get(m.track) !== run) return;
      const r = await this.host.renderPlugin({ track: m.track, frames: m.frames, events: m.events }).then((v) => check(BlockReply, v), (e): BlockReply => ({ pcm: "", ok: false, error: why(e) }));
      if (r?.ok) {
        back(fromBase64(r.pcm), true);
        // the plugin already has these values: noted as sent, so the desk's echo of them isn't sent back
        if (r.changes?.length) { for (const c of r.changes) run.values.set(c.id, c.value); this.onChanges(m.track, r.changes); }
        return;
      }
      back(new Float32Array(0), false);
      this.fail(m.track, r?.error ?? "the host sent back something else");
    });
  }

  private start(t: number, plug: TrackPlugin) {
    const was = this.running.get(t);
    const run = { key: keyOf(plug), values: new Map(plug.values.map((x) => [x.id, x.v])), chain: Promise.resolve() as Promise<unknown> };
    this.running.set(t, run);
    this.show(t, { name: plug.name, params: [], error: null, starting: true, editor: false });
    run.chain = (was?.chain ?? Promise.resolve()).then(async () => {
      const r = await this.host.startPlugin(t, plug, this.sampleRate).then((v) => check(StartReply, v), (e): StartReply => ({ params: [], editor: false, error: why(e) }));
      if (this.running.get(t) !== run) return;
      if (!r || r.error) return this.fail(t, r?.error ?? "the host sent back something else");
      this.show(t, { name: plug.name, params: r.params, error: null, starting: false, editor: r.editor });
      this.send({ t: "plugin", track: t, on: true });   // a plugin chosen again after one failed gets another go
    });
  }

  private stop(t: number) {
    const run = this.running.get(t);
    this.running.delete(t);
    this.shown.delete(t);
    this.changed();
    void run?.chain.then(() => this.host.stopPlugin(t)).catch(() => {});
  }

  private fail(t: number, error: string) {
    const s = this.shown.get(t);
    this.show(t, { name: s?.name ?? "Plugin", params: s?.params ?? [], error, starting: false, editor: false });
  }

  private show(t: number, s: PluginShown) { this.shown.set(t, s); this.changed(); }
  private changed() { this.snapshot = new Map(this.shown); for (const f of this.subs) f(); }

  /** What the desk shows per plugin track. */
  get state(): ReadonlyMap<number, PluginShown> { return this.snapshot; }
  subscribe = (f: () => void) => { this.subs.add(f); return () => { this.subs.delete(f); }; };
}

const NONE: ReadonlyMap<number, PluginShown> = new Map();
export function usePlugins(pump: PluginPump | null): ReadonlyMap<number, PluginShown> {
  return useSyncExternalStore((f) => pump?.subscribe(f) ?? (() => {}), () => pump?.state ?? NONE);
}
