import { chatterFor, radioFor } from "../src/battle/lines.ts";
import { expect, setDefaultTimeout, test } from "bun:test";
import type { BattleSpec } from "../src/battle/contract.ts";
import {
  CHAMP_AT, DT, MOSS_HEAL, MOSS_LIGHT, MOSS_WOUND, SPRINT_AFTER, FLAVOR, HALF, LAYOUTS, ROLES, ROLE_STATS, STATS, STRIKE_RADIUS, TROOPERS, aimTarget, damage, flies, heroUnit, hitChance, inCover, isVehicle, run, sees, startBattle, statsOf, step, type Unit, type UnitKind, type WookaRole,
} from "../src/battle/sim.ts";

// Whole battles run here, and a CI runner is slower than a laptop. bunfig's timeout is ignored,
// so it's set per file.
setDefaultTimeout(30_000);

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

test("each world's radio talks about that world, not the ferns", () => {
  for (const kind of ["capital", "spaceport", "cannon", "canyon"] as const) {
    const pool = radioFor(kind, FLAVOR);
    expect(pool.length).toBeGreaterThan(FLAVOR.length - 40);
    expect(pool.some((l) => /\bferns?\b/i.test(l))).toBe(false);
    expect(pool.some((l) => !FLAVOR.includes(l))).toBe(true);
    expect(chatterFor(kind, "marines", { calm: ["I think a fern just blinked"], scared: ["They're in the ferns!"] }).scared.join()).not.toContain("ferns");
  }
  expect(radioFor("shield", FLAVOR)).toBe(FLAVOR);
});

// A bare field: no trees or scenery, nobody on it, for setting up one exchange at a time.
const bare = (over: Partial<BattleSpec> = {}) => {
  const b = startBattle(spec({ turrets: 0, ...over }));
  b.trees = []; b.blocks = []; b.units = []; b.hero.id = null; b.hero.lives = 0;
  return b;
};
const unit = (b: ReturnType<typeof bare>, side: "attacker" | "defender", kind: UnitKind, x: number, z: number) => {
  const u: Unit = { id: b.nextId++, side, kind, x, z, yaw: 0, hp: STATS[kind].hp, maxHp: STATS[kind].hp, cool: 99, jx: 0, jz: 0 };
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
    for (const u of b.units) if (!flies(u)) for (const k of b.blocks) expect(!k.broken && Math.abs(u.x - k.x) < k.w / 2 && Math.abs(u.z - k.z) < k.d / 2).toBe(false);
  }
  expect(startBattle(spec({ sector: "canyon" })).trees).toHaveLength(0);
  expect(startBattle(spec({ sector: "jungle" })).trees.length).toBeGreaterThan(startBattle(spec()).trees.length);
});

// One of the horde, of a given kind.
const wookaOf = (b: ReturnType<typeof bare>, side: "attacker" | "defender", role: WookaRole, x: number, z: number) => {
  const u = unit(b, side, "wooka", x, z);
  Object.assign(u, { role, pack: 0, hp: ROLE_STATS[role].hp, maxHp: ROLE_STATS[role].hp });
  return u;
};
const idle = { forward: 0, right: 0, yaw: 0, fire: false };

test("the horde comes in five kinds, mostly fodder", () => {
  const b = startBattle(spec({ armies: { attacker: 3, defender: 4 } }));
  step(b, null);
  const n = (r: WookaRole) => b.units.filter((u) => u.role === r).length;
  for (const r of ROLES.filter((k) => k !== "mossback")) expect(n(r)).toBeGreaterThan(0);
  expect(n("mossback")).toBe(0); // they only come out of a surge
  expect(n("fodder")).toBeGreaterThan(n("chub"));
  expect(b.units.filter((u) => u.role).every((u) => u.kind === "wooka" && u.side === "defender")).toBe(true);
});

test("the Wooka dig trench lines into their half of the field", () => {
  const b = startBattle(spec());
  const trenches = b.blocks.filter((k) => k.kind === "trench");
  expect(trenches.length).toBeGreaterThan(6);
  expect(trenches.every((k) => k.z < 0 && k.h < 1.6)).toBe(true); // the defender's half, and low enough to see over
  for (const kind of ["rock", "stump", "log"] as const) expect(b.blocks.some((k) => k.kind === kind)).toBe(true);
});

