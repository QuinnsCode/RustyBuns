// The director: the journey's cheesy scenes, played in the game itself rather than as films. The tone is found footage
// played dead straight with a lot of nonsense in it: you and Gary were taken up by a saucer, nobody believed you the
// first time, and it put you back down in the pines with a cursed totem that wants every creature in the compendium.
// You film all of it. Nobody will believe this either.
//
//   abduction  the first steps of a new journey: on tape, the saucer hovers over Batsto, its beam lowers you and the
//              line-up into the pines, and it leaves in a hurry. Any key skips it.
//   arrival    the first time you stand in a region: the camera slides past you, parallel to the horizon, the region's
//              high ground behind you (parallax), then whips round and cranes up over your shoulder to reveal it.
//   lookout    a landmark you see for the first time: a push toward it, a white flash, then a slow-motion full turn
//              round where you stand, the whole place in view.
//   trail      each section of a trail you walk into: the camcorder's red light comes on and someone says something.
//   standoff   a keeper, a mythic or a new wild thing: the fight waits while the camera circles it, a case file types
//              in as loud as everything you know, and its name slams in (src/casefile.ts). One you don't know yet
//              is drowned out: you try to show it, and all the tape gets is noise.
//   freeze     a keeper or a mythic goes down, or is bound, or the whole line-up falls: an impact flash, a freeze
//              frame, the vertigo (the camera backs off as the lens narrows), speed lines, a line over it, the result.
//   found      a tape found in the world: it plays where you stand, the camera slow round the stump, a few lines.
//   gag        a three-second line on an event: a ring-out, the ink running dry, the last of the line-up stepping up.
//   faceoff    every fight's start: the two fighters' cards slide in from either edge and meet at the middle, VS
//              between them, while the camera spirals down over the arena; the cards slide off as the bars slide in.
//
// The cameras are reels (@rustybuns/util reel.ts): takes of truck, orbit, crane and dolly-zoom shots joined by cuts,
// blends, whips, dips and flashes. A new scene is a few takes; SCENES at the bottom names each one so a page, an
// agent (mm_scene) or a test can play it anywhere, and Director.seek and .paused hold any frame for a screenshot.
//
// No three.js and no DOM: main.ts draws the stage, the tests play it. The clock is the page's (real seconds).
import { cheese, clamp, crane, dollyZoom, follow, inOut, orbit, reel, smoothstep as smooth, spiralShot, sweepShot, truck, type Reel, type SweepShot, type Vec3 } from "@rustybuns/util";

export type BeatId = "abduction" | "arrival" | "lookout" | "trail" | "standoff" | "freeze" | "found" | "gag" | "faceoff";

/** A camera the page puts over its own: a lens (vertical degrees, null: the page's) and a tilt (radians) as well. */
export type StageShot = SweepShot & { fov?: number | null; roll?: number };
/** The look of a moment between shots: black and white over the view, a whip's blur, time's speed and speed lines. */
export interface Look { dip: number; flash: number; whip: number; slow: number; speed: number }

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
  shot: StageShot | null;
  /** 0..1: black over the view (a dip), white (a flash), a whip pan's blur, and anime speed lines. */
  dip: number;
  flash: number;
  whip: number;
  speed: number;
  /** How fast time runs for what the page lets a scene slow (the world, the fight): 1 normal, 0.3 slow motion. */
  slow: number;
  /** The saucer, and how bright its beam is (0..1). */
  saucer: (Vec3 & { beam: number }) | null;
  /** A case file on screen (src/casefile.ts). */
  file: Dossier | null;
  /** 0..1: what you hear is drowned out, because you don't know what that is yet. */
  muffle: number;
  /** The two fighters' cards at a fight's start, `in` 0 (off the edges) to 1 (met at the middle), `vs` the badge between. */
  versus: { a: VsCard; b: VsCard; in: number; vs: number } | null;
  /** 0..1: how far the fight HUD has slid in. Out while a scene holds the fight, in when it lets go. */
  hud: number;
}

/** A fighter's card in a faceoff. */
export interface VsCard { name: string; sub: string; art: string | null; tier: string }

