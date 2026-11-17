// Q Fuzz: an op-amp at up to ×2000, its feedback diodes (D1/D2) rounding the wave
// off, then two diodes to ground (D3/D4) squaring what's left. R1, the 1M input
// resistor, hisses, and the hiss gets the same gain and clipping as the guitar.
// RV1 is the Drive pot (Drive 7 here). Two clipper sockets.
export default () => (
  <board width="28mm" height="24mm">
    <chip name="U1" footprint="sot23_5" pinLabels={{ pin1: "OUT", pin2: "VNEG", pin3: "INP", pin4: "INN", pin5: "VPOS" }} />
    <capacitor name="C1" capacitance="100nF" footprint="0603" />
    <resistor name="R1" resistance="1M" footprint="0603" />
    <resistor name="R2" resistance="1k" footprint="0603" />
    <capacitor name="C2" capacitance="10uF" footprint="0805" />
    <resistor name="RV1" resistance="1000k" footprint="0603" />
    <capacitor name="C3" capacitance="22pF" footprint="0603" />
    <diode name="D1" footprint="sod123" />
    <diode name="D2" footprint="sod123" />
    <resistor name="R3" resistance="2.2k" footprint="0603" />
    <diode name="D3" footprint="sod123" />
    <diode name="D4" footprint="sod123" />
    <resistor name="R4" resistance="4.7k" footprint="0603" />
    <capacitor name="C4" capacitance="15nF" footprint="0603" />

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
    <trace from=".R3 > .pin2" to=".D3 > .anode" />
    <trace from=".D3 > .cathode" to="net.GND" />
    <trace from=".D4 > .anode" to="net.GND" />
    <trace from=".D4 > .cathode" to=".R3 > .pin2" />
    <trace from=".R4 > .pin1" to=".R3 > .pin2" />
    <trace from=".R4 > .pin2" to="net.OUT" />
    <trace from=".C4 > .pin1" to="net.OUT" />
    <trace from=".C4 > .pin2" to="net.GND" />
    <trace from=".U1 > .VPOS" to="net.V_POS" />
    <trace from=".U1 > .VNEG" to="net.V_NEG" />
  </board>
);
