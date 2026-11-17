// Q Squeeze, an optical compressor: R1 in series and the vactrol's LDR (U2) to ground
// ahead of an op-amp gain stage (U1). The stage's output, through an envelope
// follower off this board, lights the vactrol's LED from LED and darkens the LDR:
// the louder it gets, the more it is turned down, and the LDR's slow recovery is the
// smooth release. RV1 is the Sustain pot with a 10k stop (the stage's gain); R2 and C3
// set the gain's floor. Read with `moved` (U2 on control "led", 2M to 300).
export default () => (
  <board width="24mm" height="18mm">
    <capacitor name="C1" capacitance="1uF" footprint="0805" />
    <resistor name="R1" resistance="10k" footprint="0603" />
    <chip name="U2" footprint="dip4" pinLabels={{ pin1: "LEDA", pin2: "LEDK", pin3: "LDR1", pin4: "LDR2" }} />
    <chip name="U1" footprint="sot23_5" pinLabels={{ pin1: "OUT", pin2: "VNEG", pin3: "INP", pin4: "INN", pin5: "VPOS" }} />
    <resistor name="RV1" resistance="85k" footprint="0603" />
    <resistor name="R2" resistance="4.7k" footprint="0603" />
    <capacitor name="C3" capacitance="4.7uF" footprint="0805" />

    <trace from=".C1 > .pin1" to="net.IN" />
    <trace from=".C1 > .pin2" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to=".U1 > .INP" />
    <trace from=".U2 > .LDR1" to=".U1 > .INP" />
    <trace from=".U2 > .LDR2" to="net.GND" />
    <trace from=".U2 > .LEDA" to="net.LED" />
    <trace from=".U2 > .LEDK" to="net.GND" />
    <trace from=".U1 > .OUT" to="net.OUT" />
    <trace from=".RV1 > .pin1" to="net.OUT" />
    <trace from=".RV1 > .pin2" to=".U1 > .INN" />
    <trace from=".R2 > .pin1" to=".U1 > .INN" />
    <trace from=".R2 > .pin2" to=".C3 > .pin1" />
    <trace from=".C3 > .pin2" to="net.GND" />
    <trace from=".U1 > .VPOS" to="net.V_POS" />
    <trace from=".U1 > .VNEG" to="net.V_NEG" />
  </board>
);
