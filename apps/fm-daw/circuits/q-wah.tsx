// Q Wah as a real 9 V pedal board: the wah (wah.tsx) inside the box every Q pedal
// shares (q-box.tsx). L1 and C1 ring on TANK; U1B's gain is the treadle, and C2 from
// its output back onto the tank looks (1 + gain) times bigger and pulls the peak
// down. One TL074 holds the sim's three op-amps: A is U1 (the tank's buffer), B is
// U2 (the Miller stage), C is U3 (the sum out), and D is left as a follower on the bias.
//
// What the sim hears: R1, L1, R2, C1, R3, U1 (A), R4, R5, RV1, U2 (B), C2, R6, R7, U3 (C).
// R2 is the 60 Ω the sim gives L1's winding: fit a 62 Ω, or a wire link if your
// inductor's own winding already reads about 60 Ω. C5 brings the guitar to the 4.5 V
// bias, and on 9 V the tank and the op-amps' + inputs sit at the bias (VREF) instead
// of ground; to the signal the two are the same node.
//
// RV1, the treadle, is the box's first knob: a rocker needs a pot on a rack gear
// instead (a 220k wah pot wired the same, two legs), which is how a real wah has it.
//
// Sockets: the op-amp U1.
import { AXIAL, FILM, QUAD, amp, qBox } from "./q-box.tsx";

const BUF = amp("U1", "A"), MILLER = amp("U1", "B"), SUM = amp("U1", "C"), SPARE = amp("U1", "D");

export default qBox({
  drive: { ohms: "220k", part: "Alpha 16mm 220k A" },
  parts: <>
    <capacitor name="C5" capacitance="1uF" footprint={FILM} />
    <resistor name="R1" resistance="15k" footprint={AXIAL} />
    <inductor name="L1" inductance={0.5} manufacturerPartNumber="500mH wah inductor" footprint="pinrow2_p5mm_id1.1mm_od2mm" />
    <capacitor name="C1" capacitance="4.7nF" footprint={FILM} />
    <resistor name="R2" resistance="60" footprint={AXIAL} />
    <resistor name="R3" resistance="68k" footprint={AXIAL} />
    <chip name="U1" manufacturerPartNumber="TL074" footprint="dip14" pinLabels={QUAD} />
    <resistor name="R4" resistance="10k" footprint={AXIAL} />
    <resistor name="R5" resistance="100" footprint={AXIAL} />
    <capacitor name="C2" capacitance="10nF" footprint={FILM} />
    <resistor name="R6" resistance="10k" footprint={AXIAL} />
    <resistor name="R7" resistance="22k" footprint={AXIAL} />
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
    <trace from=".RV1 > .pin1" to={MILLER.INN} />
    <trace from=".RV1 > .pin2" to=".R5 > .pin2" />
    <trace from=".RV1 > .pin3" to=".R5 > .pin2" />
    <trace from=".R5 > .pin1" to="net.MILLER" />
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
    <trace from={SPARE.INP} to="net.VREF" />
    <trace from={SPARE.INN} to={SPARE.OUT} />
  </>,
});
