// Q Trem as a real 9 V pedal board: the optical tremolo (trem.tsx) inside the box
// every Q pedal shares (q-box.tsx), with the LFO the sim plays off the board on it.
// R1 in series and a vactrol's LDR (U2) to the bias make the divider; U1 buffers it.
//
// What the sim hears: R1, U2's LDR, U1. C1 and R2 bring the guitar to the 4.5 V
// bias (the sim's input sits at its ground), and on 9 V the LDR goes to the bias
// (VREF) instead of ground; to the signal the two are the same node.
//
// What the sim moves by hand (its "led" `Mod`, 1 to 12 Hz on the Rate knob) is on
// this board: U3 is a triangle LFO (q-box.tsx's `lfo`, RV1 the Rate pot, about 0.7 to
// 13 Hz), and Q1 follows the triangle and sinks the vactrol LED's current through R7,
// about 2 to 6 mA. The LDR's slow recovery is the soft back on each dip.
//
// Sockets: the op-amps U1 and U3. The vactrol is one part to order (an LED and an LDR
// sealed together, 4 legs); two bare parts taped in heat-shrink do too.
import { AXIAL, DUAL, FILM, SINGLE, amp, lfo, qBox } from "./q-box.tsx";

const BUFFER = amp("U1"), LFO = lfo({
  int: amp("U3", "A"), cmp: amp("U3", "B"),
  cap: ["C2", "1uF"], stop: ["R3", "27k"], ra: ["R4", "33k"], rb: ["R5", "47k"],
});

export default qBox({
  drive: { ohms: "500k", part: "Alpha 16mm 500k A" },
  opamps: ["U1", "U3"],
  parts: <>
    <capacitor name="C1" capacitance="1uF" footprint={FILM} />
    <resistor name="R1" resistance="4.7k" footprint={AXIAL} />
    <chip name="U2" manufacturerPartNumber="NSL-32SR3 vactrol" footprint="dip4"
      pinLabels={{ pin1: "LEDA", pin2: "LEDK", pin3: "LDR1", pin4: "LDR2" }} />
    <resistor name="R2" resistance="1M" footprint={AXIAL} />
    <chip name="U1" manufacturerPartNumber="TL071" footprint="dip8" pinLabels={SINGLE} />
    <chip name="U3" manufacturerPartNumber="TL072" footprint="dip8" pinLabels={DUAL} />
    {LFO.parts}
    <resistor name="R6" resistance="10k" footprint={AXIAL} />
    <transistor name="Q1" type="npn" manufacturerPartNumber="2N3904" footprint="to92" />
    <resistor name="R7" resistance="1k" footprint={AXIAL} />
  </>,
  traces: <>
    <trace from=".C1 > .pin1" to="net.IN" />
    <trace from=".C1 > .pin2" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to={BUFFER.INP} />
    <trace from=".U2 > .LDR1" to={BUFFER.INP} />
    <trace from=".U2 > .LDR2" to="net.VREF" />
    <trace from=".R2 > .pin1" to={BUFFER.INP} />
    <trace from=".R2 > .pin2" to="net.VREF" />
    <trace from={BUFFER.INN} to="net.TONE" />
    <trace from={BUFFER.OUT} to="net.TONE" />

    {LFO.traces}
    <trace from=".R6 > .pin1" to="net.LFO" />
    <trace from=".R6 > .pin2" to=".Q1 > .base" />
    <trace from=".Q1 > .emitter" to=".R7 > .pin1" />
    <trace from=".R7 > .pin2" to="net.GND" />
    <trace from=".Q1 > .collector" to=".U2 > .LEDK" />
    <trace from=".U2 > .LEDA" to="net.V9" />
  </>,
});
