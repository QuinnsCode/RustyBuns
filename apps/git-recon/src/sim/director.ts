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
//   jump       Hold the yard: the roadster you board leaves the ground at speed, you bail out with a
//              dive-roll, and the empty car carries on without you.
//   beach      Lost commit: a hovercraft comes in over the lawn, beaches, and slowly deflates.
//   dropzone   The valley floor: a helicopter drop from high up, under a parachute, the camera on the wall.
//   stall      The shoulders: the roadster's thrusters run dry in the air, it slides back in slow
//              motion, and you step off.
//   onslaught  The heights: incoming with two squads at once, from two compounds.
//   extraction the last guard falls in slow motion, then a helicopter lowers a rope ladder and you climb out.
//   gag        a three-second git joke on an event: a first headshot, a reset crate, your last life.
//   sweep      the chapters that start on foot open on a slow, cheesy sweeping shot round you with a
//              narrator's line. Jump or fire to skip it.
//
// The director runs on the page's clock (real seconds), so slow motion slows the game, not the beat.

import { wet } from "@rustybuns/terrain";
import { cheese, sweepShot } from "@rustybuns/util";
import type { Chapter } from "./campaign.ts";
import { ROLL_TIME, type Game, type GameEvent, type Input, type Soldier, type Waypoint } from "./game.ts";
import type { Vehicle } from "./vehicles.ts";
import LINES from "../../content/radio.json";
import GAGS_SCRIPT from "../../content/gags.json";

export type BeatId = "insertion" | "incoming" | "jump" | "beach" | "dropzone" | "stall" | "onslaught" | "extraction" | "gag" | "sweep";

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
  /** The hovercraft on the lawn, and how flat it has gone (0..1). */
  craft: (Point & { yaw: number; roll: number; deflate: number }) | null;
  /** The rope ladder hanging from the helicopter at the top, this long. */
  ladder: (Point & { len: number }) | null;
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
/** The dropzone's height over HEAD; a jump's speed, launch and how long the bail-out is held; the stall's slide back; the ladder, and the hovercraft's life. */
export const DROP_HIGH = 60, JUMP_SPEED = 12, JUMP_LAUNCH = 11, BAIL = 0.8, SLIDE_BACK = 5, LADDER = 7.5, CRAFT_LIFE = 40;
/** How long the opening sweep runs, and the pace of the game under it. */
export const SWEEP = 8, SLOW_SWEEP = 0.2;
/** How long a cutaway gag runs, and the game time the hovercraft turns up at. */
export const GAG = 3, BEACH_AT = 18, SLOW_JUMP = 0.35, SLOW_LAST = 0.3, LAST_NEAR = 35;
/** How near HEAD, or the compound you rally on, counts as there. */
export const HOME = 14;

type Phase =
  | "ride" | "fall" | "landed"
  | "calm" | "thrown" | "crawl" | "contact" | "choice"
  | "run" | "air" | "carry" | "glide" | "stall" | "slide" | "off" | "last" | "lift" | "gag" | "sweep";

/** What a cutaway gag is about, and the line it gets. */
const GAGS = GAGS_SCRIPT;

export class Director {
  /** How fast the game runs against the clock: 1, or less in slow motion. */
  scale = 1;
  stage: Stage = { bars: 0, daze: 0, caption: null, title: null, prompt: null, shot: null, heli: null, gun: null, craft: null, ladder: null };
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
  /** Jump or fire was pressed during the opening sweep. */
  private skipped = false;
  /** The helicopter's seconds since it came in (-1: gone), and where and when it let you go. */
  private heliT = -1;
  private left: (Point & { t: number }) | null = null;
  /** The strike's point, the compound sending the squad, and the squad. */
  private struck: Point | null = null;
  private from = -1;
  private squad: Soldier[] = [];
  /** The dropzone's drop is from up high. */
  private high = false;
  /** Bailed out of the jumping car (Shift). */
  private bailed = false;
  /** The car being let go on, and the way it was going. */
  private car: { id: number; dx: number; dz: number } | null = null;
  /** The hovercraft: where it beaches, the way it slides in, and seconds since it started. */
  private craft: { to: Point; dx: number; dz: number; yaw: number; t: number } | null = null;
  /** The extraction: where the ladder comes down, and the last guard. */
  private rescue: (Point & { yaw: number }) | null = null;
  private last: Soldier | null = null;
  private wonAt: number | null = null;
  /** The gags that have run this level, and whether this chapter has any. */
  private told = new Set<keyof typeof GAGS>();
  private readonly gags: boolean;

