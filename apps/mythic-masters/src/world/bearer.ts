// You in the open world (#3774): a shadowy figure carrying the Book, the same for every player, with your line-up of
// cryptids walking behind. What tells friends apart is the ground under them: a disc of standing waves round each
// figure's feet, like sand on a bowed plate, in the colour its player picked (world/hues.ts: one of 64, no two alike in
// a room), with a figure of its own for each colour. The disc is draped on the ground every step and its crests rise
// off it, so it reads as the Book humming through the earth.
//
// Behind each figure runs a trail of prints in the same colour (#3786): one every stride, fading over two minutes, so
// you can see from a distance where a friend went and follow them to a lair. A long jump (fast travel, landing beside
// a friend, a new region) clears it rather than drawing prints across the gap.
//
// The figure is a lanky shape in black with a shaggy mop, bell-bottoms and big sneakers, the Book in one hand,
// skinned to a humanoid rig: it stands, looks about, walks and runs by its speed. Built in Blender by `bun run
// bearer` (blender/bearer.json is its look). One skinned mesh of three materials, shared by every figure; its disc is
// one small plane whose waves are drawn by its shader, and its trail one mesh of a fixed ring of quads.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneRig } from "three/examples/jsm/utils/SkeletonUtils.js";
import { clamp } from "@rustybuns/util";
import { hum, PALETTE } from "./hues.ts";

/** The figure is this tall (metres), hair to sole: a name tag sits a little over it. */
export const HEIGHT = 1.96;
/** The disc is this wide (metres), and this many quads across: enough for its crests to rise as a surface. */
const PATCH = 3.4;
const SEGS = 20;
/** A trail stone every this many metres walked, this wide, and this many kept (the oldest is laid again). */
const STEP = 1.8, STONE = 1.4, STONES = 96;
/** A stone fades out over this long (ms). */
export const TRAIL_LIFE = 120_000;
/** A move this far in one update is a jump, not a walk: the trail starts again. */
const JUMP = 25;
/** Before you are seated in a room (offline, or before the room's `all`), you are this. */
export const NO_ID = "you";

/** (The renderer keeps a logarithmic depth buffer, main.ts: a shader of our own writes its depth that way too, or the
 * ground hides it.) The waves (after the spell plates of the druid game): `sym` plane waves at evenly turned angles, summed, still where they
 * cancel (the nodal lines sand gathers on); a ripple running out from the middle; the rim clamped like a drumhead. `p` is
 * the disc's own coordinate, -1..1. Both shaders run it, the vertex one to lift the crests, the fragment one to draw. */
const WAVES = /* glsl */ `
uniform float uTime; uniform float uSym; uniform float uK; uniform float uSwirl; uniform float uRings; uniform float uFlow;
vec3 waves(vec2 p) {
  float r = length(p), twist = r * uSwirl + uTime * 0.05, phi = uTime * 0.35 * sign(uFlow), s = 0.0;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uSym) break;
    float a = twist + 6.2831853 * float(i) / uSym;
    s += cos((p.x * cos(a) + p.y * sin(a)) * uK * 3.14159 + phi);
  }
  s /= uSym;
  float ripple = cos(r * uRings * 6.2831853 - uTime * uFlow * 2.0);
  float env = 1.0 - smoothstep(0.72, 1.0, r), breathe = 0.7 + 0.3 * cos(uTime * 1.7);
  return vec3(s, ripple, (s * breathe * 0.7 + ripple * 0.3) * env);
}`;

