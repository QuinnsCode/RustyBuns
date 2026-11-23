// What every sound wall module's board has around its circuit (WALL.md): the Eurorack ±12 V power header with a
// Schottky in series on each rail (a ribbon on backwards does nothing), the rails' bulk caps, a 100 nF on each
// rail of every chip, and the panel's jacks and pots where circuits/wall-panels.ts puts them. A module file
// (wall-vco.tsx, ...) brings its own parts and traces; the panel parts are J1.. and RV1.. on the panel's nets,
// named after the jack or knob: a jack's tip is net.VOCT, a pot's wiper net.TUNE_W and its ends the nets it names.
//
// Footprints: the 3.5 mm jack is the Thonkiconn-style PJ398SM (WQP518MA), the pot an Alpha RD901F 9 mm vertical,
// both drawn from KiCad's library (Connector_Audio and Potentiometer_THT), turned so the pot's legs point down.
// Small parts are surface mount (0805, SOIC, SOT-23), for a fab to assemble; the panel parts are through-hole,
// soldered by hand once the panel is on. Units are mm, y up, from the middle of the board.
import type { ReactElement, ReactNode } from "react";
import { BOARD_H, boardWidth, type Panel } from "./wall-panels.ts";

export const SMD = "0805";
/** A pot's taper as its part number has it. */
const TAPER = { lin: "B", log: "A", rlog: "C" };

/** The PJ398SM's three pads around its bushing: sleeve (S) above, the switch (TN) and the tip (T) below. */
const JACK = (
  <footprint>
    <platedhole shape="circle" holeDiameter="1.22mm" outerDiameter="1.93mm" pcbX="0mm" pcbY="6.48mm" portHints={["pin1"]} />
    <platedhole shape="circle" holeDiameter="1.43mm" outerDiameter="2.13mm" pcbX="0mm" pcbY="-4.92mm" portHints={["pin2"]} />
    <platedhole shape="circle" holeDiameter="1.42mm" outerDiameter="2.13mm" pcbX="0mm" pcbY="3.38mm" portHints={["pin3"]} />
  </footprint>
);
/** The 9 mm pot about its shaft: legs 1, 2 (the wiper), 3 left to right 7.5 mm below it, a mounting tab either side. */
const POT = (
  <footprint>
    <platedhole shape="circle" holeDiameter="1mm" outerDiameter="1.8mm" pcbX="-2.5mm" pcbY="-7.5mm" portHints={["pin1"]} />
    <platedhole shape="circle" holeDiameter="1mm" outerDiameter="1.8mm" pcbX="0mm" pcbY="-7.5mm" portHints={["pin2"]} />
    <platedhole shape="circle" holeDiameter="1mm" outerDiameter="1.8mm" pcbX="2.5mm" pcbY="-7.5mm" portHints={["pin3"]} />
    <platedhole shape="circle" holeDiameter="1.8mm" outerDiameter="3.24mm" pcbX="-4.8mm" pcbY="0mm" />
    <platedhole shape="circle" holeDiameter="1.8mm" outerDiameter="3.24mm" pcbX="4.8mm" pcbY="0mm" />
  </footprint>
);

/** Pin labels by package. Every chip's supply pins are VPOS and VNEG; a 12 V-only chip's VNEG goes to ground. */
export const TL072 = { pin1: "OUTA", pin2: "INNA", pin3: "INPA", pin4: "VNEG", pin5: "INPB", pin6: "INNB", pin7: "OUTB", pin8: "VPOS" };
export const TL074 = { pin1: "OUTA", pin2: "INNA", pin3: "INPA", pin4: "VPOS", pin5: "INPB", pin6: "INNB", pin7: "OUTB", pin8: "OUTC", pin9: "INNC", pin10: "INPC", pin11: "VNEG", pin12: "INPD", pin13: "INND", pin14: "OUTD" };
export const LM13700 = { pin1: "IABCA", pin2: "DBIASA", pin3: "INPA", pin4: "INNA", pin5: "OUTA", pin6: "VNEG", pin7: "BINA", pin8: "BOUTA", pin9: "BOUTB", pin10: "BINB", pin11: "VPOS", pin12: "OUTB", pin13: "INNB", pin14: "INPB", pin15: "DBIASB", pin16: "IABCB" };
export const NE555 = { pin1: "VNEG", pin2: "TRIG", pin3: "Q", pin4: "RESET", pin5: "CTRL", pin6: "THRES", pin7: "DISCH", pin8: "VPOS" };
export const CD4017 = { pin1: "Q5", pin2: "Q1", pin3: "Q0", pin4: "Q2", pin5: "Q6", pin6: "Q7", pin7: "Q3", pin8: "VNEG", pin9: "Q8", pin10: "Q4", pin11: "Q9", pin12: "CO", pin13: "EN", pin14: "CLK", pin15: "RST", pin16: "VPOS" };
export const FOOTPRINT: Record<string, string> = { TL072: "soic8", TL074: "soic14", LM13700: "soic16", NE555: "soic8", CD4017: "soic16" };

