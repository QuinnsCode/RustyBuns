// A drive pedal drawn in tscircuit with two pots, the bench's first board: the
// hard-clip pedal (circuits/hard-clip.tsx) with a DRIVE pot in the op-amp's
// feedback and a LEVEL pot on the way out. test/fixtures/bench-drive.circuit.json
// is what tscircuit rendered from it, `pcb_board` kept so the bench knows its size.
//
// tscircuit is parked in this repo (it pins zod 3, see apps/tscircuit-desktop),
// so render it in a scratch folder outside the workspace:
//   bun add tscircuit@0.0.2565 react && bun bench-drive.tsx bench-drive.circuit.json
import { Circuit } from "tscircuit";
const circuit = new Circuit();
circuit.add(
  <board width="60mm" height="45mm">
    <chip name="U1" footprint="sot23_5" pinLabels={{ pin1: "OUT", pin2: "VNEG", pin3: "INP", pin4: "INN", pin5: "VPOS" }} />
    <capacitor name="C1" capacitance="100nF" footprint="0603" />
    <resistor name="R1" resistance="1M" footprint="0603" />
    <resistor name="R2" resistance="1k" footprint="0603" />
    <capacitor name="C2" capacitance="4.7uF" footprint="0805" />
    <resistor name="R3" resistance="4.7k" footprint="0603" />
    <potentiometer name="DRIVE" maxResistance="100k" pinVariant="three_pin" footprint="pinrow3" />
    <resistor name="R4" resistance="1k" footprint="0603" />
    <diode name="D1" footprint="sod123" />
    <diode name="D2" footprint="sod123" />
    <resistor name="R5" resistance="10k" footprint="0603" />
    <capacitor name="C3" capacitance="10nF" footprint="0603" />
    <potentiometer name="LEVEL" maxResistance="10k" pinVariant="three_pin" footprint="pinrow3" />
    <trace from=".C1 > .pin1" to="net.IN" />
    <trace from=".C1 > .pin2" to=".U1 > .INP" />
    <trace from=".R1 > .pin1" to=".U1 > .INP" />
    <trace from=".R1 > .pin2" to="net.GND" />
    <trace from=".R3 > .pin1" to=".U1 > .OUT" />
    <trace from=".R3 > .pin2" to=".DRIVE > .pin1" />
    <trace from=".DRIVE > .pin2" to=".U1 > .INN" />
    <trace from=".DRIVE > .pin3" to=".U1 > .INN" />
    <trace from=".R2 > .pin1" to=".U1 > .INN" />
    <trace from=".R2 > .pin2" to=".C2 > .pin1" />
    <trace from=".C2 > .pin2" to="net.GND" />
    <trace from=".R4 > .pin1" to=".U1 > .OUT" />
    <trace from=".R4 > .pin2" to=".D1 > .anode" />
    <trace from=".D1 > .cathode" to="net.GND" />
    <trace from=".D2 > .anode" to="net.GND" />
    <trace from=".D2 > .cathode" to=".R4 > .pin2" />
    <trace from=".R5 > .pin1" to=".R4 > .pin2" />
    <trace from=".R5 > .pin2" to=".C3 > .pin1" />
    <trace from=".C3 > .pin2" to="net.GND" />
    <trace from=".LEVEL > .pin3" to=".C3 > .pin1" />
    <trace from=".LEVEL > .pin2" to="net.OUT" />
    <trace from=".LEVEL > .pin1" to="net.GND" />
    <trace from=".U1 > .VPOS" to="net.V_POS" />
    <trace from=".U1 > .VNEG" to="net.V_NEG" />
  </board>,
);
circuit.render();
const json = circuit.getCircuitJson();
const keep = new Set(["source_component", "source_port", "source_net", "source_trace", "pcb_board"]);
await Bun.write(process.argv[2] ?? "pedal.json", JSON.stringify(json.filter((e: { type: string }) => keep.has(e.type)), null, 1));
console.log("elements", json.length, "errors", json.filter((e: { type: string }) => e.type.endsWith("_error")).map((e: any) => e.message ?? e.type));
