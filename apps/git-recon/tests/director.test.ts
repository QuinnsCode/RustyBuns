import { expect, setDefaultTimeout, test } from "bun:test";

setDefaultTimeout(60_000);
import { LEVELS } from "../src/levels/levels.ts";
import { CAMPAIGN } from "../src/sim/campaign.ts";
import { APPROACH, CRAWL_MAX, Director, DROP, DROP_HIGH, GAG, HOME, SQUAD, SWEEP } from "../src/sim/director.ts";
import { Game, type GameEvent, type Input, type Soldier } from "../src/sim/game.ts";
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

/** A level's game and director, and a frame that runs both as the page does (you healed, so the guards don't end it). */
function level(id: string, chapter = CAMPAIGN.findIndex((c) => c.level === id), beats?: (typeof CAMPAIGN)[number]["beats"]) {
  const def = LEVELS.find((l) => l.id === id)!;
  const game = Game.fromRepo(def.ground(), def.repo, def.seed, missionFor(id));
  const d = new Director(game, { ...CAMPAIGN[chapter]!, beats: beats ?? CAMPAIGN[chapter]!.beats!.filter((b) => b !== "sweep") }), you = game.you();
  const frame = (input: Partial<Input> = {}, events: GameEvent[] = []) => {
    you.hp = you.maxHp, you.shield = you.maxShield;
    const before = game.events;
    const got = game.step(dt * d.scale, d.steer({ ...idle, yaw: you.yaw, ...input }));
    d.step(dt, [...before, ...got, ...events]);
  };
  const until = (done: () => boolean, input: () => Partial<Input> = () => ({}), seconds = 20) => {
    for (let t = 0; t < seconds && !done(); t += dt) frame(input());
    expect(done()).toBe(true);
  };
  /** A rocket roadster beside you, and you at its wheel. */
  const board = () => {
    const car = { id: 900, kind: "roadster" as const, x: you.x, y: game.terrain.height(you.x, you.z), z: you.z, vx: 0, vy: 0, vz: 0, yaw: you.yaw, hp: 260, maxHp: 260, driver: -1, alive: true, cd: 0, rocketCd: 0, odo: 0, fuel: 1, burn: false };
    game.vehicles.push(car);
    frame({ use: true });
    expect(you.vehicle).toBe(car.id);
    return car;
  };
  return { game, d, you, frame, until, board };
}

test("hold the yard: the roadster leaves the ground at speed, Shift bails you out in a roll, and the empty car carries on", () => {
  const { d, you, frame, until, board } = level("backyard");
  const car = board();
  until(() => d.beat?.phase === "air", () => ({ forward: 1 }));
  expect(d.scale).toBeLessThan(1);
  expect(d.stage.prompt).toContain("Shift");
  frame({ roll: true });
  expect(d.beat?.phase).toBe("carry");
  expect(you.vehicle).toBe(-1);
  expect(car.driver).toBe(-1);
  const at = { x: car.x, z: car.z };
  until(() => !d.beat);
  expect(Math.hypot(car.x - at.x, car.z - at.z)).toBeGreaterThan(5);
  expect(d.scale).toBe(1);
});

test("the shoulders: thrusters run dry in the air, the car slides back in slow motion, and you step off", () => {
  const { game, d, you, frame, until, board } = level("half-dome");
  const car = board();
  car.y += 8, car.fuel = 0;
  frame();
  expect(d.beat?.phase).toBe("stall");
  expect(d.scale).toBeLessThan(1);
  until(() => d.beat?.phase === "slide");
  until(() => Math.hypot(car.vx, car.vz) > 2);
  expect(d.stage.prompt).toContain("step off");
  frame({ use: true });
  expect(you.vehicle).toBe(-1);
  until(() => !d.beat);
  expect(d.scale).toBe(1);
  expect(game.vehicles).toContain(car);
});

test("the valley floor: the helicopter takes you up high and the shot looks out at the wall as you fall", () => {
  const { game, d, you, frame, until } = level("el-capitan");
  frame();
  for (let t = 0; t < APPROACH + 0.2; t += dt) frame();
  const high = you.y - game.terrain.height(you.x, you.z);
  expect(high).toBeGreaterThan(DROP + 20);
  expect(high).toBeCloseTo(DROP_HIGH, 0);
  frame({ jump: true });
  expect(d.beat?.phase).toBe("fall");
  frame();
  expect(d.stage.shot!.from.y).toBeGreaterThan(you.y);
  until(() => !d.beat, () => ({}), 90);
  expect(you.grounded).toBe(true);
});

test("lost commit: a hovercraft beaches on the lawn and slowly goes flat", () => {
  const { d, game, frame, until } = level("garden");
  until(() => d.beat?.phase === "glide", () => ({}), 25);
  expect(game.time).toBeGreaterThan(17);
  const at = (t: number) => (until(() => d.stage.craft !== null && d.stage.craft.deflate >= t, () => ({}), 30), d.stage.craft!);
  const skid = at(0);
  expect(skid.deflate).toBe(0);
  until(() => !d.beat);
  expect(at(0.5).deflate).toBeGreaterThanOrEqual(0.5);
  frame();
  expect(d.beat).toBeNull();
});

