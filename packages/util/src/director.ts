// The director: scenes played in a game itself rather than as films, shared by every game that has them. A scene is
// a few seconds long. It can hold a camera (a reel of takes, reel.ts, or a shot of its own), a look over the view
// (dips, flashes, whips, slow motion, speed lines), timed lines ("Who: what"), cards (a title, a credit strip) and
// photos (a polaroid dropping onto a table). The director plays one at a time, queues a held one behind it, and
// answers what is on screen at its second. `seek(t)` and `paused` hold any frame, for a screenshot or a test.
//
// Every game names its scenes in a table (SceneTable) so a page, an agent or a test can play any of them anywhere,
// and gives them the same link: `?scene=<name>&t=<seconds>` (sceneLink) plays it and holds second t. `mountScenes`
// hangs `window.__scenes` (list, play, state) for `bun run probe` and `bun run shots`.
//
// No three.js and no DOM: the page draws the frame, the tests play it. The clock is the page's (real seconds).
import { clamp } from "./index.ts";
import { smoothstep as smooth } from "./motion.ts";
import type { Reel, ReelFrame } from "./reel.ts";
import type { SweepShot } from "./sweep.ts";

/** The look of a moment: black over the view, white, a whip's blur, time's speed (1 normal), speed lines. */
export interface Look { dip: number; flash: number; whip: number; slow: number; speed: number }
/** A camera a scene puts over the page's own, `mix` of the view: a lens (vertical degrees, null: the page's) and a tilt. */
export type SceneShot = SweepShot & { fov?: number | null; roll?: number };
/** Something set on screen for a while: a title, a credit strip, a heading. `kind` is the page's to style it by. */
export interface Card { text: string; sub?: string; kind?: string }
/** A photo dropped on screen and left there: `id` is the page's (what the picture is of), `caption` written under it. */
export interface Photo { id: string; caption: string }

export interface Scene {
  id: string;
  seconds: number;
  /** Any key cuts to the end. */
  skip?: boolean;
  /** The player's input waits while it plays. */
  hold?: boolean;
  /** What is said when: "Who: what", or just what. */
  lines?: readonly (readonly [at: number, line: string])[];
  /** A camera of takes; its camera wins over `shot`, its look joins `look`. */
  reel?: Reel;
  shot?: (t: number) => SceneShot | null;
  look?: (t: number) => Partial<Look>;
  /** Cards on screen from one second to another. */
  cards?: readonly (readonly [from: number, to: number, card: Card])[];
  /** Photos dropped at a second; each stays until the scene ends. */
  photos?: readonly (readonly [at: number, photo: Photo])[];
}

/** What the page draws at one moment. */
export interface Frame<S extends Scene = Scene> {
  scene: S | null;
  /** Seconds into it. */
  t: number;
  /** The real seconds this step moved (0 while paused). */
  dt: number;
  /** 1 while the scene plays, easing to 0 over the director's fade at its end (0 with none). */
  out: number;
  reel: ReelFrame | null;
  shot: SceneShot | null;
  look: Look;
  line: { who: string; text: string } | null;
  /** Each card on now: `in` 0..1 as it comes on, then 1, easing back to 0 as its time is up; `since` seconds on. */
  cards: { card: Card; in: number; since: number }[];
  /** Each photo dropped by now: `drop` 0..1 as it falls, then 1. `n` is its place in the scene's photos. */
  photos: { photo: Photo; drop: number; n: number }[];
  /** The scene that finished during this step, once. */
  ended: S | null;
  /** Seconds the director has run, paused time left out. */
  clock: number;
}

const CLEAR: Look = { dip: 0, flash: 0, whip: 0, slow: 1, speed: 0 };

export class Director<S extends Scene = Scene> {
  /** Holds the scene where it is: nothing moves until it's let go. */
  paused = false;
  frame: Frame<S>;
  protected now: { s: S; t: number } | null = null;
  protected next: S | null = null;
  protected clock = 0;

  /** `fade`: seconds a scene takes to go at its end; `drop`: seconds a photo takes to land. */
  constructor(readonly fade = 0.4, readonly drop = 0.6) { this.frame = this.quiet(); }

  /** The scene playing, and seconds into it. */
  get beat(): { id: S["id"]; t: number } | null { return this.now && { id: this.now.s.id, t: this.now.t }; }
  get holding(): boolean { return !!this.now?.s.hold; }
  get skippable(): boolean { return !!this.now?.s.skip; }

