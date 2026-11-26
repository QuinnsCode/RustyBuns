// Q Builder's bench, pure: the nets on a pedal's board a scope can sit on, the riff through the pedal with the volts
// on one of them, and the remake: the board with your parts written into it, as circuit JSON and as tscircuit source
// (`circuits/<board>.tsx` with your values), retested against the board you played with the same riff.
// A swap is always a value in the same holes, so the remake keeps the stock board's layout and footprints.
// The page is src/builder/main.ts.
import { Circuit, ModRun, type Mod, type Netlist } from "@rustybuns/gear/circuit";
import { check, isRecord, obj, oneOf, str } from "@rustybuns/util/guard";
import { PEDALS, type PedalDef } from "./amps.ts";
import { BOARDS, CLIPPERS, farads, isClipper, ohms, sockets, swapOptions, type BoardId, type Clipper, type Swaps } from "./circuits.ts";
import { riff } from "./riff.ts";
import { readBoard } from "./tscircuit.ts";

/**
 * The pedals Q Builder opens: every one with a board. The clip pedals are the board and its knob; the effects also
 * have an LFO or an envelope moving a part (their `mods`), which the bench steps as Q Amp's rig does.
 */
export const BUILDER_PEDALS = ["fuzz", "drive", "dist", "germ", "octave", "phase", "vibe", "trem", "wah", "autowah", "comp"] as const;
export type BuilderPedal = (typeof BUILDER_PEDALS)[number];
export const isBuilderPedal = (id: string): id is BuilderPedal => BUILDER_PEDALS.some((p) => p === id);

/** A builder pedal's definition and board. */
export function builderPedal(id: BuilderPedal): PedalDef & { board: BoardId } {
  const def = PEDALS.find((p) => p.id === id);
  if (!def?.board) throw new Error(`no pedal ${id} with a board`);
  return { ...def, board: def.board };
}

export const SR = 48000;
/** A guitar into a pedal: the riff (peaks at 0.8) is scaled by this to volts, as Q Amp's rigs take it. */
export const INPUT_VOLTS = 0.5;
/** The scope's window: about 21 ms, nearly two periods of the low E (a fuzz turns the riff to hash, so more is a blur). */
export const WINDOW = 1024;

/**
 * The volts a control net reads at full scale. An effect's LFO or envelope follower is off its board, on a net named
 * after its control (GATE, LED, FOOT), so the scope there shows that control, 0 to 1, as 0 V to half the 9 V supply.
 */
export const CONTROL_VOLTS = 4.5;

/** A net a scope can sit on: its connectivity key (what a schematic trace carries), its node in the netlist, and the parts on it. */
export interface ScopeNet { key: string; node: string; label: string; parts: string[] }

const PortKey = obj({ type: oneOf(["source_port"]), subcircuit_connectivity_map_key: str(400) });

/** Every net on `board` that carries the signal, IN first and OUT last: ground and the supply rails are left out. */
export function scopeNets(board: BoardId): ScopeNet[] {
  const json = BOARDS[board], b = readBoard(json);
  const keys = new Set<string>();
  for (const e of Array.isArray(json) ? json : []) { const p = check(PortKey, e); if (p) keys.add(p.subcircuit_connectivity_map_key); }
  const out: ScopeNet[] = [];
  for (const key of keys) {
    const node = b.node(key);
    if (node === "gnd" || out.some((n) => n.node === node)) continue;
    const parts = b.parts.filter((p) => Object.entries(p).some(([k, v]) => k !== "name" && k !== "kind" && v === node)).map((p) => p.name);
    if (!parts.length) continue;
    out.push({ key, node, parts, label: b.nets.includes(node) ? node : parts.join(" · ") });
  }
  const rank = (n: ScopeNet) => (n.node === "IN" ? 0 : n.node === "OUT" ? 2 : 1);
  return out.sort((x, y) => rank(x) - rank(y));
}

/** The riff through a pedal: what comes out, and the volts on `node` if asked, each sample. */
export interface Played { out: Float32Array; at: Float32Array | null; misses: number }

/**
 * `input` (−1 to 1, `INPUT_VOLTS` at full scale) through `net`, run at twice the rate with the input drawn straight
 * between samples, so a clipper's edges alias less. Each output sample is its two steps averaged; `node`'s volts are
 * read at the second. `mods` (a pedal's LFO or envelope) move its parts once a sample, as in Q Amp's rig: an
 * envelope reads the last sample's swing at the output. On a control's own net (GATE for "gate") the scope reads the
 * control, at `CONTROL_VOLTS` full scale.
 */
