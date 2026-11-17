// Q Tape's record amp: an op-amp at x4 (RF over RG) on ±4 V rails, CF across the
// feedback to keep it from ringing. The echoes feed back through it, so a runaway
// flattens on the rails instead of growing forever. Its output drives the record
// head, off the board (packages/gear machines.ts `TapeEcho`).
export default () => (
  <board width="22mm" height="18mm">
    <chip name="U1" footprint="sot23_5" pinLabels={{ pin1: "OUT", pin2: "VNEG", pin3: "INP", pin4: "INN", pin5: "VPOS" }} />
    <capacitor name="C1" capacitance="1uF" footprint="0805" />
    <resistor name="R1" resistance="100k" footprint="0603" />
    <resistor name="RF" resistance="30k" footprint="0603" />
    <resistor name="RG" resistance="10k" footprint="0603" />
    <capacitor name="CF" capacitance="100pF" footprint="0603" />

    <trace from=".C1 > .pin1" to="net.IN" />
    <trace from=".C1 > .pin2" to=".U1 > .INP" />
    <trace from=".R1 > .pin1" to=".U1 > .INP" />
    <trace from=".R1 > .pin2" to="net.GND" />
    <trace from=".RF > .pin1" to=".U1 > .OUT" />
    <trace from=".RF > .pin2" to=".U1 > .INN" />
    <trace from=".RG > .pin1" to=".U1 > .INN" />
    <trace from=".RG > .pin2" to="net.GND" />
    <trace from=".CF > .pin1" to=".U1 > .OUT" />
    <trace from=".CF > .pin2" to=".U1 > .INN" />
    <trace from=".U1 > .OUT" to="net.OUT" />
    <trace from=".U1 > .VPOS" to="net.V_POS" />
    <trace from=".U1 > .VNEG" to="net.V_NEG" />
  </board>
);
