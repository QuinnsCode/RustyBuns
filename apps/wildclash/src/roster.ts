// The roster as data, and the body each creature's numbers give it. `roster.json` comes from
// scripts/import-roster.ts; balancing is an edit to the table below, not to the sim.
import { clamp } from "@rustybuns/util";
import { arr, bool, num, obj, oneOf, str, type Of } from "@rustybuns/util/guard";
import data from "./roster.json";

export const SLOTS = ["light", "heavy", "launcher", "special", "beam", "ultimate"] as const;
export type Slot = (typeof SLOTS)[number];
export const ARCHETYPES = ["skirmisher", "flyer", "tank", "bruiser"] as const;
export type Archetype = (typeof ARCHETYPES)[number];

const Stat = num(1, 255);
const Move = obj({
  slot: oneOf(SLOTS), name: str(40), element: str(20), power: num(1, 300), accuracy: num(0, 100), ranged: bool(), drain: num(0, 100),
});
export type Move = Of<typeof Move>;
const Creature = obj({
  id: str(40), name: str(40), archetype: oneOf(ARCHETYPES), elements: arr(str(20), 3, { min: 1 }),
  heightM: num(0.1, 30), massKg: num(0.1, 1000),
  stats: obj({ vigor: Stat, might: Stat, guard: Stat, focus: Stat, will: Stat, speed: Stat }),
  moves: arr(Move, 6, { min: 6 }),
});
export type Creature = Of<typeof Creature>;

export const ROSTER: Creature[] = arr(Creature, 64)(data);
export const creature = (id: string) => ROSTER.find((c) => c.id === id) ?? ROSTER[0]!;

export type Air = "hop" | "flight";

/** What the body does in the arena. Mass and size are the creature's own; the rest is shaped from them and its stats. */
export interface Body {
  mass: number;          // kg
  radius: number;        // m, the hurtbox
  height: number;        // m
  topSpeed: number;      // m/s on the ground
  accel: number;         // m/s²
  turnRate: number;      // rad/s
  jump: number;          // m/s straight up
  air: Air;
  stamina: number;       // seconds of sprinting or flying from full
  hp: number;
  armour: number;        // 0-1: how much of a light hit's stagger it shrugs off mid-attack
  dashCost: number;      // stamina per dash
}

export function body(c: Creature): Body {
  const { stats, massKg: mass } = c;
  // Visual size grows with height, but squashed: a 0.4 m mouse and a 2 m tortoise both have to fit one arena.
  const height = clamp(0.6 + c.heightM * 0.8, 0.8, 2.6);
  const radius = clamp(0.3 + Math.cbrt(mass) * 0.12, 0.35, 1.2);
  const heft = Math.log10(mass + 1);  // 6 kg → 0.85, 90 kg → 1.96
  const flight = c.elements.includes("flying") || c.archetype === "flyer";
  return {
    mass, radius, height,
    topSpeed: clamp(4 + stats.speed / 12 - heft * 1.5, 3, 13),
    accel: clamp(40 / heft, 12, 60),
    turnRate: clamp(16 / heft ** 3, 2.8, 14),
    jump: clamp(10 - heft * 1.6, 6, 10),
    air: flight ? "flight" : "hop",
    stamina: clamp(2.5 + stats.vigor / 40 + (flight ? 1 : 0), 3, 8),
    hp: 100 + stats.vigor + stats.guard * 0.5,
    armour: clamp((heft - 1) * 0.6, 0, 0.7),
    dashCost: clamp(0.25 * heft, 0.2, 0.6),
  };
}
