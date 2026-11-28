// A change to a pedal's circuit past a part's value (#6423): parts added, removed and rewired. Q Builder makes them,
// they are kept with the swaps (../amp/parts-store.ts), and Q Builder's bench, Q Amp's rig and the build sheet all
// build the pedal from the changed board.
import { check, isRecord, num, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";
import { BOARDS, farads, ohms, type BoardId } from "./circuits.ts";

/**
 * A change to the circuit past a part's value (#6423): `add` a resistor, capacitor or diode (`value` in ohms or
 * farads; a diode is a 1N4148) from net `a` to net `b` (anode to cathode); `remove` a part; or `move` one end of a
 * part (`pin`: pin1 or pin2, a diode's anode or cathode) to net `to`. Nets are connectivity keys, as a schematic
 * trace carries them. An edit naming a part or net the board doesn't have does nothing.
 */
export const Edit = obj({
  t: oneOf(["add", "remove", "move"]),
  part: str(12, { re: /^[A-Z]{1,3}\d{1,3}$/ }),
  kind: opt(oneOf(["res", "cap", "diode"])),
  value: opt(num(1e-13, 1e9)),
  a: opt(str(400)), b: opt(str(400)),
  pin: opt(oneOf(["pin1", "pin2", "anode", "cathode"])), to: opt(str(400)),
});
export type Edit = Of<typeof Edit>;
export type AddKind = "res" | "cap" | "diode";

export const SourcePart = obj({ type: oneOf(["source_component"]), source_component_id: str(200), name: str(80), ftype: str(80) });
export const SourcePort = obj({ type: oneOf(["source_port"]), source_port_id: str(200), source_component_id: str(200), name: str(80), subcircuit_connectivity_map_key: opt(str(400)) });
export const FTYPE: Record<AddKind, string> = { res: "simple_resistor", cap: "simple_capacitor", diode: "simple_diode" };
const TWO_PIN = new Set(Object.values(FTYPE));

/** `els` without the parts named in `names`: their components, their pins, and the traces that reach those pins. */
export function without(els: unknown[], names: (id: unknown) => boolean): unknown[] {
  const gone = new Set<unknown>(), gonePorts = new Set<unknown>();
  for (const e of els) if (isRecord(e) && e.type === "source_component" && names(e)) gone.add(e.source_component_id);
  for (const e of els) if (isRecord(e) && e.type === "source_port" && gone.has(e.source_component_id)) gonePorts.add(e.source_port_id);
  if (!gone.size) return els;
  return els.filter((e) => !(isRecord(e) && (gone.has(e.source_component_id) || gonePorts.has(e.source_port_id)
    || (Array.isArray(e.connected_source_port_ids) && e.connected_source_port_ids.some((p) => gonePorts.has(p))))));
}

/** Which of a two-pin part's ports a pin name means: pin1 is the anode, pin2 the cathode. */
const portIs = (pin: string, port: { name: string; hints: string[] }) =>
  port.name === pin || port.hints.includes(pin) || (pin === "anode" && port.name === "pin1") || (pin === "cathode" && port.name === "pin2");

/**
 * `board`'s circuit JSON with `edits` made to it, in order. An added part gets a component and two pins on the nets
 * it names; a removed one loses its pins and the traces to them (the nets stay, on the pins of the other parts); a
 * moved end takes the other net's key, and the traces drawn to it go (they were drawn to the old net).
 */
export function editedJson(board: BoardId, edits: readonly Edit[] = []): unknown[] {
  let els: unknown[] = Array.isArray(BOARDS[board]) ? [...BOARDS[board]] : [];
  if (!edits.length) return els;
  const keys = () => new Set(els.flatMap((e) => { const p = check(SourcePort, e); return p?.subcircuit_connectivity_map_key ? [p.subcircuit_connectivity_map_key] : []; }));
  const comp = (name: string) => els.map((e) => check(SourcePart, e)).find((c) => c?.name === name) ?? null;
  for (const e of edits) {
    if (e.t === "remove") els = without(els, (c) => isRecord(c) && c.name === e.part);
    else if (e.t === "add" && e.kind && e.a && e.b && !comp(e.part)) {
      const have = keys();
      if (!have.has(e.a) || !have.has(e.b) || (e.kind !== "diode" && !e.value)) continue;
      const id = `source_component_qb_${e.part}`, value = e.value ?? 0;
      els.push(
        { type: "source_component", source_component_id: id, ftype: FTYPE[e.kind], name: e.part,
          ...(e.kind === "res" ? { resistance: value, display_resistance: `${ohms(value)}Ω` } : e.kind === "cap" ? { capacitance: value, display_capacitance: farads(value) } : {}) },
        { type: "source_port", source_port_id: `${id}_1`, source_component_id: id, name: "pin1", pin_number: 1, port_hints: ["pin1", "anode", "pos", "left", "1"], subcircuit_connectivity_map_key: e.a },
        { type: "source_port", source_port_id: `${id}_2`, source_component_id: id, name: "pin2", pin_number: 2, port_hints: ["pin2", "cathode", "neg", "right", "2"], subcircuit_connectivity_map_key: e.b },
      );
    } else if (e.t === "move" && e.pin && e.to && keys().has(e.to)) {
      const c = comp(e.part);
      if (!c || !TWO_PIN.has(c.ftype)) continue;
      const pin = e.pin;
      let moved: unknown = null;
      els = els.map((x) => {
        if (!isRecord(x) || x.type !== "source_port" || x.source_component_id !== c.source_component_id || moved) return x;
        const hints = Array.isArray(x.port_hints) ? x.port_hints.filter((h) => typeof h === "string") : [];
        if (!portIs(pin, { name: typeof x.name === "string" ? x.name : "", hints })) return x;
        moved = x.source_port_id;
        return { ...x, subcircuit_connectivity_map_key: e.to };
      });
      els = els.filter((x) => !(isRecord(x) && x.type === "source_trace" && Array.isArray(x.connected_source_port_ids) && x.connected_source_port_ids.includes(moved)));
    }
  }
  return els;
}

/** The board as changed, for a pedal's `net` to read; undefined while it is the stock circuit (or has no board). */
export const changedJson = (board: BoardId | undefined, edits: readonly Edit[] | undefined): unknown[] | undefined =>
  board && edits?.length ? editedJson(board, edits) : undefined;
