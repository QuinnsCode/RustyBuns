// The levels card of the "levels that make sense" climb (#5382): five checks on the journey's numbers, one line each
// with its rate, its pass band and the points it earns (part credit by the share that passes), then the total out of 5.
// Nothing here changes the game: it reads journey.ts, tiers.ts and the roads, and plays bot fights on the sim.
//
//   bun run levels            15 fights a cell: about a minute on the office Mac
//   bun run levels 45         more fights a cell, steadier rates (about three minutes)
//   bun run levels 15 --why   each check's cells that miss, under its line
//
// L1  A level is worth the same everywhere: a starter against itself, 3 levels up wins 60-75% and 8 up wins 85%+,
//     at levels 5, 30 and 60; and no stat sits on the 255 cap (keeper or your lead) before the last boss.
// L2  A fair fight at every stone: the line-up at pace wins a keeper 55-85% and a boss 35-60% on a first try, for each
//     starter as the lead. A cell is one stone with one lead.
// L3  The road never jumps: over every order the roads allow, the next trail starts within 2 levels of the boss
//     just beaten. A cell is one step of one order.
// L4  The whole line-up keeps pace: on the keepers plus 12 dens a region, each beast stands within 2 levels of the
//     stone it comes to. A cell is one beast at one stone.
// L5  You meet things in order: each boss is first met in its own region, a keeper's tier fits its stone (a boss is
//     `mythic`, the stones before it hold nothing of a legendary's standing or over), and the far south has an end.
//
// How a player is modelled, from the game as it plays: the road is the lowest-numbered open region first (ROUTE);
// XP goes to the beast that ends the fight (`award`, the one place a later round swaps for the game's own rule);
// "at pace" is your lead after every keeper so far and one den a section, with the other two starters behind it at
// the level they began; a fight lost by one beast goes on with the next against the foe's health as it was left.
import { shareXp, START_LEVEL as START, PARTY_FIRST, PARTY_MAX, SECTIONS, atLevel, baseLevel, sections, sectionLevel, STARTERS, type Member } from "../src/journey.ts";
import { REGIONS } from "../src/regions.ts";
import { creature, type Creature } from "../src/roster.ts";
import { bot } from "../src/bot.ts";
import { newMatch, step } from "../src/sim.ts";
import { TIER_LEVEL, tierOf } from "../src/tiers.ts";
import { openRegions, road, wildLevel } from "../src/world/world.ts";
import { rate } from "./tune.ts";
import { help } from "../../../scripts/help.ts";

/** The pass bands, as win rates and level gaps. */
export const BANDS = { up3: [0.6, 0.75], up8: [0.85, 1], keeper: [0.55, 0.85], boss: [0.35, 0.6], gap: 2, dens: 12 } as const;
const within = (x: number, [lo, hi]: readonly [number, number]) => x >= lo && x <= hi;
const CAP = 255;
const STATS = ["vigor", "might", "guard", "focus", "will"] as const;

const PLAYABLE = REGIONS.filter((g) => g.tier === "playable").map((g) => g.n);
const region = (n: number) => REGIONS.find((g) => g.n === n)!;
const bossLevel = (n: number) => sectionLevel(n, SECTIONS - 1);

/** Every order the roads allow you to beat the playable regions in (gates open: a flier is in the line-up). */
export function orders(): number[][] {
  const out: number[][] = [];
  const go = (done: number[]) => {
    if (done.length === PLAYABLE.length) { out.push(done); return; }
    const open = openRegions(new Set(done));
    for (const n of PLAYABLE) if (open.has(n) && !done.includes(n)) go([...done, n]);
  };
  go([]);
  return out;
}
/** The road a player who takes the lowest-numbered open region each time walks: region 1 first. */
export const route = road;

export interface Stone { n: number; k: number; keeper: string; wilds: string[]; level: number; boss: boolean }
/** Every stone of the road, in the order it is walked. */
export const stones = (road = route()): Stone[] =>
  road.flatMap((n) => sections(region(n)).map((s) => ({ n, k: s.k, keeper: s.keeper, wilds: s.wilds, level: s.level, boss: s.k === SECTIONS - 1 })));

