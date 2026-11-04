// The move pool. Every field has one move per slot that any creature of that field is born knowing, so
// creatures that share a field share those moves; each creature also has a signature from its legend
// (in creatures.ts). Frame data comes from power in sim.ts; how a move looks comes from `fx`.
import { FIELDS, type Field } from "./fields.ts";

export const SLOTS = ["light", "heavy", "launcher", "special", "beam", "ultimate"] as const;
export type Slot = (typeof SLOTS)[number];

/** How a move looks when it goes off (src/fx.ts draws it in the move's field colour). */
export const FX = ["jab", "slam", "rise", "orb", "beam", "nova", "rain", "rampage", "wave", "breath"] as const;
export type Fx = (typeof FX)[number];

/** A signature's own way of moving, beyond the coil and snap its `fx` gives: the puppet poses it (beasts.ts). */
export type Motion = "grab" | "shake" | "drum" | "volley" | "shriek" | "roll";

/** What a move covers (docs/ATTACKS.md): touch is body reach, the rest are shapes on the ground that go where you aim
 * (nothing homes). Metres and m/s; a cone's angle is its full spread in degrees; a blast's flight is seconds in the air. */
export type Delivery =
  | { shape: "touch" }
  | { shape: "column"; length: number; width: number; speed: number }
  | { shape: "wall"; width: number; depth: number; travel: number; speed: number }
  | { shape: "cone"; angle: number; length: number }
  | { shape: "blast"; range: number; radius: number; flight: number }
  | { shape: "nova"; radius: number };
export type Shape = Delivery["shape"];

/** Every move's shape for now comes from its look: a beam is a column, a breath a cone, rain a blast, a wave a wall. */
export const DELIVERY: Record<Fx, Delivery> = {
  jab: { shape: "touch" }, slam: { shape: "touch" }, rise: { shape: "touch" }, rampage: { shape: "touch" },
  orb: { shape: "column", length: 10, width: 0.8, speed: 16 },
  beam: { shape: "column", length: 14, width: 1.2, speed: 30 },
  breath: { shape: "cone", angle: 60, length: 6 },
  rain: { shape: "blast", range: 12, radius: 3, flight: 0.7 },
  wave: { shape: "wall", width: 6, depth: 1.5, travel: 10, speed: 12 },
  nova: { shape: "nova", radius: 4 },
};

/** How a move's damage comes out over time (docs/ATTACKS.md "Tempo"). Seconds; shares are of the move's power.
 * - quick: fires on the press, one hit.
 * - charge: hold to grow it, release to fire; a tap is the move as it stands, `full` seconds held is `grow` times its
 *   power and `reach` times its length or radius.
 * - build: a stream that stays on while you hold (up to `run`), starting at `from` of its strength and roaring up to
 *   all of it; it drains energy every tick instead of paying up front.
 * - fade: the big hit lands at once, then it keeps going for `run`, weaker and weaker down to `to` of it. */
export type Tempo =
  | { kind: "quick" }
  | { kind: "charge"; full: number; grow: number; reach: number }
  | { kind: "build"; run: number; from: number }
  | { kind: "fade"; run: number; to: number };

/** Until the field kits (attacks step 3), tempo comes from the slot and the look: the strong swing and the beam are
 * charges, a breath builds up; everything else is quick. */
export function tempoOf(slot: Slot, fx: Fx): Tempo {
  if (slot === "heavy") return { kind: "charge", full: 0.8, grow: 1.6, reach: 1 };
  if (slot === "beam" && fx === "breath") return { kind: "build", run: 2, from: 0.3 };
  if (slot === "beam") return { kind: "charge", full: 1.2, grow: 1.8, reach: 1.3 };
  return { kind: "quick" };
}

/** The low end of a ranged move's damage range, as a share of the high end: where the target stands in the shape
 * decides between them (sim.ts `where`), so "22-48" on the card is read off the board, never rolled. */
export const LOW = 0.55;

