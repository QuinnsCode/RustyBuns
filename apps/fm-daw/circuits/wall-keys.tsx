// Q Keys, the sound wall's MIDI to CV and clock (WALL.md): MIDI in, the wall's pitch, gate, velocity and a clock out.
// MIDI comes in on JP2 at the back (a TRS-to-header lead or a case's MIDI bus: source, sink, shield), through the
// usual opto input (R1, D1 across the LED, U2 an HCPL-0601, pulled up by R2) to the ATtiny1614's serial in. Its
// firmware takes the last key held as the pitch and holds the gate while any key is, and counts the MIDI clock
// (24 a beat) down to the Div knob's note: a quarter, an eighth or a sixteenth, high half the time. U4, an MCP4822,
// is the pitch (A) and the velocity (B) at 1 mV a step on its own 2.048 V reference; U5 doubles each of them, the gate
// and the clock (two 10k's, or R3 against R4 and the trimmer RT1 for the pitch, trimmed until an octave is an octave)
// to 0 to 8 V and 0 to 10 V. Its 5 V is U1's, from +12 V. JP3 is the microcontroller's one-wire UPDI programming
// header. Our own values; the sim plays the firmware's note and clock logic into the board's own output gains.
import { Chip, SMD, wallBoard, wires } from "./wall-kit.tsx";
import { panel } from "./wall-panels.ts";

