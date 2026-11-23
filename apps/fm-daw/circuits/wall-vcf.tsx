// Q Filter, the sound wall's VCF (WALL.md): a two-pole state-variable filter of two LM13700 OTAs, as in the
// LM13700 datasheet, with low-, band- and high-pass out at once. U1C sums the input, the low-pass and some of the
// band-pass (Res: more of it is less damping, R10 + RV2 over 100k is Q, 0.5 to 10) into the high-pass; each OTA
// integrates the stage before it on 1 nF (U2A for the band-pass, U2B for the low-pass) and U1D and U3A buffer them.
// Each OTA sees its input through 100k into 220R, so the integrators are clean until the resonance drives them hard.
//
// The cutoff is set by both OTAs' bias current, from an exponential converter of three PNPs: Q1 is the reference
// (U1B holds it at 12 V / R6, about 146 uA: 1 kHz), Q2 and Q3 hand the same current, doubled per volt, to the two
// bias pins. Freq is +-5 octaves, CV is the jack through its attenuator, about 1 V an octave (no trim: a filter
// needn't track). R7 caps each pin near 2 mA, the chip's limit. Our own values. The sim (src/wall/sims.ts) plays
// the filter from this board's netlist, sample by sample, with the converter's current worked out from its parts.
import { Chip, SMD, wallBoard, wires } from "./wall-kit.tsx";
import { panel } from "./wall-panels.ts";

