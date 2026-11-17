// Q Germ, a two-transistor germanium fuzz: PNP transistors (Q1, Q2) on a -9 V supply
// (V_NEG), Q2's emitter feeding Q1's base through R4 for bias. Germanium leaks, and
// the leak doubles every 10 °C, so the room's warmth moves the bias (read with
// `germanium` and `bjt`, the constants at a temperature): gated and spitty cold,
// smooth, then mushy hot. R7 is the volume pot, a tenth up.
export default () => (
  <board width="26mm" height="20mm">
    <capacitor name="C1" capacitance="2.2uF" footprint="0805" />
    <transistor name="Q1" type="pnp" footprint="sot23" />
    <resistor name="R1" resistance="33k" footprint="0603" />
    <transistor name="Q2" type="pnp" footprint="sot23" />
    <resistor name="R2" resistance="470" footprint="0603" />
    <resistor name="R3" resistance="8.2k" footprint="0603" />
    <resistor name="R4" resistance="100k" footprint="0603" />
    <resistor name="R5" resistance="1k" footprint="0603" />
    <capacitor name="C2" capacitance="20uF" footprint="1206" />
    <capacitor name="C3" capacitance="10nF" footprint="0603" />
    <resistor name="R6" resistance="47k" footprint="0603" />
    <resistor name="R7" resistance="4.7k" footprint="0603" />

    <trace from=".C1 > .pin1" to="net.IN" />
    <trace from=".C1 > .pin2" to=".Q1 > .base" />
    <trace from=".Q1 > .emitter" to="net.GND" />
    <trace from=".Q1 > .collector" to=".Q2 > .base" />
    <trace from=".R1 > .pin1" to=".Q1 > .collector" />
    <trace from=".R1 > .pin2" to="net.V_NEG" />
    <trace from=".Q2 > .collector" to="net.Q2_C" />
    <trace from=".R2 > .pin1" to="net.Q2_C" />
    <trace from=".R2 > .pin2" to=".R3 > .pin1" />
    <trace from=".R3 > .pin2" to="net.V_NEG" />
    <trace from=".R4 > .pin1" to=".Q2 > .emitter" />
    <trace from=".R4 > .pin2" to=".Q1 > .base" />
    <trace from=".R5 > .pin1" to=".Q2 > .emitter" />
    <trace from=".R5 > .pin2" to="net.GND" />
    <trace from=".C2 > .pin1" to=".Q2 > .emitter" />
    <trace from=".C2 > .pin2" to="net.GND" />
    <trace from=".C3 > .pin1" to="net.Q2_C" />
    <trace from=".C3 > .pin2" to=".R6 > .pin1" />
    <trace from=".R6 > .pin2" to="net.OUT" />
    <trace from=".R7 > .pin1" to="net.OUT" />
    <trace from=".R7 > .pin2" to="net.GND" />
  </board>
);
