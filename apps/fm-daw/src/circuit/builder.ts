// Q Builder's bench, pure: the nets on a pedal's board a scope can sit on, the riff through the pedal with the volts
// on one of them, and the remake: the board with your parts written into it, as circuit JSON and as tscircuit source
// (`circuits/<board>.tsx` with your values), retested against the board you played with the same riff.
// A swap is a value in the same holes, so the remake keeps the stock board's layout and footprints; an `Edit` (#6423)
// changes the circuit itself (./edits.ts: a part added, removed, or an end moved to another net), and then the layout has to be routed again.
// The page is src/builder/main.ts.
import { Circuit, ModRun, type Mod, type Netlist } from "@rustybuns/gear/circuit";
import { bool, check, isRecord, obj, oneOf, opt, str } from "@rustybuns/util/guard";
import { PEDALS, type PedalDef } from "./amps.ts";
import { CLIPPERS, farads, isClipper, ohms, sockets, swapOptions, type BoardId, type Clipper, type Swaps } from "./circuits.ts";
import { FTYPE, SourcePart, SourcePort, changedJson, editedJson, without, type AddKind, type Edit } from "./edits.ts";
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

const SourceNet = obj({ type: oneOf(["source_net"]), name: str(200), is_ground: opt(bool()), subcircuit_connectivity_map_key: opt(str(400)) });

/** A part on a changed board an edit can reach: a resistor, capacitor or diode (pots are knobs), its value and the net each end is on. */
export interface EditPart { name: string; kind: AddKind; value: string; ends: { pin: "pin1" | "pin2"; key: string }[] }

/** The resistors, capacitors and diodes on `board` with `edits` made, in board order: what can be removed or rewired. */
export function editParts(board: BoardId, edits: readonly Edit[] = []): EditPart[] {
  const els = editedJson(board, edits), b = readBoard(els);
  const ports = els.map((e) => check(SourcePort, e)).filter((p) => p !== null);
  return els.flatMap((e) => {
    const c = check(SourcePart, e);
    const kind = c && (Object.keys(FTYPE) as AddKind[]).find((k) => FTYPE[k] === c.ftype);
    if (!c || !kind || c.name.startsWith("RV")) return [];
    const p = b.parts.find((x) => x.name === c.name);
    const value = p?.kind === "R" ? `${ohms(p.ohms)}Ω` : p?.kind === "C" ? farads(p.farads) : "diode";
    const ends = (["pin1", "pin2"] as const).map((pin) => ({ pin, key: ports.find((q) => q.source_component_id === c.source_component_id && q.name === pin)?.subcircuit_connectivity_map_key ?? "" }));
    return [{ name: c.name, kind, value, ends }];
  });
}

/** The name the next added part of `kind` takes: the lowest free R, C or D number on the board as changed. */
export function nextName(board: BoardId, edits: readonly Edit[], kind: AddKind): string {
  const letter = kind === "res" ? "R" : kind === "cap" ? "C" : "D";
  const taken = new Set(editedJson(board, edits).flatMap((e) => { const c = check(SourcePart, e); return c ? [c.name] : []; }));
  let n = 1;
  while (taken.has(`${letter}${n}`)) n++;
  return `${letter}${n}`;
}

/** The nets an added part's ends can go to: every signal net (`scopeNets`) and ground, by connectivity key. */
export function editNets(board: BoardId, edits: readonly Edit[] = []): { key: string; label: string }[] {
  const els = editedJson(board, edits);
  const gnd = els.map((e) => check(SourceNet, e)).find((n) => n?.is_ground && n.subcircuit_connectivity_map_key);
  return [...scopeNets(board, edits).map((n) => ({ key: n.key, label: n.label })), ...(gnd?.subcircuit_connectivity_map_key ? [{ key: gnd.subcircuit_connectivity_map_key, label: "GND" }] : [])];
}

/** A part's value as typed: "10k", "4.7u", "100n", "22p", "1M", "470" (ohms or farads, a trailing Ω or F dropped). NaN when it isn't one. */
export function parseValue(text: string): number {
  const m = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*([pnuµmkKM]?)\s*(?:Ω|ohms?|F)?\s*$/i.exec(text);
  if (!m) return NaN;
  const scale: Record<string, number> = { p: 1e-12, n: 1e-9, u: 1e-6, µ: 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, "": 1 };
  return Number(m[1]) * (scale[m[2]] ?? scale[m[2].toLowerCase()] ?? NaN);
}

/** The edits in a line: "added C5 100nF from R3 · D3 · D4 · R4 to GND, removed R2, moved D3's cathode to OUT". */
export function editLine(board: BoardId, edits: readonly Edit[]): string {
  const labels = new Map<string, string>();
  for (let i = 0; i <= edits.length; i++) for (const n of editNets(board, edits.slice(0, i))) if (!labels.has(n.key)) labels.set(n.key, n.label);
  const net = (k: string | undefined) => labels.get(k ?? "") ?? "a net";
  return edits.map((e) => e.t === "remove" ? `removed ${e.part}`
    : e.t === "move" ? `moved ${e.part}'s ${e.pin} to ${net(e.to)}`
    : `added ${e.part} ${e.kind === "diode" ? "diode" : printed(e.kind === "res" ? "res" : "cap", e.value ?? 0)} from ${net(e.a)} to ${net(e.b)}`).join(", ");
}

