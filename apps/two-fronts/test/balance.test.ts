import { expect, setDefaultTimeout, test } from "bun:test";
import { SECTORS, marineWins, play, specFor } from "../scripts/balance.ts";
import { settle, startBattle, step, toughness } from "../src/battle/sim.ts";

// Whole battles, thirty-odd of them: slow, and a CI runner is slower than a laptop.
setDefaultTimeout(240_000);

test("left to the AI, Marines and Wooka are roughly even, on every sector and from either end", () => {
  const r = marineWins("none", [1, 2]);
  expect(r.wins / r.n).toBeGreaterThan(0.3);
  expect(r.wins / r.n).toBeLessThan(0.7);
  // No sector is a walkover: Marines win and lose on nearly all of them (four battles each, so one may sweep by luck).
  expect(SECTORS.filter((s) => r.bySector[s]! > 0 && r.bySector[s]! < 4).length).toBeGreaterThanOrEqual(4);
});

test("Marines attacking the station take posts: its bulkheads don't pin them at the first wall", () => {
  for (const seed of [1, 2, 3]) expect(play(specFor("spaceport", seed, "marines", null), false).taken).toBeGreaterThan(0);
});

test("a played battle leans quietly towards the human, and the AI eases off or digs in with how it goes", () => {
  const b = startBattle(specFor("shield", 1, "marines", "attacker"));
  expect(b.played).toBe(false);
  const ai = toughness(b, "defender");
  step(b, { forward: 0, right: 0, yaw: 0, fire: false });
  expect(b.played).toBe(true);
  expect(toughness(b, "defender")).toBe(ai); // the horde is no softer for it
  expect(toughness(b, "attacker")).toBeLessThan(1); // but the Marine's side takes a touch less
  // The enemy AI soaks more when the human is well ahead on tickets than when they're far behind.
  const foeTakes = (mine: number, theirs: number) => { b.tickets.attacker = mine; b.tickets.defender = theirs; settle(b); return toughness(b, "defender"); };
  expect(foeTakes(150, 30)).toBeLessThan(foeTakes(90, 90));
  expect(foeTakes(90, 90)).toBeLessThan(foeTakes(30, 150));
  b.tickets.defender = 150; b.tickets.attacker = 150;
  b.hero.kills = 0; settle(b); const none = toughness(b, "attacker");
  b.hero.kills = 20; settle(b);
  expect(toughness(b, "attacker")).toBeLessThan(none);
});
