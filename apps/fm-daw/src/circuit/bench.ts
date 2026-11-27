// The bench: a pedal drawn as a tscircuit board becomes gear. A box the size of its
// board with an instrument jack in and a jack out, a knob per pot, and the netlist
// those knobs set. Before it's gear it has to play: the bench settles it and runs a
// hot note through it with every knob down, centred and up, and a board that won't
// solve (Newton gives up, it blows up, nothing reaches OUT) comes back as the reasons
// why, so it never turns up as noise. tscircuit itself stays out: this reads its JSON.
import type { Gear } from "@rustybuns/gear";
import type { Netlist } from "@rustybuns/gear/circuit";
import { Rig } from "@rustybuns/gear/circuit";
import { Bad } from "@rustybuns/util/guard";
import type { PedalDef } from "./amps.ts";
import type { Swaps } from "./circuits.ts";
import { boardPots, netlistOf, readBoard, type Board, type BoardOptions, type BoardPot } from "./tscircuit.ts";

/** A board that plays: the box, its knobs, and its netlist at any turn of them (0 to 1 by pot name). */
export interface BenchPedal {
  gear: Gear;
  knobs: BoardPot[];
  net: (knobs: Record<string, number>) => Netlist;
}

export type Bench = { ok: true; pedal: BenchPedal } | { ok: false; why: string[] };

/** The enclosure round the board: a few millimetres each side, room for the jacks and knobs on top. */
const WALL = 6, HEIGHT = 0.05; // mm a side, metres tall
/** A pedal with a guitar on it: the riff peaks near this at the input. */
const TEST_VOLTS = 0.5;
const SR = 48000;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Runs 50 ms of a hot 220 Hz note through `net`: why it won't play, or its peak volts when it does. */
export function tryPlay(net: Netlist): string | number {
  let rig: Rig;
  try { rig = new Rig({ inputVolts: TEST_VOLTS, links: [{ net }], power: 0, cab: null }, SR, 2); }
  catch (e) { return errText(e); }
  const n = SR / 20;
  const input = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 220 * i) / SR));
  const out = new Float32Array(n);
  try { rig.process(input, out); } catch (e) { return errText(e); }
  if (rig.misses > 0) return `the solver gave up on ${rig.misses} of ${n * 2} steps (Newton didn't converge): look for a part with no resistor in series, or feedback with nothing to stop it`;
  let peak = 0;
  for (const y of out) {
    if (!Number.isFinite(y)) return "it blew up (the output went to infinity)";
    peak = Math.max(peak, Math.abs(y));
  }
  if (peak > 1000) return `it puts out ${Math.round(peak)} V: a supply or an op-amp with nothing holding it`;
  return peak;
}

/**
 * Why a circuit won't play at each of its knob turns (none: it plays). `at(t)` is its netlist with every knob at `t`
 * (0, 0.5 and 1; just 0 with `knobs` false). A circuit that solves but puts nothing out of OUT doesn't play either.
 */
export function wontPlay(at: (t: number) => Netlist, knobs = true): string[] {
  const why: string[] = [];
  let loudest = 0;
  for (const t of knobs ? [0, 0.5, 1] : [0]) {
    let n: Netlist;
    try { n = at(t); } catch (e) { return [errText(e)]; }
    const played = tryPlay(n);
    if (typeof played === "number") loudest = Math.max(loudest, played);
    else why.push(knobs ? `with every knob at ${t * 10}: ${played}` : played);
  }
  if (why.length) return [...new Set(why)];
  return loudest < 1e-4 ? ["nothing comes out of OUT: is it joined to IN, and does each supply net have its volts (the bench's supplies)?"] : [];
}

/** A tscircuit board's JSON as a pedal, or why it isn't one. `name` defaults to the board's file name, if the caller has one. */
export function bench(json: unknown, o: BoardOptions & { name?: string } = {}): Bench {
  let board: Board;
  try { board = readBoard(json, o); } catch (e) { return { ok: false, why: [e instanceof Bad ? `not tscircuit circuit JSON: ${errText(e)}` : errText(e)] }; }
  if (!board.parts.length) return { ok: false, why: ["no parts on the board (export the circuit JSON with its source_* elements)"] };
  const knobs = boardPots(board);
  const net = (turns: Record<string, number>) => netlistOf(board, { ...o, knobs: turns });
  const why: string[] = [];
  const names = new Set(board.nets);
  for (const want of [o.input ?? "IN", o.output ?? "OUT"]) if (!names.has(want)) why.push(`no net called ${want}: wire the jack to net.${want}`);
  if (why.length) return { ok: false, why };
  // Every knob at one turn: down, centred, up. A pedal has to play at all three.
  why.push(...wontPlay((t) => net(Object.fromEntries(knobs.map((k) => [k.name, t]))), knobs.length > 0));
  if (why.length) return { ok: false, why };
  const name = o.name?.trim() || "Bench pedal";
  const mm = board.mm ?? { w: 60, h: 45 };
  const gear: Gear = {
    id: `bench-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "pedal"}`,
    what: `${name}, a pedal from the bench`,
    size: { w: (mm.w + 2 * WALL) / 1000, h: HEIGHT, d: (mm.h + 2 * WALL) / 1000 },
    // Jacks and board, plus a die-cast box at about 120 kg per square metre of lid: a 60 × 45 mm board weighs half a kilo.
    kg: Math.round((0.15 + ((mm.w * mm.h) / 1e6) * 120) * 100) / 100,
    jacks: { "inst-in": 1, "line-out": 1 },
  };
  return { ok: true, pedal: { gear, knobs, net } };
}

/**
 * Why one of the app's pedals won't play with the player's parts in it (none: it plays), its knob down, centred and up.
 * `json` is a changed copy of its board (Q Builder's added, removed and rewired parts).
 */
export const swapWontPlay = (def: PedalDef, swaps: Swaps, json?: unknown): string[] => wontPlay((t) => def.net(t * 10, swaps, json));
