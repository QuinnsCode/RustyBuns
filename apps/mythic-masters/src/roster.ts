// The roster: the 64 creatures in creatures.ts with their moves, and the body each creature's numbers give it.
// Every creature is born knowing its fields' moves (shared with every creature of that field) and its own
// signature; it can be taught its fields' neighbours' moves too. In versus everyone knows their whole kit,
// so the fighters are balanced picks; a harness (`teach`) can put any creature in any state it could learn.
import { clamp } from "@rustybuns/util";
import { num, rec } from "@rustybuns/util/guard";
import { ROWS, type Archetype, type Row } from "./creatures.ts";
import { KIN, type Field } from "./fields.ts";
import { fieldMove, MOVES, SLOTS, type Move, type Slot } from "./moves.ts";
import balance from "./balance.json";

export { SLOTS, type Move, type Slot } from "./moves.ts";
export type { Archetype } from "./creatures.ts";
export const ARCHETYPES = ["skirmisher", "flyer", "tank", "bruiser"] as const satisfies readonly Archetype[];

export interface Stats { vigor: number; might: number; guard: number; focus: number; will: number; speed: number }
export interface Creature {
  id: string; name: string; region: number; archetype: Archetype; fields: Field[];
  heightM: number; massKg: number; stats: Stats;
  /** The six it fights with, one per slot. */
  moves: Move[];
  /** Damage dealt is multiplied by this: the balance knob `bun scripts/tune.ts --fit` sets, so every creature
   * wins about half its fights across the roster whatever its body. Read from balance.json. */
  edge: number;
}

/** A creature's signature move, from its legend. */
export const signatureOf = (r: Row): Move => ({
  id: `${r.id}-signature`, slot: "ultimate", name: r.sig.name, field: r.sig.field, ranged: r.sig.ranged, fx: r.sig.fx,
  power: r.sig.power ?? 120, accuracy: 75, drain: r.sig.drain ?? 0, motion: r.sig.motion,
});
for (const r of ROWS) { const s = signatureOf(r); MOVES[s.id] = s; }

/** Born knowing: light, heavy and launcher from the first field, special and beam from the second (or the
 * first again), and the signature as the ultimate; `knows` swaps in a move from its story. */
function kit(r: Row): Move[] {
  const [a, b = a] = r.fields as [Field, Field?];
  const pick: Record<Slot, string> = {
    light: fieldMove(a, "light"), heavy: fieldMove(a, "heavy"), launcher: fieldMove(a, "launcher"),
    special: fieldMove(b, "special"), beam: fieldMove(b, "beam"), ultimate: `${r.id}-signature`, ...r.knows,
  };
  return SLOTS.map((s) => MOVES[pick[s]]!);
}

const edges = rec(num(0.1, 10), 256)(balance);

/** Every fighter spends the same stat budget: a row's stats are its shape, scaled to add up to this. */
export const BUDGET = 480;

export const ROSTER: Creature[] = ROWS.map((r) => {
  const k = BUDGET / r.stats.reduce((a, b) => a + b, 0), s = r.stats.map((v) => Math.round(v * k));
  return {
    id: r.id, name: r.name, region: r.region, archetype: r.archetype, fields: r.fields, heightM: r.heightM, massKg: r.massKg,
    stats: { vigor: s[0]!, might: s[1]!, guard: s[2]!, focus: s[3]!, will: s[4]!, speed: s[5]! },
    moves: kit(r), edge: edges[r.id] ?? 1,
  };
});
export const creature = (id: string) => ROSTER.find((c) => c.id === id) ?? ROSTER[0]!;

const isSignature = (m: Move) => m.id.endsWith("-signature");

/** What a creature can know: `born` (its fields' moves, its signature, and any move its story gave it) and
 * `taught` (its fields' neighbours' moves, and the signatures of creatures with its first field and archetype). */
export function learnset(c: Creature): { born: Move[]; taught: Move[] } {
  const all = Object.values(MOVES);
  const born = all.filter((m) => (c.fields.includes(m.field) && !isSignature(m)) || m.id === `${c.id}-signature` || c.moves.includes(m));
  const kin = new Set(c.fields.flatMap((f) => KIN[f]).filter((f) => !c.fields.includes(f)));
  const cousins = new Set(ROSTER.filter((o) => o.id !== c.id && o.archetype === c.archetype && o.fields[0] === c.fields[0]).map((o) => `${o.id}-signature`));
  const taught = all.filter((m) => !born.includes(m) && ((kin.has(m.field) && !isSignature(m)) || cousins.has(m.id)));
  return { born, taught };
}

/** The creature knowing `moveId` in that move's slot, or null when it couldn't learn it. */
export function teach(c: Creature, moveId: string): Creature | null {
  const { born, taught } = learnset(c), m = [...born, ...taught].find((x) => x.id === moveId);
  return m ? { ...c, moves: c.moves.map((x) => (x.slot === m.slot ? m : x)) } : null;
}

export type Air = "hop" | "flight";

/** What the body does in the arena, every number from the creature's size and stats:
 * - mass (the legend's, squashed by `fightMass`): knockback taken, armour, jump height, dash cost;
 * - speed: top speed, and with mass, acceleration and turning (a quick heavy still turns wide) and the dodge;
 * - vigor: health and stamina; guard: health and armour; might, focus and will: damage dealt and taken (sim.ts). */
export interface Body {
  mass: number;          // kg the fight feels
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
  dodge: number;         // frames a dash can't be hit: the quick ones vanish
}

/** The mass the fight feels: the legend's, squashed toward 60 kg so a 4 kg hare and a tonne of lake monster
 * are both fighters (4 → 27, 60 → 60, 1000 → 140). */
export const fightMass = (kg: number) => Math.round(60 * (kg / 60) ** 0.3 * 10) / 10;

export function body(c: Creature): Body {
  const { stats } = c, mass = fightMass(c.massKg);
  // Visual size grows with height, but squashed: a 0.4 m hare and a 3 m sauropod both have to fit one arena.
  const height = clamp(0.6 + c.heightM * 0.8, 0.8, 2.6);
  const radius = clamp(0.3 + Math.cbrt(mass) * 0.12, 0.35, 1.2);
  const heft = Math.log10(mass + 1);  // 27 kg → 1.45, 60 kg → 1.79, 140 kg → 2.15
  const agile = stats.speed / 80;     // about 0.5 for the slowest to 1.6 for the quickest
  const flight = c.archetype === "flyer";
  return {
    mass, radius, height,
    topSpeed: clamp(3 + stats.speed / 14 - heft, 3, 11),
    accel: clamp((30 * agile ** 1.5) / heft, 12, 60),
    turnRate: clamp(4 * agile ** 2 * (2 / heft) ** 2, 1.6, 14),
    jump: clamp(10 - heft * 1.6, 6, 10),
    air: flight ? "flight" : "hop",
    stamina: clamp(2.5 + stats.vigor / 40 + (flight ? 1 : 0), 3, 8),
    hp: 100 + stats.vigor + stats.guard * 0.5,
    armour: clamp((heft - 1) * 0.6, 0, 0.7),
    dashCost: clamp(0.25 * heft, 0.2, 0.6),
    dodge: stats.speed >= 100 ? 8 : 3,
  };
}
