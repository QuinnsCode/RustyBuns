// Bot-vs-bot, headless: every pairing in the roster, N seeds each, and the win rate per matchup.
// The target is that no pairing is a lock (the underdog wins under 20%); the field chart may still lean one a little.
//
//   bun scripts/tune.ts            50 matches per pairing
//   bun scripts/tune.ts 200        more
//   bun scripts/tune.ts --each     each creature against all the others, 20 matches a pairing: its overall win
//                                  rate, and how many pairings are locks (the 76-creature table, 2,850 pairings: about
//                                  30 s on the office Mac's 8 cores, 10 s with --rust).
//                                  Fewer is noise: at 6 a dead-even pairing still shows 0 or 1 wins 22% of the time, so
//                                  `--each 6` can't score past about 78/100; at 20 that is under 1%.
//   bun scripts/tune.ts --fit 6    run --each a few times, nudging each creature's edge (damage dealt) toward a
//                                  50% win rate, and write src/balance.json
//   --rust                         (with any of the above but --kits) play the fights on the Rust copy of the sim
//                                  (sim-rs/, scripts/sim-rust.ts builds it), bit for bit the same answers. It checks
//                                  first that the build still plays sim.ts's fights tick for tick, and stops if not.
//   bun scripts/tune.ts --teams 10 8 0,3 1,2 1,1.5   the 2v1 table (#4411): every creature as a wild one against 8 pairs
//                                  of friends, 10 matches each, the wild one grown by every mix of 0 or 3 levels past the
//                                  friends (level 10), 1x or 2x the health and 1x or 1.5x the damage: how often two friends
//                                  win and how long it takes, with one friend alone against the same wild one beside it.
//                                  A 7th number fields that many friends (2 to 4). The growth a co-op room gives its wild
//                                  one (journey.ts `outnumbered`) is the row to hold near even.
//   bun scripts/tune.ts --kits 4   each field's big move (moves.ts KIT): damage it lands per energy spent, from bot fights
//                                  of every creature carrying it against every fifth one; the bigs should sit about level
import { join } from "node:path";
import { clamp } from "@rustybuns/util";
import { arr, num, obj } from "@rustybuns/util/guard";
import { bot } from "../src/bot.ts";
import { ROSTER, type Creature } from "../src/roster.ts";
import { FIELDS, type Field } from "../src/fields.ts";
import { atLevel } from "../src/journey.ts";
import { newMatch, newTeamMatch, step, type Event } from "../src/sim.ts";
import { drift, rustRates, type Fight } from "./sim-rust.ts";
import { help } from "../../../scripts/help.ts";

export function play(a: Creature, b: Creature, seed: number) {
  const m = newMatch(a, b), bots = [bot(0, seed), bot(1, seed * 7 + 1)] as const;
  let ko: Event | undefined;
  while (!m.over) { step(m, [bots[0](m), bots[1](m)]); ko ??= m.events.find((e) => e.kind === "ko"); }
  return { winner: m.winner!, ticks: m.tick, ko };
}

export function rate(a: Creature, b: Creature, n: number) {
  let wins = 0, ringOuts = 0, time = 0, ticks = 0;
  for (let s = 1; s <= n; s++) {
    // Swap sides every other match so the spawn doesn't pick the winner.
    const flip = s % 2 === 0, r = flip ? play(b, a, s) : play(a, b, s);
    if (r.winner === (flip ? 1 : 0)) wins++;
    if (r.ko?.kind === "ko" && r.ko.how === "ring-out") ringOuts++;
    if (r.ko?.kind === "ko" && r.ko.how === "time") time++;
    ticks += r.ticks;
  }
  return { wins: wins / n, ringOuts: ringOuts / n, time: time / n, seconds: ticks / n / 60 };
}

/** `play` for a team a side (#4411): a bot a fighter, the first seeded `seed` and fighter k `seed * 7 + k`, as sim-rs's
 * play_teams. One on one it is `play`, seed for seed. */
export function playTeams(a: Creature[], b: Creature[], seed: number) {
  const m = newTeamMatch([a, b]), bots = m.f.map((_, k) => bot(k, k ? seed * 7 + k : seed));
  let ko: Event | undefined;
  while (!m.over) { step(m, bots.map((x) => x(m))); ko ??= m.events.find((e) => e.kind === "ko"); }
  return { winner: m.winner!, ticks: m.tick, ko };
}
/** `rate` for a team a side: the wins are the first team's, sides swapped every other match. */
export function rateTeams(a: Creature[], b: Creature[], n: number) {
  let wins = 0, ringOuts = 0, time = 0, ticks = 0;
  for (let s = 1; s <= n; s++) {
    const flip = s % 2 === 0, r = flip ? playTeams(b, a, s) : playTeams(a, b, s);
    if (r.winner === (flip ? 1 : 0)) wins++;
    if (r.ko?.kind === "ko" && r.ko.how === "ring-out") ringOuts++;
    if (r.ko?.kind === "ko" && r.ko.how === "time") time++;
    ticks += r.ticks;
  }
  return { wins: wins / n, ringOuts: ringOuts / n, time: time / n, seconds: ticks / n / 60 };
}

