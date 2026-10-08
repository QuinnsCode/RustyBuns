// The finale. When the round ends the richest hippo straps on a championship belt,
// bellows, and then wrestles the losers out of the basin one at a time, last place
// first, each in a different silly way. Pure presentation: it only moves the rigs
// and throws sparks; the standings were settled by the sim.
import * as THREE from "three";
import { SEAT_NAMES, SEATS } from "../../sim/rules.ts";
import { hippoPoint } from "../../sim/geom.ts";
import { at } from "./arena.ts";
import type { Particles } from "./fx.ts";
import type { HippoRig } from "./hippo.ts";
import type { Hippo } from "../../sim/types.ts";

export type Sfx = "bell" | "whoosh" | "slam" | "boing" | "splat" | "ding" | "crowd";
export type Style = "spin" | "slam" | "punt" | "star";
export const STYLES: readonly Style[] = ["spin", "slam", "punt", "star"];
/** The early tosses cycle through these (the round decides where it starts); the runner-up always goes to the stars. */
const EARLY: Style[] = ["spin", "slam", "punt"];

export const INTRO = 2.0, TOSS = 3.0, LAND = 2.5;
/** After the last landing: the champions turn to the crowd. */
const VICTORY = 1.6;
const FLY_FROM: Record<Style, number> = { spin: 1.7, slam: 1.75, punt: 1.45, star: 1.5 };
const PEAK: Record<Style, number> = { spin: 8, slam: 7, punt: 11, star: 26 };
const REACH: Record<Style, number> = { spin: 27, slam: 26, punt: 29, star: 60 };
/** A champion's opening line, by seat. */
const TAUNTS = ["BOW TO EL GENERAL!", "CARL TAKES IT ALL!", "BERTHA'S BASIN NOW!", "SMALL BUT RICH!"];

export interface CineHooks {
  fx: Particles;
  popup(text: string, at: THREE.Vector3, color: string, big?: boolean): void;
  shake(n: number): void;
  sfx(s: Sfx): void;
}

export interface CineOpts {
  /** The name to announce for each seat (see finaleName); defaults to the characters'. */
  names?: readonly string[];
  /** Seats this machine plays: if one of them wins, the finale ends on them. */
  mine?: readonly number[];
  /** Force a style per toss, in toss order (the preview page uses this). */
  styles?: readonly (Style | undefined)[];
}

/**
 * Where the camera should go right now. `push` > 0 moves in toward `focus` (the grab,
 * the hero shot), `push` < 0 pulls back and tilts up (the star launch). 0 = the usual shot.
 */
export interface Shot { focus: THREE.Vector3; push: number }

const ease = (x: number) => x * x * (3 - 2 * x);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const SHOUT = (seat: number): Hippo => ({ seat, slide: 0, gulp: -1, cooldown: 0, sputter: 0, sore: 0, flooded: false, dud: false, score: 0, bellow: 9 });
const UP = new THREE.Vector3(0, 1, 0);

/** The name a finale popup uses: the player's own for a human seat, the character's for a bot. Upper case, kept short. */
export function finaleName(seat: number, seats?: readonly { name: string; human: boolean }[]): string {
  const s = seats?.[seat];
  const raw = (s?.human && s.name.trim()) || SEAT_NAMES[seat] || `SEAT ${seat + 1}`;
  const up = raw.toUpperCase();
  return up.length > 18 ? up.slice(0, 17).trimEnd() + "…" : up;
}

/**
 * Which way a loser flies: straight out from its seat, except that the camera sits to
 * the south (+z), so a toss that would come at the lens is bent off to one side.
 */
export function flightDir(home: THREE.Vector3): THREE.Vector3 {
  const flat = new THREE.Vector3(home.x, 0, home.z).normalize();
  const toward = flat.z;                                         // 1 = straight at the camera
  if (toward > 0.25) flat.applyAxisAngle(UP, (home.x < -0.01 ? -1 : 1) * (0.7 + ((toward - 0.25) / 0.75) * 0.65));
  return flat;
}