/** Who earns a won fight's XP, as the game gives it (`shareXp`): the beast that ended it all, the rest half. */
export function award(party: Member[], finisher: number, foeLevel: number) { shareXp(party, party[finisher]!, foeLevel); }
const member = (id: string, level: number): Member => ({ id, level, xp: 0 });
/** A den's wild one in region n: the middle roll of `wildLevel`. */
const denLevel = (n: number) => wildLevel(n, 0.5);

/** The lead's level as it comes to each stone: every keeper so far and one den a section, all won by the lead. */
export function pace(road = route()): number[] {
  const party = [member("lead", START)];
  return stones(road).map((s) => {
    award(party, 0, denLevel(s.n));
    const at = party[0]!.level;
    award(party, 0, s.level);
    return at;
  });
}

/** One fight as the game plays it: you are the first fighter, and the foe starts with `foeHp` when one before you wore it down. */
function fight(me: Creature, foe: Creature, seed: number, foeHp?: number) {
  const m = newMatch(me, foe), bots = [bot(0, seed), bot(1, seed * 7 + 1)] as const;
  if (foeHp !== undefined) m.f[1].hp = foeHp;
  while (!m.over) step(m, [bots[0](m), bots[1](m)]);
  return { won: m.winner === 0, foeHp: m.f[1].hp };
}
/** A first try at a stone: the line-up one after another against the same foe. */
export function firstTry(team: Creature[], foe: Creature, seed: number): boolean {
  let hp: number | undefined;
  for (const [i, c] of team.entries()) {
    const r = fight(c, foe, seed * 31 + i, hp);
    if (r.won) return true;
    hp = r.foeHp;
  }
  return false;
}

export interface Check { id: string; name: string; rate: number; band: string; points: number; detail: string; misses: string[] }
const check = (id: string, name: string, rate: number, band: string, detail: string, misses: string[]): Check =>
  ({ id, name, rate, band, points: Math.round(rate * 100) / 100, detail, misses });
const share = (xs: boolean[]) => (xs.length ? xs.filter(Boolean).length / xs.length : 0);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const capped = (c: Creature) => STATS.filter((s) => c.stats[s] >= CAP);

/** L1: the same beast against itself some levels up, and nothing on the stat cap before the last boss. */
export function l1(seeds: number, leads: readonly string[] = STARTERS): Check {
  const misses: string[] = [], ups = ([3, 8] as const).map((up) => [5, 30, 60].flatMap((level) => leads.map((id) => {
    const c = creature(id), wins = rate(atLevel(c, level + up), atLevel(c, level), seeds).wins, ok = within(wins, up === 3 ? BANDS.up3 : BANDS.up8);
    if (!ok) misses.push(`${id} level ${level + up} against level ${level}: wins ${pct(wins)}`);
    return ok;
  })));
  const all = stones(), at = pace(), before = all.slice(0, -1);
  const caps = before.flatMap((s, i) => [
    [`${s.keeper} (keeper, level ${s.level}, region ${s.n} stone ${s.k + 1})`, atLevel(creature(s.keeper), s.level)] as const,
    ...leads.map((id) => [`${id} (your lead, level ${at[i]}, region ${s.n} stone ${s.k + 1})`, atLevel(creature(id), at[i]!)] as const),
  ]).map(([who, c]) => { const on = capped(c); if (on.length) misses.push(`${who}: ${on.join(", ")} on the cap`); return !on.length; });
  const parts = [share(ups[0]!), share(ups[1]!), share(caps)];
  return check("L1", "A level is worth the same everywhere", (parts[0]! + parts[1]! + parts[2]!) / 3, "3 up wins 60-75%, 8 up wins 85%+, no stat on 255",
    `3 up in band ${pct(parts[0]!)} of ${ups[0]!.length}, 8 up in band ${pct(parts[1]!)} of ${ups[1]!.length}, off the cap ${pct(parts[2]!)} of ${caps.length}`, misses);
}