test("a Boomie runs into a knot of Marines and goes off, and not gently", () => {
  const b = bare();
  const marines = [0, 2, -2].map((x) => unit(b, "attacker", "assault", x, 0));
  const boom = wookaOf(b, "defender", "boomie", 0, -30);
  for (let i = 0; i < 200 && b.units.includes(boom); i++) step(b, null);
  expect(b.units.includes(boom)).toBe(false);
  expect(b.fx.some((f) => f.kind === "blast")).toBe(true);
  expect(marines.every((m) => m.hp < STATS.assault.hp - 100)).toBe(true);
});

test("a Sticky throws a spear and falls back", () => {
  const b = bare();
  unit(b, "attacker", "assault", 0, 0).cool = 99;
  const s = wookaOf(b, "defender", "sticky", 0, -20);
  s.cool = 0;
  step(b, null); step(b, null);
  expect(b.fx.some((f) => f.kind === "spear")).toBe(true);
  const z = s.z;
  for (let i = 0; i < 20; i++) step(b, null);
  expect(s.z).toBeLessThan(z); // further off, towards home
});

test("Warbur spears from afar, throws his kin, then rips a head off up close", () => {
  const b = bare();
  const bear: Unit = unit(b, "defender", "champion", 0, -35);
  Object.assign(bear, { champ: "warbur" as const, hp: 1100, maxHp: 1100, cool: 0, jav: 0, toss: 0 });
  const marine = unit(b, "attacker", "assault", 0, 0);
  const kin = [wookaOf(b, "defender", "fodder", 3, -40), wookaOf(b, "defender", "fodder", -3, -40)];
  for (const k of kin) k.cool = 99;
  // 35 away: a spear, no kin thrown yet.
  step(b, null);
  expect(b.fx.some((f) => f.kind === "spear" && f.big)).toBe(true);
  expect(b.fx.some((f) => f.kind === "toss")).toBe(false);
  // 12 away: kin go flying while they're healthy.
  bear.z = -12; bear.toss = 0; bear.look = 0;
  for (const k of kin) k.z = -12;
  step(b, null);
  expect(b.fx.some((f) => f.kind === "toss")).toBe(true);
  // Beaten up kin are left alone: spears instead.
  b.fx = []; bear.toss = 0; bear.jav = 0; bear.look = 0;
  for (const k of kin) k.hp = 5;
  step(b, null);
  expect(b.fx.some((f) => f.kind === "toss")).toBe(false);
  expect(b.fx.some((f) => f.kind === "spear")).toBe(true);
  // Up close, the head comes off.
  bear.x = 0; bear.z = -2; bear.cool = 0; bear.look = 0; marine.hp = STATS.assault.hp;
  for (let i = 0; i < 200 && marine.hp > 0; i++) step(b, null);
  expect(marine.hp).toBeLessThanOrEqual(0);
});

test("a spear pins whoever it hits to a nearby trunk", () => {
  let pinned = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const b = bare({ seed });
    b.trees = [{ x: 2, z: 2, r: 1 }];
    const marine: Unit = unit(b, "attacker", "assault", 0, 2);
    marine.cool = 99;
    wookaOf(b, "defender", "sticky", 0, -10).cool = 0;
    for (let i = 0; i < 3; i++) step(b, null);
    if (marine.hp < marine.maxHp && (marine.stun ?? 0) > 0) pinned++;
    else expect(marine.hp < marine.maxHp).toBe(false); // every hit pins
  }
  expect(pinned).toBeGreaterThan(0);
});

