// Q Drive: the diodes sit in the op-amp's feedback, so they round the wave off
// instead of cutting it, and the R2/C2 leg only gives gain above ~720 Hz, so the
// lows stay clean and the mids push. RV1 is the Drive pot (Drive 5 here); D1/D2
// are the clipper socket.
export default () => (
  <board width="26mm" height="22mm">
    <chip name="U1" footprint="sot23_5" pinLabels={{ pin1: "OUT", pin2: "VNEG", pin3: "INP", pin4: "INN", pin5: "VPOS" }} />
    <capacitor name="C1" capacitance="1uF" footprint="0805" />
    <resistor name="R1" resistance="510k" footprint="0603" />
    <resistor name="R2" resistance="4.7k" footprint="0603" />
    <capacitor name="C2" capacitance="47nF" footprint="0603" />
    <resistor name="RV1" resistance="301k" footprint="0603" />
    <capacitor name="C3" capacitance="51pF" footprint="0603" />
    <diode name="D1" footprint="sod123" />
    <diode name="D2" footprint="sod123" />
    <resistor name="R3" resistance="1k" footprint="0603" />
    <capacitor name="C4" capacitance="220nF" footprint="0603" />

    <trace from=".C1 > .pin1" to="net.IN" />
    <trace from=".C1 > .pin2" to=".U1 > .INP" />
    <trace from=".R1 > .pin1" to=".U1 > .INP" />
    <trace from=".R1 > .pin2" to="net.GND" />
    <trace from=".R2 > .pin1" to=".U1 > .INN" />
    <trace from=".R2 > .pin2" to=".C2 > .pin1" />
    <trace from=".C2 > .pin2" to="net.GND" />
    <trace from=".RV1 > .pin1" to=".U1 > .OUT" />
    <trace from=".RV1 > .pin2" to=".U1 > .INN" />
    <trace from=".C3 > .pin1" to=".U1 > .OUT" />
    <trace from=".C3 > .pin2" to=".U1 > .INN" />
    <trace from=".D1 > .anode" to=".U1 > .OUT" />
    <trace from=".D1 > .cathode" to=".U1 > .INN" />
    <trace from=".D2 > .anode" to=".U1 > .INN" />
    <trace from=".D2 > .cathode" to=".U1 > .OUT" />
    <trace from=".R3 > .pin1" to=".U1 > .OUT" />
    <trace from=".R3 > .pin2" to="net.OUT" />
    <trace from=".C4 > .pin1" to="net.OUT" />
    <trace from=".C4 > .pin2" to="net.GND" />
    <trace from=".U1 > .VPOS" to="net.V_POS" />
    <trace from=".U1 > .VNEG" to="net.V_NEG" />
  </board>
);
