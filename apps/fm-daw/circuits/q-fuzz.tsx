// Q Fuzz as a real 9 V pedal board: the `fuzz()` voicing (fuzz.tsx) inside the
// box every Q pedal shares (q-box.tsx). An op-amp at up to ×2000, its feedback
// diodes rounding the wave off, then two diodes squaring what's left.
//
// What the sim hears: C1, R1 (the 1M that hisses), U1, R2, C2, R5 + RV1 (the
// sim board's Drive resistor: 20k plus a 2M audio-taper pot, whose turn comes
// out near the square the app uses), C3, D1, D2, R3, D3, D4, R4, C4. On 9 V the
// op-amp's output sits at the 4.5 V bias, so D3 and D4 clip to the bias (VREF)
// instead of ground; to the signal the two are the same node.
//
// Sockets: both clipper pairs (D1/D2, D3/D4), the tone cap C4 and the op-amp U1.
import { AXIAL, ELECTROLYTIC, FILM, FILM_SOCKET, SOCKET, qBox } from "./q-box.tsx";

export default qBox({
  drive: { ohms: "2M", part: "16mm 2M A" },
  level: { ohms: "500k", part: "Alpha 16mm 500k A" },
  parts: <>
    <capacitor name="C1" capacitance="100nF" footprint={FILM} />
    <resistor name="R1" resistance="1M" footprint={AXIAL} />
    <chip name="U1" manufacturerPartNumber="TL071" footprint="dip8"
      pinLabels={{ pin1: "NULL1", pin2: "INN", pin3: "INP", pin4: "VNEG", pin5: "NULL2", pin6: "OUT", pin7: "VPOS", pin8: "NC" }} />
    <resistor name="R2" resistance="1k" footprint={AXIAL} />
    <capacitor name="C2" capacitance="10uF" polarized footprint={ELECTROLYTIC} />
    <resistor name="R5" resistance="20k" footprint={AXIAL} />
    <capacitor name="C3" capacitance="22pF" footprint={FILM} />
    <diode name="D1" footprint={SOCKET} />
    <diode name="D2" footprint={SOCKET} />
    <resistor name="R3" resistance="2.2k" footprint={AXIAL} />
    <diode name="D3" footprint={SOCKET} />
    <diode name="D4" footprint={SOCKET} />
    <resistor name="R4" resistance="4.7k" footprint={AXIAL} />
    <capacitor name="C4" capacitance="15nF" footprint={FILM_SOCKET} />
  </>,
  traces: <>
    <trace from=".C1 > .pin1" to="net.IN" />
    <trace from=".C1 > .pin2" to=".U1 > .INP" />
    <trace from=".R1 > .pin1" to=".U1 > .INP" />
    <trace from=".R1 > .pin2" to="net.VREF" />
    <trace from=".R2 > .pin1" to=".U1 > .INN" />
    <trace from=".R2 > .pin2" to=".C2 > .pin1" />
    <trace from=".C2 > .pin2" to="net.GND" />
    <trace from=".R5 > .pin1" to=".U1 > .OUT" />
    <trace from=".R5 > .pin2" to=".RV1 > .pin1" />
    <trace from=".RV1 > .pin2" to=".U1 > .INN" />
    <trace from=".RV1 > .pin3" to=".U1 > .INN" />
    <trace from=".C3 > .pin1" to=".U1 > .OUT" />
    <trace from=".C3 > .pin2" to=".U1 > .INN" />
    <trace from=".D1 > .anode" to=".U1 > .OUT" />
    <trace from=".D1 > .cathode" to=".U1 > .INN" />
    <trace from=".D2 > .anode" to=".U1 > .INN" />
    <trace from=".D2 > .cathode" to=".U1 > .OUT" />
    <trace from=".R3 > .pin1" to=".U1 > .OUT" />
    <trace from=".R3 > .pin2" to=".D3 > .anode" />
    <trace from=".D3 > .cathode" to="net.VREF" />
    <trace from=".D4 > .anode" to="net.VREF" />
    <trace from=".D4 > .cathode" to=".R3 > .pin2" />
    <trace from=".R4 > .pin1" to=".R3 > .pin2" />
    <trace from=".R4 > .pin2" to="net.TONE" />
    <trace from=".C4 > .pin1" to="net.TONE" />
    <trace from=".C4 > .pin2" to="net.GND" />
  </>,
});
