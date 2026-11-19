// The page's side of a plugin track (#5265): it starts each track's plugin on the desktop host, carries the worklet's
// asks to the host (src/actions/plugins.ts) and the blocks back, and keeps what the desk shows (the sliders, and why
// a plugin stopped). Each track's calls go one after another, so its notes reach the plugin in the order played.
import { useSyncExternalStore } from "react";
import { check } from "@rustybuns/util/guard";
import { findPlugins, openPluginEditor, renderPlugin, startPlugin, stopPlugin } from "../actions/plugins.ts";
import { BlockReply, EditorReply, PluginChoices, StartReply, type ParamChange, type PluginChoice, type PluginParam, type TrackPlugin } from "../plugin-track.ts";
import type { Project } from "../project.ts";
import type { FromWorklet, ToWorklet } from "../engine/messages.ts";
import { P } from "../engine/params.ts";
import { audible } from "../project.ts";
import { WEB_CHOICES, type WamRack, type WebStart } from "./wam.ts";

/** What the desk shows for a plugin track: its sliders once it's running, or why it isn't. */
export interface PluginShown { name: string; params: PluginParam[]; error: string | null; starting: boolean; editor: boolean; /** A web plugin waits for this player to say its site may run code here. */ site?: string }

/** A block off the wire as samples (little-endian f32, what every desktop is). */
export function fromBase64(s: string): Float32Array {
  const bin = atob(s), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer, 0, bytes.length >> 2);
}

/** The plugins for the track menu: the CLAP ones on this computer (none off the desktop), then the web ones FM DAW carries. */
export async function pluginChoices(): Promise<PluginChoice[]> {
  let found: PluginChoice[] = [];
  try { found = check(PluginChoices, await findPlugins()) ?? []; } catch { /* a browser: no host to ask */ }
  return [...found, ...WEB_CHOICES];
}

const keyOf = (p: TrackPlugin) => `${p.web ? "web:" : ""}${p.path}#${p.index}`;
const why = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^action [^:]+: \d+ /, "");

export class PluginPump {
  private running = new Map<number, { key: string; web: boolean; values: Map<number, number>; chain: Promise<unknown> }>();
  private shown = new Map<number, PluginShown>();
  private subs = new Set<() => void>();
  private snapshot: ReadonlyMap<number, PluginShown> = new Map();

  constructor(private send: (m: ToWorklet, transfer?: Transferable[]) => void, private sampleRate: number,
    private host = { renderPlugin, startPlugin, stopPlugin, openPluginEditor },
    /** Knobs turned in a plugin's own editor (#5267): the desk moves its sliders to match. */
    private onChanges: (track: number, changes: ParamChange[]) => void = () => {},
    /** The page's own host for Web Audio Modules (src/ui/wam.ts); without one a web plugin says it can't play here. */
    private web: WamRack | null = null) {}

  /** Opens track `t`'s plugin's own window; a string says why it couldn't. */
  async openEditor(t: number, title: string): Promise<string | null> {
    const run = this.running.get(t);
    if (run?.web) {
      // a knob turned in the plugin's own panel moves the desk's slider when the panel closes
      const open = await this.web?.open(t, title, (changes) => {
        if (this.running.get(t) !== run || !changes.length) return;
        for (const c of changes) run.values.set(c.id, c.value);
        this.onChanges(t, changes);
      });
      return open ? null : "This plugin has no panel of its own; its sliders are here.";
    }
    const r = await this.host.openPluginEditor(t, title).then((v) => check(EditorReply, v), (e) => ({ error: why(e) }));
    return r ? r.error ?? null : "the host sent back something else";
  }

  /** Each track's plugin as the project says: started, stopped, or its moved sliders sent on. */
  sync(p: Project) {
    const on = audible(p);
    p.tracks.forEach((tr, t) => {
      const run = this.running.get(t), plug = tr.plugin;
      if (!plug) { if (run) this.stop(t); return; }
      const level = on[t] ? tr.params[P.GAIN] ?? 0 : 0;
      if (!run || run.key !== keyOf(plug)) { this.start(t, plug, level); return; }
      if (run.web) this.web?.level(t, level);
      for (const { id, v } of plug.values) {
        if (run.values.get(id) === v) continue;
        run.values.set(id, v);
        if (run.web) this.web?.known(t, id, v);
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
      // a web plugin sounds in the page's own graph: the ask only carries its notes, and gets silence back
      if (run.web) { this.web?.play(m.track, m.events); return back(new Float32Array(m.frames * 2), true); }
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

  /** This player says the site track `t`'s plugin comes from may run code here: it loads. */
  trust(t: number, p: Project) {
    const site = this.shown.get(t)?.site, plug = p.tracks[t]?.plugin;
    if (!site || !plug) return;
    this.web?.trust(site);
    this.running.delete(t);
    this.sync(p);
  }

  private start(t: number, plug: TrackPlugin, level: number) {
    const was = this.running.get(t);
    if (was?.web) this.web?.stop(t);
    const run = { key: keyOf(plug), web: !!plug.web, values: new Map(plug.values.map((x) => [x.id, x.v])), chain: Promise.resolve() as Promise<unknown> };
    this.running.set(t, run);
    this.show(t, { name: plug.name, params: [], error: null, starting: true, editor: false });
    run.chain = (was?.chain ?? Promise.resolve()).then(async () => {
      if (plug.web) {
        const w: WebStart = await (this.web?.start(t, plug) ?? { error: "a web plugin plays in FM DAW's own page" });
        if (this.running.get(t) !== run) return;
        if ("error" in w) return this.show(t, { name: plug.name, params: [], error: w.error, starting: false, editor: false, ...(w.site ? { site: w.site } : {}) });
        this.web?.level(t, level);
        this.show(t, { name: plug.name, params: w.params, error: null, starting: false, editor: w.editor });
        return this.send({ t: "plugin", track: t, on: true });
      }
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
    void run?.chain.then(() => (run.web ? this.web?.stop(t) : this.host.stopPlugin(t))).catch(() => {});
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
