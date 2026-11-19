// MIDI learn: which knob on a MIDI controller moves which parameter of the
// selected track. Turn Learn on, touch a slider, move a knob: that CC now
// drives it. The map is this browser's (localStorage), not the project's, since
// it belongs to your controller, not the song.
import { useSyncExternalStore } from "react";
import { arr, bool, check, int, num, obj, opt, type Of } from "@rustybuns/util/guard";
import { NPARAMS, OP_FIELDS, P, RANGES } from "../engine/params.ts";

/** A plugin track's slider (#5265): the plugin's parameter id and its travel; `i` is then unused. */
const PLUG = obj({ id: int(0, 2 ** 32 - 1), lo: num(-1e300, 1e300), hi: num(-1e300, 1e300) });
const MAPPING = obj({ cc: int(0, 119), i: int(0, NPARAMS - 1), log: bool(false), plug: opt(PLUG) });
export type Mapping = Of<typeof MAPPING>;
const MAP = arr(MAPPING, 120, { drop: true });

/** Out of the box: the mod wheel is wobble depth and CC 74 (brightness) is cutoff. */
export const DEFAULT_MAP: Mapping[] = [{ cc: 1, i: P.LFO_CUT, log: false }, { cc: 74, i: P.CUTOFF, log: false }];
const KEY = "fm-daw:midi-map";

const OP_NAMES = ["ratio", "level", "attack", "decay", "sustain", "release"];
const NAMES = new Map<number, string>(Object.entries(P).flatMap(([k, v]) => (typeof v === "number" ? [[v, k.toLowerCase().replace(/_/g, " ")] as const] : [])));
/** A short name for param `i`, for the list of mappings. */
export const paramName = (i: number) =>
  i < OP_FIELDS * 4 ? `op ${Math.floor(i / OP_FIELDS) + 1} ${OP_NAMES[i % OP_FIELDS]}` : NAMES.get(i) ?? `param ${i}`;

/** A CC's 0..1 as a value of param `i`, along the same travel as its slider. */
export function ccValue(m: Mapping, x: number): number {
  const t = Math.min(Math.max(x, 0), 1);
  if (m.plug) return m.plug.lo + t * (m.plug.hi - m.plug.lo);
  const [lo, hi] = RANGES[m.i];
  return m.log && lo > 0 ? lo * Math.pow(hi / lo, t) : lo + t * (hi - lo);
}

/** One CC drives one param: learning a CC (or a param) again replaces the old pairing. */
export function learn(map: Mapping[], m: Mapping): Mapping[] {
  const same = (x: Mapping) => (x.plug || m.plug ? x.plug?.id === m.plug?.id : x.i === m.i);
  return [...map.filter((x) => x.cc !== m.cc && !same(x)), m].sort((a, b) => a.cc - b.cc);
}

export function loadMap(): Mapping[] {
  try {
    const s = localStorage.getItem(KEY);
    return (s && check(MAP, JSON.parse(s))) || DEFAULT_MAP;
  } catch { return DEFAULT_MAP; }
}
function saveMap(map: Mapping[]) { try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* private window: this session only */ } }

// The learn state the sliders and the MIDI handler share.
export interface LearnState { on: boolean; armed: { i: number; log: boolean; label: string; plug?: Mapping["plug"] } | null; map: Mapping[] }
let state: LearnState = { on: false, armed: null, map: DEFAULT_MAP };
let loaded = false;
const subs = new Set<() => void>();
function set(next: Partial<LearnState>) {
  state = { ...state, ...next };
  for (const s of subs) s();
}
export function learnState(): LearnState {
  if (!loaded) { loaded = true; state = { ...state, map: loadMap() }; }
  return state;
}
export function useLearn(): LearnState {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, learnState);
}
export function setLearning(on: boolean) { set({ on, armed: null }); }
export function arm(i: number, log: boolean, label: string) { if (state.on) set({ armed: { i, log, label } }); }
/** Arms a plugin track's slider: parameter `id`, from `lo` to `hi`. */
export function armPlugin(id: number, lo: number, hi: number, label: string) { if (state.on) set({ armed: { i: 0, log: false, label, plug: { id, lo, hi } } }); }
export function forget(cc: number) { const map = learnState().map.filter((m) => m.cc !== cc); saveMap(map); set({ map }); }

/**
 * A CC came in. While learning with a slider armed, pair them and return null;
 * otherwise return the param and value it drives, or null if it's unmapped.
 */
export function onCc(cc: number, x: number): { i: number; v: number } | { plug: number; v: number } | null {
  const s = learnState();
  if (s.on && s.armed) {
    const map = learn(s.map, { cc, i: s.armed.i, log: s.armed.log, ...(s.armed.plug ? { plug: s.armed.plug } : {}) });
    saveMap(map);
    set({ map, armed: null });
    return null;
  }
  const m = s.map.find((m) => m.cc === cc);
  if (!m) return null;
  return m.plug ? { plug: m.plug.id, v: ccValue(m, x) } : { i: m.i, v: ccValue(m, x) };
}
