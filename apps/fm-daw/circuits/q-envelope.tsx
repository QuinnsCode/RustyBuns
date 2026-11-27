// Q Envelope as a real 9 V pedal board: the envelope wah (autowah.tsx) inside the
// box every Q pedal shares (q-box.tsx), with the envelope follower the sim plays off
// the board on it. Q Wah's tank and Miller stage, its treadle replaced by a
// vactrol's LDR (U4). One TL074 holds the sim's three op-amps and the follower's:
// A is U1 (the tank's buffer), B is U2 (the Miller stage), C is U3 (the sum out).
//
// What the sim hears: R1, L1, R2, C1, R3, U1 (A), R4, U4's LDR, U2 (B), C2, R6, R7,
// U3 (C). R2 is the 60 Ω the sim gives L1's winding: fit a 62 Ω, or a wire link if
// your inductor's own winding already reads about 60 Ω. C5 brings the guitar to the
// 4.5 V bias, and on 9 V the tank and the op-amps' + inputs sit at the bias (VREF)
// instead of ground; to the signal the two are the same node.
//
// What the sim moves by hand (its "foot" `Mod`, an envelope follower) is on this
// board: U1D takes the buffered tank through C6 and R8 at a gain of R11 + RV1 (the
// Sens pot) over R8, about 1 to 50; C7 and R9 take its output to Q1's base, D1 keeps
// the negative half off it, and on each peak past about 0.6 V Q1 sinks the vactrol's
// LED current through R10. Attack is Q1's, as quick as the peaks; the fall back to the
// heel is the LDR's own.
//
// Sockets: the op-amp U1. The vactrol is one part to order (an LED and an LDR sealed
// together, 4 legs); two bare parts taped in heat-shrink do too.
import { AXIAL, FILM, QUAD, amp, qBox } from "./q-box.tsx";

const BUF = amp("U1", "A"), MILLER = amp("U1", "B"), SUM = amp("U1", "C"), SENS = amp("U1", "D");

export default qBox({
  drive: { ohms: "500k", part: "Alpha 16mm 500k A" },
  gap: 0.3,
  parts: <>
    <capacitor name="C5" capacitance="1uF" footprint={FILM} />
    <resistor name="R1" resistance="15k" footprint={AXIAL} />
    <inductor name="L1" inductance={0.5} manufacturerPartNumber="500mH wah inductor" footprint="pinrow2_p5mm_id1.1mm_od2mm" />
    <capacitor name="C1" capacitance="4.7nF" footprint={FILM} />
    <resistor name="R2" resistance="60" footprint={AXIAL} />
    <resistor name="R3" resistance="68k" footprint={AXIAL} />
    <chip name="U1" manufacturerPartNumber="TL074" footprint="dip14" pinLabels={QUAD} />
    <resistor name="R4" resistance="10k" footprint={AXIAL} />
    <chip name="U4" manufacturerPartNumber="NSL-32SR3 vactrol" footprint="dip4"
      pinLabels={{ pin1: "LEDA", pin2: "LEDK", pin3: "LDR1", pin4: "LDR2" }} />
    <capacitor name="C2" capacitance="10nF" footprint={FILM} />
    <resistor name="R6" resistance="10k" footprint={AXIAL} />
    <resistor name="R7" resistance="22k" footprint={AXIAL} />
    <capacitor name="C6" capacitance="1uF" footprint={FILM} />
    <resistor name="R8" resistance="10k" footprint={AXIAL} />
    <resistor name="R11" resistance="10k" footprint={AXIAL} />
    <capacitor name="C7" capacitance="1uF" footprint={FILM} />
    <resistor name="R9" resistance="10k" footprint={AXIAL} />
    <diode name="D1" manufacturerPartNumber="1N4148" footprint={AXIAL} />
    <transistor name="Q1" type="npn" manufacturerPartNumber="2N3904" footprint="to92" />
    <resistor name="R10" resistance="1k" footprint={AXIAL} />
  </>,
  traces: <>
    <trace from=".C5 > .pin1" to="net.IN" />
    <trace from=".C5 > .pin2" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to="net.TANK" />
    <trace from=".L1 > .pin1" to="net.TANK" />
    <trace from=".L1 > .pin2" to=".R2 > .pin1" />
    <trace from=".R2 > .pin2" to="net.VREF" />
    <trace from=".C1 > .pin1" to="net.TANK" />
    <trace from=".C1 > .pin2" to="net.VREF" />
    <trace from=".R3 > .pin1" to="net.TANK" />
    <trace from=".R3 > .pin2" to="net.VREF" />
    <trace from={BUF.INP} to="net.TANK" />
    <trace from={BUF.INN} to="net.BUF" />
    <trace from={BUF.OUT} to="net.BUF" />
    <trace from=".R4 > .pin1" to="net.BUF" />
    <trace from=".R4 > .pin2" to={MILLER.INN} />
    <trace from=".U4 > .LDR1" to="net.MILLER" />
    <trace from=".U4 > .LDR2" to={MILLER.INN} />
    <trace from={MILLER.INP} to="net.VREF" />
    <trace from={MILLER.OUT} to="net.MILLER" />
    <trace from=".C2 > .pin1" to="net.MILLER" />
    <trace from=".C2 > .pin2" to="net.TANK" />
    <trace from=".R6 > .pin1" to="net.BUF" />
    <trace from=".R6 > .pin2" to={SUM.INN} />
    <trace from=".R7 > .pin1" to="net.TONE" />
    <trace from=".R7 > .pin2" to={SUM.INN} />
    <trace from={SUM.INP} to="net.VREF" />
    <trace from={SUM.OUT} to="net.TONE" />

    <trace from=".C6 > .pin1" to="net.BUF" />
    <trace from=".C6 > .pin2" to=".R8 > .pin1" />
    <trace from=".R8 > .pin2" to={SENS.INN} />
    <trace from={SENS.INP} to="net.VREF" />
    <trace from=".R11 > .pin1" to={SENS.INN} />
    <trace from=".R11 > .pin2" to=".RV1 > .pin1" />
    <trace from=".RV1 > .pin2" to="net.SENS" />
    <trace from=".RV1 > .pin3" to="net.SENS" />
    <trace from={SENS.OUT} to="net.SENS" />
    <trace from=".C7 > .pin1" to="net.SENS" />
    <trace from=".C7 > .pin2" to=".R9 > .pin1" />
    <trace from=".R9 > .pin2" to=".Q1 > .base" />
    <trace from=".D1 > .cathode" to=".Q1 > .base" />
    <trace from=".D1 > .anode" to="net.GND" />
    <trace from=".Q1 > .emitter" to="net.GND" />
    <trace from=".Q1 > .collector" to=".U4 > .LEDK" />
    <trace from=".U4 > .LEDA" to=".R10 > .pin1" />
    <trace from=".R10 > .pin2" to="net.V9" />
  </>,
});