  constructor(game: Game, chapter?: Chapter) {
    this.game = game;
    this.chapter = chapter;
    // Battles run none: they're a fight, not a film.
    this.waiting = game.mode ? [] : [...(chapter?.beats ?? [])];
    this.gags = this.waiting.includes("gag");
    this.high = !this.waiting.includes("insertion") && this.waiting.includes("dropzone");
    if (this.take("insertion") || this.take("dropzone")) this.start("insertion", "ride"), (this.heliT = 0);
    else if (this.take("sweep")) this.start("sweep", "sweep");
  }

  /** The result screen waits while the extraction plays out. */
  get holding(): boolean {
    return this.beat?.id === "extraction";
  }

  /** Your input while a beat holds some of it: nothing in the helicopter, crawling on the ground. */
  steer(input: Input): Input {
    const phase = this.beat?.phase;
    const still = { ...input, forward: 0, right: 0, fire: false, roll: false, use: false, reload: false, scope: false };
    if (phase === "sweep") {
      if (input.jump || input.fire) this.skipped = true;
      return still;
    }
    if (phase === "ride") {
      if (input.jump) this.jumped = true;
      return { ...still, jump: false, crouch: false, prone: false };
    }
    // Falling you can still work the parachute; thrown, you can't do anything.
    if (phase === "fall") return still;
    if (phase === "thrown") return { ...still, jump: false };
    if (phase === "air") {
      if (input.roll) this.bailed = true;
      return { ...still, jump: false, roll: false };
    }
    if (phase === "stall" || phase === "slide") return { ...input, forward: 0, up: false, down: false, fire: false };
    if (phase === "lift") return still;
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
    // Going down, or the level ending, drops whatever was playing (the extraction plays on after the win).
    const down = !you.alive || events.some((e) => e.kind === "respawn" && e.id === game.me);
    if (b && b.id !== "insertion" && (b.id === "extraction" ? game.status === "lost" || (game.status === "playing" && down) : game.status !== "playing" || down)) this.end();
    else if (b) b.t += dt, this.play(b, dt);
    else this.trigger(events);
    if (this.craft) this.craft.t += dt;
    if (this.craft && this.craft.t > CRAFT_LIFE) this.craft = null;
    this.bars += (this.barsFor(this.beat?.phase) - this.bars) * Math.min(1, dt * 5);
    this.daze += ((this.beat?.phase === "crawl" ? 1 : 0) - this.daze) * Math.min(1, dt * (this.beat?.phase === "crawl" ? 8 : 1.4));
    this.stage.bars = this.bars < 0.01 ? 0 : this.bars;
    this.stage.daze = this.daze < 0.01 ? 0 : this.daze;
    this.stage.caption = this.line?.text ?? null;
    this.stage.heli = this.heli();
    if (!this.stage.heli) this.heliT = -1;
    this.stage.craft = this.hovercraft();
  }

  private play(b: { id: BeatId; phase: Phase; t: number }, dt: number) {
    if (b.id === "insertion") this.insertion(b, dt);
    else if (b.id === "sweep") this.sweep(b, dt);
    else if (b.id === "incoming" || b.id === "onslaught") this.incoming(b, dt);
    else if (b.id === "jump") this.jump(b, dt);
    else if (b.id === "beach") this.beach(b, dt);
    else if (b.id === "stall") this.stall(b, dt);
    else if (b.id === "extraction") this.extraction(b, dt);
    else this.gag(b, dt);
  }