export default wallBoard({
  panel: panel("keys"),
  chips: [{ name: "U5" }],
  pots: { div: { ohms: "10k", ends: ["GND", "V5"] } },
  gap: 0.8,
  parts: <>
    <Chip name="U1" part="LM78L05" />
    <Chip name="U2" part="HCPL0601" />
    <Chip name="U3" part="ATTINY1614" />
    <Chip name="U4" part="MCP4822" />
    <Chip name="U5" part="TL074" />
    <chip name="JP2" footprint="pinrow3" manufacturerPartNumber="MIDI in: source, sink, shield" pinLabels={{ pin1: "SRC", pin2: "SNK", pin3: "SHLD" }} />
    <chip name="JP3" footprint="pinrow3" manufacturerPartNumber="UPDI: 5 V, UPDI, GND" pinLabels={{ pin1: "V5", pin2: "UPDI", pin3: "GND" }} />
    <potentiometer name="RT1" maxResistance="2k" pinVariant="three_pin" footprint="pinrow3_p2.54mm" manufacturerPartNumber="3362P 2k trimmer" />
    <resistor name="R1" resistance="220" footprint={SMD} />
    <diode name="D1" footprint="sod123" manufacturerPartNumber="1N4148W" />
    <resistor name="R2" resistance="1k" footprint={SMD} />
    <resistor name="R3" resistance="10k" footprint={SMD} manufacturerPartNumber="0.1%" />
    <resistor name="R4" resistance="9.1k" footprint={SMD} manufacturerPartNumber="0.1%" />
    <resistor name="R5" resistance="220" footprint={SMD} />
    <resistor name="R6" resistance="10k" footprint={SMD} />
    <resistor name="R7" resistance="10k" footprint={SMD} />
    <resistor name="R8" resistance="1k" footprint={SMD} />
    <resistor name="R9" resistance="10k" footprint={SMD} />
    <resistor name="R10" resistance="10k" footprint={SMD} />
    <resistor name="R11" resistance="1k" footprint={SMD} />
    <resistor name="R12" resistance="10k" footprint={SMD} />
    <resistor name="R13" resistance="10k" footprint={SMD} />
    <resistor name="R14" resistance="1k" footprint={SMD} />
    <capacitor name="C1" capacitance="330nF" footprint={SMD} />
    <capacitor name="C2" capacitance="10uF" footprint={SMD} />
    <capacitor name="C3" capacitance="100nF" footprint={SMD} />
    <capacitor name="C4" capacitance="100nF" footprint={SMD} />
    <capacitor name="C5" capacitance="100nF" footprint={SMD} />
  </>,
  traces: <>{wires([
    // 5 V for the digital side.
    ["U1 > .VIN", "net.V12"], ["U1 > .VOUT", "net.V5"],
    ["U1 > .GNDA", "net.GND"], ["U1 > .GNDB", "net.GND"], ["U1 > .GNDC", "net.GND"], ["U1 > .GNDD", "net.GND"],
    ["C1 > .pin1", "net.V12"], ["C1 > .pin2", "net.GND"], ["C2 > .pin1", "net.V5"], ["C2 > .pin2", "net.GND"],
    // MIDI in: the current loop through the opto's LED.
    ["JP2 > .SRC", "R1 > .pin1"], ["R1 > .pin2", "net.MIDI_A"], ["JP2 > .SNK", "net.MIDI_K"],
    ["U2 > .ANODE", "net.MIDI_A"], ["U2 > .CATHODE", "net.MIDI_K"], ["D1 > .anode", "net.MIDI_K"], ["D1 > .cathode", "net.MIDI_A"],
    ["U2 > .VCC", "net.V5"], ["U2 > .VE", "net.V5"], ["U2 > .GND", "net.GND"], ["U2 > .VO", "net.RX"],
    ["R2 > .pin1", "net.V5"], ["R2 > .pin2", "net.RX"], ["C3 > .pin1", "net.V5"], ["C3 > .pin2", "net.GND"],
    // The microcontroller: serial in, SPI to the DAC, the gate and clock, the Div knob, programming.
    ["U3 > .VDD", "net.V5"], ["U3 > .GND", "net.GND"], ["C4 > .pin1", "net.V5"], ["C4 > .pin2", "net.GND"],
    ["U3 > .PB3", "net.RX"], ["U3 > .PA1", "net.SDI"], ["U3 > .PA3", "net.SCK"], ["U3 > .PA4", "net.CS"],
    ["U3 > .PA6", "net.GATE5"], ["U3 > .PA7", "net.CLK5"], ["U3 > .PB1", "net.DIV_W"], ["U3 > .UPDI", "net.UPDI"],
    ["JP3 > .V5", "net.V5"], ["JP3 > .UPDI", "net.UPDI"], ["JP3 > .GND", "net.GND"],
    // The DAC: pitch on A, velocity on B, each written as CS rises (LDAC held low).
    ["U4 > .VDD", "net.V5"], ["U4 > .VSS", "net.GND"], ["U4 > .CS", "net.CS"], ["U4 > .SCK", "net.SCK"], ["U4 > .SDI", "net.SDI"],
    ["U4 > .LDAC", "net.GND"], ["U4 > .VOUTA", "net.DAC_A"], ["U4 > .VOUTB", "net.DAC_B"], ["C5 > .pin1", "net.V5"], ["C5 > .pin2", "net.GND"],
    // Pitch: twice the DAC, trimmed, its feedback from past R5 so the jack's load doesn't pull it flat.
    ["U5 > .INPA", "net.DAC_A"], ["U5 > .INNA", "net.PN"], ["U5 > .OUTA", "net.PO"],
    ["R3 > .pin1", "net.PN"], ["R3 > .pin2", "net.GND"], ["R4 > .pin1", "net.PITCH"], ["R4 > .pin2", "net.PT"],
    ["RT1 > .pin1", "net.PT"], ["RT1 > .pin2", "net.PN"], ["RT1 > .pin3", "net.PN"],
    ["R5 > .pin1", "net.PO"], ["R5 > .pin2", "net.PITCH"],
    // Gate, velocity and clock, each twice its 5 V or DAC volts.
    ["U5 > .INPB", "net.GATE5"], ["U5 > .INNB", "net.GN"], ["U5 > .OUTB", "net.GO"],
    ["R6 > .pin1", "net.GN"], ["R6 > .pin2", "net.GND"], ["R7 > .pin1", "net.GO"], ["R7 > .pin2", "net.GN"], ["R8 > .pin1", "net.GO"], ["R8 > .pin2", "net.GATE"],
    ["U5 > .INPC", "net.DAC_B"], ["U5 > .INNC", "net.VN"], ["U5 > .OUTC", "net.VO"],
    ["R9 > .pin1", "net.VN"], ["R9 > .pin2", "net.GND"], ["R10 > .pin1", "net.VO"], ["R10 > .pin2", "net.VN"], ["R11 > .pin1", "net.VO"], ["R11 > .pin2", "net.VEL"],
    ["U5 > .INPD", "net.CLK5"], ["U5 > .INND", "net.CN"], ["U5 > .OUTD", "net.CO"],
    ["R12 > .pin1", "net.CN"], ["R12 > .pin2", "net.GND"], ["R13 > .pin1", "net.CO"], ["R13 > .pin2", "net.CN"], ["R14 > .pin1", "net.CO"], ["R14 > .pin2", "net.CLOCK"],
  ])}</>,
});