/** Seconds, shared by every disc, so a party's grounds hum in step. */
const TIME = { value: 0 };
const hums = new Map<number, THREE.ShaderMaterial>();
/** Colour `i`'s disc material, made once and shared by every disc that wears it. */
function humMat(i: number) {
  let m = hums.get(i);
  if (!m) {
    const h = hum(i);
    m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      uniforms: { uTime: TIME, uColour: { value: new THREE.Color(PALETTE[i]!) }, uSym: { value: h.sym }, uK: { value: h.k }, uSwirl: { value: h.swirl }, uRings: { value: h.rings }, uFlow: { value: h.flow } },
      vertexShader: WAVES + /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vP; varying vec3 vW;
void main() {
  vP = uv * 2.0 - 1.0; vW = waves(vP);
  vec3 at = position; at.y += max(vW.z, 0.0) * 0.16; // the crests stand up off the ground, the troughs lie on it
  gl_Position = projectionMatrix * modelViewMatrix * vec4(at, 1.0);
  #include <logdepthbuf_vertex>
}`,
      fragmentShader: WAVES + /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColour; varying vec2 vP; varying vec3 vW;
void main() {
  #include <logdepthbuf_fragment>
  float r = length(vP);
  if (r > 1.0) discard;
  vec3 w = waves(vP); // per pixel, so the nodal lines stay sharp between the vertices
  float line = 1.0 - smoothstep(0.0, 0.13, abs(w.x)), crest = smoothstep(0.25, 0.9, w.z), rim = 1.0 - smoothstep(0.0, 0.035, abs(r - 0.93));
  float fade = 1.0 - smoothstep(0.8, 1.0, r);
  vec3 c = uColour * (0.55 + 0.9 * line) + crest * 0.25;
  gl_FragColor = vec4(c, clamp((0.14 + 0.75 * line + 0.3 * crest) * fade + rim * 0.85, 0.0, 1.0));
}`,
    });
    hums.set(i, m);
  }
  return m;
}

/** A trail print: a ring with a dot in it, the waves' footprint, soft only at the rim. */
let stoneTex: THREE.Texture | null = null;
function stone() {
  if (stoneTex) return stoneTex;
  const N = 64, cv = document.createElement("canvas");
  cv.width = cv.height = N;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#000"; g.fillRect(0, 0, N, N);
  g.filter = "blur(2px)"; g.fillStyle = "#fff";
  g.strokeStyle = "#fff"; g.lineWidth = 7;
  g.beginPath(); g.arc(N / 2, N / 2, N / 2 - 9, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(N / 2, N / 2, 7, 0, Math.PI * 2); g.fill();
  stoneTex = new THREE.CanvasTexture(cv);
  stoneTex.channel = 1;
  return stoneTex;
}

const trails = new Map<number, THREE.MeshBasicMaterial>();
/** Colour `i`'s trail material: prints in that colour, a faint glow so they show at night, each faded by its vertex alpha. */
function trailMat(i: number) {
  let m = trails.get(i);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: PALETTE[i]!, alphaMap: stone(), vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    trails.set(i, m);
  }
  return m;
}

/** A ring of prints in one player's colour, laid along where they walk, each fading as it ages. */
class Trail {
  readonly mesh: THREE.Mesh;
  private readonly pos: THREE.BufferAttribute;
  private readonly col: THREE.BufferAttribute;
  /** When each stone was laid (ms), and its centre; NaN is not laid. */
  private readonly at = new Float64Array(STONES).fill(NaN);
  private readonly centre = new Float32Array(STONES * 2);
  private next = 0;
  private side = 1;
  private from = { x: NaN, z: NaN };
  private lit = 0;

  constructor(colour: number, private readonly ground: (x: number, z: number) => number) {
    const g = new THREE.BufferGeometry(), index: number[] = [], uv1 = new Float32Array(STONES * 8);
    for (let i = 0; i < STONES; i++) {
      const v = i * 4;
      index.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
      uv1.set([0, 0, 1, 0, 0, 1, 1, 1], i * 8);
    }
    g.setIndex(index);
    this.pos = new THREE.BufferAttribute(new Float32Array(STONES * 12), 3);
    this.col = new THREE.BufferAttribute(new Float32Array(STONES * 16).fill(1), 4);
    for (let i = 0; i < STONES * 4; i++) this.col.setW(i, 0);
    this.pos.setUsage(THREE.DynamicDrawUsage); this.col.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", this.pos); g.setAttribute("uv1", new THREE.BufferAttribute(uv1, 2)); g.setAttribute("color", this.col);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0);
    this.mesh = new THREE.Mesh(g, trailMat(colour));
    this.mesh.visible = false;
  }