export default wallBoard({
  panel: panel("vcf"),
  chips: [{ name: "U1" }, { name: "U2" }, { name: "U3" }],
  pots: {
    freq: { ohms: "100k", ends: ["VN12", "V12"] },
    res: { ohms: "1M", ends: ["RQ", "W"], wiper: "SSUM" },
    cv: { ohms: "100k", ends: ["GND", "CV"] },
  },
  parts: <>
    <Chip name="U1" part="TL074" />
    <Chip name="U2" part="LM13700" />
    <Chip name="U3" part="TL072" />
    <transistor name="Q1" type="pnp" footprint="sot23" manufacturerPartNumber="MMBT3906 (matched)" />
    <transistor name="Q2" type="pnp" footprint="sot23" manufacturerPartNumber="MMBT3906 (matched)" />
    <transistor name="Q3" type="pnp" footprint="sot23" manufacturerPartNumber="MMBT3906 (matched)" />
    <resistor name="R1" resistance="240k" footprint={SMD} />
    <resistor name="R2" resistance="100k" footprint={SMD} />
    <resistor name="R3" resistance="100k" footprint={SMD} />
    <resistor name="R4" resistance="100k" footprint={SMD} />
    <resistor name="R5" resistance="1.8k" footprint={SMD} />
    <resistor name="R6" resistance="82k" footprint={SMD} />
    <resistor name="R7" resistance="2.7k" footprint={SMD} />
    <capacitor name="C1" capacitance="100pF" footprint={SMD} />
    <resistor name="R8" resistance="100k" footprint={SMD} />
    <resistor name="R9" resistance="100k" footprint={SMD} />
    <resistor name="R10" resistance="47k" footprint={SMD} />
    <resistor name="R11" resistance="100k" footprint={SMD} />
    <resistor name="R12" resistance="100k" footprint={SMD} />
    <resistor name="R13" resistance="220" footprint={SMD} />
    <resistor name="R14" resistance="220" footprint={SMD} />
    <capacitor name="C3" capacitance="1nF" footprint={SMD} manufacturerPartNumber="C0G" />
    <resistor name="R15" resistance="100k" footprint={SMD} />
    <resistor name="R16" resistance="220" footprint={SMD} />
    <resistor name="R17" resistance="220" footprint={SMD} />
    <capacitor name="C4" capacitance="1nF" footprint={SMD} manufacturerPartNumber="C0G" />
    <resistor name="R18" resistance="1k" footprint={SMD} />
    <resistor name="R19" resistance="1k" footprint={SMD} />
    <resistor name="R20" resistance="1k" footprint={SMD} />
  </>,
  traces: <>{wires([
    // The CV summer and the divider onto the output transistors' bases.
    ["R1 > .pin1", "net.FREQ_W"], ["R1 > .pin2", "net.ESUM"],
    ["R2 > .pin1", "net.CV_W"], ["R2 > .pin2", "net.ESUM"],
    ["R3 > .pin1", "net.N_EXP"], ["R3 > .pin2", "net.ESUM"],
    ["U1 > .INNA", "net.ESUM"], ["U1 > .INPA", "net.GND"], ["U1 > .OUTA", "net.N_EXP"],
    ["R4 > .pin1", "net.N_EXP"], ["R4 > .pin2", "net.B2"], ["R5 > .pin1", "net.B2"], ["R5 > .pin2", "net.GND"],
    // The converter: Q1 held at 12 V / R6 by U1B; Q2 and Q3 into the bias pins.
    ["R6 > .pin1", "net.REF"], ["R6 > .pin2", "net.VN12"],
    ["Q1 > .base", "net.GND"], ["Q1 > .collector", "net.REF"], ["Q1 > .emitter", "net.E"],
    ["U1 > .INNB", "net.REF"], ["U1 > .INPB", "net.GND"], ["U1 > .OUTB", "net.SERVO"],
    ["C1 > .pin1", "net.SERVO"], ["C1 > .pin2", "net.REF"], ["R7 > .pin1", "net.SERVO"], ["R7 > .pin2", "net.E"],
    ["Q2 > .base", "net.B2"], ["Q2 > .collector", "net.IABC_A"], ["Q2 > .emitter", "net.E"],
    ["Q3 > .base", "net.B2"], ["Q3 > .collector", "net.IABC_B"], ["Q3 > .emitter", "net.E"],
    ["U2 > .IABCA", "net.IABC_A"], ["U2 > .IABCB", "net.IABC_B"],
    // The state-variable loop.
    ["R8 > .pin1", "net.IN"], ["R8 > .pin2", "net.SSUM"],
    ["R9 > .pin1", "net.LP_I"], ["R9 > .pin2", "net.SSUM"],
    ["R10 > .pin1", "net.BP_I"], ["R10 > .pin2", "net.RQ"],
    ["R11 > .pin1", "net.HP_I"], ["R11 > .pin2", "net.SSUM"],
    ["U1 > .INNC", "net.SSUM"], ["U1 > .INPC", "net.GND"], ["U1 > .OUTC", "net.HP_I"],
    ["R12 > .pin1", "net.HP_I"], ["R12 > .pin2", "net.INP_A"], ["R13 > .pin1", "net.INP_A"], ["R13 > .pin2", "net.GND"],
    ["U2 > .INPA", "net.INP_A"], ["U2 > .INNA", "net.INN_A"], ["R14 > .pin1", "net.INN_A"], ["R14 > .pin2", "net.GND"],
    ["U2 > .OUTA", "net.BPC"], ["C3 > .pin1", "net.BPC"], ["C3 > .pin2", "net.GND"],
    ["U1 > .INPD", "net.BPC"], ["U1 > .INND", "net.BP_I"], ["U1 > .OUTD", "net.BP_I"],
    ["R15 > .pin1", "net.BP_I"], ["R15 > .pin2", "net.INP_B"], ["R16 > .pin1", "net.INP_B"], ["R16 > .pin2", "net.GND"],
    ["U2 > .INPB", "net.INP_B"], ["U2 > .INNB", "net.INN_B"], ["R17 > .pin1", "net.INN_B"], ["R17 > .pin2", "net.GND"],
    ["U2 > .OUTB", "net.LPC"], ["C4 > .pin1", "net.LPC"], ["C4 > .pin2", "net.GND"],
    ["U3 > .INPA", "net.LPC"], ["U3 > .INNA", "net.LP_I"], ["U3 > .OUTA", "net.LP_I"],
    ["R18 > .pin1", "net.LP_I"], ["R18 > .pin2", "net.LP"],
    ["R19 > .pin1", "net.BP_I"], ["R19 > .pin2", "net.BP"],
    ["R20 > .pin1", "net.HP_I"], ["R20 > .pin2", "net.HP"],
    // U3B is spare: a follower on ground.
    ["U3 > .INPB", "net.GND"], ["U3 > .INNB", "U3 > .OUTB"],
  ])}</>,
});
