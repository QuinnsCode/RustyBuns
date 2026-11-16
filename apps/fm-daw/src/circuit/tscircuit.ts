// tscircuit board → netlist. A board drawn in tscircuit (`<resistor>`, `<capacitor>`,
// `<diode>`, `<chip>`) renders to circuit JSON; its `source_*` elements are the
// schematic, and every port already names its net (`subcircuit_connectivity_map_key`),
// so this is a lookup, not a trace walk. No tscircuit import: the app reads the JSON.
//
// Chips are told apart by their pin labels: OUT, INP and INN make an op-amp
// (its supply pins are ignored; the rails come from `rail`), PLATE, GRID and
// CATHODE make a 12AX7. A net named in `supplies` gets a DC source to ground.
//
// A potentiometer is two resistors split at its wiper (pin2), set by `knobs`
// (0 to 1 by the pot's name, 0.5 if not given): pin1 to the wiper is `max × t`,
// the wiper to pin3 the rest, so turning up moves the wiper toward pin3. A
// two-pin pot (tscircuit's default) is a variable resistor, `max × t`.
import { arr, bool, check, int, num, obj, opt, raw, str } from "@rustybuns/util/guard";
import type { Netlist, Part } from "./mna.ts";

const Kind = obj({ type: str(80) });
const Component = obj({
  source_component_id: str(200), ftype: str(80), name: str(80),
  resistance: opt(num(1e-3, 1e12)), capacitance: opt(num(1e-15, 10)), max_resistance: opt(num(1, 1e12)),
});
const Port = obj({
  source_port_id: str(200), source_component_id: str(200), name: str(80),
  pin_number: opt(int(0, 10_000)), port_hints: opt(arr(str(80), 32)), subcircuit_connectivity_map_key: opt(str(400)),
});
const Net = obj({ name: str(200), is_ground: opt(bool()), subcircuit_connectivity_map_key: opt(str(400)) });
const PcbBoard = obj({ width: num(0, 10_000), height: num(0, 10_000) });

/** A board's schematic and its outline: what `boardToNetlist` and the bench read. */
export interface Board {
  comps: ReturnType<typeof Component>[];
  ports: ReturnType<typeof Port>[];
  nets: ReturnType<typeof Net>[];
  /** The PCB's width and height in millimetres, if the JSON has its `pcb_board`. */
  mm: { w: number; h: number } | null;
}

/** A pot on the board: its name (the knob's) and its full resistance. */
export interface BoardPot { name: string; ohms: number }

/** Reads the elements the simulator needs out of tscircuit's circuit JSON. Throws on anything that isn't one. */
export function readBoard(json: unknown): Board {
  const els = arr(raw, 100_000)(json);
  const b: Board = { comps: [], ports: [], nets: [], mm: null };
  for (const e of els) {
    const t = check(Kind, e)?.type;
    if (t === "source_component") b.comps.push(Component(e));
    else if (t === "source_port") b.ports.push(Port(e));
    else if (t === "source_net") b.nets.push(Net(e));
    else if (t === "pcb_board" && !b.mm) { const p = PcbBoard(e); b.mm = { w: p.width, h: p.height }; }
  }
  return b;
}

/** The board's pots, in the order they were drawn. */
export const boardPots = (b: Board): BoardPot[] =>
  b.comps.filter((c) => c.ftype === "simple_potentiometer").map((c) => ({ name: c.name, ohms: c.max_resistance ?? 0 }));

export interface BoardOptions {
  /** The net the guitar drives (default "IN") and the net read out (default "OUT"). */
  input?: string;
  output?: string;
  /** DC supplies by net name, in volts: `{ B_PLUS: 300 }`. */
  supplies?: Record<string, number>;
  /** Op-amp output swing, ± volts (default 4). */
  rail?: number;
  /** Each pot's turn by name, 0 to 1 (default 0.5). */
  knobs?: Record<string, number>;
}

/** A board's JSON as a netlist the solver runs. Throws, naming the part, on what it can't model. */
export const boardToNetlist = (json: unknown, o: BoardOptions = {}): Netlist => netlistOf(readBoard(json), o);

