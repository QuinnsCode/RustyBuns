// Q Saw, the sound wall's VCO (WALL.md): the textbook sawtooth core. An exponential converter (a matched NPN pair,
// its reference held at 6.7 uA by U1B) sinks a current that doubles for every volt on V/Oct; U1C integrates it on
// C2 into a rising ramp; when the ramp passes 5 V, U1D fires and the JFET Q3 empties C2, and the ramp starts again.
// So f = I / (C2 x 5 V): 133 Hz at 0 V. U2A turns the 0 to 5 V ramp into a +-5 V saw; U2B compares it with Width
// for the pulse. Our own values.
//
// The CV side: V/Oct (R1, 100k 0.1%), FM through its attenuator, Tune (+-4 octaves) and Fine (+-1.4 semitones)
// summed by U1A, then R6 into R7 + RT1, about 1/56, onto Q1's base: 17.9 mV a volt, VT ln 2 at 26 C, which is
// 1 V an octave. RT1 trims the scale. Q1 and Q2 must be matched and touching (or one dual part, BCM847DS), or the
// tuning drifts with the room. The sim (src/wall/sims.ts) reads the frequency off these parts: it doesn't solve
// the core sample by sample.
import { Chip, SMD, wallBoard, wires } from "./wall-kit.tsx";
import { panel } from "./wall-panels.ts";

