// Q Brigade, the sound wall's bucket-brigade delay (WALL.md): 10 to 102 ms of echo, chorus or flange, on a part that
// can be bought now. The chip is Coolaudio's V3208D (2048 stages, DIP-8), laid out as its datasheet has it: 4 to 10 V
// (9 V here, U5's), VGG at 14/15 of VDD (R10/R11), a two-phase clock of 10 to 100 kHz, and its two outputs (one stage
// apart) averaged by R14 and R15, which cancels most of the clock. Around it, as a bucket brigade's board always has:
// - In and the repeats (WET back through Repeats and R3) summed by U1A at a twentieth (R2), so a Eurorack signal sits
//   near the chip's 0.36 V rms;
// - U2A, half an SA571, as its datasheet's basic compressor (2:1, C1 in through its own R3, C3 the gain cell's AC
//   feedback, R4/R5/C2 the DC loop that sets its output at 5.8 V, C4 its averaging), into U1B's anti-alias filter;
// - the chip, its input on RT1's bias through R9 (trim for the least distortion, as the datasheet says);
// - U1C's reconstruction filter, then U2B as the datasheet's basic expander (1:2, C16 its averaging), so the chip's
//   hiss falls as the echo does; U1D brings it back up (R20 over R19) to WET.
// The clock: Time (on -12 V), Mod (U4A/U4B's triangle, Rate its speed, as Q Wobble's) and Time CV summed by U4C to
// 0 to 9 V, clamped by D1/D2 onto U6's VCO (a CD4046: 20 to 200 kHz from R30, R31 and C20). U7, a CD4013, halves it into
// two opposite phases, and U8, a CD4049UB, drives the chip's 2.8 nF clock pins with three inverters each.
// Mix fades In to WET through U4D to Out. Our own values; the sim plays every gain, corner, rate and the companders'
// laws from these parts.
import { Chip, SMD, wallBoard, wires } from "./wall-kit.tsx";
import { panel } from "./wall-panels.ts";

/** A 100 nF across one of the 9 V chips. */
const decouple = (c: string): [string, string][] => [[`${c} > .pin1`, "net.V9"], [`${c} > .pin2`, "net.GND"]];