  set colour(i: number) { this.mesh.material = trailMat(i); }

  /** Stones still showing. */
  get count() { return this.lit; }

  clear() { this.at.fill(NaN); this.lit = 0; this.from = { x: NaN, z: NaN }; this.mesh.visible = false; }

  /** The figure is at (x, z) facing `yaw` at `now` (ms): lay a stone if it has walked a stride, and fade the rest. */
  update(x: number, z: number, yaw: number, now: number) {
    const d = Math.hypot(x - this.from.x, z - this.from.z);
    if (d > JUMP) this.clear();
    if (Number.isNaN(this.from.x)) this.from = { x, z };
    else if (d >= STEP) { this.lay(x, z, yaw, now); this.from = { x, z }; }
    this.fade(now);
  }

  private lay(x: number, z: number, yaw: number, now: number) {
    const i = this.next, h = STONE / 2;
    this.next = (i + 1) % STONES;
    // footsteps: each stone a little to one side of the line, then the other
    this.side = -this.side;
    const fx = Math.cos(yaw), fz = Math.sin(yaw), rx = -fz, rz = fx, cx = x + rx * this.side * 0.3, cz = z + rz * this.side * 0.3;
    for (let k = 0; k < 4; k++) {
      const a = k & 1 ? h : -h, b = k & 2 ? h : -h, px = cx + fx * a + rx * b, pz = cz + fz * a + rz * b;
      this.pos.setXYZ(i * 4 + k, px, this.ground(px, pz) + 0.03, pz);
    }
    this.at[i] = now; this.centre[i * 2] = cx; this.centre[i * 2 + 1] = cz;
    this.pos.needsUpdate = true;
    // the bounds of the stones laid, so a trail out of view is not drawn
    let sx = 0, sz = 0, n = 0, r = 0;
    for (let j = 0; j < STONES; j++) if (!Number.isNaN(this.at[j]!)) { sx += this.centre[j * 2]!; sz += this.centre[j * 2 + 1]!; n++; }
    sx /= n; sz /= n;
    for (let j = 0; j < STONES; j++) if (!Number.isNaN(this.at[j]!)) r = Math.max(r, Math.hypot(this.centre[j * 2]! - sx, this.centre[j * 2 + 1]! - sz));
    const s = this.mesh.geometry.boundingSphere!;
    s.center.set(sx, this.ground(sx, sz), sz); s.radius = r + STONE + 20;
  }

  private fade(now: number) {
    let lit = 0;
    for (let i = 0; i < STONES; i++) {
      const t = this.at[i]!, a = Number.isNaN(t) ? 0 : 0.85 * (1 - (now - t) / TRAIL_LIFE);
      if (a <= 0 && !Number.isNaN(t)) this.at[i] = NaN;
      if (a > 0) lit++;
      for (let k = 0; k < 4; k++) this.col.setW(i * 4 + k, Math.max(0, a));
    }
    if (lit || this.lit) this.col.needsUpdate = true;
    this.lit = lit;
    this.mesh.visible = lit > 0;
  }

  dispose() { this.mesh.geometry.dispose(); }
}

/** The bearer (public/models/bearer.glb, built by `bun run bearer`): a lanky figure in black, the Book in one hand,
 *  skinned to a humanoid rig with its clips (idle, look, walk, run, cast). Loaded once; every figure is a clone
 *  sharing its geometry and materials. Null when it can't load (no page, no file): the figure is then not drawn. */
