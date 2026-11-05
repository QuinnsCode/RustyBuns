// The end of the campaign: the credits, typed onto the briefing file, and the outtakes, polaroids dropping onto the
// table one at a time. The outtakes are real frames from the engine: each stages a moment in the game (a parachute
// pulled at two metres, a dive-roll into a file), runs the sim into it, and the director holds that frame. The page
// photographs it (src/ui/credits.ts). The tone is an end-of-film outtake reel: the takes that went wrong.
//
// Scenes on the shared director (@rustybuns/util/director), so each plays by name: `?scene=credits&t=<seconds>`, or
// `?scene=outtake-chute` for one outtake's frame held live. No DOM and no three.js here.
import type { Card, Photo, Scene, SceneTable } from "@rustybuns/util/director";
import type { Stage } from "./director.ts";
import { ROLL_TIME, type Game, type Input, type Soldier } from "./game.ts";

interface P { x: number; y: number; z: number }
/** What an outtake leaves on set: the props over the level, and where the camera stands. */
export interface Setup { props: Partial<Pick<Stage, "heli" | "ladder" | "craft" | "gun">>; cam: { from: P; at: P } }

export const OUTTAKES = [
  { id: "chute", caption: "Take 9. Pulled the cord at two metres." },
  { id: "wall", caption: "Take 2. The wall was a wall." },
  { id: "ladder", caption: "Take 4. Nobody tied off the ladder." },
  { id: "craft", caption: "Take 6. It deflated with the lead aboard." },
  { id: "gun", caption: "Take 11. Somebody dropped the prop." },
] as const;
export type OuttakeId = (typeof OUTTAKES)[number]["id"];

const idle: Input = { right: 0, forward: 0, yaw: 0, pitch: 0, jump: false, roll: false, crouch: false, fire: false };
const DT = 1 / 30;

/** You, put back on your feet at (x, z), facing `yaw`, nothing carried over from the last take. */
function mark(game: Game, s: Soldier, x: number, z: number, yaw: number) {
  Object.assign(s, { x, z, y: game.ground(x, z, Infinity), vx: 0, vy: 0, vz: 0, yaw, alive: true, hp: s.maxHp, shield: s.maxShield,
    roll: 0, rollCd: 0, prone: false, crouch: false, chute: false, grounded: true, air: 0, vehicle: -1, lean: 0, burn: 0 });
}
function run(game: Game, seconds: number, input: Partial<Input>) {
  for (let t = 0; t < seconds; t += DT) game.step(DT, { ...idle, yaw: game.you().yaw, ...input });
}
const lookAt = (s: Soldier, dx: number, dy: number, dz: number, up = 1): Setup["cam"] => ({ from: { x: s.x + dx, y: s.y + dy, z: s.z + dz }, at: { x: s.x, y: s.y + up, z: s.z } });

/**
 * Stages outtake `id` on `game`, near HEAD (the guards are off at their compounds), and runs the sim into the moment.
 * The game is the film set: what was there before the take is moved, not kept.
 */