  /**
   * Plays a scene. A held scene waits behind the one playing, unless that one isn't held (a passing line), which it
   * cuts off; anything else is dropped while the director is busy. True if it plays or waits.
   */
  play(s: S): boolean {
    if (!this.now || (s.hold && !this.now.s.hold)) { this.now = { s, t: 0 }; return true; }
    if (s.hold && !this.next) { this.next = s; return true; }
    return false;
  }
  /** Ends whatever is playing (and what waits) without a word. */
  cut(): void { this.now = this.next = null; this.frame = this.quiet(); }
  /** Jumps the scene playing to second `t`, to look at one moment. */
  seek(t: number): boolean {
    if (!this.now) return false;
    this.now.t = clamp(t, 0, this.now.s.seconds - 1e-3);
    this.step(0);
    return true;
  }

  /** `dt` real seconds on; `skip` is a key pressed this step. Answers the frame (also kept on `frame`). */
  step(dt: number, skip = false): Frame<S> {
    if (this.paused) dt = 0;
    this.clock += dt;
    let ended: S | null = null;
    if (this.now) {
      const s = this.now.s;
      if (skip && s.skip && this.now.t < s.seconds - this.fade) this.now.t = s.seconds - this.fade;
      this.now.t += dt;
      if (this.now.t >= s.seconds) { ended = s; this.now = this.next ? { s: this.next, t: 0 } : null; this.next = null; }
    }
    const s = this.now?.s ?? null, t = this.now?.t ?? 0;
    if (!s) return (this.frame = { ...this.quiet(), dt, ended });
    const fr = s.reel?.at(t) ?? null, lk = s.look?.(t) ?? {};
    const said = s.lines?.filter(([at]) => at <= t).at(-1)?.[1];
    const colon = said?.indexOf(": ") ?? -1;
    const ease = (k: number) => this.fade > 0 ? smooth(k / this.fade) : k > 0 ? 1 : 0;
    return (this.frame = {
      scene: s, t, dt, ended, clock: this.clock,
      out: ease(s.seconds - t),
      reel: fr,
      shot: fr ? { from: fr.from, at: fr.at, mix: fr.mix, fov: fr.fov, roll: fr.roll } : s.shot?.(t) ?? null,
      look: {
        dip: Math.max(fr?.dip ?? 0, lk.dip ?? 0), flash: Math.max(fr?.flash ?? 0, lk.flash ?? 0), whip: Math.max(fr?.whip ?? 0, lk.whip ?? 0),
        slow: Math.min(fr?.slow ?? 1, lk.slow ?? 1), speed: Math.max(fr?.speed ?? 0, lk.speed ?? 0),
      },
      line: said ? (colon > 0 ? { who: said.slice(0, colon), text: said.slice(colon + 2) } : { who: "", text: said }) : null,
      cards: (s.cards ?? []).filter(([from, to]) => t >= from && t < to).map(([from, to, card]) => ({ card, in: Math.min(ease(t - from), ease(to - t)), since: t - from })),
      photos: (s.photos ?? []).flatMap(([at, photo], n) => t >= at ? [{ photo, n, drop: this.drop > 0 ? smooth((t - at) / this.drop) : 1 }] : []),
    });
  }

  private quiet(): Frame<S> {
    return { scene: null, t: 0, dt: 0, out: 0, reel: null, shot: null, look: { ...CLEAR }, line: null, cards: [], photos: [], ended: null, clock: this.clock };
  }
}

/** A game's scenes by name, each made for where it plays (`W`: where you stand, a variant, whatever the game needs). */
export type SceneTable<W, S extends Scene = Scene> = Record<string, (w: W) => S>;

/** `?scene=<name>&t=<seconds>`: a page's link to one scene, and the second to hold (null: play it through). */
export function sceneLink(search: string): { name: string; t: number | null } | null {
  const q = new URLSearchParams(search), name = q.get("scene"), t = Number(q.get("t") ?? NaN);
  return name ? { name, t: q.has("t") && Number.isFinite(t) ? Math.max(0, t) : null } : null;
}

/** Plays `name` from `table` where `w` says, cutting what was on; a second `t` jumps there and holds it. False: no such scene. */
export function playNamed<W, S extends Scene>(d: Director<S>, table: SceneTable<W, S>, name: string, w: W, t: number | null = null): boolean {
  const make = Object.hasOwn(table, name) ? table[name] : undefined;
  if (!make) return false;
  d.cut();
  d.paused = false;
  d.play(make(w));
  if (t !== null) { d.seek(t); d.paused = true; }
  return true;
}

/** What `window.__scenes` answers: the scenes' names, playing one (and holding second t), and what's on. */
export interface ScenesHook {
  list(): string[];
  play(name: string, t?: number): boolean | Promise<boolean>;
  state(): unknown;
}
/** Hangs a game's scenes on `window.__scenes` for `bun run probe` and `bun run shots`. */
export function mountScenes(hook: ScenesHook): void {
  if (typeof globalThis === "object") Object.assign(globalThis, { __scenes: hook });
}
