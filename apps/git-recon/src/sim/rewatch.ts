// Set pieces to watch again: each of the campaign's in-level beats (director.ts), restaged on a fresh copy of the
// level it plays on, with you on scripted input. The beat itself is the live one, run by its own Director, so the
// replay is the scene as it plays, not a recording of it. What a take does to the level (a yard's guards down, a
// roadster at your side, the clock moved on) is only what the beat needs to start; you can't be hurt in one.
//
// The page remembers a beat once you've seen it to its end in a level (Director.finished, @rustybuns/util/memories)
// and lists it in the menu's "Watch again" row; `?scene=jump` plays one by name. No DOM and no three.js here.
import { CAMPAIGN } from "./campaign.ts";
import type { RepoSnapshot } from "./codemap.ts";
import { BARRAGE_AFTER, BEACH_AT, type BeatId, Director } from "./director.ts";
import { Game, type GameEvent, type Input, type Soldier } from "./game.ts";
import type { RoleId } from "./roles.ts";
import { missionFor } from "./missions.ts";
import type { LevelDef } from "../levels/levels.ts";

/** The set pieces worth a second look (not the opening sweep or the three-second gags), the level each is staged on, and its name in the menu. */
export const SET_PIECES = {
  insertion: { level: "kitchen", title: "Insertion" },
  incoming: { level: "kitchen", title: "Incoming" },
  landing: { level: "backyard", title: "Landing craft" },
  jump: { level: "backyard", title: "Roadster jump" },
  beach: { level: "garden", title: "Hovercraft" },
  dropzone: { level: "el-capitan", title: "Dropzone" },
  barrage: { level: "el-capitan", title: "Barrage" },
  stall: { level: "half-dome", title: "Stall" },
  onslaught: { level: "glacier-point", title: "Onslaught" },
  extraction: { level: "glacier-point", title: "Extraction" },
} as const satisfies Partial<Record<BeatId, { level: string; title: string }>>;
export type SetPieceId = keyof typeof SET_PIECES;

export const isSetPiece = (id: string | null): id is SetPieceId => !!id && Object.hasOwn(SET_PIECES, id);

/** A take: the level's game, the director playing just this beat, and whether it has played out. */
export interface Take {
  id: SetPieceId;
  game: Game;
  director: Director;
  /** Real seconds since the take started. */
  t: number;
  /** The beat has started. */
  started: boolean;
  /** The beat started, and has now ended (or, for a strike, got as far as your choice). */
  done: boolean;
  /** This frame's staging and input; called once a frame by `rollTake`. */
  cue: (dt: number) => Input;
}

const idle: Input = { right: 0, forward: 0, yaw: 0, pitch: -0.05, jump: false, roll: false, crouch: false, fire: false };
/** The yaw that faces along (dx, dz): forward is -z at yaw 0. */
const facing = (dx: number, dz: number) => Math.atan2(-dx, -dz);
const down = (game: Game, s: Soldier) => game.hurt(s, s.hp + s.shield + 1, game.me);

/** Stages set piece `id` on a fresh copy of its level (`def`, on `repo` if given), ready for `rollTake` each frame. */
export function stageTake(id: SetPieceId, def: LevelDef, repo: RepoSnapshot = def.repo, role?: RoleId): Take {
  const game = Game.fromRepo(def.ground(), repo, def.seed, missionFor(def.id), undefined, role);
  const chapter = CAMPAIGN.find((c) => c.level === def.id);
  // The insertion from up high is the dropzone: the chapter's beats say which.
  const director = new Director(game, chapter && { ...chapter, beats: [id] });
  const you = game.you();
  let keep: Soldier | undefined;
  const take: Take = { id, game, director, t: 0, started: false, done: false, cue: () => idle };
  const nearest = () => game.map.compounds.map((c, i) => ({ i, d: Math.hypot(c.x - you.x, c.z - you.z) })).sort((a, b) => a.d - b.d)[0]!.i;
  take.cue = (dt) => {
    const first = take.t === 0, b = director.beat;
    take.t += dt;
    you.hp = you.maxHp, you.shield = you.maxShield;
    const input: Input = { ...idle, yaw: you.yaw };
    if (id === "incoming" || id === "onslaught") {
      if (first) for (const g of game.soldiers) if (g.alive && g.compound === nearest()) down(game, g);
      const gun = director.stage.gun;
      // Crawl to the gun.
      if (b?.phase === "crawl" && gun) Object.assign(input, { forward: 1, yaw: facing(gun.x - you.x, gun.z - you.z) });
    } else if (id === "jump" || id === "stall") {
      // A rocket roadster beside you, and you at its wheel; floored for the jump, up in the air and dry for the stall.
      // A press only lands on a sim tick, and a page's frame can fall between two: each is held until it has.
      if (first) game.vehicles.push({ id: 900, kind: "roadster", x: you.x, y: game.terrain.height(you.x, you.z), z: you.z, vx: 0, vy: 0, vz: 0, yaw: you.yaw, hp: 260, maxHp: 260, driver: -1, alive: true, cd: 0, rocketCd: 0, odo: 0, fuel: 1, burn: false });
      const car = game.vehicles.find((v) => v.id === 900);
      if (car && !take.started && you.vehicle !== car.id) input.use = true;
      if (id === "jump") {
        input.forward = 1;
        if (b?.phase === "air" && b.t > 0.35) input.roll = true;
      } else if (car && !take.started && you.vehicle === car.id) car.y += 8, car.fuel = 0;
      else if (car && b?.phase === "slide" && you.vehicle === car.id && Math.hypot(car.vx, car.vz) > 2 && b.t > 1.2) input.use = true;
    } else if (id === "beach") {
      if (first) game.time = BEACH_AT + 0.1;
    } else if (id === "barrage") {
      // Closing on the first yard, looking at it.
      if (first) {
        const c = game.map.compounds[0]!, x = c.x + c.r + 30;
        Object.assign(you, { x, z: c.z, y: game.terrain.height(x, c.z), yaw: facing(c.x - x, 0) });
        game.time = BARRAGE_AFTER + 1;
      }
      input.yaw = you.yaw;
    } else if (id === "extraction") {
      // Every yard down but one guard of the last, out in front of you; it falls a moment into the slow motion.
      if (first) {
        const last = game.map.compounds.length - 1, x = you.x - Math.sin(you.yaw) * 8, z = you.z - Math.cos(you.yaw) * 8;
        for (const g of game.soldiers) if (g.alive && g.brain) {
          if (g.compound === last && !keep) keep = g;
          else down(game, g);
        }
        if (keep) Object.assign(keep, { x, z, y: game.terrain.height(x, z), vx: 0, vz: 0 });
      }
      if (keep?.alive && b?.phase === "last" && b.t > 1.2) down(game, keep);
    }
    return input;
  };
  return take;
}

/** One frame of a take, as the page runs a level: its staging, the game at the director's pace, then the director. Answers the frame's events. */
export function rollTake(take: Take, dt: number): GameEvent[] {
  const { game, director } = take;
  game.events = [];
  const input = take.cue(dt), staged = game.events;
  const events = [...staged, ...game.step(dt * director.scale, director.steer(input))];
  director.step(dt, events);
  const b = director.beat;
  if (b) take.started = true;
  take.done ||= take.started && (!b || (b.phase === "choice" && b.t > 3));
  return events;
}
