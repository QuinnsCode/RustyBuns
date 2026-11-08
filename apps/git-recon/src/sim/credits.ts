// The end of the campaign: Command's newsreel (slow-motion footage under poster slogans), then the credits, typed
// onto the briefing file, and the outtakes, polaroids dropping onto the table one at a time. The outtakes are real frames from the engine: each stages a moment in the game (a parachute
// pulled at two metres, a dive-roll into a file), runs the sim into it, and the director holds that frame. The page
// photographs it (src/ui/credits.ts). The tone is an end-of-film outtake reel: the takes that went wrong.
//
// Scenes on the shared director (@rustybuns/util/director), so each plays by name: `?scene=credits&t=<seconds>`, or
// `?scene=outtake-chute` for one outtake's frame held live, `?scene=newsreel&t=6` for the footage. No DOM and no three.js here.
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

export const idle: Input = { right: 0, forward: 0, yaw: 0, pitch: 0, jump: false, roll: false, crouch: false, fire: false };
export const DT = 1 / 30;

/** You, put back on your feet at (x, z), facing `yaw`, nothing carried over from the last take. */
export function mark(game: Game, s: Soldier, x: number, z: number, yaw: number) {
  Object.assign(s, { x, z, y: game.ground(x, z, Infinity), vx: 0, vy: 0, vz: 0, yaw, alive: true, hp: s.maxHp, shield: s.maxShield,
    roll: 0, rollCd: 0, prone: false, crouch: false, chute: false, grounded: true, air: 0, vehicle: -1, lean: 0, burn: 0 });
}
export function run(game: Game, seconds: number, input: Partial<Input>) {
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

/* ---------------- the newsreel: Command's own, before the credits ---------------- */

// A wartime recruitment newsreel, played straight: an announcer, poster slogans over the footage, film grain, and
// the footage itself the engine's, in slow motion. Each clip stages you on the set (near HEAD, the guards at their
// compounds) and the page rolls the sim on under the take's input at SLOW speed, a tripod at `from` following you.

/** How fast the footage runs, and how long the newsreel is. */
export const SLOW = 0.3, NEWSREEL = 20;
export const CLIPS = [
  { id: "over", from: 0, to: 5.5 },
  { id: "charge", from: 5.5, to: 10.5 },
  { id: "roll", from: 10.5, to: 15 },
  { id: "drop", from: 15, to: NEWSREEL },
] as const;
export type ClipId = (typeof CLIPS)[number]["id"];
/** A clip staged: where the camera stands, and what you do `k` seconds (sim time) into the take. */
export interface Clip { id: ClipId; from: P; drive(k: number): Partial<Input> }

/** The clip on at second `t` of the newsreel. */
export const clipAt = (t: number) => CLIPS.find((c) => t < c.to) ?? CLIPS.at(-1)!;
/** Facing (dx, dz). */
const face = (dx: number, dz: number) => Math.atan2(-dx, -dz);

/** Stages clip `id` on `game`: you on your mark, the camera on its tripod. */
export function stageClip(game: Game, id: ClipId): Clip {
  const s = game.you(), sp = game.map.spawn;
  const ground = (x: number, z: number) => game.ground(x, z, Infinity);
  if (id === "over") {
    // Over the top: a run at the nearest file low enough to mantle, up onto it and down the far side.
    const b = game.map.blocks.filter((k) => {
      const lip = k.y + k.h - ground(k.x - k.w / 2 - 3, k.z);
      return lip > 1 && lip < 2.6 && k.w >= 1.2 && k.w <= 4 && k.d >= 1.2;
    }).sort((a, c) => Math.hypot(a.x - sp.x, a.z - sp.z) - Math.hypot(c.x - sp.x, c.z - sp.z))[0];
    const x = b ? b.x - b.w / 2 - 3 : sp.x, z = b ? b.z : sp.z, yaw = face(1, 0);
    mark(game, s, x, z, yaw);
    // From low down beside the wall, looking up at it: the poster angle.
    return { id, from: { x: x + 3, y: s.y + 0.4, z: z + 6.5 }, drive: (k) => ({ forward: 1, yaw, jump: k > 0.1 && k < 0.2 }) };
  }
  if (id === "charge") {
    // Straight at the camera across the rug, at a run.
    const yaw = sp.yaw + 0.2, f = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
    mark(game, s, sp.x, sp.z, yaw);
    const fx = sp.x + f.x * 11, fz = sp.z + f.z * 11;
    return { id, from: { x: fx + f.z * 1.5, y: ground(fx, fz) + 0.5, z: fz - f.x * 1.5 }, drive: () => ({ forward: 1, yaw }) };
  }
  if (id === "roll") {
    // A dive-roll across the front of the camera, and up running.
    const yaw = sp.yaw - 1.2, f = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
    mark(game, s, sp.x - f.x * 3, sp.z - f.z * 3, yaw);
    return { id, from: { x: sp.x + f.z * 5, y: ground(sp.x, sp.z) + 0.8, z: sp.z - f.x * 5 }, drive: (k) => ({ forward: 1, yaw, roll: k > 0.15 && k < 0.25 }) };
  }
  // In by parachute, the canopy open high up, down onto HEAD.
  mark(game, s, sp.x + 2, sp.z + 2, sp.yaw);
  Object.assign(s, { y: s.y + 9, vy: -3, grounded: false, air: 2, chute: true });
  return { id, from: { x: sp.x + 9, y: ground(sp.x + 9, sp.z - 4) + 0.3, z: sp.z - 4 }, drive: () => ({}) };
}
/** Rolls a staged clip on from `done` to `to` seconds of sim time, under its input; answers the seconds now done. */
export function rollClip(game: Game, clip: Clip, done: number, to: number): number {
  for (; done + DT <= to + 1e-6; done += DT) game.step(DT, { ...idle, yaw: game.you().yaw, ...clip.drive(done) });
  return done;
}
/** The tripod's view of you. */
export function clipShot(game: Game, clip: Clip): Setup["cam"] {
  const s = game.you();
  return { from: clip.from, at: { x: s.x, y: s.y + 1, z: s.z } };
}

const slogans: [number, number, Card][] = [
  [0.2, 3.4, { kind: "title", text: "Command Newsreel", sub: "No. 7: The empire falls" }],
  [3.4, 5.5, { kind: "poster", text: "Every commit counts!" }],
  [8, 10.5, { kind: "poster", text: "Merge for the cause!" }],
  [12.4, 15, { kind: "poster", text: "Your branch needs you", sub: "Enlist at HEAD" }],
  [17.2, NEWSREEL, { kind: "poster", text: "Resolve! Resolve! Resolve!", sub: "A message from Command" }],
];
const announcer: [number, string][] = [
  [0.4, "Announcer: From the front room, the news the whole history has waited for!"],
  [2.4, "Announcer: Our boys go over the top. Over the files. Over the top of the files!"],
  [5.7, "Announcer: Straight at the empire, and they do not stop for anything. Not even the camera."],
  [10.7, "Announcer: Not one conflict left standing. Not one!"],
  [15.2, "Announcer: And so, home to HEAD, and to dinner. Which is at six."],
];
/** The newsreel: the footage in slow motion with a hard cut between clips, the slogans and the announcer over it. */
export function newsreel(): Scene {
  const cut = (t: number) => Math.max(0, ...CLIPS.slice(1).map((c) => 1 - Math.abs(t - c.from) / 0.12));
  return { id: "newsreel", seconds: NEWSREEL, skip: true, hold: true, lines: announcer, cards: slogans, look: (t) => ({ slow: SLOW, dip: cut(t) }) };
}

/** Where the film's scenes play: `setup` stages an outtake on the set and says how it was left. */
export interface FilmSet { setup(id: OuttakeId): Setup }
/** Every scene the page has by name, for `?scene=`, `window.__scenes` and the recon_scene command. */
export const SCENES: SceneTable<FilmSet> = {
  credits: () => credits(),
  newsreel: () => newsreel(),
  ...Object.fromEntries(OUTTAKES.map((o) => [`outtake-${o.id}`, (w: FilmSet) => outtake(o.id, w.setup(o.id))])),
};
