// Q Octave: U1 is a diode-clipped fuzz (D1/D2 in its feedback, RV1 the Fuzz pot with a
// 10k stop) that squares the wave; U2 inverts its output; D3 and D4 keep whichever of
// the two is higher. Folding the negative half up doubles the pitch. C3 and R6 take
// the DC the fold leaves. U2 never clips.
const OPAMP = { pin1: "OUT", pin2: "VNEG", pin3: "INP", pin4: "INN", pin5: "VPOS" } as const;

export default () => (
  <board width="30mm" height="22mm">
    <capacitor name="C1" capacitance="100nF" footprint="0603" />
    <resistor name="R1" resistance="1M" footprint="0603" />
    <chip name="U1" footprint="sot23_5" pinLabels={OPAMP} />
    <resistor name="R2" resistance="1k" footprint="0603" />
    <capacitor name="C2" capacitance="4.7uF" footprint="0805" />
    <resistor name="RV1" resistance="82k" footprint="0603" />
    <diode name="D1" footprint="sod123" />
    <diode name="D2" footprint="sod123" />
    <resistor name="R3" resistance="10k" footprint="0603" />
    <resistor name="R4" resistance="10k" footprint="0603" />
    <chip name="U2" footprint="sot23_5" pinLabels={OPAMP} />
    <diode name="D3" footprint="sod123" />
    <diode name="D4" footprint="sod123" />
    <resistor name="R5" resistance="10k" footprint="0603" />
    <capacitor name="C3" capacitance="1uF" footprint="0805" />
    <resistor name="R6" resistance="100k" footprint="0603" />

    <trace from=".C1 > .pin1" to="net.IN" />
    <trace from=".C1 > .pin2" to=".U1 > .INP" />
    <trace from=".R1 > .pin1" to=".U1 > .INP" />
    <trace from=".R1 > .pin2" to="net.GND" />
    <trace from=".R2 > .pin1" to=".U1 > .INN" />
    <trace from=".R2 > .pin2" to=".C2 > .pin1" />
    <trace from=".C2 > .pin2" to="net.GND" />
    <trace from=".U1 > .OUT" to="net.FUZZ" />
    <trace from=".RV1 > .pin1" to="net.FUZZ" />
    <trace from=".RV1 > .pin2" to=".U1 > .INN" />
    <trace from=".D1 > .anode" to="net.FUZZ" />
    <trace from=".D1 > .cathode" to=".U1 > .INN" />
    <trace from=".D2 > .anode" to=".U1 > .INN" />
    <trace from=".D2 > .cathode" to="net.FUZZ" />
    <trace from=".R3 > .pin1" to="net.FUZZ" />
    <trace from=".R3 > .pin2" to=".U2 > .INN" />
    <trace from=".R4 > .pin1" to="net.MIRROR" />
    <trace from=".R4 > .pin2" to=".U2 > .INN" />
    <trace from=".U2 > .INP" to="net.GND" />
    <trace from=".U2 > .OUT" to="net.MIRROR" />
    <trace from=".D3 > .anode" to="net.FUZZ" />
    <trace from=".D3 > .cathode" to="net.FOLD" />
    <trace from=".D4 > .anode" to="net.MIRROR" />
    <trace from=".D4 > .cathode" to="net.FOLD" />
    <trace from=".R5 > .pin1" to="net.FOLD" />
    <trace from=".R5 > .pin2" to="net.GND" />
    <trace from=".C3 > .pin1" to="net.FOLD" />
    <trace from=".C3 > .pin2" to="net.OUT" />
    <trace from=".R6 > .pin1" to="net.OUT" />
    <trace from=".R6 > .pin2" to="net.GND" />
    <trace from=".U1 > .VPOS" to="net.V_POS" />
    <trace from=".U1 > .VNEG" to="net.V_NEG" />
  </board>
);
