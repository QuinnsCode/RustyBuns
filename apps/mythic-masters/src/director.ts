// The director: the journey's cheesy scenes, played in the game itself rather than as films. The tone is found footage
// played dead straight with a lot of nonsense in it: you and Gary were taken up by a saucer, nobody believed you the
// first time, and it put you back down in the pines with a cursed totem that wants every creature in the compendium.
// You film all of it. Nobody will believe this either.
//
//   abduction  the first steps of a new journey: on tape, the saucer hovers over Batsto, its beam lowers you and the
//              line-up into the pines, and it leaves in a hurry. Any key skips it.
//   sweep      the first time you stand in a region: a slow, sweeping shot round you and a narrator's line.
//   trail      each section of a trail you walk into: the camcorder's red light comes on and someone says something.
//   standoff   a keeper or a mythic: the fight waits while the camera circles it and its name slams in.
//   freeze     a keeper or a mythic goes down, or is bound, or the whole line-up falls: freeze frame, a slow turn,
//              a line over it, then the result.
//   gag        a three-second line on an event: a ring-out, the ink running dry, the last of the line-up stepping up.
//
// No three.js and no DOM: main.ts draws the stage, the tests play it. The clock is the page's (real seconds).
import { cheese, clamp, sweepShot, type SweepShot, type Vec3 } from "@rustybuns/util";

export type BeatId = "abduction" | "sweep" | "trail" | "standoff" | "freeze" | "gag";

/** What the page draws for a scene; zero and null are nothing. */
export interface Stage {
  /** 0..1: letterbox bars in. */
  bars: number;
  /** 0..1: on tape: the camcorder's grain, REC light and timecode. */
  tape: number;
  /** 0..1: a freeze frame, gone sepia. */
  freeze: number;
  /** Who is talking, and what they say. */
  caption: { who: string; text: string } | null;
  /** A name slammed across the screen. */
  title: { text: string; sub: string } | null;
  /** The tape's label, and the timecode running under it. */
  label: string;
  timecode: string;
  /** A camera the scene holds, and how much of the view it has (0: yours). */
  shot: SweepShot | null;
  /** The saucer, and how bright its beam is (0..1). */
  saucer: (Vec3 & { beam: number }) | null;
}

/** One scene: how long it runs, what it holds, and what is said when. */
export interface Scene {
  id: BeatId;
  seconds: number;
  /** Any key cuts to the end. */
  skip: boolean;
  /** Your input waits, and in a fight so does the sim. */
  hold: boolean;
  bars: number;
  tape: number;
  freeze: number;
  lines: [at: number, line: string][];
  title?: [from: number, to: number, { text: string; sub: string }];
  label?: string;
  shot?: (t: number) => SweepShot | null;
  saucer?: (t: number) => (Vec3 & { beam: number }) | null;
}

const smooth = (u: number) => { const t = clamp(u, 0, 1); return t * t * (3 - 2 * t); };
const mix = (a: Vec3, b: Vec3, k: number): Vec3 => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k });
/** Seconds the bars and the tape take to come in and go. */
export const FADE = 0.4;

// --- the scenes --------------------------------------------------------------------------------------------------

