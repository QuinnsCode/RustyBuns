// Headless balance runner: `bun scripts/balance.ts [human]`. Plays every sector, seeds 1-3, both
// ways round (Thunder Marines attack, then Wooka attack), and prints who won. "human" puts a simple scripted
// player (charges the nearest foe, fires) in the hero's seat, once per side.
import type { BattleSpec, Faction, SectorKind, Side } from "../src/battle/contract.ts";
import { handicapped } from "../src/battle/handicap.ts";
import { COMMAND, FOCUS_R, ORDER_FOR, POST_RADIUS, heroUnit, startBattle, step, timeLimit, type Battle, type Input, type OrderKind } from "../src/battle/sim.ts";

export const SECTORS: SectorKind[] = ["shield", "capital", "spaceport", "cannon", "canyon", "jungle"];
export const SEEDS = [1, 2, 3];

// handicap: the hero's foe fields that much more (0.4 = 40% more armies and tickets); with no
// hero, the attacker does (the force-edge check).
export const specFor = (sector: SectorKind, seed: number, attacker: Faction, hero: Side | null, handicap = 0): BattleSpec => handicapped({
  id: `bal-${sector}-${seed}`, turn: 1, system: "Kessa", sector,
  factions: { attacker, defender: attacker === "marines" ? "wooka" : "marines" },
  hero: hero ?? "attacker", heroLevel: 1,
  armies: { attacker: 3, defender: 3 }, tickets: { attacker: 150, defender: 150 },
  vehicles: { attacker: { tank: 1 }, defender: { tank: 1 } }, strikes: { attacker: 1, defender: 1 },
  reinforcements: { attacker: 0, defender: 0 }, turrets: sector === "shield" || sector === "cannon" ? 2 : 1, seed,
}, hero === "defender" || hero === null ? "attacker" : "defender", handicap);

// A passable player: runs at the nearest foe in range, fires, otherwise walks to the nearest post
// not yet theirs. With `orders` it also leads its squad, the way a player who minds their people
// does: focus fire on the foe it's fighting, hold a post of theirs when the fight comes to it, and
// forward to the next post between fights; a fresh order every half order-span, or when the
// squad's drifted out of earshot.
export function bot(b: Battle, orders = false): Input | null {
  const h = heroUnit(b);
  if (!h) return { forward: 0, right: 0, yaw: 0, fire: false };
  const near = (p: { x: number; z: number }) => Math.hypot(p.x - h.x, p.z - h.z);
  let foe = null as Battle["units"][number] | null, best = 60;
  for (const u of b.units) if (u.side !== h.side && u.hp > 0 && near(u) < best) { best = near(u); foe = u; }
  const post = b.posts.filter((p) => p.owner !== h.side).sort((p, q) => near(p) - near(q))[0] ?? b.posts[0]!;
  const to = foe ?? post, yaw = Math.atan2(-(to.x - h.x), -(to.z - h.z));
  const input: Input = { forward: foe && best < 12 ? 0 : 1, right: 0, yaw, fire: !!foe };
  if (orders && ((b.order?.at ?? -ORDER_FOR) + ORDER_FOR / 2 <= b.time || !b.units.some((u) => b.order!.ids.includes(u.id) && near(u) < COMMAND))) {
    const held = b.posts.find((p) => p.owner === h.side && near(p) < POST_RADIUS);
    const kind: OrderKind = foe && held ? "hold" : foe && best < FOCUS_R * 2 ? "focus" : "forward";
    input.order = { kind, x: to.x, z: to.z };
  }
  return input;
}

export interface Played { winner: Side; time: number; tickets: Record<Side, number>; taken: number }
export function play(spec: BattleSpec, human: boolean, orders = false): Played {
  const b = startBattle(spec);
  const everHeld = new Set<number>();
  while (!b.over && b.time < timeLimit(spec)) {
    step(b, human ? bot(b, orders) : null);
    b.posts.forEach((p, i) => { if (p.owner === "attacker") everHeld.add(i); });
  }
  const o = b.over ?? { winner: (b.tickets.attacker > b.tickets.defender ? "attacker" : "defender") as Side };
  return { winner: o.winner, time: Math.round(b.time), tickets: { attacker: Math.round(b.tickets.attacker), defender: Math.round(b.tickets.defender) }, taken: everHeld.size };
}

// Thunder Marines' share of wins across every sector and seed, with Thunder Marines attacking and defending.
export function marineWins(human: "none" | "marines" | "wooka", seeds = SEEDS) {
  let wins = 0, n = 0;
  const rows: string[] = [], bySector: Partial<Record<SectorKind, number>> = {};
  for (const sector of SECTORS) for (const seed of seeds) for (const att of ["marines", "wooka"] as Faction[]) {
    const heroSide: Side | null = human === "none" ? null : (att === human) === true ? "attacker" : "defender";
    const r = play(specFor(sector, seed, att, heroSide), heroSide !== null);
    const marinesWon = (r.winner === "attacker") === (att === "marines");
    wins += marinesWon ? 1 : 0; n++;
    bySector[sector] = (bySector[sector] ?? 0) + (marinesWon ? 1 : 0);
    rows.push(`${sector.padEnd(10)} ${seed} ${att.padEnd(7)} attacks: ${marinesWon ? "Marines" : "Wooka  "} win  t:${String(r.time).padStart(4)} att-posts:${r.taken}`);
  }
  return { wins, n, rows, bySector };
}

if (import.meta.main) {
  const mode = process.argv[2] ?? "none";
  const kinds = mode === "human" ? (["marines", "wooka"] as const) : (["none"] as const);
  for (const k of kinds) {
    const r = marineWins(k);
    console.log(`--- hero: ${k}\n${r.rows.join("\n")}\nThunder Marines won ${r.wins}/${r.n}`);
  }
}
