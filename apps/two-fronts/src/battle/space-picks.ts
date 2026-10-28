// The hero space battle, fought by picking: a few rounds, and each round both sides pick one order
// from their hand, seeing the other's only once both are in. The orders counter each other like
// rock-paper-scissors, and the size of each fleet weighs on every exchange:
//   broadside  the gun lines fire. Cuts boarders down as they cross, and catches a fleet turned
//              to bombard the world below.
//   screen     fighters out front spoil the gun line and the bombardment alike. The side's ground
//              batteries add their flak.
//   board      close in and send troops across: inside a fighter screen it can't fire, and a fleet
//              bombarding has its guns pointed the wrong way. It takes the ships it boards as
//              prizes, but it needs boarding parties from the muster force below, a big muster
//              boards harder, and a broadside costs it half the parties.
//   bombard    turn the guns on the world: armies down there die, the more the bigger the fleet
//              and its batteries, but every hit lands and none goes back. Twice as deadly on a
//              fleet that's pulling back or bombarding too.
//   withdraw   pull back: take half the fire, give none, and come back rallied next round, half as
//              hard again. A boarding party finds nobody to board.
// The twist is the hand: no order twice running, so a side that leans on one gets read. The side
// with more hull left after the last round holds the orbit, the defender on a tie, and a fleet
// with none left is gone. It's a pure function of the spec, its seed and the picks, so the table
// plays a result again from the hero's picks with the AI picking for the other side.
import { other, SPACE_ORDERS, type PerSide, type Side, type SpaceBattleResult, type SpaceBattleSpec, type SpaceOrder } from "./contract.ts";
import { nextRandom } from "@rustybuns/util";

export const ROUNDS = 4;
export const HULL_PER_SHIP = 10;
export const BIG_MUSTER = 4; // armies below that make a full boarding party
const FIRE = 0.3;            // the share of a side's hull it puts into the other's in a fair exchange
const BATTERY = 5;           // the hull a ground battery adds to a screen
const RALLY = 1.3;

// How hard one order hits the other's ships: a win, an even trade, a loss.
const WIN = 1.4, EVEN = 0.6, LOSE = 0.25;
const BEATS: Record<SpaceOrder, SpaceOrder[]> = {
  broadside: ["board", "bombard"],
  screen: ["broadside", "bombard"],
  board: ["screen", "bombard"],
  bombard: [],
  withdraw: [],
};
// What an order does against one pulling back: parting shots, fighters running them down, nobody to board.
const ON_WITHDRAW: Record<SpaceOrder, number> = { broadside: 0.5, screen: 0.75, board: 0, bombard: 0, withdraw: 0 };

export type Clash = "win" | "lose" | "even";
export const clash = (mine: SpaceOrder, theirs: SpaceOrder): Clash =>
  BEATS[mine].includes(theirs) ? "win" : BEATS[theirs].includes(mine) ? "lose" : "even";

export interface PickRound {
  picks: PerSide<SpaceOrder>;
  hit: PerSide<number>;      // hull each side lost
  prizes: PerSide<number>;   // hull each side took by boarding
  killed: PerSide<number>;   // armies each side lost on the world below, bombarded
  boarders: PerSide<number>; // armies each side lost boarding
}

export interface PickBattle {
  spec: SpaceBattleSpec;
  round: number;               // rounds fought
  hull: PerSide<number>;
  top: PerSide<number>;        // the most hull each side has had, for the bars
  troops: PerSide<number>;     // the muster force left below
  batteries: PerSide<number>;
  lost: PerSide<number>;       // armies each side has lost below
  last: PerSide<SpaceOrder | null>;
  rally: PerSide<boolean>;
  rounds: PickRound[];
  over: SpaceBattleResult | null;
  seed: number;
}

const SIDES: Side[] = ["attacker", "defender"];
const per = <T>(f: (s: Side) => T): PerSide<T> => ({ attacker: f("attacker"), defender: f("defender") });

export function startPicks(spec: SpaceBattleSpec): PickBattle {
  const hull = per((s) => Math.max(0, spec.fleets[s]) * HULL_PER_SHIP);
  return {
    spec, round: 0, hull, top: { ...hull },
    troops: per((s) => spec.muster?.[s] ?? 0), batteries: per((s) => spec.batteries?.[s] ?? 0), lost: per(() => 0),
    last: per(() => null), rally: per(() => false), rounds: [], over: null, seed: spec.seed >>> 0,
  };
}

// Why a side can't pick an order this round, or null if it can.
export function whyNot(b: PickBattle, side: Side, o: SpaceOrder): string | null {
  if (!SPACE_ORDERS.includes(o)) return "No such order";
  if (b.last[side] === o) return "Not twice running";
  if (o === "board" && b.troops[side] < 1) return "No troops on the world below to board with";
  return null;
}
export const legalPicks = (b: PickBattle, side: Side) => SPACE_ORDERS.filter((o) => !whyNot(b, side, o));

