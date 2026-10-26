// Set pieces: the campaign's scripted beats, played in the game itself rather than as films. A beat
// takes the camera for a moment, slows time or holds part of your input, then hands it all back
// mid-fight. It reads the level as it stands: the strike lands where you are, the squad comes from
// the nearest compound still held, and nothing it needs has to be standing. On your own only; a
// battle runs none. The tone is a straight action film with deadpan radio over the top.
//
//   insertion  a helicopter brings you in low over the level. Jump when you like (Space), or it
//              tips you out over HEAD; the drop is in slow motion, and it leaves not quite in control.
//   incoming   the first compound you merge: a strike throws you, your gun lands out of reach, you
//              crawl to it half-blind, and a squad comes over the wall in slow motion. Then rally on
//              the next compound or fall back to HEAD, where a health crate is waiting.
//
// The director runs on the page's clock (real seconds), so slow motion slows the game, not the beat.

import { wet } from "@rustybuns/terrain";
import type { Chapter } from "./campaign.ts";
import type { Game, GameEvent, Input, Soldier, Waypoint } from "./game.ts";

export type BeatId = "insertion" | "incoming";

interface Point { x: number; y: number; z: number }

/** What the page draws for a beat; zero and null are nothing. */
export interface Stage {
  /** 0..1: letterbox bars in. */
  bars: number;
  /** 0..1: knocked silly: blurred, washed-out sight and muffled ears. */
  daze: number;
  /** The radio's line, and a chapter's title card. */
  caption: string | null;
  title: { text: string; sub: string } | null;
  /** A key the beat is waiting on, for the prompt by the crosshair. */
  prompt: string | null;
  /** A camera the beat holds, and how much of the view it has (0: yours). */
  shot: { from: Point; at: Point; mix: number } | null;
  /** The helicopter that brings you in. */
  heli: (Point & { yaw: number; roll: number }) | null;
  /** Your gun on the ground, knocked out of your hands. */
  gun: Point | null;
}

/** A sound the page plays once: a round whistling in, ringing ears, time slowing. */
export type Cue = "whistle" | "ring" | "slow";

/** Seconds the helicopter takes to come in, how long it hovers before it tips you out, and how high it hovers. */
export const APPROACH = 3.2, HOVER = 2.2, DROP = 7.5;
/** Slow motion: on the drop, while thrown, and when the squad comes over the wall. */
export const SLOW_DROP = 0.35, SLOW_THROWN = 0.25, SLOW_CONTACT = 0.3;
/** How far the gun lands, how close you crawl to pick it up, and how long before command gives up and you get it anyway. */
export const GUN_THROW = 4.5, GUN_REACH = 1.4, CRAWL_MAX = 14;
/** The squad: how many, how far off they come in, and how long the slow motion holds for them. */
export const SQUAD = 3, SQUAD_AT = 20, CONTACT_SECONDS = 4.5;
/** How near HEAD, or the compound you rally on, counts as there. */
export const HOME = 14;

type Phase =
  | "ride" | "fall" | "landed"
  | "calm" | "thrown" | "crawl" | "contact" | "choice";

export class Director {
  /** How fast the game runs against the clock: 1, or less in slow motion. */
  scale = 1;
  stage: Stage = { bars: 0, daze: 0, caption: null, title: null, prompt: null, shot: null, heli: null, gun: null };
  /** Where to go instead of the game's own waypoint while a beat offers a choice. */
  markers: Waypoint[] = [];
  /** Sounds for the page to play, cleared each step. */
  cues: Cue[] = [];
  /** The beat playing, its phase and seconds into it. */
  beat: { id: BeatId; phase: Phase; t: number } | null = null;
  private readonly game: Game;
  private readonly chapter: Chapter | undefined;
  private waiting: BeatId[];
  private line: { text: string; left: number } | null = null;
  private bars = 0;
  private daze = 0;
  private jumped = false;
  /** The helicopter's seconds since it came in (-1: gone), and where and when it let you go. */
  private heliT = -1;
  private left: (Point & { t: number }) | null = null;
  /** The strike's point, the compound sending the squad, and the squad. */
  private struck: Point | null = null;
  private from = -1;
  private squad: Soldier[] = [];

  constructor(game: Game, chapter?: Chapter) {
    this.game = game;
    this.chapter = chapter;
    // Battles run none: they're a fight, not a film.
    this.waiting = game.mode ? [] : [...(chapter?.beats ?? [])];
    if (this.take("insertion")) this.start("insertion", "ride"), (this.heliT = 0);
  }