export function play(net: Netlist, input: Float32Array, node?: string, mods: readonly Mod[] = []): Played {
  const c = new Circuit(net, SR * 2);
  const rest = c.settle(0);
  const runs = mods.map((m) => new ModRun(m, c, SR));
  for (const r of runs) { if (r.slot < 0) throw new Error(`no part listens to control "${r.m.ctl}"`); c.setCtl(r.slot, r.rest); }
  const ctl = node ? runs.find((r) => r.m.ctl.toUpperCase() === node) : undefined;
  const out = new Float32Array(input.length), at = node ? new Float32Array(input.length) : null;
  let last = 0, swing = 0;
  for (let i = 0; i < input.length; i++) {
    let moved = 0;
    for (const r of runs) { const v = r.step(swing, SR); c.setCtl(r.slot, v); if (r === ctl) moved = v; }
    const x = input[i] * INPUT_VOLTS;
    const y0 = c.step((last + x) / 2), y1 = c.step(x);
    out[i] = (y0 + y1) / 2;
    swing = Math.max(Math.abs(y0 - rest), Math.abs(y1 - rest));
    if (at && node) at[i] = ctl ? moved * CONTROL_VOLTS : c.volts(node);
    last = x;
  }
  return { out, at, misses: c.misses };
}

/** The riff, once: every run on the bench plays the same take. */
let take: Float32Array | null = null;
export const theRiff = (): Float32Array => (take ??= riff(SR));

/** Where the scope rests when nothing plays: the window around the riff's loudest note. */
export function restAt(input: Float32Array): number {
  let at = 0, pk = 0;
  for (let i = 0; i < input.length; i++) if (Math.abs(input[i]) > pk) { pk = Math.abs(input[i]); at = i; }
  return Math.max(0, Math.min(input.length - WINDOW, at - WINDOW / 4));
}

/** How a wave on a net swings: its peak volts either way, and the share of its time spent within 10% of a peak (a clipped wave sits there). */
export function swing(wave: Float32Array): { hi: number; lo: number; flat: number } {
  let hi = 0, lo = 0;
  for (const v of wave) { if (v > hi) hi = v; if (v < lo) lo = v; }
  let flat = 0, loud = 0;
  for (const v of wave) {
    if (Math.abs(v) < 0.05 * Math.max(hi, -lo)) continue; // the gaps between notes say nothing about clipping
    loud++;
    if ((v > 0 && v > 0.9 * hi) || (v < 0 && v < 0.9 * lo)) flat++;
  }
  return { hi, lo, flat: loud ? flat / loud : 0 };
}

/** What sits in each diode of a clipper the player changed, by part name. */
function diodeChoices(board: BoardId, swaps: Swaps): Map<string, Clipper> {
  const out = new Map<string, Clipper>();
  for (const s of sockets(board)) {
    const v = swaps[s.id];
    if (s.kind === "clipper" && isClipper(v)) for (const d of s.parts) out.set(d, v);
  }
  return out;
}

/** A value as tscircuit writes it: ohms 2.2k, farads 4.7uF. */
const printed = (kind: "res" | "cap", v: number) => (kind === "res" ? ohms(v) : farads(v).replace("µ", "u"));

/**
 * The board with the player's parts written in, as circuit JSON: each changed resistor and capacitor takes its new
 * value, each changed diode its part number (`DIODE_PARTS`), and an emptied clipper socket leaves the board with its
 * pins and traces. Read back (`readBoard`), it plays as the board you swapped parts on.
 */
export function remakeJson(board: BoardId, swaps: Swaps): unknown[] {
  const values = swapOptions(board, swaps).values ?? {}, diodes = diodeChoices(board, swaps);
  const els: unknown[] = Array.isArray(BOARDS[board]) ? BOARDS[board] : [];
  const gone = new Set<unknown>(), gonePorts = new Set<unknown>();
  for (const e of els) if (isRecord(e) && e.type === "source_component" && typeof e.name === "string" && diodes.get(e.name) === "none") gone.add(e.source_component_id);
  for (const e of els) if (isRecord(e) && e.type === "source_port" && gone.has(e.source_component_id)) gonePorts.add(e.source_port_id);
  const touches = (e: unknown) => isRecord(e) && (gone.has(e.source_component_id) || gonePorts.has(e.source_port_id)
    || (Array.isArray(e.connected_source_port_ids) && e.connected_source_port_ids.some((p) => gonePorts.has(p))));
  return els.filter((e) => !touches(e)).map((e) => {
    if (!isRecord(e) || e.type !== "source_component" || typeof e.name !== "string") return e;
    const v = values[e.name], d = diodes.get(e.name);
    if (v !== undefined && e.ftype === "simple_resistor") return { ...e, resistance: v, display_value: `${printed("res", v)}Ω` };
    if (v !== undefined && e.ftype === "simple_capacitor") return { ...e, capacitance: v, display_value: printed("cap", v) };
    if (d && e.ftype === "simple_diode") return { ...e, manufacturer_part_number: CLIPPERS[d].part };
    return e;
  });
}

