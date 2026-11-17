// The passive bass/mid/treble network most guitar amps share. Each pot is drawn
// as its two halves: RT1/RT2 the treble pot (wiper at OUT), RB the bass pot,
// RM the mid pot, all at noon here; the knobs set them. R2 is the next stage's
// grid leak.
export default () => (
  <board width="22mm" height="18mm">
    <capacitor name="C1" capacitance="470pF" footprint="0805" />
    <resistor name="RT1" resistance="110k" footprint="0805" />
    <resistor name="RT2" resistance="110k" footprint="0805" />
    <resistor name="R1" resistance="33k" footprint="0805" />
    <capacitor name="C2" capacitance="22nF" footprint="0805" />
    <capacitor name="C3" capacitance="22nF" footprint="0805" />
    <resistor name="RB" resistance="250k" footprint="0805" />
    <resistor name="RM" resistance="6.25k" footprint="0805" />
    <resistor name="R2" resistance="1M" footprint="0805" />

    <trace from=".C1 > .pin1" to="net.IN" />
    <trace from=".C1 > .pin2" to=".RT1 > .pin1" />
    <trace from=".RT1 > .pin2" to="net.OUT" />
    <trace from=".RT2 > .pin1" to="net.OUT" />
    <trace from=".RT2 > .pin2" to=".C2 > .pin2" />
    <trace from=".R1 > .pin1" to="net.IN" />
    <trace from=".R1 > .pin2" to=".C2 > .pin1" />
    <trace from=".C3 > .pin1" to=".C2 > .pin1" />
    <trace from=".RB > .pin1" to=".C2 > .pin2" />
    <trace from=".RB > .pin2" to=".C3 > .pin2" />
    <trace from=".RM > .pin1" to=".C3 > .pin2" />
    <trace from=".RM > .pin2" to="net.GND" />
    <trace from=".R2 > .pin1" to="net.OUT" />
    <trace from=".R2 > .pin2" to="net.GND" />
  </board>
);
