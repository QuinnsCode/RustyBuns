// Q Level, the sound wall's VCA (WALL.md): one half of an LM13700 OTA, its gain set by the current into its bias pin.
// The circuit is the OTA amplifier of the LM13700 datasheet, with an op-amp current-to-voltage stage on its output
// instead of the chip's own Darlington buffer, so the output sits at 0 V with nothing playing (a VCA on CV can't
// have an offset), and a linear current source on its bias pin. Our own values.
//
// Control: Level (a 0 to 5 V offset) plus the CV jack through its attenuator, summed by U1A and turned back up by
// U1B (P_CTL), then U1C and Q1 sink P_CTL / R10 (10k: 5 V is 500 uA) and the PNP mirror Q2/Q3 hands that current
// to the OTA's bias pin. Below 0 V the sink is off (D1 keeps Q1's base off its reverse breakdown), so the VCA shuts.
// Audio: the input through 100k into 220R (about 1/456, so 5 V is 11 mV at the OTA, where it is nearly linear),
// the OTA's current into U1D, whose 47k turns 500 uA of bias into unity gain. The sim plays U2A and U1D from this
// board and computes the bias current from the control parts (src/wall/sims.ts).
import { Chip, SMD, wallBoard, wires } from "./wall-kit.tsx";
import { panel } from "./wall-panels.ts";

export default wallBoard({
  panel: panel("vca"),
  chips: [{ name: "U1" }, { name: "U2" }],
  pots: { level: { ohms: "100k", ends: ["GND", "LEVEL_TOP"] }, cv: { ohms: "100k", ends: ["GND", "CV"] } },
  parts: <>
    <Chip name="U1" part="TL074" />
    <Chip name="U2" part="LM13700" />
    <transistor name="Q1" type="npn" footprint="sot23" manufacturerPartNumber="MMBT3904" />
    <transistor name="Q2" type="pnp" footprint="sot23" manufacturerPartNumber="MMBT3906" />
    <transistor name="Q3" type="pnp" footprint="sot23" manufacturerPartNumber="MMBT3906" />
    <diode name="D1" footprint="sod123" manufacturerPartNumber="1N4148W" />
    <resistor name="R1" resistance="140k" footprint={SMD} />
    <resistor name="R2" resistance="100k" footprint={SMD} />
    <resistor name="R3" resistance="100k" footprint={SMD} />
    <resistor name="R4" resistance="100k" footprint={SMD} />
    <resistor name="R5" resistance="100k" footprint={SMD} />
    <resistor name="R6" resistance="100k" footprint={SMD} />
    <resistor name="R9" resistance="1k" footprint={SMD} />
    <resistor name="R10" resistance="10k" footprint={SMD} />
    <resistor name="R11" resistance="1k" footprint={SMD} />
    <resistor name="R12" resistance="1k" footprint={SMD} />
    <resistor name="R13" resistance="100k" footprint={SMD} />
    <resistor name="R14" resistance="220" footprint={SMD} />
    <resistor name="R15" resistance="220" footprint={SMD} />
    <resistor name="R16" resistance="47k" footprint={SMD} />
    <capacitor name="C1" capacitance="100pF" footprint={SMD} />
    <resistor name="R17" resistance="1k" footprint={SMD} />
  </>,
  traces: <>{wires([
    // Level: 0 to 5 V from 12 V over R1 and the pot; CV through its attenuator; summed into U1A, inverted by U1B.
    ["R1 > .pin1", "net.V12"], ["R1 > .pin2", "net.LEVEL_TOP"],
    ["R2 > .pin1", "net.LEVEL_W"], ["R2 > .pin2", "net.SUM"],
    ["R3 > .pin1", "net.CV_W"], ["R3 > .pin2", "net.SUM"],
    ["R4 > .pin1", "net.N_CTL"], ["R4 > .pin2", "net.SUM"],
    ["U1 > .INNA", "net.SUM"], ["U1 > .INPA", "net.GND"], ["U1 > .OUTA", "net.N_CTL"],
    ["R5 > .pin1", "net.N_CTL"], ["R5 > .pin2", "net.INV"],
    ["R6 > .pin1", "net.P_CTL"], ["R6 > .pin2", "net.INV"],
    ["U1 > .INNB", "net.INV"], ["U1 > .INPB", "net.GND"], ["U1 > .OUTB", "net.P_CTL"],
    // The current sink, P_CTL / R10, and the mirror into the bias pin.
    ["U1 > .INPC", "net.P_CTL"], ["U1 > .INNC", "net.VE"], ["U1 > .OUTC", "R9 > .pin1"],
    ["R9 > .pin2", "net.QB"], ["Q1 > .base", "net.QB"], ["Q1 > .emitter", "net.VE"], ["R10 > .pin1", "net.VE"], ["R10 > .pin2", "net.GND"],
    ["D1 > .anode", "net.VE"], ["D1 > .cathode", "net.QB"],
    ["Q1 > .collector", "net.MIR"],
    ["R11 > .pin1", "net.V12"], ["R11 > .pin2", "Q2 > .emitter"], ["Q2 > .base", "net.MIR"], ["Q2 > .collector", "net.MIR"],
    ["R12 > .pin1", "net.V12"], ["R12 > .pin2", "Q3 > .emitter"], ["Q3 > .base", "net.MIR"], ["Q3 > .collector", "net.IABC"],
    ["U2 > .IABCA", "net.IABC"],
    // Audio: in, the attenuator, the OTA, U1D's current-to-voltage stage, out.
    ["R13 > .pin1", "net.IN"], ["R13 > .pin2", "net.INN_A"], ["R14 > .pin1", "net.INN_A"], ["R14 > .pin2", "net.GND"],
    ["U2 > .INNA", "net.INN_A"], ["U2 > .INPA", "net.INP_A"], ["R15 > .pin1", "net.INP_A"], ["R15 > .pin2", "net.GND"],
    ["U2 > .OUTA", "net.IOUT"], ["U1 > .INND", "net.IOUT"], ["U1 > .INPD", "net.GND"], ["U1 > .OUTD", "net.OUT_PRE"],
    ["R16 > .pin1", "net.OUT_PRE"], ["R16 > .pin2", "net.IOUT"], ["C1 > .pin1", "net.OUT_PRE"], ["C1 > .pin2", "net.IOUT"],
    ["R17 > .pin1", "net.OUT_PRE"], ["R17 > .pin2", "net.OUT"],
    // The other half of the LM13700 is off: no bias current, inputs and output on ground.
    ["U2 > .INPB", "net.GND"], ["U2 > .INNB", "net.GND"], ["U2 > .OUTB", "net.GND"],
  ])}</>,
});