/** How long the abduction runs, and how high the saucer hovers over you. */
export const ABDUCTION = 15, HOVER = 26;
const ABDUCTED: [number, string][] = [
  [0.3, "You: Is it recording? The red light's on. Okay. It's recording."],
  [3.2, "You: They took us up. Me and Gary. Nobody believed us the first time either."],
  [6.6, "Gary: From up there it looked... round. Do not put that on the tape."],
  [9.6, "You: They put us back in the pines. With a totem. It hums."],
  [12.2, "Totem: Fill me."],
  [13.6, "Gary: Did the stick just talk?"],
];
/** Tape 1: the saucer brings you in. `at` is where you stand. */
export function abduction(at: Vec3): Scene {
  const hover = { x: at.x, y: at.y + HOVER, z: at.z }, far = { x: at.x + 160, y: at.y + 90, z: at.z - 120 }, gone = { x: at.x - 40, y: at.y + 260, z: at.z + 30 };
  const saucerAt = (t: number) => t < 3.5 ? mix(far, hover, smooth(t / 3.5)) : t < 12.6 ? { ...hover, y: hover.y + Math.sin(t * 1.3) * 0.6 } : mix(hover, gone, smooth((t - 12.6) / 1.2));
  // Handheld, a few metres off, looking up the beam at the saucer, then down at what it left.
  const eye = { x: at.x + 11, y: at.y + 3, z: at.z + 14 };
  return {
    id: "abduction", seconds: ABDUCTION, skip: true, hold: true, bars: 0, tape: 1, freeze: 0, lines: ABDUCTED, label: "TAPE 1 · PINE BARRENS",
    title: [9.4, 12, { text: "Mythic Masters", sub: "Nobody will believe this either" }],
    saucer: (t) => ({ ...saucerAt(t), beam: t < 3.5 ? 0 : t < 11.5 ? smooth((t - 3.5) / 1) : 1 - smooth((t - 11.5) / 0.6) }),
    shot: (t) => ({ from: eye, at: mix(saucerAt(t), { x: at.x, y: at.y + 1, z: at.z }, smooth((t - 8) / 2.5)), mix: 1 - smooth((t - 13.8) / 1.2) }),
  };
}

/** The first time in a region: a slow sweep round you, and a narrator's line. */
export function sweep(n: number, at: Vec3): Scene {
  return {
    id: "sweep", seconds: 7, skip: true, hold: true, bars: 1, tape: 0, freeze: 0, lines: [[0.6, `Narrator: ${cheese("mythic", n - 1)}`]],
    shot: (t) => sweepShot(t, at, { radius: 26, height: 10, seconds: 7, turn: 1.2, start: n }),
  };
}

const PINE_TALK = [
  "You: Day one. The trail is marked. That's a good sign.",
  "Gary: The river is the colour of tea. I am not drinking the tea.",
  "You: We have passed this tree before. Gary says we haven't. Gary marked it. It's marked.",
  "Gary: Something in the lake waved. I waved back. Was that rude?",
  "You: High ground. If anyone's watching, wave. ...Nobody's waving.",
  "Gary: The trees are waist-high. Which makes the thing behind them very tall.",
  "You: Cranberries. Floating. In a bog. Normal. Everything is normal.",
  "Gary: It's cold in here. It's August. Why is it cold.",
  "You: Bottomless, they said. Gary dropped a pebble in. We're still listening.",
  "Gary: A hat. Up a tree. Somebody is messing with us.",
  "You: Hoofprints. On the roofs. Every roof.",
  "Totem: Almost.",
];
const TRAIL_TALK = [
  "You: New trail. New stones. Same camcorder. Same Gary.",
  "Gary: I've got a bad feeling about this one. I had one about the last one too. I was right.",
  "You: We have passed this rock before. We have definitely passed this rock.",
  "Gary: Something's following us. It stops when we stop. Very polite.",
  "You: Battery's on two bars. Morale's on one.",
  "Gary: There are little stick people hanging in the trees. Handmade. Nice work, honestly.",
  "You: If you're watching this, we're fine. Tell my mum the Earth is... complicated.",
  "Gary: The totem's humming again. It hums when it's hungry.",
  "You: Halfway. Not that anyone back home will believe it.",
  "Gary: I can hear breathing. It's me. Okay. It's me.",
  "You: Last stretch. We're going to be heroes. Or a documentary.",
  "Totem: Almost.",
];
/** Walking into section k of a region's trail: the red light, a line, no hold. */
export function trail(region: string, k: number): Scene {
  const talk = region === "pine-barrens" ? PINE_TALK : TRAIL_TALK;
  return { id: "trail", seconds: 4.5, skip: false, hold: false, bars: 0, tape: 1, freeze: 0, lines: [[0.2, talk[k % talk.length]!]], label: `TAPE ${k + 2} · DAY ${Math.floor(k / 3) + 1}` };
}

