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
type Style = "spin" | "slam" | "punt" | "star";
/** The early tosses cycle through these (the round decides where it starts); the runner-up always goes to the stars. */
const EARLY: Style[] = ["spin", "slam", "punt"];

const INTRO = 2.0, TOSS = 3.0, LAND = 2.5;
const FLY_FROM: Record<Style, number> = { spin: 1.7, slam: 1.75, punt: 1.45, star: 1.5 };
const PEAK: Record<Style, number> = { spin: 8, slam: 7, punt: 11, star: 26 };
const REACH: Record<Style, number> = { spin: 27, slam: 26, punt: 29, star: 60 };

export interface CineHooks {
  fx: Particles;
  popup(text: string, at: THREE.Vector3, color: string, big?: boolean): void;
  shake(n: number): void;
  sfx(s: Sfx): void;
}

const ease = (x: number) => x * x * (3 - 2 * x);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const SHOUT = (seat: number): Hippo => ({ seat, slide: 0, gulp: -1, cooldown: 0, sputter: 0, sore: 0, flooded: false, dud: false, score: 0, bellow: 9 });

interface Plan { winners: number[]; losers: { seat: number; style: Style }[]; home: THREE.Vector3[]; yaw: number[] }

export class Cinematic {
  active = false;
  private plan: Plan | null = null;
  private t0 = 0;
  private fired = new Set<string>();
  /** Dev hook: pin the timeline to this many seconds. */
  override: number | null = null;
  private base = 1;

  constructor(private rigs: HippoRig[], private hooks: CineHooks) { this.base = rigs[0]!.group.scale.x; }

  start(scores: number[], slides: number[], now: number) {
    const top = Math.max(...scores);
    const winners = scores.map((s, i) => (s === top ? i : -1)).filter((i) => i >= 0);
    const offset = scores.reduce((a, b) => a + b, 0) % EARLY.length;
    const losers = scores.map((s, i) => ({ s, i })).filter((x) => x.s < top).sort((a, b) => a.s - b.s || b.i - a.i)
      .map((x, k, all) => ({ seat: x.i, style: k === all.length - 1 ? "star" as Style : EARLY[(offset + k) % EARLY.length]! }));
    const home = Array.from({ length: SEATS }, (_, i) => { const p = hippoPoint(i, slides[i] ?? 0, 0); return at(p.x, p.y, 0); });
    const yaw = Array.from({ length: SEATS }, (_, i) => this.rigs[i]!.group.rotation.y);
    this.plan = { winners, losers, home, yaw }; this.t0 = now; this.fired.clear(); this.active = true; this.override = null;
    for (const w of winners) this.rigs[w]!.setChampion(true);
    this.hooks.sfx("bell"); this.hooks.sfx("crowd");
  }

  stop() {
    if (!this.active) return;
    this.active = false; this.plan = null;
    for (const r of this.rigs) { r.setChampion(false); r.group.visible = true; r.group.scale.setScalar(this.base); r.group.rotation.set(0, 0, 0); }
  }

  /** Once per name per toss: fire an effect the first frame its moment arrives. */
  private once(key: string, f: () => void) { if (!this.fired.has(key)) { this.fired.add(key); f(); } }

