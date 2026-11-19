// The browser's own plugin host (#4899): a Web Audio Module (the WAM 2 API, webaudiomodules.com) plays a plugin track
// in the page, where the desktop's CLAP host can't reach. The module is a node in the page's audio graph: the track's
// notes reach it as MIDI, and its sound goes through the track's fader into the engine's second input, so it gets the
// master's Shape, Squash and meters like every other track.
//
// A plugin is code. One from another site runs in this page with everything the page can do, and a groove is shared:
// a friend's track can name any address. So a module from another site loads only after this player says its site
// is fine, on this computer (`trust`); until then the track is silent and says why.
import { check, num, obj, opt, raw, rec, str } from "@rustybuns/util/guard";
import type { ParamChange, PluginChoice, PluginEvent, PluginParam, TrackPlugin } from "../plugin-track.ts";

/** The modules FM DAW carries itself: no site to trust, and there with no network. */
export const BUILT_IN: Record<string, { name: string; load: () => Promise<unknown> }> = {
  "builtin:tone": { name: "Test Tone (web)", load: () => import("../wam/tone.ts") },
};
export const WEB_CHOICES: PluginChoice[] = Object.entries(BUILT_IN).map(([path, b]) => ({ path, index: 0, name: b.name, vendor: "FM DAW", web: true }));

/** A slider as a WAM describes it (WamParameterInfo, the fields a desk shows). */
const WamInfo = obj({ label: opt(str(500, { min: 0 })), type: opt(str(40)), defaultValue: num(-1e300, 1e300), minValue: num(-1e300, 1e300), maxValue: num(-1e300, 1e300) });
const WamInfos = rec(WamInfo, 4096);
const WamValues = rec(obj({ value: num(-1e300, 1e300) }), 4096);

/** The part of a WAM's node this host uses (WamNode in @webaudiomodules/api). */
export interface WamNode {
  connect(to: AudioNode): unknown;
  getParameterInfo(): Promise<unknown>;
  getParameterValues(normalized: boolean): Promise<unknown>;
  setParameterValues(values: Record<string, { id: string; value: number; normalized: boolean }>): unknown;
  scheduleEvents(...events: { type: "wam-midi"; time: number; data: { bytes: [number, number, number] } }[]): void;
  destroy(): void;
}
/** A track's fader on a plugin's sound (a GainNode, the part used here). */
export interface Fader { gain: { value: number; setTargetAtTime(v: number, at: number, timeConstant: number): unknown }; disconnect(): void }
interface WamInstance { audioNode: WamNode; createGui?: () => Promise<unknown>; destroyGui?: (el: Element) => void }
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
  /** Sets the context up as a WAM host once; answers the host's group id. */
  host(): Promise<string>;
  load(url: string): Promise<unknown>;
  /** One of the module's plugins, made on the page's audio context in the host's group. */
  make(cls: WamClass, group: string): Promise<unknown>;
  /** A fader at 0 between `node` and the engine's second input, where every web plugin's sound goes. */
  fader(node: WamNode): Fader;
  /** Puts a plugin's own panel on the page under `title`; `closed` runs when the player shuts it. */
  show?(el: Element, title: string, closed: () => void): void;
  store?: Pick<Storage, "getItem" | "setItem">;
}

interface Slot { node: WamNode; inst: WamInstance; gain: Fader; names: Map<number, string>; params: PluginParam[]; gui?: Element }

export class WamRack {
  private slots = new Map<number, Slot>();
  private group: Promise<string> | null = null;
  constructor(private d: RackDeps) {}

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
      const group = await (this.group ??= this.d.host());
      const mod = await (BUILT_IN[at.url]?.load() ?? this.d.load(at.url));
      const cls = has(mod, "default") ? mod.default : null;
      if (!isClass(cls)) return { error: "that address isn't a Web Audio Module" };
      const inst = await this.d.make(cls, group);
      if (!isInstance(inst)) return { error: "that module didn't make a sound node" };
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
      const gain = this.d.fader(node);
      const slot: Slot = { node, inst, gain, names, params };
      this.slots.set(t, slot);
      for (const { id, v } of plug.values) this.set(slot, id, v);
      return { params: params.map((q) => ({ ...q })), editor: typeof inst.createGui === "function" && !!this.d.show };
    } catch (e) {
      return { error: `it wouldn't load (${e instanceof Error ? e.message : String(e)})` };
    }
  }

  private set(s: Slot, id: number, v: number) {
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

  /** The track's fader (0 when it's muted), moved without a click. */
  level(t: number, g: number) {
    const s = this.slots.get(t);
    if (s) s.gain.gain.setTargetAtTime(g, this.d.now(), 0.01);
  }

  /** Shows the plugin's own panel; false when it has none. `moved` gets the sliders turned in it once it's shut. */
  async open(t: number, title: string, moved: (changes: ParamChange[]) => void): Promise<boolean> {
    const s = this.slots.get(t);
    if (!s?.inst.createGui || !this.d.show) return false;
    const el = s.gui ?? await s.inst.createGui().catch(() => null);
    if (!(el instanceof Element)) return false;
    s.gui = el;
    this.d.show(el, title, () => { void this.moved(t).then(moved); });
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

/** The page's rack: modules play into `bus` on `ctx`, the WAM SDK's host half loaded when the first one starts. */
export function pageRack(ctx: AudioContext, bus: AudioNode): WamRack {
  return new WamRack({
    now: () => ctx.currentTime, here: location.href,
    host: async () => (await (await import("@webaudiomodules/sdk")).initializeWamHost(ctx))[0],
    load: (url) => import(/* @vite-ignore */ url),
    make: (cls, group) => cls.createInstance(group, ctx),
    fader: (node) => { const g = new GainNode(ctx, { gain: 0 }); node.connect(g); g.connect(bus); return g; },
    show: showPanel,
    store: localStorage,
  });
}
