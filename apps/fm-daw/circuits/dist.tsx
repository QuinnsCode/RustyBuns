// Q Dist: op-amp gain, then two silicon diodes to ground that flatten the tops,
// then a one-pole tone. RV1 is the Drive pot (its value here is Drive 5); D1 and
// D2 sit in one socket, the clipper you can swap in the board view.
// `bun scripts/boards.ts` renders it to dist.circuit.json and its two SVGs.
export default () => (
  <board width="26mm" height="22mm">
    <chip name="U1" footprint="sot23_5" pinLabels={{ pin1: "OUT", pin2: "VNEG", pin3: "INP", pin4: "INN", pin5: "VPOS" }} />
    <capacitor name="C1" capacitance="100nF" footprint="0603" />
    <resistor name="R1" resistance="1M" footprint="0603" />
    <resistor name="R2" resistance="1k" footprint="0603" />
    <capacitor name="C2" capacitance="4.7uF" footprint="0805" />
    <resistor name="RV1" resistance="105k" footprint="0603" />
    <resistor name="R4" resistance="1k" footprint="0603" />
    <diode name="D1" footprint="sod123" />
    <diode name="D2" footprint="sod123" />
    <resistor name="R5" resistance="10k" footprint="0603" />
    <capacitor name="C3" capacitance="10nF" footprint="0603" />

    <trace from=".C1 > .pin1" to="net.IN" />
    <trace from=".C1 > .pin2" to=".U1 > .INP" />
    <trace from=".R1 > .pin1" to=".U1 > .INP" />
    <trace from=".R1 > .pin2" to="net.GND" />
    <trace from=".RV1 > .pin1" to=".U1 > .OUT" />
    <trace from=".RV1 > .pin2" to=".U1 > .INN" />
    <trace from=".R2 > .pin1" to=".U1 > .INN" />
    <trace from=".R2 > .pin2" to=".C2 > .pin1" />
    <trace from=".C2 > .pin2" to="net.GND" />
    <trace from=".R4 > .pin1" to=".U1 > .OUT" />
    <trace from=".R4 > .pin2" to=".D1 > .anode" />
    <trace from=".D1 > .cathode" to="net.GND" />
    <trace from=".D2 > .anode" to="net.GND" />
    <trace from=".D2 > .cathode" to=".R4 > .pin2" />
    <trace from=".R5 > .pin1" to=".R4 > .pin2" />
    <trace from=".R5 > .pin2" to="net.OUT" />
    <trace from=".C3 > .pin1" to="net.OUT" />
    <trace from=".C3 > .pin2" to="net.GND" />
    <trace from=".U1 > .VPOS" to="net.V_POS" />
    <trace from=".U1 > .VNEG" to="net.V_NEG" />
  </board>
);
