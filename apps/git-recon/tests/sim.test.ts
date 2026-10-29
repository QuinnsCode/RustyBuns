import { describe, expect, setDefaultTimeout, test } from "bun:test";

// Every level is mapped (paths searched and cut) in a few tests, and one walks every path: slow on CI.
setDefaultTimeout(60_000);
import { LEVELS, PLAY_RADIUS, placeLevel } from "../src/levels/levels.ts";
import { groundAt, parsePlace, placeName, worldPx, type TileSource } from "../src/levels/place.ts";
import { folderOf, gateDir, heightOf, mapRepo, STAIR_STEPS, styleOf, TOWER_HEIGHT, trail, WALK, WALL_HEIGHT, WATCH_HEIGHT, type Block, type RepoSnapshot } from "../src/sim/codemap.ts";
import { AMMO_CRATE, BANDS, CHUTE_FALL, fileHp, Game, HEALTH_CRATE, HEAR, LEAN_REACH, MAX_HEAT, HEAVY_HP, HEAVY_SHIELD, MAX_HP, MAX_SHIELD, ROLL_COOLDOWN, ROLL_SPEED, RUN, SHIELD_DELAY, SIGHT, PRONE_SPEED, ROLL_TIME, scopeSway, STASH_HP, STEP, tacticFor, type Input, type Objective, type Soldier } from "../src/sim/game.ts";
import { briefing, missionFor, OVERRUN, type Mission } from "../src/sim/missions.ts";
import { contourStep, slope, stampTerrain, wet, withPads, type Terrain } from "@rustybuns/terrain";
import { ORDER, rangeDamage, splashDamage, WEAPONS } from "../src/sim/weapons.ts";
import { ROLES } from "../src/sim/roles.ts";
import { VOICES } from "../src/ui/audio.ts";

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

