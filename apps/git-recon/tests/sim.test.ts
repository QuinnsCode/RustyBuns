import { describe, expect, test } from "bun:test";
import { LEVELS, PLAY_RADIUS, placeLevel } from "../src/levels/levels.ts";
import { groundAt, parsePlace, placeName, worldPx, type TileSource } from "../src/levels/place.ts";
import { folderOf, heightOf, mapRepo, type Block, type RepoSnapshot } from "../src/sim/codemap.ts";
import { AMMO_CRATE, Game, HEALTH_CRATE, HEAVY_HP, MAX_HP, PRONE_SPEED, ROLL_TIME, scopeSway, STASH_HP, type Input, type Objective } from "../src/sim/game.ts";
import { briefing, missionFor, OVERRUN, type Mission } from "../src/sim/missions.ts";
import { contourStep, slope, stampTerrain, wet, withPads, type Terrain } from "../src/sim/terrain.ts";
import { ORDER, splashDamage, WEAPONS } from "../src/sim/weapons.ts";
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
    g.map.blocks.length = 0;
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
    test("a big compound has a heavy; its squads have flankers", () => {
      const g = field([{ x: 0, z: -30, guards: 4 }, { x: 40, z: -30, guards: 2 }]);
      const big = g.soldiers.filter((s) => s.compound === 0), small = g.soldiers.filter((s) => s.compound === 1);
      expect(big.filter((s) => s.heavy).length).toBe(1);
      expect(big.find((s) => s.heavy)!.hp).toBe(HEAVY_HP);
      expect(small.some((s) => s.heavy)).toBe(false);
      expect(big.filter((s) => s.brain!.role === "flank").length).toBe(2);
    });

    test("flankers swing round your side", () => {
      const g = field([{ x: 0, z: -30, guards: 2 }]), you = g.you();
      you.hp = you.maxHp = 1e9;
      run(g, 5);
      const flanker = g.soldiers.find((s) => s.brain?.role === "flank")!;
      const angle = Math.abs(Math.atan2(flanker.x - you.x, -(flanker.z - you.z)));
      expect(angle).toBeGreaterThan(Math.PI / 4);
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
