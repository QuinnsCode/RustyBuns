// Lanterns to carry, in an open-air room (room.ts `Outdoor.lanterns`; Desert Gathering's stand at the ends of the deck
// table). Anyone walks up and takes one with F or a click (the key and the click the room uses for things), walks off
// into the dark by its light and sets it down anywhere; everyone sees where each one is and who has it, because the
// World keeps them (src/lanterns.ts) and says who got one when two reach for it. Where everyone carries one
// (`Outdoor.carry`), each body on its feet has a hand lantern of its own too, put down while they sit at a seat (the DJ
// plays by the poles' light) and put away while they carry one of the room's.
//
// Each is made by hand, in the carved poles' style (open-air.ts `lanternPole`): a little wooden house of four posts and a
// pointed roof, paper panes with a lattice bar, a rope handle, and a candle inside. A carried one hangs out of its
// carrier's right hand. The few nearest the camera light the sand and the faces round them with a real, flickering
// light; the rest only glow, and every one throws a soft pool of light on the ground under it.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { applyLantern, carried, decodeLanternServer, noLanterns, type LanternClient, type Lanterns, type LanternServer } from "../lanterns.ts";
import { floorAt, thingBox, type StudioDef } from "./room.ts";
import type { Jam } from "./jam.ts";
import { flameAt } from "./open-air.ts";
import { surface } from "./look.ts";

/** How close a lantern has to be (metres, along the ground) to take it. */
export const REACH = 1.5;
/** How many lanterns get a real light: the nearest to the camera. */
export const LIT = 3;
/** How far in front of you a lantern you set down lands. */
const SET_AHEAD = 0.6;

export type Answer = { ok: true } | { ok: false; why: string };
/** Where a lantern is now, for drawing and the harness: `by` who carries it ("me", someone's peer number) or null. */
export interface LanternPlace { i: number; x: number; y: number; z: number; yaw: number; by: "me" | number | null }

/** How far a lantern's handle top is above its foot (lanternModel's rope loop), and how far its weight hangs under the handle. */
export const HANDLE = 0.435, WEIGHT = 0.3;

/**
 * A carried lantern on its rope handle: a weight WEIGHT metres under the hand. The hand moves (an arm's swing, a turn,
 * a hop, a stop) and the weight lags, swings past and settles under it again. Verlet: the weight keeps its last step's
 * motion (a little lost to the air), falls, and is put back at the handle's length from the hand.
 */
export class Swing {
  readonly bob = new THREE.Vector3();
  private prev = new THREE.Vector3();
  private fresh = true;
  /** How much of its motion the weight keeps each 60th of a second: lower settles sooner. */
  static KEEP = 0.97;
  /** Hang it straight under `hand`, still. */
  reset(hand: THREE.Vector3) { this.bob.set(hand.x, hand.y - WEIGHT, hand.z); this.prev.copy(this.bob); this.fresh = false; }
  /** One step of `dt` seconds with the hand at `hand`: the weight's new place. */
  step(hand: THREE.Vector3, dt: number): THREE.Vector3 {
    // first time, or the carrier jumped across the room (a seat, a new body): hang it still
    if (this.fresh || this.bob.distanceToSquared(hand) > 1) { this.reset(hand); return this.bob; }
    if (dt <= 0) return this.bob;
    // a long frame is a few short ones, so a slow machine swings the same
    const n = Math.min(8, Math.ceil(dt * 120)), h = dt / n, keep = Math.pow(Swing.KEEP, h * 60);
    for (let k = 0; k < n; k++) {
      const vx = (this.bob.x - this.prev.x) * keep, vy = (this.bob.y - this.prev.y) * keep, vz = (this.bob.z - this.prev.z) * keep;
      this.prev.copy(this.bob);
      this.bob.set(this.bob.x + vx, this.bob.y + vy - 9.8 * h * h, this.bob.z + vz);
      const dx = this.bob.x - hand.x, dy = this.bob.y - hand.y, dz = this.bob.z - hand.z, d = Math.hypot(dx, dy, dz) || 1;
      this.bob.set(hand.x + (dx / d) * WEIGHT, hand.y + (dy / d) * WEIGHT, hand.z + (dz / d) * WEIGHT);
    }
    return this.bob;
  }
  /** How far it hangs off straight down, radians. */
  angle(hand: THREE.Vector3) { return Math.acos(Math.max(-1, Math.min(1, (hand.y - this.bob.y) / WEIGHT))); }
}

