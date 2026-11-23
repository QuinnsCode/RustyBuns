// Q Out, the sound wall's output (WALL.md): where the wall leaves for the room's monitors. Each side's level pot,
// then 300k into 100k (a quarter: +-5 V modular level down to about line level, and light on the pot's wiper) into a
// buffer that drives the line
// out through 100R. In R takes In L while nothing is plugged into it (its jack's switch), so one cable plays both
// sides. Our own values; the sim works out the board's gains from its netlist.
import { Chip, SMD, wallBoard, wires } from "./wall-kit.tsx";
import { panel } from "./wall-panels.ts";

export default wallBoard({
  panel: panel("out"),
  chips: [{ name: "U1" }],
  pots: {
    left: { ohms: "100k", ends: ["GND", "IN_L"] },
    right: { ohms: "100k", ends: ["GND", "IN_R"] },
  },
  parts: <>
    <Chip name="U1" part="TL072" />
    <resistor name="R1" resistance="300k" footprint={SMD} />
    <resistor name="R2" resistance="100k" footprint={SMD} />
    <resistor name="R3" resistance="100" footprint={SMD} />
    <resistor name="R4" resistance="300k" footprint={SMD} />
    <resistor name="R5" resistance="100k" footprint={SMD} />
    <resistor name="R6" resistance="100" footprint={SMD} />
  </>,
  traces: <>{wires([
    ["R1 > .pin1", "net.LEFT_W"], ["R1 > .pin2", "net.LD"], ["R2 > .pin1", "net.LD"], ["R2 > .pin2", "net.GND"],
    ["U1 > .INPA", "net.LD"], ["U1 > .INNA", "net.OL"], ["U1 > .OUTA", "net.OL"], ["R3 > .pin1", "net.OL"], ["R3 > .pin2", "net.OUT_L"],
    ["R4 > .pin1", "net.RIGHT_W"], ["R4 > .pin2", "net.RD"], ["R5 > .pin1", "net.RD"], ["R5 > .pin2", "net.GND"],
    ["U1 > .INPB", "net.RD"], ["U1 > .INNB", "net.OR"], ["U1 > .OUTB", "net.OR"], ["R6 > .pin1", "net.OR"], ["R6 > .pin2", "net.OUT_R"],
  ])}</>,
});