test("three Wooka on a Marine tear them apart, and cover is no help up close", () => {
  const b = bare();
  const m = unit(b, "attacker", "assault", 0, 0);
  const mob = [[1.5, 0], [-1.5, 0], [0, 1.5]].map(([x, z]) => Object.assign(wookaOf(b, "defender", "fodder", x!, z!), { cool: 0 }));
  b.blocks.push({ x: 0, z: -1, w: 4, d: 0.5, h: 1.2 });
  expect(hitChance(b, mob[0]!, m)).toBeCloseTo(statsOf(mob[0]!).aim - (1.5 / statsOf(mob[0]!).range) * 0.35);
  for (let i = 0; i < 120 && b.units.includes(m); i++) step(b, null);
  expect(b.units.includes(m)).toBe(false);
  expect(b.fx.some((f) => f.kind === "gore" && f.big)).toBe(true);
});

test("a Shanti mends the Wooka round it", () => {
  const b = bare();
  wookaOf(b, "defender", "shanti", 0, -60);
  const hurt = wookaOf(b, "defender", "chub", 4, -60);
  hurt.hp = 100;
  for (let i = 0; i < 30; i++) step(b, null);
  expect(hurt.hp).toBeGreaterThan(100);
});

test("enough kills earn the hero their champion: Gumpert swaps kit, Warbur throws Wooka", () => {
  const b = startBattle(spec());
  b.kills.attacker = CHAMP_AT;
  step(b, idle);
  const g = heroUnit(b)!;
  expect(g.champ).toBe("gumpert");
  expect(g.maxHp).toBeGreaterThan(STATS.hero.hp);
  step(b, { ...idle, use: true });
  expect(g.kit).toBe("baton");
  step(b, { ...idle, use: true });
  expect(g.kit).toBe("jetpack");
  expect(flies(g)).toBe(true);

  const w = startBattle(spec({ hero: "defender" })); // the hero on the Wooka side
  w.kills.defender = CHAMP_AT;
  step(w, idle);
  const bear = heroUnit(w)!;
  expect(bear.champ).toBe("warbur");
  const thrown = { id: w.nextId++, side: "defender" as const, kind: "wooka" as const, role: "fodder" as const, x: bear.x + 2, z: bear.z, yaw: 0, hp: 70, maxHp: 70, cool: 99, jx: 0, jz: 0 };
  w.units = [bear, thrown]; // nobody else near enough to be the one thrown
  step(w, { ...idle, yaw: bear.yaw, use: true });
  expect(w.fx.some((f) => f.kind === "toss")).toBe(true);
  expect(Math.hypot(thrown.x - bear.x, thrown.z - bear.z)).toBeGreaterThan(10);
});

test("an AI side earns its champion too, and it walks in", () => {
  const b = startBattle(spec());
  b.kills.defender = CHAMP_AT;
  step(b, null);
  expect(b.units.some((u) => u.kind === "champion" && u.champ === "warbur" && u.side === "defender")).toBe(true);
  expect(b.events.some((e) => e.includes("WARBUR"))).toBe(true);
});

test("hold the trigger and the blaster overheats, then locks up a while", () => {
  const b = bare();
  const hero = unit(b, "attacker", "hero", 0, 0);
  b.hero.id = hero.id;
  hero.cool = 0;
  let shots = 0;
  for (let i = 0; i < 30 * 8; i++) {
    const before = b.fx.length;
    step(b, { ...idle, fire: true });
    shots += b.fx.slice(before).filter((f) => f.kind === "shot").length;
    if (b.hero.overheated > 0) break;
  }
  expect(b.hero.overheated).toBeGreaterThan(0);
  expect(shots).toBeGreaterThan(5);
  const locked = b.fx.length;
  for (let i = 0; i < 20; i++) step(b, { ...idle, fire: true });
  expect(b.fx.slice(locked).some((f) => f.kind === "shot" && f.from === hero.id)).toBe(false);
});

test("run straight ahead and you sprint; fire and you stop", () => {
  const pace = (fire: boolean) => {
    const b = bare();
    const hero = unit(b, "attacker", "hero", 0, 60);
    b.hero.id = hero.id;
    for (let i = 0; i < 60; i++) step(b, { ...idle, forward: 1, fire });
    return 60 - hero.z;
  };
  expect(pace(false)).toBeGreaterThan(pace(true) * 1.2);
  expect(SPRINT_AFTER).toBeLessThan(2);
});

