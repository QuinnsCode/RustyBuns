// The move pool. Every field has one move per slot that any creature of that field is born knowing, so
// creatures that share a field share those moves; each creature also has a signature from its legend
// (in creatures.ts). Frame data comes from power in sim.ts; how a move looks comes from `fx`.
import { FIELDS, type Field } from "./fields.ts";

export const SLOTS = ["light", "heavy", "launcher", "special", "beam", "ultimate"] as const;
export type Slot = (typeof SLOTS)[number];

/** How a move looks when it goes off (src/fx.ts draws it in the move's field colour). */
export const FX = ["jab", "slam", "rise", "orb", "beam", "nova", "rain", "rampage", "wave", "breath"] as const;
export type Fx = (typeof FX)[number];

export interface Move {
  id: string; slot: Slot; name: string; field: Field;
  power: number; accuracy: number; ranged: boolean; drain: number; fx: Fx;
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
// Power, accuracy and look per slot, the same in every field so no field's kit is simply better.
const SHAPE: Record<Slot, { power: number; accuracy: number; fx: Fx }> = {
  light: { power: 24, accuracy: 100, fx: "jab" }, heavy: { power: 90, accuracy: 80, fx: "slam" },
  launcher: { power: 65, accuracy: 95, fx: "rise" }, special: { power: 45, accuracy: 100, fx: "orb" },
  beam: { power: 88, accuracy: 90, fx: "beam" }, ultimate: { power: 115, accuracy: 75, fx: "nova" },
};
// A few fields drain: venom's bite and shadow's eclipse feed the one who lands them.
const DRAIN: Partial<Record<string, number>> = { "venom-light": 40, "shadow-ultimate": 25, "spirit-special": 20 };

export const fieldMove = (field: Field, slot: Slot) => `${field}-${slot}`;

export const MOVES: Record<string, Move> = {};
for (const field of FIELDS) SLOTS.forEach((slot, i) => {
  const id = fieldMove(field, slot), s = SHAPE[slot];
  const ranged = slot === "special" || slot === "beam" || (slot === "ultimate" && !MELEE_ULT.includes(field));
  MOVES[id] = { id, slot, name: NAMES[field][i]!, field, power: s.power, accuracy: s.accuracy, ranged, drain: DRAIN[id] ?? 0,
    fx: slot === "ultimate" ? ULT_FX[field] : slot === "beam" && (field === "ember" || field === "frost") ? "breath" : s.fx };
});
