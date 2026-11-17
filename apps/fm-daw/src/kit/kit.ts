// A pedal's build kit: what `scripts/pcb.ts` writes to `circuits/<kit>/` (Gerbers, `bom.csv`, `pnp.csv`, `pcb.svg`,
// `drill.svg`), read into a parts list with the player's part swaps in it, a short build sheet in plain words, and
// one zip of the lot. No DOM and no Vite here: the page (sheet.ts) and the tests hand in the kit's files as text.
import { check, obj, str, type Of } from "@rustybuns/util/guard";
import { CLIPPERS, capValue, CAP_STEPS, farads, sockets, type BoardId, type Swaps } from "../circuit/circuits.ts";
import { zip } from "./zip.ts";

/** The files a kit folder holds, by their path in it: `bom.csv`, `pnp.csv`, `pcb.svg`, `drill.svg`, `gerbers/<layer>`. */
export type KitFiles = Record<string, string>;

/** A pedal's kit folder: its name, slugged ("Q Drive" → `q-drive`), the way `scripts/pcb.ts` names it. */
export const kitId = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** A kit is whole when it has every file a board house and a builder need. */
export const KIT_NEEDS = ["bom.csv", "pnp.csv", "pcb.svg", "drill.svg"] as const;
export const isKit = (f: KitFiles): boolean => KIT_NEEDS.every((n) => n in f) && gerbers(f).length > 0;
/** The Gerber and drill layers, by file name. */
export const gerbers = (f: KitFiles): string[] => Object.keys(f).filter((p) => p.startsWith("gerbers/")).map((p) => p.slice(8)).sort();

// ---- the BOM ----

/** A `bom.csv` row as `scripts/pcb.ts` writes it. */
export const BomRow = obj({ Designator: str(16), Comment: str(80, { min: 0 }), Value: str(40, { min: 0 }), Footprint: str(80, { min: 0 }) });
export type BomRow = Of<typeof BomRow>;

/** CSV text as rows of cells: quoted cells, doubled quotes inside them, commas and CRLF. */
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

/** `bom.csv`'s rows, each read through `BomRow`; a row that doesn't fit is left out. */
export function readBom(text: string): BomRow[] {
  const [head, ...rows] = csvRows(text);
  if (!head) return [];
  return rows.flatMap((cells) => {
    const r = check(BomRow, Object.fromEntries(head.map((k, i) => [k, cells[i] ?? ""])));
    return r ? [r] : [];
  });
}

/** One part on the board: what to buy for it, and whether it sits in a socket. */
export interface Part { ref: string; part: string; value: string; footprint: string; socketed: boolean; swapped: boolean }

/** What each clipper choice is as a part you can buy. */
const DIODE: Record<keyof typeof CLIPPERS, string> = { silicon: "1N4148", germanium: "1N34A", led: "3 mm red LED", mosfet: "BS170 wired as a diode", none: "none: leave the socket empty" };

const kindOf = (ref: string, footprint: string): string => {
  const p = ref.replace(/\d+$/, "");
  if (p === "R") return "Resistor";
  if (p === "RV") return "Pot";
  if (p === "C") return footprint.startsWith("electrolytic") ? "Electrolytic capacitor" : "Film capacitor";
  if (p === "D") return "Diode";
  if (p === "LED") return "LED";
  if (p === "U") return "Op-amp";
  if (p === "J") return "Wire pads";
  return "Part";
};

/**
 * The kit's parts with the player's swaps on `board` (Q Amp's `Swaps`): a swapped diode pair or capacitor carries
 * the part they picked and is marked socketed and swapped. Parts on socket holes and the op-amp are socketed too.
 */
export function partsOf(rows: BomRow[], board: BoardId | undefined, swaps: Swaps = {}): Part[] {
  const socks = board ? sockets(board) : [];
  return rows.map((r) => {
    const s = socks.find((x) => x.parts.includes(r.Designator));
    const choice = s ? swaps[s.id] : undefined;
    let value = r.Value || r.Comment, swapped = false;
    if (s?.kind === "clipper") {
      const c = choice !== undefined && Object.hasOwn(CLIPPERS, choice) ? (choice as keyof typeof CLIPPERS) : "silicon";
      value = DIODE[c]; swapped = c !== "silicon";
    } else if (s?.kind === "cap" && choice !== undefined && choice !== "1" && CAP_STEPS.some((x) => x === choice)) {
      value = farads(capValue(s.farads, Number(choice))).replace("F", ""); swapped = true;
    }
    // A pot or an op-amp names itself in Comment ("TL071", "16mm 500k B"); a jack's pads say what goes on them.
    const part = r.Designator.startsWith("J") ? (r.Comment || "Wire pads") : kindOf(r.Designator, r.Footprint);
    if (r.Designator.startsWith("J") || r.Designator.startsWith("U") || r.Designator.startsWith("RV") || r.Designator.startsWith("LED")) value = r.Comment || value;
    // Socket holes are sized for machined-pin strips (`_id1.1mm`, `SOCKET` in circuits/q-drive.tsx); an op-amp sits in a DIP socket.
    return { ref: r.Designator, part, value, footprint: r.Footprint, socketed: swapped || r.Footprint.includes("_id1.1mm") || r.Designator.startsWith("U"), swapped };
  });
}

