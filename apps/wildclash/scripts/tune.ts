// Bot-vs-bot, headless: every pairing in the roster, N seeds each, and the win rate per matchup.
// The target is that no pairing is a lock: the underdog wins 40-60% of the time.
//
//   bun scripts/tune.ts            50 matches per pairing
//   bun scripts/tune.ts 200        more
//   bun scripts/tune.ts --each 6   each creature against all 63 others, 6 matches a pairing: its overall win
//                                  rate (the 64-creature table, about 2,000 pairings, in under a minute)
//   bun scripts/tune.ts --fit 6    run --each a few times, nudging each creature's edge (damage dealt) toward a
//                                  50% win rate, and write src/balance.json
import { join } from "node:path";
import { clamp } from "@rustybuns/util";
import { bot } from "../src/bot.ts";
import { ROSTER, type Creature } from "../src/roster.ts";
import { newMatch, step, type Event } from "../src/sim.ts";

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

/** Each creature's win rate against every other, and its worst pairing. */
export function each(n: number) {
  const wins = ROSTER.map(() => 0), worst = ROSTER.map(() => ({ id: "", wins: 1 }));
  for (let i = 0; i < ROSTER.length; i++) for (let j = i + 1; j < ROSTER.length; j++) {
    const w = rate(ROSTER[i]!, ROSTER[j]!, n).wins;
    wins[i]! += w; wins[j]! += 1 - w;
    if (w < worst[i]!.wins) worst[i] = { id: ROSTER[j]!.id, wins: w };
    if (1 - w < worst[j]!.wins) worst[j] = { id: ROSTER[i]!.id, wins: 1 - w };
  }
  return ROSTER.map((c, i) => ({ c, wins: wins[i]! / (ROSTER.length - 1), worst: worst[i]! }));
}

if (import.meta.main) {
  const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4);
  if (process.argv[2] === "--fit") {
    const n = Number(process.argv[3]) || 6, rounds = Number(process.argv[4]) || 5;
    for (let round = 1; round <= rounds; round++) {
      const rows = each(n), off = rows.filter((r) => r.wins < 0.4 || r.wins > 0.6).length;
      console.log(`round ${round}: ${off} off target, spread ${pct(Math.min(...rows.map((r) => r.wins)))}-${pct(Math.max(...rows.map((r) => r.wins)))}`);
      // A nudge, not a jump: halfway in log space toward what would make it even, the same seeds next round.
      for (const { c, wins } of rows) c.edge = Math.round(clamp(c.edge * (0.5 / clamp(wins, 0.05, 0.95)) ** 0.5, 0.4, 2.5) * 1000) / 1000;
    }
    await Bun.write(join(import.meta.dir, "../src/balance.json"), JSON.stringify(Object.fromEntries(ROSTER.map((c) => [c.id, c.edge])), null, 1) + "\n");
    console.log("wrote src/balance.json");
    process.exit(0);
  }
  if (process.argv[2] === "--each") {
    const rows = each(Number(process.argv[3]) || 6).sort((a, b) => b.wins - a.wins);
    for (const { c, wins, worst } of rows) {
      const flag = wins < 0.4 || wins > 0.6 ? "  <- off target" : "";
      console.log(`${c.name.padEnd(20)} ${c.archetype.padEnd(10)} ${String(c.massKg).padStart(5)} kg ${pct(wins)}  worst ${pct(worst.wins)} vs ${worst.id}${flag}`);
    }
    process.exit(0);
  }
  const n = Number(process.argv[2]) || 50;
  for (let i = 0; i < ROSTER.length; i++) for (let j = i + 1; j < ROSTER.length; j++) {
    const a = ROSTER[i]!, b = ROSTER[j]!, r = rate(a, b, n);
    const flag = r.wins < 0.4 || r.wins > 0.6 ? "  <- off target" : "";
    console.log(`${`${a.name} (${a.massKg} kg)`.padEnd(22)} vs ${`${b.name} (${b.massKg} kg)`.padEnd(22)} ${pct(r.wins)}  ring-outs ${pct(r.ringOuts)}  time-outs ${pct(r.time)}  ~${r.seconds.toFixed(0)} s${flag}`);
  }
}