/** The level the 2v1 table's friends fight at: atLevel's own scale is 1 here, so a friend is its roster self. */
export const BASE = 10;
/** How the 2v1 table grows the lone side: `up` levels past the friends, `hp` times the health, `edge` times the damage. */
export interface Grow { up: number; hp: number; edge: number }
const lone = (c: Creature, g: Grow): Creature => { const w = atLevel(c, BASE + g.up, true); return g.hp === 1 && g.edge === 1 ? w : { ...w, hpScale: g.hp, edge: w.edge * g.edge }; };
/** A team fight's two sides from ROSTER indices: the friends at BASE, the lone side grown by `g`, as a wild one. */
export const teamSides = (t: [number[], number[]], g: Grow): [Creature[], Creature[]] =>
  [t[0].map((i) => atLevel(ROSTER[i]!, BASE)), t[1].map((i) => lone(ROSTER[i]!, g))];
/** Every creature as the wild one, against `per` teams of `friends` spread over the roster (never itself, never a team twice). */
export function teamFights(per: number, friends = 2): [number[], number[]][] {
  const len = ROSTER.length, steps = [11, 23, 31, 37];
  return ROSTER.flatMap((_, w) => {
    const out: [number[], number[]][] = [], seen = new Set<string>();
    for (let k = 0; out.length < per && k < per * 8; k++) {
      const team = steps.slice(0, friends).map((st, q) => (w + 1 + q * 4 + k * st) % len), key = [...team].sort((x, y) => x - y).join();
      if (!team.includes(w) && new Set(team).size === friends && !seen.has(key)) { seen.add(key); out.push([team, [w]]); }
    }
    return out;
  });
}

/** Below this the underdog of a pairing is locked out: it almost never wins, whatever its overall rate. */
export const LOCK = 0.2;

export type Rate = ReturnType<typeof rate>;
const Rates = arr(obj({ wins: num(0, 1), ringOuts: num(0, 1), time: num(0, 1), seconds: num(0, 1e6) }), 100_000);

/** Every pairing of the roster (indices, i < j). */
export const allPairs = () => ROSTER.flatMap((_, i) => ROSTER.slice(i + 1).map((_, k) => [i, i + 1 + k] as [number, number]));

/** `rate` for each pairing of ROSTER indices with the roster's edges as they stand: spread over `threads` Bun workers
 * (scripts/tune-worker.ts; each takes a batch, posts it back, and takes the next), or with `rust` on the Rust sim. */
export async function rates(pairs: [number, number][], n: number, { threads = navigator.hardwareConcurrency, rust = false } = {}): Promise<Rate[]> {
  if (rust) { await checked(); return rustRates(pairs, n); }
  return fanOut(pairs, threads, (batch) => ({ pairs: batch, n }));
}

/** `rateTeams` for each team fight (ROSTER indices, `teamSides` grown by `grow`): over the Bun workers, or with `rust` on
 * the Rust sim, its roster the friends at BASE then the grown wild ones. */
export async function teamRates(fights: [number[], number[]][], n: number, { threads = navigator.hardwareConcurrency, rust = false, grow = { up: 0, hp: 1, edge: 1 } as Grow } = {}): Promise<Rate[]> {
  if (rust) {
    await checked();
    const len = ROSTER.length, cs = [...ROSTER.map((c) => atLevel(c, BASE)), ...ROSTER.map((c) => lone(c, grow))];
    return rustRates(fights.map(([a, b]): Fight => [a, b.map((i) => i + len)]), n, cs);
  }
  return fanOut(fights, threads, (batch) => ({ pairs: [], teams: batch, grow, n }));
}