  /** Your input while a beat holds some of it: nothing in the helicopter, crawling on the ground. */
  steer(input: Input): Input {
    const phase = this.beat?.phase;
    const still = { ...input, forward: 0, right: 0, fire: false, roll: false, use: false, reload: false, scope: false };
    if (phase === "ride") {
      if (input.jump) this.jumped = true;
      return { ...still, jump: false, crouch: false, prone: false };
    }
    // Falling you can still work the parachute; thrown, you can't do anything.
    if (phase === "fall") return still;
    if (phase === "thrown") return { ...still, jump: false };
    if (phase === "crawl") return { ...input, prone: true, crouch: false, jump: false, roll: false, fire: false, scope: false, use: false, reload: false, weapon: undefined };
    return input;
  }

  /** After the game's step: dt real seconds, and the events it raised. */
  step(dt: number, events: GameEvent[]) {
    this.cues = [];
    const game = this.game, you = game.you();
    if (this.heliT >= 0) this.heliT += dt;
    if (this.line && (this.line.left -= dt) <= 0) this.line = null;
    const b = this.beat;
    // Going down, or the level ending, drops whatever was playing.
    if (b && b.id === "incoming" && (game.status !== "playing" || !you.alive || events.some((e) => e.kind === "respawn" && e.id === game.me))) this.end();
    else if (b) b.t += dt, b.id === "insertion" ? this.insertion(b, dt) : this.incoming(b, dt);
    else if (game.status === "playing" && you.alive && you.vehicle < 0 && events.some((e) => e.kind === "cleared") && !game.cleared.every(Boolean) && this.take("incoming")) {
      this.start("incoming", "calm");
      this.say("Command: Nice work. Nothing could possibly go wrong now.", 2.6);
    }
    this.bars += ((this.beat && this.beat.phase !== "choice" && this.beat.phase !== "contact" ? (this.beat.phase === "crawl" ? 0.35 : 1) : 0) - this.bars) * Math.min(1, dt * 5);
    this.daze += ((this.beat?.phase === "crawl" ? 1 : 0) - this.daze) * Math.min(1, dt * (this.beat?.phase === "crawl" ? 8 : 1.4));
    this.stage.bars = this.bars < 0.01 ? 0 : this.bars;
    this.stage.daze = this.daze < 0.01 ? 0 : this.daze;
    this.stage.caption = this.line?.text ?? null;
    this.stage.heli = this.heli();
    if (!this.stage.heli) this.heliT = -1;
  }

  /* ---------------- insertion ---------------- */

  private insertion(b: { phase: Phase; t: number }, dt: number) {
    const game = this.game, you = game.you(), sp = game.map.spawn, { f, side } = axes(sp.yaw), g0 = game.terrain.height(sp.x, sp.z);
    const ch = this.chapter;
    if (b.phase === "ride") {
      const h = this.heli()!;
      // Riding the skid: held there whatever the game did this step.
      Object.assign(you, { x: h.x, y: h.y + 0.1, z: h.z, vx: 0, vy: 0, vz: 0, chute: false });
      if (passed(b, dt, 0.3)) this.say("Pilot: Thirty seconds out.", 1.6);
      if (passed(b, dt, 1.9)) this.say("Pilot: Make that five. I rounded.", 1.6);
      if (passed(b, dt, APPROACH)) this.say("Pilot: This is your stop. Jump, or I tip you out.", 2.2);
      this.stage.title = ch && b.t > 0.6 ? { text: ch.title, sub: ch.height } : null;
      this.stage.prompt = "Space · jump";
      // Coming in, a wide shot from off to the side; over HEAD, low on the ground looking up.
      this.stage.shot = b.t < APPROACH
        ? { from: { x: sp.x + side.x * 16 - f.x * 4, y: g0 + 3, z: sp.z + side.z * 16 - f.z * 4 }, at: { x: h.x, y: h.y, z: h.z }, mix: 1 }
        : this.lowShot(you, sp, g0);
      if (this.jumped || b.t >= APPROACH + HOVER) {
        // Jumped while it was still coming in: you keep some of its way on.
        if (b.t < APPROACH) you.vx = f.x * 6, you.vz = f.z * 6;
        this.left = { x: h.x, y: h.y, z: h.z, t: this.heliT };
        b.phase = "fall", b.t = 0, this.stage.title = null, this.stage.prompt = null, this.scale = SLOW_DROP;
      }
    } else if (b.phase === "fall") {
      // Slow motion all the way down, unless a parachute opened (that's slow enough already).
      this.scale = you.chute ? 1 : SLOW_DROP;
      this.stage.shot = this.lowShot(you, sp, g0);
      if (you.grounded) b.phase = "landed", b.t = 0, this.say("Pilot: That noise was nothing. Good luck down there.", 3);
    } else {
      this.scale = Math.min(1, this.scale + dt * 1.6);
      if (this.stage.shot) this.stage.shot.mix = Math.max(0, 1 - b.t / 0.8);
      if (b.t > 0.9) this.end(false);
    }
  }