export default wallBoard({
  panel: panel("vco"),
  chips: [{ name: "U1" }, { name: "U2" }],
  pots: {
    tune: { ohms: "100k", ends: ["VN12", "V12"] },
    fine: { ohms: "100k", ends: ["VN12", "V12"] },
    fm: { ohms: "100k", ends: ["GND", "FM"] },
    pw: { ohms: "10k", ends: ["PW_TOP", "PW_BOT"] },
  },
  parts: <>
    <Chip name="U1" part="TL074" />
    <Chip name="U2" part="TL072" />
    <transistor name="Q1" type="npn" footprint="sot23" manufacturerPartNumber="MMBT3904 (matched to Q2)" />
    <transistor name="Q2" type="npn" footprint="sot23" manufacturerPartNumber="MMBT3904 (matched to Q1)" />
    <chip name="Q3" footprint="sot23" manufacturerPartNumber="MMBFJ111" pinLabels={{ pin1: "DRAIN", pin2: "SOURCE", pin3: "GATE" }} />
    <potentiometer name="RT1" maxResistance="1k" pinVariant="three_pin" footprint="pinrow3_p2.54mm" manufacturerPartNumber="3362P 1k trimmer" />
    <diode name="D1" footprint="sod123" manufacturerPartNumber="1N4148W" />
    <resistor name="R1" resistance="100k" footprint={SMD} manufacturerPartNumber="0.1%" />
    <resistor name="R2" resistance="100k" footprint={SMD} />
    <resistor name="R3" resistance="300k" footprint={SMD} />
    <resistor name="R4" resistance="10M" footprint={SMD} />
    <resistor name="R5" resistance="100k" footprint={SMD} manufacturerPartNumber="0.1%" />
    <resistor name="R6" resistance="100k" footprint={SMD} />
    <resistor name="R7" resistance="1.5k" footprint={SMD} />
    <resistor name="R8" resistance="1.8M" footprint={SMD} />
    <resistor name="R9" resistance="10k" footprint={SMD} />
    <capacitor name="C1" capacitance="100pF" footprint={SMD} />
    <capacitor name="C2" capacitance="10nF" footprint={SMD} manufacturerPartNumber="C0G" />
    <resistor name="R10" resistance="14k" footprint={SMD} />
    <resistor name="R11" resistance="10k" footprint={SMD} />
    <resistor name="R12" resistance="10k" footprint={SMD} />
    <capacitor name="C3" capacitance="100pF" footprint={SMD} />
    <resistor name="R13" resistance="10k" footprint={SMD} />
    <resistor name="R14" resistance="100k" footprint={SMD} />
    <resistor name="R15" resistance="20k" footprint={SMD} />
    <resistor name="R16" resistance="97.6k" footprint={SMD} />
    <resistor name="R17" resistance="40.2k" footprint={SMD} />
    <resistor name="R18" resistance="1k" footprint={SMD} />
    <resistor name="R19" resistance="18k" footprint={SMD} />
    <resistor name="R20" resistance="1.2k" footprint={SMD} />
    <resistor name="R21" resistance="1k" footprint={SMD} />
    <resistor name="R22" resistance="1k" footprint={SMD} />
  </>,
  traces: <>{wires([
    // The CV summer and the divider onto the reference transistor's base.
    ["R1 > .pin1", "net.VOCT"], ["R1 > .pin2", "net.ESUM"],
    ["R2 > .pin1", "net.FM_W"], ["R2 > .pin2", "net.ESUM"],
    ["R3 > .pin1", "net.TUNE_W"], ["R3 > .pin2", "net.ESUM"],
    ["R4 > .pin1", "net.FINE_W"], ["R4 > .pin2", "net.ESUM"],
    ["R5 > .pin1", "net.N_EXP"], ["R5 > .pin2", "net.ESUM"],
    ["U1 > .INNA", "net.ESUM"], ["U1 > .INPA", "net.GND"], ["U1 > .OUTA", "net.N_EXP"],
    ["R6 > .pin1", "net.N_EXP"], ["R6 > .pin2", "net.B1"], ["R7 > .pin1", "net.B1"], ["R7 > .pin2", "RT1 > .pin1"], ["RT1 > .pin2", "net.GND"],
    // The exponential pair: U1B holds Q1 at the reference current R8 sets, Q2 sinks the doubled-per-volt one.
    ["R8 > .pin1", "net.V12"], ["R8 > .pin2", "net.REF"],
    ["Q1 > .base", "net.B1"], ["Q1 > .collector", "net.REF"], ["Q1 > .emitter", "net.E"],
    ["U1 > .INNB", "net.REF"], ["U1 > .INPB", "net.GND"], ["U1 > .OUTB", "net.SERVO"],
    ["C1 > .pin1", "net.SERVO"], ["C1 > .pin2", "net.REF"], ["R9 > .pin1", "net.SERVO"], ["R9 > .pin2", "net.E"],
    ["Q2 > .base", "net.GND"], ["Q2 > .collector", "net.INT"], ["Q2 > .emitter", "net.E"],
    // The core: U1C integrates, U1D fires at VTH (5 V), the JFET resets C2.
    ["U1 > .INNC", "net.INT"], ["U1 > .INPC", "net.GND"], ["U1 > .OUTC", "net.RAMP"],
    ["C2 > .pin1", "net.RAMP"], ["C2 > .pin2", "net.INT"],
    ["Q3 > .DRAIN", "net.RAMP"], ["Q3 > .SOURCE", "net.INT"], ["Q3 > .GATE", "net.GATE_J"],
    ["R10 > .pin1", "net.V12"], ["R10 > .pin2", "net.VTH"], ["R11 > .pin1", "net.VTH"], ["R11 > .pin2", "net.GND"],
    ["R12 > .pin1", "net.RAMP"], ["R12 > .pin2", "net.CMP_P"], ["U1 > .INPD", "net.CMP_P"], ["U1 > .INND", "net.VTH"], ["U1 > .OUTD", "net.CMP"],
    ["C3 > .pin1", "net.CMP"], ["C3 > .pin2", "net.CMP_P"],
    ["D1 > .anode", "net.CMP"], ["D1 > .cathode", "R13 > .pin1"], ["R13 > .pin2", "net.GATE_J"], ["R14 > .pin1", "net.GATE_J"], ["R14 > .pin2", "net.VN12"],
    // The saw: 5 V - 2 x ramp, +-5 V.
    ["R15 > .pin1", "net.RAMP"], ["R15 > .pin2", "net.SSUM"], ["R16 > .pin1", "net.VN12"], ["R16 > .pin2", "net.SSUM"],
    ["R17 > .pin1", "net.SAW_I"], ["R17 > .pin2", "net.SSUM"],
    ["U2 > .INNA", "net.SSUM"], ["U2 > .INPA", "net.GND"], ["U2 > .OUTA", "net.SAW_I"],
    ["R18 > .pin1", "net.SAW_I"], ["R18 > .pin2", "net.SAW"],
    // The pulse: the ramp against Width (0.5 to 4.6 V), halved to +-5.5 V.
    ["R19 > .pin1", "net.V12"], ["R19 > .pin2", "net.PW_TOP"], ["R20 > .pin1", "net.PW_BOT"], ["R20 > .pin2", "net.GND"],
    ["U2 > .INPB", "net.RAMP"], ["U2 > .INNB", "net.PW_W"], ["U2 > .OUTB", "net.PULSE_I"],
    ["R21 > .pin1", "net.PULSE_I"], ["R21 > .pin2", "net.PULSE"], ["R22 > .pin1", "net.PULSE"], ["R22 > .pin2", "net.GND"],
  ])}</>,
});