/** What the player changed, in a line: "D3 D4 LED (LED-RED-3MM), R3 4.7k". Empty for the stock board. */
export function changes(board: BoardId, swaps: Swaps): string {
  const values = swapOptions(board, swaps).values ?? {};
  return sockets(board).flatMap((s) => {
    const v = swaps[s.id];
    if (s.kind === "clipper") return isClipper(v) ? [`${s.parts.join(" ")} ${CLIPPERS[v].label}${CLIPPERS[v].part ? ` (${CLIPPERS[v].part})` : " (left empty)"}`] : [];
    const to = values[s.id];
    return to === undefined || to === (s.kind === "cap" ? s.farads : s.ohms) ? [] : [`${s.id} ${printed(s.kind, to)}`];
  }).join(", ");
}

/**
 * The board's tscircuit source (`circuits/<board>.tsx`) with the player's parts written in: a changed resistor or
 * capacitor takes its new value, a changed diode a `manufacturerPartNumber`, and an emptied socket keeps its holes
 * and traces with nothing fitted (`doNotPlace`). Open it in tscircuit to route it again or order it; the layout and
 * footprints are the stock board's.
 */
export function remakeTsx(board: BoardId, tsx: string, swaps: Swaps, name: string): string {
  const values = swapOptions(board, swaps).values ?? {}, diodes = diodeChoices(board, swaps);
  const lines = tsx.split("\n").map((l) => {
    const name = /<(resistor|capacitor|diode)\s+name="([^"]+)"/.exec(l);
    if (!name) return l;
    const [, kind, part] = name, v = values[part], d = diodes.get(part);
    if (kind === "resistor" && v !== undefined) return l.replace(/resistance="[^"]*"/, `resistance="${printed("res", v)}"`);
    if (kind === "capacitor" && v !== undefined) return l.replace(/capacitance="[^"]*"/, `capacitance="${printed("cap", v)}"`);
    if (kind === "diode" && d === "none") return l.replace(`name="${part}"`, `name="${part}" doNotPlace`);
    if (kind === "diode" && d) return l.replace(`name="${part}"`, `name="${part}" manufacturerPartNumber="${CLIPPERS[d].part}"`);
    return l;
  });
  const what = changes(board, swaps);
  return [`// Your ${name}, remade in Q Builder${what ? `: ${what}` : ", stock"}. Same holes and footprints as the stock board.`, ...lines].join("\n");
}

/** The remake retested: the riff through your board, its remake and the stock board. */
export interface Retest {
  /** The remake plays the riff as your board does (within a microvolt). */
  same: boolean;
  /** The most the remake and your board ever differ, in volts. */
  apart: number;
  /** Your board against the stock one: how much louder (dB), and how far the waves are apart (dB under the stock's level). */
  louder: number;
  differs: number;
  /** Samples where the solver gave up, on either run (should be 0). */
  misses: number;
}

const rms = (w: Float32Array) => Math.sqrt(w.reduce((s, v) => s + v * v, 0) / Math.max(1, w.length));
const db = (r: number) => (r > 0 ? 20 * Math.log10(r) : -Infinity);

/** Plays the same riff through your board (`def` at `drive` with `swaps`), through the remake read back, and through the stock board. */
export function retest(def: PedalDef & { board: BoardId }, drive: number, swaps: Swaps, input = theRiff()): Retest {
  const mods = def.mods?.(drive);
  const yours = play(def.net(drive, swaps), input, undefined, mods), stock = play(def.net(drive), input, undefined, mods);
  const remade = play(def.net(drive, {}, remakeJson(def.board, swaps)), input, undefined, mods);
  let apart = 0;
  for (let i = 0; i < input.length; i++) apart = Math.max(apart, Math.abs(yours.out[i] - remade.out[i]));
  const diff = yours.out.map((v, i) => v - stock.out[i]);
  return { same: apart < 1e-6, apart, louder: db(rms(yours.out) / rms(stock.out)), differs: db(rms(diff) / rms(stock.out)), misses: yours.misses + remade.misses };
}
