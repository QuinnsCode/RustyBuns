// Q Ladder, the sound wall's transistor ladder low-pass (WALL.md): four poles, 24 dB an octave, after US patent
// 3,475,623 (1969, expired). Q3/Q4 are the drive pair on the tail current; four common-base pairs stack on it
// (Q5/Q6 up to Q11/Q12, the top pair's collectors on +12 V), with 10 nF across each stage (C2 to C5). Their bases sit
// on a bias string from +12 V (R12 to R17, a volt a step, C6 to C10 holding each tap still), so every pair has room.
// In comes through R8 into R9 onto Q3's base, about a hundredth, so a Eurorack signal is a few VT across the pair and
// bends as a ladder should. U1C and U1D follow the top capacitor's two sides into U2A, a difference amplifier
// (R19 over R18: 47). Res feeds that back through R10 and RV2 into R11 on Q4's base: at the top of its turn the
// loop's gain passes four and it sings. U2B (1 + R24/R23, outside the loop) brings it up to about the level it came in.
//
// The tail current is the cutoff, f = I / (8 pi C VT), from an exponential converter of two matched NPNs: Q1 is the
// reference (U1B holds its collector at 12 V / R6, about 6.7 uA: 1 kHz), Q2 sinks the tail. Freq (+-5 octaves) and
// CV (the jack through its attenuator, about a volt an octave) are summed by U1A and divided by R4/R5 onto Q1's base,
// so a volt up there is a volt's worth less on the reference and more in the tail. R7 caps it near 180 uA (27 kHz).
// Our own values. The sim (src/wall/sims.ts) plays the ladder's stage equations, every number from these parts.
import { Chip, SMD, wallBoard, wires } from "./wall-kit.tsx";
import { panel } from "./wall-panels.ts";

/** The ladder's four stages: stage s's pair (emitters on its capacitor), bases on Bs, collectors on the stage above. */
const STAGES = [1, 2, 3, 4];
const npn = (name: string) => <transistor key={name} name={name} type="npn" footprint="sot23" manufacturerPartNumber="MMBT3904 (matched)" />;

