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
/** How far from you a shape reaches along the ground (m): what a bot checks before it fires one. A nova reaches its radius. */
export const reachOf = (d: Delivery): number =>
  d.shape === "column" || d.shape === "cone" ? d.length : d.shape === "wall" ? d.travel + d.depth : d.shape === "blast" ? d.range + d.radius : d.shape === "nova" ? d.radius : 0;

/** A move's shape from its look, for the signatures (and the slots that aren't in a field's kit): a beam is a column,
 * a breath a cone, rain a blast, a wave a wall. The field specials and bigs have their own shapes in KIT. */
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

const quick: Tempo = { kind: "quick" };
/** Tempo outside the field kits: the strong swing charges in every field; a signature takes it from its look (a rampage
 * is a charged rush, a beam a charged column, a breath a stream; a nova, a rain of blows and a wave go off at once). */
export function tempoOf(slot: Slot, fx: Fx): Tempo {
  if (slot === "heavy") return { kind: "charge", full: 0.8, grow: 1.6, reach: 1 };
  if (slot !== "ultimate") return quick;
  if (fx === "rampage") return { kind: "charge", full: 1, grow: 1.5, reach: 1 };
  if (fx === "beam") return { kind: "charge", full: 1.2, grow: 1.5, reach: 1.3 };
  if (fx === "breath") return { kind: "build", run: 2.5, from: 0.4 };
  return quick;
}

/** One kit move: its shape, its tempo, and its power where it differs from the slot's (SHAPE). */
interface KitMove { d: Exclude<Delivery, { shape: "touch" }>; tempo: Tempo; power?: number }
const col = (length: number, width: number, speed: number) => ({ shape: "column", length, width, speed }) as const;
const cone = (angle: number, length: number) => ({ shape: "cone", angle, length }) as const;
const blast = (radius: number, range: number, flight: number) => ({ shape: "blast", range, radius, flight }) as const;
const wall = (width: number, travel: number, speed: number) => ({ shape: "wall", width, depth: 1.5, travel, speed }) as const;
const charge = (full: number, grow: number, reach: number): Tempo => ({ kind: "charge", full, grow, reach });
const build = (run: number, from = 0.3): Tempo => ({ kind: "build", run, from });
const fade = (run: number, to = 0.2): Tempo => ({ kind: "fade", run, to });
/**
 * Every field's special (15 energy) and big (35): where fields differ (docs/ATTACKS.md "Every field gets its own kit").
 * Bigger area or longer reach pays in damage: `bun scripts/tune.ts --kits` measures each big's damage per energy in bot
 * fights, and `power` levels the ones that land far off the rest.
 */
export const KIT: Record<Field, { special: KitMove; beam: KitMove }> = {
  ember: { special: { d: blast(1.5, 10, 0.6), tempo: quick }, beam: { d: cone(60, 6), tempo: build(2), power: 210 } },
  tide: { special: { d: col(10, 0.6, 16), tempo: quick }, beam: { d: col(14, 1.2, 22), tempo: charge(1.2, 1.8, 1.2), power: 140 } },
  gale: { special: { d: col(12, 0.4, 26), tempo: quick }, beam: { d: wall(6, 7, 10), tempo: fade(1), power: 60 } },
  stone: { special: { d: blast(2, 9, 0.7), tempo: quick }, beam: { d: cone(45, 7), tempo: fade(1.2) } },
  frost: { special: { d: col(9, 0.5, 16), tempo: quick }, beam: { d: cone(50, 5), tempo: build(2), power: 215 } },
  storm: { special: { d: blast(1.5, 10, 1), tempo: quick }, beam: { d: col(16, 0.6, 40), tempo: charge(1.4, 1.9, 1.2), power: 68 } },
  grove: { special: { d: col(10, 0.5, 16), tempo: quick }, beam: { d: blast(3, 8, 0.6), tempo: build(2.5), power: 60 } },
  venom: { special: { d: blast(1.2, 8, 0.5), tempo: quick }, beam: { d: cone(70, 4), tempo: build(2), power: 150 } },
  spirit: { special: { d: col(10, 0.8, 8), tempo: quick }, beam: { d: col(12, 0.8, 30), tempo: fade(1.2), power: 60 } },
  shadow: { special: { d: blast(1.8, 9, 0.7), tempo: quick }, beam: { d: wall(6, 5, 14), tempo: charge(1, 1.6, 1.3), power: 100 } },
  iron: { special: { d: col(10, 0.4, 18), tempo: quick }, beam: { d: col(12, 1, 26), tempo: charge(1.2, 1.7, 1.2), power: 64 } },
  wild: { special: { d: { shape: "nova", radius: 3 }, tempo: quick }, beam: { d: cone(90, 5), tempo: fade(1), power: 140 } },
};
/** The look a kit move draws with, from its shape. */
const kitFx = (slot: "special" | "beam", d: KitMove["d"]): Fx =>
  d.shape === "nova" ? "nova" : slot === "special" ? "orb" : d.shape === "column" ? "beam" : d.shape === "cone" ? "breath" : d.shape === "wall" ? "wave" : "rain";

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
  const kit = slot === "special" || slot === "beam" ? KIT[field][slot] : null;
  const fx = slot === "ultimate" ? ULT_FX[field] : kit && (slot === "special" || slot === "beam") ? kitFx(slot, kit.d) : s.fx;
  MOVES[id] = {
    id, slot, name: NAMES[field][i]!, field, power: kit?.power ?? s.power, ranged, drain: DRAIN[id] ?? 0, fx,
    delivery: kit?.d ?? DELIVERY[fx], tempo: kit?.tempo ?? tempoOf(slot, fx),
  };
});
