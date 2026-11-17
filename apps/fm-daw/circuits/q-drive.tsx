// Q Drive as a real 9 V pedal board: the `overdrive()` voicing in
// src/circuit/circuits.ts, plus everything a box on the floor needs. Through-hole
// parts so a kit can be soldered by hand.
//
// What the sim hears (the same parts as `overdrive()`): C1, R1, U1, R2, C2, R3,
// RV1 (Drive), C3, D1, D2, R4, C4. What only the box needs: the 4.5 V bias
// (R5, R6, C7), the supply (D3 reverse-polarity diode, C6 and C8), the input
// pull-down R7, the output cap C5 and RV2 (Level), the LED and its R8, and wire
// pads for the jacks (J1, J2), the DC jack (J3) and the 3PDT footswitch (J4).
//
// Sockets (`SOCKET` holes, sized for machined-pin socket strips): the clipping
// diodes D1 and D2, the tone cap C4 and the op-amp U1, the parts the app lets
// you swap.
//
// tscircuit is parked in this repo (it pins zod 3, see apps/tscircuit-desktop),
// so `bun scripts/pcb.ts` renders it in a scratch folder outside the workspace.
// Only the knobs, the LED and the wire pads are placed by hand; the rest is
// packed and autorouted.

/** Lead pitch for resistors, film caps and diodes (0.4 in), and the hole for a socket pin. */
const AXIAL = "axial_p10.16mm";
const SOCKET = "axial_p10.16mm_id1.1mm_od2mm";
const FILM = "radial_p5mm";
/** A 16 mm board-mount pot: three legs in a row, 5 mm apart. */
const POT = "pinrow3_p5mm_id1.3mm_od2.3mm";

export default (
  <board width="58mm" height="68mm" pcbPack pcbPackGap="1.5mm">
    {/* Signal: the overdrive voicing. */}
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
    <capacitor name="C4" capacitance="220nF" footprint="radial_p5mm_id1.1mm_od2mm" />
    <capacitor name="C5" capacitance="1uF" footprint={FILM} />

    {/* Knobs on the top edge: their legs place the holes in the drill template. */}
    <potentiometer name="RV1" maxResistance="500k" pinVariant="three_pin" manufacturerPartNumber="Alpha 16mm 500k B" footprint={POT} pcbX={-12} pcbY={29} />
    <potentiometer name="RV2" maxResistance="100k" pinVariant="three_pin" manufacturerPartNumber="Alpha 16mm 100k A" footprint={POT} pcbX={12} pcbY={29} />

    {/* Power: 9 V centre-negative, a series diode so a wrong adapter does nothing. */}
    <diode name="D3" manufacturerPartNumber="1N5817" footprint={AXIAL} />
    <capacitor name="C6" capacitance="100uF" polarized footprint="electrolytic_p2.5mm" />
    <capacitor name="C8" capacitance="100nF" footprint={FILM} />
    <resistor name="R5" resistance="10k" footprint={AXIAL} />
    <resistor name="R6" resistance="10k" footprint={AXIAL} />
    <capacitor name="C7" capacitance="22uF" polarized footprint="electrolytic_p2.5mm" />
    <resistor name="R7" resistance="1M" footprint={AXIAL} />
    <resistor name="R8" resistance="4.7k" footprint={AXIAL} />
    <chip name="LED1" manufacturerPartNumber="5mm red LED" footprint="pinrow2" pcbX={0} pcbY={29}
      pinLabels={{ pin1: "A", pin2: "K" }} />

    {/* Wire pads: input and output jacks, DC jack, footswitch. */}
    <chip name="J1" footprint="pinrow2" pcbX={26} pcbY={10} pcbRotation={90} pinLabels={{ pin1: "TIP", pin2: "SLEEVE" }} />
    <chip name="J2" footprint="pinrow2" pcbX={-26} pcbY={10} pcbRotation={90} pinLabels={{ pin1: "TIP", pin2: "SLEEVE" }} />
    <chip name="J3" footprint="pinrow2" pcbX={-24} pcbY={29} pinLabels={{ pin1: "POS", pin2: "NEG" }} />
    <chip name="J4" footprint="pinrow9" pcbX={0} pcbY={-31} manufacturerPartNumber="3PDT footswitch"
      pinLabels={{ pin1: "A1", pin2: "A2", pin3: "A3", pin4: "B1", pin5: "B2", pin6: "B3", pin7: "C1", pin8: "C2", pin9: "C3" }} />

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
    <trace from=".C5 > .pin1" to="net.TONE" />
    <trace from=".C5 > .pin2" to=".RV2 > .pin3" />
    <trace from=".RV2 > .pin2" to="net.OUT" />
    <trace from=".RV2 > .pin1" to="net.GND" />

    <trace from=".J3 > .POS" to=".D3 > .anode" />
    <trace from=".D3 > .cathode" to="net.V9" />
    <trace from=".J3 > .NEG" to="net.GND" />
    <trace from=".C6 > .pin1" to="net.V9" />
    <trace from=".C6 > .pin2" to="net.GND" />
    <trace from=".C8 > .pin1" to="net.V9" />
    <trace from=".C8 > .pin2" to="net.GND" />
    <trace from=".R5 > .pin1" to="net.V9" />
    <trace from=".R5 > .pin2" to="net.VREF" />
    <trace from=".R6 > .pin1" to="net.VREF" />
    <trace from=".R6 > .pin2" to="net.GND" />
    <trace from=".C7 > .pin1" to="net.VREF" />
    <trace from=".C7 > .pin2" to="net.GND" />
    <trace from=".U1 > .VPOS" to="net.V9" />
    <trace from=".U1 > .VNEG" to="net.GND" />
    <trace from=".R7 > .pin1" to="net.IN" />
    <trace from=".R7 > .pin2" to="net.GND" />
    <trace from=".R8 > .pin1" to="net.V9" />
    <trace from=".R8 > .pin2" to=".LED1 > .A" />

    {/* True bypass: A switches the input, B the output, C grounds the LED when on. */}
    <trace from=".J1 > .TIP" to=".J4 > .A2" />
    <trace from=".J4 > .A3" to="net.IN" />
    <trace from=".J4 > .A1" to=".J4 > .B1" />
    <trace from=".J2 > .TIP" to=".J4 > .B2" />
    <trace from=".J4 > .B3" to="net.OUT" />
    <trace from=".J4 > .C2" to=".LED1 > .K" />
    <trace from=".J4 > .C3" to="net.GND" />
    <trace from=".J1 > .SLEEVE" to="net.GND" />
    <trace from=".J2 > .SLEEVE" to="net.GND" />
  </board>
);