  /** Low on the ground by HEAD, looking up at you. */
  private lowShot(you: Soldier, sp: { x: number; z: number; yaw: number }, g0: number): Stage["shot"] {
    const { f, side } = axes(sp.yaw);
    return { from: { x: sp.x + side.x * 3.5 + f.x * 4, y: g0 + 0.6, z: sp.z + side.z * 3.5 + f.z * 4 }, at: { x: you.x, y: you.y + 0.9, z: you.z }, mix: 1 };
  }

  /** Where the helicopter is: coming in from behind HEAD, hovering over it, then off ahead with a wobble. */
  private heli(): Stage["heli"] {
    const t = this.heliT;
    if (t < 0) return null;
    const game = this.game, sp = game.map.spawn, { f } = axes(sp.yaw), g0 = game.terrain.height(sp.x, sp.z);
    const over = (x: number, z: number, y: number) => Math.max(y, game.terrain.height(x, z) + 4);
    const at = this.left;
    if (!at) {
      const k = 1 - (1 - Math.min(1, t / APPROACH)) ** 3, back = (1 - k) * 70, x = sp.x - f.x * back, z = sp.z - f.z * back;
      return { x, y: over(x, z, g0 + DROP + (1 - k) * 18), z, yaw: sp.yaw, roll: 0 };
    }
    // Off it goes, climbing, and something clipped on the way out has it rocking.
    const since = t - at.t, x = at.x + f.x * (since * 3 + since * since * 4), z = at.z + f.z * (since * 3 + since * since * 4);
    if (since > 6) return null;
    return { x, y: over(x, z, at.y + since * since * 1.5), z, yaw: sp.yaw, roll: Math.sin(since * 9) * 0.35 * Math.exp(-since * 0.5) };
  }

  /* ---------------- incoming ---------------- */

  private incoming(b: { phase: Phase; t: number }, dt: number) {
    const game = this.game, you = game.you();
    if (b.phase === "calm") {
      if (passed(b, dt, 1.6)) this.cues.push("whistle");
      if (b.t < 2.4) return;
      // The strike lands between you and the nearest compound still held, and throws you away from it.
      this.from = this.nearestHeld();
      const c = game.map.compounds[this.from], d = c ? norm(c.x - you.x, c.z - you.z) : axes(you.yaw).f;
      const x = you.x + d.x * 2, z = you.z + d.z * 2;
      this.struck = { x, y: game.terrain.height(x, z), z };
      game.strike(x, this.struck.y + 0.3, z, game.me);
      this.scale = SLOW_THROWN;
      b.phase = "thrown", b.t = 0;
    } else if (b.phase === "thrown") {
      const s = this.struck!, away = norm(you.x - s.x, you.z - s.z), across = { x: -away.z, z: away.x };
      this.stage.shot = { from: { x: you.x + across.x * 4.5, y: you.y + 1.2, z: you.z + across.z * 4.5 }, at: { x: you.x, y: you.y + 0.8, z: you.z }, mix: 0.9 };
      if ((you.grounded && b.t > 0.3) || b.t > 3.5) {
        this.stage.gun = this.gunSpot(away);
        this.cues.push("ring");
        this.say("Command: Get to your weapon, soldier.", 3);
        b.phase = "crawl", b.t = 0;
      }
    } else if (b.phase === "crawl") {
      this.scale = Math.min(1, this.scale + dt * 1.6);
      if (this.stage.shot) this.stage.shot.mix = Math.max(0, this.stage.shot.mix - dt * 1.6);
      if (passed(b, dt, 5)) this.say("Command: Any time now. We're on a budget.", 3);
      const g = this.stage.gun!, there = Math.hypot(g.x - you.x, g.z - you.z) < GUN_REACH;
      if (!there && b.t < CRAWL_MAX) return;
      if (!there) this.say("Command: Fine. We'll mail it to you.", 2.5);
      this.stage.gun = null, this.stage.shot = null;
      // Over the wall: the squad from the nearest compound still held, coming in where they'd be seen.
      this.from = this.nearestHeld();
      if (this.from < 0) return this.end();
      const at = this.squadSpot(this.from);
      this.squad = game.reinforce(this.from, SQUAD, at.x, at.z);
      this.scale = SLOW_CONTACT;
      this.cues.push("slow");
      if (there) this.say("Contact! Over the wall!", 2.5);
      b.phase = "contact", b.t = 0;
    } else if (b.phase === "contact") {
      if (b.t < CONTACT_SECONDS && this.squad.some((s) => s.alive)) return;
      const c = game.map.compounds[this.nearestHeld()], { spawn } = game.map, rally = game.waypoint();
      game.crate("health", spawn.x, spawn.z);
      // Already by HEAD, falling back isn't a choice: the crate's right there.
      const home = Math.hypot(spawn.x - you.x, spawn.z - you.z) < HOME;
      this.markers = home ? [] : [{ x: spawn.x, y: game.terrain.height(spawn.x, spawn.z), z: spawn.z, label: "fall back: HEAD", kind: "head" }];
      if (rally && rally.kind === "compound") this.markers.unshift({ ...rally, label: `rally: ${rally.label}` });
      this.say(home ? `Command: Health crate at HEAD, right behind you. Then rally on ${c?.folder ?? "the next one"}.`
        : c ? `Command: Your call. Rally on ${c.folder}, or fall back to HEAD and patch up.` : "Command: Fall back to HEAD and patch up.", 5);
      b.phase = "choice", b.t = 0;
    } else {
      this.scale = Math.min(1, this.scale + dt * 2);
      const back = this.markers.find((m) => m.kind === "head"), home = !!back && Math.hypot(back.x - you.x, back.z - you.z) < HOME;
      const rally = this.markers.find((m) => m.kind === "compound"), there = !!rally && Math.hypot(rally.x - you.x, rally.z - you.z) < HOME;
      if (home) this.say("Command: Patch up. We'll call it the plan.", 3);
      else if (there) this.say("Command: Bold. Noted.", 2.5);
      if (home || there || b.t > 40) this.end(false);
    }
  }

