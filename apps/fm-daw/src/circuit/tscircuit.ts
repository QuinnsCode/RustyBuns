// tscircuit board → netlist. Every circuit Q Amp plays is a board in `circuits/*.tsx`
// (`<resistor>`, `<capacitor>`, `<diode>`, `<chip>`, ...), rendered to circuit JSON by
// `scripts/boards.ts`; its `source_*` elements are the schematic, and every port
// already names its net (`subcircuit_connectivity_map_key`), so this is a lookup,
// not a trace walk. No tscircuit import: the app reads the JSON.
//
// `<inductor>`, `<potentiometer>` and `<transistor>` map straight to parts. Chips are
// told apart by their pin labels: OUT, INP and INN make an op-amp (its supply pins
// are ignored; the rails come from `rail`), and with IABC an OTA; PLATE, GRID and
// CATHODE make a 12AX7 (another tube by `tubes`); DRAIN, GATE and SOURCE a JFET; LEDA, LEDK, LDR1 and LDR2 a
// vactrol (an LED lighting an LDR); LDR1 and LDR2 alone a bare photocell under a lamp.
// A net named in `supplies` gets a DC source to ground.
// Knobs and part swaps reach the board by part name (`knobs`, `values`, `diodes`).
//
// A resistance an LFO or envelope moves (`Part` "VarR") is drawn as the real part
// that moves: a JFET's channel, an LDR (bare or in a vactrol), a pot under a foot.
// `moved` names it with the control that moves it and its range, and the reader
// puts a `VarR` across its channel (DRAIN to SOURCE, LDR1 to LDR2, a pot's two ends).
// The control's own circuit (the LFO, the lamp driver, the envelope follower) is
// off the board, on a net named after the control. A bare photocell must be `moved`.
//
// A pot's `knobs` turn (0 to 1, 0.5 if not given) moves its wiper from pin1 toward
// pin3. A two-pin pot (tscircuit's default) is a variable resistor, `max × t`.
//
// A real 9 V pedal board (circuits/q-drive.tsx) also carries parts the sim
// doesn't hear: name them in `leaveOut` (jacks, footswitch, LED, the supply
// diode). Its 9 V rail and 4.5 V bias are steady, so to the signal they are
// ground: name them in `acGround`. A part left with both ends on one node
// (the bias divider, the supply caps) carries no signal and is dropped.
import { arr, bool, check, int, num, obj, oneOf, opt, raw, str } from "@rustybuns/util/guard";
import type { Netlist, Part, TubeName } from "@rustybuns/gear/circuit";

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
const PcbBoard = obj({ width: num(0, 10_000), height: num(0, 10_000) });

type Named<P> = P extends unknown ? P & { name: string } : never;
/** One part on a board, by its silkscreen name, with the nets its pins sit on (before `BoardOptions`). */
export type BoardPart = Named<Part>;

/** A board read out of its circuit JSON: its parts, its named nets, and the PCB's size in millimetres if the JSON has its `pcb_board`. */
export interface Board { parts: BoardPart[]; nets: string[]; mm: { w: number; h: number } | null }

/** A pot on the board: its name (the knob's) and its full resistance. */
export interface BoardPot { name: string; ohms: number }

/** A diode's junction: saturation current and ideality (`Part` "D"). */
export interface Junction { is: number; n: number }

/** What reading a board needs to know: the box's parts to leave out, and the nets that are ground to the signal. */
export interface ReadOptions {
  /** Nets that are ground to the signal: a steady supply rail or bias. */
  acGround?: string[];
  /** Components the sim leaves out, by name. */
  leaveOut?: string[];
}

