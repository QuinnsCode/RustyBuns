// Bot-vs-bot, headless: every pairing in the roster, N seeds each, and the win rate per matchup.
// The target is that no pairing is a lock: the underdog wins 40-60% of the time.
//
//   bun scripts/tune.ts            50 matches per pairing
//   bun scripts/tune.ts 200        more
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

if (import.meta.main) {
  const n = Number(process.argv[2]) || 50;
  const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4);
  for (let i = 0; i < ROSTER.length; i++) for (let j = i + 1; j < ROSTER.length; j++) {
    const a = ROSTER[i]!, b = ROSTER[j]!, r = rate(a, b, n);
    const flag = r.wins < 0.4 || r.wins > 0.6 ? "  <- off target" : "";
    console.log(`${`${a.name} (${a.massKg} kg)`.padEnd(22)} vs ${`${b.name} (${b.massKg} kg)`.padEnd(22)} ${pct(r.wins)}  ring-outs ${pct(r.ringOuts)}  time-outs ${pct(r.time)}  ~${r.seconds.toFixed(0)} s${flag}`);
  }
}
