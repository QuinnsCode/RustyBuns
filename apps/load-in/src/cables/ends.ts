// A cable's two ends, as real connectors. A power cable has a wall plug at one end and an IEC socket at the other; a
// mic cable an XLR female (it goes onto an output's pins) and an XLR male (it goes into an input). So those two only go
// one way round: the `a` end (the one that comes off the roll first) goes into the output, the `b` end into the input.
// A snake goes the same one way: its multipin female off the stage box, the male into the fan.
// Speaker, instrument and deck leads have the same connector at both ends, so either end fits either jack.
// Plain data, no three.js: cables.ts and the feel room check with it, ends-view.ts draws it.

/** The connector on a cable's end. */
export type Connector = "edison" | "iec" | "xlr-f" | "xlr-m" | "speakon" | "ts" | "rca" | "spade" | "coax" | "multipin-f" | "multipin-m";

/** A cable family: the game's kinds (@rustybuns/gear) and the feel room's roll kinds (a cord is a short power cable). */
type Family = "power" | "cord" | "speaker" | "xlr" | "instrument" | "rca" | "ground" | "digital" | "multi";

/** Each family's `a` end and `b` end. */
const ENDS: Record<Family, readonly [Connector, Connector]> = {
  power: ["edison", "iec"], cord: ["edison", "iec"], xlr: ["xlr-f", "xlr-m"],
  speaker: ["speakon", "speakon"], instrument: ["ts", "ts"], rca: ["rca", "rca"], ground: ["spade", "spade"], digital: ["coax", "coax"], multi: ["multipin-f", "multipin-m"],
};

/** What each connector is called, for the HUD and the hints. */
export const CONNECTOR_NAME: Record<Connector, string> = {
  edison: "wall plug", iec: "IEC socket", "xlr-f": "XLR female", "xlr-m": "XLR male",
  speakon: "speakON", ts: "quarter-inch jack", rca: "RCA plug", spade: "spade lug", coax: "coax plug", "multipin-f": "multipin female", "multipin-m": "multipin male",
};

/** The connector on `end` of a cable of `kind`. */
export const endOf = (kind: Family, end: "a" | "b"): Connector => ENDS[kind][end === "a" ? 0 : 1];

/** Which way a jack faces: an output (`xlr-out-2`, a wall's `power-out-1`) or an input (`power-in`, `xlr-in-1`). */
export const sideOf = (jack: string): "in" | "out" => (/-out(-\d+)?$/.test(jack) ? "out" : "in");

/** Whether `end` of a cable of `kind` goes into a jack on that `side`, and if not, why (the jack's kind already fits). */
export function endWhy(kind: Family, end: "a" | "b", side: "in" | "out"): string | null {
  const have = endOf(kind, end), want = ENDS[kind][side === "out" ? 0 : 1];
  if (have === want) return null;
  return `that's the ${CONNECTOR_NAME[have]} end: it goes in ${side === "out" ? "an input" : "an output"}, the ${CONNECTOR_NAME[want]} end goes here`;
}