test("the heights: two squads at once, and the last guard falls in slow motion before a rope ladder lifts you out", () => {
  const { game, d, you, frame, until } = level("glacier-point");
  // Held back for the first merge: the strike, then both walls.
  const first = game.map.compounds.map((c, i) => ({ i, d: Math.hypot(c.x - you.x, c.z - you.z) })).sort((a, b) => a.d - b.d)[0]!.i;
  for (const g of game.soldiers) if (g.alive && g.compound === first) game.hurt(g, g.hp + g.shield + 1, game.me);
  frame();
  expect(d.beat?.id).toBe("onslaught");
  until(() => d.beat?.phase === "contact", () => ({}), 30);
  expect(game.soldiers.filter((s) => s.alive && s.name.endsWith("reinforcement")).map((s) => s.compound).filter((c, i, all) => all.indexOf(c) === i)).toHaveLength(2);
});

test("the heights: the last guard falls in slow motion, then the helicopter's rope ladder takes you out before the result", () => {
  const { game, d, you, frame, until } = level("glacier-point", 5, ["extraction"]);
  const last = game.map.compounds.length - 1;
  let keep: Soldier | undefined;
  for (const g of game.soldiers) if (g.alive && g.brain) {
    if (g.compound === last && !keep) keep = g;
    else game.hurt(g, g.hp + g.shield + 1, game.me);
  }
  Object.assign(keep!, { x: you.x + 8, z: you.z, y: game.terrain.height(you.x + 8, you.z) });
  frame();
  expect(game.status).toBe("playing");
  expect(d.beat).toMatchObject({ id: "extraction", phase: "last" });
  frame();
  expect(d.scale).toBeLessThan(1);
  game.hurt(keep!, keep!.hp + keep!.shield + 1, game.me);
  frame();
  expect(game.status).toBe("won");
  expect(d.holding).toBe(true);
  until(() => d.beat?.phase === "lift");
  until(() => d.stage.ladder !== null && you.y > game.terrain.height(you.x, you.z) + 4);
  expect(d.holding).toBe(true);
  until(() => !d.holding);
  expect(d.stage.ladder).toBeNull();
});

test.each([
  ["a first headshot", { kind: "hit", target: -1, by: 0, damage: 50, shield: false, head: true } as const, "head"],
  ["a reset crate", { kind: "pickup", id: 0, item: "reset" } as const, "reset"],
  ["your last life", { kind: "respawn", id: 0, lives: 0 } as const, "Last life"],
] as const)("a cutaway gag on %s runs three seconds, once", (_, event, text) => {
  const { game, d, frame, until } = level("backyard");
  const guard = game.soldiers.find((s) => s.brain)!;
  game.hurt(guard, guard.hp + guard.shield + 1, game.me);
  frame({}, [event.kind === "hit" ? { ...event, target: guard.id } : event]);
  expect(d.beat?.id).toBe("gag");
  expect(d.stage.caption).toContain(text);
  until(() => !d.beat, () => ({}), GAG + 1);
  frame({}, [event.kind === "hit" ? { ...event, target: guard.id } : event]);
  expect(d.beat).toBeNull();
});

test("a chapter that starts on foot opens on a slow sweeping shot with a narrator's line, and hands the view back", () => {
  const def = LEVELS.find((l) => l.id === "backyard")!;
  const game = Game.fromRepo(def.ground(), def.repo, def.seed, missionFor("backyard"));
  const d = new Director(game, CAMPAIGN.find((c) => c.level === "backyard")), you = game.you();
  const frame = (input: Partial<Input> = {}) => d.step(dt, game.step(dt * d.scale, d.steer({ ...idle, ...input })));
  const x = you.x, z = you.z;

  frame({ forward: 1 });
  expect(d.beat?.id).toBe("sweep");
  expect(d.stage.shot?.mix).toBe(1);
  expect(d.scale).toBeLessThan(0.5);
  expect([you.x, you.z]).toEqual([x, z]); // your input is held under it
  for (let t = 0; t < 2; t += dt) frame();
  expect(d.stage.caption).not.toBeNull();

  // Skippable: jump hands it back at once, at full speed.
  frame({ jump: true });
  expect(d.beat).toBeNull();
  expect(d.scale).toBe(1);
  expect(d.stage.shot).toBeNull();

  // Left alone, it runs its length and hands the view back by itself.
  const again = new Director(Game.fromRepo(def.ground(), def.repo, def.seed, missionFor("backyard")), CAMPAIGN.find((c) => c.level === "backyard"));
  for (let t = 0; t < SWEEP + 0.5 && again.beat; t += dt) again.step(dt, []);
  expect(again.beat).toBeNull();
});