test("the hero's kills are counted, and a streak ends when they go down", () => {
  const b = bare();
  const hero = unit(b, "attacker", "hero", 0, 0);
  b.hero.id = hero.id;
  b.hero.lives = 1;
  const foe = wookaOf(b, "defender", "fodder", 0, -10);
  foe.hp = 1;
  hero.cool = 0;
  for (let i = 0; i < 90 && b.units.includes(foe); i++) step(b, { ...idle, yaw: 0, fire: true });
  expect(b.hero.kills).toBe(1);
  expect(b.hero.streak).toBe(1);
  hero.hp = 0;
  step(b, idle);
  expect(b.hero.streak).toBe(0);
});

// Nothing else going on: no guns, gunships, surges or reinforcements, so one thing can be watched.
const quiet = (b: ReturnType<typeof bare>) => {
  b.beat.arty = { attacker: 1e9, defender: 1e9 };
  b.beat.nextSurge = b.beat.nextPass = 1e9;
  b.spawnAt = { attacker: 1e9, defender: 1e9 };
  return b;
};

test("a Mossback shrugs off light fire and mends, unless something heavy hit it lately", () => {
  const b = quiet(bare());
  const m = wookaOf(b, "defender", "mossback", 0, -80);
  const max = ROLE_STATS.mossback.hp;
  // A rifle round barely marks it.
  damage(b, m, 8);
  expect(m.hp).toBeCloseTo(max - 8 * MOSS_LIGHT, 5);
  // Hurt, and nothing heavy about: it mends, slowly.
  m.hp = max / 2;
  for (let i = 0; i < 3 / DT; i++) step(b, null);
  expect(m.hp).toBeCloseTo(max / 2 + MOSS_HEAL * 3, 0);
  expect(m.hp).toBeLessThan(max / 2 + 100); // slowly: a minute to be whole, not a second
  // A heavy hit (a blast, a rocket) lands in full, and stops it mending for a while.
  m.hp = max / 2;
  damage(b, m, 100, undefined, true);
  expect(m.hp).toBe(max / 2 - 100);
  for (let i = 0; i < (MOSS_WOUND - 1) / DT; i++) step(b, null);
  expect(m.hp).toBe(max / 2 - 100);
  // A single hit big enough counts as heavy whatever it came from; a pile of light ones doesn't.
  m.wound = 0;
  damage(b, m, 60);
  expect(m.wound).toBe(MOSS_WOUND);
  m.wound = 0; m.hp = max / 2;
  for (let i = 0; i < 10; i++) damage(b, m, 20);
  expect(m.wound).toBe(0);
  expect(m.hp).toBeCloseTo(max / 2 - 200 * MOSS_LIGHT, 5);
  // Once the wound has run its course it mends again.
  m.wound = 0.2; m.hp = max / 2;
  for (let i = 0; i < 4 / DT; i++) step(b, null);
  expect(m.hp).toBeGreaterThan(max / 2 + MOSS_HEAL * 3);
});

test("a Mossback leaps the last few metres, swats troopers aside and goes through low cover", () => {
  const b = quiet(bare());
  const m = wookaOf(b, "defender", "mossback", 0, -40);
  const a = unit(b, "attacker", "assault", 0, -48), c = unit(b, "attacker", "assault", 2, -49);
  a.cool = c.cool = 99;
  b.blocks.push({ x: 0, z: -44, w: 12, d: 1.3, h: 1.2, kind: "log" }, { x: 20, z: -44, w: 4, d: 4, h: 1.2, kind: "rock" });
  const from = m.z;
  let leapt = false;
  for (let i = 0; i < 4 / DT && m.hp > 0; i++) { step(b, null); leapt ||= (m.leap ?? 0) > 0; }
  expect(leapt).toBe(true);
  expect(m.z).toBeLessThan(from); // it came for them (the defender's end is -z), not away
  expect(b.blocks[0]!.broken).toBe(true);  // the log is rubble
  expect(b.blocks[1]!.broken).toBeUndefined(); // a rock isn't
  expect(a.hp).toBeLessThan(STATS.assault.hp);
});