const KEEPER_SAYS = [
  "Narrator: It has guarded this stone for a hundred years. It has never once been filmed.",
  "Narrator: It does not want to be in your documentary.",
  "Narrator: It was here first. It would like that on the record.",
  "Narrator: Legend says it has never lost. Legend has been wrong before.",
  "Gary: Is that one of the friendly ones? ...None of them are the friendly ones, are they.",
];
/** A keeper (k is its section) or a mythic: the fight waits while the camera circles `at` and the name slams in. */
export function standoff(mythic: boolean, name: string, sub: string, at: Vec3, height: number, k: number): Scene {
  const seconds = mythic ? 5 : 3.8;
  return {
    id: "standoff", seconds, skip: true, hold: true, bars: 1, tape: 0, freeze: 0,
    lines: [[0.5, mythic ? "You: Keep rolling. Keep rolling. KEEP ROLLING." : KEEPER_SAYS[k % KEEPER_SAYS.length]!]],
    title: [0.25, seconds - 0.5, { text: name, sub }],
    shot: (t) => sweepShot(t, at, { radius: 4 + height * 1.6, height: 1 + height * 0.5, seconds, turn: mythic ? 1.4 : 0.9, start: k }),
  };
}

const WON_SAYS = [
  "Narrator: And that was the last anyone saw of it. For about four minutes.",
  "You: Did you get that? Tell me you got that.",
  "Gary: Nobody is going to believe this. I barely believe this.",
];
/** The fight's last moment held still: won (by `k`, the section), bound by the totem, or the whole line-up down. */
export function freeze(how: "won" | "bound" | "lost", at: Vec3, k: number): Scene {
  const line = how === "bound" ? "Totem: Mine." : how === "lost" ? "You: Yep. That's me. You're probably wondering how I got here." : WON_SAYS[k % WON_SAYS.length]!;
  return {
    id: "freeze", seconds: 3.2, skip: true, hold: true, bars: 1, tape: 0, freeze: 1, lines: [[0.15, line]],
    shot: (t) => sweepShot(t, at, { radius: 7, height: 2.5, seconds: 3.2, turn: 0.35, start: k * 0.7 }),
  };
}

/** The one-liners, each once a session. */
export const GAGS = {
  ringOut: "Narrator: The ring has an edge. Nobody told it about the edge.",
  inkSpent: "Gary: The ink's gone. Do we have a pen? ...It's a regular pen. It won't work. Try it anyway.",
  inkMissed: "Totem: Not like that.",
  lastUp: "You: Last one. Make it look good. For the tape.",
  nameless: "Gary: It's got no name. Why has it got no name.",
  hurt: "You: It's fine. It's fine. Is it fine?",
} as const;
export type Gag = keyof typeof GAGS;
export function gag(g: Gag): Scene {
  return { id: "gag", seconds: 3, skip: false, hold: false, bars: 0, tape: g === "hurt" || g === "lastUp" ? 1 : 0, freeze: 0, lines: [[0, GAGS[g]]], label: "TAPE ?" };
}

// --- the director ------------------------------------------------------------------------------------------------

const QUIET: Stage = { bars: 0, tape: 0, freeze: 0, caption: null, title: null, label: "", timecode: "", shot: null, saucer: null };

/** A hand on the camera: a slow wander, the same for the same clock. */
const wobble = (t: number, s: number) => Math.sin(t * 1.7 + s) * 0.6 + Math.sin(t * 3.1 + s * 2) * 0.3 + Math.sin(t * 7.3 + s * 3) * 0.1;

export class Director {
  stage: Stage = { ...QUIET };
  private now: { s: Scene; t: number } | null = null;
  private next: Scene | null = null;
  private clock = 0;
  private told = new Set<Gag>();
  private eased = { bars: 0, tape: 0, freeze: 0 };
  private label = "";

