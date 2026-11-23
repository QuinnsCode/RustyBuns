// Q Wobble, the sound wall's LFO (WALL.md): the textbook triangle and square pair. U1A integrates the square into a
// triangle; U1B is a Schmitt trigger that flips the square each time the triangle reaches R2/R3 of the rail
// (+-5.2 V). So f = R3 / (4 x R2 x R x C1), R being R1 plus Rate (a reverse-audio pot, so the turn feels even):
// half a hertz up to 53 Hz. The square comes out halved to +-5.5 V. Our own values; the sim reads the rate and the
// levels off these parts.
import { Chip, SMD, wallBoard, wires } from "./wall-kit.tsx";
import { panel } from "./wall-panels.ts";

export default wallBoard({
  panel: panel("lfo"),
  chips: [{ name: "U1" }],
  pots: { rate: { ohms: "1M", ends: ["W", "RA"], wiper: "INTN" } },
  parts: <>
    <Chip name="U1" part="TL072" />
    <resistor name="R1" resistance="10k" footprint={SMD} />
    <capacitor name="C1" capacitance="1uF" footprint="1206" manufacturerPartNumber="X7R 25 V" />
    <resistor name="R2" resistance="4.7k" footprint={SMD} />
    <resistor name="R3" resistance="10k" footprint={SMD} />
    <resistor name="R4" resistance="1k" footprint={SMD} />
    <resistor name="R5" resistance="1k" footprint={SMD} />
    <resistor name="R6" resistance="1k" footprint={SMD} />
  </>,
  traces: <>{wires([
    ["R1 > .pin1", "net.SQR_I"], ["R1 > .pin2", "net.RA"],
    ["U1 > .INNA", "net.INTN"], ["U1 > .INPA", "net.GND"], ["U1 > .OUTA", "net.TRI_I"],
    ["C1 > .pin1", "net.TRI_I"], ["C1 > .pin2", "net.INTN"],
    ["R2 > .pin1", "net.TRI_I"], ["R2 > .pin2", "net.SP"], ["R3 > .pin1", "net.SQR_I"], ["R3 > .pin2", "net.SP"],
    ["U1 > .INPB", "net.SP"], ["U1 > .INNB", "net.GND"], ["U1 > .OUTB", "net.SQR_I"],
    ["R4 > .pin1", "net.TRI_I"], ["R4 > .pin2", "net.TRI"],
    ["R5 > .pin1", "net.SQR_I"], ["R5 > .pin2", "net.SQR"], ["R6 > .pin1", "net.SQR"], ["R6 > .pin2", "net.GND"],
  ])}</>,
});