/** Every net on `board` (with `edits` made) that carries the signal, IN first and OUT last: ground and the supply rails are left out. */
export function scopeNets(board: BoardId, edits: readonly Edit[] = []): ScopeNet[] {
  const json = editedJson(board, edits), b = readBoard(json);
  const keys = new Set<string>();
  for (const e of json) { const p = check(PortKey, e); if (p) keys.add(p.subcircuit_connectivity_map_key); }
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

/**
 * How a wave on a net swings: its peak volts either way, the share of its time spent within 10% of a peak (a clipped
 * wave sits there), and its top end: how steep it moves against how big it is (the RMS of its step from one sample to
 * the next over its own RMS, times 100). A capacitor that rounds the wave's edges brings `top` down.
 */
export function swing(wave: Float32Array): { hi: number; lo: number; flat: number; top: number } {
  let hi = 0, lo = 0;
  for (const v of wave) { if (v > hi) hi = v; if (v < lo) lo = v; }
  let flat = 0, loud = 0;
  for (const v of wave) {
    if (Math.abs(v) < 0.05 * Math.max(hi, -lo)) continue; // the gaps between notes say nothing about clipping
    loud++;
    if ((v > 0 && v > 0.9 * hi) || (v < 0 && v < 0.9 * lo)) flat++;
  }
  let sq = 0, dsq = 0;
  for (let i = 0; i < wave.length; i++) { sq += wave[i] * wave[i]; if (i) dsq += (wave[i] - wave[i - 1]) ** 2; }
  return { hi, lo, flat: loud ? flat / loud : 0, top: sq > 0 ? 100 * Math.sqrt(dsq / sq) : 0 };
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
export function remakeJson(board: BoardId, swaps: Swaps, edits: readonly Edit[] = []): unknown[] {
  const values = swapOptions(board, swaps).values ?? {}, diodes = diodeChoices(board, swaps);
  const els = without(editedJson(board, edits), (e) => isRecord(e) && typeof e.name === "string" && diodes.get(e.name) === "none");
  return els.map((e) => {
    if (!isRecord(e) || e.type !== "source_component" || typeof e.name !== "string") return e;
    const v = values[e.name], d = diodes.get(e.name);
    if (v !== undefined && e.ftype === "simple_resistor") return { ...e, resistance: v, display_value: `${printed("res", v)}Ω` };
    if (v !== undefined && e.ftype === "simple_capacitor") return { ...e, capacitance: v, display_value: printed("cap", v) };
    if (d && e.ftype === "simple_diode") return { ...e, manufacturer_part_number: CLIPPERS[d].part };
    return e;
  });
}

/** What the player changed, in a line: "D3 D4 LED (LED-RED-3MM), R3 4.7k". Empty for the stock board. */
export function changes(board: BoardId, swaps: Swaps, edits: readonly Edit[] = []): string {
  const values = swapOptions(board, swaps).values ?? {};
  const removed = new Set(edits.filter((e) => e.t === "remove").map((e) => e.part));
  return [...sockets(board).filter((s) => !s.parts.every((p) => removed.has(p))).flatMap((s) => {
    const v = swaps[s.id];
    if (s.kind === "clipper") return isClipper(v) ? [`${s.parts.join(" ")} ${CLIPPERS[v].label}${CLIPPERS[v].part ? ` (${CLIPPERS[v].part})` : " (left empty)"}`] : [];
    const to = values[s.id];
    return to === undefined || to === (s.kind === "cap" ? s.farads : s.ohms) ? [] : [`${s.id} ${printed(s.kind, to)}`];
  }), ...(edits.length ? [editLine(board, edits)] : [])].join(", ");
}

/** A port's place in tscircuit source: `.R3 > .pin2`, `.U1 > .OUT`. */
const selector = (part: string, port: string) => `.${part} > .${port}`;

/**
 * The board's traces written again from `els`' nets: each pin on a named net (IN, GND, OUT, the rails) to `net.NAME`,
 * and each other net's pins to its first pin. A changed circuit's source can't keep the stock traces, which were
 * drawn to pins that may have gone or moved.
 */
function tracesOf(els: unknown[]): string[] {
  const names = new Map<string, string>(), named = new Map<string, string>();
  for (const e of els) { const c = check(SourcePart, e); if (c) names.set(c.source_component_id, c.name); }
  for (const e of els) { const n = check(SourceNet, e); if (n?.subcircuit_connectivity_map_key) named.set(n.subcircuit_connectivity_map_key, n.name); }
  const first = new Map<string, string>(), out: string[] = [];
  for (const e of els) {
    const p = check(SourcePort, e), part = p && names.get(p.source_component_id), key = p?.subcircuit_connectivity_map_key;
    if (!p || !part || !key) continue;
    const at = selector(part, p.name), net = named.get(key), to = net ? `net.${net}` : first.get(key);
    if (!to) { first.set(key, at); continue; }
    out.push(`    <trace from="${at}" to="${to}" />`);
  }
  return out;
}

/**
 * The board's tscircuit source (`circuits/<board>.tsx`) with the player's parts written in: a changed resistor or
 * capacitor takes its new value, a changed diode a `manufacturerPartNumber`, and an emptied socket keeps its holes
 * and traces with nothing fitted (`doNotPlace`). Open it in tscircuit to route it again or order it; the layout and
 * footprints are the stock board's.
 */
export function remakeTsx(board: BoardId, tsx: string, swaps: Swaps, name: string, edits: readonly Edit[] = []): string {
  const values = swapOptions(board, swaps).values ?? {}, diodes = diodeChoices(board, swaps);
  const els = editedJson(board, edits);
  const on = new Set(els.flatMap((e) => { const c = check(SourcePart, e); return c ? [c.name] : []; }));
  let src = tsx.split("\n");
  if (edits.length) {
    // A changed circuit: removed parts go, added ones come in after the last part, and the traces are written again.
    const isPart = (l: string) => /^\s*<(resistor|capacitor|diode|chip|potentiometer|inductor|transistor)\s/.test(l);
    const partName = (l: string) => /\sname="([^"]+)"/.exec(l)?.[1];
    const added = edits.flatMap((e) => (e.t === "add" && e.kind && on.has(e.part) && !src.some((l) => isPart(l) && partName(l) === e.part) ? [e] : []))
      .filter((e, i, all) => all.findIndex((x) => x.part === e.part) === i)
      .map((e) => e.kind === "res" ? `    <resistor name="${e.part}" resistance="${printed("res", e.value ?? 0)}" footprint="0603" />`
        : e.kind === "cap" ? `    <capacitor name="${e.part}" capacitance="${printed("cap", e.value ?? 0)}" footprint="0603" />`
        : `    <diode name="${e.part}" footprint="sod123" />`);
    const lastPart = src.findLastIndex(isPart), traces = tracesOf(els);
    const kept = src.flatMap((l, i) => {
      if (/^\s*<trace\s/.test(l)) return [];
      if (isPart(l) && !on.has(partName(l) ?? "")) return [];
      return i === lastPart ? [l, ...added] : [l];
    });
    const close = kept.findLastIndex((l) => /^\s*<\/board>/.test(l));
    src = close < 0 ? [...kept, ...traces] : [...kept.slice(0, close), ...traces, ...kept.slice(close)];
  }
  const lines = src.map((l) => {
    const name = /<(resistor|capacitor|diode)\s+name="([^"]+)"/.exec(l);
    if (!name) return l;
    const [, kind, part] = name, v = values[part], d = diodes.get(part);
    if (kind === "resistor" && v !== undefined) return l.replace(/resistance="[^"]*"/, `resistance="${printed("res", v)}"`);
    if (kind === "capacitor" && v !== undefined) return l.replace(/capacitance="[^"]*"/, `capacitance="${printed("cap", v)}"`);
    if (kind === "diode" && d === "none") return l.replace(`name="${part}"`, `name="${part}" doNotPlace`);
    if (kind === "diode" && d) return l.replace(`name="${part}"`, `name="${part}" manufacturerPartNumber="${CLIPPERS[d].part}"`);
    return l;
  });
  const what = changes(board, swaps, edits);
  const layout = edits.length
    ? "New parts or wiring: the stock board's layout and Gerbers don't fit this circuit. Route a new layout in tscircuit before you order it."
    : "Same holes and footprints as the stock board.";
  return [`// Your ${name}, remade in Q Builder${what ? `: ${what}` : ", stock"}. ${layout}`, ...lines].join("\n");
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
export function retest(def: PedalDef & { board: BoardId }, drive: number, swaps: Swaps, input = theRiff(), edits: readonly Edit[] = []): Retest {
  const mods = def.mods?.(drive);
  const yours = play(def.net(drive, swaps, changedJson(def.board, edits)), input, undefined, mods), stock = play(def.net(drive), input, undefined, mods);
  const remade = play(def.net(drive, {}, remakeJson(def.board, swaps, edits)), input, undefined, mods);
  let apart = 0;
  for (let i = 0; i < input.length; i++) apart = Math.max(apart, Math.abs(yours.out[i] - remade.out[i]));
  const diff = yours.out.map((v, i) => v - stock.out[i]);
  return { same: apart < 1e-6, apart, louder: db(rms(yours.out) / rms(stock.out)), differs: db(rms(diff) / rms(stock.out)), misses: yours.misses + remade.misses };
}