/** Where a carried lantern hangs: out in the carrier's right hand, its handle in the hand, its foot about knee high. */
export function inHand(def: StudioDef, x: number, z: number, yaw: number): { x: number; y: number; z: number } {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const hx = x + fx * 0.18 + rx * 0.3, hz = z + fz * 0.18 + rz * 0.3;
  return { x: hx, y: floorAt(def, x, z) + 0.4, z: hz };
}

/** What a lantern set down at (x, z) stands on: the top of a seat's table or instrument under it, else the ground (a stage's deck). */
export function standAt(def: StudioDef, x: number, z: number): number {
  let y = floorAt(def, x, z);
  for (const s of def.spots) {
    const b = thingBox(s), dx = x - b.cx, dz = z - b.cz, c = Math.cos(b.turn), sn = Math.sin(b.turn);
    const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
    if (Math.abs(lx) <= b.hw && Math.abs(lz) <= b.hd) y = Math.max(y, floorAt(def, s.at[0], s.at[1]) + s.thing.h);
  }
  return y;
}

/** Every lantern in the room, where it is now: carried, set down somewhere, or where the room stands it. */
export function lanternPlaces(def: StudioDef, ls: Lanterns, me: number | null, jam: Jam): LanternPlace[] {
  const start = def.outdoor?.lanterns ?? [], moved = ls.room === def.id ? ls.moved : {};
  return start.map(([sx, sy, sz], i): LanternPlace => {
    const l = moved[i];
    if (!l) return { i, x: sx, y: sy, z: sz, yaw: 0, by: null };
    if ("at" in l) { const [x, y, z] = l.at; return { i, x, y: Math.max(y, floorAt(def, x, z)), z, yaw: 0, by: null }; }
    if (l.by === me) { const h = inHand(def, jam.me.x, jam.me.z, jam.me.yaw); return { i, ...h, yaw: jam.me.yaw, by: "me" }; }
    const o = jam.others.get(l.by);
    // a carrier whose body hasn't come yet: the lantern stays where it started until it does
    if (!o) return { i, x: sx, y: sy, z: sz, yaw: 0, by: l.by };
    const h = inHand(def, o.at[0], o.at[1], o.yaw);
    return { i, ...h, yaw: o.yaw, by: l.by };
  });
}

/**
 * The hand lanterns of a room where everyone carries one: yours and each other body's, while on their feet and not
 * carrying one of the room's. Numbered on from the room's own lanterns, so each flickers in its own time.
 */
export function handLanterns(def: StudioDef, ls: Lanterns, me: number | null, jam: Jam): LanternPlace[] {
  if (!def.outdoor?.carry) return [];
  const n = def.outdoor.lanterns?.length ?? 0, here = ls.room === def.id, out: LanternPlace[] = [];
  const holds = (peer: number | null) => here && peer !== null && carried(ls, peer) !== null;
  if (!jam.me.seat && !holds(me)) out.push({ i: n, ...inHand(def, jam.me.x, jam.me.z, jam.me.yaw), yaw: jam.me.yaw, by: "me" });
  for (const [peer, o] of jam.others) {
    if (o.seat || holds(peer)) continue;
    out.push({ i: n + 1 + out.length, ...inHand(def, o.at[0], o.at[1], o.yaw), yaw: o.yaw, by: peer });
  }
  return out;
}

/** The lanterns here: what the World says about them, taking and setting one down, and (with a scene) drawing them. */
export class LanternsHere {
  ls: Lanterns;
  /** Your number on the live line, from the World's last word on the lanterns. */
  me: number | null = null;
  private drawn: LanternsDrawn | null;
  constructor(readonly def: StudioDef, private send: (m: LanternClient) => void, scene?: THREE.Scene) {
    this.ls = noLanterns(def.id);
    this.drawn = scene && (def.outdoor?.lanterns?.length || def.outdoor?.carry) ? new LanternsDrawn(scene) : null;
  }
  get count() { return this.def.outdoor?.lanterns?.length ?? 0; }