  /** Nothing playing: what in the game starts a beat. */
  private trigger(events: GameEvent[]) {
    const game = this.game, you = game.you();
    if (game.status !== "playing" || !you.alive) return;
    const ride = you.vehicle >= 0 ? game.vehicles.find((v) => v.id === you.vehicle) : undefined;
    if (you.vehicle < 0 && events.some((e) => e.kind === "cleared") && !game.cleared.every(Boolean)) {
      const id = this.take("incoming") ? "incoming" : this.take("onslaught") ? "onslaught" : null;
      if (id) {
        this.start(id, "calm");
        this.say(id === "incoming" ? LINES.commandNiceWorkNothing : LINES.commandLastStretchNothing, 2.6);
        return;
      }
    }
    if (ride?.kind === "roadster" && events.some((e) => e.kind === "board" && e.on) && this.take("jump")) {
      this.start("jump", "run");
      this.say(LINES.commandFloorItWell, 2.4);
      return;
    }
    // Thrusters dry while it's up in the air.
    if (ride?.kind === "roadster" && ride.fuel <= 0.01 && ride.y > game.terrain.height(ride.x, ride.z) + 3 && this.take("stall")) {
      this.start("stall", "stall");
      this.scale = 0.4;
      this.say(LINES.commandTheGaugeSays, 3);
      return;
    }
    const spot = game.time > BEACH_AT && this.waiting.includes("beach") ? this.beachSpot() : null;
    if (spot && this.take("beach")) {
      const { f } = axes(you.yaw), m = { x: -f.z, z: f.x };
      this.craft = { to: spot, dx: m.x, dz: m.z, yaw: Math.atan2(-m.x, -m.z), t: 0 };
      this.start("beach", "glide");
      this.scale = 0.5;
      this.say(LINES.commandYourRidesHere, 2.6);
      return;
    }
    // The last guard of the last compound: a slow-motion final kill.
    const rest = game.cleared.flatMap((c, i) => (c ? [] : [i]));
    if (this.waiting.includes("extraction") && rest.length === 1) {
      const guards = game.soldiers.filter((g) => g.alive && g.compound === rest[0]);
      if (guards.length === 1) {
        this.last = guards[0]!;
        this.start("extraction", "last");
        this.cues.push("slow");
        return;
      }
    }
    if (this.gags) this.tell(events);
  }

  /** A cutaway gag for the first of these to happen this level. */
  private tell(events: GameEvent[]) {
    const game = this.game;
    let gag: keyof typeof GAGS | null = null;
    for (const e of events) {
      if (e.kind === "hit" && e.head && e.by === game.me && !game.soldiers[e.target]?.alive) gag ??= "headshot";
      else if (e.kind === "pickup" && e.id === game.me && e.item === "reset") gag ??= "reset";
      else if (e.kind === "respawn" && e.id === game.me && e.lives === 0) gag ??= "lastLife";
    }
    if (!gag || this.told.has(gag)) return;
    this.told.add(gag);
    this.start("gag", "gag");
    this.scale = 0.45;
    this.say(GAGS[gag], GAG);
  }

  /* ---------------- sweep ---------------- */

  private sweep(b: { t: number }, dt: number) {
    const you = this.game.you();
    this.scale = SLOW_SWEEP;
    if (passed(b, dt, 0.8)) this.say(cheese("recon", chapterIndex(this.chapter)), SWEEP - 2);
    this.stage.prompt = "Space · skip";
    this.stage.shot = sweepShot(b.t, { x: you.x, y: you.y, z: you.z }, { seconds: SWEEP, radius: 18, height: 7 });
    if (this.skipped || b.t >= SWEEP) this.end(false), this.skipped = false;
  }

  /* ---------------- insertion ---------------- */