export interface BoardOptions extends ReadOptions {
  /** The net the guitar drives (default "IN") and the net read out (default "OUT"). */
  input?: string;
  output?: string;
  /** DC supplies by net name, in volts: `{ B_PLUS: 300 }`. */
  supplies?: Record<string, number>;
  /** Op-amp output swing, ± volts (default 4). */
  rail?: number;
  /** Transistors (by name, "Q1") that are germanium; the rest are silicon. */
  germanium?: string[];
  /** Triode chips (by name) that aren't a 12AX7: `{ V1: "12AT7" }`. */
  tubes?: Record<string, TubeName>;
  /** JFET chips (by name) that are P-channel; the rest are N. */
  pChannel?: string[];
  /** Each pot's turn by name, 0 to 1 (default 0.5). */
  knobs?: Record<string, number>;
  /** New values by part name, replacing the board's: ohms (a resistor or pot), farads or henries. 0 takes the part off the board. */
  values?: Record<string, number>;
  /** Diodes by part name: another junction, or null for an empty socket. */
  diodes?: Record<string, Junction | null>;
  /** Resistors that hiss (`Part` "R" `noisy`). */
  noisy?: string[];
  /** Parts a control moves, by name: each becomes a `VarR` across its channel, `hi` ohms at control 0 to `lo` at 1. */
  moved?: Record<string, Moved>;
  /** Op-amps (by name) that never clip: no rails, so they cost no Newton (`Part` "Opamp" `rail: 0`). */
  linear?: string[];
  /** Transistors' own constants by name (saturation current, gains, leakage), over the silicon or germanium defaults. */
  bjt?: Record<string, { is?: number; bf?: number; br?: number; leak?: number }>;
}

/** What moves a part: the control's name (a rig `Mod`'s `ctl`) and its range in ohms. */
export interface Moved { ctl: string; hi: number; lo: number }

