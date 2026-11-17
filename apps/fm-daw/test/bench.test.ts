// The bench (src/circuit/bench.ts): a pedal drawn in tscircuit with two pots becomes
// gear you play in front of Q Amp's amp with its knobs, and the boards people get
// wrong come back as reasons instead of noise.
import { expect, setDefaultTimeout, test } from "bun:test";
import { AMPS } from "../src/circuit/amps.ts";
import { bench } from "../src/circuit/bench.ts";
import { applySettings } from "../src/amp/live.ts";
import board from "../circuits/bench-drive.circuit.json";

setDefaultTimeout(60_000);
const SR = 48000;

test("a drawn drive pedal becomes gear with a knob per pot, and plays in front of the amp", () => {
  const b = bench(board, { name: "Bench Drive" });
  if (!b.ok) throw new Error(b.why.join("; "));
  const { gear, knobs, net } = b.pedal;
  expect(gear.id).toBe("bench-bench-drive");
  expect(gear.jacks).toEqual({ "inst-in": 1, "line-out": 1 });
  // The 60 × 45 mm board in a box a few millimetres bigger.
  expect(gear.size).toEqual({ w: 0.072, h: 0.05, d: 0.057 });
  expect(knobs).toEqual([{ name: "DRIVE", ohms: 100e3 }, { name: "LEVEL", ohms: 10e3 }]);

  // On Q Amp's floor: the board at its knobs is the pedal link, ahead of the lead amp.
  const lead = AMPS[1];
  const play = (DRIVE: number, LEVEL: number) => {
    const live = applySettings({ amp: "lead", pedal: "bench", bench: net({ DRIVE, LEVEL }), drive: 0, swaps: {}, knobs: lead.knobs, bypass: false, oversample: 2, mic: { at: 0.3, angle: 0 } }, null, SR);
    const n = SR / 5, out = new Float32Array(n);
    live.rig.process(Float32Array.from({ length: n }, (_, i) => 0.05 * Math.sin((2 * Math.PI * 220 * i) / SR)), out);
    live.rig.levels();
    live.rig.process(Float32Array.from({ length: n }, (_, i) => 0.05 * Math.sin((2 * Math.PI * 220 * i) / SR)), out);
    return { pedal: live.rig.levels()[0], misses: live.rig.misses };
  };
  const low = play(0, 1), high = play(1, 1), quiet = play(0.5, 0);
  expect(low.misses + high.misses + quiet.misses).toBe(0);
  // DRIVE up is more gain into the diodes; LEVEL down is (nearly) nothing out.
  expect(high.pedal).toBeGreaterThan(3 * low.pedal);
  expect(quiet.pedal).toBeLessThan(0.01 * high.pedal);
});

// A hand-drawn board's JSON: each part's pins on nets by name, as tscircuit writes them.
type Pin = string;
function drawn(parts: { name: string; ftype: string; pins: Pin[]; labels?: string[]; resistance?: number; capacitance?: number }[]) {
  const els: unknown[] = [];
  const nets = new Set<string>();
  parts.forEach((p, i) => {
    els.push({ type: "source_component", source_component_id: `c${i}`, ftype: p.ftype, name: p.name, resistance: p.resistance, capacitance: p.capacitance });
    p.pins.forEach((net, j) => {
      nets.add(net);
      const name = p.labels?.[j] ?? `pin${j + 1}`;
      els.push({ type: "source_port", source_port_id: `c${i}p${j}`, source_component_id: `c${i}`, name, pin_number: j + 1, port_hints: j === 0 ? ["anode"] : ["cathode"], subcircuit_connectivity_map_key: `k_${net}` });
    });
  });
  for (const n of nets) els.push({ type: "source_net", name: n, is_ground: n === "GND", subcircuit_connectivity_map_key: `k_${n}` });
  return els;
}

test.each([
  ["a file that isn't circuit JSON", { hello: 1 }, {}, "not tscircuit circuit JSON"],
  ["a part the solver has no model for", drawn([
    { name: "X1", ftype: "simple_crystal", pins: ["IN", "OUT"] },
    { name: "R1", ftype: "simple_resistor", pins: ["IN", "OUT"], resistance: 1e3 },
  ]), {}, "X1: no model for simple_crystal yet"],
  ["no OUT jack", drawn([{ name: "R1", ftype: "simple_resistor", pins: ["IN", "GND"], resistance: 1e3 }]), {}, "no net called OUT"],
  // A diode straight across the 9 V supply with nothing to limit it: Newton never settles.
  ["a diode across the supply", drawn([
    { name: "D1", ftype: "simple_diode", pins: ["V_POS", "OUT"] },
    { name: "R1", ftype: "simple_resistor", pins: ["IN", "OUT"], resistance: 1e3 },
    { name: "D2", ftype: "simple_diode", pins: ["OUT", "GND"] },
  ]), { supplies: { V_POS: 9 } }, "Newton didn't converge"],
  ["OUT on a part that never hears IN", drawn([
    { name: "R1", ftype: "simple_resistor", pins: ["IN", "GND"], resistance: 1e3 },
    { name: "R2", ftype: "simple_resistor", pins: ["OUT", "GND"], resistance: 1e3 },
  ]), {}, "nothing comes out of OUT"],
])("%s says why instead of playing", (_, json, o, why) => {
  const b = bench(json, o);
  expect(b.ok).toBe(false);
  if (!b.ok) expect(b.why.join("\n")).toContain(why);
});
