// What every Q pedal board has around its circuit (ANALOG.md section 8): the
// 9 V supply with its reverse-polarity diode, the 4.5 V bias, the input
// pull-down, the output cap and Level pot, the LED, and wire pads for the jacks,
// the DC jack and the 3PDT true-bypass footswitch. A pedal file (q-drive.tsx,
// q-fuzz.tsx, q-dist.tsx) brings its signal parts and traces, from the net IN to
// the net TONE, and its Drive pot RV1's value; this wraps them in a board.
//
// The box's parts take the first free numbers after the pedal's own, so the
// pedal keeps the names the app's sockets use (D1, C4, ...). The order the
// parts and traces go in is the order tscircuit packs and routes them.
import { Children, type ReactElement, type ReactNode } from "react";

/** Lead pitch for resistors, film caps and diodes (0.4 in), and the hole for a socket pin. */
export const AXIAL = "axial_p10.16mm";
export const SOCKET = "axial_p10.16mm_id1.1mm_od2mm";
export const FILM = "radial_p5mm";
/** A film cap in socket holes, for a swappable tone cap. */
export const FILM_SOCKET = "radial_p5mm_id1.1mm_od2mm";
export const ELECTROLYTIC = "electrolytic_p2.5mm";
/** A 16 mm board-mount pot: three legs in a row, 5 mm apart. */
const POT = "pinrow3_p5mm_id1.3mm_od2.3mm";

export interface Pedal {
  /** The signal parts, as one fragment. */
  parts: ReactElement<{ children?: ReactNode }>;
  /** The signal traces, IN to TONE, as one fragment. RV1 is the Drive pot. */
  traces: ReactElement;
  /** The Drive pot: its full value and the part to order. */
  drive: { ohms: string; part: string };
  /** The Level pot (default 100k, audio taper). Bigger loads a high-impedance tone node less. */
  level?: { ohms: string; part: string };
  /** Board size in mm (default 58 × 68, inside a 125B box). */
  size?: [number, number];
  /** Space the packer leaves between parts, mm (default 1.5). */
  gap?: number;
}

export function qBox(p: Pedal) {
  const used = new Set<string>(["RV1"]);
  for (const c of Children.toArray(p.parts.props.children)) {
    const name = (c as ReactElement<{ name?: string }>).props?.name;
    if (name) used.add(name);
  }
  const next = (prefix: string) => {
    for (let n = 1; ; n++) if (!used.has(prefix + n)) { used.add(prefix + n); return prefix + n; }
  };
  const OUT_CAP = next("C"), BULK = next("C"), BIAS_CAP = next("C"), DECOUPLE = next("C");
  const BIAS_HI = next("R"), BIAS_LO = next("R"), PULLDOWN = next("R"), LED_R = next("R");
  const LEVEL = next("RV"), SUPPLY = next("D");
  const level = p.level ?? { ohms: "100k", part: "Alpha 16mm 100k A" };
  const [w, h] = p.size ?? [58, 68];
  const pin = (name: string, label: string) => `.${name} > .${label}`;
  return (
    <board width={`${w}mm`} height={`${h}mm`} pcbPack pcbPackGap={`${p.gap ?? 1.5}mm`}>
      {p.parts}
      <capacitor name={OUT_CAP} capacitance="1uF" footprint={FILM} />

      {/* Knobs on the top edge: their legs place the holes in the drill template. */}
      <potentiometer name="RV1" maxResistance={p.drive.ohms} pinVariant="three_pin" manufacturerPartNumber={p.drive.part} footprint={POT} pcbX={-12} pcbY={29} />
      <potentiometer name={LEVEL} maxResistance={level.ohms} pinVariant="three_pin" manufacturerPartNumber={level.part} footprint={POT} pcbX={12} pcbY={29} />

      {/* Power: 9 V centre-negative, a series diode so a wrong adapter does nothing. */}
      <diode name={SUPPLY} manufacturerPartNumber="1N5817" footprint={AXIAL} />
      <capacitor name={BULK} capacitance="100uF" polarized footprint={ELECTROLYTIC} />
      <capacitor name={DECOUPLE} capacitance="100nF" footprint={FILM} />
      <resistor name={BIAS_HI} resistance="10k" footprint={AXIAL} />
      <resistor name={BIAS_LO} resistance="10k" footprint={AXIAL} />
      <capacitor name={BIAS_CAP} capacitance="22uF" polarized footprint={ELECTROLYTIC} />
      <resistor name={PULLDOWN} resistance="1M" footprint={AXIAL} />
      <resistor name={LED_R} resistance="4.7k" footprint={AXIAL} />
      <chip name="LED1" manufacturerPartNumber="5mm red LED" footprint="pinrow2" pcbX={0} pcbY={29}
        pinLabels={{ pin1: "A", pin2: "K" }} />

      {/* Wire pads: input and output jacks, DC jack, footswitch. */}
      <chip name="J1" footprint="pinrow2" pcbX={26} pcbY={10} pcbRotation={90} pinLabels={{ pin1: "TIP", pin2: "SLEEVE" }} />
      <chip name="J2" footprint="pinrow2" pcbX={-26} pcbY={10} pcbRotation={90} pinLabels={{ pin1: "TIP", pin2: "SLEEVE" }} />
      <chip name="J3" footprint="pinrow2" pcbX={-24} pcbY={29} pinLabels={{ pin1: "POS", pin2: "NEG" }} />
      <chip name="J4" footprint="pinrow9" pcbX={0} pcbY={-(h / 2 - 3)} manufacturerPartNumber="3PDT footswitch"
        pinLabels={{ pin1: "A1", pin2: "A2", pin3: "A3", pin4: "B1", pin5: "B2", pin6: "B3", pin7: "C1", pin8: "C2", pin9: "C3" }} />

      {p.traces}
      <trace from={pin(OUT_CAP, "pin1")} to="net.TONE" />
      <trace from={pin(OUT_CAP, "pin2")} to={pin(LEVEL, "pin3")} />
      <trace from={pin(LEVEL, "pin2")} to="net.OUT" />
      <trace from={pin(LEVEL, "pin1")} to="net.GND" />

      <trace from=".J3 > .POS" to={pin(SUPPLY, "anode")} />
      <trace from={pin(SUPPLY, "cathode")} to="net.V9" />
      <trace from=".J3 > .NEG" to="net.GND" />
      <trace from={pin(BULK, "pin1")} to="net.V9" />
      <trace from={pin(BULK, "pin2")} to="net.GND" />
      <trace from={pin(DECOUPLE, "pin1")} to="net.V9" />
      <trace from={pin(DECOUPLE, "pin2")} to="net.GND" />
      <trace from={pin(BIAS_HI, "pin1")} to="net.V9" />
      <trace from={pin(BIAS_HI, "pin2")} to="net.VREF" />
      <trace from={pin(BIAS_LO, "pin1")} to="net.VREF" />
      <trace from={pin(BIAS_LO, "pin2")} to="net.GND" />
      <trace from={pin(BIAS_CAP, "pin1")} to="net.VREF" />
      <trace from={pin(BIAS_CAP, "pin2")} to="net.GND" />
      <trace from=".U1 > .VPOS" to="net.V9" />
      <trace from=".U1 > .VNEG" to="net.GND" />
      <trace from={pin(PULLDOWN, "pin1")} to="net.IN" />
      <trace from={pin(PULLDOWN, "pin2")} to="net.GND" />
      <trace from={pin(LED_R, "pin1")} to="net.V9" />
      <trace from={pin(LED_R, "pin2")} to=".LED1 > .A" />

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
}
