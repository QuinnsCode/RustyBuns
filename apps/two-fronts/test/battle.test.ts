import { expect, test } from "bun:test";
import type { BattleSpec } from "../src/battle/contract.ts";
import {
  DT, FLAVOR, HALF, LAYOUTS, STATS, STRIKE_RADIUS, TROOPERS, aimTarget, flies, heroUnit, hitChance, inCover, isVehicle, run, sees, startBattle, step, type UnitKind,
} from "../src/battle/sim.ts";

// A fixture straight from the contract: the ground layer never needs the strategy layer to run.
const spec = (over: Partial<BattleSpec> = {}): BattleSpec => ({
  id: "1-kessa-0", turn: 1, system: "Kessa", sector: "shield",
  factions: { attacker: "marines", defender: "wooka" }, hero: "attacker", heroLevel: 1,
  armies: { attacker: 3, defender: 2 }, tickets: { attacker: 75, defender: 50 },
  vehicles: { attacker: { tank: 1 }, defender: { tank: 1 } }, strikes: { attacker: 1, defender: 0 },
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
  const kinds = ["shield", "capital", "spaceport", "cannon", "canyon", "jungle"] as const;
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
  expect(b.hero.inVehicle).toBe(800);
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
  const b = startBattle(horde({ vehicles: { attacker: { tank: 2 }, defender: { tank: 1 } } }));
  for (let t = 0; t < 1; t += DT) step(b, null);
  const wooka = b.units.filter((u) => u.side === "attacker");
  expect(wooka.filter((u) => u.kind === "wooka").length).toBeGreaterThan(b.units.filter((u) => u.side === "defender" && u.kind !== "turret").length);
  expect(wooka.every((u) => u.kind === "wooka" || u.kind === "hero")).toBe(true);
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

// A bare field: no trees or scenery, nobody on it, for setting up one exchange at a time.
const bare = (over: Partial<BattleSpec> = {}) => {
  const b = startBattle(spec({ turrets: 0, ...over }));
  b.trees = []; b.blocks = []; b.units = []; b.hero.id = null; b.hero.lives = 0;
  return b;
};
const unit = (b: ReturnType<typeof bare>, side: "attacker" | "defender", kind: UnitKind, x: number, z: number) => {
  const u = { id: b.nextId++, side, kind, x, z, yaw: 0, hp: STATS[kind].hp, maxHp: STATS[kind].hp, cool: 99, jx: 0, jz: 0 };
  b.units.push(u);
  return u;
};

test("the Marines come in four classes, mostly assault", () => {
  const b = startBattle(spec({ factions: { attacker: "marines", defender: "marines" }, armies: { attacker: 4, defender: 4 } }));
  step(b, null);
  const n = (k: UnitKind) => b.units.filter((u) => u.side === "attacker" && u.kind === k).length;
  for (const k of TROOPERS) expect(n(k)).toBeGreaterThan(0);
  expect(n("assault")).toBeGreaterThan(n("heavy"));
  expect(n("heavy")).toBeGreaterThanOrEqual(n("sniper"));
});

test("vehicles come from the spec's pool, two out at a time", () => {
  const b = startBattle(spec({ vehicles: { attacker: { walker: 1, speeder: 1, gunship: 1 }, defender: {} }, tickets: { attacker: 500, defender: 500 } }));
  const seen = new Set<string>();
  for (let t = 0; t < 120; t += DT) {
    step(b, null);
    const out = b.units.filter((u) => u.side === "attacker" && isVehicle(u.kind));
    expect(out.length).toBeLessThanOrEqual(2);
    for (const u of out) seen.add(u.kind);
  }
  expect([...seen].every((k) => ["walker", "speeder", "gunship"].includes(k))).toBe(true);
  expect(seen.size).toBeGreaterThanOrEqual(2);
});

test("a wall blocks sight and shots; a gunship sees over it", () => {
  const b = bare();
  const me = unit(b, "attacker", "assault", 0, 20), foe = unit(b, "defender", "assault", 0, -20);
  expect(sees(b, me, foe)).toBe(true);
  b.blocks.push({ x: 0, z: 0, w: 10, d: 2, h: 4 });
  expect(sees(b, me, foe)).toBe(false);
  expect(aimTarget(b, me, 0, 60)).toBeNull();
  me.cool = foe.cool = 0;
  for (let i = 0; i < 30; i++) step(b, null);
  expect(b.fx.filter((f) => f.kind === "shot")).toHaveLength(0);
  expect(foe.hp).toBe(foe.maxHp);
  const ship = unit(b, "attacker", "gunship", 0, 20);
  expect(sees(b, ship, foe)).toBe(true);
  // A wall lower than eye height doesn't block sight.
  b.blocks = [{ x: 0, z: 0, w: 10, d: 2, h: 1.2 }];
  expect(sees(b, me, foe)).toBe(true);
});

test("cover halves the odds, but only on the shooter's side", () => {
  const b = bare();
  const me = unit(b, "attacker", "assault", 0, 20), foe = unit(b, "defender", "assault", 0, -10);
  const open = hitChance(b, me, foe);
  b.blocks.push({ x: 0, z: -8, w: 4, d: 1, h: 1.2 }); // between them, at the foe's feet
  expect(inCover(b, me, foe)).toBe(true);
  expect(hitChance(b, me, foe)).toBeCloseTo(open / 2);
  b.blocks = [{ x: 0, z: -12, w: 4, d: 1, h: 1.2 }]; // behind the foe: no help
  expect(hitChance(b, me, foe)).toBeCloseTo(open);
});

test("an engineer goes to mend a damaged turret", () => {
  const b = bare();
  const gun = unit(b, "attacker", "turret", 0, 0), fixer = unit(b, "attacker", "engineer", 20, 0);
  gun.hp = 100;
  for (let i = 0; i < 120; i++) step(b, null);
  expect(Math.hypot(fixer.x - gun.x, fixer.z - gun.z)).toBeLessThan(6);
  expect(gun.hp).toBeGreaterThan(130);
});

test("a gunship flies over a building a tank has to stop at", () => {
  for (const kind of ["gunship", "tank"] as const) {
    const b = startBattle(spec());
    b.trees = [];
    const hero = heroUnit(b)!;
    b.blocks = [{ x: hero.x, z: hero.z - 15, w: 20, d: 4, h: 10 }];
    const v = unit(b, "attacker", kind, hero.x, hero.z - 3);
    step(b, { forward: 0, right: 0, yaw: 0, fire: false, use: true });
    expect(b.hero.inVehicle).toBe(v.id);
    for (let i = 0; i < 90; i++) step(b, { forward: 1, right: 0, yaw: 0, fire: false });
    expect(v.z < b.blocks[0]!.z - 2).toBe(kind === "gunship");
  }
});

test("nobody ends up inside a building or rock, on any map", () => {
  for (const sector of ["capital", "canyon", "jungle"] as const) {
    const b = run(spec({ sector }), 150);
    expect(b.blocks.length).toBeGreaterThan(10);
    for (const u of b.units) if (!flies(u)) for (const k of b.blocks) expect(Math.abs(u.x - k.x) < k.w / 2 && Math.abs(u.z - k.z) < k.d / 2).toBe(false);
  }
  expect(startBattle(spec({ sector: "canyon" })).trees).toHaveLength(0);
  expect(startBattle(spec({ sector: "jungle" })).trees.length).toBeGreaterThan(startBattle(spec()).trees.length);
});