/** A case file as far as it has typed in. */
export interface Dossier {
  /** 0..4: how loud (src/casefile.ts LEVELS). */
  level: number;
  /** "MM-0413 // CASE FILE". */
  head: string;
  /** The rows typed so far; the last may be half typed. */
  rows: string[];
  /** The stamps landed so far, in order. */
  stamps: string[];
  /** 0..1 across the screen while an anomaly scan sweeps, -1 when none. */
  scan: number;
  /** 0..1: how much the file has stopped behaving. */
  glitch: number;
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
  /** The title's text as it changes (a name coming out from under its bars). */
  titleAt?: (t: number) => string;
  label?: string;
  shot?: (t: number) => StageShot | null;
  /** A camera of takes (its camera wins over `shot`, its look joins `look`). */
  reel?: Reel;
  /** Dips, flashes and the rest, over the scene's own clock. */
  look?: (t: number) => Partial<Look>;
  saucer?: (t: number) => (Vec3 & { beam: number }) | null;
  file?: (t: number) => Dossier | null;
  muffle?: number | ((t: number) => number);
  versus?: (t: number) => Stage["versus"];
  /** A held scene lets the HUD slide back in from this second (by default only once it ends). */
  hudAt?: number;
}

const mix = (a: Vec3, b: Vec3, k: number): Vec3 => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k });
/** Seconds the bars and the tape take to come in and go. */
export const FADE = 0.4;
/** Seconds the fight HUD takes to slide off or back. */
export const HUD_SLIDE = 0.45;

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

/**
 * The first time in region n: the parallax slide past you with `view` (the land worth a look, `vista` in
 * @rustybuns/util) far behind, a whip round, and the crane up over your shoulder to reveal it. A narrator's line.
 */
export function arrival(n: number, at: Vec3, view: Vec3): Scene {
  const r = reel([
    { seconds: 3.4, shot: truck(at, view, { side: n % 2 ? 1 : -1, back: 6.5, travel: 10, height: 1.3 }) },
    { seconds: 4.4, shot: crane(at, view, { height: [1.6, 7], back: [2.4, 10] }), into: { whip: 0.45 } },
  ], { handBack: 1 });
  return { id: "arrival", seconds: r.seconds, skip: true, hold: true, bars: 1, tape: 0, freeze: 0, lines: [[0.6, `Narrator: ${cheese("mythic", n - 1)}`]], reel: r };
}

