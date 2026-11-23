// Q Hiss, the sound wall's noise and sample and hold (WALL.md). The noise: Q1's base-emitter junction, reverse-biased
// from +12 V through R1 until it breaks down (about 7 to 9 V), hisses tens of millivolts; C1 takes off its DC and
// U1A brings it up a hundredfold (R4 over R3, C2 keeping its DC gain at one) to a few volts, out through R5.
// The sample and hold: a rising clock, high-passed by C4 and R8 (D3 takes off the falling edge), trips U1C past
// R9/R10's 1.4 V for a fifth of a millisecond; while it is high, D2 lets go of Q2's gate and R6 turns it on, so C3
// follows U1B's copy of the input. When U1C falls, D2 pulls the gate to -11 V, past Q2's pinch-off, and U1D buffers
// what C3 holds. S&H In takes the noise while nothing is plugged into it (its jack's switch), so a clock alone gives
// random voltages. Our own values; the sim plays the gains, corners, threshold and pulse from these parts.
import { Chip, SMD, wallBoard, wires } from "./wall-kit.tsx";
import { panel } from "./wall-panels.ts";

export default wallBoard({
  panel: panel("noise"),
  chips: [{ name: "U1" }],
  pots: {},
  parts: <>
    <Chip name="U1" part="TL074" />
    <transistor name="Q1" type="npn" footprint="sot23" manufacturerPartNumber="MMBT3904 (noise junction)" />
    <chip name="Q2" footprint="sot23" manufacturerPartNumber="MMBFJ201" pinLabels={{ pin1: "DRAIN", pin2: "SOURCE", pin3: "GATE" }} />
    <resistor name="R1" resistance="100k" footprint={SMD} />
    <capacitor name="C1" capacitance="100nF" footprint={SMD} />
    <resistor name="R2" resistance="1M" footprint={SMD} />
    <resistor name="R3" resistance="1k" footprint={SMD} />
    <capacitor name="C2" capacitance="10uF" footprint={SMD} />
    <resistor name="R4" resistance="100k" footprint={SMD} />
    <resistor name="R5" resistance="1k" footprint={SMD} />
    <resistor name="R6" resistance="1M" footprint={SMD} />
    <diode name="D2" footprint="sod123" manufacturerPartNumber="1N4148W" />
    <capacitor name="C3" capacitance="1nF" footprint={SMD} manufacturerPartNumber="C0G" />
    <resistor name="R7" resistance="1k" footprint={SMD} />
    <capacitor name="C4" capacitance="10nF" footprint={SMD} />
    <resistor name="R8" resistance="10k" footprint={SMD} />
    <diode name="D3" footprint="sod123" manufacturerPartNumber="1N4148W" />
    <resistor name="R9" resistance="100k" footprint={SMD} />
    <resistor name="R10" resistance="13k" footprint={SMD} />
  </>,
  traces: <>{wires([
    // The junction and its amplifier.
    ["R1 > .pin1", "net.V12"], ["R1 > .pin2", "net.NJ"],
    ["Q1 > .emitter", "net.NJ"], ["Q1 > .base", "net.GND"], ["Q1 > .collector", "net.GND"],
    ["C1 > .pin1", "net.NJ"], ["C1 > .pin2", "net.NA"], ["R2 > .pin1", "net.NA"], ["R2 > .pin2", "net.GND"],
    ["U1 > .INPA", "net.NA"], ["U1 > .INNA", "net.NFB"], ["U1 > .OUTA", "net.NI"],
    ["R4 > .pin1", "net.NI"], ["R4 > .pin2", "net.NFB"], ["R3 > .pin1", "net.NFB"], ["R3 > .pin2", "net.NG"],
    ["C2 > .pin1", "net.NG"], ["C2 > .pin2", "net.GND"],
    ["R5 > .pin1", "net.NI"], ["R5 > .pin2", "net.NOISE"],
    // The clock to a short pulse.
    ["C4 > .pin1", "net.CLOCK"], ["C4 > .pin2", "net.TRIG"], ["R8 > .pin1", "net.TRIG"], ["R8 > .pin2", "net.GND"],
    ["D3 > .anode", "net.GND"], ["D3 > .cathode", "net.TRIG"],
    ["R9 > .pin1", "net.V12"], ["R9 > .pin2", "net.REF"], ["R10 > .pin1", "net.REF"], ["R10 > .pin2", "net.GND"],
    ["U1 > .INPC", "net.TRIG"], ["U1 > .INNC", "net.REF"], ["U1 > .OUTC", "net.CMP"],
    // The switch and the hold.
    ["U1 > .INPB", "net.IN"], ["U1 > .INNB", "net.SB"], ["U1 > .OUTB", "net.SB"],
    ["Q2 > .DRAIN", "net.SB"], ["Q2 > .SOURCE", "net.HOLD"], ["Q2 > .GATE", "net.SG"],
    ["R6 > .pin1", "net.SG"], ["R6 > .pin2", "net.HOLD"], ["D2 > .anode", "net.SG"], ["D2 > .cathode", "net.CMP"],
    ["C3 > .pin1", "net.HOLD"], ["C3 > .pin2", "net.GND"],
    ["U1 > .INPD", "net.HOLD"], ["U1 > .INND", "net.SO"], ["U1 > .OUTD", "net.SO"],
    ["R7 > .pin1", "net.SO"], ["R7 > .pin2", "net.OUT"],
  ])}</>,
});
