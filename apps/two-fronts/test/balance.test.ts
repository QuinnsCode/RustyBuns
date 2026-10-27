import { expect, setDefaultTimeout, test } from "bun:test";
import { SECTORS, marineWins, play, specFor } from "../scripts/balance.ts";
import { HUMAN_HANDICAP, forHuman, handicapped } from "../src/battle/handicap.ts";
import { DUG_IN, KEEP_WALLS, dugIn, settle, startBattle, step, toughness } from "../src/battle/sim.ts";

// Whole battles, thirty-odd of them: slow, and a CI runner is slower than a laptop.
setDefaultTimeout(240_000);

test("left to the AI, Marines and Wooka are roughly even, and at equal forces the defender holds more often than not", () => {
  const r = marineWins("none", [1, 2]);
  expect(r.wins / r.n).toBeGreaterThan(0.3);
  expect(r.wins / r.n).toBeLessThan(0.7);
  // No sector is a walkover: Marines win and lose on nearly all of them (four battles each, so one may sweep by luck).
  expect(SECTORS.filter((s) => r.bySector[s]! > 0 && r.bySector[s]! < 4).length).toBeGreaterThanOrEqual(4);
  // The defender's edge: the attacker wins about 40% of the time, whichever faction attacks (600-battle runs sit at 40-45%).
  expect(r.attackerWins / r.n).toBeGreaterThan(0.2);
  expect(r.attackerWins / r.n).toBeLessThan(0.6);
});

test("the defender's ground: dug in near a post of theirs, behind walls at the keep; the attacker has neither", () => {
  const b = startBattle(specFor("shield", 1, "marines", null));
  const keep = b.posts.at(-1)!, at = (side: "attacker" | "defender", x: number, z: number) => ({ ...b.units[0]!, side, kind: "assault" as const, x, z });
  expect(dugIn(b, at("defender", keep.x, keep.z))).toBe(KEEP_WALLS);
  expect(dugIn(b, at("attacker", keep.x, keep.z))).toBe(1);
  expect(dugIn(b, at("defender", b.spawn.defender.x, b.spawn.defender.z))).toBe(1); // open ground, no post
  keep.owner = "attacker";
  expect(dugIn(b, at("defender", keep.x, keep.z))).toBe(1); // lost the keep, lost its walls
  b.posts[0]!.owner = "defender";
  expect(dugIn(b, at("defender", b.posts[0]!.x + 10, b.posts[0]!.z))).toBe(DUG_IN);
});

test("a human is worth about half an army again: the AI side fields the handicap more, armies and tickets only", () => {
  const spec = specFor("canyon", 1, "wooka", "defender");
  const h = forHuman(spec);
  expect(HUMAN_HANDICAP).toBeGreaterThan(0.3);
  expect(h.armies).toEqual({ attacker: Math.round(3 * (1 + HUMAN_HANDICAP)), defender: 3 });
  expect(h.tickets).toEqual({ attacker: Math.round(150 * (1 + HUMAN_HANDICAP)), defender: 150 });
  expect({ ...h, armies: spec.armies, tickets: spec.tickets }).toEqual(spec);
  expect(handicapped(spec, "attacker", 0)).toBe(spec);
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
