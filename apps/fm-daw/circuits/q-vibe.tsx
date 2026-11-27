// Q Vibe as a real 9 V pedal board: the four-stage photocell vibe (vibe.tsx) inside
// the box every Q pedal shares (q-box.tsx), with the lamp and its LFO, which the sim
// plays off the board, on it. Two TL074s hold the sim's six op-amps and the LFO's
// two: U1 A to D are the sim's U1 (the input inverter) and U2 to U4 (the first three
// phase stages), U2 A and B its U5 (the fourth) and U6 (the dry and wet mix), U2 C
// and D the LFO.
//
// What the sim hears: R1 to R13, C1 to C4, LDR1 to LDR4 and the six op-amps. C5
// brings the guitar to the 4.5 V bias, and on 9 V the op-amps' + inputs sit at the
// bias (VREF) instead of ground; to the signal the two are the same node.
//
// What the sim moves by hand (its "lamp" `Mod`, 0.5 to 9.5 Hz on the Speed knob) is
// on this board: q-box.tsx's `lfo`, RV1 the Speed pot, about 0.35 to 10 Hz, and Q1
// following the triangle sinks the lamp's current through R18, about 3 to 8 mA. The
// lamp is LED2, a warm-white 5 mm LED: stand it in the middle of the four LDRs and
// cover all five with one light-tight cap (black heat-shrink or a film can). An LED
// heats no slower than it cools, so the lean the sim's lamp has comes from the LDRs'
// own slow recovery here.
//
// Sockets: the op-amps U1 and U2.
import { Fragment } from "react";
import { AXIAL_SHORT, FILM_SHORT, QUAD, amp, lfo, qBox } from "./q-box.tsx";

/** The sim's op-amps U1 to U6, by where they sit on the two TL074s. */
const OP = [amp("U1", "A"), amp("U1", "B"), amp("U1", "C"), amp("U1", "D"), amp("U2", "A"), amp("U2", "B")];
const CAPS = ["15nF", "220nF", "470nF", "4.7nF"];
const LFO = lfo({
  int: amp("U2", "C"), cmp: amp("U2", "D"),
  cap: ["C6", "1uF"], stop: ["R14", "33k"], ra: ["R15", "33k"], rb: ["R16", "47k"], resistor: AXIAL_SHORT, film: FILM_SHORT,
});

export default qBox({
  drive: { ohms: "1M", part: "Alpha 16mm 1M A" },
  opamps: ["U1", "U2"],
  film: FILM_SHORT,
  gap: 0.3,
  parts: <>
    <capacitor name="C5" capacitance="1uF" footprint={FILM_SHORT} />
    <chip name="U1" manufacturerPartNumber="TL074" footprint="dip14" pinLabels={QUAD} />
    <chip name="U2" manufacturerPartNumber="TL074" footprint="dip14" pinLabels={QUAD} />
    <resistor name="R1" resistance="10k" footprint={AXIAL_SHORT} />
    <resistor name="R2" resistance="10k" footprint={AXIAL_SHORT} />
    {CAPS.map((cap, k) => (
      <Fragment key={k}>
        <resistor name={`R${2 * k + 3}`} resistance="10k" footprint={AXIAL_SHORT} />
        <resistor name={`R${2 * k + 4}`} resistance="10k" footprint={AXIAL_SHORT} />
        <chip name={`LDR${k + 1}`} manufacturerPartNumber="GL5528 LDR" footprint="pinrow2" pinLabels={{ pin1: "LDR1", pin2: "LDR2" }} />
        <capacitor name={`C${k + 1}`} capacitance={cap} footprint={FILM_SHORT} />
      </Fragment>
    ))}
    <resistor name="R11" resistance="10k" footprint={AXIAL_SHORT} />
    <resistor name="R12" resistance="10k" footprint={AXIAL_SHORT} />
    <resistor name="R13" resistance="10k" footprint={AXIAL_SHORT} />
    {LFO.parts}
    <resistor name="R17" resistance="10k" footprint={AXIAL_SHORT} />
    <transistor name="Q1" type="npn" manufacturerPartNumber="2N3904" footprint="to92" />
    <resistor name="R18" resistance="680" footprint={AXIAL_SHORT} />
    <chip name="LED2" manufacturerPartNumber="5mm warm-white LED" footprint="pinrow2" pinLabels={{ pin1: "A", pin2: "K" }} />
  </>,
  traces: <>
    <trace from=".C5 > .pin1" to="net.IN" />
    <trace from=".C5 > .pin2" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to={OP[0]!.INN} />
    <trace from=".R2 > .pin1" to={OP[0]!.OUT} />
    <trace from=".R2 > .pin2" to={OP[0]!.INN} />
    <trace from={OP[0]!.INP} to="net.VREF" />
    <trace from={OP[0]!.OUT} to="net.S0" />

    {CAPS.map((_, k) => {
      const i = k + 1, from = i === 1 ? "net.S0" : `net.AP${i - 1}`, op = OP[i]!;
      return (
        <Fragment key={k}>
          <trace from={`.R${2 * i + 1} > .pin1`} to={from} />
          <trace from={`.R${2 * i + 1} > .pin2`} to={op.INN} />
          <trace from={`.R${2 * i + 2} > .pin1`} to={`net.AP${i}`} />
          <trace from={`.R${2 * i + 2} > .pin2`} to={op.INN} />
          <trace from={op.OUT} to={`net.AP${i}`} />
          <trace from={`.LDR${i} > .LDR1`} to={from} />
          <trace from={`.LDR${i} > .LDR2`} to={op.INP} />
          <trace from={`.C${i} > .pin1`} to={op.INP} />
          <trace from={`.C${i} > .pin2`} to="net.GND" />
        </Fragment>
      );
    })}

    <trace from=".R11 > .pin1" to="net.S0" />
    <trace from=".R11 > .pin2" to={OP[5]!.INN} />
    <trace from=".R12 > .pin1" to="net.AP4" />
    <trace from=".R12 > .pin2" to={OP[5]!.INN} />
    <trace from=".R13 > .pin1" to="net.TONE" />
    <trace from=".R13 > .pin2" to={OP[5]!.INN} />
    <trace from={OP[5]!.INP} to="net.VREF" />
    <trace from={OP[5]!.OUT} to="net.TONE" />

    {LFO.traces}
    <trace from=".R17 > .pin1" to="net.LFO" />
    <trace from=".R17 > .pin2" to=".Q1 > .base" />
    <trace from=".Q1 > .emitter" to=".R18 > .pin1" />
    <trace from=".R18 > .pin2" to="net.GND" />
    <trace from=".Q1 > .collector" to=".LED2 > .K" />
    <trace from=".LED2 > .A" to="net.V9" />
  </>,
});