/** One line of the parts table: the same part and value, counted, with the places it goes. */
export interface BomLine { part: string; value: string; count: number; footprint: string; refs: string[]; socketed: boolean; swapped: boolean }

const ORDER = ["Resistor", "Film capacitor", "Electrolytic capacitor", "Diode", "LED", "Op-amp", "Pot"];
const rank = (p: string) => { const i = ORDER.indexOf(p); return i < 0 ? ORDER.length : i; };

/** The parts as a shopping list, grouped by part, value and footprint, in solder order. */
export function bomLines(parts: Part[]): BomLine[] {
  const lines = new Map<string, BomLine>();
  for (const p of parts) {
    const key = [p.part, p.value, p.footprint, p.socketed, p.swapped].join("|");
    const l = lines.get(key);
    if (l) { l.count++; l.refs.push(p.ref); }
    else lines.set(key, { part: p.part, value: p.value, count: 1, footprint: p.footprint, refs: [p.ref], socketed: p.socketed, swapped: p.swapped });
  }
  return [...lines.values()].sort((a, b) => rank(a.part) - rank(b.part));
}

const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
/** The parts as `bom.csv` for the zip: one row per place on the board, with a Socketed column. */
export const bomCsv = (parts: Part[]): string =>
  [["Designator", "Part", "Value", "Footprint", "Socketed"], ...parts.map((p) => [p.ref, p.part, p.value, p.footprint, p.socketed ? (p.swapped ? "yes, your swap" : "yes") : ""])]
    .map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";

// ---- the build sheet ----

/** A short build sheet in plain words: what the pedal is, its parts, then drill and solder order. */
export function buildSheet(name: string, blurb: string, lines: BomLine[]): string {
  const swaps = lines.filter((l) => l.swapped);
  const out = [
    `${name}: build sheet`,
    "",
    blurb,
    "",
    "What is in this zip",
    "- gerbers/: the board files. Send this folder, zipped, to a board house.",
    "- bom.csv: the parts list. pnp.csv: where each part sits, for a house that solders for you.",
    "- drill.svg: the drill template for the box. Print it at 100%; its scale line is 50 mm.",
    "- pcb.svg and schematic.svg: the board and the circuit, to check against while you build.",
    "",
    "Parts",
    ...lines.map((l) => `- ${l.count} x ${l.part}${l.value ? ` ${l.value}` : ""} (${l.refs.join(", ")})${l.socketed ? (l.swapped ? ", in a socket: your swap" : ", in a socket") : ""}`),
    "",
  ];
  if (swaps.length) out.push("Your swaps", "These parts are the ones you picked in Q Amp. They go in sockets, so you can change them back.", ...swaps.map((l) => `- ${l.refs.join(", ")}: ${l.value}`), "");
  out.push(
    "Drill the box",
    "1. Tape drill.svg to the box. Check the 50 mm line with a ruler.",
    "2. Punch each hole centre, then drill small first and step up to the size marked.",
    "3. Clean the edges and test that the jacks, pots and footswitch fit before you solder.",
    "",
    "Solder the board, lowest parts first",
    "1. Resistors. Bend the legs, push them through, solder, cut the legs.",
    "2. Sockets: the diode, capacitor and op-amp sockets. Do not solder the parts that go in them.",
    "3. Film capacitors, then electrolytic capacitors. The long leg of an electrolytic goes in the + hole.",
    "4. The supply diode. The band on it matches the band on the board.",
    "5. Pots, then wires to the jacks, the DC jack, the LED and the footswitch.",
    "6. Push the op-amp and the socketed parts in last. The op-amp's notch matches the notch on the board.",
    "",
    "Before you plug in",
    "- Look for solder bridges between pads. Check each electrolytic and diode is the right way round.",
    "- Use a 9 V centre-negative supply. Plug in a guitar and amp and turn the amp down first.",
  );
  return out.join("\n") + "\n";
}

/** What a build sheet shows for one pedal: its kit (or that it has none yet), parts with the player's swaps, layers. */
export interface Sheet { pedal: string; name: string; kit: string; made: boolean; parts: Part[]; lines: BomLine[]; layers: string[]; text: string }

/** The pedal's sheet from its kit folder's files (empty when the folder isn't there) and the player's swaps. */
export function sheetOf(pedal: { id: string; name: string; blurb: string; board?: BoardId }, kit: KitFiles, swaps: Swaps = {}): Sheet {
  const made = isKit(kit), parts = made ? partsOf(readBom(kit["bom.csv"]!), pedal.board, swaps) : [], lines = bomLines(parts);
  return { pedal: pedal.id, name: pedal.name, kit: kitId(pedal.name), made, parts, lines, layers: gerbers(kit), text: buildSheet(pedal.name, pedal.blurb, lines) };
}

/** Everything that goes in the zip, by path inside it. Without a whole kit, only the drawings and the sheet. */
export function kitZip(kit: KitFiles, sheet: string, schematic: string, parts: Part[]): Uint8Array<ArrayBuffer> {
  const files: Record<string, string> = {};
  for (const g of gerbers(kit)) files[`gerbers/${g}`] = kit[`gerbers/${g}`]!;
  files["bom.csv"] = bomCsv(parts);
  for (const n of ["pnp.csv", "drill.svg", "pcb.svg"]) if (kit[n] !== undefined) files[n] = kit[n];
  if (schematic) files["schematic.svg"] = schematic;
  files["build-sheet.txt"] = sheet;
  return zip(files);
}