  heard(m: LanternServer) { this.ls = m.lanterns; if (m.you) this.me = m.you; }
  /** The harness: a lanterns message as the World sends it, checked; false when it isn't one. */
  say(v: unknown): boolean { const m = decodeLanternServer(v); if (m) this.heard(m); return !!m; }
  /** The lantern in your hand, if any. */
  mine(): number | null { return this.me === null || this.ls.room !== this.def.id ? null : carried(this.ls, this.me); }
  places(jam: Jam) { return lanternPlaces(this.def, this.ls, this.me, jam); }
  /** The hand lanterns everyone on their feet carries, where the room has them. */
  hands(jam: Jam) { return handLanterns(this.def, this.ls, this.me, jam); }

  /** The free lantern nearest you within reach, or null. */
  near(jam: Jam): number | null {
    let best: number | null = null, bestD = REACH;
    for (const p of this.places(jam)) {
      if (p.by !== null) continue;
      const d = Math.hypot(p.x - jam.me.x, p.z - jam.me.z);
      if (d < bestD) { best = p.i; bestD = d; }
    }
    return best;
  }
  /** Whether F or a click is for the lanterns now: one is in your hand, or one stands within reach. */
  wants(jam: Jam) { return !jam.me.seat && (this.mine() !== null || this.near(jam) !== null); }

  /** F or a click: set down the lantern you carry a step in front of you, or take the nearest one (`i`: that one). */
  use(jam: Jam, i?: number): Answer {
    if (jam.me.seat) return { ok: false, why: "Stand up to carry a lantern" };
    const mine = this.mine();
    if (mine !== null) {
      const x = jam.me.x - Math.sin(jam.me.yaw) * SET_AHEAD, z = jam.me.z - Math.cos(jam.me.yaw) * SET_AHEAD;
      return this.ask({ t: "lantern", room: this.def.id, i: mine, at: [round(x), round(standAt(this.def, x, z)), round(z)] });
    }
    const want = i ?? this.near(jam);
    if (want === null || want === undefined) return { ok: false, why: this.count ? "Walk up to a lantern" : "There are no lanterns here" };
    const p = this.places(jam)[want];
    if (!p) return { ok: false, why: "There's no such lantern" };
    if (p.by !== null) return { ok: false, why: "Someone else has that lantern" };
    if (Math.hypot(p.x - jam.me.x, p.z - jam.me.z) > REACH) return { ok: false, why: "Walk up to the lantern" };
    return this.ask({ t: "lantern", room: this.def.id, i: want, take: true });
  }
  /** Sent to the World, and done here at once when your number is known (the World's answer puts it right if it said no). */
  private ask(m: LanternClient): Answer {
    if (this.me !== null) this.ls = applyLantern(this.ls, this.me, m);
    this.send(m);
    return { ok: true };
  }

  hint(jam: Jam): string {
    if (jam.me.seat || !this.count) return "";
    if (this.mine() !== null) return "F or tap: set the lantern down";
    return this.near(jam) !== null ? "F or tap: pick up the lantern" : "";
  }

  /** Each frame: every lantern where it is, its flame and its pool, and the real lights on the nearest few. `hand`:
   *  where a carrier's right palm is drawn now (null: not drawn), for a carried one to hang and swing from. */
  frame(jam: Jam, eye: THREE.Vector3, t: number, hand?: (by: "me" | number) => THREE.Vector3 | null) { this.drawn?.frame(this.def, [...this.places(jam), ...this.hands(jam)], eye, t, hand); }

  state(jam: Jam) {
    const at = (p: LanternPlace) => ({ ...p, x: round(p.x), y: round(p.y), z: round(p.z), yaw: round(p.yaw) });
    return { mine: this.mine(), near: this.near(jam), lanterns: this.places(jam).map(at), hands: this.hands(jam).map(at) };
  }
}
const round = (v: number) => Math.round(v * 100) / 100;