  /** The scene playing, and seconds into it. */
  get beat(): { id: BeatId; t: number } | null { return this.now && { id: this.now.s.id, t: this.now.t }; }
  /** Your input waits (and in a fight, the sim). */
  get holding(): boolean { return !!this.now?.s.hold; }
  /** A scene a key can cut short is playing. */
  get skippable(): boolean { return !!this.now?.s.skip; }

  /**
   * Plays a scene. A held scene (the ones with a camera) waits behind the one playing, unless it's a lesser one
   * (a gag, a line on the trail), which it cuts off; anything else is dropped when the director is busy.
   */
  play(s: Scene): boolean {
    if (!this.now || (s.hold && !this.now.s.hold)) { this.now = { s, t: 0 }; this.stage.caption = null; return true; }
    if (s.hold && !this.next) { this.next = s; return true; }
    return false;
  }
  /** A gag, the first time only. */
  gag(g: Gag): boolean {
    if (this.told.has(g)) return false;
    if (!this.play(gag(g))) return false;
    this.told.add(g);
    return true;
  }
  /** Cuts whatever is playing (and what waits) without a word: leaving the fight or the world. */
  cut() { this.now = this.next = null; this.eased = { bars: 0, tape: 0, freeze: 0 }; this.stage = { ...QUIET }; }

  /** dt real seconds on; `skip` is a key pressed this frame. */
  step(dt: number, skip = false) {
    this.clock += dt;
    if (this.now) {
      const s = this.now.s;
      if (skip && s.skip && this.now.t < s.seconds - FADE) this.now.t = s.seconds - FADE;
      this.now.t += dt;
      if (this.now.t >= s.seconds) { this.now = this.next ? { s: this.next, t: 0 } : null; this.next = null; }
    }
    const cur = this.now, s = cur?.s, t = cur?.t ?? 0;
    // In and out over FADE, gone by the scene's end; a freeze frame cuts in, it doesn't fade.
    const out = s ? smooth((s.seconds - t) / FADE) : 0;
    const ease = (k: "bars" | "tape" | "freeze") => {
      const want = (s?.[k] ?? 0) * out;
      this.eased[k] = k === "freeze" && want > this.eased[k] ? want : this.eased[k] + clamp(want - this.eased[k], -dt / FADE, dt / FADE);
      return this.eased[k];
    };
    const bars = ease("bars"), tape = ease("tape"), frozen = ease("freeze");
    if (s?.label) this.label = s.label;
    const said = s?.lines.filter(([at]) => at <= t).at(-1)?.[1];
    const colon = said?.indexOf(": ") ?? -1;
    let shot = s?.shot?.(t) ?? null;
    // On tape the camera is in somebody's hands.
    if (shot && tape > 0) {
      const c = this.clock, k = 0.15 * tape;
      shot = { ...shot, from: { x: shot.from.x + wobble(c, 1) * k, y: shot.from.y + wobble(c, 2) * k, z: shot.from.z + wobble(c, 3) * k },
        at: { x: shot.at.x + wobble(c, 4) * k * 2, y: shot.at.y + wobble(c, 5) * k * 2, z: shot.at.z + wobble(c, 6) * k * 2 } };
    }
    const title = s?.title && t >= s.title[0] && t < s.title[1] ? s.title[2] : null;
    const tc = Math.floor(this.clock * 30), ff = tc % 30, ss = Math.floor(tc / 30) % 60, mm = Math.floor(tc / 1800) % 60;
    this.stage = {
      bars, tape, freeze: frozen, title, shot, saucer: s?.saucer?.(t) ?? null,
      caption: said ? (colon > 0 ? { who: said.slice(0, colon), text: said.slice(colon + 2) } : { who: "", text: said }) : null,
      label: this.label, timecode: `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}:${String(ff).padStart(2, "0")}`,
    };
  }
}
