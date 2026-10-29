// The jump links: an address names a world, side, hero and assist, and the spec it builds plays out.
import { expect, setDefaultTimeout, test } from "bun:test";
import { jumpSpec, parseJump, parseOrbit } from "../src/jump.ts";
import { runSpace } from "../src/battle/space.ts";
import { settle, startBattle, step } from "../src/battle/sim.ts";
import { HUMAN_HANDICAP } from "../src/battle/handicap.ts";

setDefaultTimeout(30_000);

test.each([
  ["world=forest&side=attacker", "shield", "attacker", "wooka"],
  ["world=desert&side=defender", "canyon", "defender", "marines"],
  ["world=city&side=attacker&hero=marines", "capital", "attacker", "marines"],
  ["world=beach&side=defender&hero=wooka", "cannon", "defender", "wooka"],
  ["world=station&side=attacker&map=yards", "spaceport", "attacker", "wooka"],
])("?battle=1&%s lands in that fight, and the battle starts and steps", (rest, world, side, hero) => {
  const j = parseJump(`?battle=1&${rest}&seed=7`)!;
  const spec = jumpSpec(j);
  expect([spec.sector, spec.hero, spec.factions[spec.hero]] as string[]).toEqual([world, side, hero]);
  expect(spec.factions.attacker).not.toBe(spec.factions.defender);
  const b = startBattle(spec);
  for (let i = 0; i < 90; i++) step(b, null);
  expect(b.units.length).toBeGreaterThan(0);
});

test("no battle param, no jump; assist off drops the handicap and the sim's help for a played battle", () => {
  expect(parseJump("?world=desert")).toBeNull();
  const on = jumpSpec(parseJump("?battle=1&side=defender&seed=1")!), off = jumpSpec(parseJump("?battle=1&side=defender&assist=off&seed=1")!);
  expect(on.armies.attacker).toBe(Math.round(4 * (1 + HUMAN_HANDICAP)));
  expect(off.armies.attacker).toBe(4);
  const tough = (spec: typeof on) => { const b = startBattle(spec); step(b, { forward: 0, right: 0, yaw: 0, fire: false }); settle(b); return b.tough.defender; };
  expect(tough(off)).toBe(1);
  expect(tough(on)).not.toBe(1);
});

test("the harness spelling: sector and side=marines|wooka", () => {
  const spec = jumpSpec(parseJump("?battle=1&sector=ruined-city&side=wooka&seed=2")!);
  expect(spec.sector).toBe("capital");
  expect([spec.hero, spec.factions.attacker]).toEqual(["attacker", "wooka"]);
  const m = jumpSpec(parseJump("?battle=1&sector=beach&side=marines&seed=2")!);
  expect([m.sector, m.hero, m.factions.defender]).toEqual(["cannon", "defender", "marines"]);
});

test("near and end come through", () => {
  expect(parseJump("?battle=1&near=1&end=win&after=5")).toMatchObject({ near: 45, end: "win", endAfter: 5 });
  expect(parseJump("?battle=1")).toMatchObject({ near: 0, end: undefined, assist: true });
});

test("zeroing the loser's tickets ends the battle even with drop pods in hand (what end=win does)", () => {
  const b = startBattle(jumpSpec(parseJump("?battle=1&side=defender&seed=3")!));
  for (let i = 0; i < 30; i++) step(b, null);
  b.tickets.attacker = 0;
  step(b, null);
  expect(b.over?.winner).toBe("defender");
});

test("?orbit=1 lands in the space battle for that side and fleet, and it plays out", () => {
  const o = parseOrbit("?orbit=1&side=wooka&ships=2v4&watch=1&seed=5")!;
  expect([o.spec.hero, o.spec.factions.attacker, o.spec.fleets.attacker, o.spec.fleets.defender, o.watch]).toEqual(["attacker", "wooka", 2, 4, true]);
  expect(parseOrbit("?orbit=1&ships=99v1&seed=5")!.spec.fleets).toEqual({ attacker: 3, defender: 3 });
  expect(parseOrbit("?battle=1")).toBeNull();
  expect(runSpace(o.spec).over).not.toBeNull();
});
