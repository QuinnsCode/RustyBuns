// Pre-verification of the jump-link battles: `bun scripts/preverify.ts [seeds=8]`. For every world, side and hero the
// jump link names, plays the scripted player (leading its squad) against the AI, with the balance assist on and off,
// and prints win rate, mean tickets left and battle length, plus how long a sim step takes. Taste is not in here.
import { jumpSpec, WORLDS } from "../src/jump.ts";
import type { Faction, Side } from "../src/battle/contract.ts";
import { play } from "./balance.ts";

const seeds = Number(process.argv[2] ?? 8);
const rows: string[] = [];
const total: Record<string, [number, number]> = {};
for (const world of WORLDS) for (const side of ["attacker", "defender"] as Side[]) for (const hero of ["marines", "wooka"] as Faction[]) for (const assist of [true, false]) {
  let won = 0, tick = 0, time = 0;
  const t0 = performance.now();
  for (let seed = 1; seed <= seeds; seed++) {
    const r = play(jumpSpec({ world, side, hero, assist, mode: "conquest", seed }), true, true);
    if (r.winner === side) won++;
    tick += r.tickets[side]; time += r.time;
  }
  const ms = performance.now() - t0;
  rows.push(`${world.padEnd(10)} ${side.padEnd(8)} ${hero.padEnd(7)} assist ${assist ? "on " : "off"}  hero won ${won}/${seeds}  tickets left ${Math.round(tick / seeds)}  ${Math.round(time / seeds)}s long  (${Math.round(ms / seeds)} ms/battle)`);
  const k = `${side} assist ${assist ? "on" : "off"}`;
  total[k] = [(total[k]?.[0] ?? 0) + won, (total[k]?.[1] ?? 0) + seeds];
}
console.log(rows.join("\n"));
for (const [k, [w, n]] of Object.entries(total)) console.log(`${k.padEnd(22)} hero won ${w}/${n} (${Math.round((100 * w) / n)}%)`);
