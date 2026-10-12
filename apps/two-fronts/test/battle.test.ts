import { expect, test } from "bun:test";
import type { BattleSpec } from "../src/battle/contract.ts";
import { DT, FLAVOR, HALF, LAYOUTS, STRIKE_RADIUS, heroUnit, run, startBattle, step } from "../src/battle/sim.ts";

// A fixture straight from the contract: the ground layer never needs the strategy layer to run.
const spec = (over: Partial<BattleSpec> = {}): BattleSpec => ({
  id: "1-kessa-0", turn: 1, system: "Kessa", sector: "shield",
  factions: { attacker: "marines", defender: "wooka" }, hero: "attacker", heroLevel: 1,
  armies: { attacker: 3, defender: 2 }, tickets: { attacker: 75, defender: 50 },
  vehicles: { attacker: 1, defender: 1 }, strikes: { attacker: 1, defender: 0 },
  reinforcements: { attacker: 24, defender: 0 }, turrets: 2, seed: 42, ...over,
});

test("a battle runs to a result that matches the contract, the same every time", () => {
  const a = run(spec()), b = run(spec());
  expect(a.over).not.toBeNull();
  expect(a.over).toEqual(b.over!);
  expect(a.over!.id).toBe("1-kessa-0");
  const loser = a.over!.winner === "attacker" ? "defender" : "attacker";
  expect(a.over!.tickets[loser] === 0 || a.time >= 600).toBe(true);
  for (const u of a.units) expect(Math.abs(u.x) <= HALF && Math.abs(u.z) <= HALF).toBe(true);
});

test("more armies win more battles", () => {
  let big = 0, small = 0;
  for (let seed = 1; seed <= 6; seed++) {
    if (run(spec({ seed, armies: { attacker: 5, defender: 1 }, tickets: { attacker: 125, defender: 25 } })).over!.winner === "attacker") big++;
    if (run(spec({ seed, armies: { attacker: 1, defender: 5 }, tickets: { attacker: 25, defender: 125 } })).over!.winner === "attacker") small++;
  }
  expect(big).toBeGreaterThan(small);
});

test("every kind of sector has its own map, the defender's keep ringed by its turrets", () => {
  const kinds = ["shield", "capital", "spaceport", "cannon"] as const;
  expect(new Set(kinds.map((k) => JSON.stringify(LAYOUTS[k].posts))).size).toBe(kinds.length);
  for (const sector of kinds) {
    const b = startBattle(spec({ sector }));
    const keep = b.posts.at(-1)!;
    expect(keep).toMatchObject({ name: LAYOUTS[sector].posts.at(-1)!.name, owner: "defender" });
    expect(b.posts.slice(0, -1).every((p) => p.owner === null)).toBe(true);
    for (const t of b.units.filter((u) => u.kind === "turret")) expect(Math.hypot(t.x - keep.x, t.z - keep.z)).toBeCloseTo(18);
    expect(run(spec({ sector })).over).not.toBeNull();
  }
});

test("the defender's fortifications are on the field", () => {
  expect(startBattle(spec({ turrets: 2 })).units.filter((u) => u.kind === "turret")).toHaveLength(2);
});

test("an orbital strike needs orbit, lands after a delay and hits everyone under it", () => {
  const b = startBattle(spec());
  const hero = heroUnit(b)!;
  const input = { forward: 0, right: 0, yaw: 0, fire: false };
  for (let i = 0; i < 3; i++) b.units.push({ id: 900 + i, side: "defender", kind: "turret", x: 0, z: 0 + i, yaw: 0, hp: 100, maxHp: 100, cool: 99, jx: 0, jz: 0 });
  step(b, { ...input, strike: { x: 0, z: 0 } });
  expect(b.strikesLeft.attacker).toBe(0);
  expect(b.strikes).toHaveLength(1);
  step(b, { ...input, strike: { x: 0, z: 0 } }); // none left
  expect(b.strikes).toHaveLength(1);
  expect(b.units.filter((u) => u.id >= 900)).toHaveLength(3);
  for (let t = 0; t < 2.6; t += DT) step(b, input);
  expect(b.units.filter((u) => u.id >= 900)).toHaveLength(0);
  expect(Math.hypot(hero.x, hero.z)).toBeGreaterThan(STRIKE_RADIUS);
});

test("drop pods come once, at half tickets, only to the side with orbit", () => {
  const b = startBattle(spec());
  b.tickets.attacker = 37;
  b.tickets.defender = 20;
  step(b, null);
  expect(b.tickets.attacker).toBe(61);
  expect(b.reinforced).toEqual({ attacker: true, defender: false });
  b.tickets.attacker = 10;
  step(b, null);
  expect(b.tickets.attacker).toBe(10);
});

test("the hero drives a tank and the input moves it", () => {
  const b = startBattle(spec());
  const hero = heroUnit(b)!;
  b.units.push({ id: 800, side: "attacker", kind: "tank", x: hero.x + 2, z: hero.z, yaw: 0, hp: 600, maxHp: 600, cool: 0, jx: 0, jz: 0 });
  step(b, { forward: 0, right: 0, yaw: 0, fire: false, use: true });
  expect(b.hero.inTank).toBe(800);
  const z = b.units.find((u) => u.id === 800)!.z;
  for (let i = 0; i < 30; i++) step(b, { forward: 1, right: 0, yaw: 0, fire: false });
  const tank = b.units.find((u) => u.id === 800)!;
  expect(tank.z).toBeLessThan(z - 5); // yaw 0 drives towards -z
  expect(hero.z).toBe(tank.z);
});

test("losing every hero life is reported as heroDown", () => {
  const b = startBattle(spec());
  for (let i = 0; i < 3; i++) {
    heroUnit(b)!.hp = 0;
    step(b, null);
    for (let t = 0; t < 5.2 && i < 2; t += DT) step(b, null);
  }
  expect(b.hero.lives).toBe(0);
  b.tickets.defender = 0;
  step(b, null);
  expect(b.over!.heroDown).toBe(true);
});

const horde = (over: Partial<BattleSpec> = {}) => spec({ factions: { attacker: "wooka", defender: "marines" }, hero: "defender", ...over });

test("the Wooka come as a horde: more of them, all clubs, no tanks", () => {
  const b = startBattle(horde({ vehicles: { attacker: 2, defender: 1 } }));
  for (let t = 0; t < 1; t += DT) step(b, null);
  const wooka = b.units.filter((u) => u.side === "attacker");
  expect(wooka.filter((u) => u.kind === "wooka").length).toBeGreaterThan(b.units.filter((u) => u.kind === "trooper").length);
  expect(wooka.some((u) => u.kind === "tank" || u.kind === "trooper")).toBe(false);
  expect(b.units.some((u) => u.side === "defender" && u.kind === "tank")).toBe(true);
});

test("nobody walks through a redwood", () => {
  const b = run(horde(), 120);
  expect(b.trees.length).toBeGreaterThan(50);
  for (const u of b.units) for (const t of b.trees) expect(Math.hypot(u.x - t.x, u.z - t.z)).toBeGreaterThan(t.r);
});

test("the radio has opinions about the Wooka", () => {
  const b = run(horde(), 80);
  expect(b.events.some((e) => FLAVOR.includes(e))).toBe(true);
});
