// Q Drive as a real 9 V pedal board: the `overdrive()` voicing in
// src/circuit/circuits.ts inside the box every Q pedal shares (q-box.tsx: supply,
// 4.5 V bias, Level, LED, jacks and footswitch). Through-hole parts so a kit can
// be soldered by hand.
//
// What the sim hears (the same parts as `overdrive()`): C1, R1, U1, R2, C2, R3,
// RV1 (Drive), C3, D1, D2, R4, C4. The sim board's 301k is R3 (51k) plus RV1
// (500k) at Drive 5.
//
// Sockets (`SOCKET` holes, sized for machined-pin socket strips): the clipping
// diodes D1 and D2, the tone cap C4 and the op-amp U1, the parts the app lets
// you swap. `bun scripts/pcb.ts q-drive` renders it in a scratch folder.
import { AXIAL, FILM, FILM_SOCKET, SOCKET, qBox } from "./q-box.tsx";

export default qBox({
  drive: { ohms: "500k", part: "Alpha 16mm 500k B" },
  parts: <>
    <capacitor name="C1" capacitance="1uF" footprint={FILM} />
    <resistor name="R1" resistance="510k" footprint={AXIAL} />
    <chip name="U1" manufacturerPartNumber="TL071" footprint="dip8"
      pinLabels={{ pin1: "NULL1", pin2: "INN", pin3: "INP", pin4: "VNEG", pin5: "NULL2", pin6: "OUT", pin7: "VPOS", pin8: "NC" }} />
    <resistor name="R2" resistance="4.7k" footprint={AXIAL} />
    <capacitor name="C2" capacitance="47nF" footprint={FILM} />
    <resistor name="R3" resistance="51k" footprint={AXIAL} />
    <capacitor name="C3" capacitance="51pF" footprint={FILM} />
    <diode name="D1" footprint={SOCKET} />
    <diode name="D2" footprint={SOCKET} />
    <resistor name="R4" resistance="1k" footprint={AXIAL} />
    <capacitor name="C4" capacitance="220nF" footprint={FILM_SOCKET} />
  </>,
  traces: <>
    <trace from=".C1 > .pin1" to="net.IN" />
    <trace from=".C1 > .pin2" to=".U1 > .INP" />
    <trace from=".R1 > .pin1" to=".U1 > .INP" />
    <trace from=".R1 > .pin2" to="net.VREF" />
    <trace from=".R2 > .pin1" to=".U1 > .INN" />
    <trace from=".R2 > .pin2" to=".C2 > .pin1" />
    <trace from=".C2 > .pin2" to="net.GND" />
    <trace from=".R3 > .pin1" to=".U1 > .OUT" />
    <trace from=".R3 > .pin2" to=".RV1 > .pin1" />
    <trace from=".RV1 > .pin2" to=".U1 > .INN" />
    <trace from=".RV1 > .pin3" to=".U1 > .INN" />
    <trace from=".C3 > .pin1" to=".U1 > .OUT" />
    <trace from=".C3 > .pin2" to=".U1 > .INN" />
    <trace from=".D1 > .anode" to=".U1 > .OUT" />
    <trace from=".D1 > .cathode" to=".U1 > .INN" />
    <trace from=".D2 > .anode" to=".U1 > .INN" />
    <trace from=".D2 > .cathode" to=".U1 > .OUT" />
    <trace from=".R4 > .pin1" to=".U1 > .OUT" />
    <trace from=".R4 > .pin2" to="net.TONE" />
    <trace from=".C4 > .pin1" to="net.TONE" />
    <trace from=".C4 > .pin2" to="net.GND" />
  </>,
});
