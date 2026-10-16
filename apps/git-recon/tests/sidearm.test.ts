// The pistol every kit ends in, the sticky plasma grenade, and the jump and wall feel.
import { describe, expect, test } from "bun:test";
import type { Block, CodeMap } from "../src/sim/codemap.ts";
import { COYOTE, Game, RADIUS, type Input } from "../src/sim/game.ts";
import { ROLE_ORDER, ROLES } from "../src/sim/roles.ts";
import type { Terrain } from "@rustybuns/terrain";
import { WEAPONS } from "../src/sim/weapons.ts";

const flat: Terrain = { R: 80, height: () => 0 };
const idle: Input = { right: 0, forward: 0, yaw: 0, pitch: 0, jump: false, roll: false, crouch: false, fire: false };
const map = (terrain: Terrain, blocks: Block[] = []): CodeMap => ({
  terrain, spawn: { x: 0, z: 0, yaw: 0 }, blocks,
  compounds: [{ folder: "apps/far", x: 60, z: 60, r: 8, files: 1, lines: 1, guards: 3 }],
});
const run = (g: Game, seconds: number, inp: Partial<Input> = {}) => { for (let i = 0; i < seconds * 60; i++) g.step(1 / 60, { ...idle, ...inp }); };

describe("the sidearm", () => {
  test("every role carries the pistol, and its spare magazines never run out", () => {
    for (const r of ROLE_ORDER) {
      const you = new Game(map(flat), 1, { kind: "clear" }, undefined, r).you();
      expect(ROLES[r].weapons.at(-1)).toBe("amend");
      expect(you.ammo.amend).toBe(-1);
    }
  });

  test("emptying a role's other guns leaves the pistol to fall back on", () => {
    const g = new Game(map(flat), 1, { kind: "clear" }, undefined, "reviewer"), you = g.you();
    for (const w of ROLES.reviewer.weapons) if (w !== "amend") you.ammo[w] = 0;
    run(g, 0.1, { fire: true });
    expect(you.weapon).toBe("amend");
    run(g, 0.5, { fire: true });
    expect(g.shots.some((p) => p.weapon === "amend")).toBe(true);
  });
});

describe("plasma", () => {
  test("it sticks to a soldier, rides along with them, and goes off when the fuse runs out", () => {
    const g = new Game(map(flat), 1), you = g.you();
    const guard = g.soldiers[1]!;
    Object.assign(guard, { x: 0, z: -12, brain: null, team: "conflict" });
    you.weapon = "squash";
    run(g, 1 / 60, { fire: true, pitch: 0.12 });
    const ball = g.shots.find((p) => p.weapon === "squash")!;
    expect(ball).toBeDefined();
    // Put it in the guard's chest as if it had landed there.
    Object.assign(ball, { x: guard.x, y: guard.y + 1, z: guard.z - 0.1, vx: 0, vy: 0, vz: -5 });
    run(g, 1 / 60);
    expect(ball.stuck?.id).toBe(guard.id);
    guard.x += 3;
    run(g, 0.1);
    expect(Math.abs(ball.x - guard.x)).toBeLessThan(0.5);
    const hp = guard.hp + guard.shield;
    run(g, WEAPONS.squash.life);
    expect(g.shots.some((p) => p.weapon === "squash")).toBe(false);
    expect(guard.hp + guard.shield).toBeLessThan(hp);
  });

  test("on the ground it stays put until it goes off", () => {
    const g = new Game(map(flat), 1), you = g.you();
    you.weapon = "squash";
    run(g, 1 / 60, { fire: true });
    run(g, 1.5);
    const ball = g.shots.find((p) => p.weapon === "squash")!;
    expect(ball.stuck?.id).toBe(-1);
    const at = { x: ball.x, z: ball.z };
    run(g, 0.2);
    expect({ x: ball.x, z: ball.z }).toEqual(at);
  });
});

describe("moving", () => {
  test("a jump still works just after walking off a ledge, not long after", () => {
    const ledge: Terrain = { R: 80, height: (x, z) => (z > -3 ? 4 : 0) };
    const first = (late: number) => {
      const g = new Game(map(ledge), 1), you = g.you();
      Object.assign(you, { x: 0, z: -2.9, y: 4 });
      run(g, 1 / 60, { forward: 1, yaw: 0 });
      // Walk off the edge (towards -z), then press jump `late` seconds later.
      for (let i = 0; i < 60 && you.grounded; i++) g.step(1 / 60, { ...idle, forward: 1 });
      run(g, late);
      const vy = you.vy;
      g.step(1 / 60, { ...idle, jump: true });
      return you.vy - vy;
    };
    expect(first(COYOTE / 2)).toBeGreaterThan(5);
    expect(first(COYOTE * 3)).toBeLessThan(0);
  });

  test("a jump pressed a moment before landing goes off as you touch down", () => {
    const g = new Game(map(flat), 1), you = g.you();
    Object.assign(you, { y: 0.4, grounded: false, vy: -3 });
    g.step(1 / 60, { ...idle, jump: true });
    run(g, 0.2);
    expect(you.vy > 0 || you.y > 0.5).toBe(true);
  });

  test("running into a wall slides along it instead of sticking", () => {
    const wall: Block = { x: 0, y: 0, z: -3, w: 20, h: 4, d: 1, path: "w.ts", lines: 10, compound: -1 } as Block;
    const g = new Game(map(flat, [wall]), 1), you = g.you();
    run(g, 2, { forward: 1, right: 0.5 });
    expect(you.z).toBeGreaterThan(-3 + 0.5 + RADIUS - 0.2);
    expect(you.x).toBeGreaterThan(2);
  });
});