/** L2: each starter as the lead at pace, the other two behind it, a first try at every stone. */
export function l2(seeds: number, leads: readonly string[] = STARTERS): Check {
  const all = stones(), at = pace(), misses: string[] = [], rates = { keeper: [] as number[], boss: [] as number[] };
  const cells = all.flatMap((s, i) => {
    const foe = atLevel(creature(s.keeper), s.level, true), band = s.boss ? BANDS.boss : BANDS.keeper;
    return leads.map((id) => {
      const back = STARTERS.filter((o) => o !== id).slice(0, PARTY_FIRST - 1).map((o) => atLevel(creature(o), START));
      const team = [atLevel(creature(id), at[i]!), ...back];
      let wins = 0;
      for (let seed = 1; seed <= seeds; seed++) if (firstTry(team, foe, seed + i * 101)) wins++;
      const w = wins / seeds, ok = within(w, band);
      rates[s.boss ? "boss" : "keeper"].push(w);
      if (!ok) misses.push(`region ${s.n} stone ${s.k + 1} ${s.keeper} (level ${s.level}) against ${id} (level ${at[i]}): wins ${pct(w)}, band ${pct(band[0])}-${pct(band[1])}`);
      return ok;
    });
  });
  const mean = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / Math.max(1, xs.length);
  return check("L2", "A fair fight at every stone", share(cells), "keepers 55-85%, bosses 35-60%, on a first try",
    `${cells.filter(Boolean).length} of ${cells.length} in band (${all.length} stones x ${leads.length} leads); a keeper is won ${pct(mean(rates.keeper))} of the time, a boss ${pct(mean(rates.boss))}`, misses);
}

/** L3: every order the roads allow; each step from a boss beaten to the trail walked next. */
export function l3(): Check {
  const all = orders(), misses = new Set<string>();
  const steps = all.flatMap((o) => o.slice(1).map((n, i) => {
    const from = o[i]!, gap = baseLevel(n) - bossLevel(from), ok = Math.abs(gap) <= BANDS.gap;
    if (!ok) misses.add(`region ${from} (boss level ${bossLevel(from)}) then region ${n} (starts at ${baseLevel(n)}): ${gap > 0 ? "+" : ""}${gap} levels`);
    return ok;
  }));
  const whole = all.filter((o) => o.slice(1).every((n, i) => Math.abs(baseLevel(n) - bossLevel(o[i]!)) <= BANDS.gap)).length;
  const road = route(), best = share(road.slice(1).map((n, i) => Math.abs(baseLevel(n) - bossLevel(road[i]!)) <= BANDS.gap));
  return check("L3", "The road never jumps", share(steps), `the next trail starts within ${BANDS.gap} levels of the boss just beaten`,
    `${pct(share(steps))} of the steps over ${all.length} orders; ${whole} orders never jump; the lowest-first road ${road.join(", ")} keeps ${pct(best)} of its steps`, [...misses].sort());
}