export default wallBoard({
  panel: panel("ladder"),
  chips: [{ name: "U1" }, { name: "U2" }],
  gap: 0.5,
  pots: {
    freq: { ohms: "100k", ends: ["VN12", "V12"] },
    res: { ohms: "10k", ends: ["W", "FB1"], wiper: "FBB" },
    cv: { ohms: "100k", ends: ["GND", "CV"] },
  },
  parts: <>
    <Chip name="U1" part="TL074" />
    <Chip name="U2" part="TL072" />
    {/* The converter. */}
    {npn("Q1")}
    {npn("Q2")}
    <resistor name="R1" resistance="240k" footprint={SMD} />
    <resistor name="R2" resistance="100k" footprint={SMD} />
    <resistor name="R3" resistance="100k" footprint={SMD} />
    <resistor name="R4" resistance="100k" footprint={SMD} />
    <resistor name="R5" resistance="1.8k" footprint={SMD} />
    <resistor name="R6" resistance="1.8M" footprint={SMD} />
    <resistor name="R7" resistance="56k" footprint={SMD} />
    <capacitor name="C1" capacitance="100pF" footprint={SMD} />
    {/* The drive pair, its input and Res. */}
    {npn("Q3")}
    {npn("Q4")}
    <resistor name="R8" resistance="22k" footprint={SMD} />
    <resistor name="R9" resistance="220" footprint={SMD} />
    <resistor name="R10" resistance="2.2k" footprint={SMD} />
    <resistor name="R11" resistance="220" footprint={SMD} />
    {/* The four stages and their capacitors. */}
    {STAGES.flatMap((s) => [npn(`Q${3 + 2 * s}`), npn(`Q${4 + 2 * s}`)])}
    {STAGES.map((s) => <capacitor key={s} name={`C${s + 1}`} capacitance="10nF" footprint={SMD} manufacturerPartNumber="C0G" />)}
    {/* The bias string. */}
    <resistor name="R12" resistance="6.8k" footprint={SMD} />
    <resistor name="R13" resistance="1k" footprint={SMD} />
    <resistor name="R14" resistance="1k" footprint={SMD} />
    <resistor name="R15" resistance="1k" footprint={SMD} />
    <resistor name="R16" resistance="1k" footprint={SMD} />
    <resistor name="R17" resistance="1.5k" footprint={SMD} />
    {[0, 1, 2, 3, 4].map((s) => <capacitor key={s} name={`C${6 + s}`} capacitance="10uF" footprint={SMD} />)}
    {/* The difference amplifier and the output. */}
    <resistor name="R18" resistance="10k" footprint={SMD} />
    <resistor name="R19" resistance="470k" footprint={SMD} />
    <resistor name="R20" resistance="10k" footprint={SMD} />
    <resistor name="R21" resistance="470k" footprint={SMD} />
    <resistor name="R22" resistance="1k" footprint={SMD} />
    <resistor name="R23" resistance="10k" footprint={SMD} />
    <resistor name="R24" resistance="33k" footprint={SMD} />
  </>,
  traces: <>{wires([
    // The CV summer and the divider onto the reference's base.
    ["R1 > .pin1", "net.FREQ_W"], ["R1 > .pin2", "net.ESUM"],
    ["R2 > .pin1", "net.CV_W"], ["R2 > .pin2", "net.ESUM"],
    ["R3 > .pin1", "net.N_EXP"], ["R3 > .pin2", "net.ESUM"],
    ["U1 > .INNA", "net.ESUM"], ["U1 > .INPA", "net.GND"], ["U1 > .OUTA", "net.N_EXP"],
    ["R4 > .pin1", "net.N_EXP"], ["R4 > .pin2", "net.BX"], ["R5 > .pin1", "net.BX"], ["R5 > .pin2", "net.GND"],
    // The converter: Q1 held at 12 V / R6 by U1B; Q2 sinks the tail.
    ["R6 > .pin1", "net.V12"], ["R6 > .pin2", "net.REF"],
    ["Q1 > .base", "net.BX"], ["Q1 > .collector", "net.REF"], ["Q1 > .emitter", "net.E"],
    ["U1 > .INNB", "net.REF"], ["U1 > .INPB", "net.GND"], ["U1 > .OUTB", "net.SERVO"],
    ["C1 > .pin1", "net.SERVO"], ["C1 > .pin2", "net.REF"], ["R7 > .pin1", "net.SERVO"], ["R7 > .pin2", "net.E"],
    ["Q2 > .base", "net.GND"], ["Q2 > .collector", "net.TAIL"], ["Q2 > .emitter", "net.E"],
    // The drive pair: In on Q3, Res on Q4, both on the string's bottom tap through 220R.
    ["R8 > .pin1", "net.IN"], ["R8 > .pin2", "net.INB"], ["R9 > .pin1", "net.INB"], ["R9 > .pin2", "net.B0"],
    ["R10 > .pin1", "net.OUT_I"], ["R10 > .pin2", "net.FB1"], ["R11 > .pin1", "net.FBB"], ["R11 > .pin2", "net.B0"],
    ["Q3 > .base", "net.INB"], ["Q3 > .collector", "net.CL1"], ["Q3 > .emitter", "net.TAIL"],
    ["Q4 > .base", "net.FBB"], ["Q4 > .collector", "net.CR1"], ["Q4 > .emitter", "net.TAIL"],
    // The stages.
    ...STAGES.flatMap((s): [string, string][] => {
      const up = s === 4 ? ["net.V12", "net.V12"] : [`net.CL${s + 1}`, `net.CR${s + 1}`], l = `Q${3 + 2 * s}`, r = `Q${4 + 2 * s}`;
      return [
        [`${l} > .base`, `net.B${s}`], [`${l} > .emitter`, `net.CL${s}`], [`${l} > .collector`, up[0]],
        [`${r} > .base`, `net.B${s}`], [`${r} > .emitter`, `net.CR${s}`], [`${r} > .collector`, up[1]],
        [`C${s + 1} > .pin1`, `net.CL${s}`], [`C${s + 1} > .pin2`, `net.CR${s}`],
      ];
    }),
    // The bias string, a capacitor on each tap.
    ["R12 > .pin1", "net.V12"], ["R12 > .pin2", "net.B4"],
    ["R13 > .pin1", "net.B4"], ["R13 > .pin2", "net.B3"],
    ["R14 > .pin1", "net.B3"], ["R14 > .pin2", "net.B2"],
    ["R15 > .pin1", "net.B2"], ["R15 > .pin2", "net.B1"],
    ["R16 > .pin1", "net.B1"], ["R16 > .pin2", "net.B0"],
    ["R17 > .pin1", "net.B0"], ["R17 > .pin2", "net.GND"],
    ...[0, 1, 2, 3, 4].flatMap((s): [string, string][] => [[`C${6 + s} > .pin1`, `net.B${s}`], [`C${6 + s} > .pin2`, "net.GND"]]),
    // The followers on the top capacitor and the difference amplifier.
    ["U1 > .INPC", "net.CL4"], ["U1 > .INNC", "net.BL"], ["U1 > .OUTC", "net.BL"],
    ["U1 > .INPD", "net.CR4"], ["U1 > .INND", "net.BR"], ["U1 > .OUTD", "net.BR"],
    ["R18 > .pin1", "net.BL"], ["R18 > .pin2", "net.DM"], ["R19 > .pin1", "net.DM"], ["R19 > .pin2", "net.OUT_I"],
    ["R20 > .pin1", "net.BR"], ["R20 > .pin2", "net.DP"], ["R21 > .pin1", "net.DP"], ["R21 > .pin2", "net.GND"],
    ["U2 > .INNA", "net.DM"], ["U2 > .INPA", "net.DP"], ["U2 > .OUTA", "net.OUT_I"],
    // U2B lifts it out of the loop to Eurorack's level: 1 + R24/R23.
    ["U2 > .INPB", "net.OUT_I"], ["U2 > .INNB", "net.GSET"], ["U2 > .OUTB", "net.OUT_B"],
    ["R23 > .pin1", "net.GSET"], ["R23 > .pin2", "net.GND"], ["R24 > .pin1", "net.GSET"], ["R24 > .pin2", "net.OUT_B"],
    ["R22 > .pin1", "net.OUT_B"], ["R22 > .pin2", "net.OUT"],
  ])}</>,
});