/** Reads a board out of tscircuit's circuit JSON. Throws, naming the part, on what the simulator can't model. */
export function readBoard(json: unknown, o: ReadOptions = {}): Board {
  const els = arr(raw, 100_000)(json);
  const comps: ReturnType<typeof Component>[] = [], ports: ReturnType<typeof Port>[] = [], nets: ReturnType<typeof Net>[] = [];
  let mm: Board["mm"] = null;
  for (const e of els) {
    const t = check(Kind, e)?.type;
    if (t === "source_component") comps.push(Component(e));
    else if (t === "source_port") ports.push(Port(e));
    else if (t === "source_net") nets.push(Net(e));
    else if (t === "pcb_board" && !mm) { const p = PcbBoard(e); mm = { w: p.width, h: p.height }; }
  }
  const netName = new Map<string, string>();
  const ground = new Set(o.acGround);
  for (const n of nets) if (n.subcircuit_connectivity_map_key) netName.set(n.subcircuit_connectivity_map_key, n.is_ground || ground.has(n.name) ? "gnd" : n.name);
  const skip = new Set(o.leaveOut);
  const nodeOf = (p: ReturnType<typeof Port>) => {
    const key = p.subcircuit_connectivity_map_key;
    return key ? netName.get(key) ?? key : `open:${p.source_port_id}`;
  };
  const parts = comps.filter((c) => !skip.has(c.name)).map((c): BoardPart => {
    const name = c.name;
    const pins = ports.filter((p) => p.source_component_id === c.source_component_id).sort((a, b) => (a.pin_number ?? 0) - (b.pin_number ?? 0));
    const label = (pin: string) => {
      const p = pins.find((q) => q.name.toUpperCase() === pin);
      if (!p) throw new Error(`${name}: no ${pin} pin`);
      return nodeOf(p);
    };
    /** The pin whose name or hint is one of `names`. */
    const pin = (...names: string[]) => {
      const p = pins.find((q) => names.includes(q.name.toLowerCase()) || q.port_hints?.some((h) => names.includes(h.toLowerCase())));
      if (!p) throw new Error(`${name}: no ${names[0]} pin`);
      return nodeOf(p);
    };
    const two = () => {
      if (pins.length !== 2) throw new Error(`${name}: ${pins.length} pins, expected 2`);
      return [nodeOf(pins[0]), nodeOf(pins[1])];
    };
    if (c.ftype === "simple_resistor") {
      const [a, b] = two();
      if (c.resistance === undefined) throw new Error(`${name}: no resistance`);
      return { name, kind: "R", a, b, ohms: c.resistance };
    }
    if (c.ftype === "simple_capacitor") {
      const [a, b] = two();
      if (c.capacitance === undefined) throw new Error(`${name}: no capacitance`);
      return { name, kind: "C", a, b, farads: c.capacitance };
    }
    if (c.ftype === "simple_inductor") {
      const [a, b] = two();
      if (c.inductance === undefined) throw new Error(`${name}: no inductance`);
      return { name, kind: "L", a, b, henries: c.inductance };
    }
    if (c.ftype === "simple_potentiometer") {
      if (c.max_resistance === undefined) throw new Error(`${name}: no maxResistance`);
      if (pins.length === 2) { const [a, w] = two(); return { name, kind: "Pot", a, w, b: w, ohms: c.max_resistance }; }
      if (pins.length !== 3) throw new Error(`${name}: ${pins.length} pins, expected 2 or 3`);
      const w = pins.find((p) => p.name.toLowerCase() === "wiper" || p.port_hints?.includes("wiper")) ?? pins[1];
      const [a, b] = pins.filter((p) => p !== w).map(nodeOf);
      return { name, kind: "Pot", a, w: nodeOf(w), b, ohms: c.max_resistance };
    }
    if (c.ftype === "simple_transistor") {
      return { name, kind: "BJT", c: pin("collector", "c"), b: pin("base", "b"), e: pin("emitter", "e"), pnp: c.transistor_type === "pnp", ge: false };
    }
    if (c.ftype === "simple_diode") {
      two();
      const anode = pins.find((p) => p.port_hints?.includes("anode")) ?? pins[0];
      const cathode = pins.find((p) => p !== anode);
      if (!cathode) throw new Error(`${name}: no cathode`);
      return { name, kind: "D", a: nodeOf(anode), k: nodeOf(cathode) };
    }
    if (c.ftype === "simple_chip") {
      const names = new Set(pins.map((p) => p.name.toUpperCase()));
      if (names.has("OUT") && names.has("INP") && names.has("INN") && names.has("IABC")) return { name, kind: "OTA", plus: label("INP"), minus: label("INN"), out: label("OUT"), abc: label("IABC") };
      if (names.has("OUT") && names.has("INP") && names.has("INN")) return { name, kind: "Opamp", plus: label("INP"), minus: label("INN"), out: label("OUT") };
      if (names.has("PLATE") && names.has("GRID") && names.has("CATHODE")) return { name, kind: "Triode", p: label("PLATE"), g: label("GRID"), k: label("CATHODE") };
      if (names.has("DRAIN") && names.has("GATE") && names.has("SOURCE")) return { name, kind: "JFET", d: label("DRAIN"), g: label("GATE"), s: label("SOURCE"), p: false };
      if (names.has("LEDA") && names.has("LEDK") && names.has("LDR1") && names.has("LDR2")) return { name, kind: "LDR", a: label("LDR1"), b: label("LDR2"), la: label("LEDA"), lk: label("LEDK") };
      // A bare photocell: its lamp is off the board, so `moved` must say what lights it (an empty control until then).
      if (names.size === 2 && names.has("LDR1") && names.has("LDR2")) return { name, kind: "VarR", a: label("LDR1"), b: label("LDR2"), ctl: "", hi: 1e6, lo: 1e3 };
      throw new Error(`${name}: a chip the simulator doesn't know (pins ${[...names].join(", ")}); label an op-amp OUT/INP/INN (+IABC for an OTA), a triode PLATE/GRID/CATHODE, a JFET DRAIN/GATE/SOURCE, a vactrol LEDA/LEDK/LDR1/LDR2 or a photocell LDR1/LDR2`);
    }
    throw new Error(`${name}: no model for ${c.ftype} yet`);
  });
  return { parts, nets: nets.map((n) => n.name), mm };
}

