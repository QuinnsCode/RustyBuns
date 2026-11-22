// The browser's own plugin host (#4899): a Web Audio Module (the WAM 2 API, webaudiomodules.com) plays a plugin track
// in the page, where the desktop's CLAP host can't reach. The module is a node in the page's audio graph: the track's
// notes reach it as MIDI, and its sound goes through the track's fader into the engine's second input, so it gets the
// master's Shape, Squash and meters like every other track. A WAM can also be an effect on a track (#5359): the
// track's FM sound leaves the worklet on a channel of its own, goes through the module, and comes back on the same
// input as the instruments' sound (a render quantum late, the delay a loop through the audio thread costs).
//
// A plugin is code. One from another site runs in this page with everything the page can do, and a groove is shared:
// a friend's track can name any address. So a module from another site loads only after this player says its site
// is fine, on this computer (`trust`); until then the track is silent and says why.
import { check, num, obj, opt, raw, rec, str } from "@rustybuns/util/guard";
import type { ParamChange, PluginChoice, PluginEvent, PluginParam, TrackPlugin } from "../plugin-track.ts";

/** The modules FM DAW carries itself: no site to trust, and there with no network. `effect`: one for a track's Insert. */
export const BUILT_IN: Record<string, { name: string; effect?: boolean; load: () => Promise<unknown> }> = {
  "builtin:tone": { name: "Test Tone (web)", load: () => import("../wam/tone.ts") },
  "builtin:gain": { name: "Gain (web)", effect: true, load: () => import("../wam/gain.ts") },
};
const builtIns = (effect: boolean): PluginChoice[] => Object.entries(BUILT_IN).filter(([, b]) => !!b.effect === effect).map(([path, b]) => ({ path, index: 0, name: b.name, vendor: "FM DAW", web: true }));
/** The instruments for a track's Plays menu, and the effects for its Insert menu. */
export const WEB_CHOICES = builtIns(false), WEB_EFFECTS = builtIns(true);

/** A slider as a WAM describes it (WamParameterInfo, the fields a desk shows). */
const WamInfo = obj({ label: opt(str(500, { min: 0 })), type: opt(str(40)), defaultValue: num(-1e300, 1e300), minValue: num(-1e300, 1e300), maxValue: num(-1e300, 1e300) });
const WamInfos = rec(WamInfo, 4096);
const WamValues = rec(obj({ value: num(-1e300, 1e300) }), 4096);

/** The part of a WAM's node this host uses (WamNode in @webaudiomodules/api). */
export interface WamNode {
  connect(to: AudioNode, output?: number, input?: number): unknown;
  disconnect?(to?: AudioNode): unknown;
  getParameterInfo(): Promise<unknown>;
  getParameterValues(normalized: boolean): Promise<unknown>;
  setParameterValues(values: Record<string, { id: string; value: number; normalized: boolean }>): unknown;
  scheduleEvents(...events: WamEvent[]): void;
  destroy(): void;
}
/** A note (MIDI bytes) or a slider move, at a time on the module's audio context. */
export type WamEvent =
  | { type: "wam-midi"; time: number; data: { bytes: [number, number, number] } }
  | { type: "wam-automation"; time: number; data: { id: string; value: number; normalized: false } };
/** A track's fader on a plugin's sound (a GainNode, the part used here). */
export interface Fader { gain: { value: number; setTargetAtTime(v: number, at: number, timeConstant: number): unknown }; disconnect(): void }
interface WamInstance { audioNode: WamNode; descriptor?: unknown; createGui?: () => Promise<unknown>; destroyGui?: (el: Element) => void }
export interface WamClass { createInstance(groupId: string, ctx: unknown): Promise<unknown> }

const has = <K extends string>(v: unknown, ...keys: K[]): v is { [P in K]: unknown } => (typeof v === "object" || typeof v === "function") && v !== null && keys.every((k) => k in v);
const isClass = (v: unknown): v is WamClass => has(v, "createInstance") && typeof v.createInstance === "function";
const NODE = ["connect", "getParameterInfo", "getParameterValues", "setParameterValues", "scheduleEvents", "destroy"] as const;
const isInstance = (v: unknown): v is WamInstance => has(v, "audioNode") && has(v.audioNode, ...NODE) && NODE.every((k) => typeof Reflect.get(Object(v.audioNode), k) === "function");