/** One hand-made lantern, foot at the origin: `wood` the frame, roof and handle; `panes` the lit paper; the candle and its flame. */
export function lanternModel(): { wood: THREE.BufferGeometry; panes: THREE.BufferGeometry; candle: THREE.BufferGeometry; flame: THREE.BufferGeometry; light: THREE.Vector3 } {
  const half = 0.075, h = 0.22, base = 0.025, wood: THREE.BufferGeometry[] = [];
  // the foot and the top plate, a little wider than the posts
  wood.push(new THREE.BoxGeometry(half * 2 + 0.03, base, half * 2 + 0.03).translate(0, base / 2, 0));
  wood.push(new THREE.BoxGeometry(half * 2 + 0.024, 0.018, half * 2 + 0.024).translate(0, base + h, 0));
  // four corner posts, each a touch off true, as a hand would cut them
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) wood.push(new THREE.BoxGeometry(0.018, h, 0.018).rotateZ(sx * sz * 0.015).translate(sx * half, base + h / 2, sz * half));
  // a lattice bar across each pane a third of the way up, and a carved rail under the roof
  for (const a of [0, Math.PI / 2]) for (const side of [-1, 1]) {
    wood.push(new THREE.BoxGeometry(half * 2, 0.012, 0.007).translate(0, base + h * 0.36, side * half).rotateY(a));
    wood.push(new THREE.BoxGeometry(half * 2, 0.008, 0.006).translate(0, base + h * 0.86, side * half).rotateY(a));
  }
  // the pointed roof, its finial, and the rope handle looped over it
  wood.push(new THREE.CylinderGeometry(0.01, half * 1.7, 0.11, 4).rotateY(Math.PI / 4).translate(0, base + h + 0.064, 0));
  wood.push(new THREE.SphereGeometry(0.014, 6, 4).translate(0, base + h + 0.125, 0));
  const loop = new THREE.CatmullRomCurve3([[-0.05, 0], [-0.055, 0.06], [-0.03, 0.115], [0, 0.13], [0.03, 0.115], [0.055, 0.06], [0.05, 0]].map(([x, y]) => new THREE.Vector3(x, base + h + 0.06 + y, 0)));
  wood.push(new THREE.TubeGeometry(loop, 24, 0.006, 5));
  const panes = new THREE.BoxGeometry(half * 2 - 0.012, h - 0.01, half * 2 - 0.012).translate(0, base + h / 2, 0);
  const candle = new THREE.CylinderGeometry(0.016, 0.018, 0.07, 8).translate(0, base + 0.035, 0);
  const flame = new THREE.SphereGeometry(0.012, 8, 6).scale(1, 2.1, 1).translate(0, base + 0.095, 0);
  return { wood: mergeGeometries(wood.map((g) => (g.index ? g.toNonIndexed() : g)))!, panes, candle, flame, light: new THREE.Vector3(0, base + 0.1, 0) };
}

