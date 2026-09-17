// What "New project" writes. Mirrors fixtures/small-board.json's source.
export const STARTER_CIRCUIT = `// A small board to start from. Edit and save: the preview re-renders.
export default () => (
  <board width="30mm" height="20mm">
    <chip name="U1" footprint="soic8" pcbX={-6} pinLabels={{ pin1: "VCC", pin8: "GND" }} />
    <resistor name="R1" resistance="10k" footprint="0603" pcbX={5} pcbY={4} />
    <resistor name="R2" resistance="1k" footprint="0603" pcbX={5} pcbY={-4} />
    <capacitor name="C1" capacitance="100nF" footprint="0603" pcbX={10} />
    <led name="D1" color="red" footprint="0603" pcbX={0} pcbY={-7} />
    <trace from=".U1 > .pin1" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to=".C1 > .pin1" />
    <trace from=".U1 > .pin8" to=".R2 > .pin1" />
    <trace from=".R2 > .pin2" to=".D1 > .pin1" />
    <trace from=".C1 > .pin2" to="net.GND" />
    <trace from=".D1 > .pin2" to="net.GND" />
  </board>
)
`;