/** A net's name from a jack's or knob's (`send-a` is SEND_A). */
export const netOf = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]+/g, "_");

export interface Module {
  panel: Panel;
  /** The module's own parts (not its jacks and pots), as one fragment. */
  parts: ReactElement<{ children?: ReactNode }>;
  /** Its traces, as one fragment. */
  traces: ReactElement;
  /**
   * Each pot by its knob's name: its value (the part is an Alpha 9 mm of the panel's taper) and the nets
   * its legs 1 and 3 go to ("" leaves a leg open, "W" ties it to the wiper: a pot as a variable resistor), and
   * the wiper's net when it isn't `<KNOB>_W` (a variable resistor straight into a summing node).
   */
  pots: Record<string, { ohms: string; ends: [string, string]; wiper?: string }>;
  /** The chips to decouple, and which run from 12 V and ground only. */
  chips: { name: string; single?: boolean }[];
  /** Space the packer leaves between parts, mm (default 0.6): another gap is another layout, if one won't route. */
  gap?: number;
}

/**
 * A module's board: its panel's jacks (tip on the jack's net, sleeve to ground, the switch on the net it is normalled
 * to) and pots (the wiper on `<KNOB>_W`, the ends where `pots` says), the power, and the module's own parts.
 */
export function wallBoard(m: Module) {
  const w = boardWidth(m.panel.hp), h = BOARD_H;
  const pin = (part: string, label: string) => `.${part} > .${label}`;
  return (
    <board width={`${w}mm`} height={`${h}mm`} pcbPack pcbPackGap={`${m.gap ?? 0.6}mm`}>
      {m.parts}

      {m.panel.jacks.map((j) => (
        <chip key={j.part} name={j.part} footprint={JACK} manufacturerPartNumber="PJ398SM" pcbX={j.x} pcbY={j.y}
          pinLabels={{ pin1: "S", pin2: "T", pin3: "TN" }} />
      ))}
      {m.panel.knobs.map((k) => {
        const v = m.pots[k.name];
        if (!v) throw new Error(`${m.panel.id}: no value for its ${k.name} pot`);
        return <potentiometer key={k.part} name={k.part} maxResistance={v.ohms} pinVariant="three_pin" footprint={POT} pcbX={k.x} pcbY={k.y}
          manufacturerPartNumber={`Alpha RD901F ${v.ohms} ${TAPER[k.taper]}`} />;
      })}

      {/*
        Eurorack power, 10 pins in five columns: the ribbon's red stripe column is -12 V, the middle three ground, the
        far one +12 V. tscircuit numbers a two-row header round its outline (1 and 2 down the first column, 3 to 6
        along one row, 7 to 10 back along the other), not as a ribbon does, so these labels follow its pads:
        column 1 is pins 1 and 2, column 5 is pins 6 and 7. scripts/pcb.ts checks it on every board.
      */}
      <chip name="JP1" footprint="pinrow10_rows2_p2.54mm" manufacturerPartNumber="2x5 shrouded header" pcbX={0} pcbY={-h / 2 + 4.5}
        pinLabels={{ pin1: "N1", pin2: "N2", pin3: "G1", pin4: "G2", pin5: "G3", pin6: "P1", pin7: "P2", pin8: "G4", pin9: "G5", pin10: "G6" }} />
      <silkscreentext text="-12V" pcbX={-10.5} pcbY={-h / 2 + 4.5} fontSize="1.2mm" />
      <diode name="DP1" footprint="sma" manufacturerPartNumber="SS14" />
      <diode name="DP2" footprint="sma" manufacturerPartNumber="SS14" />
      <capacitor name="CP1" capacitance="10uF" footprint={SMD} />
      <capacitor name="CP2" capacitance="10uF" footprint={SMD} />
      {m.chips.flatMap((c) => [
        <capacitor key={`${c.name}p`} name={`C${c.name}P`} capacitance="100nF" footprint={SMD} />,
        ...(c.single ? [] : [<capacitor key={`${c.name}n`} name={`C${c.name}N`} capacitance="100nF" footprint={SMD} />]),
      ])}

      {m.traces}
      {m.panel.jacks.flatMap((j) => [
        <trace key={`${j.part}t`} from={pin(j.part, "T")} to={`net.${netOf(j.name)}`} />,
        <trace key={`${j.part}s`} from={pin(j.part, "S")} to="net.GND" />,
        ...(j.normal ? [<trace key={`${j.part}n`} from={pin(j.part, "TN")} to={`net.${netOf(j.normal)}`} />] : []),
      ])}
      {m.panel.knobs.flatMap((k) => {
        const { ends: [a, b], wiper } = m.pots[k.name], w = `net.${wiper ?? `${netOf(k.name)}_W`}`;
        return [
          <trace key={`${k.part}2`} from={pin(k.part, "pin2")} to={w} />,
          ...(a ? [<trace key={`${k.part}1`} from={pin(k.part, "pin1")} to={a === "W" ? pin(k.part, "pin2") : `net.${a}`} />] : []),
          ...(b ? [<trace key={`${k.part}3`} from={pin(k.part, "pin3")} to={b === "W" ? pin(k.part, "pin2") : `net.${b}`} />] : []),
        ];
      })}

      <trace from=".JP1 > .N1" to=".JP1 > .N2" />
      <trace from=".JP1 > .P1" to=".JP1 > .P2" />
      {["G1", "G2", "G3", "G4", "G5", "G6"].map((g) => <trace key={g} from={pin("JP1", g)} to="net.GND" />)}
      <trace from=".JP1 > .P1" to=".DP1 > .anode" />
      <trace from=".DP1 > .cathode" to="net.V12" />
      <trace from=".DP2 > .cathode" to=".JP1 > .N1" />
      <trace from=".DP2 > .anode" to="net.VN12" />
      <trace from=".CP1 > .pin1" to="net.V12" />
      <trace from=".CP1 > .pin2" to="net.GND" />
      <trace from=".CP2 > .pin1" to="net.GND" />
      <trace from=".CP2 > .pin2" to="net.VN12" />
      {m.chips.flatMap((c) => [
        <trace key={`${c.name}vp`} from={pin(c.name, "VPOS")} to="net.V12" />,
        <trace key={`${c.name}vn`} from={pin(c.name, "VNEG")} to={c.single ? "net.GND" : "net.VN12"} />,
        <trace key={`${c.name}cp1`} from={pin(`C${c.name}P`, "pin1")} to="net.V12" />,
        <trace key={`${c.name}cp2`} from={pin(`C${c.name}P`, "pin2")} to="net.GND" />,
        ...(c.single ? [] : [
          <trace key={`${c.name}cn1`} from={pin(`C${c.name}N`, "pin1")} to="net.GND" />,
          <trace key={`${c.name}cn2`} from={pin(`C${c.name}N`, "pin2")} to="net.VN12" />,
        ]),
      ])}
    </board>
  );
}

/** A chip of a known package, by name. */
export function Chip({ name, part, ...rest }: { name: string; part: keyof typeof PINS } & Record<string, unknown>) {
  return <chip name={name} manufacturerPartNumber={part} footprint={FOOTPRINT[part]} pinLabels={PINS[part]} {...rest} />;
}
const PINS = { TL072, TL074, LM13700, NE555, CD4017 };

/** Shorthand for traces: `wire("U1 > .OUTA", "net.SAW")` reads as `<trace from=".U1 > .OUTA" to="net.SAW" />`. */
export function wires(pairs: [string, string][]) {
  return pairs.map(([a, b], i) => <trace key={i} from={a.startsWith("net.") ? a : `.${a}`} to={b.startsWith("net.") ? b : `.${b}`} />);
}
