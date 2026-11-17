// Q Envelope: Q Wah with its treadle (R5 and RV1) replaced by a vactrol (U4): an
// envelope follower off this board lights its LED from FOOT as you play harder, the
// LDR drops, U2's gain falls and the peak climbs toward the toe; the LDR's slow
// recovery lets it fall back to the heel. Read with `moved` (U4 on control "foot",
// 220k to 100). The op-amps never clip.
const OPAMP = { pin1: "OUT", pin2: "VNEG", pin3: "INP", pin4: "INN", pin5: "VPOS" } as const;

export default () => (
  <board width="32mm" height="24mm">
    <resistor name="R1" resistance="15k" footprint="0603" />
    <inductor name="L1" inductance={0.5} footprint="1210" />
    <resistor name="R2" resistance="60" footprint="0603" />
    <capacitor name="C1" capacitance="4.7nF" footprint="0603" />
    <resistor name="R3" resistance="68k" footprint="0603" />
    <chip name="U1" footprint="sot23_5" pinLabels={OPAMP} />
    <resistor name="R4" resistance="10k" footprint="0603" />
    <chip name="U4" footprint="dip4" pinLabels={{ pin1: "LEDA", pin2: "LEDK", pin3: "LDR1", pin4: "LDR2" }} />
    <chip name="U2" footprint="sot23_5" pinLabels={OPAMP} />
    <capacitor name="C2" capacitance="10nF" footprint="0603" />
    <resistor name="R6" resistance="10k" footprint="0603" />
    <resistor name="R7" resistance="22k" footprint="0603" />
    <chip name="U3" footprint="sot23_5" pinLabels={OPAMP} />

    <trace from=".R1 > .pin1" to="net.IN" />
    <trace from=".R1 > .pin2" to="net.TANK" />
    <trace from=".L1 > .pin1" to="net.TANK" />
    <trace from=".L1 > .pin2" to=".R2 > .pin1" />
    <trace from=".R2 > .pin2" to="net.GND" />
    <trace from=".C1 > .pin1" to="net.TANK" />
    <trace from=".C1 > .pin2" to="net.GND" />
    <trace from=".R3 > .pin1" to="net.TANK" />
    <trace from=".R3 > .pin2" to="net.GND" />
    <trace from=".U1 > .INP" to="net.TANK" />
    <trace from=".U1 > .INN" to="net.BUF" />
    <trace from=".U1 > .OUT" to="net.BUF" />
    <trace from=".R4 > .pin1" to="net.BUF" />
    <trace from=".R4 > .pin2" to=".U2 > .INN" />
    <trace from=".U4 > .LDR1" to="net.MILLER" />
    <trace from=".U4 > .LDR2" to=".U2 > .INN" />
    <trace from=".U4 > .LEDA" to="net.FOOT" />
    <trace from=".U4 > .LEDK" to="net.GND" />
    <trace from=".U2 > .INP" to="net.GND" />
    <trace from=".U2 > .OUT" to="net.MILLER" />
    <trace from=".C2 > .pin1" to="net.MILLER" />
    <trace from=".C2 > .pin2" to="net.TANK" />
    <trace from=".R6 > .pin1" to="net.BUF" />
    <trace from=".R6 > .pin2" to=".U3 > .INN" />
    <trace from=".R7 > .pin1" to="net.OUT" />
    <trace from=".R7 > .pin2" to=".U3 > .INN" />
    <trace from=".U3 > .INP" to="net.GND" />
    <trace from=".U3 > .OUT" to="net.OUT" />
  </board>
);