/** The line-up's levels at each stone when every fight's XP goes to whoever is furthest behind: the keepers and `dens` dens a region. */
export function lineup(dens: number, road = route()): { stone: Stone; levels: number[] }[] {
  const party = STARTERS.slice(0, PARTY_FIRST).map((id) => member(id, START)), out: { stone: Stone; levels: number[] }[] = [];
  const last = () => party.reduce((b, m, i) => (m.level < party[b]!.level ? i : b), 0);
  for (const s of stones(road)) {
    // a slot opened by the last boss is filled at this trail's first stone, by a beast bound there at its level
    if (s.k === 0 && s.n !== road[0] && party.length < PARTY_MAX) party.push(member(s.keeper, s.level));
    for (let d = 0; d < dens / SECTIONS; d++) award(party, last(), denLevel(s.n));
    out.push({ stone: s, levels: party.map((m) => m.level) });
    award(party, last(), s.level);
  }
  return out;
}
/** L4: the share of beasts within the gap of each stone on the keepers plus the dens allowed. */
export function l4(): Check {
  const rateAt = (dens: number) => share(lineup(dens).flatMap((r) => r.levels.map((l) => l >= r.stone.level - BANDS.gap)));
  let need = BANDS.dens;
  while (need < 600 && rateAt(need) < 1) need += SECTIONS;
  const rows = lineup(BANDS.dens), misses = rows.filter((r) => r.stone.boss).map((r) => `region ${r.stone.n} boss (level ${r.stone.level}): the line-up stands at ${r.levels.join(", ")}`);
  return check("L4", "The whole line-up keeps pace without a grind", rateAt(BANDS.dens), `each beast within ${BANDS.gap} levels of the stone on the keepers plus ${BANDS.dens} dens a region`,
    `${pct(rateAt(BANDS.dens))} of beast-stones in pace; to keep every one in pace takes ${need >= 600 ? "over 600" : need} dens a region (a den is level ${denLevel(1)} in region 1, ${denLevel(8)} in region 8)`, misses);
}

/** L5: bosses first met at home, tiers that fit their stones, and an end to the far south. */
export function l5(): Check {
  const all = stones(), misses: string[] = [];
  const home = all.filter((s) => s.boss).map((b) => {
    const first = all.find((s) => s.keeper === b.keeper || s.wilds.includes(b.keeper))!, ok = first.n === b.n;
    if (!ok) misses.push(`${b.keeper} (boss of region ${b.n}, level ${b.level}) is first met in region ${first.n} at stone ${first.k + 1}, level ${first.level}`);
    return ok;
  });
  const fits = all.map((s) => {
    const t = tierOf(s.keeper), ok = s.boss ? t === "mythic" : TIER_LEVEL[t] < TIER_LEVEL.legendary;
    if (!ok) misses.push(s.boss ? `region ${s.n}'s boss ${s.keeper} is ${t}, and the game calls it the region's mythic` : `region ${s.n} stone ${s.k + 1} (level ${s.level}) is kept by ${s.keeper}, a ${t}`);
    return ok;
  });
  const south = REGIONS.filter((g) => g.tier === "high-level"), ends = south.some((g) => sections(g).length > 0);
  if (!ends) misses.push(`none of the far south's ${south.length} regions has a boss or a cleared state`);
  return check("L5", "You meet things in order", (share(home) + share(fits) + (ends ? 1 : 0)) / 3, "bosses first met at home, tiers fit their stones, the far south ends",
    `${home.filter(Boolean).length} of ${home.length} bosses first met at home, ${fits.filter(Boolean).length} of ${fits.length} stones hold a tier that fits, the far south ${ends ? "has" : "has no"} end`, misses);
}

/** The whole card: the five checks and their total out of 5. `leads` narrows the starters played (a test's quick run). */
export function levels(seeds: number, leads: readonly string[] = STARTERS): { checks: Check[]; total: number } {
  const checks = [l1(seeds * 2, leads), l2(seeds, leads), l3(), l4(), l5()];
  return { checks, total: Math.round(checks.reduce((t, c) => t + c.points, 0) * 100) / 100 };
}

if (import.meta.main) {
  help(import.meta.path);
  const args = process.argv.slice(2), why = args.includes("--why"), seeds = Number(args.find((a) => /^\d+$/.test(a))) || 15;
  const t0 = performance.now(), card = levels(seeds);
  console.log(`The levels card (#5382): ${seeds} fights a cell, the road ${route().join(", ")}`);
  for (const c of card.checks) {
    console.log(`${c.id}  ${c.name.padEnd(46)} ${pct(c.rate).padStart(4)}  ${c.points.toFixed(2)} of 1   pass: ${c.band}`);
    console.log(`    ${c.detail}`);
    if (why) for (const m of c.misses) console.log(`      - ${m}`);
  }
  console.log(`Levels: ${card.total.toFixed(2)} of 5   (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
}