export const MODEL_URL = "/models/bearer.glb";
type Model = { scene: THREE.Object3D; clips: THREE.AnimationClip[] };
let modelP: Promise<Model | null> | null = null;
export function bearerModel(): Promise<Model | null> {
  return modelP ??= new GLTFLoader().loadAsync(MODEL_URL).then((g) => {
    g.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.castShadow = true;
      for (const m of [o.material].flat()) if (m instanceof THREE.MeshStandardMaterial) {
        // black, with a faint violet of its own so a figure still reads at night; the pages and eyes glow warm
        if (m.name === "bearer") { m.emissive.set(0x1a1428); m.emissiveIntensity = 0.4; }
        if (m.name === "glow") m.emissiveIntensity = 1.2;
      }
    });
    return { scene: g.scene, clips: g.animations };
  }).catch(() => null);
}

/** What the figure is doing, by how fast it goes (m/s). */
export type Gait = "idle" | "look" | "walk" | "run";
/** The clips' own speeds (m/s, at time scale 1): a gait plays faster or slower to keep the feet with the ground. */
const WALK_SPEED = 1.5, RUN_SPEED = 4.8;
/** Slower than this is standing; faster than this is a run. */
const STILL = 0.4, RUNNING = 3.2;
/** Standing this long (s), the figure looks round about it once. */
const LOOK_AFTER = 7;
/** The model faces +z; the figure's yaw 0 is +x. */
const FACE = Math.PI / 2;

/** One figure's clips, cross-faded by its speed. */
export class Gaits {
  private readonly mixer: THREE.AnimationMixer;
  private readonly acts = new Map<string, THREE.AnimationAction>();
  gait: Gait = "idle";
  private still = 0;
  private speed = 0;

  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(root);
    for (const c of clips) this.acts.set(c.name, this.mixer.clipAction(c));
    const look = this.acts.get("look");
    if (look) { look.setLoop(THREE.LoopOnce, 1); look.clampWhenFinished = false; }
    this.acts.get("idle")?.play();
    // each figure starts its idle at its own point, so a party doesn't breathe in step
    this.mixer.setTime(Math.random() * 3);
  }

  private to(next: Gait) {
    if (next === this.gait) return;
    const from = this.acts.get(this.gait), to = this.acts.get(next);
    if (!to) return;
    to.reset().play();
    if (from) to.crossFadeFrom(from, next === "run" || this.gait === "run" ? 0.18 : 0.3, false);
    this.gait = next;
  }

  /** `moved` metres in `dt` seconds. */
  update(moved: number, dt: number) {
    if (dt <= 0) return;
    // smoothed, so one short frame doesn't flicker the gait
    this.speed += (moved / dt - this.speed) * Math.min(1, dt * 10);
    const v = this.speed;
    this.still = v < STILL ? this.still + dt : 0;
    if (v >= RUNNING) this.to("run");
    else if (v >= STILL) this.to("walk");
    // a look fades back into the idle before it ends: a once-only clip that ends leaves no pose at all for a frame
    else if (this.gait === "look") { const l = this.acts.get("look")!; if (l.time > l.getClip().duration - 0.4) { this.to("idle"); this.still = 0; } }
    else this.to(this.still > LOOK_AFTER && this.acts.has("look") ? "look" : "idle");
    const walk = this.acts.get("walk"), run = this.acts.get("run");
    if (walk) walk.timeScale = clamp(v / WALK_SPEED, 0.6, 1.8);
    if (run) run.timeScale = clamp(v / RUN_SPEED, 0.75, 2.2);
    this.mixer.update(dt);
  }
}

/** One player in the world: their figure, the disc of their ground under it, and the trail of prints behind. */
export class Bearer {
  readonly group = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly patch: THREE.Mesh;
  private readonly pos: THREE.BufferAttribute;
  private readonly trail: Trail;
  private gaits: Gaits | null = null;
  private gone = false;
  private then = NaN;
  private laid = { x: NaN, y: NaN, z: NaN };
  private last = { x: NaN, z: NaN };
  private worn: number;

