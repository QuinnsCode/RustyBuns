// Q Phase: four all-pass stages, each flat in level with its phase turning through
// 180° around 1/(2πRC), where R is a JFET's channel (Q1 to Q4, drain to source) and
// C the cap from the stage's + input to ground. All four gates sit on GATE, where an
// LFO (off this board) sweeps them. U1 sums the guitar (inverted) with some of the
// last stage (R16, the regen), U6 mixes dry and wet: where they cancel, two notches.
// The op-amps never clip. Read with `moved` (Q1 to Q4 on control "gate", 40k to 2.5k).
const OPAMP = { pin1: "OUT", pin2: "VNEG", pin3: "INP", pin4: "INN", pin5: "VPOS" } as const;
const STAGES = [1, 2, 3, 4];

export default () => (
  <board width="44mm" height="34mm">
    <chip name="U1" footprint="sot23_5" pinLabels={OPAMP} />
    <resistor name="R1" resistance="10k" footprint="0603" />
    <resistor name="R2" resistance="10k" footprint="0603" />
    <trace from=".R1 > .pin1" to="net.IN" />
    <trace from=".R1 > .pin2" to=".U1 > .INN" />
    <trace from=".R2 > .pin1" to=".U1 > .OUT" />
    <trace from=".R2 > .pin2" to=".U1 > .INN" />
    <trace from=".U1 > .INP" to="net.GND" />
    <trace from=".U1 > .OUT" to="net.S0" />

    {STAGES.map((i) => {
      const from = i === 1 ? "net.S0" : `net.AP${i - 1}`;
      return (
        <group name={`stage${i}`} key={i}>
          <chip name={`U${i + 1}`} footprint="sot23_5" pinLabels={OPAMP} />
          <resistor name={`R${2 * i + 1}`} resistance="10k" footprint="0603" />
          <resistor name={`R${2 * i + 2}`} resistance="10k" footprint="0603" />
          <chip name={`Q${i}`} footprint="sot23" pinLabels={{ pin1: "DRAIN", pin2: "GATE", pin3: "SOURCE" }} />
          <capacitor name={`C${i}`} capacitance="47nF" footprint="0603" />
          <trace from={`.R${2 * i + 1} > .pin1`} to={from} />
          <trace from={`.R${2 * i + 1} > .pin2`} to={`.U${i + 1} > .INN`} />
          <trace from={`.R${2 * i + 2} > .pin1`} to={`net.AP${i}`} />
          <trace from={`.R${2 * i + 2} > .pin2`} to={`.U${i + 1} > .INN`} />
          <trace from={`.U${i + 1} > .OUT`} to={`net.AP${i}`} />
          <trace from={`.Q${i} > .DRAIN`} to={from} />
          <trace from={`.Q${i} > .SOURCE`} to={`.U${i + 1} > .INP`} />
          <trace from={`.Q${i} > .GATE`} to="net.GATE" />
          <trace from={`.C${i} > .pin1`} to={`.U${i + 1} > .INP`} />
          <trace from={`.C${i} > .pin2`} to="net.GND" />
        </group>
      );
    })}

    <resistor name="R16" resistance={10e3 / 0.45} footprint="0603" />
    <trace from=".R16 > .pin1" to="net.AP4" />
    <trace from=".R16 > .pin2" to=".U1 > .INN" />

    <chip name="U6" footprint="sot23_5" pinLabels={OPAMP} />
    <resistor name="R17" resistance="10k" footprint="0603" />
    <resistor name="R18" resistance="10k" footprint="0603" />
    <resistor name="R19" resistance="10k" footprint="0603" />
    <trace from=".R17 > .pin1" to="net.S0" />
    <trace from=".R17 > .pin2" to=".U6 > .INN" />
    <trace from=".R18 > .pin1" to="net.AP4" />
    <trace from=".R18 > .pin2" to=".U6 > .INN" />
    <trace from=".R19 > .pin1" to="net.OUT" />
    <trace from=".R19 > .pin2" to=".U6 > .INN" />
    <trace from=".U6 > .INP" to="net.GND" />
    <trace from=".U6 > .OUT" to="net.OUT" />
  </board>
);
