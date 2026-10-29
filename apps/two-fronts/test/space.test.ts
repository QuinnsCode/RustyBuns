import { expect, test } from "bun:test";
import type { SpaceBattleSpec } from "../src/battle/contract.ts";
import { ARENA, DT, HULL, LEASH, LINE, SPACE_LIMIT, heading, heroCraft, runSpace, startSpaceBattle, stepSpace } from "../src/battle/space.ts";

// A fixture straight from the contract: the space battle never needs the strategy layer to run.
const spec = (over: Partial<SpaceBattleSpec> = {}): SpaceBattleSpec => ({
  id: "1-kessa-orbit", turn: 1, system: "Kessa",
  factions: { attacker: "marines", defender: "wooka" }, hero: "attacker", heroLevel: 1,
  fleets: { attacker: 2, defender: 2 }, seed: 42, ...over,
});

test("a space battle runs to a result that matches the contract, the same every time", () => {
  const a = runSpace(spec()), b = runSpace(spec());
  expect(a.over).not.toBeNull();
  expect(a.over).toEqual(b.over!);
  expect(a.over!.id).toBe("1-kessa-orbit");
  const loser = a.over!.winner === "attacker" ? "defender" : "attacker";
  expect(a.over!.fleets[loser] === 0 || a.time >= SPACE_LIMIT).toBe(true);
  for (const s of ["attacker", "defender"] as const) expect(a.over!.fleets[s]).toBeLessThanOrEqual(2);
});

test("a cruiser for each ship, lined up on its own side", () => {
  const b = startSpaceBattle(spec({ fleets: { attacker: 3, defender: 1 } }));
  const line = (s: "attacker" | "defender") => b.craft.filter((u) => u.side === s && u.kind === "cruiser");
  expect(line("attacker").map((u) => u.z)).toEqual([LINE, LINE, LINE]);
  expect(line("defender").map((u) => u.z)).toEqual([-LINE]);
  expect(heroCraft(b)!.side).toBe("attacker");
});

test("more ships win more space battles", () => {
  let big = 0, small = 0;
  for (let seed = 1; seed <= 6; seed++) {
    if (runSpace(spec({ seed, fleets: { attacker: 4, defender: 1 } })).over!.winner === "attacker") big++;
    if (runSpace(spec({ seed, fleets: { attacker: 1, defender: 4 } })).over!.winner === "attacker") small++;
  }
  expect(big).toBeGreaterThan(small);
});

test("an AI-flown hero doesn't decide every even fight: either side can win it", () => {
  const wins = (hero: "attacker" | "defender") => {
    let n = 0;
    for (let seed = 1; seed <= 20; seed++) if (runSpace(spec({ seed, hero, fleets: { attacker: 3, defender: 3 } })).over!.winner === hero) n++;
    return n;
  };
  for (const hero of ["attacker", "defender"] as const) {
    expect(wins(hero)).toBeGreaterThan(0);
    expect(wins(hero)).toBeLessThan(20);
  }
});

test("the fighters launch in waves and stay in the arena", () => {
  const b = startSpaceBattle(spec());
  for (let t = 0; t < 1; t += DT) stepSpace(b, null);
  expect(b.craft.filter((u) => u.kind === "fighter").length).toBeGreaterThan(4);
  for (let t = 0; t < 30; t += DT) stepSpace(b, null);
  for (const u of b.craft) expect(Math.hypot(u.x, u.y, u.z)).toBeLessThan(ARENA + 60);
});

test("the hero's fighter turns towards where they point, no faster than it can, and flies on", () => {
  const b = startSpaceBattle(spec());
  const hero = heroCraft(b)!, z = hero.z;
  stepSpace(b, { yaw: Math.PI / 2, pitch: 0.4, throttle: 0, fire: false });
  expect(hero.yaw).toBeGreaterThan(0);
  expect(hero.yaw).toBeLessThan(0.1); // one step's worth of turn
  for (let i = 0; i < 60; i++) stepSpace(b, { yaw: 0, pitch: 0, throttle: 1, fire: false });
  expect(hero.z).toBeLessThan(z - 80); // yaw 0 flies towards -z, boosted
  expect(heading(0, 0)).toEqual({ x: -0, y: 0, z: -1 });
});

