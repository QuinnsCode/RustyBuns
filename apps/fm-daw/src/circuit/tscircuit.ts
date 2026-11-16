// tscircuit board → netlist. A board drawn in tscircuit (`<resistor>`, `<capacitor>`,
// `<diode>`, `<chip>`) renders to circuit JSON; its `source_*` elements are the
// schematic, and every port already names its net (`subcircuit_connectivity_map_key`),
// so this is a lookup, not a trace walk. No tscircuit import: the app reads the JSON.
//
// `<inductor>`, `<potentiometer>` and `<transistor>` map straight to parts. Chips are
// told apart by their pin labels: OUT, INP and INN make an op-amp (its supply pins
// are ignored; the rails come from `rail`), and with IABC an OTA; PLATE, GRID and
// CATHODE make a 12AX7; DRAIN, GATE and SOURCE a JFET; LEDA, LEDK, LDR1 and LDR2 a
// vactrol (an LED lighting an LDR). A net named in `supplies` gets a DC source to ground.
import { arr, bool, check, int, num, obj, oneOf, opt, raw, str } from "@rustybuns/util/guard";
import type { Netlist, Part } from "./mna.ts";

const Kind = obj({ type: str(80) });
const Component = obj({
  source_component_id: str(200), ftype: str(80), name: str(80),
  resistance: opt(num(1e-3, 1e12)), capacitance: opt(num(1e-15, 10)), inductance: opt(num(1e-12, 1e3)),
  max_resistance: opt(num(1e-3, 1e12)), transistor_type: opt(oneOf(["npn", "pnp"])),
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
  /** Transistors (by name, "Q1") that are germanium; the rest are silicon. */
  germanium?: string[];
  /** JFET chips (by name) that are P-channel; the rest are N. */
  pChannel?: string[];
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
    /** The pin whose name or hint is one of `names`. */
    const pin = (...names: string[]) => {
      const p = pins.find((q) => names.includes(q.name.toLowerCase()) || q.port_hints?.some((h) => names.includes(h.toLowerCase())));
      if (!p) throw new Error(`${c.name}: no ${names[0]} pin`);
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
    } else if (c.ftype === "simple_inductor") {
      const [a, b] = two();
      if (c.inductance === undefined) throw new Error(`${c.name}: no inductance`);
      parts.push({ kind: "L", a, b, henries: c.inductance });
    } else if (c.ftype === "simple_potentiometer") {
      if (pins.length !== 3) throw new Error(`${c.name}: ${pins.length} pins, expected 3`);
      if (c.max_resistance === undefined) throw new Error(`${c.name}: no max_resistance`);
      const w = pins.find((p) => p.name.toLowerCase() === "wiper" || p.port_hints?.includes("wiper")) ?? pins[1];
      const [a, b] = pins.filter((p) => p !== w).map(nodeOf);
      parts.push({ kind: "Pot", a, w: nodeOf(w), b, ohms: c.max_resistance });
    } else if (c.ftype === "simple_transistor") {
      parts.push({
        kind: "BJT", c: pin("collector", "c"), b: pin("base", "b"), e: pin("emitter", "e"),
        pnp: c.transistor_type === "pnp", ge: o.germanium?.includes(c.name) ?? false,
      });
    } else if (c.ftype === "simple_diode") {
      two();
      const anode = pins.find((p) => p.port_hints?.includes("anode")) ?? pins[0];
      const cathode = pins.find((p) => p !== anode);
      if (!cathode) throw new Error(`${c.name}: no cathode`);
      parts.push({ kind: "D", a: nodeOf(anode), k: nodeOf(cathode) });
    } else if (c.ftype === "simple_chip") {
      const names = new Set(pins.map((p) => p.name.toUpperCase()));
      if (names.has("OUT") && names.has("INP") && names.has("INN") && names.has("IABC")) {
        parts.push({ kind: "OTA", plus: label("INP"), minus: label("INN"), out: label("OUT"), abc: label("IABC") });
      } else if (names.has("OUT") && names.has("INP") && names.has("INN")) {
        parts.push({ kind: "Opamp", plus: label("INP"), minus: label("INN"), out: label("OUT"), rail: o.rail });
      } else if (names.has("PLATE") && names.has("GRID") && names.has("CATHODE")) {
        parts.push({ kind: "Triode", p: label("PLATE"), g: label("GRID"), k: label("CATHODE") });
      } else if (names.has("DRAIN") && names.has("GATE") && names.has("SOURCE")) {
        parts.push({ kind: "JFET", d: label("DRAIN"), g: label("GATE"), s: label("SOURCE"), p: o.pChannel?.includes(c.name) ?? false });
      } else if (names.has("LEDA") && names.has("LEDK") && names.has("LDR1") && names.has("LDR2")) {
        parts.push({ kind: "LDR", a: label("LDR1"), b: label("LDR2"), la: label("LEDA"), lk: label("LEDK") });
      } else {
        throw new Error(`${c.name}: a chip the simulator doesn't know (pins ${[...names].join(", ")}); label an op-amp OUT/INP/INN (+IABC for an OTA), a triode PLATE/GRID/CATHODE, a JFET DRAIN/GATE/SOURCE or a vactrol LEDA/LEDK/LDR1/LDR2`);
      }
    } else {
      throw new Error(`${c.name}: no model for ${c.ftype} yet`);
    }
  }
  for (const [net, volts] of Object.entries(o.supplies ?? {})) parts.push({ kind: "V", a: net, b: "gnd", volts });
  return { parts, input: o.input ?? "IN", output: o.output ?? "OUT" };
}