describe("ground", () => {
  test("a water table floods what's below it", () => {
    const t = withPads(stampTerrain({ R: 50, seed: 1, amp: 0, freq: 0.05, water: -1, stamps: [{ kind: "crater", x: 0, z: 0, r: 5, h: 2, falloff: 1 }] }), []);
    expect(t.water).toBe(-1);
    expect(wet(t, 0, 0)).toBe(true);
    expect(wet(t, 20, 0)).toBe(false);
    expect(wet(flat, 0, 0)).toBe(false);
  });

  test("contours space out with the relief", () => {
    expect(contourStep(0, 2)).toBeLessThan(0.5);
    expect(contourStep(0, 9)).toBe(1);
    expect(contourStep(0, 130)).toBe(10);
  });

  test("a place reads as lat, long", () => {
    expect(parsePlace("37.7459, -119.5332")).toEqual({ lat: 37.7459, lon: -119.5332 });
    expect(parsePlace("51.5 -0.12")).toEqual({ lat: 51.5, lon: -0.12 });
    expect(parsePlace("Half Dome")).toBeNull();
    expect(parsePlace("91, 0")).toBeNull();
    expect(placeName(-33.8568, 151.2153)).toBe("33.8568° S 151.2153° E");
  });

  // One Terrarium tile recorded from AWS Terrain Tiles: z14 2752/6334, the high country just east of Half Dome's summit.
  const recorded: TileSource = async (z, x, y) => {
    if (`${z}/${x}/${y}` !== "14/2752/6334") throw new Error(`no recorded tile ${z}/${x}/${y}`);
    return new Uint8Array(await Bun.file(new URL("./fixtures/terrarium-14-2752-6334.png", import.meta.url)).arrayBuffer());
  };
  // The tile's centre, and a disc that stays inside it.
  const [lat, lon] = [37.744657, -119.520264];

  test("a lat/long becomes real ground from a recorded tile", async () => {
    const [gx, gy] = worldPx(lon, lat);
    expect([Math.floor(gx / 256), Math.floor(gy / 256)]).toEqual([2752, 6334]);
    const zone = await groundAt(lat, lon, { realRadius: 700, tiles: recorded });
    const h = new Int16Array(Uint8Array.from(atob(zone.heights), (c) => c.charCodeAt(0)).buffer);
    expect(h.length).toBe(zone.n * zone.n);
    // High Sierra granite: well above sea level, and hundreds of metres of relief.
    const lo = Math.min(...h), hi = Math.max(...h);
    expect(lo).toBeGreaterThan(1000);
    expect(hi).toBeLessThan(3000);
    expect(hi - lo).toBeGreaterThan(200);

    const level = placeLevel(zone);
    expect(level.ground().R).toBeCloseTo(PLAY_RADIUS);
    const m = mapRepo(level.ground(), level.repo, level.seed);
    expect(m.compounds.length).toBeGreaterThanOrEqual(4);
    expect(m.blocks.length).toBeGreaterThan(40);
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

  test("every compound has a gate toward HEAD and its files inside; a qalat has four corner towers with one watchtower, an inner wall and a stair onto the wall walk", () => {
    // A level takes its styles in turn, so a repo named for it starts on the qalat.
    const name = ["toy", "toy2", "toy3", "toy4"].find((n) => styleOf(n, 0) === "qalat")!;
    const m = mapRepo(flat, { ...repo, name }, 9);
    expect(m.compounds[0]!.style).toBe("qalat");
    m.compounds.forEach((c, ci) => {
      const mine = m.blocks.filter((b) => b.compound === ci), walls = mine.filter((b) => b.wall);
      const gx = m.spawn.x - c.x, gz = m.spawn.z - c.z;
      expect(c.gate).toBe(Math.abs(gx) > Math.abs(gz) ? (gx > 0 ? 0 : 1) : gz > 0 ? 2 : 3);
      for (const b of mine.filter((b) => !b.wall)) {
        expect(Math.abs(b.x - c.x)).toBeLessThan(c.half!);
        expect(Math.abs(b.z - c.z)).toBeLessThan(c.half!);
      }
      if (c.style !== "qalat") return;
      // Shelled, one tower is a stump.
      const towers = walls.filter((b) => b.h >= TOWER_HEIGHT);
      expect(towers).toHaveLength(c.bombed ? 3 : 4);
      expect(towers.filter((b) => b.h === WATCH_HEIGHT)).toHaveLength(1);
      // An inner wall across the yard, behind the centre, with a doorway.
      const g = gateDir(c.gate!), inner = walls.filter((b) => b.h < WALL_HEIGHT && b.h > 2 && (b.x - c.x) * g.x + (b.z - c.z) * g.z < -1);
      expect(inner.length).toBeGreaterThanOrEqual(2);
      // Stairs climb in steps no taller than a soldier steps up, and the top one reaches the wall walk.
      const steps = walls.filter((b) => b.h < 3 && b.w < 1.1 && b.d < 1.1).sort((a, b) => a.h - b.h);
      expect(steps).toHaveLength(STAIR_STEPS);
      steps.forEach((st, i) => expect(st.h - (steps[i - 1]?.h ?? 0)).toBeLessThanOrEqual(STEP));
      expect(WALL_HEIGHT - steps[steps.length - 1]!.h).toBeLessThanOrEqual(STEP);
    });
  });

  test("a footpath is cut to every compound's gate, never steeper than a soldier walks", () => {
    const m = mapRepo(flat, repo, 9);
    expect(m.trails).toHaveLength(m.compounds.length);
    for (const [i, t] of m.trails!.entries()) {
      const c = m.compounds[i]!, g = gateDir(c.gate!);
      expect(Math.hypot(t[0]!.x - m.spawn.x, t[0]!.z - m.spawn.z)).toBeLessThan(3);
      const end = t[t.length - 1]!;
      expect(Math.hypot(end.x - (c.x + g.x * (c.half! + 3)), end.z - (c.z + g.z * (c.half! + 3)))).toBeLessThan(3);
    }
    // Up a hill too steep to climb straight, the path is graded into it.
    const hill: Terrain = { R: 60, height: (x) => (x > 0 ? Math.min(12, x * 1.0) : 0) };
    const path = trail(hill, { x: -20, z: 0 }, { x: 30, z: 0 })!;
    expect(path).not.toBeNull();
    for (let i = 1; i < path.length; i++) {
      const run = Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.z - path[i - 1]!.z);
      expect(Math.abs(path[i]!.y - path[i - 1]!.y) / run).toBeLessThanOrEqual(WALK + 0.01);
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

  test.each(LEVELS.map((l) => [l.id, l] as const))("%s: a soldier walks the footpath to every compound's gate, and back to HEAD", (_, l) => {
    const m = mapRepo(l.ground(), l.repo, l.seed), g = new Game(m, l.seed);
    for (const s of g.soldiers.slice(1)) s.alive = false;
    const you = g.you();
    for (const [ci, there] of m.trails!.entries()) for (const path of [there, [...there].reverse()]) {
      Object.assign(you, { x: path[0]!.x, z: path[0]!.z, vx: 0, vz: 0, chute: false });
      you.y = g.ground(you.x, you.z, Infinity);
      let at = 0, t = 0;
      // Follow the path the way a player would, eyes on the ground a little ahead, until the gate or the clock runs out.
      while (t < 150) {
        while (at + 1 < path.length) {
          const a = path[at]!, b = path[at + 1]!, ex = b.x - a.x, ez = b.z - a.z;
          if (((you.x - a.x) * ex + (you.z - a.z) * ez) / (ex * ex + ez * ez || 1) >= 1) at++; else break;
        }
        const a = path[at]!, b = path[Math.min(path.length - 1, at + 1)]!, ex = b.x - a.x, ez = b.z - a.z, len = Math.hypot(ex, ez) || 1;
        const u = Math.max(0, Math.min(1, ((you.x - a.x) * ex + (you.z - a.z) * ez) / (len * len))), ahead = Math.min(1, u + 1.2 / len);
        const dx = a.x + ex * ahead - you.x, dz = a.z + ez * ahead - you.z;
        if (at >= path.length - 1 && Math.hypot(dx, dz) < 1.5) break;
        g.step(1 / 60, { ...idle, forward: 1, yaw: Math.atan2(-dx, -dz) });
        t += 1 / 60;
      }
      const end = path[path.length - 1]!;
      expect(Math.hypot(end.x - you.x, end.z - you.z), `${l.id}: ${m.compounds[ci]!.folder}${path === there ? "" : " back"} after ${Math.round(t)} s`).toBeLessThan(3);
    }
    expect(m.compounds.length).toBeGreaterThanOrEqual(4);
    expect(m.blocks.length).toBeGreaterThan(40);
    // Nobody starts in the pond, and no folder or crate is built under it.
    expect(wet(m.terrain, m.spawn.x, m.spawn.z)).toBe(false);
    for (const c of m.compounds) expect(wet(m.terrain, c.x, c.z)).toBe(false);
    for (const b of m.blocks) expect(wet(m.terrain, b.x, b.z)).toBe(false);
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
    g.map.blocks.length = 0, g.map.smoke = [];
    g.pickups.length = 0;
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
    const { g, guard } = duel();
    let fired = 0, first = -1;
    for (let i = 0; i < 180; i++) for (const e of g.step(1 / 60, idle)) if (e.kind === "fire" && e.id === guard.id) fired++, (first = first < 0 ? i : first);
    expect(first).toBeGreaterThan(10);
    expect(fired).toBeGreaterThan(2);
  });

  test("your shield soaks hits first, pops, then refills after a quiet spell", () => {
    const { g, you, guard } = duel();
    guard.brain = null;
    expect(you.shield).toBe(MAX_SHIELD);
    g.hurt(you, 50, guard.id);
    expect(you.shield).toBe(MAX_SHIELD - 50);
    expect(you.hp).toBe(MAX_HP);
    g.hurt(you, 50, guard.id);
    expect(you.shield).toBe(0);
    expect(you.hp).toBe(MAX_HP - 30);
    expect(g.events.some((e) => e.kind === "shield" && e.state === "broke")).toBe(true);
    const seen: string[] = [];
    for (let t = 0; t < SHIELD_DELAY - 0.2; t += 1 / 60) g.step(1 / 60, idle);
    expect(you.shield).toBe(0);
    for (let t = 0; t < 3; t += 1 / 60) for (const e of g.step(1 / 60, idle)) if (e.kind === "shield") seen.push(e.state);
    expect(you.shield).toBe(MAX_SHIELD);
    expect(you.hp).toBe(MAX_HP - 30);
    expect(seen).toEqual(["charging", "full"]);
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

describe("toy-soldier combat", () => {
  type C = { x: number; z: number; guards: number };
  /** A flat field with compounds where you say, no files on it unless given. */
  function field(compounds: C[], opts: { blocks?: Block[]; mission?: Mission } = {}) {
    const g = new Game({
      terrain: flat,
      spawn: { x: 0, z: 0, yaw: 0 },
      compounds: compounds.map((c, i) => ({ folder: `apps/c${i}`, x: c.x, z: c.z, r: 8, files: 1, lines: 1, guards: c.guards })),
      blocks: opts.blocks ?? [],
    }, 4, opts.mission);
    return g;
  }
  const box = (x: number, z: number, h = 2): Block => ({ path: "b.ts", lines: 1, compound: -1, x, z, y: 0, w: 2, d: 2, h });
  const run = (g: Game, seconds: number, inp: Partial<Input> = {}) => { for (let i = 0; i < seconds * 60; i++) g.step(1 / 60, { ...idle, ...inp }); };
  /** One still guard 10 m ahead of you. */
  function target() {
    const g = field([{ x: 0, z: -10, guards: 1 }]), guard = g.soldiers[1]!;
    Object.assign(guard, { x: 0, z: -10, brain: null });
    return { g, you: g.you(), guard };
  }

  describe("git weapons", () => {
    test("every weapon is a git command, and reset --hard is a pickup, not a starting weapon", () => {
      for (const w of ORDER) expect(WEAPONS[w].cmd).toStartWith("git ");
      expect(WEAPONS.reset.ammo).toBe(0);
    });

    test("cherry-pick follows the target it picked", () => {
      // Aimed 10 degrees off: a commit misses, a cherry-pick comes round onto it.
      const miss = target();
      miss.g.step(0.3, { ...idle, fire: true, aim: { x: 1.8, y: 1.2, z: -10 } });
      expect(miss.guard.hp).toBe(MAX_HP);
      const { g, you, guard } = target();
      you.weapon = "cherry";
      run(g, 1, { fire: true, aim: { x: 1.8, y: 1.2, z: -10 } });
      expect(guard.hp).toBeLessThan(MAX_HP);
    });

    test("revert sends a guard back where it was a few seconds ago", () => {
      const { g, you, guard } = target();
      run(g, 4);
      Object.assign(guard, { z: -20 });
      you.weapon = "revert";
      run(g, 0.4, { fire: true, aim: { x: 0, y: 1.2, z: -20 } });
      expect(guard.z).toBeCloseTo(-10, 0);
    });

    test("a stash is cover, and the guards shoot it instead of you", () => {
      const { g, you } = target();
      you.weapon = "stash";
      run(g, 1.5, { fire: true, aim: { x: 0, y: 0, z: -6 } });
      expect(g.stashes.length).toBe(1);
      const st = g.stashes[0]!;
      expect(g.blockAt(st.x, st.y + 0.5, st.z)).toBe(st);
      expect(g.clear(st.x, 0.6, st.z + 3, st.x, 0.6, st.z - 3)).toBe(false);

      // You're out of sight; a guard that sees the stash empties its rifle into it.
      const d = field([{ x: 0, z: -10, guards: 1 }]), guard = d.soldiers[1]!;
      Object.assign(guard, { x: 0, z: -10 });
      Object.assign(d.you(), { z: 70 });
      d.stashes.push({ ...box(0, 0, 1.3), id: 99, hp: STASH_HP, ttl: 30 });
      run(d, 3);
      expect(d.stashes[0]?.hp ?? 0).toBeLessThan(STASH_HP);
      expect(d.you().hp).toBe(MAX_HP);
    });

    test("blame tags a guard to be seen through walls", () => {
      const { g, you, guard } = target();
      you.weapon = "blame";
      run(g, 0.2, { fire: true, aim: { x: 0, y: 1.2, z: -10 } });
      expect(guard.tagged).toBeGreaterThan(0);
    });

    test("reset --hard wipes the yard it lands in", () => {
      const g = field([{ x: 0, z: -30, guards: 3 }, { x: 40, z: -30, guards: 1 }]);
      const yard = g.soldiers.filter((s) => s.compound === 0);
      yard[0]!.x = 20; // out of the blast, still of the yard
      g.shots.push({ id: 99, owner: 0, team: "you", weapon: "reset", x: 0, y: 0.5, z: -30, vx: 0, vy: -10, vz: 0, age: 0, dead: false });
      run(g, 0.2);
      expect(yard.every((s) => !s.alive)).toBe(true);
      expect(g.cleared[0]).toBe(true);
      expect(g.soldiers.find((s) => s.compound === 1)!.alive).toBe(true);
    });
  });

  describe("shotty snipes", () => {
    test("the shotgun ends a soldier up close and does nothing past fifteen metres", () => {
      const close = target();
      Object.assign(close.guard, { z: -4 });
      close.you.weapon = "add";
      run(close.g, 0.5, { fire: true, aim: { x: 0, y: 1, z: -4 } });
      expect(close.guard.alive).toBe(false);
      const far = target();
      Object.assign(far.guard, { z: -22 });
      far.you.weapon = "add";
      run(far.g, 0.5, { fire: true, aim: { x: 0, y: 1, z: -22 } });
      expect(far.guard.hp).toBe(MAX_HP);
      expect(rangeDamage(WEAPONS.add, 0)).toBe(WEAPONS.add.damage);
      expect(rangeDamage(WEAPONS.add, 15)).toBe(0);
      expect(rangeDamage(WEAPONS.commit, 500)).toBe(WEAPONS.commit.damage);
    });

    test("the sniper rifle: two to the body, one to the head, and a guess from the hip", () => {
      const body = target();
      body.guard.shield = body.guard.maxShield = MAX_SHIELD;
      body.you.weapon = "rebase";
      run(body.g, 0.1, { fire: true, scope: true, aim: { x: 0, y: 1, z: -10 } });
      expect(body.guard.alive).toBe(true);
      expect(body.guard.hp + body.guard.shield).toBeCloseTo(MAX_HP + MAX_SHIELD - WEAPONS.rebase.damage, 0);
      run(body.g, 1.5, { fire: true, scope: true, aim: { x: 0, y: 1, z: -10 } });
      expect(body.guard.alive).toBe(false);
      const head = target(), hits: boolean[] = [];
      head.guard.shield = head.guard.maxShield = MAX_SHIELD;
      head.you.weapon = "rebase";
      for (let i = 0; i < 6; i++) for (const e of head.g.step(1 / 60, { ...idle, fire: true, scope: true, aim: { x: 0, y: 1.7, z: -10 } })) if (e.kind === "hit") hits.push(e.head);
      expect(hits).toEqual([true]);
      expect(head.guard.alive).toBe(false);
      expect(WEAPONS.rebase.hipSpread).toBeGreaterThan(0);
      expect(WEAPONS.rebase.speed).toBeGreaterThan(500);
      // Shotgun and sniper rifle in one kit.
      expect(ROLES.reviewer.weapons).toEqual(expect.arrayContaining(["rebase", "add"]));
    });
  });

  describe("the feel of the guns", () => {
    test("git add -A is a shotgun: a fistful of pellets, deadly close, thin far off", () => {
      const near = target();
      near.you.weapon = "add";
      near.g.step(0.05, { ...idle, fire: true, aim: { x: 0, y: 1.2, z: -10 } });
      expect(near.g.shots.length).toBe(WEAPONS.add.pellets);
      run(near.g, 0.3);
      const close = MAX_HP - near.guard.hp;
      const far = target();
      Object.assign(far.guard, { z: -40 });
      far.you.weapon = "add";
      run(far.g, 0.5, { fire: true, aim: { x: 0, y: 1.2, z: -40 } });
      expect(close).toBeGreaterThan(40);
      expect(far.guard.hp).toBe(MAX_HP);
    });

    test("git fetch --all climbs off target the longer you hold it, and cools off", () => {
      const { g, you } = target();
      you.weapon = "fetch";
      g.step(0.05, { ...idle, fire: true, aim: { x: 0, y: 1.2, z: -10 } });
      const first = you.heat;
      run(g, 2, { fire: true, aim: { x: 0, y: 1.2, z: -10 } });
      expect(you.heat).toBeGreaterThan(first * 3);
      expect(you.heat).toBeLessThanOrEqual(MAX_HEAT);
      run(g, 1);
      expect(you.heat).toBe(0);
    });

    test("git clean -fdx sets a guard alight, and a dive-roll puts you out", () => {
      const { g, you, guard } = target();
      Object.assign(guard, { z: -5 });
      you.weapon = "clean";
      run(g, 0.6, { fire: true, aim: { x: 0, y: 1.2, z: -5 } });
      expect(guard.burn).toBeGreaterThan(0);
      const lit = guard.hp;
      run(g, 1);
      expect(guard.hp).toBeLessThan(lit);

      you.burn = 3, you.burnBy = 1;
      g.step(1 / 60, { ...idle, roll: true });
      run(g, 0.1);
      expect(you.burn).toBe(0);
    });

    test("the clean reaches about ten metres and no farther", () => {
      const { g, you, guard } = target();
      Object.assign(guard, { z: -16 });
      you.weapon = "clean";
      run(g, 1, { fire: true, aim: { x: 0, y: 1.2, z: -16 } });
      expect(guard.hp).toBe(MAX_HP);
    });
  });

  describe("files come down", () => {
    test("a blast deletes a file's lines and it sinks; enough and it's gone", () => {
      const file = { ...box(0, -8, 3), lines: 1000 };
      const g = field([], { blocks: [file] }), blk = g.map.blocks[0]!;
      g.shots.push({ id: 99, owner: 0, team: "you", weapon: "push", x: 0, y: 1, z: -6.9, vx: 0, vy: 0, vz: -10, age: 0, dead: false });
      run(g, 0.2);
      expect(blk.h).toBeLessThan(3);
      expect(blk.lines).toBeLessThan(1000);
      expect(file.h).toBe(3); // the map it came from stays whole
      let razed = false;
      for (let i = 0; i < 8 && !razed; i++) {
        g.shots.push({ id: 100 + i, owner: 0, team: "you", weapon: "push", x: 0, y: 0.5, z: -6.9, vx: 0, vy: 0, vz: -10, age: 0, dead: false });
        for (let t = 0; t < 12; t++) razed ||= g.step(1 / 60, idle).some((e) => e.kind === "razed");
      }
      expect(razed).toBe(true);
      expect(g.map.blocks.length).toBe(0);
      expect(g.blockAt(0, 0.5, -8)).toBeNull();
    });

    test("the flamethrower burns a file down; the rifle only chips it", () => {
      const lines = 200, hp = fileHp(lines);
      const rifle = field([], { blocks: [{ ...box(0, -5, 3), lines }] });
      run(rifle, 1, { fire: true, aim: { x: 0, y: 1.2, z: -4 } });
      expect(rifle.map.blocks[0]!.lines).toBeGreaterThan(lines * 0.7);
      const flame = field([], { blocks: [{ ...box(0, -5, 3), lines }] });
      flame.you().weapon = "clean";
      // Aimed low, at its foot, as it sinks.
      run(flame, 1.5, { fire: true, aim: { x: 0, y: 0.1, z: -4 } });
      expect(flame.map.blocks.length).toBe(0);
      expect(hp).toBeGreaterThan(60);
    });

    test("cover you're behind wears away under fire", () => {
      // Waist-high cover: the guard sees your head and its rounds land in the file.
      const g = field([{ x: 0, z: -14, guards: 1 }], { blocks: [{ ...box(0, -3, 1.2), lines: 40 }] });
      const blk = g.map.blocks[0]!;
      run(g, 8);
      expect(blk.h).toBeLessThan(1.2);
    });
  });

  describe("pickups", () => {
    test("a level scatters ammo and health crates, and one reset --hard", () => {
      const g = field([], { blocks: Array.from({ length: 10 }, (_, i) => box(10 + i * 6, 5)) });
      expect(g.pickups.filter((p) => p.kind === "reset").length).toBe(1);
      expect(g.pickups.some((p) => p.kind === "ammo")).toBe(true);
      expect(g.pickups.some((p) => p.kind === "health")).toBe(true);
    });

    test("walking over a crate takes it; health waits until you're hurt", () => {
      const g = field([]), you = g.you();
      g.pickups.push({ id: 90, kind: "health", x: 0, y: 0, z: 0 }, { id: 91, kind: "ammo", x: 0, y: 0, z: 0 });
      run(g, 0.1);
      expect(g.pickups.map((p) => p.kind)).toEqual(["health"]);
      expect(you.ammo.push).toBe(WEAPONS.push.ammo + AMMO_CRATE.push!);
      you.hp = 30;
      run(g, 0.1);
      expect(g.pickups.length).toBe(0);
      expect(you.hp).toBe(30 + HEALTH_CRATE);
    });

    test("a taken yard drops crates instead of a flat resupply", () => {
      const g = field([{ x: 0, z: -30, guards: 1 }, { x: 40, z: -30, guards: 1 }]);
      g.pickups.length = 0;
      g.hurt(g.soldiers[1]!, 999, 0);
      expect(g.you().ammo.push).toBe(WEAPONS.push.ammo);
      expect(g.pickups.map((p) => p.kind).sort()).toEqual(["ammo", "health"]);
    });
  });

  describe("moves", () => {
    test("prone is low, slow, steady and hard to spot", () => {
      const g = field([]), you = g.you();
      run(g, 1, { prone: true, forward: 1 });
      expect(you.prone).toBe(true);
      expect(-you.z).toBeLessThan(PRONE_SPEED * 1.05);
      expect(g.muzzle(you).y).toBeLessThan(0.5);
      run(g, 0.2, { prone: true, jump: true });
      expect(you.grounded).toBe(true);

      // A guard 30 m off spots you standing, not lying down.
      for (const prone of [true, false]) {
        const s = field([{ x: 0, z: -30, guards: 1 }]);
        Object.assign(s.soldiers[1]!, { x: 0, z: -30 });
        run(s, 1, { prone });
        expect(s.soldiers[1]!.brain!.alert).toBe(!prone);
      }
    });

    test("a roll goes sideways out from behind cover, and lying down it's a log roll", () => {
      const g = field([], { blocks: [box(0, -2)] }), you = g.you();
      run(g, 0.1, { crouch: true });
      run(g, 0.5, { crouch: true, right: 1, roll: true });
      expect(you.x).toBeGreaterThan(2.5);
      expect(Math.abs(you.z)).toBeLessThan(0.5);

      const p = field([]);
      run(p, 0.1, { prone: true });
      run(p, 0.5, { prone: true, roll: true });
      expect(p.you().x).toBeGreaterThan(1);
      expect(p.you().prone).toBe(true);
    });

    test("a dive-roll is a short dodge: slower than running and a wait before the next", () => {
      expect(ROLL_SPEED * ROLL_TIME).toBeLessThan(RUN * (ROLL_TIME + ROLL_COOLDOWN) * 0.5);
      const g = field([]), you = g.you();
      run(g, 2, { roll: true, forward: 1 });
      const rolled = -you.z;
      const r = field([]);
      run(r, 2, { forward: 1 });
      expect(rolled).toBeLessThan(-r.you().z);
    });

    test("leaning takes the gun and the upper body out round the corner, and the hitbox with it", () => {
      const g = field([]), you = g.you();
      run(g, 1, { lean: 1 });
      expect(you.lean).toBeCloseTo(1, 1);
      // Facing -z, right is +x: the muzzle and the head are off to the right, the feet where they were.
      expect(g.muzzle(you).x).toBeGreaterThan(LEAN_REACH * 0.5);
      const shot = (x: number, y: number) => ({ id: 99, owner: 5, team: "conflict" as const, weapon: "commit" as const, x, y, z: you.z + 0.3, vx: 0, vy: 0, vz: -100, age: 0, dead: false });
      g.shots.push(shot(LEAN_REACH, 1.6));
      g.step(1 / 60, { ...idle, lean: 1 });
      expect(you.shield).toBeLessThan(MAX_SHIELD);
      const before = you.shield;
      // Head height, straight over the feet: nothing there now.
      g.shots.push(shot(-0.2, 1.6));
      g.step(1 / 60, { ...idle, lean: 1 });
      expect(you.shield).toBe(before);
      // Off your feet the lean comes back in.
      run(g, 1, { lean: 1, jump: true });
      run(g, 0.2, { lean: 1, jump: true });
      expect(Math.abs(you.lean)).toBeLessThan(0.5);
    });

    test("jump at a wall and you mantle up onto it", () => {
      const g = field([], { blocks: [box(0, -2, 2.8)] }), you = g.you();
      run(g, 0.3, { forward: 1 });
      expect(you.y).toBeLessThan(0.1);
      run(g, 1 / 60, { forward: 1, jump: true });
      run(g, 0.4, { forward: 1 });
      expect(you.y).toBeCloseTo(2.8, 1);
      expect(you.grounded).toBe(true);
    });

    test("fall from high up and a parachute opens; it sinks slowly, steers, and folds on landing", () => {
      const cliff: Terrain = { R: 80, height: (_x, z) => (z < -3 ? 0 : 30) };
      const g = new Game({ terrain: cliff, spawn: { x: 0, z: 0, yaw: 0 }, compounds: [], blocks: [] }), you = g.you();
      const events: string[] = [];
      const go = (seconds: number, inp: Partial<Input>) => { for (let i = 0; i < seconds * 60; i++) for (const e of g.step(1 / 60, { ...idle, ...inp })) if (e.kind === "chute") events.push(e.open ? "open" : "cut"); };
      go(1.5, { forward: 1 });
      expect(you.chute).toBe(true);
      expect(events).toEqual(["open"]);
      go(1, {});
      expect(you.vy).toBeCloseTo(-CHUTE_FALL, 0);
      const x0 = you.x;
      go(1, { right: 1 });
      expect(you.x).toBeGreaterThan(x0 + 2);
      go(12, {});
      expect(you.chute).toBe(false);
      expect(you.grounded).toBe(true);
      expect(you.y).toBeCloseTo(0, 1);
      expect(you.hp).toBe(MAX_HP);
      expect(events).toEqual(["open", "cut"]);
      // By hand: Space in the air opens it over a shorter drop, and again cuts it.
      Object.assign(you, { x: 0, z: -10, y: 30, vy: 0, grounded: false });
      go(0.25, {});
      expect(you.chute).toBe(false);
      go(1 / 60, { jump: true });
      expect(you.chute).toBe(true);
      go(1 / 60, { jump: true });
      expect(you.chute).toBe(false);
    });

    test("the sniper scope sways, less crouched, least prone", () => {
      const amp = (st: "stand" | "crouch" | "prone") => Math.max(...Array.from({ length: 200 }, (_, i) => Math.abs(scopeSway(i * 0.05, st).yaw)));
      expect(amp("stand")).toBeGreaterThan(amp("crouch"));
      expect(amp("crouch")).toBeGreaterThan(amp("prone"));
      expect(amp("prone")).toBeGreaterThan(0);
      // Scoped without a crosshair point, the round goes where the sway points.
      const g = field([]);
      g.you().weapon = "rebase";
      g.time = 1;
      g.step(1 / 60, { ...idle, scope: true, fire: true });
      expect(g.shots[0]!.vx).not.toBe(0);
    });
  });

  describe("guards", () => {
    test("a big compound has a heavy", () => {
      const g = field([{ x: 0, z: -30, guards: 4 }, { x: 40, z: -30, guards: 2 }]);
      const big = g.soldiers.filter((s) => s.compound === 0), small = g.soldiers.filter((s) => s.compound === 1);
      expect(big.filter((s) => s.heavy).length).toBe(1);
      expect(big.find((s) => s.heavy)!.hp).toBe(HEAVY_HP);
      expect(big.find((s) => s.heavy)!.shield).toBe(HEAVY_SHIELD);
      expect(big.find((s) => !s.heavy && s.team === "conflict")!.shield).toBe(0);
      expect(small.some((s) => s.heavy)).toBe(false);
    });

    /** Guards at (x, z) each, all already on you, with you unkillable, run for a few seconds. */
    const squadOn = (n: number, seconds = 4) => {
      const g = field([{ x: 0, z: -30, guards: n }]), you = g.you();
      you.hp = you.maxHp = 1e9, you.shield = 0, you.maxShield = 0;
      run(g, seconds);
      return { g, you, guards: g.soldiers.filter((s) => s.brain && s.alive) };
    };
    const jobs = (guards: ReturnType<typeof squadOn>["guards"]) => guards.map((s) => s.brain!.role).sort().join(" ");

    test("the squad's size picks its tactic: one is careful, two split, a squad flanks both sides, a platoon adds a rush, a horde all comes", () => {
      expect(tacticFor(1)).toBe("lone");
      expect(tacticFor(2)).toBe("pair");
      expect(tacticFor(4)).toBe("squad");
      expect(tacticFor(7)).toBe("platoon");
      expect(tacticFor(12)).toBe("horde");
      const one = squadOn(1);
      expect(one.guards[0]!.brain!.tactic).toBe("lone");
      // Alone it keeps its distance: never closer than the lone band's near edge.
      expect(Math.hypot(one.guards[0]!.x - one.you.x, one.guards[0]!.z - one.you.z)).toBeGreaterThan(BANDS.lone[0] - 2);
      const two = squadOn(2);
      expect(jobs(two.guards)).toBe("flank pin");
      const four = squadOn(4);
      expect(four.guards.every((s) => s.brain!.tactic === "squad")).toBe(true);
      expect(four.guards.filter((s) => s.brain!.role === "flank").length).toBe(2);
      expect(new Set(four.guards.filter((s) => s.brain!.role === "flank").map((s) => s.brain!.side)).size).toBe(2);
      const seven = squadOn(7);
      expect(seven.guards.filter((s) => s.brain!.role === "rush").length).toBe(3);
      const twelve = squadOn(12, 6);
      expect(twelve.guards.filter((s) => s.brain!.role === "rush").length).toBe(11);
      // A horde closes right in on you (and the rounds shove you about, so it's measured from where you are).
      expect(twelve.guards.filter((s) => Math.hypot(s.x - twelve.you.x, s.z - twelve.you.z) < 10).length).toBeGreaterThanOrEqual(6);
    });

    test("flankers swing round your side, and the squad pushes in once one has the angle", () => {
      const { g, you, guards } = squadOn(2, 6);
      const flanker = guards.find((s) => s.brain!.role === "flank")!;
      const angle = Math.abs(Math.atan2(flanker.x - you.x, -(flanker.z - you.z)));
      expect(angle).toBeGreaterThan(Math.PI / 4);
      expect(g.hasAngle(flanker)).toBe(true);
      const four = squadOn(4, 8);
      expect(four.guards.some((s) => s.brain!.advance)).toBe(true);
    });

    test("the tactic changes as the squad shrinks: a pair's flanker left alone turns careful", () => {
      const { g, guards } = squadOn(2, 3);
      const pinner = guards.find((s) => s.brain!.role === "pin")!, flanker = guards.find((s) => s.brain!.role === "flank")!;
      g.hurt(pinner, 1e9, 0);
      run(g, 1);
      expect(flanker.brain!.tactic).toBe("lone");
      expect(flanker.brain!.role).toBe("pin");
    });

    test("a pinner keeps firing at where you ducked out of sight; a lone guard waits", () => {
      const pair = squadOn(2, 3), one = squadOn(1, 3);
      for (const { g, you } of [pair, one]) Object.assign(you, { x: 200, z: 200 }), (g.map.smoke = []);
      const shotsIn = (g: Game, who: Soldier) => { let n = 0; for (let i = 0; i < 150; i++) for (const e of g.step(1 / 60, idle)) if (e.kind === "fire" && e.id === who.id) n++; return n; };
      // Out of sight (moved far away), the pinner's last-seen spot stays under fire for a beat.
      expect(shotsIn(pair.g, pair.guards.find((s) => s.brain!.role === "pin")!)).toBeGreaterThan(0);
      expect(shotsIn(one.g, one.guards[0]!)).toBe(0);
    });

    test("smoke hides you: a guard sees nothing through more than a few metres of it", () => {
      const g = field([{ x: 0, z: -30, guards: 1 }]), guard = g.soldiers[1]!;
      g.map.smoke = [{ x: 0, z: -15, r: 5 }];
      run(g, 2);
      expect(guard.brain!.seen).toBeNull();
      expect(g.smoked(0, 0, 0, -30)).toBe(true);
      expect(g.smoked(20, 0, 20, -30)).toBe(false);
      g.map.smoke = [];
      run(g, 1);
      expect(guard.brain!.seen).not.toBeNull();
    });

    test("an ambush lies flat and unseen till you're nearly on it, then the yard is up", () => {
      const g = field([{ x: 0, z: -40, guards: 2 }]), you = g.you(), hide = g.soldiers[2]!, other = g.soldiers[1]!;
      Object.assign(hide, { x: 3, z: -12, prone: true });
      Object.assign(hide.brain!, { ambush: true, home: { x: 3, z: -12 } });
      run(g, 1);
      expect(hide.brain!.alert).toBe(false);
      expect(hide.prone).toBe(true);
      // A gun going off well away from it doesn't rouse it (its yard hears, and comes hunting); walking up to it does, and its yard is up with it.
      Object.assign(you, { x: 0, z: 30 });
      run(g, 0.3, { fire: true, aim: { x: 0, y: 1, z: -80 } });
      expect(hide.brain!.ambush).toBe(true);
      expect(hide.brain!.alert).toBe(false);
      Object.assign(you, { x: 3, z: -6 });
      run(g, 1);
      expect(hide.brain!.ambush).toBe(false);
      expect(hide.prone).toBe(false);
      expect(other.brain!.alert).toBe(true);
    });

    test("the camera stops short of a wall between it and you", () => {
      const g = field([], { blocks: [box(0, -3, 3)] });
      // From your head straight back through a block 3 m behind: it stops in front of it.
      expect(g.cameraReach({ x: 0, y: 1.7, z: 0 }, { x: 0, y: 1.7, z: -6 })).toBeLessThan(0.4);
      expect(g.cameraReach({ x: 0, y: 1.7, z: 0 }, { x: 0, y: 1.7, z: -6 })).toBeGreaterThan(0.1);
      expect(g.cameraReach({ x: 0, y: 1.7, z: 0 }, { x: 0, y: 1.7, z: 6 })).toBe(1);
      expect(g.cameraReach({ x: 0, y: 1.7, z: 0 }, { x: 0, y: -2, z: 4 })).toBeLessThan(1);
    });

    test("guards out of sight come hunting when they hear you shoot, then drift home", () => {
      const g = field([{ x: 0, z: -75, guards: 2 }]), you = g.you(), guards = g.soldiers.filter((s) => s.brain);
      expect(75).toBeGreaterThan(SIGHT);
      expect(75).toBeLessThan(HEAR);
      run(g, 1);
      expect(guards.every((s) => !s.brain!.alert)).toBe(true);
      run(g, 0.2, { fire: true, aim: { x: 0, y: 1, z: -75 } });
      expect(guards.every((s) => s.brain!.alert && s.brain!.hunt > 0)).toBe(true);
      const start = guards.map((s) => s.z);
      run(g, 4);
      // Past the yard's own leash and closing on where the shots came from.
      guards.forEach((s, i) => expect(s.z).toBeGreaterThan(start[i]! + 10));
      // Far beyond earshot, nobody stirs.
      const q = field([{ x: 0, z: -140, guards: 1 }]);
      run(q, 0.3, { fire: true, aim: { x: 0, y: 1, z: -140 } });
      expect(q.soldiers[1]!.brain!.alert).toBe(false);
      void you;
    });

    test("a guard takes cover on the far side of a block when hit", () => {
      const g = field([{ x: 0, z: -14, guards: 1 }], { blocks: [box(0, -10)] }), guard = g.soldiers[1]!;
      Object.assign(guard, { x: 3, z: -14 });
      const c = g.coverFrom(guard, { x: 0, z: 0 })!;
      expect(c.z).toBeLessThan(-11);
      expect(Math.abs(c.x)).toBeLessThan(0.5);
      Object.assign(guard.brain!, { alert: true, seen: { x: 0, y: 1, z: 0 }, lastHp: MAX_HP });
      g.hurt(guard, 10, 0);
      run(g, 0.3);
      expect(guard.brain!.cover).not.toBeNull();
    });
  });

  describe("objectives", () => {
    test("the waypoint is the nearest compound still held, then the mission's own point", () => {
      const g = field([{ x: 0, z: -40, guards: 1 }, { x: 60, z: 0, guards: 1 }]);
      expect(g.waypoint()!.label).toBe("apps/c0");
      for (const s of g.soldiers.slice(1)) if (s.compound === 0) g.hurt(s, 1e9, 0);
      expect(g.waypoint()!.label).toBe("apps/c1");
      const carry = field([{ x: 0, z: -40, guards: 1 }], { mission: { kind: "carry" } });
      expect(carry.waypoint()!.kind).toBe("commit");
      const o = carry.objective as Extract<Objective, { kind: "carry" }>;
      Object.assign(o, { carried: true, by: 0 });
      expect(carry.waypoint()!.kind).toBe("head");
      expect(field([{ x: 0, z: -40, guards: 1 }], { mission: { kind: "defend", seconds: 60, wave: 20 } }).waypoint()!.kind).toBe("branch");
    });

    test("each level has its own mission", () => {
      expect(missionFor("el-capitan").kind).toBe("carry");
      expect(missionFor("backyard").kind).toBe("defend");
      expect(missionFor("nowhere").kind).toBe("clear");
      for (const l of LEVELS) expect(briefing(missionFor(l.id))).not.toBe("");
    });

    test("carry the commit from the farthest yard to HEAD; going down drops it", () => {
      const g = field([{ x: 0, z: -20, guards: 0 }, { x: 0, z: -40, guards: 0 }], { mission: { kind: "carry" } }), you = g.you();
      const o = g.objective as Extract<Objective, { kind: "carry" }>;
      expect(o.z).toBe(-40);
      Object.assign(you, { z: -40 });
      run(g, 0.1);
      expect(o.carried).toBe(true);
      Object.assign(you, { z: -30 });
      g.hurt(you, 999, 1);
      expect(o.carried).toBe(false);
      expect(o.z).toBeCloseTo(-30);
      Object.assign(you, { z: -30 });
      run(g, 0.1);
      Object.assign(you, { z: 1 });
      run(g, 0.1);
      expect(o.delivered).toBe(true);
      expect(g.status).toBe("won");
    });

    test("defend: raids come in waves; hold the branch long enough and it's yours", () => {
      const g = field([{ x: 0, z: -60, guards: 1 }, { x: 40, z: 0, guards: 1 }], { mission: { kind: "defend", seconds: 10, wave: 20 } });
      g.you().hp = g.you().maxHp = 1e9;
      run(g, 6);
      expect(g.soldiers[2]!.brain!.raid).toBe(true);
      for (const s of g.soldiers.slice(1)) s.brain = null;
      run(g, 5);
      expect(g.status).toBe("won");
    });

    test("defend: guards standing on the branch overwrite it", () => {
      const g = field([{ x: 0, z: -60, guards: 1 }], { mission: { kind: "defend", seconds: 100, wave: 20 } });
      const guard = g.soldiers[1]!;
      Object.assign(guard, { x: 3, z: 0, brain: null });
      g.you().hp = g.you().maxHp = 1e9;
      run(g, OVERRUN + 0.5);
      expect(g.status).toBe("lost");
    });
  });

  test("every weapon has a sound", () => {
    for (const w of ORDER) expect(VOICES[w]).toBeDefined();
  });
});
