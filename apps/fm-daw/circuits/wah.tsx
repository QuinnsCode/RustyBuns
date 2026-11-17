// Q Wah: L1 (0.5 H, its wire R2) and C1 ring at a peak on TANK, fed through R1. U1
// buffers the tank; U2 is an inverting stage whose gain is the treadle (R5 and RV1,
// a 220k rheostat under the foot), and C2 hangs from its output back onto the tank,
// so it looks (1 + gain) times bigger (Miller) and pulls the peak down: heel ~550 Hz,
// toe ~1.8 kHz. U3 sums the buffered tank out. The op-amps never clip. Turning RV1
// is a pot turn (`knobs`), so an expression pedal rocks it without a rebuild.
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
    <resistor name="R5" resistance="100" footprint="0603" />
    <potentiometer name="RV1" maxResistance="220k" footprint="pinrow2" />
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
    <trace from=".RV1 > .pin1" to=".U2 > .INN" />
    <trace from=".RV1 > .pin2" to=".R5 > .pin2" />
    <trace from=".R5 > .pin1" to="net.MILLER" />
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