  update(now: number, t: number) {
    const P = this.plan; if (!P) return;
    const clock = this.override ?? (now - this.t0) / 1000;
    const rigs = this.rigs, hk = this.hooks;
    // everyone to their marks first; the toss below overrides whoever it involves
    for (let i = 0; i < SEATS; i++) { const g = rigs[i]!.group; g.position.copy(P.home[i]!); g.rotation.set(0, P.yaw[i]!, 0); g.scale.setScalar(this.base); g.visible = true; }
    for (const w of P.winners) {                       // champions flex and bellow
      const g = rigs[w]!.group, k = Math.abs(Math.sin(clock * 5 + w));
      g.position.y = k * 0.35; g.scale.set(this.base * (1 + k * 0.05), this.base * (1 - k * 0.04), this.base * (1 + k * 0.05));
      rigs[w]!.pose(SHOUT(w), 0, 1, 0, t);
      if (Math.random() < 0.35) hk.fx.emit(g.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, 7, (Math.random() - 0.5) * 6)), Math.random() < 0.5 ? 0xffc933 : 0xff3d9a, 1, 1.2, 1.6, 4, -0.5);   // a rain of gold and confetti
    }
    P.losers.forEach((L, k) => {
      const lr = rigs[L.seat]!;
      const u = clock - INTRO - k * TOSS;
      if (u < 0) { lr.group.rotation.z = Math.sin(clock * 38 + k) * 0.05; lr.pose(SHOUT(L.seat), 0, 0.4, 1, t); return; }       // cowering
      const w = P.winners[k % P.winners.length]!, wr = rigs[w]!, wh = P.home[w]!, lh = P.home[L.seat]!;
      if (u >= LAND) { lr.group.visible = false; this.once(`land${k}`, () => this.land(L, lh)); return; }

      // A: the winner charges across the basin to just short of the loser
      const toLoser = new THREE.Vector3().subVectors(lh, wh), dist = toLoser.length(), dir = toLoser.clone().normalize();
      const stand = wh.clone().add(dir.clone().multiplyScalar(Math.max(0, dist - 2.6)));
      const wp = wr.group.position, face = Math.atan2(dir.x, dir.z) + Math.PI;
      if (u < 0.5) wp.lerpVectors(wh, stand, ease(u / 0.5));
      else if (u < FLY_FROM[L.style] + 0.1) wp.copy(stand);
      else wp.lerpVectors(stand, wh, ease(clamp01((u - FLY_FROM[L.style] - 0.1) / 0.8)));
      wr.group.rotation.y = face; wr.pose(SHOUT(w), 0, 1, 0, t);
      lr.pose(SHOUT(L.seat), 0, 1, 1, t);                                                                                   // the loser screams
      const lp = lr.group.position, hold = wp.clone().add(new THREE.Vector3(0, 3.4, 0));

      if (u < 0.5) { lp.copy(lh); return; }                                                   // waiting to be grabbed
      this.once(`grab${k}`, () => { hk.popup("GRABBED!", lh.clone().add(new THREE.Vector3(0, 3.5, 0)), "#ff3d9a", true); hk.sfx("whoosh"); });
      const fs = FLY_FROM[L.style];
      if (u < 0.8) { lp.lerpVectors(lh, hold, ease((u - 0.5) / 0.3)); lr.group.rotation.set(0, face + 0.6, ease((u - 0.5) / 0.3) * 0.6); return; }

      let launch = hold.clone();                                                              // where the flight starts from
      if (L.style === "spin") {                                                              // the airplane spin
        const ang = ((u - 0.8) / 0.9) * Math.PI * 7;
        wr.group.rotation.y = face + ang;
        launch = wp.clone().add(new THREE.Vector3(Math.cos(ang) * 1.9, 3.1, Math.sin(ang) * 1.9));
        if (u < fs) { lp.copy(launch); lr.group.rotation.set(0, -ang, 1.35); if (Math.random() < 0.5) hk.fx.emit(launch, 0x8aa070, 1, 2, 0.5, 4, 0.2); this.once(`spin${k}`, () => hk.popup("AIRPLANE SPIN!", wp.clone().add(new THREE.Vector3(0, 6, 0)), "#ffd23a", true)); }
      } else if (L.style === "slam") {                                                        // the mud-slam
        if (u < 1.1) { lp.copy(hold).add(new THREE.Vector3(0, ease((u - 0.8) / 0.3) * 1.2, 0)); lr.group.rotation.set(0, face, Math.sin(u * 30) * 0.2); }
        else if (u < fs) {
          const s = ease(clamp01((u - 1.1) / 0.14));
          lp.copy(wp).add(dir.clone().multiplyScalar(-1.6)).setY(THREE.MathUtils.lerp(4.6, 0.25, s));
          lr.group.rotation.set(-s * 1.4, face, 0); lr.group.scale.set(this.base * (1 + s * 0.35), this.base * (1 - s * 0.55), this.base * (1 + s * 0.2));
          if (s >= 1) this.once(`slam${k}`, () => { hk.shake(1.1); hk.sfx("slam"); hk.fx.emit(lp.clone(), 0x5a4228, 40, 5, 0.9, 9, 0.6); hk.popup("SLAMMED!", lp.clone().add(new THREE.Vector3(0, 3, 0)), "#ff6a4a", true); });
        }
        launch = wp.clone().add(dir.clone().multiplyScalar(-1.6)).setY(0.4);
      } else if (L.style === "punt") {                                                        // dropped, balled up, and punted
        if (u < 1.2) { lp.lerpVectors(hold, wp.clone().add(dir.clone().multiplyScalar(-1.8)).setY(0.6), ease((u - 0.8) / 0.4)); lr.group.rotation.set(0.9, face, 0); lr.group.scale.setScalar(this.base * 0.8); }
        else if (u < fs) { lp.copy(wp).add(dir.clone().multiplyScalar(-1.8)).setY(0.6); lr.group.scale.setScalar(this.base * 0.8); lr.group.rotation.set(0, face, Math.sin(u * 40) * 0.3); wr.group.rotation.x = -0.4 * ease((u - 1.2) / 0.25); }
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
        const s = clamp01((u - fs) / (LAND - fs)), reach = REACH[L.style];
        const target = lh.clone().setY(0); const flat = new THREE.Vector3(lh.x, 0, lh.z).normalize(); target.copy(flat.multiplyScalar(reach));
        const endY = L.style === "star" ? 20 : 0.2;
        lp.set(THREE.MathUtils.lerp(launch.x, target.x, s), THREE.MathUtils.lerp(launch.y, endY, s) + 4 * PEAK[L.style] * s * (1 - s), THREE.MathUtils.lerp(launch.z, target.z, s));
        lr.group.rotation.set(s * Math.PI * (L.style === "star" ? 6 : 4), face, s * 3);
        if (L.style === "star") lr.group.scale.setScalar(this.base * (1 - s * 0.85));
        if (L.style === "slam") lr.group.scale.setScalar(this.base);
        this.once(`fly${k}`, () => hk.sfx("whoosh"));
        if (Math.random() < 0.6) hk.fx.emit(lp.clone(), L.style === "star" ? 0xfff0a0 : 0xffffff, 1, 1.5, 0.6, 2, 0.3);          // a trail
      }
    });
  }

  private land(L: { seat: number; style: Style }, lh: THREE.Vector3) {
    const flat = new THREE.Vector3(lh.x, 0, lh.z).normalize().multiplyScalar(REACH[L.style]);
    if (L.style === "star") {
      const sky = flat.clone().setY(20);
      this.hooks.fx.emit(sky, 0xfff0a0, 60, 6, 1.6, 0.5, 0.4); this.hooks.popup("★", sky, "#fff0a0", true); this.hooks.sfx("ding");
    } else {
      flat.setY(0.5);
      this.hooks.fx.emit(flat, 0x4a8a2a, 50, 6, 1.3, 7, 0.7); this.hooks.fx.emit(flat, 0xff7ab0, 12, 4, 1.2, 6, 0.6);        // leaves and blossoms
      this.hooks.popup(`${SEAT_NAMES[L.seat]!.split(" ")[0]!.toUpperCase()} IS OUT!`, flat.clone().add(new THREE.Vector3(0, 2.5, 0)), "#ffffff", true); this.hooks.sfx("splat"); this.hooks.shake(0.5);
    }
  }
}