test("the hero's guns hit what they point at", () => {
  const b = startSpaceBattle(spec());
  const hero = heroCraft(b)!;
  const foe = b.craft.find((u) => u.side === "defender" && u.kind === "cruiser")!;
  hero.x = foe.x; hero.y = foe.y; hero.z = foe.z + 60;
  const hp = foe.hp;
  for (let i = 0; i < 30; i++) stepSpace(b, { yaw: 0, pitch: 0, throttle: -1, fire: true });
  expect(foe.hp).toBeLessThan(hp);
  // Finish it off, and it's the hero's kill.
  foe.hp = 1;
  for (let i = 0; i < 30 && foe.hp > 0; i++) stepSpace(b, { yaw: 0, pitch: 0, throttle: -1, fire: true });
  stepSpace(b, { yaw: 0, pitch: 0, throttle: -1, fire: false });
  expect(b.hero.kills).toBe(1);
  expect(b.events).toContain("You finished off an enemy cruiser");
});

test("losing every life is reported as heroDown", () => {
  const b = startSpaceBattle(spec());
  for (let i = 0; i < 3; i++) {
    heroCraft(b)!.hp = 0;
    stepSpace(b, null);
    for (let t = 0; t < 4.2 && i < 2; t += DT) stepSpace(b, null);
  }
  expect(b.hero.lives).toBe(0);
  for (const u of b.craft) if (u.side === "defender" && u.kind === "cruiser") u.hp = 0;
  stepSpace(b, null);
  expect(b.over).toMatchObject({ winner: "attacker", heroDown: true });
});

test("nobody flies through a cruiser", () => {
  const b = startSpaceBattle(spec());
  const hero = heroCraft(b)!, foe = b.craft.find((u) => u.side === "defender" && u.kind === "cruiser")!;
  hero.x = foe.x; hero.y = foe.y; hero.z = foe.z + 40;
  for (let i = 0; i < 90; i++) {
    stepSpace(b, { yaw: 0, pitch: 0, throttle: 0, fire: false });
    expect(Math.hypot(hero.x - foe.x, hero.y - foe.y, hero.z - Math.max(foe.z - HULL.half, Math.min(foe.z + HULL.half, hero.z)))).toBeGreaterThanOrEqual(HULL.r - 1e-9);
  }
});

test("a hero who flies off into space is turned back to the fight", () => {
  const b = startSpaceBattle(spec());
  const hero = heroCraft(b)!;
  hero.x = 0; hero.y = 0; hero.z = 0;
  let furthest = 0;
  // Holding the stick hard out to the side for a minute.
  for (let t = 0; t < 60 && heroCraft(b) === hero; t += DT) {
    stepSpace(b, { yaw: Math.PI / 2, pitch: 0, throttle: 1, fire: false });
    furthest = Math.max(furthest, Math.hypot(hero.x, hero.y, hero.z));
  }
  expect(furthest).toBeGreaterThan(LEASH);
  expect(furthest).toBeLessThan(LEASH + 120);
  expect(b.events).toContain("Leaving the battle: turning back");
});

test("out of the fire for a few seconds, the hero's shields come back", () => {
  const b = startSpaceBattle(spec());
  const hero = heroCraft(b)!;
  b.craft = b.craft.filter((u) => u === hero || u.kind === "cruiser");
  hero.hp = 40; hero.x = 0; hero.y = 0; hero.z = 0;
  b.launchAt = { attacker: 1e9, defender: 1e9 };
  for (let t = 0; t < 10; t += DT) stepSpace(b, { yaw: Math.PI / 2, pitch: 0, throttle: -1, fire: false });
  expect(hero.hp).toBeGreaterThan(80);
});
