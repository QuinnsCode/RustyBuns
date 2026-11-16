// tscircuit board → netlist. A board drawn in tscircuit (`<resistor>`, `<capacitor>`,
// `<diode>`, `<chip>`) renders to circuit JSON; its `source_*` elements are the
// schematic, and every port already names its net (`subcircuit_connectivity_map_key`),
// so this is a lookup, not a trace walk. No tscircuit import: the app reads the JSON.
//
// Chips are told apart by their pin labels: OUT, INP and INN make an op-amp
// (its supply pins are ignored; the rails come from `rail`), PLATE, GRID and
// CATHODE make a 12AX7. A `<potentiometer>` (pin1 counter-clockwise, pin2 the
// wiper) is two resistors, split where `knobs` sets it. A net named in
// `supplies` gets a DC source to ground.
//
// A real 9 V pedal board (circuits/q-drive.tsx) also carries parts the sim
// doesn't hear: name them in `leaveOut` (jacks, footswitch, LED, the supply
// diode). Its 9 V rail and 4.5 V bias are steady, so to the signal they are
// ground: name them in `acGround`. A part left with both ends on one node
// (the bias divider, the supply caps) carries no signal and is dropped.
import { arr, bool, check, int, num, obj, opt, raw, str } from "@rustybuns/util/guard";
import type { Netlist, Part } from "./mna.ts";

const Kind = obj({ type: str(80) });
const Component = obj({
  source_component_id: str(200), ftype: str(80), name: str(80),
  resistance: opt(num(1e-3, 1e12)), capacitance: opt(num(1e-15, 10)), max_resistance: opt(num(1, 1e9)),
});
const Port = obj({
  source_port_id: str(200), source_component_id: str(200), name: str(80),
  pin_number: opt(int(0, 10_000)), port_hints: opt(arr(str(80), 32)), subcircuit_connectivity_map_key: opt(str(400)),
});
const Net = obj({ name: str(200), is_ground: opt(bool()), subcircuit_connectivity_map_key: opt(str(400)) });

export interface BoardOptions {
  /** The net the guitar drives (default "IN") and the net read out (default "OUT"). */
  input?: string;
  output?: string;
  /** DC supplies by net name, in volts: `{ B_PLUS: 300 }`. */
  supplies?: Record<string, number>;
  /** Op-amp output swing, ± volts (default 4). */
  rail?: number;
  /** Nets that are ground to the signal: a steady supply rail or bias. */
  acGround?: string[];
  /** Components the sim leaves out, by name. */
  leaveOut?: string[];
  /** Each pot's knob by name, 0 (fully counter-clockwise) to 1 (default 0.5): pin1 to the wiper is that share of the track. */
  knobs?: Record<string, number>;
}

export function boardToNetlist(json: unknown, o: BoardOptions = {}): Netlist {
  const els = arr(raw, 100_000)(json);
  const comps: ReturnType<typeof Component>[] = [], ports: ReturnType<typeof Port>[] = [], nets: ReturnType<typeof Net>[] = [];
  for (const e of els) {
    const t = check(Kind, e)?.type;
    if (t === "source_component") comps.push(Component(e));
    else if (t === "source_port") ports.push(Port(e));
    else if (t === "source_net") nets.push(Net(e));
  }
  const netName = new Map<string, string>();
  const ground = new Set(o.acGround);
  for (const n of nets) if (n.subcircuit_connectivity_map_key) netName.set(n.subcircuit_connectivity_map_key, n.is_ground || ground.has(n.name) ? "gnd" : n.name);
  const skip = new Set(o.leaveOut);
  const nodeOf = (p: ReturnType<typeof Port>) => {
    const key = p.subcircuit_connectivity_map_key;
    return key ? netName.get(key) ?? key : `open:${p.source_port_id}`;
  };
  const parts: Part[] = [];
  for (const c of comps) {
    if (skip.has(c.name)) continue;
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
    } else if (c.ftype === "simple_diode") {
      two();
      const anode = pins.find((p) => p.port_hints?.includes("anode")) ?? pins[0];
      const cathode = pins.find((p) => p !== anode);
      if (!cathode) throw new Error(`${c.name}: no cathode`);
      parts.push({ kind: "D", a: nodeOf(anode), k: nodeOf(cathode) });
    } else if (c.ftype === "simple_potentiometer") {
      if (pins.length !== 3 || c.max_resistance === undefined) throw new Error(`${c.name}: a pot needs three pins and its track's resistance`);
      const [ccw, wiper, cw] = pins.map(nodeOf);
      const turn = Math.min(1, Math.max(0, o.knobs?.[c.name] ?? 0.5));
      parts.push({ kind: "R", a: ccw, b: wiper, ohms: Math.max(1, turn * c.max_resistance) }, { kind: "R", a: wiper, b: cw, ohms: Math.max(1, (1 - turn) * c.max_resistance) });
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
  return { parts: parts.filter((p) => !(p.kind === "R" || p.kind === "C") || p.a !== p.b), input: o.input ?? "IN", output: o.output ?? "OUT" };
}