/** The board's pots, in the order they were drawn. */
export const boardPots = (b: Board): BoardPot[] => b.parts.flatMap((p) => (p.kind === "Pot" ? [{ name: p.name, ohms: p.ohms }] : []));

/** The two ends of the resistance a control moves: a JFET's channel, an LDR, a resistor or a pot's ends. */
function channel(name: string, p: Part): { a: string; b: string } {
  if (p.kind === "JFET") return { a: p.d, b: p.s };
  if (p.kind === "LDR" || p.kind === "VarR" || p.kind === "R" || p.kind === "Pot") return { a: p.a, b: p.kind === "Pot" ? p.w : p.b };
  throw new Error(`${name}: a ${p.kind} has no channel a control can move; draw a JFET, an LDR or a pot`);
}

/** A board's JSON as a netlist the solver runs. Throws, naming the part, on what it can't model. */
export const boardToNetlist = (json: unknown, o: BoardOptions = {}): Netlist => netlistOf(readBoard(json, o), o);

/** A board already read (`readBoard`) as a netlist: the bench turns its knobs without reading the JSON again. */
export function netlistOf(board: Board, o: BoardOptions = {}): Netlist {
  const named = new Set(board.parts.map((p) => p.name));
  const lists = [o.values, o.diodes, o.moved, o.bjt, o.tubes].flatMap((r) => Object.keys(r ?? {}));
  for (const n of [...lists, ...(o.noisy ?? []), ...(o.linear ?? [])]) {
    if (!named.has(n)) throw new Error(`no part ${n} on this board (${[...named].join(", ")})`);
  }
  const parts: Part[] = [];
  for (const { name, ...p } of board.parts) {
    const value = o.values?.[name];
    if (value !== undefined && value <= 0) continue;
    const moved = o.moved?.[name];
    if (moved) parts.push({ kind: "VarR", ...channel(name, p), ...moved });
    else if (p.kind === "VarR" && !p.ctl) throw new Error(`${name}: a photocell with nothing lighting it; name it in \`moved\``);
    else if (p.kind === "R") parts.push({ ...p, ohms: value ?? p.ohms, ...(o.noisy?.includes(name) ? { noisy: true } : {}) });
    else if (p.kind === "C") parts.push({ ...p, farads: value ?? p.farads });
    else if (p.kind === "L") parts.push({ ...p, henries: value ?? p.henries });
    else if (p.kind === "Pot") {
      const turn = o.knobs?.[name];
      parts.push({ ...p, ohms: value ?? p.ohms, ...(turn === undefined ? {} : { at: Math.min(1, Math.max(0, turn)) }) });
    } else if (p.kind === "D") {
      const j = o.diodes?.[name];
      if (j === null) continue;
      parts.push(j ? { ...p, is: j.is, n: j.n } : p);
    } else if (p.kind === "Opamp") parts.push({ ...p, rail: o.linear?.includes(name) ? 0 : o.rail });
    else if (p.kind === "BJT") parts.push({ ...p, ge: o.germanium?.includes(name) ?? false, ...o.bjt?.[name] });
    else if (p.kind === "JFET") parts.push({ ...p, p: o.pChannel?.includes(name) ?? false });
    else if (p.kind === "Triode" && o.tubes?.[name]) parts.push({ ...p, tube: o.tubes[name] });
    else parts.push(p);
  }
  for (const [net, volts] of Object.entries(o.supplies ?? {})) parts.push({ kind: "V", a: net, b: "gnd", volts });
  const shorted = (p: Part) => (p.kind === "R" || p.kind === "C") && p.a === p.b;
  return { parts: parts.filter((p) => !shorted(p)), input: o.input ?? "IN", output: o.output ?? "OUT" };
}
