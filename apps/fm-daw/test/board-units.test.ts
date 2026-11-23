// A board's dual and quad chips (a TL072, an LM13700): each amp in the package reads as a part of its own, named by
// its letter, and plays as one.
import { expect, test } from "bun:test";
import { Circuit } from "@rustybuns/gear/circuit";
import { netlistOf, readBoard } from "../src/circuit/tscircuit.ts";

/** A board of chips as tscircuit's circuit JSON has them: each pin's label on a named net. */
function boardJson(chips: Record<string, Record<string, string>>): unknown[] {
  const els: unknown[] = [], nets = new Set<string>();
  let port = 0;
  for (const [name, pins] of Object.entries(chips)) {
    els.push({ type: "source_component", source_component_id: name, ftype: "simple_chip", name });
    Object.entries(pins).forEach(([label, net], i) => {
      els.push({ type: "source_port", source_port_id: `p${port++}`, source_component_id: name, name: label, pin_number: i + 1, subcircuit_connectivity_map_key: `k-${net}` });
      nets.add(net);
    });
  }
  for (const n of nets) els.push({ type: "source_net", name: n, subcircuit_connectivity_map_key: `k-${n}`, ...(n === "GND" ? { is_ground: true } : {}) });
  return els;
}

test("a TL072 reads as two op-amps and an LM13700 as two OTAs, and a unit plays by its own name", () => {
  const json = boardJson({
    U1: { OUTA: "MID", INNA: "MID", INPA: "IN", VNEG: "VN12", INPB: "MID", INNB: "OUT", OUTB: "OUT", VPOS: "V12" },
    U2: { IABCA: "BA", DBIASA: "NC1", INPA: "IN", INNA: "GND", OUTA: "GND", VNEG: "VN12", BINA: "NC2", BOUTA: "NC3", BOUTB: "NC4", BINB: "NC5", VPOS: "V12", OUTB: "GND", INNB: "GND", INPB: "GND", DBIASB: "NC6", IABCB: "BB" },
  });
  expect(readBoard(json).parts).toEqual([
    { name: "U1A", kind: "Opamp", plus: "IN", minus: "MID", out: "MID" },
    { name: "U1B", kind: "Opamp", plus: "MID", minus: "OUT", out: "OUT" },
    { name: "U2A", kind: "OTA", plus: "IN", minus: "gnd", out: "gnd", abc: "BA" },
    { name: "U2B", kind: "OTA", plus: "gnd", minus: "gnd", out: "gnd", abc: "BB" },
  ]);
  // Two followers in a row, the second named on its own as never clipping: the input comes out.
  const net = netlistOf(readBoard(json, { leaveOut: ["U2"] }), { linear: ["U1B"] });
  const c = new Circuit(net, 48000);
  c.settle(0);
  let out = 0;
  for (let i = 0; i < 100; i++) out = c.step(0.5);
  expect(out).toBeCloseTo(0.5, 2);
});
