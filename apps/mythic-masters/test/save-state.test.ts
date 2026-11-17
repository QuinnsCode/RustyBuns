// Save states, step 2 (#4782): a duel on sim.ts saved mid-fight, loaded, and stepped on lands where stepping straight
// through lands (`roundTrip` from @rustybuns/util/lab/save-state, as Two Fronts' battles do). The hands are a bot
// fight's inputs, logged once, so both copies get the same ones whatever state they are in.
import { expect, test } from "bun:test";
import { roundTrip } from "@rustybuns/util/lab/save-state";
import { bot } from "../src/bot.ts";
import { creature } from "../src/roster.ts";
import { newMatch, newTeamMatch, step, type Input, type Match } from "../src/sim.ts";

/** A bot a fighter plays the whole fight once; its inputs a tick, and the tick it ended. */
function logged(start: () => Match, seed: number) {
  const m = start(), bots = m.f.map((_, k) => bot(k, seed + k)), log: Input[][] = [];
  while (!m.over) { const i = bots.map((b) => b(m)); log.push(i); step(m, i); }
  return log;
}

test.each([
  ["a hare against a spined tank", () => newMatch(creature("jackalope"), creature("hodag")), 3],
  ["a winged devil against the squonk", () => newMatch(creature("jersey-devil"), creature("squonk")), 5],
  ["two friends against a wild one", () => newTeamMatch([[creature("jackalope"), creature("agropelter")], [creature("hodag")]]), 7],
] as const)("a Mythic duel round-trips: %s", (_name, start, seed) => {
  const log = logged(start, seed), end = log.length;
  expect(end).toBeGreaterThan(600); // a real fight, saved well before its end
  expect(roundTrip({ step }, start, (i) => log[i]!, end >> 1, end)).toBeNull();
});
