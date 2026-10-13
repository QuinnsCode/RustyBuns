// Reloading, roles, slopes, barrels and the killstreak vehicles.
import { describe, expect, test } from "bun:test";
import type { Block, CodeMap } from "../src/sim/codemap.ts";
import { BARREL_HP, climb, Game, MAX_HP, type Input } from "../src/sim/game.ts";
import { ROLES } from "../src/sim/roles.ts";
import type { Terrain } from "../src/sim/terrain.ts";
import { STREAKS, VEHICLES } from "../src/sim/vehicles.ts";
import { WEAPONS } from "../src/sim/weapons.ts";

const flat: Terrain = { R: 80, height: () => 0 };
const idle: Input = { right: 0, forward: 0, yaw: 0, pitch: 0, jump: false, roll: false, crouch: false, fire: false };
const map = (terrain: Terrain, compounds: { x: number; z: number; guards: number }[] = [], blocks: Block[] = []): CodeMap => ({
  terrain, spawn: { x: 0, z: 0, yaw: 0 }, blocks,
  compounds: compounds.map((c, i) => ({ folder: `apps/c${i}`, x: c.x, z: c.z, r: 8, files: 1, lines: 1, guards: c.guards })),
});
const run = (g: Game, seconds: number, inp: Partial<Input> = {}) => { for (let i = 0; i < seconds * 60; i++) g.step(1 / 60, { ...idle, ...inp }); };
/** Far-off guards that can't see you, so a level doesn't end when one goes down. */
const quiet = [{ x: 60, z: 60, guards: 3 }];

describe("reloading", () => {
  test("a magazine runs dry, the gun reloads by itself, then fires again", () => {
    const g = new Game(map(flat, quiet), 1), you = g.you();
    you.loaded.commit = 1;
    run(g, 0.05, { fire: true });
    expect(you.loaded.commit).toBe(0);
    expect(you.reload).toBeGreaterThan(0);
    const shots = g.shots.length;
    run(g, 0.5, { fire: true });
    expect(g.shots.length).toBe(shots - g.shots.filter((p) => p.dead).length); // nothing new mid-reload
    run(g, WEAPONS.commit.reload, { fire: false });
    expect(you.reload).toBe(0);
    expect(you.loaded.commit).toBe(WEAPONS.commit.mag);
  });

  test("R reloads a part-empty magazine; a full one doesn't", () => {
    const g = new Game(map(flat, quiet), 1), you = g.you();
    g.step(1 / 60, { ...idle, reload: true });
    expect(you.reload).toBe(0);
    you.loaded.add = 2;
    you.weapon = "add";
    g.step(1 / 60, { ...idle, reload: true });
    expect(you.reload).toBeGreaterThan(0);
    run(g, WEAPONS.add.reload + 0.1);
    expect(you.loaded.add).toBe(WEAPONS.add.mag);
  });

  test("the last magazine of a gun with little ammo left holds only what's left", () => {
    const g = new Game(map(flat, quiet), 1), you = g.you();
    you.weapon = "rebase", you.ammo.rebase = 3, you.loaded.rebase = 0;
    g.step(1 / 60, { ...idle, reload: true });
    run(g, WEAPONS.rebase.reload + 0.1);
    expect(you.loaded.rebase).toBe(3);
  });
});

describe("roles", () => {
  test("a role carries only its kit, its first gun never runs dry", () => {
    const g = new Game(map(flat, quiet), 1, { kind: "clear" }, undefined, "reviewer"), you = g.you();
    expect(you.weapon).toBe("rebase");
    expect(you.ammo.rebase).toBe(-1);
    expect(you.ammo.push).toBe(0);
    expect(you.kit).toEqual(ROLES.reviewer.weapons);
  });

  test("the role you pick next takes over when you come back from the reflog", () => {
    const g = new Game(map(flat, quiet), 1, { kind: "clear" }, undefined, "committer"), you = g.you();
    g.nextRole = "maintainer";
    expect(you.weapon).toBe("commit");
    g.hurt(you, 1e9, 1);
    expect(g.role).toBe("maintainer");
    expect(you.weapon).toBe("fetch");
    expect(you.ammo.commit).toBe(0);
    expect(g.nextRole).toBeNull();
  });
});

describe("slopes", () => {
  test("the steeper it is, the slower the climb", () => {
    expect(climb(0)).toBe(1);
    expect(climb(0.25)).toBeLessThan(0.85);
    expect(climb(0.5)).toBeLessThan(climb(0.25));
    expect(climb(0.9)).toBeLessThan(0.3);
    expect(climb(-0.3)).toBeGreaterThan(1);
  });

  test("walking up a hill covers less ground than on the flat", () => {
    const hill: Terrain = { R: 80, height: (_x, z) => Math.max(0, -z) * 0.5 };
    const flatGame = new Game(map(flat, quiet), 1), hillGame = new Game(map(hill, quiet), 1);
    run(flatGame, 2, { forward: 1 }), run(hillGame, 2, { forward: 1 });
    expect(-hillGame.you().z).toBeLessThan(-flatGame.you().z * 0.75);
  });

  test("too steep to stand on, you slide back down", () => {
    const wall: Terrain = { R: 80, height: (_x, z) => Math.max(0, -z - 2) * 0.95 };
    const g = new Game({ ...map(wall, quiet), spawn: { x: 0, z: -6, yaw: 0 } }, 1);
    run(g, 1.5);
    expect(g.you().z).toBeGreaterThan(-5);
  });
});

