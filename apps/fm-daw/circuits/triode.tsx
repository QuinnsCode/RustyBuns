// One 12AX7 gain stage, the board every amp's preamp is built from: coupling cap
// C1 and grid leak R1, grid stopper R2, the tube V1 (wired off-board to its
// socket), cathode resistor RK and bypass cap CK, plate load RP from B+. The
// values here are a hot first stage; each amp sets its own RK, CK, C1 and RP.
export default () => (
  <board width="22mm" height="18mm">
    <chip name="V1" footprint="pinrow3" pinLabels={{ pin1: "PLATE", pin2: "GRID", pin3: "CATHODE" }} />
    <capacitor name="C1" capacitance="22nF" footprint="0805" />
    <resistor name="R1" resistance="1M" footprint="0805" />
    <resistor name="R2" resistance="68k" footprint="0805" />
    <resistor name="RK" resistance="1.5k" footprint="0805" />
    <capacitor name="CK" capacitance="0.68uF" footprint="0805" />
    <resistor name="RP" resistance="100k" footprint="1206" />

    <trace from=".C1 > .pin1" to="net.IN" />
    <trace from=".C1 > .pin2" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to="net.GND" />
    <trace from=".R2 > .pin1" to=".C1 > .pin2" />
    <trace from=".R2 > .pin2" to=".V1 > .GRID" />
    <trace from=".RK > .pin1" to=".V1 > .CATHODE" />
    <trace from=".RK > .pin2" to="net.GND" />
    <trace from=".CK > .pin1" to=".V1 > .CATHODE" />
    <trace from=".CK > .pin2" to="net.GND" />
    <trace from=".RP > .pin1" to="net.B_PLUS" />
    <trace from=".RP > .pin2" to=".V1 > .PLATE" />
    <trace from=".V1 > .PLATE" to="net.OUT" />
  </board>
);
