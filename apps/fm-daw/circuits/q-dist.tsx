// Q Dist as a real 9 V pedal board: the `hardClip()` voicing (dist.tsx) inside
// the box every Q pedal shares (q-box.tsx). Op-amp gain, then two silicon diodes
// that flatten the tops, then a one-pole tone.
//
// What the sim hears: C1, R1, U1, R2, C2, R3 + RV1 (the sim board's one Drive
// resistor: 10k plus a 200k pot), R4, D1, D2, R5, C3. On 9 V the op-amp's
// output sits at the 4.5 V bias, so the diodes clip to the bias (VREF) instead
// of ground; to the signal the two are the same node. The 500k Level loads the
// 10k tone node less than a 100k would.
//
// Sockets: the clipping diodes D1 and D2, the tone cap C3 and the op-amp U1.
import { AXIAL, ELECTROLYTIC, FILM, FILM_SOCKET, SOCKET, qBox } from "./q-box.tsx";

export default qBox({
  drive: { ohms: "200k", part: "Alpha 16mm 200k B" },
  level: { ohms: "500k", part: "Alpha 16mm 500k A" },
  gap: 1.2,
  parts: <>
    <capacitor name="C1" capacitance="100nF" footprint={FILM} />
    <resistor name="R1" resistance="1M" footprint={AXIAL} />
    <chip name="U1" manufacturerPartNumber="TL071" footprint="dip8"
      pinLabels={{ pin1: "NULL1", pin2: "INN", pin3: "INP", pin4: "VNEG", pin5: "NULL2", pin6: "OUT", pin7: "VPOS", pin8: "NC" }} />
    <resistor name="R2" resistance="1k" footprint={AXIAL} />
    <capacitor name="C2" capacitance="4.7uF" polarized footprint={ELECTROLYTIC} />
    <resistor name="R3" resistance="10k" footprint={AXIAL} />
    <resistor name="R4" resistance="1k" footprint={AXIAL} />
    <diode name="D1" footprint={SOCKET} />
    <diode name="D2" footprint={SOCKET} />
    <resistor name="R5" resistance="10k" footprint={AXIAL} />
    <capacitor name="C3" capacitance="10nF" footprint={FILM_SOCKET} />
  </>,
  traces: <>
    <trace from=".C1 > .pin1" to="net.IN" />
    <trace from=".C1 > .pin2" to=".U1 > .INP" />
    <trace from=".R1 > .pin1" to=".U1 > .INP" />
    <trace from=".R1 > .pin2" to="net.VREF" />
    <trace from=".R3 > .pin1" to=".U1 > .OUT" />
    <trace from=".R3 > .pin2" to=".RV1 > .pin1" />
    <trace from=".RV1 > .pin2" to=".U1 > .INN" />
    <trace from=".RV1 > .pin3" to=".U1 > .INN" />
    <trace from=".R2 > .pin1" to=".U1 > .INN" />
    <trace from=".R2 > .pin2" to=".C2 > .pin1" />
    <trace from=".C2 > .pin2" to="net.GND" />
    <trace from=".R4 > .pin1" to=".U1 > .OUT" />
    <trace from=".R4 > .pin2" to=".D1 > .anode" />
    <trace from=".D1 > .cathode" to="net.VREF" />
    <trace from=".D2 > .anode" to="net.VREF" />
    <trace from=".D2 > .cathode" to=".R4 > .pin2" />
    <trace from=".R5 > .pin1" to=".R4 > .pin2" />
    <trace from=".R5 > .pin2" to="net.TONE" />
    <trace from=".C3 > .pin1" to="net.TONE" />
    <trace from=".C3 > .pin2" to="net.GND" />
  </>,
});