interface Loser { seat: number; style: Style }
interface Plan { winners: number[]; losers: Loser[]; home: THREE.Vector3[]; yaw: number[]; names: string[]; hero: boolean }

export class Cinematic {
  active = false;
  /** Reduced motion: no cowering shiver, tumbling or wobble, fewer confetti, no camera moves. */
  calm = false;
  /** Where the camera should be; read by the renderer every frame. */
  readonly shot: Shot = { focus: new THREE.Vector3(), push: 0 };
  private plan: Plan | null = null;
  private t0 = 0;
  private fired = new Set<string>();
  /** Dev hook: pin the timeline to this many seconds. */
  override: number | null = null;
  private base = 1;

  constructor(private rigs: HippoRig[], private hooks: CineHooks) { this.base = rigs[0]!.group.scale.x; }

  start(scores: number[], slides: number[], now: number, opts: CineOpts = {}) {
    const top = Math.max(...scores);
    const winners = scores.map((s, i) => (s === top ? i : -1)).filter((i) => i >= 0);
    const offset = scores.reduce((a, b) => a + b, 0) % EARLY.length;
    const losers = scores.map((s, i) => ({ s, i })).filter((x) => x.s < top).sort((a, b) => a.s - b.s || b.i - a.i)
      .map((x, k, all) => ({ seat: x.i, style: opts.styles?.[k] ?? (k === all.length - 1 ? "star" as Style : EARLY[(offset + k) % EARLY.length]!) }));
    const home = Array.from({ length: SEATS }, (_, i) => { const p = hippoPoint(i, slides[i] ?? 0, 0); return at(p.x, p.y, 0); });
    const yaw = Array.from({ length: SEATS }, (_, i) => this.rigs[i]!.group.rotation.y);
    const names = Array.from({ length: SEATS }, (_, i) => opts.names?.[i] ?? finaleName(i));
    const hero = !!opts.mine?.some((s) => winners.includes(s)) && losers.length > 0;
    this.plan = { winners, losers, home, yaw, names, hero }; this.t0 = now; this.fired.clear(); this.active = true; this.override = null;
    this.shot.push = 0;
    for (let i = 0; i < SEATS; i++) this.rigs[i]!.setChampion(winners.includes(i));
    this.hooks.sfx("bell"); this.hooks.sfx("crowd");
  }

  /** Seconds from the bell to the champions' bow (the finale keeps celebrating after that). */
  get duration() { return this.plan ? INTRO + this.plan.losers.length * TOSS + (this.plan.losers.length ? VICTORY : 0) : 0; }
  /** Seconds since the bell (or the pinned moment). */
  clock(now: number) { return this.override ?? (now - this.t0) / 1000; }
  /** Who is thrown when, and how: for the preview page's scrubber. */
  get tosses(): readonly { seat: number; style: Style; at: number }[] {
    return this.plan?.losers.map((l, k) => ({ ...l, at: INTRO + k * TOSS })) ?? [];
  }

  /** Freeze at the current moment (the preview's pause), and carry on from it. */
  pause(now: number) { if (this.plan && this.override === null) this.override = this.clock(now); }
  resume(now: number) { if (this.override !== null) { this.t0 = now - this.override * 1000; this.override = null; } }

  /** Jump to the end: everyone thrown is gone, the champions celebrate, and nothing left over fires. */
  skip(now: number) {
    const P = this.plan; if (!P) return;
    this.override = null; this.t0 = now - this.duration * 1000;
    P.losers.forEach((_, k) => { for (const key of ["grab", "spin", "slam", "kick", "star", "fly", "land"]) this.fired.add(`${key}${k}`); });
    this.fired.add("taunt"); this.fired.add("hero");
    this.shot.push = 0;
  }

  stop() {
    if (!this.active) return;
    this.active = false; this.plan = null; this.override = null; this.shot.push = 0;
    for (const r of this.rigs) { r.setChampion(false); r.group.visible = true; r.group.scale.setScalar(this.base); r.group.rotation.set(0, 0, 0); }
  }

