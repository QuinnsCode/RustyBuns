// A cable's two ends, as real connectors (@rustybuns/util/connectors). A power cable has a wall plug at one end and an
// IEC socket at the other; a mic cable an XLR female (it goes onto an output's pins) and an XLR male (it goes into an
// input). So those two only go one way round: the `a` end (the one that comes off the roll first) goes into the
// output, the `b` end into the input. A snake goes the same one way: its multipin female off the stage box, the male
// into the fan. Speaker, instrument and deck leads have the same connector at both ends, so either end fits either jack.
// A run in a level's road case can bring other ends than its family's (`ends`): an NL8 for a four-way box, a TRUE1 cord
// for a box with powerCON, a speakON-to-jack lead.
// Plain data, no three.js: cables.ts and the feel room check with it, ends-view.ts draws it.
import { CONNECTORS, type End } from "@rustybuns/util/connectors";

/** Every connector a cable's end can be: its real type and gender, and what the HUD calls it. */
const END = {
  edison: { type: "edison", gender: "male", name: "wall plug" },
  iec: { type: "iec", gender: "female", name: "IEC socket" },
  "powercon-true1": { type: "powercon-true1", gender: "female", name: "powerCON TRUE1" },
  "xlr-f": { type: "xlr3", gender: "female", name: "XLR female" },
  "xlr-m": { type: "xlr3", gender: "male", name: "XLR male" },
  speakon: { type: "nl4", gender: "none", name: "speakON" },
  nl8: { type: "nl8", gender: "none", name: "speakON NL8" },
  ep6: { type: "ep6", gender: "male", name: "EP-6" },
  ts: { type: "ts", gender: "male", name: "quarter-inch jack" },
  rca: { type: "rca", gender: "male", name: "RCA plug" },
  spade: { type: "spade", gender: "none", name: "spade lug" },
  coax: { type: "coax", gender: "male", name: "coax plug" },
  "multipin-f": { type: "multipin", gender: "female", name: "multipin female" },
  "multipin-m": { type: "multipin", gender: "male", name: "multipin male" },
} as const satisfies Record<string, End & { name: string }>;

/** The connector on a cable's end. */
export type Connector = keyof typeof END;
/** A cable's two ends: `a` (off the roll first) and `b`. */
export type Ends = readonly [Connector, Connector];

/** A cable family: the game's kinds (@rustybuns/gear) and the feel room's roll kinds (a cord is a short power cable). */
type Family = "power" | "cord" | "speaker" | "xlr" | "instrument" | "rca" | "ground" | "digital" | "multi";

/** Each family's `a` end and `b` end. */
const ENDS: Record<Family, Ends> = {
  power: ["edison", "iec"], cord: ["edison", "iec"], xlr: ["xlr-f", "xlr-m"],
  speaker: ["speakon", "speakon"], instrument: ["ts", "ts"], rca: ["rca", "rca"], ground: ["spade", "spade"], digital: ["coax", "coax"], multi: ["multipin-f", "multipin-m"],
};

/** What a connector is called, for the HUD and the hints. */
export const connectorName = (c: Connector): string => END[c].name;

/** The real connector (type and gender) a cable end is. */
export const realEnd = (c: Connector): End => ({ type: END[c].type, gender: END[c].gender });
/** How many amp channels a speaker connector carries: a pair of pins each. */
export const pairsOf = (c: Connector) => CONNECTORS[END[c].type].pins.length / 2;

/** A cable's ends: its own (a level's road case can give a run other ends) or its family's. */
export const endsOf = (run: { kind: Family; ends?: Ends }): Ends => run.ends ?? ENDS[run.kind];
/** The connector on `end` of a cable. */
export const endOf = (run: { kind: Family; ends?: Ends }, end: "a" | "b"): Connector => endsOf(run)[end === "a" ? 0 : 1];
/** The connector on `end` of a family's usual cable (the feel room's rolls). */
export const familyEnd = (kind: Family, end: "a" | "b"): Connector => ENDS[kind][end === "a" ? 0 : 1];

/** Which way a jack faces: an output (`xlr-out-2`, a wall's `power-out-1`) or an input (`power-in`, `xlr-in-1`). */
export const sideOf = (jack: string): "in" | "out" => (/-out(-\d+)?$/.test(jack) ? "out" : "in");

/** Whether `end` of a cable goes into a jack on that `side`, and if not, why (the jack's kind already fits). */
export function endWhy(run: { kind: Family; ends?: Ends }, end: "a" | "b", side: "in" | "out"): string | null {
  const ends = endsOf(run), have = ends[end === "a" ? 0 : 1], want = ends[side === "out" ? 0 : 1];
  if (have === want) return null;
  return `that's the ${connectorName(have)} end: it goes in ${side === "out" ? "an input" : "an output"}, the ${connectorName(want)} end goes here`;
}