/** A slider's number on the desk: a WAM names its sliders with text, a track keeps numbers (FNV-1a of the name). */
export function paramId(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Where a module's address points: one of ours, or a site (https, or this page's own). Null: not an address a page may load. */
export function siteOf(path: string, here: string): { site: string | null; url: string } | null {
  if (path in BUILT_IN) return { site: null, url: path };
  let u: URL;
  try { u = new URL(path, here); } catch { return null; }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null;
  return { site: u.origin === new URL(here).origin ? null : u.origin, url: u.href };
}

const TRUST_KEY = "fm-daw:plugin-sites";
/** The sites this player said may run plugins here, kept on this computer only. */
export function trustedSites(store: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): string[] {
  try { return Object.keys(check(rec(raw, 200), JSON.parse(store?.getItem(TRUST_KEY) ?? "{}")) ?? {}); } catch { return []; }
}

export type WebStart = { params: PluginParam[]; editor: boolean } | { error: string; site?: string };

/** What the rack needs of the page: its clock, how a module is fetched and made, and where its sound goes. */
export interface RackDeps {
  /** The audio context's time, in seconds. */
  now(): number;
  here: string;
  /** Sets the page's context up as a WAM host (once per context); answers the host's group id. */
  host(): Promise<string>;
  load(url: string): Promise<unknown>;
  /** One of the module's plugins, made on the page's audio context in the host's group. */
  make(cls: WamClass, group: string): Promise<unknown>;
  /**
   * A fader at 0 between `node` and the engine's second input, where every web plugin's sound goes; `node` also goes,
   * before the fader, to track `track`'s own tap, so the sesh can hear it (src/studio/plugin-line.ts).
   */
  fader(node: WamNode, track: number): Fader;
  /** An effect rack's: `node` between track `track`'s own sound out of the engine and the engine's second input. */
  insert?(node: WamNode, track: number): Fader;
  /** Puts a plugin's own panel on the page under `title`; `closed` runs when the player shuts it. */
  show?(el: Element, title: string, closed: () => void): void;
  store?: Pick<Storage, "getItem" | "setItem">;
  /** An audio context of its own, `frames` long at `sampleRate`, that renders as fast as it can: for a bounce. */
  offline?(sampleRate: number, frames: number): OfflineRig;
}

/** An offline context set up to host one module and hand back what it played. */
export interface OfflineRig {
  /** Sets the context up as a WAM host; answers the host's group id. */
  host(): Promise<string>;
  make(cls: WamClass, group: string): Promise<unknown>;
  /** `node` to the context's speakers. */
  out(node: WamNode): void;
  /** Renders it all: interleaved stereo, `frames` long. */
  render(): Promise<Float32Array>;
}

/** How often a plugin's own panel, while open, says which knobs were turned in it. */
const PANEL_POLL_MS = 400;

interface Slot { node: WamNode; inst: WamInstance; gain: Fader; names: Map<number, string>; params: PluginParam[]; gui?: Element }

/** What a module's descriptor says it is: an instrument (plays notes), an effect (sound in, sound out), or it doesn't say. */
const Descriptor = obj({ isInstrument: opt(raw), hasAudioInput: opt(raw) });
function kindOf(inst: WamInstance): "instrument" | "effect" | null {
  const d = check(Descriptor, inst.descriptor);
  if (d?.isInstrument === true) return "instrument";
  return d?.isInstrument === false && d.hasAudioInput === true ? "effect" : null;
}

export class WamRack {
  private slots = new Map<number, Slot>();
  /** `kind`: what this rack holds, a track's instrument (Plays) or the effect on its sound (Insert). */
  constructor(private d: RackDeps, private kind: "instrument" | "effect" = "instrument") {}