  /** Once per name per toss: fire an effect the first frame its moment arrives. */
  private once(key: string, f: () => void) { if (!this.fired.has(key)) { this.fired.add(key); f(); } }

  update(now: number, t: number) {
    const P = this.plan; if (!P) return;
    const clock = this.clock(now);
    const rigs = this.rigs, hk = this.hooks, calm = this.calm;
    const end = INTRO + P.losers.length * TOSS;                // the last loser has landed
    this.shot.push = 0;
    // everyone to their marks first; the toss below overrides whoever it involves
    for (let i = 0; i < SEATS; i++) { const g = rigs[i]!.group; g.position.copy(P.home[i]!); g.rotation.set(0, P.yaw[i]!, 0); g.scale.setScalar(this.base); g.visible = true; }
    const lead = P.winners[0]!;
    if (P.losers.length) this.once("taunt", () => hk.popup(TAUNTS[lead] ?? "WHO'S RICH NOW?", P.home[lead]!.clone().add(new THREE.Vector3(0, 5.5, 0)), "#ffd23a", true));
    for (const w of P.winners) {                       // champions flex and bellow, then turn to the crowd when it is over
      const g = rigs[w]!.group, k = Math.abs(Math.sin(clock * (calm ? 2 : 5) + w)) * (calm ? 0.4 : 1);
      g.position.y = k * 0.35; g.scale.set(this.base * (1 + k * 0.05), this.base * (1 - k * 0.04), this.base * (1 + k * 0.05));
      if (P.losers.length && clock > end) {
        const turn = ease(clamp01((clock - end) / 0.6));
        g.rotation.y = P.yaw[w]! + Math.atan2(Math.sin(Math.PI - P.yaw[w]!), Math.cos(Math.PI - P.yaw[w]!)) * turn;   // face the camera (+z)
        g.position.y += turn * (calm ? 0.2 : 0.5) * Math.abs(Math.sin(clock * 3));
      }
      rigs[w]!.pose(SHOUT(w), 0, 1, 0, t);
      if (Math.random() < (calm ? 0.1 : 0.35)) hk.fx.emit(g.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, 7, (Math.random() - 0.5) * 6)), Math.random() < 0.5 ? 0xffc933 : 0xff3d9a, 1, 1.2, 1.6, 4, -0.5);   // a rain of gold and confetti
    }
    if (P.losers.length && clock > end + 0.4) {
      if (P.hero) {                                    // you won: the shot ends on you
        this.once("hero", () => { hk.popup("YOU'RE THE TYCOON!", P.home[lead]!.clone().add(new THREE.Vector3(0, 6, 0)), "#ffd23a", true); hk.sfx("ding"); hk.fx.emit(P.home[lead]!.clone().add(new THREE.Vector3(0, 4, 0)), 0xffc933, 70, 7, 1.4, 5, 0.8); });
        if (!calm) { this.shot.focus.copy(P.home[lead]!).setY(2.2); this.shot.push = 0.45 * ease(clamp01((clock - end - 0.4) / 0.8)); }
      } else this.once("hero", () => hk.popup(`${P.names[lead]} WINS`, P.home[lead]!.clone().add(new THREE.Vector3(0, 6, 0)), "#ffffff", true));
    }

    P.losers.forEach((L, k) => {
      const lr = rigs[L.seat]!;
      const u = clock - INTRO - k * TOSS;
      if (u < 0) { lr.group.rotation.z = calm ? 0 : Math.sin(clock * 38 + k) * 0.05; lr.pose(SHOUT(L.seat), 0, 0.4, 1, t); return; }       // cowering
      const w = P.winners[k % P.winners.length]!, wr = rigs[w]!, wh = P.home[w]!, lh = P.home[L.seat]!;
      if (u >= LAND) { lr.group.visible = false; this.once(`land${k}`, () => this.land(L, lh, P.names[L.seat]!)); return; }

      // A: the winner charges across the basin to just short of the loser
      const toLoser = new THREE.Vector3().subVectors(lh, wh), dist = toLoser.length(), dir = toLoser.clone().normalize();
      const stand = wh.clone().add(dir.clone().multiplyScalar(Math.max(0, dist - 2.6)));
      const wp = wr.group.position, face = Math.atan2(dir.x, dir.z) + Math.PI;
      const fs = FLY_FROM[L.style];
      if (u < 0.5) wp.lerpVectors(wh, stand, ease(u / 0.5));
      else if (u < fs + 0.1) wp.copy(stand);
      else wp.lerpVectors(stand, wh, ease(clamp01((u - fs - 0.1) / 0.8)));
      wr.group.rotation.y = face; wr.pose(SHOUT(w), 0, 1, 0, t);
      lr.pose(SHOUT(L.seat), 0, 1, 1, t);                                                                                   // the loser screams
      const lp = lr.group.position, hold = wp.clone().add(new THREE.Vector3(0, 3.4, 0));

      // the camera leans in for the grab, then lets go (or, for the star, pulls back and looks up)
      if (!calm) {
        const into = ease(clamp01((u - 0.3) / 0.5)), out = ease(clamp01((u - fs) / 0.45));
        if (L.style === "star" && u >= fs) { this.shot.focus.set(0, 0, 0); this.shot.push = -ease(clamp01((u - fs) / 0.5)) * (1 - ease(clamp01((u - LAND + 0.2) / 0.2))); }
        else { this.shot.focus.copy(stand).lerp(lh, 0.5).setY(2.5); this.shot.push = 0.55 * into * (1 - out); }
      }

      if (u < 0.5) { lp.copy(lh); return; }                                                   // waiting to be grabbed
      this.once(`grab${k}`, () => { hk.popup("GRABBED!", lh.clone().add(new THREE.Vector3(0, 3.5, 0)), "#ff3d9a", true); hk.sfx("whoosh"); });
      if (u < 0.8) { lp.lerpVectors(lh, hold, ease((u - 0.5) / 0.3)); lr.group.rotation.set(0, face + 0.6, ease((u - 0.5) / 0.3) * 0.6); return; }

      let launch = hold.clone();                                                              // where the flight starts from
      if (L.style === "spin") {                                                              // the airplane spin
        const ang = ((u - 0.8) / 0.9) * Math.PI * (calm ? 2 : 7);
        wr.group.rotation.y = face + ang;
        launch = wp.clone().add(new THREE.Vector3(Math.cos(ang) * 1.9, 3.1, Math.sin(ang) * 1.9));
        if (u < fs) { lp.copy(launch); lr.group.rotation.set(0, -ang, 1.35); if (Math.random() < 0.5) hk.fx.emit(launch, 0x8aa070, 1, 2, 0.5, 4, 0.2); this.once(`spin${k}`, () => hk.popup("AIRPLANE SPIN!", wp.clone().add(new THREE.Vector3(0, 6, 0)), "#ffd23a", true)); }
      } else if (L.style === "slam") {                                                        // the mud-slam
        if (u < 1.1) { lp.copy(hold).add(new THREE.Vector3(0, ease((u - 0.8) / 0.3) * 1.2, 0)); lr.group.rotation.set(0, face, calm ? 0 : Math.sin(u * 30) * 0.2); }
        else if (u < fs) {
          const s = ease(clamp01((u - 1.1) / 0.14));
          lp.copy(wp).add(dir.clone().multiplyScalar(-1.6)).setY(THREE.MathUtils.lerp(4.6, 0.25, s));
          lr.group.rotation.set(-s * 1.4, face, 0); lr.group.scale.set(this.base * (1 + s * 0.35), this.base * (1 - s * 0.55), this.base * (1 + s * 0.2));
          if (s >= 1) this.once(`slam${k}`, () => { hk.shake(1.1); hk.sfx("slam"); hk.fx.emit(lp.clone(), 0x5a4228, 40, 5, 0.9, 9, 0.6); hk.popup("SLAMMED!", lp.clone().add(new THREE.Vector3(0, 3, 0)), "#ff6a4a", true); });
        }
        launch = wp.clone().add(dir.clone().multiplyScalar(-1.6)).setY(0.4);
      } else if (L.style === "punt") {                                                        // dropped, balled up, and punted
        if (u < 1.2) { lp.lerpVectors(hold, wp.clone().add(dir.clone().multiplyScalar(-1.8)).setY(0.6), ease((u - 0.8) / 0.4)); lr.group.rotation.set(0.9, face, 0); lr.group.scale.setScalar(this.base * 0.8); }
        else if (u < fs) { lp.copy(wp).add(dir.clone().multiplyScalar(-1.8)).setY(0.6); lr.group.scale.setScalar(this.base * 0.8); lr.group.rotation.set(0, face, calm ? 0 : Math.sin(u * 40) * 0.3); wr.group.rotation.x = -0.4 * ease((u - 1.2) / 0.25); }
        if (u >= fs - 0.02) this.once(`kick${k}`, () => { hk.sfx("boing"); hk.shake(0.6); hk.popup("PUNT!", lp.clone().add(new THREE.Vector3(0, 3, 0)), "#7fe0ff", true); });
        launch = wp.clone().add(dir.clone().multiplyScalar(-1.8)).setY(0.6);
      } else {                                                                                // winds up and launches them at the stars
        const wind = ease(clamp01((u - 0.8) / 0.6)), snap = ease(clamp01((u - 1.4) / 0.1));
        wr.group.rotation.x = 0.55 * wind - 0.9 * snap;
        if (u < fs) { lp.copy(hold).add(dir.clone().multiplyScalar(1.3 * wind - 2.6 * snap)); lr.group.rotation.set(-wind * 0.8 + snap * 1.4, face, 0); }
        this.once(`star${k}`, () => hk.popup("TO THE MOON!", wp.clone().add(new THREE.Vector3(0, 6.5, 0)), "#c9a3ff", true));
        launch = hold.clone().add(dir.clone().multiplyScalar(-1.3));
      }

      if (u >= fs) {                                                                          // D: flight, out over the rim and into the jungle
        const s = clamp01((u - fs) / (LAND - fs)), target = flightDir(lh).multiplyScalar(REACH[L.style]);
        const endY = L.style === "star" ? 20 : 0.2;
        lp.set(THREE.MathUtils.lerp(launch.x, target.x, s), THREE.MathUtils.lerp(launch.y, endY, s) + 4 * PEAK[L.style] * s * (1 - s), THREE.MathUtils.lerp(launch.z, target.z, s));
        if (calm) lr.group.rotation.set(0, face, 0);
        else lr.group.rotation.set(s * Math.PI * (L.style === "star" ? 6 : 4), face, s * 3);
        if (L.style === "star") lr.group.scale.setScalar(this.base * (1 - s * 0.85));
        if (L.style === "slam") lr.group.scale.setScalar(this.base);
        this.once(`fly${k}`, () => hk.sfx("whoosh"));
        if (Math.random() < 0.6) hk.fx.emit(lp.clone(), L.style === "star" ? 0xfff0a0 : 0xffffff, 1, 1.5, 0.6, 2, 0.3);          // a trail
      }
    });
  }

  private land(L: Loser, lh: THREE.Vector3, name: string) {
    const flat = flightDir(lh).multiplyScalar(REACH[L.style]);
    if (L.style === "star") {
      const sky = flat.clone().setY(20);
      this.hooks.fx.emit(sky, 0xfff0a0, 60, 6, 1.6, 0.5, 0.4); this.hooks.popup("★", sky, "#fff0a0", true); this.hooks.sfx("ding");
    } else {
      flat.setY(0.5);
      this.hooks.fx.emit(flat, 0x4a8a2a, 50, 6, 1.3, 7, 0.7); this.hooks.fx.emit(flat, 0xff7ab0, 12, 4, 1.2, 6, 0.6);        // leaves and blossoms
      this.hooks.popup(`${name} IS OUT!`, flat.clone().add(new THREE.Vector3(0, 2.5, 0)), "#ffffff", true); this.hooks.sfx("splat"); this.hooks.shake(0.5);
    }
  }
}
