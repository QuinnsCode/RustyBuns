import { describe, expect, test } from "bun:test";
import { LEVELS } from "../src/levels/levels.ts";
import { folderOf, heightOf, mapRepo, type RepoSnapshot } from "../src/sim/codemap.ts";
import { Game, MAX_HP, ROLL_TIME, type Input } from "../src/sim/game.ts";
import { slope, stampTerrain, withPads, type Terrain } from "../src/sim/terrain.ts";
import { splashDamage, WEAPONS } from "../src/sim/weapons.ts";

const flat: Terrain = { R: 80, height: () => 0 };
const repo: RepoSnapshot = {
  name: "toy",
  ref: "abc123",
  files: [
    ...Array.from({ length: 8 }, (_, i) => ({ path: `apps/web/src/f${i}.ts`, lines: 400 + i * 50 })),
    ...Array.from({ length: 5 }, (_, i) => ({ path: `packages/core/m${i}.ts`, lines: 300 })),
    { path: "README.md", lines: 80 },
    { path: "scripts/x.ts", lines: 20 },
  ],
};
const idle: Input = { right: 0, forward: 0, yaw: 0, pitch: 0, jump: false, roll: false, crouch: false, fire: false };

describe("terrain", () => {
  test("stamps shape the ground", () => {
    const t = stampTerrain({ R: 50, seed: 1, amp: 0, freq: 0.05, stamps: [{ kind: "plateau", x: 0, z: 0, r: 5, h: 4, falloff: 1 }, { kind: "crater", x: 20, z: 0, r: 4, h: 2, falloff: 1 }] });
    expect(t.height(0, 0)).toBeCloseTo(4);
    expect(t.height(20, 0)).toBeCloseTo(-2);
    expect(t.height(-30, 0)).toBeCloseTo(0);
  });

  test("a pad is level across its disc", () => {
    const ramp: Terrain = { R: 50, height: (x) => x * 0.3 };
    const t = withPads(ramp, [{ x: 10, z: 0, r: 5 }]);
    expect(t.height(6, 0)).toBeCloseTo(3);
    expect(t.height(14, 2)).toBeCloseTo(3);
    expect(t.height(30, 0)).toBeCloseTo(9);
  });

  test("El Capitan is real ground: a wall on the north side, a valley floor to play on", () => {
    const t = LEVELS.find((l) => l.id === "el-capitan")!.ground();
    let steepest = 0;
    for (let z = -t.R + 5; z < 0; z += 5) steepest = Math.max(steepest, slope(t, 0, z));
    expect(steepest).toBeGreaterThan(1);
    expect(slope(t, 0, 80)).toBeLessThan(0.5);
  });
});

describe("codemap", () => {
  test("folders group as apps/x, packages/x and top folders", () => {
    expect(folderOf("apps/web/src/a.ts")).toBe("apps/web");
    expect(folderOf("packages/cli/x.ts")).toBe("packages/cli");
    expect(folderOf("scripts/x.ts")).toBe("scripts");
    expect(folderOf("README.md")).toBe(".");
    expect(heightOf(1)).toBeLessThan(heightOf(2000));
  });

  test("the biggest folders become compounds, the rest crates, the same every time", () => {
    const a = mapRepo(flat, repo, 5), b = mapRepo(flat, repo, 5);
    expect(a.compounds.map((c) => c.folder).slice(0, 2)).toEqual(["apps/web", "packages/core"]);
    expect(JSON.stringify(a.blocks)).toBe(JSON.stringify(b.blocks));
    for (const blk of a.blocks.filter((x) => x.compound >= 0)) {
      const c = a.compounds[blk.compound]!;
      expect(Math.hypot(blk.x - c.x, blk.z - c.z)).toBeLessThan(c.r);
    }
  });

  test("no two blocks overlap, and nothing lands on the spawn", () => {
    const m = mapRepo(flat, repo, 9);
    for (const [i, p] of m.blocks.entries()) {
      expect(Math.hypot(p.x - m.spawn.x, p.z - m.spawn.z)).toBeGreaterThan(3);
      for (const q of m.blocks.slice(i + 1)) {
        const apart = Math.abs(p.x - q.x) >= (p.w + q.w) / 2 || Math.abs(p.z - q.z) >= (p.d + q.d) / 2;
        expect(apart).toBe(true);
      }
    }
  });

  test.each(LEVELS.map((l) => [l.id, l] as const))("%s maps the repo into compounds you can walk to", (_, l) => {
    const m = mapRepo(l.ground(), l.repo, l.seed);
    expect(m.compounds.length).toBeGreaterThanOrEqual(4);
    expect(m.blocks.length).toBeGreaterThan(40);
  });
});