// What a side's order puts into the other's ships, and into its troops below. `roll` shakes each
// hit by up to 15% either way; without it, the exchange is its average, for the AI to weigh.
export function exchange(b: PickBattle, picks: PerSide<SpaceOrder>, roll: () => number = () => 0.5): PickRound {
  const r: PickRound = { picks, hit: per(() => 0), prizes: per(() => 0), killed: per(() => 0), boarders: per(() => 0) };
  for (const s of SIDES) {
    const foe = other(s), mine = picks[s], theirs = picks[foe], rally = b.rally[s] ? RALLY : 1;
    const shake = () => 0.85 + 0.3 * roll();
    if (mine === "bombard") {
      const n = (b.hull[s] / HULL_PER_SHIP / 2 + b.batteries[s] / 2) * (theirs === "withdraw" || theirs === "bombard" ? 2 : 1) * rally;
      r.killed[foe] = Math.min(b.troops[foe], Math.max(b.hull[s] > 0 ? 1 : 0, Math.round(n * shake())));
      continue;
    }
    if (mine === "withdraw") continue;
    const mult = theirs === "withdraw" ? ON_WITHDRAW[mine] : ({ win: WIN, even: EVEN, lose: LOSE } as const)[clash(mine, theirs)];
    const power = mine === "screen" ? b.hull[s] + b.batteries[s] * BATTERY
      : mine === "board" ? Math.min(b.hull[s], b.troops[s] * HULL_PER_SHIP) * (b.troops[s] >= BIG_MUSTER ? 1.25 : 1)
      : b.hull[s];
    const hit = Math.round(power * FIRE * mult * rally * shake());
    r.hit[foe] = Math.min(b.hull[foe], hit);
    if (mine === "board") {
      if (clash(mine, theirs) === "win") r.prizes[s] = Math.floor(r.hit[foe] / 2);
      r.boarders[s] = Math.min(b.troops[s], theirs === "withdraw" ? 0 : clash(mine, theirs) === "lose" ? Math.ceil(b.troops[s] / 2) : 1);
    }
  }
  // Pulling back takes half the fire.
  for (const s of SIDES) if (picks[s] === "withdraw") r.hit[s] = Math.ceil(r.hit[s] / 2);
  return r;
}

const rand = (b: PickBattle) => nextRandom(b, "seed");

// One round: both picks in, then the exchange. Throws on an order a side can't pick.
export function playRound(b: PickBattle, picks: PerSide<SpaceOrder>): PickRound {
  if (b.over) throw new Error("The battle is over");
  for (const s of SIDES) { const err = whyNot(b, s, picks[s]); if (err) throw new Error(err); }
  const r = exchange(b, picks, () => rand(b));
  for (const s of SIDES) {
    b.hull[s] = Math.max(0, b.hull[s] - r.hit[s]) + (b.hull[s] - r.hit[s] > 0 ? r.prizes[s] : 0);
    b.top[s] = Math.max(b.top[s], b.hull[s]);
    const down = r.killed[s] + r.boarders[s];
    b.troops[s] = Math.max(0, b.troops[s] - down);
    b.lost[s] += down;
    b.rally[s] = picks[s] === "withdraw";
    b.last[s] = picks[s];
  }
  b.round++;
  b.rounds.push(r);
  const gone = SIDES.find((s) => b.hull[s] <= 0);
  if (gone || b.round >= ROUNDS) {
    const winner: Side = gone ? other(gone) : b.hull.attacker > b.hull.defender ? "attacker" : "defender";
    b.over = {
      id: b.spec.id, winner, picks: true,
      fleets: per((s) => Math.floor(b.hull[s] / HULL_PER_SHIP)),
      heroDown: b.hull[b.spec.hero] <= 0,
      ground: { ...b.lost },
    };
  }
  return r;
}

// Who picks for a side when nobody's picking by hand. The battle stays out of the war layer, so
// the AI's picker (ai.ts) is handed in.
export type Picker = (b: PickBattle, side: Side) => SpaceOrder;

// The whole battle: the hero's picks while they last, the picker for the rest and for the other
// side. Null if one of the hero's picks isn't one they could make.
export function fightPicks(spec: SpaceBattleSpec, hero: SpaceOrder[], pick: Picker): PickBattle | null {
  const b = startPicks(spec), foe = other(spec.hero);
  if (hero.length > ROUNDS) return null;
  while (!b.over) {
    const mine = hero[b.round] ?? pick(b, spec.hero);
    if (whyNot(b, spec.hero, mine)) return null;
    const theirs = pick(b, foe);
    playRound(b, { [spec.hero]: mine, [foe]: theirs } as PerSide<SpaceOrder>);
  }
  return b;
}

// The hero's picks as the result's input log: an order's place in SPACE_ORDERS, a digit a round.
export const encodePicks = (picks: SpaceOrder[]) => picks.map((o) => SPACE_ORDERS.indexOf(o)).join("");
export function decodePicks(log: string): SpaceOrder[] | null {
  if (typeof log !== "string" || log.length > ROUNDS || !/^[0-9]*$/.test(log)) return null;
  const out = [...log].map((d) => SPACE_ORDERS[+d]);
  return out.every(Boolean) ? (out as SpaceOrder[]) : null;
}

// Plays the battle again from the hero's picks. Null if they aren't picks.
export function replayPicks(spec: SpaceBattleSpec, log: string, pick: Picker): SpaceBattleResult | null {
  const hero = decodePicks(log);
  return hero ? fightPicks(spec, hero, pick)?.over ?? null : null;
}