  /** This player says `site` may run plugins in this page, from now on. */
  trust(site: string) {
    const all = Object.fromEntries([...trustedSites(this.d.store), site].map((s) => [s, 1]));
    try { this.d.store?.setItem(TRUST_KEY, JSON.stringify(all)); } catch { /* a private window: it holds for nothing, and asks again */ }
    this.once.add(site);
  }
  private once = new Set<string>();
  private trusted(site: string) { return this.once.has(site) || trustedSites(this.d.store).includes(site); }

  /** Starts `plug` on track `t`: its sliders, or why it didn't start (with `site` when the reason is that nobody said its site is fine). */
  async start(t: number, plug: TrackPlugin): Promise<WebStart> {
    this.stop(t);
    const at = siteOf(plug.path, this.d.here);
    if (!at) return { error: "that isn't a web address a plugin can load from (https only)" };
    if (at.site && !this.trusted(at.site)) return { error: `${plug.name} is a plugin from ${new URL(at.site).host}, and nobody here has said that site may run code in this page`, site: at.site };
    try {
      const group = await this.d.host();
      const cls = await this.module(at.url);
      if (typeof cls === "string") return { error: cls };
      const made = await this.made(cls, group, plug);
      if (typeof made === "string") return { error: made };
      const { inst, node, names, params } = made;
      const is = kindOf(inst);
      if (is && is !== this.kind) {
        try { node.destroy(); } catch { /* gone either way */ }
        return { error: is === "instrument" ? `${plug.name} is an instrument: it plays notes, so it goes under Plays` : `${plug.name} is an effect: it goes in a track's Insert` };
      }
      const gain = this.kind === "effect" ? this.d.insert?.(node, t) : this.d.fader(node, t);
      if (!gain) { try { node.destroy(); } catch { /* gone either way */ } return { error: "this page can't put an effect on a track" }; }
      this.slots.set(t, { node, inst, gain, names, params });
      return { params: params.map((q) => ({ ...q })), editor: typeof inst.createGui === "function" && !!this.d.show };
    } catch (e) {
      return { error: `it wouldn't load (${e instanceof Error ? e.message : String(e)})` };
    }
  }

  /** The module's plugin class, or why the address isn't one. */
  private async module(url: string): Promise<WamClass | string> {
    const mod = await (BUILT_IN[url]?.load() ?? this.d.load(url));
    const cls = has(mod, "default") ? mod.default : null;
    return isClass(cls) ? cls : "that address isn't a Web Audio Module";
  }

  /** One of `cls`'s plugins with `plug`'s sliders set: its node and its sliders as the desk numbers them. */
  private async made(cls: WamClass, group: string, plug: TrackPlugin, make = (c: WamClass, g: string) => this.d.make(c, g)) {
    const inst = await make(cls, group);
    if (!isInstance(inst)) return "that module didn't make a sound node";
    const node = inst.audioNode;
    const infos = check(WamInfos, await node.getParameterInfo()) ?? {};
    const now = check(WamValues, await node.getParameterValues(false)) ?? {};
    const names = new Map<number, string>();
    const params: PluginParam[] = Object.entries(infos).map(([name, q]) => {
      const id = paramId(name);
      names.set(id, name);
      const value = plug.values.find((x) => x.id === id)?.v ?? now[name]?.value ?? q.defaultValue;
      return { id, name: q.label || name, module: "", min: q.minValue, max: q.maxValue, default: q.defaultValue, value, stepped: q.type !== undefined && q.type !== "float" };
    });
    for (const { id, v } of plug.values) this.set({ node, names }, id, v);
    return { inst, node, names, params };
  }

