import { expect, setDefaultTimeout, test } from "bun:test";

setDefaultTimeout(60_000);
import { LEVELS } from "../src/levels/levels.ts";
import { CAMPAIGN } from "../src/sim/campaign.ts";
import { APPROACH, CRAWL_MAX, Director, DROP, HOME, SQUAD } from "../src/sim/director.ts";
import { Game, type Input } from "../src/sim/game.ts";
import { missionFor } from "../src/sim/missions.ts";

const idle: Input = { right: 0, forward: 0, yaw: 0, pitch: 0, jump: false, roll: false, crouch: false, fire: false };
const dt = 1 / 30;

test("boot camp: dropped in by helicopter, then a strike after the first merge, a crawl to the gun, a squad in slow motion, and rally or fall back", () => {
  const def = LEVELS.find((l) => l.id === "kitchen")!;
  const game = Game.fromRepo(def.ground(), def.repo, def.seed, missionFor("kitchen"));
  const d = new Director(game, CAMPAIGN[0]), you = game.you();
  // The page's frame: the director holds what it holds, the game runs at its pace. The guards
  // elsewhere don't get to finish you off while the test walks you round (unless asked to hold off).
  const frame = (input: Partial<Input> = {}, heal = true) => {
    if (heal) you.hp = you.maxHp, you.shield = you.maxShield;
    d.step(dt, game.step(dt * d.scale, d.steer({ ...idle, ...input })));
  };
  const until = (done: () => boolean, input: () => Partial<Input> = () => ({}), seconds = 20, heal = true) => {
    for (let t = 0; t < seconds && !done(); t += dt) frame(input(), heal);
    expect(done()).toBe(true);
  };

  // Riding in on the skid, the camera off to the side; over HEAD, Space jumps, and the drop is in slow motion.
  frame();
  expect(d.beat?.phase).toBe("ride");
  expect(d.stage.heli).not.toBeNull();
  expect(d.stage.shot?.mix).toBe(1);
  for (let t = 0; t < APPROACH + 0.2; t += dt) frame();
  expect(you.y - game.terrain.height(you.x, you.z)).toBeCloseTo(DROP, 0);
  frame({ jump: true });
  expect(d.beat?.phase).toBe("fall");
  expect(d.scale).toBeLessThan(1);
  until(() => !d.beat);
  expect(you.grounded).toBe(true);
  expect(d.scale).toBe(1);
  expect(d.stage.shot).toBeNull();

  // The first merge: the nearest compound's guards go down, and it's quiet for a moment.
  const near = game.map.compounds.map((c, i) => ({ i, d: Math.hypot(c.x - you.x, c.z - you.z) })).sort((a, b) => a.d - b.d)[0]!.i;
  for (const g of game.soldiers) if (g.alive && g.compound === near) game.hurt(g, g.hp + g.shield + 1, game.me);
  d.step(dt, game.events);
  expect(d.beat?.phase).toBe("calm");

  // The strike throws you and leaves you standing however low you were.
  you.hp = 40, you.shield = 0;
  until(() => d.beat?.phase !== "calm", () => ({}), 5, false);
  expect(d.beat?.phase).toBe("thrown");
  expect(you.alive).toBe(true);
  expect(Math.hypot(you.vx, you.vz)).toBeGreaterThan(3);

  // Down and dazed: the gun lies out of reach, you can only crawl, and you can't shoot.
  until(() => d.beat?.phase === "crawl");
  const gun = d.stage.gun!;
  expect(Math.hypot(gun.x - you.x, gun.z - you.z)).toBeGreaterThan(2);
  expect(d.steer({ ...idle, fire: true })).toMatchObject({ prone: true, fire: false });
  until(() => d.beat?.phase === "contact", () => ({ forward: 1, yaw: Math.atan2(you.x - gun.x, you.z - gun.z) }), CRAWL_MAX - 1);

  // Got it: a squad comes in from the nearest compound still held, in slow motion.
  const squad = game.soldiers.filter((s) => s.alive && s.name.endsWith("reinforcement"));
  expect(squad).toHaveLength(SQUAD);
  expect(d.scale).toBeLessThan(1);
  // Away from HEAD (and the next compound's gate) when they're down, so falling back is a choice.
  const { spawn } = game.map;
  for (let a = 0; a < 6.3; a += 0.3) {
    const x = spawn.x + Math.cos(a) * 20, z = spawn.z + Math.sin(a) * 20, w = game.waypoint()!;
    if (Math.hypot(x, z) < game.terrain.R - 5 && Math.hypot(w.x - x, w.z - z) > HOME + 2) {
      Object.assign(you, { x, z, y: game.terrain.height(x, z) });
      break;
    }
  }
  for (const s of squad) game.hurt(s, s.hp + s.shield + 1, game.me);
  until(() => d.beat?.phase === "choice");

  // Rally on the next compound or fall back to HEAD, where a health crate is waiting.
  expect(d.markers.map((m) => m.kind)).toEqual(["compound", "head"]);
  expect(game.pickups.some((p) => p.kind === "health" && Math.hypot(p.x - spawn.x, p.z - spawn.z) < 1)).toBe(true);
  Object.assign(you, { x: spawn.x, z: spawn.z, y: game.terrain.height(spawn.x, spawn.z) });
  frame();
  expect(d.beat).toBeNull();
  expect(d.markers).toEqual([]);
  expect(d.scale).toBe(1);
});

test("a battle runs no set pieces", () => {
  const def = LEVELS.find((l) => l.id === "kitchen")!;
  const d = new Director(Game.fromRepo(def.ground(), def.repo, def.seed, undefined, "coop"), CAMPAIGN[0]);
  expect(d.beat).toBeNull();
  expect(d.stage.heli).toBeNull();
});
