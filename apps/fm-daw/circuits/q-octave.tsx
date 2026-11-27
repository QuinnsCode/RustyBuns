// Q Octave as a real 9 V pedal board: the octave-up board (octave.tsx) inside the
// box every Q pedal shares (q-box.tsx). U1A is the diode-clipped fuzz that squares
// the wave, U1B inverts it, and D3 and D4 keep whichever is higher: the fold that
// doubles the pitch. One TL072 holds both op-amps.
//
// What the sim hears: C1, R1, U1 (A), R2, C2, R7 + RV1 (the sim board's Fuzz
// resistor: a 10k stop plus a 100k pot), D1, D2, R3, R4, U2 (B), D3, D4, R5, C3, R6.
// On 9 V the op-amps sit at the 4.5 V bias, so R1, U1B's + input and the fold's R5
// go to the bias (VREF) instead of ground; to the signal the two are the same node.
//
// Sockets: the clipping diodes D1 and D2, the fold's D3 and D4, and the op-amp U1.
import { AXIAL, DUAL, ELECTROLYTIC, FILM, SOCKET, amp, qBox } from "./q-box.tsx";

const FUZZ = amp("U1", "A"), MIRROR = amp("U1", "B");

export default qBox({
  drive: { ohms: "100k", part: "Alpha 16mm 100k B" },
  parts: <>
    <capacitor name="C1" capacitance="100nF" footprint={FILM} />
    <resistor name="R1" resistance="1M" footprint={AXIAL} />
    <chip name="U1" manufacturerPartNumber="TL072" footprint="dip8" pinLabels={DUAL} />
    <resistor name="R2" resistance="1k" footprint={AXIAL} />
    <capacitor name="C2" capacitance="4.7uF" polarized footprint={ELECTROLYTIC} />
    <resistor name="R7" resistance="10k" footprint={AXIAL} />
    <diode name="D1" footprint={SOCKET} />
    <diode name="D2" footprint={SOCKET} />
    <resistor name="R3" resistance="10k" footprint={AXIAL} />
    <resistor name="R4" resistance="10k" footprint={AXIAL} />
    <diode name="D3" footprint={SOCKET} />
    <diode name="D4" footprint={SOCKET} />
    <resistor name="R5" resistance="10k" footprint={AXIAL} />
    <capacitor name="C3" capacitance="1uF" footprint={FILM} />
    <resistor name="R6" resistance="100k" footprint={AXIAL} />
  </>,
  traces: <>
    <trace from=".C1 > .pin1" to="net.IN" />
    <trace from=".C1 > .pin2" to={FUZZ.INP} />
    <trace from=".R1 > .pin1" to={FUZZ.INP} />
    <trace from=".R1 > .pin2" to="net.VREF" />
    <trace from=".R2 > .pin1" to={FUZZ.INN} />
    <trace from=".R2 > .pin2" to=".C2 > .pin1" />
    <trace from=".C2 > .pin2" to="net.GND" />
    <trace from={FUZZ.OUT} to="net.FUZZ" />
    <trace from=".R7 > .pin1" to="net.FUZZ" />
    <trace from=".R7 > .pin2" to=".RV1 > .pin1" />
    <trace from=".RV1 > .pin2" to={FUZZ.INN} />
    <trace from=".RV1 > .pin3" to={FUZZ.INN} />
    <trace from=".D1 > .anode" to="net.FUZZ" />
    <trace from=".D1 > .cathode" to={FUZZ.INN} />
    <trace from=".D2 > .anode" to={FUZZ.INN} />
    <trace from=".D2 > .cathode" to="net.FUZZ" />
    <trace from=".R3 > .pin1" to="net.FUZZ" />
    <trace from=".R3 > .pin2" to={MIRROR.INN} />
    <trace from=".R4 > .pin1" to="net.MIRROR" />
    <trace from=".R4 > .pin2" to={MIRROR.INN} />
    <trace from={MIRROR.INP} to="net.VREF" />
    <trace from={MIRROR.OUT} to="net.MIRROR" />
    <trace from=".D3 > .anode" to="net.FUZZ" />
    <trace from=".D3 > .cathode" to="net.FOLD" />
    <trace from=".D4 > .anode" to="net.MIRROR" />
    <trace from=".D4 > .cathode" to="net.FOLD" />
    <trace from=".R5 > .pin1" to="net.FOLD" />
    <trace from=".R5 > .pin2" to="net.VREF" />
    <trace from=".C3 > .pin1" to="net.FOLD" />
    <trace from=".C3 > .pin2" to="net.TONE" />
    <trace from=".R6 > .pin1" to="net.TONE" />
    <trace from=".R6 > .pin2" to="net.GND" />
  </>,
});