  /**
   * Track `t`'s sound for a bounce (#5360): a copy of `plug` of its own on an offline context, played `events` (each
   * `at` its frame), `frames` long at `sampleRate`, interleaved stereo. Throws why it couldn't (the same site rule as
   * playing: a site nobody said yes to isn't loaded).
   */
  async bounce(plug: TrackPlugin, events: PluginEvent[], sampleRate: number, frames: number): Promise<Float32Array> {
    const at = siteOf(plug.path, this.d.here);
    if (!at) throw new Error("that isn't a web address a plugin can load from");
    if (at.site && !this.trusted(at.site)) throw new Error(`nobody here has said ${new URL(at.site).host} may run code in this page`);
    if (!this.d.offline) throw new Error("this page can't render a web plugin offline");
    const rig = this.d.offline(sampleRate, frames);
    const group = await rig.host();
    const cls = await this.module(at.url);
    if (typeof cls === "string") throw new Error(cls);
    const made = await this.made(cls, group, plug, rig.make);
    if (typeof made === "string") throw new Error(made);
    const { node, names } = made;
    rig.out(node);
    node.scheduleEvents(...events.flatMap((e): WamEvent[] => {
      const time = (e.at ?? 0) / sampleRate;
      if (e.t !== "set") return [{ type: "wam-midi", time, data: { bytes: e.t === "on" ? [0x90, e.key, Math.max(1, Math.round(e.vel * 127))] : [0x80, e.key, 0] } }];
      const id = names.get(e.id);
      return id === undefined ? [] : [{ type: "wam-automation", time, data: { id, value: e.v, normalized: false } }];
    }));
    // the module's port answers in order: once this comes back, the audio thread has every note above
    await node.getParameterValues(false);
    try { return await rig.render(); } finally { try { node.destroy(); } catch { /* gone either way */ } }
  }

  private set(s: Pick<Slot, "node" | "names">, id: number, v: number) {
    const name = s.names.get(id);
    if (name !== undefined) void s.node.setParameterValues({ [name]: { id: name, value: v, normalized: false } });
  }

  /** The track's notes and slider moves, played now. */
  play(t: number, events: PluginEvent[]) {
    const s = this.slots.get(t);
    if (!s) return;
    const time = this.d.now();
    for (const e of events) {
      if (e.t === "set") this.set(s, e.id, e.v);
      else s.node.scheduleEvents({ type: "wam-midi", time, data: { bytes: e.t === "on" ? [0x90, e.key, Math.max(1, Math.round(e.vel * 127))] : [0x80, e.key, 0] } });
    }
  }

  /** Slider `id` moved on the desk: straight to the module (an effect has no notes for it to ride along with). */
  param(t: number, id: number, v: number) {
    const s = this.slots.get(t);
    if (!s) return;
    this.set(s, id, v);
    this.known(t, id, v);
  }

  /** The track's fader (0 when it's muted), moved without a click. */
  level(t: number, g: number) {
    const s = this.slots.get(t);
    if (s) s.gain.gain.setTargetAtTime(g, this.d.now(), 0.01);
  }

  /** Shows the plugin's own panel; false when it has none. `moved` gets the sliders turned in it as they're turned, and once more when it's shut. */
  async open(t: number, title: string, moved: (changes: ParamChange[]) => void): Promise<boolean> {
    const s = this.slots.get(t);
    if (!s?.inst.createGui || !this.d.show) return false;
    const el = s.gui ?? await s.inst.createGui().catch(() => null);
    if (!(el instanceof Element)) return false;
    s.gui = el;
    const say = () => { void this.moved(t).then((c) => { if (c.length) moved(c); }); };
    const poll = setInterval(() => { if (this.slots.get(t) === s) say(); else clearInterval(poll); }, PANEL_POLL_MS);
    this.d.show(el, title, () => { clearInterval(poll); say(); });
    return true;
  }

  /** The sliders that moved since the desk last knew them (turned in the plugin's own panel). */
  private async moved(t: number): Promise<ParamChange[]> {
    const s = this.slots.get(t);
    if (!s) return [];
    const now = check(WamValues, await s.node.getParameterValues(false)) ?? {};
    const out: ParamChange[] = [];
    for (const q of s.params) {
      const v = now[s.names.get(q.id) ?? ""]?.value;
      if (v !== undefined && Math.abs(v - q.value) > 1e-9) { q.value = v; out.push({ id: q.id, value: v }); }
    }
    return out;
  }
  /** The desk moved slider `id` itself: not a move to report back. */
  known(t: number, id: number, v: number) { const q = this.slots.get(t)?.params.find((x) => x.id === id); if (q) q.value = v; }

