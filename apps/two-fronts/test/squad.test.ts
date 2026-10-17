// The hero's squad orders, the heavy weapons out on the field, and the big maps, through the sim.
import { expect, setDefaultTimeout, test } from "bun:test";
import { BIG_MAP_FOR, type BattleSpec } from "../src/battle/contract.ts";
import { BIG_MAPS, CACHE_BACK, HEAVY, ORDER_FOR, facing, heroUnit, run, startBattle, step, yawTo, type Input } from "../src/battle/sim.ts";

setDefaultTimeout(30_000);

const spec = (over: Partial<BattleSpec> = {}): BattleSpec => ({
  id: "1-kessa-0", turn: 1, system: "Kessa", sector: "shield",
  factions: { attacker: "marines", defender: "wooka" }, hero: "attacker", heroLevel: 1,
  armies: { attacker: 3, defender: 2 }, tickets: { attacker: 75, defender: 50 },
  vehicles: { attacker: {}, defender: {} }, strikes: { attacker: 0, defender: 0 },
  reinforcements: { attacker: 0, defender: 0 }, turrets: 2, seed: 42, ...over,
});
const idle = (yaw = 0): Input => ({ forward: 0, right: 0, yaw, fire: false });
const steps = (b: ReturnType<typeof startBattle>, n: number, input = idle()) => { for (let i = 0; i < n && !b.over; i++) step(b, input); };

test("hold keeps the squad where it stood; forward sends it where the gun points; the order runs out", () => {
  const b = startBattle(spec());
  steps(b, 30 * 9); // the first wave is in
  step(b, { ...idle(), order: { kind: "hold", x: 0, z: 0 } });
  const held = b.units.filter((u) => b.order!.ids.includes(u.id)).map((u) => ({ u, x: u.x, z: u.z }));
  expect(held.length).toBeGreaterThan(2);
  steps(b, 30 * 10);
  for (const h of held) if (h.u.hp > 0) expect(Math.hypot(h.u.x - h.x, h.u.z - h.z)).toBeLessThan(4);

  const hero = heroUnit(b)!, f = facing(0), spot = { x: hero.x + f.x * 40, z: hero.z + f.z * 40 };
  step(b, { ...idle(), order: { kind: "forward", ...spot } });
  const sent = b.units.filter((u) => b.order!.ids.includes(u.id));
  const before = sent.reduce((t, u) => t + Math.hypot(u.x - spot.x, u.z - spot.z), 0) / sent.length;
  steps(b, 30 * 5);
  const after = sent.filter((u) => u.hp > 0).reduce((t, u) => t + Math.hypot(u.x - spot.x, u.z - spot.z), 0) / Math.max(1, sent.filter((u) => u.hp > 0).length);
  expect(after).toBeLessThan(before);
  steps(b, 30 * ORDER_FOR);
  expect(sent.filter((u) => u.hp > 0).every((u) => u.hx === undefined)).toBe(true);
});

test("focus fire points the squad's guns at whatever is round the spot", () => {
  const b = startBattle(spec());
  steps(b, 30 * 25); // a surge is out
  const hero = heroUnit(b)!, foe = b.units.filter((u) => u.side === "defender" && u.kind !== "turret").sort((a, c) => Math.hypot(a.x - hero.x, a.z - hero.z) - Math.hypot(c.x - hero.x, c.z - hero.z))[0]!;
  step(b, { ...idle(), order: { kind: "focus", x: foe.x, z: foe.z } });
  steps(b, 15);
  const o = b.order!, aimed = b.units.filter((u) => o.ids.includes(u.id) && u.target !== undefined).map((u) => b.units.find((v) => v.id === u.target)).filter((v) => !!v);
  expect(aimed.length).toBeGreaterThan(0);
  expect(aimed.filter((v) => Math.hypot(v!.x - o.x, v!.z - o.z) < 20).length).toBeGreaterThanOrEqual(aimed.length / 2);
});

test("a heavy weapon is out in the open; walk over it and it fires without heating, till it's empty, then it comes back", () => {
  const b = startBattle(spec());
  expect(b.caches.length).toBe(3);
  for (const c of b.caches) for (const s of Object.values(b.spawn)) expect(Math.hypot(c.x - s.x, c.z - s.z)).toBeGreaterThan(60);
  const hero = heroUnit(b)!, lance = b.caches.find((c) => c.kind === "lance")!;
  hero.x = lance.x; hero.z = lance.z;
  step(b, idle());
  expect(b.hero.arm).toEqual({ kind: "lance", ammo: HEAVY.lance.ammo });
  // Three Wooka in a row in front of the hero: one shot of the lance goes through all of them.
  const yaw = 0, f = facing(yaw);
  b.units = b.units.filter((u) => u.side === "attacker");
  for (let i = 0; i < 3; i++) b.units.push({ id: 900 + i, side: "defender", kind: "wooka", role: "fodder", x: hero.x + f.x * (8 + i * 4), z: hero.z + f.z * (8 + i * 4), yaw: 0, hp: 70, maxHp: 70, cool: 99, jx: 0, jz: 0 });
  b.trees = []; b.blocks = []; hero.cool = 0;
  step(b, { ...idle(yaw), fire: true });
  expect(b.units.filter((u) => u.id >= 900)).toHaveLength(0);
  expect(b.hero.arm!.ammo).toBe(HEAVY.lance.ammo - 1);
  expect(b.hero.heat).toBe(0);
  for (let i = 0; i < 400 && b.hero.arm; i++) step(b, { ...idle(yaw), fire: true });
  expect(b.hero.arm).toBeNull();
  expect(lance.ready).toBeGreaterThan(b.time);
  expect(lance.ready - b.time).toBeLessThanOrEqual(CACHE_BACK);
});

test("big maps: a bigger field, more posts, and the war hands them to the bigger battles", () => {
  for (const [sector, map] of Object.entries(BIG_MAP_FOR)) expect(BIG_MAPS[map!]?.sector as string).toBe(sector);
  for (const [map, m] of Object.entries(BIG_MAPS)) {
    const b = startBattle(spec({ sector: m.sector, map }));
    expect(b.half).toBe(m.half);
    expect(b.posts.map((p) => p.name)).toEqual(m.posts.map((p) => p.name));
    for (const p of b.posts) expect(Math.abs(p.x) < b.half && Math.abs(p.z) < b.half).toBe(true);
    const done = run(spec({ sector: m.sector, map, seed: 7 }), 120);
    for (const u of done.units) expect(Math.abs(u.x) <= done.half && Math.abs(u.z) <= done.half).toBe(true);
  }
  // A map named for another kind of sector is ignored.
  expect(startBattle(spec({ sector: "cannon", map: "ridge" })).half).toBe(120);
  // The hero still faces the enemy's end from their spawn on a big field.
  const big = startBattle(spec({ map: "ridge" })), me = heroUnit(big)!;
  expect(Math.abs(yawTo(me, big.spawn.defender))).toBeLessThan(0.6);
});
