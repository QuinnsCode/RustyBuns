// Real audio and power connectors: what each one carries, its pins, how it locks, and which plug goes into which socket.
// One list for the gear catalog, the models that draw the sockets and plugs, Load In's cables and Qollab Studio's
// lessons. A connector's `type` is the family (an XLR is male or female, the same type); a plug or socket is a type and a
// gender. Plain data and guards, no DOM or Bun, so it runs anywhere.

import { arr, obj, oneOf, str, type Of } from "./guard.ts";

/** Every connector type, by its trade name. */
export const CONNECTOR_TYPES = [
  "nl4", "nl8", "nl2-combo", "ep6", "xlr3", "combo", "trs", "trs-mini", "ts", "rca", "ethercon",
  "powercon-blue", "powercon-grey", "powercon-true1", "iec", "edison",
  "spade", "coax", "multipin",
] as const;
export const ConnectorType = oneOf(CONNECTOR_TYPES);
export type ConnectorType = Of<typeof ConnectorType>;

/** What runs through it: an amp's speaker line (tens of volts, amps of current), a balanced or unbalanced audio signal
 * (a volt or so, almost no current), mains power, or a ground wire. */
export const CARRIES = ["speaker", "signal", "mains", "ground", "digital"] as const;
export const Carries = oneOf(CARRIES);
export type Carries = Of<typeof Carries>;

/** Male has the pins, female the holes. speakON and powerCON have no gender in the trade (the panel and cable parts
 * differ by shape instead): they are `none`. */
export const Gender = oneOf(["male", "female", "none"]);
export type Gender = Of<typeof Gender>;

/** How it stays in: a quarter-turn twist (speakON, powerCON), a push latch (XLR, a locking IEC) or friction. */
export const Lock = oneOf(["twist", "latch", "friction", "screw"]);
export type Lock = Of<typeof Lock>;

/** One pin: its printed name and what it does. */
export const Pin = obj({ name: str(8), what: str(120) });
export type Pin = Of<typeof Pin>;

export const Connector = obj({
  type: ConnectorType,
  /** What a crew calls it, for a HUD or a lesson's heading. */
  name: str(40),
  carries: Carries,
  pins: arr(Pin, 8, { min: 1 }),
  lock: Lock,
  /** The genders it comes in. */
  genders: arr(Gender, 2, { min: 1 }),
  /** The housing's colour where it means something (powerCON blue is power in, grey is power out), else "black". */
  colour: str(16),
  /** The other types whose plug its socket also takes (a combo socket takes an XLR male or a quarter-inch jack). */
  takes: arr(ConnectorType, 4),
  /** One line for the player or the learner: what it is for. */
  what: str(200),
});
export type Connector = Of<typeof Connector>;

/** A plug or a socket: its type and gender. */
export const End = obj({ type: ConnectorType, gender: Gender });
export type End = Of<typeof End>;

const pin = (name: string, what: string): Pin => ({ name, what });
const speakonPins = (pairs: number) =>
  Array.from({ length: pairs }, (_, i) => [pin(`${i + 1}+`, `pair ${i + 1} plus`), pin(`${i + 1}-`, `pair ${i + 1} minus`)]).flat();
const mains = [pin("L", "live: the mains phase"), pin("N", "neutral: the return"), pin("PE", "earth: the safety ground")];