  private insertion(b: { phase: Phase; t: number }, dt: number) {
    const game = this.game, you = game.you(), sp = game.map.spawn, { f, side } = axes(sp.yaw), g0 = game.terrain.height(sp.x, sp.z);
    const ch = this.chapter;
    if (b.phase === "ride") {
      const h = this.heli()!;
      // Riding the skid: held there whatever the game did this step.
      Object.assign(you, { x: h.x, y: h.y + 0.1, z: h.z, vx: 0, vy: 0, vz: 0, chute: false });
      if (this.high && passed(b, dt, 0.3)) this.say(LINES.pilotSixtyMetresParachutes, 1.9);
      else if (passed(b, dt, 0.3)) this.say(LINES.pilotThirtySecondsOut, 1.6);
      if (!this.high && passed(b, dt, 1.9)) this.say(LINES.pilotMakeThatFive, 1.6);
      if (passed(b, dt, APPROACH)) this.say(LINES.pilotThisIsYour, 2.2);
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
      this.scale = you.chute ? 1 : this.high ? 0.5 : SLOW_DROP;
      this.stage.shot = this.high ? this.wallShot(you) : this.lowShot(you, sp, g0);
      if (you.grounded) b.phase = "landed", b.t = 0, this.say(LINES.pilotThatNoiseWas, 3);
    } else {
      this.scale = Math.min(1, this.scale + dt * 1.6);
      if (this.stage.shot) this.stage.shot.mix = Math.max(0, 1 - b.t / 0.8);
      if (this.high && passed(b, dt, 0.4)) this.say(LINES.pilotToldYouProbably, 2);
      if (b.t > 0.9) this.end(false);
    }
  }

  /** From behind you as you fall, looking out past you at the wall: the far compound, high up. */
  private wallShot(you: Soldier): Stage["shot"] {
    const game = this.game, sp = game.map.spawn;
    let wall: Point = { x: -sp.x, y: 0, z: -sp.z }, far = 0;
    for (const c of game.map.compounds) {
      const d = Math.hypot(c.x - sp.x, c.z - sp.z);
      if (d > far) far = d, wall = { x: c.x, y: 0, z: c.z };
    }
    const to = norm(wall.x - you.x, wall.z - you.z);
    return { from: { x: you.x - to.x * 9, y: you.y + 3.5, z: you.z - to.z * 9 }, at: { x: wall.x, y: game.terrain.height(wall.x, wall.z) + 55, z: wall.z }, mix: 1 };
  }

  /** Low on the ground by HEAD, looking up at you. */
  private lowShot(you: Soldier, sp: { x: number; z: number; yaw: number }, g0: number): Stage["shot"] {
    const { f, side } = axes(sp.yaw);
    return { from: { x: sp.x + side.x * 3.5 + f.x * 4, y: g0 + 0.6, z: sp.z + side.z * 3.5 + f.z * 4 }, at: { x: you.x, y: you.y + 0.9, z: you.z }, mix: 1 };
  }

  /** Where the helicopter is: coming in from behind HEAD, hovering over it, then off ahead with a wobble. */
  private heli(): Stage["heli"] {
    const lift = this.rescue && this.beat?.phase === "lift" ? this.beat.t : -1;
    if (lift >= 0) return this.rescueHeli(lift);
    const t = this.heliT;
    if (t < 0) return null;
    const game = this.game, sp = game.map.spawn, { f } = axes(sp.yaw), g0 = game.terrain.height(sp.x, sp.z);
    const over = (x: number, z: number, y: number) => Math.max(y, game.terrain.height(x, z) + 4);
    const at = this.left;
    if (!at) {
      const k = 1 - (1 - Math.min(1, t / APPROACH)) ** 3, back = (1 - k) * 70, x = sp.x - f.x * back, z = sp.z - f.z * back;
      return { x, y: over(x, z, g0 + (this.high ? DROP_HIGH : DROP) + (1 - k) * 18), z, yaw: sp.yaw, roll: 0 };
    }
    // Off it goes, climbing, and something clipped on the way out has it rocking.
    const since = t - at.t, x = at.x + f.x * (since * 3 + since * since * 4), z = at.z + f.z * (since * 3 + since * since * 4);
    if (since > 6) return null;
    return { x, y: over(x, z, at.y + since * since * 1.5), z, yaw: sp.yaw, roll: Math.sin(since * 9) * 0.35 * Math.exp(-since * 0.5) };
  }

