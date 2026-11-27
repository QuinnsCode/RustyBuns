// Q Phase as a real 9 V pedal board: the four-stage phaser (phase.tsx) inside the
// box every Q pedal shares (q-box.tsx), with the LFO the sim plays off the board on
// it. Two TL074s hold the sim's six op-amps and the LFO's two: U1 A to D are the
// sim's U1 (the input sum) and U2 to U4 (the first three all-pass stages), U2 A and
// B its U5 (the fourth) and U6 (the dry and wet mix), U2 C and D the LFO.
//
// What the sim hears: R1 to R19, C1 to C4, Q1 to Q4 (JFETs, drain to source) and the
// six op-amps. R16, the regen, is the sim's 22.2k (a 22k is near enough). C5 brings
// the guitar to the 4.5 V bias, and on 9 V the op-amps' + inputs sit at the bias
// (VREF) instead of ground; to the signal the two are the same node.
//
// What the sim moves by hand (its "gate" `Mod`, 0.05 to 6 Hz on the Rate knob) is on
// this board: q-box.tsx's `lfo`, RV1 the Rate pot, about 0.08 to 6 Hz. R23 brings the
// triangle to the gates and R24 adds RT1's DC, so the trimmer sets where the sweep
// sits: JFETs pinch off at different voltages, so trim it by ear until the notches
// sweep the whole way. Match the four JFETs if you can (same pinch-off, within 0.1 V).
//
// Sockets: the op-amps U1 and U2.
import { Fragment } from "react";
import { AXIAL_SHORT, FILM_SHORT, QUAD, amp, lfo, qBox } from "./q-box.tsx";

/** The sim's op-amps U1 to U6, by where they sit on the two TL074s. */
const OP = [amp("U1", "A"), amp("U1", "B"), amp("U1", "C"), amp("U1", "D"), amp("U2", "A"), amp("U2", "B")];
const STAGES = [1, 2, 3, 4];
const LFO = lfo({
  int: amp("U2", "C"), cmp: amp("U2", "D"),
  cap: ["C6", "2.2uF"], stop: ["R20", "27k"], ra: ["R21", "33k"], rb: ["R22", "47k"], resistor: AXIAL_SHORT, film: FILM_SHORT,
});

export default qBox({
  drive: { ohms: "2M", part: "16mm 2M A" },
  opamps: ["U1", "U2"],
  film: FILM_SHORT,
  gap: 0.5,
  parts: <>
    <capacitor name="C5" capacitance="1uF" footprint={FILM_SHORT} />
    <chip name="U1" manufacturerPartNumber="TL074" footprint="dip14" pinLabels={QUAD} />
    <chip name="U2" manufacturerPartNumber="TL074" footprint="dip14" pinLabels={QUAD} />
    <resistor name="R1" resistance="10k" footprint={AXIAL_SHORT} />
    <resistor name="R2" resistance="10k" footprint={AXIAL_SHORT} />
    {STAGES.map((i) => (
      <Fragment key={i}>
        <resistor name={`R${2 * i + 1}`} resistance="10k" footprint={AXIAL_SHORT} />
        <resistor name={`R${2 * i + 2}`} resistance="10k" footprint={AXIAL_SHORT} />
        <chip name={`Q${i}`} manufacturerPartNumber="J201" footprint="to92" pinLabels={{ pin1: "DRAIN", pin2: "SOURCE", pin3: "GATE" }} />
        <capacitor name={`C${i}`} capacitance="47nF" footprint={FILM_SHORT} />
      </Fragment>
    ))}
    <resistor name="R16" resistance={10e3 / 0.45} footprint={AXIAL_SHORT} />
    <resistor name="R17" resistance="10k" footprint={AXIAL_SHORT} />
    <resistor name="R18" resistance="10k" footprint={AXIAL_SHORT} />
    <resistor name="R19" resistance="10k" footprint={AXIAL_SHORT} />
    {LFO.parts}
    <resistor name="R23" resistance="470k" footprint={AXIAL_SHORT} />
    <resistor name="R24" resistance="470k" footprint={AXIAL_SHORT} />
    <potentiometer name="RT1" maxResistance="100k" pinVariant="three_pin" manufacturerPartNumber="Bourns 3362P 100k" footprint="pinrow3" />
  </>,
  traces: <>
    <trace from=".C5 > .pin1" to="net.IN" />
    <trace from=".C5 > .pin2" to=".R1 > .pin1" />
    <trace from=".R1 > .pin2" to={OP[0]!.INN} />
    <trace from=".R2 > .pin1" to={OP[0]!.OUT} />
    <trace from=".R2 > .pin2" to={OP[0]!.INN} />
    <trace from={OP[0]!.INP} to="net.VREF" />
    <trace from={OP[0]!.OUT} to="net.S0" />

    {STAGES.map((i) => {
      const from = i === 1 ? "net.S0" : `net.AP${i - 1}`, op = OP[i]!;
      return (
        <Fragment key={i}>
          <trace from={`.R${2 * i + 1} > .pin1`} to={from} />
          <trace from={`.R${2 * i + 1} > .pin2`} to={op.INN} />
          <trace from={`.R${2 * i + 2} > .pin1`} to={`net.AP${i}`} />
          <trace from={`.R${2 * i + 2} > .pin2`} to={op.INN} />
          <trace from={op.OUT} to={`net.AP${i}`} />
          <trace from={`.Q${i} > .DRAIN`} to={from} />
          <trace from={`.Q${i} > .SOURCE`} to={op.INP} />
          <trace from={`.Q${i} > .GATE`} to="net.GATE" />
          <trace from={`.C${i} > .pin1`} to={op.INP} />
          <trace from={`.C${i} > .pin2`} to="net.GND" />
        </Fragment>
      );
    })}

    <trace from=".R16 > .pin1" to="net.AP4" />
    <trace from=".R16 > .pin2" to={OP[0]!.INN} />

    <trace from=".R17 > .pin1" to="net.S0" />
    <trace from=".R17 > .pin2" to={OP[5]!.INN} />
    <trace from=".R18 > .pin1" to="net.AP4" />
    <trace from=".R18 > .pin2" to={OP[5]!.INN} />
    <trace from=".R19 > .pin1" to="net.TONE" />
    <trace from=".R19 > .pin2" to={OP[5]!.INN} />
    <trace from={OP[5]!.INP} to="net.VREF" />
    <trace from={OP[5]!.OUT} to="net.TONE" />

    {LFO.traces}
    <trace from=".R23 > .pin1" to="net.LFO" />
    <trace from=".R23 > .pin2" to="net.GATE" />
    <trace from=".RT1 > .pin1" to="net.V9" />
    <trace from=".RT1 > .pin3" to="net.GND" />
    <trace from=".RT1 > .pin2" to=".R24 > .pin1" />
    <trace from=".R24 > .pin2" to="net.GATE" />
  </>,
});