/** Every connector, by type. */
export const CONNECTORS: { readonly [T in ConnectorType]: Connector & { type: T } } = {
  nl4: {
    type: "nl4", name: "speakON NL4", carries: "speaker", pins: speakonPins(2), lock: "twist", genders: ["none"], colour: "black", takes: [],
    what: "A twist-lock speaker connector with four poles: a passive box on 1+/1-, or a biamped box's low pair on 1+/1- and high pair on 2+/2-.",
  },
  nl8: {
    type: "nl8", name: "speakON NL8", carries: "speaker", pins: speakonPins(4), lock: "twist", genders: ["none"], colour: "black", takes: ["nl4"],
    what: "The bigger eight-pole speakON: four amp channels down one cable, for a three- or four-way box. Its socket also takes an NL4.",
  },
  "nl2-combo": {
    type: "nl2-combo", name: "speakON/jack combo", carries: "speaker", pins: speakonPins(1), lock: "twist", genders: ["female"], colour: "black", takes: ["nl4", "ts"],
    what: "A passive monitor's speaker socket that takes a speakON (only its 1+/1- pair) or a quarter-inch speaker lead in the same hole.",
  },
  ep6: {
    type: "ep6", name: "EP-6", carries: "speaker", lock: "screw", genders: ["male", "female"], colour: "black", takes: [],
    pins: [pin("1", "low-mid minus"), pin("2", "low-mid plus"), pin("3", "high-mid minus"), pin("4", "high-mid plus"), pin("5", "high minus"), pin("6", "high plus")],
    what: "A round six-pin multipin from the tri-amp horn era: three amp channels down one speaker cable, screwed on with a collar.",
  },
  xlr3: {
    type: "xlr3", name: "XLR", carries: "signal", lock: "latch", genders: ["male", "female"], colour: "black", takes: [],
    pins: [pin("1", "ground: the cable's shield"), pin("2", "hot: the signal"), pin("3", "cold: the signal upside down, so noise cancels")],
    what: "The three-pin balanced audio connector: mics, line feeds from the desk, and the signal into a powered speaker. Out is male, in is female.",
  },
  combo: {
    type: "combo", name: "combo XLR/jack", carries: "signal", lock: "latch", genders: ["female"], colour: "black", takes: ["xlr3", "trs", "ts"],
    pins: [pin("1", "ground (XLR) or sleeve (jack)"), pin("2", "hot (XLR) or tip (jack)"), pin("3", "cold (XLR) or ring (jack)")],
    what: "An input that takes an XLR male or a quarter-inch jack in the same hole: a powered speaker's or a mixer's input.",
  },
  trs: {
    type: "trs", name: "quarter-inch TRS", carries: "signal", lock: "friction", genders: ["male", "female"], colour: "black", takes: ["ts"],
    pins: [pin("T", "tip: hot"), pin("R", "ring: cold"), pin("S", "sleeve: ground")],
    what: "A quarter-inch jack with a tip, a ring and a sleeve: a balanced line, or a stereo pair on headphones.",
  },
  "trs-mini": {
    type: "trs-mini", name: "3.5 mm jack", carries: "signal", lock: "friction", genders: ["male", "female"], colour: "black", takes: [],
    pins: [pin("T", "tip: left"), pin("R", "ring: right"), pin("S", "sleeve: ground")],
    what: "The small headphone-size jack: a phone or a laptop played straight into a powered speaker.",
  },
  ts: {
    type: "ts", name: "quarter-inch TS", carries: "signal", lock: "friction", genders: ["male", "female"], colour: "black", takes: [],
    pins: [pin("T", "tip: the signal"), pin("S", "sleeve: ground")],
    what: "A quarter-inch jack with just a tip and a sleeve: an unbalanced guitar or keyboard lead.",
  },
  rca: {
    type: "rca", name: "RCA", carries: "signal", lock: "friction", genders: ["male", "female"], colour: "black", takes: [],
    pins: [pin("C", "centre: the signal"), pin("S", "shell: ground")],
    what: "The small phono plug on a turntable, a media player or hi-fi: unbalanced, short runs only.",
  },
  ethercon: {
    type: "ethercon", name: "etherCON", carries: "digital", lock: "latch", genders: ["female"], colour: "black", takes: [],
    pins: [pin("1-8", "a network cable's eight wires: audio over the network (Dante) and control")],
    what: "A network socket in a metal latching shell: a powered line array box takes its audio and its settings over it.",
  },
  "powercon-blue": {
    type: "powercon-blue", name: "powerCON in (blue)", carries: "mains", pins: mains, lock: "twist", genders: ["none"], colour: "blue", takes: [],
    what: "A twist-lock mains connector. Blue is power coming in: the box's mains inlet.",
  },
  "powercon-grey": {
    type: "powercon-grey", name: "powerCON out (grey)", carries: "mains", pins: mains, lock: "twist", genders: ["none"], colour: "grey", takes: [],
    what: "Grey powerCON is power going on out: a thru to the next box, keyed so it never mates with a blue one.",
  },
  "powercon-true1": {
    type: "powercon-true1", name: "powerCON TRUE1", carries: "mains", pins: mains, lock: "twist", genders: ["male", "female"], colour: "black", takes: [],
    what: "The newer powerCON that is safe to plug and unplug live: in is male, the thru out is female, one cable type for both.",
  },
  iec: {
    type: "iec", name: "IEC", carries: "mains", pins: mains, lock: "friction", genders: ["male", "female"], colour: "black", takes: [],
    what: "The kettle-style mains inlet on most gear: the box has the male inlet (C14), the cord the female (C13).",
  },
  edison: {
    type: "edison", name: "wall plug", carries: "mains", lock: "friction", genders: ["male", "female"], colour: "black", takes: [],
    pins: [pin("H", "hot"), pin("N", "neutral"), pin("G", "ground")],
    what: "The three-prong plug that goes in a wall socket or a power distro.",
  },
  spade: {
    type: "spade", name: "spade lug", carries: "ground", pins: [pin("G", "ground")], lock: "screw", genders: ["none"], colour: "black", takes: [],
    what: "A forked lug under a screw post: a turntable's ground wire onto the mixer's ground post.",
  },
  coax: {
    type: "coax", name: "coax", carries: "digital", pins: [pin("C", "centre: the data"), pin("S", "shell: ground")], lock: "friction", genders: ["male", "female"], colour: "orange", takes: [],
    what: "A digital audio link on an RCA-sized plug: one wire carries both channels as data.",
  },
  multipin: {
    type: "multipin", name: "multipin", carries: "signal", pins: [pin("1-n", "one balanced pair per channel")], lock: "screw", genders: ["male", "female"], colour: "black", takes: [],
    what: "A snake's big connector: every channel of the stage box down one cable to the desk.",
  },
};

/** The connector for a type. */
export const connector = (type: ConnectorType): Connector => CONNECTORS[type];

const CARRY_WORD: { readonly [C in Carries]: string } = {
  speaker: "a speaker line from an amp", signal: "an audio signal", mains: "mains power", ground: "a ground wire", digital: "digital audio",
};

/** Whether `plug` goes into `socket`, and if not, why, in a player's words. A male plug goes into a female socket (or
 * a genderless pair, speakON into speakON); a socket's `takes` lists the other types it also fits. */
export function fits(plug: End, socket: End): string | null {
  const p = CONNECTORS[plug.type], s = CONNECTORS[socket.type];
  if (plug.type !== socket.type && !s.takes.includes(plug.type)) {
    if (p.carries !== s.carries) return `that's ${p.name}, it carries ${CARRY_WORD[p.carries]}; this ${s.name} takes ${CARRY_WORD[s.carries]}`;
    if (p.type.startsWith("powercon-") && s.type.startsWith("powercon-")) return `${p.name} won't twist into ${s.name}: blue is power in, grey is power out, keyed so they never meet`;
    return `a ${p.name} plug doesn't fit a ${s.name} socket`;
  }
  if (plug.gender !== "none" && plug.gender === socket.gender) return `both ends are ${plug.gender}: turn the cable round`;
  return null;
}