  /* ---------------- incoming ---------------- */

  private incoming(b: { id: BeatId; phase: Phase; t: number }, dt: number) {
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
        this.say(LINES.commandGetToYour, 3);
        b.phase = "crawl", b.t = 0;
      }
    } else if (b.phase === "crawl") {
      this.scale = Math.min(1, this.scale + dt * 1.6);
      if (this.stage.shot) this.stage.shot.mix = Math.max(0, this.stage.shot.mix - dt * 1.6);
      if (passed(b, dt, 5)) this.say(LINES.commandAnyTimeNow, 3);
      const g = this.stage.gun!, there = Math.hypot(g.x - you.x, g.z - you.z) < GUN_REACH;
      if (!there && b.t < CRAWL_MAX) return;
      if (!there) this.say(LINES.commandFineWellMail, 2.5);
      this.stage.gun = null, this.stage.shot = null;
      // Over the wall: the squad from the nearest compound still held, coming in where they'd be seen.
      this.from = this.nearestHeld();
      if (this.from < 0) return this.end();
      const at = this.squadSpot(this.from);
      this.squad = game.reinforce(this.from, SQUAD, at.x, at.z);
      // Everything at once: another yard sends its squad in from the other side.
      const other = b.id === "onslaught" ? this.nearestHeld(this.from) : -1;
      if (other >= 0) {
        const to = this.squadSpot(other);
        this.squad.push(...game.reinforce(other, SQUAD, to.x, to.z));
      }
      this.scale = SLOW_CONTACT;
      this.cues.push("slow");
      if (there) this.say(other >= 0 ? LINES.contactOverWalls : LINES.contactOverWall, 2.5);
      b.phase = "contact", b.t = 0;
    } else if (b.phase === "contact") {
      if (b.t < CONTACT_SECONDS && this.squad.some((s) => s.alive)) return;
      const c = game.map.compounds[this.nearestHeld()], { spawn } = game.map, rally = game.waypoint();
      game.crate("health", spawn.x, spawn.z);
      // Already by HEAD, falling back isn't a choice: the crate's right there.
      const home = Math.hypot(spawn.x - you.x, spawn.z - you.z) < HOME;
      this.markers = home ? [] : [{ x: spawn.x, y: game.terrain.height(spawn.x, spawn.z), z: spawn.z, label: "fall back: HEAD", kind: "head" }];
      if (rally && rally.kind === "compound") this.markers.unshift({ ...rally, label: `rally: ${rally.label}` });
      this.say(home ? LINES.choiceHome.replace("{folder}", c?.folder ?? "the next one")
        : c ? LINES.choiceCall.replace("{folder}", c.folder) : LINES.choiceFallBack, 5);
      b.phase = "choice", b.t = 0;
    } else {
      this.scale = Math.min(1, this.scale + dt * 2);
      const back = this.markers.find((m) => m.kind === "head"), home = !!back && Math.hypot(back.x - you.x, back.z - you.z) < HOME;
      const rally = this.markers.find((m) => m.kind === "compound"), there = !!rally && Math.hypot(rally.x - you.x, rally.z - you.z) < HOME;
      if (home) this.say(LINES.commandPatchUpWell, 3);
      else if (there) this.say(LINES.commandBoldNoted, 2.5);
      if (home || there || b.t > 40) this.end(false);
    }
  }

  /** The nearest compound to you still held (not `but`), by index, or -1. */
  private nearestHeld(but = -1): number {
    const game = this.game, you = game.you();
    let best = -1, bestD = Infinity;
    game.map.compounds.forEach((c, i) => {
      const d = Math.hypot(c.x - you.x, c.z - you.z);
      if (!game.cleared[i] && i !== but && d < bestD) best = i, bestD = d;
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

  /* ---------------- jump ---------------- */

  private jump(b: { phase: Phase; t: number }, dt: number) {
    const game = this.game, you = game.you();
    const v = game.vehicles.find((o) => o.id === (this.car?.id ?? you.vehicle));
    if (!v) return this.end();
    const across = this.car ? { x: -this.car.dz, z: this.car.dx } : { x: 0, z: 0 };
    if (b.phase === "run") {
      const speed = Math.hypot(v.vx, v.vz);
      if (you.vehicle < 0 || b.t > 6) return this.end(false);
      if (speed < JUMP_SPEED) return;
      // Off the sandbox's lip: up it goes.
      this.car = { id: v.id, dx: v.vx / speed, dz: v.vz / speed };
      v.vy = JUMP_LAUNCH;
      this.bailed = false;
      this.scale = SLOW_JUMP;
      this.stage.prompt = "Shift · bail out";
      this.say(LINES.commandIsThatCar, 2.4);
      b.phase = "air", b.t = 0;
    } else if (b.phase === "air") {
      this.stage.shot = this.carShot(v, across, 1);
      if (!this.bailed && b.t < BAIL) return;
      // Out the side and into a dive-roll; the car doesn't know.
      v.driver = -1, you.vehicle = -1;
      Object.assign(you, { x: v.x + across.x * 1.8, y: v.y + 0.6, z: v.z + across.z * 1.8, vx: across.x * 5 + v.vx * 0.35, vy: 3, vz: across.z * 5 + v.vz * 0.35, grounded: false, roll: ROLL_TIME, rollCd: ROLL_TIME + 1.4, rollDir: { x: across.x, z: across.z } });
      this.stage.prompt = null;
      this.say(LINES.commandNobodyWasDriving, 2.8);
      b.phase = "carry", b.t = 0;
    } else {
      // The empty car carries on: held to its heading while the camera follows it off.
      if (b.t < 2.2) v.vx = this.car!.dx * 14, v.vz = this.car!.dz * 14;
      this.scale = Math.min(1, this.scale + dt * 0.7);
      this.stage.shot = this.carShot(v, across, Math.max(0, 1 - b.t / 2.5));
      if (b.t > 2.8) this.end(false);
    }
  }

  /** From the car's side, a little way off, looking at it. */
  private carShot(v: Vehicle, across: { x: number; z: number }, mix: number): Stage["shot"] {
    return { from: { x: v.x + across.x * 9, y: v.y + 1.6, z: v.z + across.z * 9 }, at: { x: v.x, y: v.y + 0.8, z: v.z }, mix };
  }

  /* ---------------- beach ---------------- */

  /** Open lawn ahead of you for the hovercraft to settle on, or null. */
  private beachSpot(): Point | null {
    const game = this.game, you = game.you(), { f } = axes(you.yaw);
    for (const turn of [0, 0.5, -0.5, 1, -1]) {
      const c = Math.cos(turn), s = Math.sin(turn), x = you.x + (f.x * c - f.z * s) * 24, z = you.z + (f.x * s + f.z * c) * 24, y = game.terrain.height(x, z);
      if (this.open(x, y, z) && Math.abs(y - you.y) < 3) return { x, y, z };
    }
    return null;
  }

  /** The hovercraft, sliding in on its cushion, skidding to a stop, and then slowly going flat. */
  private hovercraft(): Stage["craft"] {
    const c = this.craft;
    if (!c) return null;
    const k = 1 - (1 - Math.min(1, c.t / 3.2)) ** 3, off = (1 - k) * 45, x = c.to.x - c.dx * off, z = c.to.z - c.dz * off;
    const deflate = Math.min(1, Math.max(0, (c.t - 4) / 9));
    return { x, y: this.game.terrain.height(x, z) + 0.7 * (1 - deflate), z, yaw: c.yaw + Math.sin(c.t * 5) * 0.25 * (1 - k), roll: Math.sin(c.t * 7) * 0.18 * (1 - k), deflate };
  }

  private beach(b: { phase: Phase; t: number }, dt: number) {
    const game = this.game, you = game.you(), c = this.craft;
    if (!c) return this.end();
    const h = this.hovercraft()!, to = norm(you.x - c.to.x, you.z - c.to.z);
    this.stage.shot = { from: { x: c.to.x + to.x * 11, y: c.to.y + 1.8, z: c.to.z + to.z * 11 }, at: { x: h.x, y: h.y + 0.8, z: h.z }, mix: Math.min(1, Math.max(0, 6.5 - b.t)) };
    if (b.t > 3.2) this.scale = Math.min(1, this.scale + dt * 0.8);
    if (passed(b, dt, 4.2)) this.say(LINES.commandItsLosingAir, 2.4);
    if (b.t > 6.5) this.end(false);
  }

  /* ---------------- stall ---------------- */

  private stall(b: { phase: Phase; t: number }, dt: number) {
    const game = this.game, you = game.you(), v = game.vehicles.find((o) => o.id === (this.car?.id ?? you.vehicle));
    if (!v) return this.end();
    this.car ??= { id: v.id, dx: 0, dz: 0 };
    const { f, side } = axes(v.yaw);
    this.stage.shot = this.carShot(v, side, b.phase === "off" ? Math.max(0, 1 - b.t / 0.8) : 1);
    if (b.phase === "stall") {
      if (v.y > game.terrain.height(v.x, v.z) + 0.2) return;
      b.phase = "slide", b.t = 0;
      this.stage.prompt = "F · step off";
      this.say(LINES.commandWellThatsOne, 2.6);
    } else if (b.phase === "slide") {
      // Rolling back down the way it came, at a walking pace.
      v.vx = -f.x * SLIDE_BACK, v.vz = -f.z * SLIDE_BACK;
      if (you.vehicle >= 0 && b.t < 4) return;
      if (you.vehicle >= 0) this.eject(v, side);
      this.stage.prompt = null;
      this.say(LINES.commandWalkItOff, 2.6);
      b.phase = "off", b.t = 0;
    } else {
      this.scale = Math.min(1, this.scale + dt * 2);
      if (b.t > 1) this.end(false);
    }
  }

  /** Out of a car onto your feet, beside it. */
  private eject(v: Vehicle, side: { x: number; z: number }) {
    const you = this.game.you();
    v.driver = -1, you.vehicle = -1;
    Object.assign(you, { x: v.x + side.x * 2.2, y: v.y + 0.6, z: v.z + side.z * 2.2, vx: 0, vy: 0, vz: 0, grounded: false });
  }

  /* ---------------- extraction ---------------- */

  private extraction(b: { phase: Phase; t: number }, dt: number) {
    const game = this.game, you = game.you(), g = this.last;
    if (b.phase === "last") {
      // The last guard of the last yard, in slow motion until it falls.
      if (!g) return this.end();
      const to = norm(g.x - you.x, g.z - you.z), across = { x: -to.z, z: to.x };
      const near = Math.hypot(g.x - you.x, g.z - you.z) < LAST_NEAR;
      this.scale = near ? SLOW_LAST : 1;
      this.stage.shot = { from: { x: g.x + across.x * 3.5 - to.x * 1.5, y: g.y + 1.3, z: g.z + across.z * 3.5 - to.z * 1.5 }, at: { x: g.x, y: g.y + 1, z: g.z }, mix: near ? 0.9 : 0 };
      if (game.status !== "won") return;
      // The repo is merged. Let the guard fall, then the helicopter comes for you.
      this.wonAt ??= b.t;
      if (b.t - this.wonAt < 1.4) return;
      this.take("extraction");
      this.rescue = { x: you.x, y: game.terrain.height(you.x, you.z), z: you.z, yaw: you.yaw };
      this.scale = 1;
      this.say(LINES.pilotTaxiForOne, 2.6);
      b.phase = "lift", b.t = 0;
    } else {
      const r = this.rescue!, h = this.rescueHeli(b.t)!, { side } = axes(r.yaw);
      // Up the ladder, then off with the helicopter.
      const climb = Math.min(1, Math.max(0, (b.t - 3.2) / 2.4));
      Object.assign(you, b.t < 3.2 ? { x: r.x, y: r.y, z: r.z } : { x: h.x, y: climb < 1 ? r.y + climb * LADDER : h.y - 0.5, z: h.z }, { vx: 0, vy: 0, vz: 0, grounded: climb <= 0 });
      this.stage.shot = { from: { x: r.x + side.x * 15, y: r.y + 4, z: r.z + side.z * 15 }, at: { x: h.x, y: Math.max(r.y + 3, (h.y + r.y) / 2), z: h.z }, mix: 1 };
      this.stage.ladder = { x: h.x, y: h.y - 0.5, z: h.z, len: LADDER };
      if (passed(b, dt, 5.6)) this.say(LINES.pilotEverybodyInGood, 2.6);
      if (b.t > 9) this.end(false), this.rescue = null;
    }
  }

  /** The rescue helicopter: in from behind to hover over where you stand, then away with you on the ladder. */
  private rescueHeli(t: number): Stage["heli"] {
    const r = this.rescue;
    if (!r) return null;
    const { f } = axes(r.yaw), k = 1 - (1 - Math.min(1, t / 3.2)) ** 3, back = (1 - k) * 60, away = Math.max(0, t - 5.6);
    const x = r.x - f.x * back + f.x * (away * 3 + away * away * 4), z = r.z - f.z * back + f.z * (away * 3 + away * away * 4);
    return { x, y: r.y + LADDER + 0.5 + (1 - k) * 14 + away * away * 1.2, z, yaw: r.yaw, roll: Math.sin(t * 2) * 0.04 };
  }

  /* ---------------- gag ---------------- */

  private gag(b: { phase: Phase; t: number }, dt: number) {
    const you = this.game.you(), { side } = axes(you.yaw);
    // A low turn round the soldier for three seconds, time easing back up in the last of it.
    const a = b.t * 0.6;
    this.stage.shot = { from: { x: you.x + side.x * Math.cos(a) * 3.5 - side.z * Math.sin(a) * 3.5, y: you.y + 1.1, z: you.z + side.z * Math.cos(a) * 3.5 + side.x * Math.sin(a) * 3.5 }, at: { x: you.x, y: you.y + 1.2, z: you.z }, mix: Math.min(0.9, Math.max(0, GAG - b.t)) };
    this.scale = b.t < GAG - 1 ? 0.45 : Math.min(1, this.scale + dt * 1.5);
    if (b.t >= GAG) this.end(false);
  }

  /** How far the letterbox bars are in for a phase. */
  private barsFor(phase: Phase | undefined): number {
    if (!phase || phase === "choice" || phase === "contact" || phase === "run" || phase === "off") return 0;
    return phase === "crawl" ? 0.35 : 1;
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
    this.beat = null, this.scale = 1, this.markers = [], this.squad = [], this.car = null, this.last = null, this.wonAt = null;
    Object.assign(this.stage, { title: null, prompt: null, shot: null, gun: null, ladder: null });
    if (cut) this.line = null;
  }

  private say(text: string, seconds: number) {
    this.line = { text, left: seconds };
  }
}

/** A chapter's own number for picking its narrator line: the same chapter always gets the same one. */
const chapterIndex = (c: Chapter | undefined) => [...(c?.level ?? "")].reduce((n, ch) => n + ch.charCodeAt(0), 0);

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
