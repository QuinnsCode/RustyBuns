// Q Spring's two tubes: the driver V1, a 12AT7 (lower gain, more current than a
// 12AX7) with a bypassed cathode, its plate into the tank transformer's primary
// (22k to B+, its impedance at mid frequencies), and the recovery V2, a 12AX7
// lifting the tank's millivolts back to line level. The transformer and the
// springs are off the board, between DRIVE and TANK (packages/gear machines.ts).
// The app reads it twice, one stage at a time (`springDriver`, `springRecovery`).
export default () => (
  <board width="40mm" height="18mm">
    <chip name="V1" footprint="pinrow3" pinLabels={{ pin1: "PLATE", pin2: "GRID", pin3: "CATHODE" }} />
    <capacitor name="C1" capacitance="47nF" footprint="0805" />
    <resistor name="R1" resistance="1M" footprint="0805" />
    <resistor name="R2" resistance="10k" footprint="0805" />
    <resistor name="RK1" resistance="2.2k" footprint="0805" />
    <capacitor name="CK1" capacitance="25uF" footprint="1206" />
    <resistor name="RP1" resistance="22k" footprint="1206" />

    <chip name="V2" footprint="pinrow3" pinLabels={{ pin1: "PLATE", pin2: "GRID", pin3: "CATHODE" }} />
    <capacitor name="C2" capacitance="4.7nF" footprint="0805" />
    <resistor name="R3" resistance="1M" footprint="0805" />
    <resistor name="R4" resistance="68k" footprint="0805" />
    <resistor name="RK2" resistance="1.5k" footprint="0805" />
    <capacitor name="CK2" capacitance="25uF" footprint="1206" />
    <resistor name="RP2" resistance="100k" footprint="1206" />

    <trace from=".C1 > .pin1" to="net.IN" />
    <trace from=".C1 > .pin2" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to="net.GND" />
    <trace from=".R2 > .pin1" to=".C1 > .pin2" />
    <trace from=".R2 > .pin2" to=".V1 > .GRID" />
    <trace from=".RK1 > .pin1" to=".V1 > .CATHODE" />
    <trace from=".RK1 > .pin2" to="net.GND" />
    <trace from=".CK1 > .pin1" to=".V1 > .CATHODE" />
    <trace from=".CK1 > .pin2" to="net.GND" />
    <trace from=".RP1 > .pin1" to="net.B_DRIVE" />
    <trace from=".RP1 > .pin2" to=".V1 > .PLATE" />
    <trace from=".V1 > .PLATE" to="net.DRIVE" />

    <trace from=".C2 > .pin1" to="net.TANK" />
    <trace from=".C2 > .pin2" to=".R3 > .pin1" />
    <trace from=".R3 > .pin2" to="net.GND" />
    <trace from=".R4 > .pin1" to=".C2 > .pin2" />
    <trace from=".R4 > .pin2" to=".V2 > .GRID" />
    <trace from=".RK2 > .pin1" to=".V2 > .CATHODE" />
    <trace from=".RK2 > .pin2" to="net.GND" />
    <trace from=".CK2 > .pin1" to=".V2 > .CATHODE" />
    <trace from=".CK2 > .pin2" to="net.GND" />
    <trace from=".RP2 > .pin1" to="net.B_PLUS" />
    <trace from=".RP2 > .pin2" to=".V2 > .PLATE" />
    <trace from=".V2 > .PLATE" to="net.OUT" />
  </board>
);