  /** The nearest compound to you still held, by index, or -1. */
  private nearestHeld(): number {
    const game = this.game, you = game.you();
    let best = -1, bestD = Infinity;
    game.map.compounds.forEach((c, i) => {
      const d = Math.hypot(c.x - you.x, c.z - you.z);
      if (!game.cleared[i] && d < bestD) best = i, bestD = d;
    });
    return best;
  }

  /** A spot for the gun along the way you were thrown, or near it: dry, clear of files, not up or down a cliff. */
  private gunSpot(away: { x: number; z: number }): Point {
    const game = this.game, you = game.you();
    for (const turn of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, Math.PI]) {
      const c = Math.cos(turn), s = Math.sin(turn), dx = away.x * c - away.z * s, dz = away.x * s + away.z * c;
      const x = you.x + dx * GUN_THROW, z = you.z + dz * GUN_THROW, y = game.ground(x, z, Infinity);
      if (this.open(x, y, z) && Math.abs(y - you.y) < 1.2) return { x, y, z };
    }
    return { x: you.x, y: you.y, z: you.z };
  }

  /** Where the squad comes in: toward compound ci from you, SQUAD_AT metres out (short of it if it's nearer), somewhere open. */
  private squadSpot(ci: number): { x: number; z: number } {
    const game = this.game, you = game.you(), c = game.map.compounds[ci]!, d = Math.hypot(c.x - you.x, c.z - you.z), to = norm(c.x - you.x, c.z - you.z);
    const far = Math.min(SQUAD_AT, Math.max(8, d - 2));
    for (const turn of [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2]) {
      const cs = Math.cos(turn), sn = Math.sin(turn), x = you.x + (to.x * cs - to.z * sn) * far, z = you.z + (to.x * sn + to.z * cs) * far;
      if (this.open(x, game.terrain.height(x, z), z)) return { x, z };
    }
    return { x: c.x, z: c.z };
  }

  private open(x: number, y: number, z: number): boolean {
    const game = this.game;
    return Math.hypot(x, z) < game.terrain.R - 3 && !game.blockAt(x, y + 0.5, z) && !wet(game.terrain, x, z);
  }

  /* ---------------- plumbing ---------------- */

  private take(id: BeatId): boolean {
    const i = this.waiting.indexOf(id);
    if (i < 0) return false;
    this.waiting.splice(i, 1);
    return true;
  }

  private start(id: BeatId, phase: Phase) {
    this.beat = { id, phase, t: 0 };
  }

  /** The beat's over: time back to normal and the camera yours. Cut short, the radio goes quiet too. */
  private end(cut = true) {
    this.beat = null, this.scale = 1, this.markers = [], this.squad = [];
    Object.assign(this.stage, { title: null, prompt: null, shot: null, gun: null });
    if (cut) this.line = null;
  }

  private say(text: string, seconds: number) {
    this.line = { text, left: seconds };
  }
}

/** Whether a beat's clock went past `at` seconds this step. */
const passed = (b: { t: number }, dt: number, at: number) => b.t >= at && b.t - dt < at;

/** Forward and right along a yaw (forward is -z at yaw 0). */
function axes(yaw: number) {
  const f = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
  return { f, side: { x: -f.z, z: f.x } };
}

function norm(x: number, z: number) {
  const d = Math.hypot(x, z) || 1;
  return { x: x / d, z: z / d };
}
