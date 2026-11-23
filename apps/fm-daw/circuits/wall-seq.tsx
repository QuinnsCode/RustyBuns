// Q Steps, the sound wall's sequencer (WALL.md): the classic 555 and 4017 eight-step sequencer. The 555 runs astable
// (f = 1.44 / ((R1 + 2 (R2 + Rate)) C1): 0.7 to 14 steps a second), each tick moves the 4017 on a step and is also the
// gate out. The 4017 lifts one step's pot to 12 V at a time; that pot's wiper reaches the bus through its Schottky,
// U3A buffers the bus and R4 and R5 bring it down by six to 0 to 2 V (two octaves) for U3B to drive the CV out. Q8 resets the
// 4017, so it counts eight. Clock In takes the 555's place while a cable is in it (its jack's switch): Q1 squares
// either one up for the 4017, which counts on EN falling with CLK held high, so any clock over about 1.3 V moves it
// on a step, and the gate out is whatever is clocking it. Our own values; the sim reads the clock, the pots, the
// clock input's threshold and the divider off these parts.
import { Chip, SMD, wallBoard, wires } from "./wall-kit.tsx";
import { panel } from "./wall-panels.ts";

const STEPS = [0, 1, 2, 3, 4, 5, 6, 7];

export default wallBoard({
  panel: panel("seq"),
  chips: [{ name: "U1", single: true }, { name: "U2", single: true }, { name: "U3" }],
  pots: {
    ...Object.fromEntries(STEPS.map((i) => [`step-${i + 1}`, { ohms: "100k", ends: ["GND", `S${i}`] as [string, string] }])),
    rate: { ohms: "100k", ends: ["W", "RT"], wiper: "THR" },
  },
  parts: <>
    <Chip name="U1" part="NE555" />
    <Chip name="U2" part="CD4017" />
    <Chip name="U3" part="TL072" />
    <resistor name="R1" resistance="1k" footprint={SMD} />
    <resistor name="R2" resistance="4.7k" footprint={SMD} />
    <capacitor name="C1" capacitance="10uF" footprint="1206" manufacturerPartNumber="X7R 25 V" />
    <capacitor name="C2" capacitance="10nF" footprint={SMD} />
    {STEPS.map((i) => <diode key={i} name={`D${i + 1}`} footprint="sod123" manufacturerPartNumber="B5819W" />)}
    <resistor name="R3" resistance="1M" footprint={SMD} />
    <resistor name="R4" resistance="49.9k" footprint={SMD} />
    <resistor name="R5" resistance="10k" footprint={SMD} />
    <resistor name="R6" resistance="1k" footprint={SMD} />
    <resistor name="R7" resistance="1k" footprint={SMD} />
    <transistor name="Q1" type="npn" footprint="sot23" manufacturerPartNumber="MMBT3904" />
    <resistor name="R8" resistance="100k" footprint={SMD} />
    <resistor name="R9" resistance="100k" footprint={SMD} />
    <resistor name="R10" resistance="10k" footprint={SMD} />
    <diode name="D9" footprint="sod123" manufacturerPartNumber="1N4148W" />
  </>,
  traces: <>{wires([
    // The clock.
    ["R1 > .pin1", "net.V12"], ["R1 > .pin2", "net.DIS"], ["R2 > .pin1", "net.DIS"], ["R2 > .pin2", "net.RT"],
    ["U1 > .DISCH", "net.DIS"], ["U1 > .THRES", "net.THR"], ["U1 > .TRIG", "net.THR"],
    ["C1 > .pin1", "net.THR"], ["C1 > .pin2", "net.GND"], ["U1 > .CTRL", "C2 > .pin1"], ["C2 > .pin2", "net.GND"],
    ["U1 > .RESET", "net.V12"], ["U1 > .Q", "net.CLK"],
    // Clock In (the 555 while nothing is plugged in) squared up by Q1; D9 keeps a negative clock off its base.
    ["R8 > .pin1", "net.CLOCK"], ["R8 > .pin2", "net.QB"], ["R9 > .pin1", "net.QB"], ["R9 > .pin2", "net.GND"],
    ["D9 > .anode", "net.GND"], ["D9 > .cathode", "net.QB"],
    ["Q1 > .base", "net.QB"], ["Q1 > .emitter", "net.GND"], ["Q1 > .collector", "net.CLKN"],
    ["R10 > .pin1", "net.V12"], ["R10 > .pin2", "net.CLKN"],
    // The counter: eight steps, Q8 back to the start, a step on each fall of EN.
    ["U2 > .CLK", "net.V12"], ["U2 > .EN", "net.CLKN"], ["U2 > .RST", "U2 > .Q8"],
    ...STEPS.map((i): [string, string] => [`U2 > .Q${i}`, `net.S${i}`]),
    ...STEPS.flatMap((i): [string, string][] => [[`D${i + 1} > .anode`, `net.STEP_${i + 1}_W`], [`D${i + 1} > .cathode`, "net.BUS"]]),
    ["R3 > .pin1", "net.BUS"], ["R3 > .pin2", "net.GND"],
    // The bus to 0 to 2 V, and out.
    ["U3 > .INPA", "net.BUS"], ["U3 > .INNA", "net.BUF"], ["U3 > .OUTA", "net.BUF"],
    ["R4 > .pin1", "net.BUF"], ["R4 > .pin2", "net.DIVN"], ["R5 > .pin1", "net.DIVN"], ["R5 > .pin2", "net.GND"],
    ["U3 > .INPB", "net.DIVN"], ["U3 > .INNB", "net.CV_I"], ["U3 > .OUTB", "net.CV_I"],
    ["R6 > .pin1", "net.CV_I"], ["R6 > .pin2", "net.CV"],
    ["R7 > .pin1", "net.CLOCK"], ["R7 > .pin2", "net.GATE"],
  ])}</>,
});
