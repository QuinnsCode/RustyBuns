// What to put in a cart for each part on a kit's board (#5689): a maker and its part number (MPN), which every
// shop (LCSC, Mouser, DigiKey, Tayda) searches by. `bom.csv` from scripts/pcb.ts says a value and a footprint
// ("100k", res0805); this turns that into one orderable part. A row nothing here knows gets none, and the parts list
// says so, rather than a guess. Pure: the sheet (sheet.ts), the zip (kit.ts) and the tests read it.
import type { BomRow } from "./kit.ts";

export interface Source { maker: string; mpn: string; what: string }

/** A value as Yageo writes it in a part number: 4.7k is 4K7, 220 is 220R, 1.8M is 1M8. */
export function ohmsCode(value: string): string | null {
  const m = /^(\d+)(?:\.(\d+))?([kKM]?)$/.exec(value.trim());
  if (!m) return null;
  const [, whole, frac, unit] = m, u = unit.toUpperCase() || "R";
  return frac ? `${whole}${u}${frac}` : `${whole}${u}`;
}

/** Samsung's ceramics by value and size: 0805 X7R 50 V, 0805 X5R 25 V for 10 µF, C0G where the board asks for it. */
const CERAMIC: Record<string, Source> = {
  "100n cap0805": { maker: "Samsung", mpn: "CL21B104KBCNNNC", what: "100 nF X7R 50 V 0805" },
  "10n cap0805": { maker: "Samsung", mpn: "CL21B103KBANNNC", what: "10 nF X7R 50 V 0805" },
  "10u cap0805": { maker: "Samsung", mpn: "CL21A106KAYNNNE", what: "10 µF X5R 25 V 0805" },
  "100p C0G cap0805": { maker: "Samsung", mpn: "CL21C101JBANNNC", what: "100 pF C0G 50 V 0805" },
  "100p cap0805": { maker: "Samsung", mpn: "CL21C101JBANNNC", what: "100 pF C0G 50 V 0805" },
  "1n C0G cap0805": { maker: "Samsung", mpn: "CL21C102JBANNNC", what: "1 nF C0G 50 V 0805" },
  "10n C0G cap0805": { maker: "Samsung", mpn: "CL21C103JBFNNNE", what: "10 nF C0G 50 V 0805" },
  "1u X7R 25 V cap1206": { maker: "Samsung", mpn: "CL31B105KAHNNNE", what: "1 µF X7R 25 V 1206" },
  "10u X7R 25 V cap1206": { maker: "Samsung", mpn: "CL31B106KAHNNNE", what: "10 µF X7R 25 V 1206" },
};

/** Chips, transistors, diodes and the hand-soldered parts, by what the board names them. */
const NAMED: [RegExp, Source][] = [
  [/^TL072$/, { maker: "Texas Instruments", mpn: "TL072CDR", what: "dual op-amp, SOIC-8" }],
  [/^TL074$/, { maker: "Texas Instruments", mpn: "TL074CDR", what: "quad op-amp, SOIC-14" }],
  [/^LM13700$/, { maker: "Texas Instruments", mpn: "LM13700MX/NOPB", what: "dual OTA, SOIC-16" }],
  [/^NE555$/, { maker: "Texas Instruments", mpn: "NE555DR", what: "timer, SOIC-8" }],
  [/^CD4017$/, { maker: "Texas Instruments", mpn: "CD4017BM96", what: "decade counter, SOIC-16" }],
  [/^MMBT3904/, { maker: "onsemi", mpn: "MMBT3904LT1G", what: "NPN transistor, SOT-23" }],
  [/^MMBT3906/, { maker: "onsemi", mpn: "MMBT3906LT1G", what: "PNP transistor, SOT-23" }],
  [/^MMBFJ201$/, { maker: "onsemi", mpn: "MMBFJ201", what: "N-JFET, SOT-23" }],
  [/^MMBFJ111$/, { maker: "onsemi", mpn: "MMBFJ111", what: "N-JFET, SOT-23" }],
  [/^SS14$/, { maker: "onsemi", mpn: "SS14", what: "Schottky 1 A 40 V, SMA" }],
  [/^B5819W$/, { maker: "Diodes Inc.", mpn: "B5819W-7-F", what: "Schottky 1 A 40 V, SOD-123" }],
  [/^1N4148W$/, { maker: "Diodes Inc.", mpn: "1N4148W-7-F", what: "signal diode, SOD-123" }],
  [/^PJ398SM$/, { maker: "Thonk", mpn: "PJ398SM", what: "3.5 mm mono jack (Thonkiconn), through-hole" }],
  [/^2x5 shrouded header$/, { maker: "Würth", mpn: "61201021621", what: "2×5 shrouded header 2.54 mm, Eurorack power" }],
  [/^3362P 1k trimmer$/, { maker: "Bourns", mpn: "3362P-1-102LF", what: "1 k trimmer" }],
];

/** A pot's Comment as wall-kit.tsx writes it: `Alpha RD901F 100k B`. */
const POT = /^Alpha RD901F (\d+(?:\.\d+)?[kM]?) ([ABC])$/;

/** What to order for one row of `bom.csv`, or null when nothing here knows the part. */
export function sourceOf(r: BomRow): Source | null {
  const ref = r.Designator.replace(/\d.*$/, ""), fp = r.Footprint.trim();
  if (ref === "R" && fp === "res0805") {
    const code = ohmsCode(r.Value);
    if (!code) return null;
    const precise = r.Comment === "0.1%";
    return precise
      ? { maker: "Yageo", mpn: `RT0805BRD07${code}L`, what: `${r.Value} 0.1% thin film 0805` }
      : { maker: "Yageo", mpn: `RC0805FR-07${code}L`, what: `${r.Value} 1% 0805` };
  }
  if (ref.startsWith("C") && fp.startsWith("cap")) {
    const extra = r.Comment && r.Comment !== r.Value ? ` ${r.Comment}` : "";
    return CERAMIC[`${r.Value}${extra} ${fp}`] ?? null;
  }
  const pot = POT.exec(r.Comment);
  if (pot) {
    const [, v, taper] = pot;
    return { maker: "Alpha", mpn: `RD901F-40-15R1-${taper}${v.toUpperCase()}-00DL1`, what: `9 mm vertical pot ${v} ${taper === "B" ? "linear" : taper === "A" ? "audio" : "reverse audio"}` };
  }
  return NAMED.find(([re]) => re.test(r.Comment))?.[1] ?? null;
}
