// Q Bus, the sound wall's mixer (WALL.md): four channels into a main bus and two aux buses, the way a desk does it.
// Each channel's Level pot feeds a buffer (U1); the buffered, post-fader channel goes into the main bus and, through
// its own A and B send pots, into the two aux buses. Every bus is an inverting summer (100k in, 100k back) and an
// inverter after it, so what comes out is the right way up: Send A and Send B go out to an effect, and Ret A and Ret B
// come back, each through its own level pot, into the main bus with the channels. Main sets the main bus's level.
// All DC-coupled, so it mixes CV as well as sound. Our own values; the sim works out the board's own gains from its
// netlist (src/wall/linear.ts) whenever a knob moves, and mixes with them.
import { Chip, SMD, wallBoard, wires } from "./wall-kit.tsx";
import { panel } from "./wall-panels.ts";

const CH = [1, 2, 3, 4];
const TEN = { ohms: "10k" }, HUNDRED = { ohms: "100k" };
const UNIT = ["A", "B", "C", "D"];

export default wallBoard({
  panel: panel("mix"),
  chips: [{ name: "U1" }, { name: "U2" }, { name: "U3" }],
  pots: {
    ...Object.fromEntries(CH.flatMap((n) => [
      [`level-${n}`, { ...HUNDRED, ends: ["GND", `IN_${n}`] as [string, string] }],
      [`a-${n}`, { ...TEN, ends: ["GND", `CH_${n}`] as [string, string] }],
      [`b-${n}`, { ...TEN, ends: ["GND", `CH_${n}`] as [string, string] }],
    ])),
    "ret-a": { ...HUNDRED, ends: ["GND", "RET_A"] },
    "ret-b": { ...HUNDRED, ends: ["GND", "RET_B"] },
    main: { ...TEN, ends: ["GND", "M_N"] },
  },
  parts: <>
    <Chip name="U1" part="TL074" />
    <Chip name="U2" part="TL074" />
    <Chip name="U3" part="TL072" />
    {Array.from({ length: 9 }, (_, i) => <resistor key={i} name={`R${i + 1}`} resistance="100k" footprint={SMD} />)}
    <resistor name="R10" resistance="1k" footprint={SMD} />
    {Array.from({ length: 7 }, (_, i) => <resistor key={i} name={`R${i + 11}`} resistance="100k" footprint={SMD} />)}
    <resistor name="R18" resistance="1k" footprint={SMD} />
    {Array.from({ length: 7 }, (_, i) => <resistor key={i} name={`R${i + 19}`} resistance="100k" footprint={SMD} />)}
    <resistor name="R26" resistance="1k" footprint={SMD} />
  </>,
  traces: <>{wires([
    // The channel buffers, after each Level.
    ...CH.flatMap((n): [string, string][] => [[`U1 > .INP${UNIT[n - 1]}`, `net.LEVEL_${n}_W`], [`U1 > .INN${UNIT[n - 1]}`, `net.CH_${n}`], [`U1 > .OUT${UNIT[n - 1]}`, `net.CH_${n}`]]),
    // The main bus: the channels and both returns into U2A, Main, then U2B the right way up.
    ...CH.flatMap((n): [string, string][] => [[`R${n} > .pin1`, `net.CH_${n}`], [`R${n} > .pin2`, "net.MSUM"]]),
    ["R5 > .pin1", "net.RET_A_W"], ["R5 > .pin2", "net.MSUM"], ["R6 > .pin1", "net.RET_B_W"], ["R6 > .pin2", "net.MSUM"],
    ["R7 > .pin1", "net.M_N"], ["R7 > .pin2", "net.MSUM"],
    ["U2 > .INNA", "net.MSUM"], ["U2 > .INPA", "net.GND"], ["U2 > .OUTA", "net.M_N"],
    ["R8 > .pin1", "net.MAIN_W"], ["R8 > .pin2", "net.MINV"], ["R9 > .pin1", "net.M_P"], ["R9 > .pin2", "net.MINV"],
    ["U2 > .INNB", "net.MINV"], ["U2 > .INPB", "net.GND"], ["U2 > .OUTB", "net.M_P"],
    ["R10 > .pin1", "net.M_P"], ["R10 > .pin2", "net.MAIN"],
    // Aux A: each channel's A pot into U2C, then U2D.
    ...CH.flatMap((n): [string, string][] => [[`R${n + 10} > .pin1`, `net.A_${n}_W`], [`R${n + 10} > .pin2`, "net.ASUM"]]),
    ["R15 > .pin1", "net.A_N"], ["R15 > .pin2", "net.ASUM"],
    ["U2 > .INNC", "net.ASUM"], ["U2 > .INPC", "net.GND"], ["U2 > .OUTC", "net.A_N"],
    ["R16 > .pin1", "net.A_N"], ["R16 > .pin2", "net.AINV"], ["R17 > .pin1", "net.A_P"], ["R17 > .pin2", "net.AINV"],
    ["U2 > .INND", "net.AINV"], ["U2 > .INPD", "net.GND"], ["U2 > .OUTD", "net.A_P"],
    ["R18 > .pin1", "net.A_P"], ["R18 > .pin2", "net.SEND_A"],
    // Aux B: into U3A, then U3B.
    ...CH.flatMap((n): [string, string][] => [[`R${n + 18} > .pin1`, `net.B_${n}_W`], [`R${n + 18} > .pin2`, "net.BSUM"]]),
    ["R23 > .pin1", "net.B_N"], ["R23 > .pin2", "net.BSUM"],
    ["U3 > .INNA", "net.BSUM"], ["U3 > .INPA", "net.GND"], ["U3 > .OUTA", "net.B_N"],
    ["R24 > .pin1", "net.B_N"], ["R24 > .pin2", "net.BINV"], ["R25 > .pin1", "net.B_P"], ["R25 > .pin2", "net.BINV"],
    ["U3 > .INNB", "net.BINV"], ["U3 > .INPB", "net.GND"], ["U3 > .OUTB", "net.B_P"],
    ["R26 > .pin1", "net.B_P"], ["R26 > .pin2", "net.SEND_B"],
  ])}</>,
});