  stop(t: number) {
    const s = this.slots.get(t);
    if (!s) return;
    this.slots.delete(t);
    if (s.gui) { s.gui.remove(); s.inst.destroyGui?.(s.gui); }
    try { s.node.destroy(); } catch { /* a module that throws on the way out is still gone */ }
    s.gain.disconnect();
  }
}

/** A plugin's own panel in a small window over the desk, shut with its Close button. */
export function showPanel(el: Element, title: string, closed: () => void) {
  const box = document.createElement("dialog");
  box.className = "plugin-window";
  box.setAttribute("aria-label", title);
  const head = document.createElement("header"), name = document.createElement("span"), close = document.createElement("button");
  name.className = "silk";
  name.textContent = title;
  close.className = "ghost";
  close.textContent = "Close";
  close.onclick = () => box.close();
  head.append(name, close);
  box.append(head, el);
  box.addEventListener("close", () => { box.remove(); closed(); });
  document.body.append(box);
  box.show();
}

const hosts = new WeakMap<BaseAudioContext, Promise<string>>();
/** `ctx` set up as a WAM host, once: the host's group id. */
function wamHost(ctx: BaseAudioContext): Promise<string> {
  let g = hosts.get(ctx);
  if (!g) hosts.set(ctx, (g = import("@webaudiomodules/sdk").then((sdk) => sdk.initializeWamHost(ctx)).then((ids) => ids[0])));
  return g;
}

/** A module rendered on an OfflineAudioContext of its own: the bounce's copy of a web plugin. */
export function offlineRig(sampleRate: number, frames: number): OfflineRig {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.max(1, frames), sampleRate });
  return {
    host: () => wamHost(ctx),
    make: (cls, group) => cls.createInstance(group, ctx),
    out: (node) => { node.connect(ctx.destination); },
    async render() {
      const b = await ctx.startRendering(), l = b.getChannelData(0), r = b.numberOfChannels > 1 ? b.getChannelData(1) : l;
      const out = new Float32Array(2 * frames);
      for (let f = 0; f < frames; f++) { out[2 * f] = l[f] ?? 0; out[2 * f + 1] = r[f] ?? 0; }
      return out;
    },
  };
}

/**
 * The page's rack: modules play into `bus` on `ctx`, each also into its track's channel of `taps` (one per track), the
 * WAM SDK's host half loaded when the first one starts. Before the audio is on (`audio` null) it can only bounce.
 * An `effect` rack's modules each take their track's channel of `inserts` (the engine's second output) instead.
 */
export function pageRack(audio: () => { ctx: AudioContext; bus: AudioNode; taps: AudioNode; inserts: AudioNode } | null, kind: "instrument" | "effect" = "instrument"): WamRack {
  const on = () => { const a = audio(); if (!a) throw new Error("the audio isn't on"); return a; };
  return new WamRack({
    now: () => audio()?.ctx.currentTime ?? 0, here: location.href,
    host: async () => wamHost(on().ctx),
    load: (url) => import(/* @vite-ignore */ url),
    make: (cls, group) => cls.createInstance(group, on().ctx),
    fader: (node, track) => {
      const live = on(), g = new GainNode(live.ctx, { gain: 0 }), { taps } = live;
      node.connect(g);
      g.connect(live.bus);
      node.connect(taps, 0, track);
      return { gain: g.gain, disconnect: () => { g.disconnect(); try { node.disconnect?.(taps); } catch { /* already off it */ } } };
    },
    insert: (node, track) => {
      if (!(node instanceof AudioNode)) throw new Error("that module's node isn't on this page's audio");
      const live = on(), g = new GainNode(live.ctx, { gain: 1 });
      // out of the engine and back into it is a loop, and the audio graph only plays a loop with a delay in it: one render quantum
      const d = new DelayNode(live.ctx, { delayTime: 0, maxDelayTime: 0.01 });
      live.inserts.connect(d, track);
      d.connect(node);
      node.connect(g);
      g.connect(live.bus);
      return { gain: g.gain, disconnect: () => { d.disconnect(); g.disconnect(); } };
    },
    offline: offlineRig,
    show: showPanel,
    store: localStorage,
  }, kind);
}
