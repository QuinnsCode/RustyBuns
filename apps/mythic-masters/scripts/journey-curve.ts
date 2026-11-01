// The journey's level curve, headless: a level-N starter (default 5) against each Pine Barrens keeper at its section's level
// (atLevel scaling), win rate over N seeds. The aim: every keeper winnable by a fresh starter, the level-10
// Jersey Devil a real wall (a level-5 starter loses most fights, a level-10 one wins most).
//
//   bun scripts/journey-curve.ts          bun scripts/journey-curve.ts 5 40   (level, seeds)
import { atLevel, sections, STARTERS } from "../src/journey.ts";
import { REGIONS } from "../src/regions.ts";
import { creature } from "../src/roster.ts";
import { rate } from "./tune.ts";

const level = Number(process.argv[2] ?? 5), n = Number(process.argv[3] ?? 40);
const secs = sections(REGIONS[0]!);
const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4);
console.log(`level-${level} starters vs the Pine Barrens' keepers (${n} fights each)`);
for (const s of secs) {
  const foe = atLevel(creature(s.keeper), s.level, true);
  const wins = STARTERS.map((id) => rate(atLevel(creature(id), level), foe, n).wins);
  console.log(`${String(s.k + 1).padStart(2)} ${s.name.padEnd(16)} ${s.keeper.padEnd(14)} Lv${String(s.level).padStart(2)}  ${STARTERS.map((id, i) => `${id} ${pct(wins[i]!)}`).join("  ")}`);
}
