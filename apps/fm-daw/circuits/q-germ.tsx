// Q Germ as a real 9 V pedal board: the two-transistor germanium fuzz (germ.tsx)
// inside the box every Q pedal shares (q-box.tsx). Its PNP transistors want a
// negative supply, so the board turns them over instead: what the sim board calls
// ground is 9 V here, and its V_NEG is ground. To the signal both rails are the
// same AC ground, so it is the same circuit with a negative-ground adapter and the
// box's LED. No op-amp, so the box powers none.
//
// What the sim hears: C1, Q1, R1, Q2, R2, R3, R4, R5, C2, C3, R6, R7. RV1 is the
// Fuzz pot, a rheostat between Q2's emitter and C2: turned full up it is 0 and the
// board is the sim's. C2 is the sim's 20 µF; a 22 µF does the same. Warm is the room, not a knob: germanium leaks more as it
// warms, so the same pedal is spitty in a cold garage and smooth on a hot stage.
//
// Sockets: the cap C3. Germanium AC128s vary, so buy a few and keep the pair that
// sounds best; their legs go in TO-92 spaced holes.
import { AXIAL, ELECTROLYTIC, FILM_SOCKET, qBox } from "./q-box.tsx";

export default qBox({
  drive: { ohms: "1k", part: "Alpha 16mm 1k B" },
  opamps: [],
  parts: <>
    <capacitor name="C1" capacitance="2.2uF" polarized footprint={ELECTROLYTIC} />
    <transistor name="Q1" type="pnp" manufacturerPartNumber="AC128" footprint="to92" />
    <resistor name="R1" resistance="33k" footprint={AXIAL} />
    <transistor name="Q2" type="pnp" manufacturerPartNumber="AC128" footprint="to92" />
    <resistor name="R2" resistance="470" footprint={AXIAL} />
    <resistor name="R3" resistance="8.2k" footprint={AXIAL} />
    <resistor name="R4" resistance="100k" footprint={AXIAL} />
    <resistor name="R5" resistance="1k" footprint={AXIAL} />
    <capacitor name="C2" capacitance="20uF" polarized footprint={ELECTROLYTIC} />
    <capacitor name="C3" capacitance="10nF" footprint={FILM_SOCKET} />
    <resistor name="R6" resistance="47k" footprint={AXIAL} />
    <resistor name="R7" resistance="4.7k" footprint={AXIAL} />
  </>,
  traces: <>
    {/* Q1's base sits a little under 9 V and the input at ground, so C1's + leg goes to the base. */}
    <trace from=".C1 > .pin2" to="net.IN" />
    <trace from=".C1 > .pin1" to=".Q1 > .base" />
    <trace from=".Q1 > .emitter" to="net.V9" />
    <trace from=".Q1 > .collector" to=".Q2 > .base" />
    <trace from=".R1 > .pin1" to=".Q1 > .collector" />
    <trace from=".R1 > .pin2" to="net.GND" />
    <trace from=".Q2 > .collector" to="net.Q2_C" />
    <trace from=".R2 > .pin1" to="net.Q2_C" />
    <trace from=".R2 > .pin2" to=".R3 > .pin1" />
    <trace from=".R3 > .pin2" to="net.GND" />
    <trace from=".R4 > .pin1" to=".Q2 > .emitter" />
    <trace from=".R4 > .pin2" to=".Q1 > .base" />
    <trace from=".R5 > .pin1" to=".Q2 > .emitter" />
    <trace from=".R5 > .pin2" to="net.V9" />
    <trace from=".RV1 > .pin1" to=".Q2 > .emitter" />
    <trace from=".RV1 > .pin2" to=".C2 > .pin2" />
    <trace from=".RV1 > .pin3" to=".C2 > .pin2" />
    <trace from=".C2 > .pin1" to="net.V9" />
    <trace from=".C3 > .pin1" to="net.Q2_C" />
    <trace from=".C3 > .pin2" to=".R6 > .pin1" />
    <trace from=".R6 > .pin2" to="net.TONE" />
    <trace from=".R7 > .pin1" to="net.TONE" />
    <trace from=".R7 > .pin2" to="net.GND" />
  </>,
});