/** Items in batches over `threads` Bun workers (scripts/tune-worker.ts), each batch's rates back in order. */
async function fanOut<T>(items: T[], threads: number, message: (batch: T[]) => object): Promise<Rate[]> {
  const out: Rate[] = new Array(items.length), size = Math.max(1, Math.min(32, Math.ceil(items.length / threads / 4)));
  const edges = ROSTER.map((c) => c.edge);
  let next = 0;
  const work = async () => {
    const w = new Worker(new URL("./tune-worker.ts", import.meta.url));
    try {
      while (next < items.length) {
        const from = next, batch = items.slice(from, (next += size));
        const got = await new Promise<unknown>((ok, fail) => { w.onmessage = (e) => ok(e.data); w.onerror = (e) => fail(e); w.postMessage({ edges, ...message(batch) }); });
        Rates(got).forEach((r, k) => { out[from + k] = r; });
      }
    } finally { w.terminate(); }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(threads, items.length)) }, work));
  return out;
}

let rustChecked: Promise<void> | undefined;
/** Once a run: the Rust build plays a sample of sim.ts's fights tick for tick, or the run stops before trusting it. */
const checked = () => (rustChecked ??= drift().then((d) => {
  if (d) throw new Error(`the Rust sim parts from sim.ts (${d.pair.join(" vs ")}, seed ${d.seed}, tick ${d.tick}): port the change to sim-rs/ and rebuild (bun scripts/sim-rust.ts), or run without --rust`);
}));

/** Each creature's win rate against every other, its worst pairing, and how many pairings lock it out. */
export async function each(n: number, o?: { threads?: number; rust?: boolean }) {
  const wins = ROSTER.map(() => 0), worst = ROSTER.map(() => ({ id: "", wins: 1 })), locks = ROSTER.map(() => 0);
  const pairs = allPairs(), got = await rates(pairs, n, o);
  for (const [k, [i, j]] of pairs.entries()) {
    const w = got[k]!.wins;
    wins[i]! += w; wins[j]! += 1 - w;
    if (w < worst[i]!.wins) worst[i] = { id: ROSTER[j]!.id, wins: w };
    if (1 - w < worst[j]!.wins) worst[j] = { id: ROSTER[i]!.id, wins: 1 - w };
    if (w < LOCK) locks[i]!++;
    if (1 - w < LOCK) locks[j]!++;
  }
  return ROSTER.map((c, i) => ({ c, wins: wins[i]! / (ROSTER.length - 1), worst: worst[i]!, locks: locks[i]! }));
}

/** Per field, what its big (the beam slot) lands per point of energy spent on it, and how often it is fired. */
export function kits(n: number) {
  const tally = new Map<Field, { damage: number; spent: number; uses: number; fights: number }>(FIELDS.map((f) => [f, { damage: 0, spent: 0, uses: 0, fights: 0 }]));
  const field = ROSTER.filter((_, i) => i % 5 === 0);
  for (const a of ROSTER) for (const b of field) if (a.id !== b.id) for (let s = 1; s <= n; s++) {
    const m = newMatch(a, b), bots = [bot(0, s), bot(1, s * 7 + 1)] as const, t = tally.get(m.f[0].moves.beam.field)!;
    let before = m.f[0].energy;
    t.fights++;
    while (!m.over) {
      step(m, [bots[0](m), bots[1](m)]);
      const me = m.f[0];
      if (me.act?.move.slot === "beam") t.spent += Math.max(0, before - me.energy);
      before = me.energy;
      for (const e of m.events) {
        if (e.kind === "hit" && e.by === 0 && e.on === 1 && e.slot === "beam") t.damage += e.damage;
        if (e.kind === "move" && e.by === 0 && e.move.slot === "beam") t.uses++;
      }
    }
  }
  return FIELDS.map((f) => { const t = tally.get(f)!; return { field: f, perEnergy: t.damage / Math.max(1, t.spent), perFight: t.uses / Math.max(1, t.fights), fights: t.fights }; });
}

