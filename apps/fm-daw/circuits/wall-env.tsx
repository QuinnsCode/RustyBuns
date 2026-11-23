// Q Swell, the sound wall's envelope (WALL.md): attack, sustain while the gate is held, release, from diodes steering
// one capacitor, the oldest envelope there is. U1A squares up any gate over about 2.2 V; through D1 it lifts G to
// 10.4 V while the gate is high, and R5 holds G at 0 V when it is low (D1 shut). While G is high, C1 charges through
// D2 and Attack toward 9.8 V and stays there; when it falls, D2 shuts and C1 empties through Release, D3 and R5 to
// ground, down to D3's drop as its current dies: D3 is a Schottky so that is a few hundredths of a volt, not the
// silicon diode's 0.3 V that would leak the VCA open between notes. Attack is 1 M and a 1k on 10 uF (10 ms to 10 s),
// Release the same and R5 (32 ms to 10 s). U1B buffers the cap. Our own values; the sim plays this board's netlist.
// What the sim caught in the first draws: G clamped at -0.6 V by a diode to ground left the envelope resting at
// -0.6 V; a 10k R5 put 110 ms under the fastest release; a silicon D3 rested at 0.3 V.
import { Chip, SMD, wallBoard, wires } from "./wall-kit.tsx";
import { panel } from "./wall-panels.ts";

export default wallBoard({
  panel: panel("env"),
  chips: [{ name: "U1" }],
  gap: 0.9,
  pots: {
    attack: { ohms: "1M", ends: ["AT", "W"], wiper: "ENVC" },
    release: { ohms: "1M", ends: ["ENVC", "W"] },
  },
  parts: <>
    <Chip name="U1" part="TL072" />
    <resistor name="R1" resistance="100k" footprint={SMD} />
    <resistor name="R2" resistance="100k" footprint={SMD} />
    <resistor name="R3" resistance="100k" footprint={SMD} />
    <resistor name="R4" resistance="10k" footprint={SMD} />
    <resistor name="R5" resistance="2.2k" footprint={SMD} />
    <diode name="D1" footprint="sod123" manufacturerPartNumber="1N4148W" />
    <diode name="D2" footprint="sod123" manufacturerPartNumber="1N4148W" />
    <diode name="D3" footprint="sod123" manufacturerPartNumber="B5819W" />
    <resistor name="R6" resistance="1k" footprint={SMD} />
    <resistor name="R7" resistance="1k" footprint={SMD} />
    <capacitor name="C1" capacitance="10uF" footprint="1206" manufacturerPartNumber="X7R 25 V" />
    <resistor name="R8" resistance="1k" footprint={SMD} />
  </>,
  traces: <>{wires([
    // The gate, halved, against 1.1 V.
    ["R1 > .pin1", "net.GATE"], ["R1 > .pin2", "net.GP"], ["R2 > .pin1", "net.GP"], ["R2 > .pin2", "net.GND"],
    ["R3 > .pin1", "net.V12"], ["R3 > .pin2", "net.GTH"], ["R4 > .pin1", "net.GTH"], ["R4 > .pin2", "net.GND"],
    ["U1 > .INPA", "net.GP"], ["U1 > .INNA", "net.GTH"], ["U1 > .OUTA", "net.CMP"],
    ["D1 > .anode", "net.CMP"], ["D1 > .cathode", "net.G"], ["R5 > .pin1", "net.G"], ["R5 > .pin2", "net.GND"],
    // Attack in through D2, release out through D3.
    ["D2 > .anode", "net.G"], ["D2 > .cathode", "R6 > .pin1"], ["R6 > .pin2", "net.AT"],
    ["C1 > .pin1", "net.ENVC"], ["C1 > .pin2", "net.GND"],
    ["R7 > .pin1", "net.RELEASE_W"], ["R7 > .pin2", "D3 > .anode"], ["D3 > .cathode", "net.G"],
    ["U1 > .INPB", "net.ENVC"], ["U1 > .INNB", "net.ENV_O"], ["U1 > .OUTB", "net.ENV_O"],
    ["R8 > .pin1", "net.ENV_O"], ["R8 > .pin2", "net.OUT"],
  ])}</>,
});