export default wallBoard({
  panel: panel("bbd"),
  chips: [{ name: "U1" }, { name: "U2", single: true }, { name: "U4" }],
  pots: {
    time: { ohms: "10k", ends: ["VN12", "GND"] },
    repeats: { ohms: "10k", ends: ["GND", "WET"] },
    mod: { ohms: "10k", ends: ["GND", "TRI"] },
    rate: { ohms: "1M", ends: ["W", "RA"], wiper: "INTN" },
    mix: { ohms: "10k", ends: ["IN", "WET"] },
  },
  gap: 0.5,
  parts: <>
    <Chip name="U1" part="TL074" />
    <Chip name="U2" part="SA571" />
    <Chip name="U3" part="V3208D" />
    <Chip name="U4" part="TL074" />
    <Chip name="U5" part="LM78L09" />
    <Chip name="U6" part="CD4046" />
    <Chip name="U7" part="CD4013" />
    <Chip name="U8" part="CD4049UB" />
    <potentiometer name="RT1" maxResistance="100k" pinVariant="three_pin" footprint="pinrow3_p2.54mm" manufacturerPartNumber="3362P 100k trimmer" />
    {/* In and the repeats into the compressor. */}
    <resistor name="R1" resistance="100k" footprint={SMD} />
    <resistor name="R2" resistance="4.7k" footprint={SMD} />
    <resistor name="R3" resistance="110k" footprint={SMD} />
    <capacitor name="C1" capacitance="2.2uF" footprint="1206" manufacturerPartNumber="X7R 25 V" />
    <resistor name="R4" resistance="33k" footprint={SMD} />
    <resistor name="R5" resistance="33k" footprint={SMD} />
    <capacitor name="C2" capacitance="10uF" footprint={SMD} />
    <capacitor name="C3" capacitance="2.2uF" footprint="1206" manufacturerPartNumber="X7R 25 V" />
    <capacitor name="C4" capacitance="2.2uF" footprint="1206" manufacturerPartNumber="X7R 25 V" />
    {/* The anti-alias filter and the chip's input. */}
    <capacitor name="C5" capacitance="1uF" footprint="1206" manufacturerPartNumber="X7R 25 V" />
    <resistor name="R6" resistance="100k" footprint={SMD} />
    <resistor name="R7" resistance="10k" footprint={SMD} />
    <resistor name="R8" resistance="10k" footprint={SMD} />
    <capacitor name="C6" capacitance="4.7nF" footprint={SMD} manufacturerPartNumber="C0G" />
    <capacitor name="C7" capacitance="2.2nF" footprint={SMD} manufacturerPartNumber="C0G" />
    <capacitor name="C8" capacitance="1uF" footprint="1206" manufacturerPartNumber="X7R 25 V" />
    <resistor name="R9" resistance="100k" footprint={SMD} />
    {/* The chip's VGG and outputs. */}
    <resistor name="R10" resistance="10k" footprint={SMD} />
    <resistor name="R11" resistance="140k" footprint={SMD} />
    <capacitor name="C9" capacitance="100nF" footprint={SMD} />
    <capacitor name="C10" capacitance="100nF" footprint={SMD} />
    <resistor name="R12" resistance="10k" footprint={SMD} />
    <resistor name="R13" resistance="10k" footprint={SMD} />
    <resistor name="R14" resistance="22k" footprint={SMD} />
    <resistor name="R15" resistance="22k" footprint={SMD} />
    {/* The reconstruction filter and the expander. */}
    <capacitor name="C11" capacitance="1uF" footprint="1206" manufacturerPartNumber="X7R 25 V" />
    <resistor name="R16" resistance="100k" footprint={SMD} />
    <resistor name="R17" resistance="10k" footprint={SMD} />
    <resistor name="R18" resistance="10k" footprint={SMD} />
    <capacitor name="C12" capacitance="4.7nF" footprint={SMD} manufacturerPartNumber="C0G" />
    <capacitor name="C13" capacitance="2.2nF" footprint={SMD} manufacturerPartNumber="C0G" />
    <capacitor name="C14" capacitance="2.2uF" footprint="1206" manufacturerPartNumber="X7R 25 V" />
    <capacitor name="C15" capacitance="2.2uF" footprint="1206" manufacturerPartNumber="X7R 25 V" />
    <capacitor name="C16" capacitance="2.2uF" footprint="1206" manufacturerPartNumber="X7R 25 V" />
    <capacitor name="C17" capacitance="2.2uF" footprint="1206" manufacturerPartNumber="X7R 25 V" />
    <resistor name="R19" resistance="4.7k" footprint={SMD} />
    <resistor name="R20" resistance="130k" footprint={SMD} />
    <resistor name="R21" resistance="1k" footprint={SMD} />
    {/* The LFO, as Q Wobble's, ten times slower. */}
    <resistor name="R22" resistance="10k" footprint={SMD} />
    <capacitor name="C18" capacitance="10uF" footprint="1206" manufacturerPartNumber="X7R 25 V" />
    <resistor name="R23" resistance="4.7k" footprint={SMD} />
    <resistor name="R24" resistance="10k" footprint={SMD} />
    {/* The clock's control, the VCO, its phases and their drivers. */}
    <resistor name="R25" resistance="75k" footprint={SMD} />
    <resistor name="R26" resistance="100k" footprint={SMD} />
    <resistor name="R27" resistance="100k" footprint={SMD} />
    <resistor name="R28" resistance="100k" footprint={SMD} />
    <resistor name="R29" resistance="10k" footprint={SMD} />
    <diode name="D1" footprint="sod123" manufacturerPartNumber="B5819W" />
    <diode name="D2" footprint="sod123" manufacturerPartNumber="B5819W" />
    <capacitor name="C19" capacitance="10nF" footprint={SMD} />
    <capacitor name="C20" capacitance="470pF" footprint={SMD} manufacturerPartNumber="C0G" />
    <resistor name="R30" resistance="11k" footprint={SMD} />
    <resistor name="R31" resistance="100k" footprint={SMD} />
    {/* 9 V for the chip and the clock. */}
    <capacitor name="C21" capacitance="330nF" footprint={SMD} />
    <capacitor name="C22" capacitance="10uF" footprint={SMD} />
    <capacitor name="C23" capacitance="100nF" footprint={SMD} />
    <capacitor name="C24" capacitance="100nF" footprint={SMD} />
    <capacitor name="C25" capacitance="100nF" footprint={SMD} />
  </>,
  traces: <>{wires([
    // 9 V.
    ["U5 > .VIN", "net.V12"], ["U5 > .VOUT", "net.V9"],
    ["U5 > .GNDA", "net.GND"], ["U5 > .GNDB", "net.GND"], ["U5 > .GNDC", "net.GND"], ["U5 > .GNDD", "net.GND"],
    ["C21 > .pin1", "net.V12"], ["C21 > .pin2", "net.GND"], ["C22 > .pin1", "net.V9"], ["C22 > .pin2", "net.GND"],
    // In and the repeats, a twentieth each.
    ["U1 > .INPA", "net.GND"], ["U1 > .INNA", "net.SUM"], ["U1 > .OUTA", "net.SUMO"],
    ["R1 > .pin1", "net.IN"], ["R1 > .pin2", "net.SUM"], ["R2 > .pin1", "net.SUMO"], ["R2 > .pin2", "net.SUM"],
    ["R3 > .pin1", "net.REPEATS_W"], ["R3 > .pin2", "net.SUM"],
    // The compressor: in through its R3, the gain cell and rectifier fed back from its output.
    ["C1 > .pin1", "net.SUMO"], ["C1 > .pin2", "U2 > .R3A"],
    ["U2 > .GIN1", "net.CFB"], ["U2 > .RECTIN1", "net.CFB"], ["C3 > .pin1", "net.CO"], ["C3 > .pin2", "net.CFB"],
    ["U2 > .OUT1", "net.CO"], ["R4 > .pin1", "net.CO"], ["R4 > .pin2", "net.CDC"], ["R5 > .pin1", "net.CDC"], ["R5 > .pin2", "U2 > .INV1"],
    ["C2 > .pin1", "net.CDC"], ["C2 > .pin2", "net.GND"], ["C4 > .pin1", "U2 > .RECTCAP1"], ["C4 > .pin2", "net.GND"],
    // The anti-alias filter: a unity-gain Sallen-Key low-pass at 5 kHz.
    ["C5 > .pin1", "net.CO"], ["C5 > .pin2", "net.AA"], ["R6 > .pin1", "net.AA"], ["R6 > .pin2", "net.GND"],
    ["R7 > .pin1", "net.AA"], ["R7 > .pin2", "net.AA1"], ["R8 > .pin1", "net.AA1"], ["R8 > .pin2", "net.AA2"],
    ["C6 > .pin1", "net.AA1"], ["C6 > .pin2", "net.AAO"], ["C7 > .pin1", "net.AA2"], ["C7 > .pin2", "net.GND"],
    ["U1 > .INPB", "net.AA2"], ["U1 > .INNB", "net.AAO"], ["U1 > .OUTB", "net.AAO"],
    // The chip: its input on the trimmed bias, VGG, both outputs averaged.
    ["C8 > .pin1", "net.AAO"], ["C8 > .pin2", "net.BIN"], ["R9 > .pin1", "net.BIAS"], ["R9 > .pin2", "net.BIN"],
    ["RT1 > .pin1", "net.V9"], ["RT1 > .pin2", "net.BIAS"], ["RT1 > .pin3", "net.GND"],
    ["U3 > .IN", "net.BIN"], ["U3 > .GND", "net.GND"], ["U3 > .VDD", "net.V9"], ["U3 > .VGG", "net.VGG"],
    ["U3 > .CP1", "net.CLKA"], ["U3 > .CP2", "net.CLKB"],
    ["R10 > .pin1", "net.V9"], ["R10 > .pin2", "net.VGG"], ["R11 > .pin1", "net.VGG"], ["R11 > .pin2", "net.GND"],
    ["C9 > .pin1", "net.VGG"], ["C9 > .pin2", "net.GND"], ...decouple("C10"),
    ["U3 > .OUT1", "net.BO1"], ["U3 > .OUT2", "net.BO2"], ["R12 > .pin1", "net.BO1"], ["R12 > .pin2", "net.GND"],
    ["R13 > .pin1", "net.BO2"], ["R13 > .pin2", "net.GND"],
    ["R14 > .pin1", "net.BO1"], ["R14 > .pin2", "net.BSUM"], ["R15 > .pin1", "net.BO2"], ["R15 > .pin2", "net.BSUM"],
    // The reconstruction filter, as the anti-alias one.
    ["C11 > .pin1", "net.BSUM"], ["C11 > .pin2", "net.RC"], ["R16 > .pin1", "net.RC"], ["R16 > .pin2", "net.GND"],
    ["R17 > .pin1", "net.RC"], ["R17 > .pin2", "net.RC1"], ["R18 > .pin1", "net.RC1"], ["R18 > .pin2", "net.RC2"],
    ["C12 > .pin1", "net.RC1"], ["C12 > .pin2", "net.RCO"], ["C13 > .pin1", "net.RC2"], ["C13 > .pin2", "net.GND"],
    ["U1 > .INPC", "net.RC2"], ["U1 > .INNC", "net.RCO"], ["U1 > .OUTC", "net.RCO"],
    // The expander: its gain cell and rectifier both on the input, its R3 to its output.
    ["C14 > .pin1", "net.RCO"], ["C14 > .pin2", "U2 > .GIN2"], ["C15 > .pin1", "net.RCO"], ["C15 > .pin2", "U2 > .RECTIN2"],
    ["C16 > .pin1", "U2 > .RECTCAP2"], ["C16 > .pin2", "net.GND"], ["U2 > .R3B", "net.EO"], ["U2 > .OUT2", "net.EO"],
    // Back up to the wall's level.
    ["C17 > .pin1", "net.EO"], ["C17 > .pin2", "net.EAC"], ["R19 > .pin1", "net.EAC"], ["R19 > .pin2", "net.WN"],
    ["U1 > .INPD", "net.GND"], ["U1 > .INND", "net.WN"], ["U1 > .OUTD", "net.WET"], ["R20 > .pin1", "net.WET"], ["R20 > .pin2", "net.WN"],
    // Mix, buffered out.
    ["U4 > .INPD", "net.MIX_W"], ["U4 > .INND", "net.MO"], ["U4 > .OUTD", "net.MO"], ["R21 > .pin1", "net.MO"], ["R21 > .pin2", "net.OUT"],
    // The LFO.
    ["R22 > .pin1", "net.SQR"], ["R22 > .pin2", "net.RA"],
    ["U4 > .INNA", "net.INTN"], ["U4 > .INPA", "net.GND"], ["U4 > .OUTA", "net.TRI"],
    ["C18 > .pin1", "net.TRI"], ["C18 > .pin2", "net.INTN"],
    ["R23 > .pin1", "net.TRI"], ["R23 > .pin2", "net.SP"], ["R24 > .pin1", "net.SQR"], ["R24 > .pin2", "net.SP"],
    ["U4 > .INPB", "net.SP"], ["U4 > .INNB", "net.GND"], ["U4 > .OUTB", "net.SQR"],
    // The clock's control voltage, 0 to 9 V onto the VCO.
    ["U4 > .INPC", "net.GND"], ["U4 > .INNC", "net.CTLN"], ["U4 > .OUTC", "net.CTL"], ["R25 > .pin1", "net.CTL"], ["R25 > .pin2", "net.CTLN"],
    ["R26 > .pin1", "net.TIME_W"], ["R26 > .pin2", "net.CTLN"], ["R27 > .pin1", "net.MOD_W"], ["R27 > .pin2", "net.CTLN"],
    ["R28 > .pin1", "net.CV"], ["R28 > .pin2", "net.CTLN"],
    ["R29 > .pin1", "net.CTL"], ["R29 > .pin2", "net.VCOIN"], ["D1 > .anode", "net.VCOIN"], ["D1 > .cathode", "net.V9"],
    ["D2 > .anode", "net.GND"], ["D2 > .cathode", "net.VCOIN"], ["C19 > .pin1", "net.VCOIN"], ["C19 > .pin2", "net.GND"],
    // The VCO: its phase comparators unused, their inputs held.
    ["U6 > .VDD", "net.V9"], ["U6 > .VSS", "net.GND"], ["U6 > .INH", "net.GND"], ["U6 > .SIGIN", "net.GND"], ["U6 > .COMPIN", "net.GND"],
    ["U6 > .VCOIN", "net.VCOIN"], ["U6 > .VCOOUT", "net.CLK"], ["C20 > .pin1", "U6 > .C1A"], ["C20 > .pin2", "U6 > .C1B"],
    ["R30 > .pin1", "U6 > .R1"], ["R30 > .pin2", "net.GND"], ["R31 > .pin1", "U6 > .R2"], ["R31 > .pin2", "net.GND"], ...decouple("C23"),
    // Halved into two phases; the second flip-flop's inputs held.
    ["U7 > .VDD", "net.V9"], ["U7 > .VSS", "net.GND"], ["U7 > .CLK1", "net.CLK"], ["U7 > .D1", "net.PHB"], ["U7 > .QB1", "net.PHB"], ["U7 > .Q1", "net.PHA"],
    ["U7 > .RST1", "net.GND"], ["U7 > .SET1", "net.GND"],
    ["U7 > .CLK2", "net.GND"], ["U7 > .D2", "net.GND"], ["U7 > .RST2", "net.GND"], ["U7 > .SET2", "net.GND"], ...decouple("C24"),
    // Three inverters to a phase, into the chip's clock pins.
    ["U8 > .VDD", "net.V9"], ["U8 > .VSS", "net.GND"],
    ["U8 > .A", "net.PHA"], ["U8 > .B", "net.PHA"], ["U8 > .C", "net.PHA"], ["U8 > .YA", "net.CLKB"], ["U8 > .YB", "net.CLKB"], ["U8 > .YC", "net.CLKB"],
    ["U8 > .D", "net.PHB"], ["U8 > .E", "net.PHB"], ["U8 > .F", "net.PHB"], ["U8 > .YD", "net.CLKA"], ["U8 > .YE", "net.CLKA"], ["U8 > .YF", "net.CLKA"],
    ...decouple("C25"),
  ])}</>,
});