describe("game", () => {
  // A one-compound level with the guard parked right in front of you.
  function duel() {
    const g = Game.fromRepo(flat, { name: "duel", ref: "x", files: [{ path: "apps/a/x.ts", lines: 10 }] }, 2);
    const you = g.you(), guard = g.soldiers[1]!;
    for (const s of g.soldiers.slice(2)) s.alive = false;
    Object.assign(you, { x: 0, z: 0, y: 0 });
    Object.assign(guard, { x: 0, z: -10, y: 0 });
    g.map.blocks.length = 0;
    guard.brain!.home = { x: 0, z: -10 };
    return { g, you, guard };
  }

  test("a commit round hits what's in front of you", () => {
    const { g, guard } = duel();
    guard.brain = null;
    g.step(0.2, { ...idle, fire: true, aim: { x: 0, y: 1.2, z: -10 } });
    expect(guard.hp).toBeLessThan(MAX_HP);
  });

  test("a push round splashes and shoves", () => {
    const { g, you, guard } = duel();
    guard.brain = null;
    you.weapon = "push";
    g.step(0.6, { ...idle, fire: true, aim: { x: 0, y: 0, z: -10 } });
    expect(guard.hp).toBeLessThan(MAX_HP);
    expect(Math.hypot(guard.vx, guard.vz) + Math.abs(guard.z + 10)).toBeGreaterThan(0.5);
    expect(you.ammo.push).toBe(WEAPONS.push.ammo - 1);
  });

  test("splash fades to nothing at its edge", () => {
    expect(splashDamage(WEAPONS.merge, 0)).toBe(WEAPONS.merge.damage);
    expect(splashDamage(WEAPONS.merge, WEAPONS.merge.splash)).toBe(0);
  });

  test("a dive-roll dodges direct hits", () => {
    const { g, you, guard } = duel();
    guard.brain = null;
    g.step(1 / 60, { ...idle, roll: true, right: 1 });
    expect(you.roll).toBeGreaterThan(0);
    you.roll = ROLL_TIME;
    const shot = { id: 99, owner: guard.id, team: "conflict" as const, weapon: "commit" as const, x: you.x, y: 1, z: you.z + 0.6, vx: 0, vy: 0, vz: -100, age: 0, dead: false };
    g.shots.push(shot);
    g.step(1 / 60, idle);
    expect(you.hp).toBe(MAX_HP);
  });

  test("guards see you, wait a beat, then shoot", () => {
    const { g, you } = duel();
    for (let i = 0; i < 180; i++) g.step(1 / 60, idle);
    expect(you.hp).toBeLessThan(MAX_HP);
  });

  test("downing the last guard merges the compound and wins", () => {
    const { g, guard } = duel();
    g.hurt(guard, 999, 0);
    expect(g.cleared[0]).toBe(true);
    expect(g.status).toBe("won");
  });

  test("you come back from the reflog until it runs out", () => {
    const { g, you } = duel();
    for (let i = 0; i < 3; i++) {
      g.hurt(you, 999, 1);
      expect(you.alive).toBe(true);
    }
    g.hurt(you, 999, 1);
    expect(g.status).toBe("lost");
  });

  test("cliffs can't be walked up", () => {
    const wall: Terrain = { R: 80, height: (_x, z) => (z < -5 ? 20 : 0) };
    const g = new Game({ terrain: wall, spawn: { x: 0, z: 0, yaw: 0 }, compounds: [], blocks: [] });
    for (let i = 0; i < 120; i++) g.step(1 / 60, { ...idle, forward: 1 });
    expect(g.you().z).toBeGreaterThan(-5.5);
    expect(g.you().y).toBeLessThan(1);
  });

  test("you can climb onto a file", () => {
    const g = new Game({ terrain: flat, spawn: { x: 0, z: 0, yaw: 0 }, compounds: [], blocks: [{ path: "a.ts", lines: 1, compound: -1, x: 0, z: -3, y: 0, w: 2, d: 2, h: 1.2 }] });
    const go = (inp: Partial<Input>, n: number) => { for (let i = 0; i < n; i++) g.step(1 / 60, { ...idle, ...inp }); };
    go({ forward: 1 }, 20);
    expect(g.you().z).toBeGreaterThan(-2); // blocked by its side
    go({ forward: 1, jump: true }, 1);
    // Up and over the edge, then stop on top.
    go({ forward: 1 }, 6);
    go({}, 60);
    expect(g.you().z).toBeLessThan(-2);
    expect(g.you().y).toBeCloseTo(1.2, 1);
    expect(g.you().grounded).toBe(true);
  });
});
