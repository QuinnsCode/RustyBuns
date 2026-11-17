// Q Trem: R1 in series and an LDR to ground make a divider; the vactrol's LED (U2,
// lit from LED by an LFO off this board) darkens and lightens the LDR, so the level
// dips and swells. The LDR recovers slowly, so each dip has a soft back. U1 buffers
// the divider and never clips. Read with `moved` (U2 on control "led", 1M to 600).
export default () => (
  <board width="20mm" height="16mm">
    <resistor name="R1" resistance="4.7k" footprint="0603" />
    <chip name="U2" footprint="dip4" pinLabels={{ pin1: "LEDA", pin2: "LEDK", pin3: "LDR1", pin4: "LDR2" }} />
    <chip name="U1" footprint="sot23_5" pinLabels={{ pin1: "OUT", pin2: "VNEG", pin3: "INP", pin4: "INN", pin5: "VPOS" }} />

    <trace from=".R1 > .pin1" to="net.IN" />
    <trace from=".R1 > .pin2" to=".U1 > .INP" />
    <trace from=".U2 > .LDR1" to=".U1 > .INP" />
    <trace from=".U2 > .LDR2" to="net.GND" />
    <trace from=".U2 > .LEDA" to="net.LED" />
    <trace from=".U2 > .LEDK" to="net.GND" />
    <trace from=".U1 > .INN" to="net.OUT" />
    <trace from=".U1 > .OUT" to="net.OUT" />
  </board>
);