/** A board already read (`readBoard`) as a netlist: the bench turns its knobs without reading the JSON again. */
export function netlistOf({ comps, ports, nets }: Board, o: BoardOptions = {}): Netlist {
  const netName = new Map<string, string>();
  for (const n of nets) if (n.subcircuit_connectivity_map_key) netName.set(n.subcircuit_connectivity_map_key, n.is_ground ? "gnd" : n.name);
  const nodeOf = (p: ReturnType<typeof Port>) => {
    const key = p.subcircuit_connectivity_map_key;
    return key ? netName.get(key) ?? key : `open:${p.source_port_id}`;
  };
  const parts: Part[] = [];
  for (const c of comps) {
    const pins = ports.filter((p) => p.source_component_id === c.source_component_id).sort((a, b) => (a.pin_number ?? 0) - (b.pin_number ?? 0));
    const label = (name: string) => {
      const p = pins.find((q) => q.name.toUpperCase() === name);
      if (!p) throw new Error(`${c.name}: no ${name} pin`);
      return nodeOf(p);
    };
    const two = () => {
      if (pins.length !== 2) throw new Error(`${c.name}: ${pins.length} pins, expected 2`);
      return [nodeOf(pins[0]), nodeOf(pins[1])];
    };
    if (c.ftype === "simple_resistor" || c.ftype === "simple_capacitor") {
      const [a, b] = two();
      if (c.ftype === "simple_resistor") {
        if (c.resistance === undefined) throw new Error(`${c.name}: no resistance`);
        parts.push({ kind: "R", a, b, ohms: c.resistance });
      } else {
        if (c.capacitance === undefined) throw new Error(`${c.name}: no capacitance`);
        parts.push({ kind: "C", a, b, farads: c.capacitance });
      }
    } else if (c.ftype === "simple_potentiometer") {
      const max = c.max_resistance;
      if (max === undefined) throw new Error(`${c.name}: no maxResistance`);
      const t = Math.min(1, Math.max(0, o.knobs?.[c.name] ?? 0.5));
      // Never quite 0 Ω: a pot's end has a little resistance, and 0 would short the matrix.
      const leg = (share: number) => Math.max(1, max * share);
      const pin = (n: number) => pins.find((p) => p.pin_number === n);
      const [p1, p2, p3] = [pin(1), pin(2), pin(3)];
      if (!p1 || !p2) throw new Error(`${c.name}: a pot needs pin1 and pin2`);
      parts.push({ kind: "R", a: nodeOf(p1), b: nodeOf(p2), ohms: leg(t) });
      if (p3) parts.push({ kind: "R", a: nodeOf(p2), b: nodeOf(p3), ohms: leg(1 - t) });
    } else if (c.ftype === "simple_diode") {
      two();
      const anode = pins.find((p) => p.port_hints?.includes("anode")) ?? pins[0];
      const cathode = pins.find((p) => p !== anode);
      if (!cathode) throw new Error(`${c.name}: no cathode`);
      parts.push({ kind: "D", a: nodeOf(anode), k: nodeOf(cathode) });
    } else if (c.ftype === "simple_chip") {
      const names = new Set(pins.map((p) => p.name.toUpperCase()));
      if (names.has("OUT") && names.has("INP") && names.has("INN")) {
        parts.push({ kind: "Opamp", plus: label("INP"), minus: label("INN"), out: label("OUT"), rail: o.rail });
      } else if (names.has("PLATE") && names.has("GRID") && names.has("CATHODE")) {
        parts.push({ kind: "Triode", p: label("PLATE"), g: label("GRID"), k: label("CATHODE") });
      } else {
        throw new Error(`${c.name}: a chip the simulator doesn't know (pins ${[...names].join(", ")}); label an op-amp OUT/INP/INN or a triode PLATE/GRID/CATHODE`);
      }
    } else {
      throw new Error(`${c.name}: no model for ${c.ftype} yet`);
    }
  }
  for (const [net, volts] of Object.entries(o.supplies ?? {})) parts.push({ kind: "V", a: net, b: "gnd", volts });
  return { parts, input: o.input ?? "IN", output: o.output ?? "OUT" };
}
