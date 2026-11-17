// Q Vibe: four phase-shift stages like Q Phase's, each with its own cap (C1 to C4:
// 15n, 220n, 470n, 4.7n), their resistances four photocells (LDR1 to LDR4) under
// one lamp. The lamp and its driver are off this board; the lamp heats faster than
// it cools, so the sweep lingers at the dark end. U1 inverts the guitar in, U6 mixes
// dry and wet. Read with `moved` (LDR1 to LDR4 on control "lamp", 250k to 4k).
const OPAMP = { pin1: "OUT", pin2: "VNEG", pin3: "INP", pin4: "INN", pin5: "VPOS" } as const;
const CAPS = ["15nF", "220nF", "470nF", "4.7nF"];

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

    {CAPS.map((cap, k) => {
      const i = k + 1, from = i === 1 ? "net.S0" : `net.AP${i - 1}`;
      return (
        <group name={`stage${i}`} key={i}>
          <chip name={`U${i + 1}`} footprint="sot23_5" pinLabels={OPAMP} />
          <resistor name={`R${2 * i + 1}`} resistance="10k" footprint="0603" />
          <resistor name={`R${2 * i + 2}`} resistance="10k" footprint="0603" />
          <chip name={`LDR${i}`} footprint="pinrow2" pinLabels={{ pin1: "LDR1", pin2: "LDR2" }} />
          <capacitor name={`C${i}`} capacitance={cap} footprint="0603" />
          <trace from={`.R${2 * i + 1} > .pin1`} to={from} />
          <trace from={`.R${2 * i + 1} > .pin2`} to={`.U${i + 1} > .INN`} />
          <trace from={`.R${2 * i + 2} > .pin1`} to={`net.AP${i}`} />
          <trace from={`.R${2 * i + 2} > .pin2`} to={`.U${i + 1} > .INN`} />
          <trace from={`.U${i + 1} > .OUT`} to={`net.AP${i}`} />
          <trace from={`.LDR${i} > .LDR1`} to={from} />
          <trace from={`.LDR${i} > .LDR2`} to={`.U${i + 1} > .INP`} />
          <trace from={`.C${i} > .pin1`} to={`.U${i + 1} > .INP`} />
          <trace from={`.C${i} > .pin2`} to="net.GND" />
        </group>
      );
    })}

    <chip name="U6" footprint="sot23_5" pinLabels={OPAMP} />
    <resistor name="R11" resistance="10k" footprint="0603" />
    <resistor name="R12" resistance="10k" footprint="0603" />
    <resistor name="R13" resistance="10k" footprint="0603" />
    <trace from=".R11 > .pin1" to="net.S0" />
    <trace from=".R11 > .pin2" to=".U6 > .INN" />
    <trace from=".R12 > .pin1" to="net.AP4" />
    <trace from=".R12 > .pin2" to=".U6 > .INN" />
    <trace from=".R13 > .pin1" to="net.OUT" />
    <trace from=".R13 > .pin2" to=".U6 > .INN" />
    <trace from=".U6 > .INP" to="net.GND" />
    <trace from=".U6 > .OUT" to="net.OUT" />
  </board>
);