/** The soft warm pool a lantern throws on the ground: a radial fade, painted once. */
function poolTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!, grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,190,110,0.85)"); grad.addColorStop(0.35, "rgba(255,160,80,0.35)"); grad.addColorStop(1, "rgba(255,140,60,0)");
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The lanterns in a scene: one mesh set each (made the first time its number is drawn), a pool under each, and LIT real lights handed to the nearest. */
class LanternsDrawn {
  private items: { g: THREE.Group; flame: THREE.Mesh; panes: THREE.Mesh; pool: THREE.Mesh; swing: Swing; by: "me" | number | null }[] = [];
  private last = -1;
  private pivot = new THREE.Vector3();
  private up = new THREE.Vector3();
  private turn = new THREE.Quaternion();
  private spin = new THREE.Quaternion();
  private lights: THREE.PointLight[] = [];
  private m = lanternModel();
  private wood = surface("wood", "#8a6844");
  private candle = new THREE.MeshStandardMaterial({ color: "#efe2c4", emissive: "#ffcf8a", emissiveIntensity: 0.6, roughness: 0.8 });
  private poolMat = new THREE.MeshBasicMaterial({ map: poolTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  private poolGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  constructor(private scene: THREE.Scene) {
    // a fixed few lights, always in the scene (a light coming or going recompiles every material): unused ones sit dark
    for (let k = 0; k < LIT; k++) {
      const l = new THREE.PointLight("#ffb060", 0, 9, 1.8);
      scene.add(l);
      this.lights.push(l);
    }
  }
  private item(i: number) {
    while (this.items.length <= i) {
      const g = new THREE.Group(), m = this.m;
      // each its own paper and flame, so each flickers out of step
      const panes = new THREE.Mesh(m.panes, new THREE.MeshStandardMaterial({ color: "#2a1606", emissive: "#ffb257", emissiveIntensity: 1.5, transparent: true, opacity: 0.92 }));
      const flame = new THREE.Mesh(m.flame, new THREE.MeshBasicMaterial({ color: "#ffd890", toneMapped: false }));
      panes.userData.looked = true;
      g.add(new THREE.Mesh(m.wood, this.wood), panes, new THREE.Mesh(m.candle, this.candle), flame);
      const pool = new THREE.Mesh(this.poolGeo, this.poolMat.clone());
      pool.renderOrder = 2;
      this.scene.add(g, pool);
      this.items.push({ g, flame, panes, pool, swing: new Swing(), by: null });
    }
    return this.items[i]!;
  }

  frame(def: StudioDef, places: LanternPlace[], eye: THREE.Vector3, t: number, hand?: (by: "me" | number) => THREE.Vector3 | null) {
    const dt = this.last < 0 ? 0 : Math.min(0.1, Math.max(0, t - this.last));
    this.last = t;
    const Y = new THREE.Vector3(0, 1, 0);
    // a hand lantern whose carrier sat down or left is put away
    const shown = new Set(places.map((p) => p.i));
    this.items.forEach((it, i) => { it.g.visible = it.pool.visible = shown.has(i); });
    places = places.map((q) => {
      let p = q;
      const it = this.item(p.i);
      // a carried one hangs from its carrier's palm on its handle and swings there (Swing); set down, it stands
      if (it.by !== p.by) { it.by = p.by; it.swing = new Swing(); }
      if (p.by === null) {
        it.g.position.set(p.x, p.y, p.z);
        it.g.rotation.set(0, p.yaw + p.i * 0.7, 0);
      } else {
        const palm = hand?.(p.by);
        if (palm) this.pivot.copy(palm); else this.pivot.set(p.x, p.y + HANDLE, p.z);
        const bob = it.swing.step(this.pivot, dt);
        this.up.subVectors(this.pivot, bob).normalize();
        it.g.quaternion.multiplyQuaternions(this.turn.setFromUnitVectors(Y, this.up), this.spin.setFromAxisAngle(Y, p.yaw + p.i * 0.7));
        it.g.position.copy(this.pivot).addScaledVector(this.up, -HANDLE);
        p = { ...p, x: it.g.position.x, y: it.g.position.y, z: it.g.position.z };
      }
      const f = flameAt(p.i + 40, t);
      it.flame.scale.set(1, 0.85 + 0.3 * f, 1);
      (it.panes.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.5 * f;
      // the pool on the ground under it: wider and fainter the higher it hangs
      const ground = floorAt(def, p.x, p.z), up = Math.max(0, p.y - ground);
      const size = 2.6 + up * 1.6;
      it.pool.position.set(p.x, ground + 0.015, p.z);
      it.pool.scale.set(size, 1, size);
      (it.pool.material as THREE.MeshBasicMaterial).opacity = (0.5 * f) / (1 + up * 0.6);
      return p;
    });
    const nearest = [...places].sort((a, b) => Math.hypot(a.x - eye.x, a.z - eye.z) - Math.hypot(b.x - eye.x, b.z - eye.z));
    this.lights.forEach((l, k) => {
      const p = nearest[k];
      if (!p) { l.intensity = 0; return; }
      l.position.set(p.x + this.m.light.x, p.y + this.m.light.y, p.z + this.m.light.z);
      l.intensity = 4 * flameAt(p.i + 40, t);
    });
  }
}