export interface Move {
  id: string; slot: Slot; name: string; field: Field;
  power: number; ranged: boolean; drain: number; fx: Fx; delivery: Delivery; tempo: Tempo; motion?: Motion;
}

// Name per field, per slot: light, heavy, launcher, special, beam, ultimate.
const NAMES: Record<Field, [string, string, string, string, string, string]> = {
  ember: ["Cinder Jab", "Furnace Slam", "Flare Uppercut", "Ember Orb", "Flame Breath", "Wildfire"],
  tide: ["Splash Jab", "Undertow Slam", "Geyser Rise", "Bubble Shot", "Torrent", "Tidal Surge"],
  gale: ["Gust Jab", "Cyclone Kick", "Updraft", "Wind Blade", "Jet Stream", "Hurricane"],
  stone: ["Grit Jab", "Boulder Slam", "Rock Spire", "Stone Toss", "Sandblast", "Landslide"],
  frost: ["Rime Jab", "Glacier Slam", "Ice Spike", "Hail Shard", "Frost Breath", "Blizzard"],
  storm: ["Spark Jab", "Thunder Slam", "Static Rise", "Ball Lightning", "Lightning Bolt", "Thunderstorm"],
  grove: ["Thorn Jab", "Root Slam", "Vine Lash", "Seed Shot", "Spore Stream", "Overgrowth"],
  venom: ["Fang Jab", "Toxic Slam", "Sting Rise", "Acid Spit", "Miasma Stream", "Plague Cloud"],
  spirit: ["Wisp Touch", "Soul Slam", "Ascend", "Will-o'-Wisp", "Spirit Ray", "Spirit Storm"],
  shadow: ["Night Claw", "Dread Slam", "Shade Rise", "Dusk Orb", "Nightmare Ray", "Eclipse"],
  iron: ["Iron Jab", "Iron Ram", "Anvil Rise", "Iron Shard", "Forge Beam", "Meteor Hammer"],
  wild: ["Scratch", "Maul", "Tusk Toss", "Howl", "Roar", "Rampage"],
};
// Fields whose big finish is a charge into the target rather than something thrown.
const MELEE_ULT: Field[] = ["stone", "iron", "wild"];
const ULT_FX: Record<Field, Fx> = {
  ember: "nova", tide: "wave", gale: "nova", stone: "rampage", frost: "rain", storm: "rain",
  grove: "wave", venom: "nova", spirit: "rain", shadow: "nova", iron: "rampage", wild: "rampage",
};
// Power and look per slot, the same in every field so no field's kit is simply better.
const SHAPE: Record<Slot, { power: number; fx: Fx }> = {
  light: { power: 24, fx: "jab" }, heavy: { power: 90, fx: "slam" }, launcher: { power: 65, fx: "rise" },
  special: { power: 45, fx: "orb" }, beam: { power: 88, fx: "beam" }, ultimate: { power: 115, fx: "nova" },
};
// A few fields drain: venom's bite and shadow's eclipse feed the one who lands them.
const DRAIN: Partial<Record<string, number>> = { "venom-light": 40, "shadow-ultimate": 25, "spirit-special": 20 };

export const fieldMove = (field: Field, slot: Slot) => `${field}-${slot}`;

export const MOVES: Record<string, Move> = {};
for (const field of FIELDS) SLOTS.forEach((slot, i) => {
  const id = fieldMove(field, slot), s = SHAPE[slot];
  const ranged = slot === "special" || slot === "beam" || (slot === "ultimate" && !MELEE_ULT.includes(field));
  const fx = slot === "ultimate" ? ULT_FX[field] : slot === "beam" && (field === "ember" || field === "frost") ? "breath" : s.fx;
  MOVES[id] = { id, slot, name: NAMES[field][i]!, field, power: s.power, ranged, drain: DRAIN[id] ?? 0, fx, delivery: DELIVERY[fx], tempo: tempoOf(slot, fx) };
});