if (import.meta.main) {
  help(import.meta.path);
  const rust =process.argv.includes("--rust"), args = process.argv.slice(2).filter((a) => a !== "--rust");
  if (args[0] === "--kits") {
    const rows = kits(Number(args[1]) || 4), mid = rows.map((r) => r.perEnergy).sort((a, b) => a - b)[rows.length >> 1]!;
    for (const r of rows) console.log(`${r.field.padEnd(7)} ${r.perEnergy.toFixed(2).padStart(5)} damage/energy (${Math.round((r.perEnergy / mid) * 100)}% of the median)  ${r.perFight.toFixed(1)} bigs a fight  ${r.fights} fights`);
    process.exit(0);
  }
  const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4);
  if (args[0] === "--fit") {
    const n = Number(args[1]) || 6, rounds = Number(args[2]) || 5;
    for (let round = 1; round <= rounds; round++) {
      const rows = await each(n, { rust }), off = rows.filter((r) => r.wins < 0.4 || r.wins > 0.6).length;
      console.log(`round ${round}: ${off} off target, spread ${pct(Math.min(...rows.map((r) => r.wins)))}-${pct(Math.max(...rows.map((r) => r.wins)))}`);
      // A nudge, not a jump: halfway in log space toward what would make it even, the same seeds next round.
      for (const { c, wins } of rows) c.edge = Math.round(clamp(c.edge * (0.5 / clamp(wins, 0.05, 0.95)) ** 0.5, 0.4, 2.5) * 1000) / 1000;
    }
    await Bun.write(join(import.meta.dir, "../src/balance.json"), JSON.stringify(Object.fromEntries(ROSTER.map((c) => [c.id, c.edge])), null, 1) + "\n");
    console.log("wrote src/balance.json");
    process.exit(0);
  }
  if (args[0] === "--teams") {
    const n = Number(args[1]) || 10, per = Number(args[2]) || 8, list = (a: string | undefined, d: string) => (a ?? d).split(",").map(Number);
    const grows = list(args[3], "0").flatMap((up) => list(args[4], "1").flatMap((hp) => list(args[5], "1").map((edge): Grow => ({ up, hp, edge }))));
    const friends = Number(args[6]) || 2, fights = teamFights(per, friends), solo = fights.map(([a, b]): [number[], number[]] => [[a[0]!], b]);
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;
    console.log(`${ROSTER.length} wild ones x ${per} teams of ${friends} friends (level ${BASE}), ${n} matches each${rust ? ", on the Rust sim" : ""}`);
    for (const grow of grows) {
      const [two, one] = await Promise.all([teamRates(fights, n, { rust, grow }), teamRates(solo, n, { rust, grow })]);
      // Per wild one: how often two friends beat it, and how often one of them alone does.
      const byWild = ROSTER.map((_, w) => { const ks = fights.flatMap(([, b], k) => (b[0] === w ? [k] : [])); return { w, two: ks.reduce((t, k) => t + two[k]!.wins, 0) / ks.length, one: ks.reduce((t, k) => t + one[k]!.wins, 0) / ks.length }; });
      const walk = byWild.filter((r) => r.two >= 1 - LOCK).length, secs = (rs: Rate[]) => rs.reduce((t, r) => t + r.seconds, 0) / rs.length;
      const outs = (rs: Rate[]) => rs.reduce((t, r) => t + r.ringOuts, 0) / rs.length;
      console.log(`wild +${String(grow.up).padStart(2)} lv, ${grow.hp}x hp, ${grow.edge}x dmg: ${friends} friends win ${pct(median(byWild.map((r) => r.two)))} (median wild one), ~${secs(two).toFixed(0)} s, ring-outs ${pct(outs(two))}; one alone ${pct(median(byWild.map((r) => r.one)))}, ~${secs(one).toFixed(0)} s; walkovers (friends win ${pct(1 - LOCK).trim()}+) ${walk} of ${ROSTER.length}`);
    }
    process.exit(0);
  }
  if (args[0] === "--each") {
    const rows = (await each(Number(args[1]) || 20, { rust })).sort((a, b) => b.wins - a.wins);
    for (const { c, wins, worst, locks } of rows) {
      const flag = wins < 0.4 || wins > 0.6 ? "  <- off target" : "";
      console.log(`${c.name.padEnd(20)} ${c.archetype.padEnd(10)} ${String(c.massKg).padStart(5)} kg ${pct(wins)}  worst ${pct(worst.wins)} vs ${worst.id}  locked out of ${locks}${flag}`);
    }
    // The pairing score: every creature can be about even overall (--fit) while single pairings stay locks.
    const pairs = (rows.length * (rows.length - 1)) / 2, locked = rows.reduce((t, r) => t + r.locks, 0);
    console.log(`${locked} of ${pairs} pairings are locks (underdog under ${pct(LOCK).trim()}): score ${Math.round((1 - locked / pairs) * 100)}/100`);
    process.exit(0);
  }
  const n = Number(args[0]) || 50, pairs = allPairs(), got = await rates(pairs, n, { rust });
  for (const [k, [i, j]] of pairs.entries()) {
    const a = ROSTER[i]!, b = ROSTER[j]!, r = got[k]!;
    const flag = r.wins < 0.4 || r.wins > 0.6 ? "  <- off target" : "";
    console.log(`${`${a.name} (${a.massKg} kg)`.padEnd(22)} vs ${`${b.name} (${b.massKg} kg)`.padEnd(22)} ${pct(r.wins)}  ring-outs ${pct(r.ringOuts)}  time-outs ${pct(r.time)}  ~${r.seconds.toFixed(0)} s${flag}`);
  }
}