export function stageOuttake(game: Game, id: OuttakeId): Setup {
  const s = game.you(), sp = game.map.spawn, at = (dx: number, dz: number) => ({ x: sp.x + dx, z: sp.z + dz });
  if (id === "chute") {
    // Pulled far too late: the canopy's barely open and the ground is right there.
    const p = at(4, 3);
    mark(game, s, p.x, p.z, 0.6);
    Object.assign(s, { y: s.y + 1.3, vy: -13, grounded: false, air: 2, chute: true });
    run(game, DT, {});
    return { props: {}, cam: { from: { x: s.x + 4.5, y: s.y + 0.2, z: s.z + 3.5 }, at: { x: s.x, y: s.y + 2.2, z: s.z } } };
  }
  if (id === "wall") {
    // A dive-roll at full tilt into the nearest file tall enough to stop you.
    const b = game.map.blocks.filter((k) => k.h >= 1.6 && k.w >= 1.5 && k.d >= 1.5)
      .sort((a, c) => Math.hypot(a.x - sp.x, a.z - sp.z) - Math.hypot(c.x - sp.x, c.z - sp.z))[0];
    const x = b ? b.x - b.w / 2 - 2.4 : sp.x, z = b ? b.z : sp.z;
    mark(game, s, x, z, -Math.PI / 2); // facing +x, at the file
    run(game, DT, { forward: 1, roll: true, yaw: -Math.PI / 2 });
    run(game, ROLL_TIME * 0.75, { forward: 1, yaw: -Math.PI / 2 });
    return { props: {}, cam: lookAt(s, 0.8, 1.1, 4.6, 0.7) };
  }
  if (id === "ladder") {
    // The rescue ladder comes down; you come down faster, face first, under it.
    const p = at(-4, 4);
    mark(game, s, p.x, p.z, 2.4);
    run(game, 0.5, { prone: true, yaw: 2.4 });
    const h = { x: s.x + 0.6, y: s.y + 6.8, z: s.z - 0.4 };
    return { props: { heli: { ...h, yaw: 0.4, roll: 0.06 }, ladder: { x: h.x, y: h.y - 0.5, z: h.z, len: 5.8 } }, cam: { from: { x: s.x - 8, y: s.y + 2, z: s.z + 7 }, at: { x: s.x + 0.3, y: s.y + 3.2, z: s.z } } };
  }
  if (id === "craft") {
    // The hovercraft gives up with you standing in the middle of it.
    const p = at(5, -4);
    mark(game, s, p.x, p.z, 1.1);
    run(game, 0.3, {});
    return { props: { craft: { x: s.x, y: s.y, z: s.z, yaw: 0.5, roll: 0.08, deflate: 0.95 } }, cam: lookAt(s, 4, 2.2, 4.2, 0.6) };
  }
  // The gun, knocked out of reach on the first take and every take after: you crawl for it, prone.
  const p = at(-5, -3);
  mark(game, s, p.x, p.z, 0.3);
  run(game, 0.8, { prone: true, forward: 1, yaw: 0.3 });
  const f = { x: -Math.sin(s.yaw), z: -Math.cos(s.yaw) };
  return { props: { gun: { x: s.x + f.x * 1.6, y: s.y, z: s.z + f.z * 1.6 } }, cam: lookAt(s, 3.2, 1.4, 1.2, 0.4) };
}

/** How long the credits run, and when each outtake drops onto the table. */
export const CREDITS = 22, DROPS = [7, 9.5, 12, 14.5, 17];
const cards: [number, number, Card][] = [
  [0.4, CREDITS, { kind: "head", text: "End of file" }],
  [1.4, CREDITS, { kind: "strip", text: "Thank you, Ryan Quinn" }],
  [3.6, CREDITS, { kind: "strip", text: "with help from Fable, Opus and Sonnet", sub: "small" }],
  [6.2, CREDITS, { kind: "head", text: "Outtakes" }],
  [19.5, CREDITS, { kind: "stamp", text: "Filed" }],
];
/** The credits: typed strips on the file, then the outtakes dropped one by one. Any key cuts to the end; then the menu. */
export function credits(): Scene {
  return { id: "credits", seconds: CREDITS, skip: true, hold: true, cards, photos: OUTTAKES.map((o, i): [number, Photo] => [DROPS[i]!, { id: o.id, caption: o.caption }]) };
}
/** One outtake's frame, held: the camera where the take left it, its caption said over it. */
export function outtake(id: OuttakeId, set: Setup): Scene {
  const o = OUTTAKES.find((k) => k.id === id)!;
  return { id: `outtake-${id}`, seconds: 4, skip: true, hold: true, lines: [[0, o.caption]], shot: () => ({ ...set.cam, mix: 1, fov: 50 }) };
}

/** Where the film's scenes play: `setup` stages an outtake on the set and says how it was left. */
export interface FilmSet { setup(id: OuttakeId): Setup }
/** Every scene the page has by name, for `?scene=`, `window.__scenes` and the recon_scene command. */
export const SCENES: SceneTable<FilmSet> = {
  credits: () => credits(),
  ...Object.fromEntries(OUTTAKES.map((o) => [`outtake-${o.id}`, (w: FilmSet) => outtake(o.id, w.setup(o.id))])),
};