const LOOKOUT = [
  "Narrator: {name}. It was here before the trail. It will be here after the tape runs out.",
  "You: Gary. Gary, look. {name}. Get it in the shot.",
  "Gary: {name}. I'm putting it on the map. In pen.",
  "Narrator: From up here, {name}. From down there, nobody believed it.",
];
/** A landmark seen the first time: a push toward it at `view`, a white flash, then a slow-motion turn round you at `at`. */
export function lookout(name: string, at: Vec3, view: Vec3, k = 0): Scene {
  const toward = Math.atan2(view.x - at.x, view.z - at.z) + Math.PI; // behind you, looking at the landmark past you
  const r = reel([
    { seconds: 1.6, shot: truck(at, view, { back: 5, travel: 3, keep: 0.6, side: k % 2 ? 1 : -1, lens: 30 }) },
    { seconds: 5.6, shot: orbit(at, { radius: 5.5, height: 1.3, rise: 2.2, start: toward, lens: 46 }), into: { flash: 0.36 }, slow: 0.3 },
  ], { handIn: 0.5, handBack: 0.9 });
  return { id: "lookout", seconds: r.seconds, skip: true, hold: true, bars: 1, tape: 0, freeze: 0, reel: r,
    lines: [[0.3, LOOKOUT[k % LOOKOUT.length]!.replaceAll("{name}", name)]] };
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

const WON_SAYS = [
  "Narrator: And that was the last anyone saw of it. For about four minutes.",
  "You: Did you get that? Tell me you got that.",
  "Gary: Nobody is going to believe this. I barely believe this.",
];
/** The fight's last moment held still: won (by `k`, the section), bound by the totem, or the whole line-up down. */
export function freeze(how: "won" | "bound" | "lost", at: Vec3, k: number): Scene {
  const line = how === "bound" ? "Totem: Mine." : how === "lost" ? "You: Yep. That's me. You're probably wondering how I got here." : WON_SAYS[k % WON_SAYS.length]!;
  // The impact: a flash and the frame freezes; then the vertigo, speed lines on a win or a bind.
  const r = reel([{ seconds: 3.2, shot: dollyZoom(at, { toward: k * 0.7, near: 4.5, far: 12, height: 2, lens: 58 }), speed: how === "lost" ? 0 : 0.75 }], { handBack: 0.6 });
  return { id: "freeze", seconds: r.seconds, skip: true, hold: true, bars: 1, tape: 0, freeze: 1, lines: [[0.15, line]], reel: r, look: (t) => ({ flash: 1 - smooth(t / 0.25) }) };
}

/** Seconds each line of a found tape holds. */
const TAPE_LINE = 3.8;
/** A found tape (src/world/poi.ts) plays where it lies: `lines` ("Who: what") one after the other, the camera slow round `at`. Any key skips. */
export function found(title: string, lines: readonly string[], at: Vec3, k: number): Scene {
  const seconds = 0.6 + TAPE_LINE * lines.length + 0.6;
  return {
    id: "found", seconds, skip: true, hold: true, bars: 1, tape: 1, freeze: 0,
    lines: lines.map((l, i): [number, string] => [0.6 + i * TAPE_LINE, l]),
    label: `FOUND TAPE · ${title.toUpperCase()}`,
    shot: (t) => sweepShot(t, at, { radius: 6, height: 2.4, seconds, turn: 0.4, start: k * 0.9 }),
    // The tape starts: up out of black.
    look: (t) => ({ dip: 1 - smooth(t / 0.7) }),
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

/** How long a faceoff runs. */
export const FACEOFF = 3.4;
/** A fight's start: `a` and `b` slide in to meet, and the camera spirals down onto `at` (between them). */
export function faceoff(a: VsCard, b: VsCard, at: Vec3, k = 0): Scene {
  const cards = (t: number) => inOut(t, { inAt: 0.1, inFor: 0.5, outAt: 2.3, outFor: 0.45 });
  const vs = (t: number) => inOut(t, { inAt: 0.5, inFor: 0.25, outAt: 2.2, outFor: 0.3 });
  return {
    id: "faceoff", seconds: FACEOFF, skip: true, hold: true, bars: 1, tape: 0, freeze: 0, lines: [], hudAt: 2.5,
    versus: (t) => ({ a, b, in: cards(t), vs: vs(t) }),
    // In from white, and speed lines while VS slams.
    look: (t) => ({ flash: 1 - smooth(t / 0.3), speed: 0.8 * vs(t) }),
    shot: (t) => spiralShot(t, at, { seconds: FACEOFF, from: [38, 22], to: [11, 3.5], turns: 0.85, start: k * 1.3, handBack: 0.7 }),
  };
}

// --- the director ------------------------------------------------------------------------------------------------

const QUIET: Stage = { bars: 0, tape: 0, freeze: 0, caption: null, title: null, label: "", timecode: "", shot: null, saucer: null, file: null, muffle: 0, versus: null, hud: 1,
  dip: 0, flash: 0, whip: 0, speed: 0, slow: 1 };

/** A hand on the camera: a slow wander, the same for the same clock. */
const wobble = (t: number, s: number) => Math.sin(t * 1.7 + s) * 0.6 + Math.sin(t * 3.1 + s * 2) * 0.3 + Math.sin(t * 7.3 + s * 3) * 0.1;

export class Director {
  stage: Stage = { ...QUIET };
  private now: { s: Scene; t: number } | null = null;
  private next: Scene | null = null;
  private clock = 0;
  private told = new Set<Gag>();
  private eased = { bars: 0, tape: 0, freeze: 0, hud: 1, slow: 1 };
  /** Holds the scene where it is (for a screenshot): nothing moves until it's let go. */
  paused = false;
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
  cut() { this.now = this.next = null; this.eased = { bars: 0, tape: 0, freeze: 0, hud: 1, slow: 1 }; this.stage = { ...QUIET }; }
  /** Jumps the scene playing to second `t` (the bars and the tape snap to it): to look at one moment. */
  seek(t: number): boolean {
    const s = this.now?.s;
    if (!s) return false;
    this.now!.t = clamp(t, 0, s.seconds - 1e-3);
    this.eased = { ...this.eased, bars: s.bars, tape: s.tape, freeze: s.freeze, hud: s.hold ? 0 : 1 };
    this.step(0);
    return true;
  }

  /** dt real seconds on; `skip` is a key pressed this frame. */
  step(dt: number, skip = false) {
    if (this.paused) dt = 0;
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
    const hud = this.eased.hud = follow(this.eased.hud, !s?.hold || (s.hudAt !== undefined && t >= s.hudAt) ? 1 : 0, 1 / HUD_SLIDE, dt);
    if (s?.label) this.label = s.label;
    const said = s?.lines.filter(([at]) => at <= t).at(-1)?.[1];
    const colon = said?.indexOf(": ") ?? -1;
    const fr = s?.reel?.at(t), lk = s?.look?.(t) ?? {};
    let shot: StageShot | null = fr ? { from: fr.from, at: fr.at, mix: fr.mix, fov: fr.fov, roll: fr.roll } : s?.shot?.(t) ?? null;
    const slow = this.eased.slow = follow(this.eased.slow, Math.min(fr?.slow ?? 1, lk.slow ?? 1), 3, dt || 1);
    // On tape the camera is in somebody's hands.
    if (shot && tape > 0) {
      const c = this.clock, k = 0.15 * tape;
      shot = { ...shot, from: { x: shot.from.x + wobble(c, 1) * k, y: shot.from.y + wobble(c, 2) * k, z: shot.from.z + wobble(c, 3) * k },
        at: { x: shot.at.x + wobble(c, 4) * k * 2, y: shot.at.y + wobble(c, 5) * k * 2, z: shot.at.z + wobble(c, 6) * k * 2 } };
    }
    const shown = s?.title && t >= s.title[0] && t < s.title[1] ? s.title[2] : null;
    const title = shown && s?.titleAt ? { ...shown, text: s.titleAt(t) } : shown;
    const tc = Math.floor(this.clock * 30), ff = tc % 30, ss = Math.floor(tc / 30) % 60, mm = Math.floor(tc / 1800) % 60;
    this.stage = {
      bars, tape, freeze: frozen, title, shot, saucer: s?.saucer?.(t) ?? null, file: s?.file?.(t) ?? null, muffle: (typeof s?.muffle === "function" ? s.muffle(t) : s?.muffle ?? 0) * out,
      caption: said ? (colon > 0 ? { who: said.slice(0, colon), text: said.slice(colon + 2) } : { who: "", text: said }) : null,
      versus: s?.versus?.(t) ?? null, hud: smooth(hud),
      dip: Math.max(fr?.dip ?? 0, lk.dip ?? 0), flash: Math.max(fr?.flash ?? 0, lk.flash ?? 0), whip: Math.max(fr?.whip ?? 0, lk.whip ?? 0),
      speed: Math.max(fr?.speed ?? 0, lk.speed ?? 0) * out, slow: s ? slow : 1,
      label: this.label, timecode: `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}:${String(ff).padStart(2, "0")}`,
    };
  }
}

// --- every scene by name -----------------------------------------------------------------------------------------

/** Where a scene is played from a name: where you stand, the land worth a look, the region's number, a variant, a place's name. */
export interface Where { at: Vec3; view: Vec3; n: number; k: number; name: string }
const SAMPLE_CARD = (name: string, tier: string): VsCard => ({ name, sub: "Lv 5", art: null, tier });
/**
 * Every scene the director has, playable anywhere from a name: the page's mm_scene command and an agent's harness
 * use it to look at one, and a new scene goes here so they can.
 */
export const SCENES = {
  abduction: (w: Where) => abduction(w.at),
  arrival: (w: Where) => arrival(w.n, w.at, w.view),
  lookout: (w: Where) => lookout(w.name, w.at, w.view, w.k),
  trail: (w: Where) => trail("pine-barrens", w.k),
  faceoff: (w: Where) => faceoff(SAMPLE_CARD("You", "common"), SAMPLE_CARD(w.name, "rare"), w.at, w.k),
  freeze: (w: Where) => freeze("won", w.at, w.k),
  bound: (w: Where) => freeze("bound", w.at, w.k),
  lost: (w: Where) => freeze("lost", w.at, w.k),
  found: (w: Where) => found(w.name, ["Gary: Is this thing on?", "You: It's on. It's always on."], w.at, w.k),
} satisfies Record<string, (w: Where) => Scene>;
export type SceneName = keyof typeof SCENES;