describe("barrels", () => {
  test("a yard has barrels, and shooting one sets off the one beside it", () => {
    const g = new Game(map(flat, [{ x: 0, z: -20, guards: 1 }]), 1);
    expect(g.barrels.length).toBeGreaterThan(0);
    const [a] = g.barrels;
    g.barrels = [a!, { ...a!, id: 999, x: a!.x + 2 }];
    g.hurt(g.soldiers[1]!, 0, 0);
    // Hit it with a shot.
    g.shots.push({ id: 500, owner: 0, team: "you", weapon: "rebase", x: a!.x, y: a!.y + 0.5, z: a!.z + 0.3, vx: 0, vy: 0, vz: -60, age: 0, dead: false });
    expect(WEAPONS.rebase.damage).toBeGreaterThanOrEqual(BARREL_HP);
    const booms: number[] = [];
    for (let i = 0; i < 60; i++) for (const e of g.step(1 / 60, idle)) if (e.kind === "boom") booms.push(i);
    expect(g.barrels.length).toBe(0);
    expect(booms.length).toBe(2);
    expect(booms[1]!).toBeGreaterThan(booms[0]!);
  });
});

describe("killstreak vehicles", () => {
  /** A level with plenty of guards far off, so downing some doesn't end it. */
  function streaky() {
    const g = new Game(map(flat, [{ x: 60, z: 60, guards: 30 }]), 1);
    const guards = g.soldiers.filter((s) => s.team === "conflict");
    for (const s of guards) s.brain = null;
    return { g, guards };
  }

  test("15 kills drops a buggy, 25 a helicopter", () => {
    const { g, guards } = streaky();
    const seen: string[] = [];
    for (let i = 0; i < 25; i++) g.hurt(guards[i]!, 1e9, 0);
    for (const e of g.events) if (e.kind === "streak") seen.push(`${e.kills}:${e.vehicle}`);
    expect(seen).toEqual(STREAKS.map((s) => `${s.kills}:${s.kind}`));
    expect(g.vehicles.map((v) => v.kind)).toEqual(["buggy", "heli"]);
  });

  test("get in the buggy, drive it, run a guard over, get out", () => {
    const { g, guards } = streaky();
    for (let i = 0; i < 15; i++) g.hurt(guards[i]!, 1e9, 0);
    const buggy = g.vehicles[0]!, you = g.you();
    run(g, 2);
    expect(buggy.y).toBeCloseTo(0, 1);
    Object.assign(you, { x: buggy.x + 1, z: buggy.z });
    g.step(1 / 60, { ...idle, use: true });
    expect(you.vehicle).toBe(buggy.id);
    const victim = guards[20]!;
    Object.assign(victim, { x: buggy.x, z: buggy.z - 25, y: 0 });
    const kills = g.kills;
    run(g, 2.5, { forward: 1, yaw: buggy.yaw });
    expect(buggy.z).toBeLessThan(-10);
    expect(victim.alive).toBe(false);
    expect(g.kills).toBe(kills + 1);
    g.step(1 / 60, { ...idle, use: true });
    expect(you.vehicle).toBe(-1);
    expect(buggy.driver).toBe(-1);
  });

  test("the helicopter climbs and soaks hits; wrecked, it throws you clear", () => {
    const { g, guards } = streaky();
    for (let i = 0; i < 25; i++) g.hurt(guards[i]!, 1e9, 0);
    const heli = g.vehicles.find((v) => v.kind === "heli")!, you = g.you();
    run(g, 8);
    Object.assign(you, { x: heli.x, z: heli.z, y: heli.y });
    g.step(1 / 60, { ...idle, use: true });
    expect(you.vehicle).toBe(heli.id);
    const low = heli.y;
    run(g, 2, { up: true });
    expect(heli.y).toBeGreaterThan(low + 8);
    g.hurt(you, 100, guards[29]!.id);
    expect(you.hp).toBe(MAX_HP);
    expect(heli.hp).toBe(VEHICLES.heli.hp - 100);
    g.hurt(you, 1e4, guards[29]!.id);
    expect(g.vehicles.some((v) => v.kind === "heli")).toBe(false);
    expect(you.vehicle).toBe(-1);
    expect(you.alive).toBe(true);
  });
});