  /** `ground(x, z)` is the height to stand and lay the disc on; `colour` is one of the 64 (world/hues.ts), or null for a
   *  figure who isn't a player (Gary). */
  constructor(readonly id: string, parent: THREE.Object3D, private readonly ground: (x: number, z: number) => number, colour: number | null) {
    void bearerModel().then((m) => {
      if (!m || this.gone) return;
      const fig = cloneRig(m.scene);
      fig.rotation.y = FACE;
      this.body.add(fig);
      this.gaits = new Gaits(fig, m.clips);
    });
    const plane = new THREE.PlaneGeometry(PATCH, PATCH, SEGS, SEGS);
    plane.rotateX(-Math.PI / 2);
    this.worn = colour ?? 0;
    this.trail = new Trail(this.worn, ground);
    this.group.add(this.trail.mesh);
    this.patch = new THREE.Mesh(plane, humMat(this.worn));
    this.patch.renderOrder = 1;
    this.pos = plane.getAttribute("position") as THREE.BufferAttribute;
    this.group.add(this.body, this.patch);
    // Not a player (Gary): the figure alone, none of a player's ground (the patch, or anything else laid with it).
    if (colour === null) for (const o of [...this.group.children]) if (o !== this.body) this.group.remove(o);
    parent.add(this.group);
  }

  set visible(v: boolean) { this.group.visible = v; }
  /** The colour this player wears (world/hues.ts), changed in place when they pick another. */
  get colour() { return this.worn; }
  set colour(i: number) { if (i !== this.worn) { this.worn = i; this.patch.material = humMat(i); this.trail.colour = i; } }
  /** Trail stones still showing behind them. */
  get stones() { return this.trail.count; }

  /** What the figure is doing: standing, looking about, walking or running (idle until its model is in). */
  get gait(): Gait { return this.gaits?.gait ?? "idle"; }

  /** Stand at (x, z) facing `yaw` (0 is +x), on `y`. The figure walks or runs by how far it came; the disc is laid on the
   *  ground again every step, and whenever the ground under it changes (the patch round you rebuilt after a trip, a piece
   *  rising), so it never floats over the ground or sinks under it; and a print is left every stride (`now` in ms ages them). */
  update(x: number, y: number, z: number, yaw: number, now = performance.now()) {
    this.trail.update(x, z, yaw, now);
    TIME.value = now / 1000;
    const moved = Number.isNaN(this.last.x) ? 0 : Math.hypot(x - this.last.x, z - this.last.z);
    this.last = { x, z };
    const dt = Number.isNaN(this.then) ? 0 : Math.min(0.1, (now - this.then) / 1000);
    this.then = now;
    // a jump (travel, a new region) is not a sprint
    this.gaits?.update(moved < 2 ? moved : 0, dt);
    this.body.position.set(x, y, z);
    this.body.rotation.y = -yaw;
    if (Math.hypot(x - this.laid.x, z - this.laid.z) < 0.1 && Math.abs(y - this.laid.y) < 0.02) return;
    this.laid = { x, y, z };
    const p = this.pos;
    // the plane's vertex at local (lx, lz) sits on the ground at (x + lx, z + lz)
    this.patch.position.set(x, 0, z);
    for (let i = 0; i < p.count; i++) {
      const lx = ((i % (SEGS + 1)) / SEGS - 0.5) * PATCH, lz = (Math.floor(i / (SEGS + 1)) / SEGS - 0.5) * PATCH;
      p.setY(i, this.ground(x + lx, z + lz) + 0.04);
    }
    p.needsUpdate = true;
    this.patch.geometry.computeBoundingSphere();
  }

  dispose() { this.gone = true; this.group.removeFromParent(); this.patch.geometry.dispose(); this.trail.dispose(); }
}
