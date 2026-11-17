// Q Squeeze as a real 9 V pedal board: the `opticalComp()` voicing (comp.tsx)
// inside the box every Q pedal shares (q-box.tsx). R1 in series and a vactrol's
// LDR (U2) to the bias ahead of an op-amp gain stage (U1); the stage's output
// lights the vactrol's LED and darkens the LDR, so the louder it gets, the more
// it is turned down, and the LDR's slow recovery is the smooth release.
//
// What the sim hears: C1, R1, U2's LDR, U1, R3 + RV1 (the sim board's one Sustain
// resistor: a 10k stop plus a 250k audio pot), R2, C3. R4 holds the op-amp's input
// at the bias while the LDR is dark (the sim's LDR to ground is the bias path). On
// 9 V the LDR goes to the 4.5 V bias (VREF) instead of ground; to the signal the two
// are the same node.
//
// What the sim moves by hand (its "led" `Mod`, an envelope follower) is on this
// board: C2 and R5 take the output to Q1's base, D1 keeps the negative half off it,
// and on each peak past about 0.6 V Q1 sinks the vactrol's LED current through R6.
// Attack is Q1's, as quick as the peaks; release is the LDR's own.
//
// Sockets: the gain leg's cap C3 and the op-amp U1. The vactrol is one part to order
// (an LED and an LDR sealed together, 4 legs); two bare parts taped in heat-shrink do too.
import { AXIAL, ELECTROLYTIC, FILM, qBox } from "./q-box.tsx";

export default qBox({
  drive: { ohms: "250k", part: "Alpha 16mm 250k A" },
  level: { ohms: "100k", part: "Alpha 16mm 100k A" },
  parts: <>
    <capacitor name="C1" capacitance="1uF" footprint={FILM} />
    <resistor name="R1" resistance="10k" footprint={AXIAL} />
    <chip name="U2" manufacturerPartNumber="NSL-32SR3 vactrol" footprint="dip4"
      pinLabels={{ pin1: "LEDA", pin2: "LEDK", pin3: "LDR1", pin4: "LDR2" }} />
    <resistor name="R4" resistance="1M" footprint={AXIAL} />
    <chip name="U1" manufacturerPartNumber="TL071" footprint="dip8"
      pinLabels={{ pin1: "NULL1", pin2: "INN", pin3: "INP", pin4: "VNEG", pin5: "NULL2", pin6: "OUT", pin7: "VPOS", pin8: "NC" }} />
    <resistor name="R3" resistance="10k" footprint={AXIAL} />
    <resistor name="R2" resistance="4.7k" footprint={AXIAL} />
    <capacitor name="C3" capacitance="4.7uF" polarized footprint={ELECTROLYTIC} />
    <capacitor name="C2" capacitance="1uF" footprint={FILM} />
    <resistor name="R5" resistance="10k" footprint={AXIAL} />
    <diode name="D1" manufacturerPartNumber="1N4148" footprint={AXIAL} />
    <transistor name="Q1" type="npn" manufacturerPartNumber="2N3904" footprint="to92" />
    <resistor name="R6" resistance="1k" footprint={AXIAL} />
  </>,
  traces: <>
    <trace from=".C1 > .pin1" to="net.IN" />
    <trace from=".C1 > .pin2" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to=".U1 > .INP" />
    <trace from=".U2 > .LDR1" to=".U1 > .INP" />
    <trace from=".U2 > .LDR2" to="net.VREF" />
    <trace from=".R4 > .pin1" to=".U1 > .INP" />
    <trace from=".R4 > .pin2" to="net.VREF" />
    <trace from=".U1 > .OUT" to="net.TONE" />
    <trace from=".R3 > .pin1" to="net.TONE" />
    <trace from=".R3 > .pin2" to=".RV1 > .pin1" />
    <trace from=".RV1 > .pin2" to=".U1 > .INN" />
    <trace from=".RV1 > .pin3" to=".U1 > .INN" />
    <trace from=".R2 > .pin1" to=".U1 > .INN" />
    <trace from=".R2 > .pin2" to=".C3 > .pin1" />
    <trace from=".C3 > .pin2" to="net.GND" />

    <trace from=".C2 > .pin1" to="net.TONE" />
    <trace from=".C2 > .pin2" to=".R5 > .pin1" />
    <trace from=".R5 > .pin2" to=".Q1 > .base" />
    <trace from=".D1 > .cathode" to=".Q1 > .base" />
    <trace from=".D1 > .anode" to="net.GND" />
    <trace from=".Q1 > .emitter" to="net.GND" />
    <trace from=".Q1 > .collector" to=".U2 > .LEDK" />
    <trace from=".U2 > .LEDA" to=".R6 > .pin1" />
    <trace from=".R6 > .pin2" to="net.V9" />
  </>,
});
