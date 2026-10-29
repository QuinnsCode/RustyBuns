// The soldiers: soft clay mannequins. Fat rounded limbs that run into each other, a ball for a
// head on a short neck, ball hands and flat little feet, no face, all inked round the edge like a
// comic. Yours is glossy black, the guards are orange. The head is a slot: a plain ball, or a
// block with a logo on it (heads.ts). The gun in the hands is whichever git command is up.
//
// Joints are groups; every limb hangs down its group's -y, so rotating a joint by +x
// swings the limb forward (towards -z, the way the figure faces) and -x swings it back.
// A joint that points up (the spine, the head) tips back with +x.
//
//   root     at the feet, turned to the soldier's yaw
//   tumble   at the waist, for rolls and lying prone
//   body     the figure, feet at the root again
//     hips → legL/legR (hip → knee → foot) and spine → armL/armR (shoulder → elbow → hand), head
//     the gun hangs off the right forearm, in the `hand` group
//
// pose() works out where every joint should be from what the soldier is doing, then (given a
// blend rate) eases the joints there, so one pose flows into the next instead of snapping.
//
// The body parts (limbs, hands, feet, pelvis, the plain ball head) are not drawn where they sit.
// They are invisible stand-ins on the joints, and a Crowd copies each one's world matrix and
// colour into one shared InstancedMesh per part shape (plus its ink-line twin), so any number of
// soldiers cost a handful of draw calls. Guns and logo heads stay ordinary meshes.

import * as THREE from "three";
import { LEAN_REACH } from "../sim/game.ts";
import type { WeaponId } from "../sim/weapons.ts";

export type Pose = "stand" | "kneel" | "prone" | "tuck" | "star" | "surrender" | "air" | "hang";

/** Body types. Looks only: every build has the same hitbox and speed. */
export type BuildId = "thick" | "average" | "lank";

interface Build {
  name: string;
  /** Limb and torso thickness, and height, against average. */
  girth: number;
  chest: number;
  tall: number;
  head: number;
}

export const BUILDS: Record<BuildId, Build> = {
  // Built like a fridge: a barrel chest, tree-trunk limbs, a small head.
  thick: { name: "Thick", girth: 1.5, chest: 1.45, tall: 0.96, head: 0.88 },
  average: { name: "Average", girth: 1, chest: 1, tall: 1, head: 1 },
  // All limbs: a head taller, skinny as a rake.
  lank: { name: "Lank", girth: 0.62, chest: 0.72, tall: 1.12, head: 0.95 },
};

/** A build's joints, in metres. `arm` is the whole arm, shoulder to wrist: `upper` and `fore` split it at the elbow. */
interface Dims { waist: number; hip: number; thigh: number; shin: number; shoulder: number; arm: number; upper: number; fore: number; neck: number; girth: number; chest: number; head: number }

function dims(b: Build): Dims {
  const t = b.tall, arm = 0.46 * t;
  return { waist: 0.9 * t, hip: 0.88 * t, thigh: 0.44 * t, shin: 0.44 * t, shoulder: 0.5 * t, arm, upper: arm * 0.54, fore: arm * 0.46, neck: 0.78 * t, girth: b.girth, chest: b.chest, head: b.head };
}

export interface Figure {
  root: THREE.Group;
  /** The head slot: empty it and add a new head to swap. */
  head: THREE.Group;
  /** Distance walked, which sets the stride; seconds alive, for breathing. */
  stride: number;
  clock: number;
  dims: Dims;
  /** The joints pose() moves, by name, and the gun on show. */
  joints: Record<string, THREE.Object3D>;
  gun: WeaponId | null;
  /** The stand-ins a Crowd draws: every invisible body part, head ball included. */
  parts: THREE.Mesh[];
}

/** The comic ink line: each mesh's back faces pushed out along their normals and drawn black. */
export const OUTLINE = (() => {
  const m = new THREE.MeshBasicMaterial({ color: 0x1f1f1f, side: THREE.BackSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed += normal * 0.03;");
  };
  m.customProgramCacheKey = () => "ink-outline";
  return m;
})();

/** A body part's shared geometry: one per shape, however many soldiers or builds use it. */
const shapes = new Map<string, THREE.BufferGeometry>();
function shape(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = shapes.get(key);
  if (!g) shapes.set(key, (g = make()));
  return g;
}

/** The body's clay: shared by every soldier of that colour and gloss (heads and the instance colours read it). */
const clays = new Map<string, THREE.MeshStandardMaterial>();
function clay(color: number, gloss: number): THREE.MeshStandardMaterial {
  const key = `${color}:${gloss}`;
  let m = clays.get(key);
  if (!m) clays.set(key, (m = new THREE.MeshStandardMaterial({ color, roughness: gloss, metalness: 0.04 })));
  return m;
}

/** An invisible stand-in for a body part: it carries the joint's transform, the Crowd draws it. */
function stand(geo: THREE.BufferGeometry, mat: THREE.Material, name: string): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.visible = false;
  m.name = name;
  m.userData.part = true;
  return m;
}

/** Adds the ink line round a mesh. */
export function inked<T extends THREE.Mesh>(m: T): T {
  const o = new THREE.Mesh(m.geometry, OUTLINE);
  o.name = "ink";
  m.add(o);
  return m;
}

function limb(mat: THREE.Material, r: number, len: number, name: string): THREE.Mesh {
  const m = stand(shape(`cap:${r}:${len}`, () => new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 6, 16)), mat, name);
  m.position.y = -len / 2;
  return m;
}

/** A ball of the body's clay: a hand, or squashed, a foot. */
function ball(mat: THREE.Material, r: number, name: string, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = stand(shape(`ball:${r}`, () => new THREE.SphereGeometry(r, 14, 10)), mat, name);
  m.position.set(x, y, z);
  return m;
}

const group = (name: string, x = 0, y = 0, z = 0) => {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  return g;
};

function leg(mat: THREE.Material, d: Dims, side: number): THREE.Group {
  const hip = group(side < 0 ? "legL" : "legR", side * 0.13 * d.chest, 0, 0);
  hip.add(limb(mat, 0.13 * d.girth, d.thigh + 0.06, "thigh"));
  const knee = group(side < 0 ? "kneeL" : "kneeR", 0, -d.thigh, 0);
  knee.add(limb(mat, 0.12 * d.girth, d.shin, "shin"));
  // The foot: a flattened ball under the shin, toes forward.
  const foot = ball(mat, 0.09 * d.girth, side < 0 ? "footL" : "footR", 0, -d.shin + 0.02, -0.05);
  foot.scale.set(1.1, 0.5, 1.45);
  knee.add(foot);
  hip.add(knee);
  return hip;
}

function arm(mat: THREE.Material, d: Dims, side: number): { shoulder: THREE.Group; elbow: THREE.Group } {
  const shoulder = group(side < 0 ? "armL" : "armR", side * 0.3 * d.chest, d.shoulder, 0);
  shoulder.add(limb(mat, 0.095 * d.girth, d.upper + 0.04, "arm"));
  const elbow = group(side < 0 ? "elbowL" : "elbowR", 0, -d.upper, 0);
  elbow.add(limb(mat, 0.085 * d.girth, d.fore, "forearm"));
  elbow.add(ball(mat, 0.075 * d.girth, side < 0 ? "handL" : "handR", 0, -d.fore, 0));
  shoulder.add(elbow);
  return { shoulder, elbow };
}

/** The plain head: a ball the same stuff as the body. */
export function ballHead(mat: THREE.Material, size = 1): THREE.Mesh {
  return stand(shape(`head:${size}`, () => new THREE.SphereGeometry(0.21 * size, 24, 16)), mat, "ball");
}

/* ---------------- guns ---------------- */

// Each git command's gun, as a silhouette: how long, how fat the barrel, and what hangs off it.
// They lie along the right forearm and stick out past the hand. In the forearm's frame -y runs
// out along the barrel, and +z is the gun's underside (the arm points forward when aiming).
interface GunShape { body: number; barrel: number; bore: number; tube?: boolean; scope?: boolean; drum?: boolean; tank?: boolean; pump?: boolean }
const GUNS: Record<WeaponId, GunShape> = {
  commit: { body: 0.36, barrel: 0.3, bore: 0.022 },
  add: { body: 0.3, barrel: 0.26, bore: 0.04, pump: true },
  fetch: { body: 0.42, barrel: 0.36, bore: 0.03, drum: true },
  clean: { body: 0.34, barrel: 0.3, bore: 0.05, tank: true },
  push: { body: 0.2, barrel: 0.7, bore: 0.09, tube: true },
  merge: { body: 0.3, barrel: 0.16, bore: 0.07, drum: true },
  rebase: { body: 0.4, barrel: 0.56, bore: 0.018, scope: true },
  cherry: { body: 0.34, barrel: 0.24, bore: 0.03, scope: true },
  revert: { body: 0.3, barrel: 0.2, bore: 0.035 },
  stash: { body: 0.3, barrel: 0.18, bore: 0.03 },
  blame: { body: 0.3, barrel: 0.28, bore: 0.02, scope: true },
  amend: { body: 0.24, barrel: 0.14, bore: 0.02 },
  squash: { body: 0.22, barrel: 0.12, bore: 0.08, drum: true },
  reset: { body: 0.3, barrel: 0.5, bore: 0.11, tube: true },
};

const paper = new THREE.MeshLambertMaterial({ color: 0xffffff }), ink = new THREE.MeshLambertMaterial({ color: 0x1f1f1f });
const orange = new THREE.MeshLambertMaterial({ color: 0xe8590c });
const edge = new THREE.LineBasicMaterial({ color: 0x1f1f1f });

function part(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, edged = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  if (edged) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), edge));
  return m;
}

/** A gun, paper white with ink lines so it reads on a black body and an orange one. */
function buildGun(w: WeaponId): THREE.Group {
  const s = GUNS[w], g = group(`gun:${w}`);
  // A size up from life, so you can see what's in the hands from over the shoulder.
  g.scale.setScalar(1.3);
  // Receiver from the hand out, stock back along the forearm.
  g.add(part(new THREE.BoxGeometry(0.085, s.body, 0.13), paper, 0, -s.body / 2 + 0.06, 0.02));
  g.add(part(new THREE.BoxGeometry(0.07, 0.2, 0.1), paper, 0, 0.16, 0.05));
  const barrel = new THREE.CylinderGeometry(s.bore, s.bore, s.barrel, 12);
  g.add(part(barrel, s.tube ? paper : ink, 0, -s.body + 0.06 - s.barrel / 2, s.tube ? 0 : -0.01, !!s.tube));
  if (s.tube) g.add(part(new THREE.TorusGeometry(s.bore, 0.012, 6, 16).rotateX(Math.PI / 2), orange, 0, -s.body + 0.06 - s.barrel, 0, false));
  else g.add(part(new THREE.BoxGeometry(0.05, 0.06, 0.13), paper, 0, -s.body * 0.55, 0.12));
  if (s.scope) g.add(part(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 10), ink, 0, -s.body * 0.4, -0.1, false));
  if (s.drum) g.add(part(new THREE.CylinderGeometry(0.09, 0.09, 0.07, 14).rotateZ(Math.PI / 2), paper, 0, -s.body * 0.4, 0.14));
  if (s.tank) g.add(part(new THREE.CapsuleGeometry(0.07, 0.18, 4, 10), orange, 0, -s.body * 0.3, 0.16));
  if (s.pump) g.add(part(new THREE.BoxGeometry(0.09, 0.12, 0.07), ink, 0, -s.body - 0.05, 0.04, false));
  return g;
}

/** Puts this command's gun in the figure's hands. */
export function setGun(f: Figure, w: WeaponId) {
  if (f.gun === w) return;
  const hand = f.joints.hand!;
  for (const c of hand.children) c.visible = c.name === `gun:${w}`;
  if (!hand.getObjectByName(`gun:${w}`)) hand.add(buildGun(w));
  f.gun = w;
}

/* ---------------- the figure ---------------- */

export function buildFigure(color: number, gloss: number, build: BuildId = "average"): Figure {
  const d = dims(BUILDS[build]);
  const mat = clay(color, gloss);
  const root = group("figure");
  root.rotation.order = "YXZ";
  root.userData.mat = mat;
  const tumble = group("tumble", 0, d.waist, 0);
  const body = group("body", 0, -d.waist, 0);
  const hips = group("hips", 0, d.hip, 0);
  const pelvis = stand(shape("pelvis", () => new THREE.SphereGeometry(0.23, 20, 14)), mat, "pelvis");
  pelvis.scale.set(1.05 * d.chest, 0.8, 0.85 * Math.max(1, d.girth * 0.9));
  const spine = group("spine");
  const k = d.neck / 0.78;
  const torso = limb(mat, 0.25, 0.56 * k, "torso");
  torso.position.y = 0.28 * k;
  torso.scale.set(d.chest, 1, 0.8 * Math.max(0.8, d.chest * 0.9));
  // A short neck between the chest's dome and the head.
  const neck = limb(mat, 0.07 * Math.max(0.8, d.girth), 0.16 * k, "neck");
  neck.position.y = d.neck - 0.08 * k;
  const { shoulder: armL, elbow: elbowL } = arm(mat, d, -1), { shoulder: armR, elbow: elbowR } = arm(mat, d, 1);
  const hand = group("hand", 0, -d.fore, 0.02);
  elbowR.add(hand);
  const head = group("head", 0, d.neck, 0);
  head.userData.size = d.head;
  head.add(ballHead(mat, d.head));
  spine.add(torso, neck, armL, armR, head);
  const legL = leg(mat, d, -1), legR = leg(mat, d, 1);
  hips.add(pelvis, spine, legL, legR);
  body.add(hips);
  tumble.add(body);
  root.add(tumble);
  const joints = { tumble, body, spine, legL, legR, kneeL: legL.getObjectByName("kneeL")!, kneeR: legR.getObjectByName("kneeR")!, armL, armR, elbowL, elbowR, head, hand };
  const f: Figure = { root, head, stride: 0, clock: 0, dims: d, joints, gun: null, parts: [] };
  collectParts(f);
  setGun(f, "commit");
  return f;
}

/** Swaps what sits on the neck. */
export function setHead(f: Figure, head: THREE.Object3D) {
  for (const c of [...f.head.children]) f.head.remove(c);
  f.head.add(head);
  collectParts(f);
}

function collectParts(f: Figure) {
  f.parts = [];
  f.root.traverse((o) => {
    if (o.userData.part) f.parts.push(o as THREE.Mesh);
  });
}

/* ---------------- the crowd ---------------- */

/** All the instances of one part shape at one gloss: the clay mesh and its ink twin, which share the matrices. */
interface Batch { body: THREE.InstancedMesh; ink: THREE.InstancedMesh; cap: number; n: number }

const instMats = new Map<number, THREE.MeshStandardMaterial>();
const instMat = (gloss: number) => {
  let m = instMats.get(gloss);
  if (!m) instMats.set(gloss, (m = new THREE.MeshStandardMaterial({ roughness: gloss, metalness: 0.04 })));
  return m;
};

export interface Crowd {
  /** Add this to the scene: the instanced meshes hang off it. */
  root: THREE.Group;
  add(f: Figure): void;
  remove(f: Figure): void;
  /** After posing: copies every visible figure's parts into the instances. */
  update(): void;
}

export function createCrowd(): Crowd {
  const root = new THREE.Group(), figures = new Set<Figure>(), batches = new Map<string, Batch>();
  const keyOf = (p: THREE.Mesh) => `${p.geometry.uuid}:${(p.material as THREE.MeshStandardMaterial).roughness}`;

  function room(key: string, p: THREE.Mesh, need: number): Batch {
    let b = batches.get(key);
    if (b && need <= b.cap) return b;
    if (b) root.remove(b.body, b.ink), b.body.dispose(), b.ink.dispose();
    const cap = Math.max(32, 2 ** Math.ceil(Math.log2(need)));
    const body = new THREE.InstancedMesh(p.geometry, instMat((p.material as THREE.MeshStandardMaterial).roughness), cap);
    const ink = new THREE.InstancedMesh(p.geometry, OUTLINE, cap);
    ink.instanceMatrix = body.instanceMatrix;
    body.castShadow = true;
    body.frustumCulled = ink.frustumCulled = false;
    ink.name = "ink";
    root.add(body, ink);
    batches.set(key, (b = { body, ink, cap, n: 0 }));
    return b;
  }

  return {
    root,
    add: (f) => void figures.add(f),
    remove: (f) => void figures.delete(f),
    update() {
      const need = new Map<string, { p: THREE.Mesh; n: number }>();
      const shown: Figure[] = [];
      for (const f of figures) {
        if (!f.root.visible) continue;
        f.root.updateMatrixWorld(true);
        shown.push(f);
        for (const p of f.parts) {
          const k = keyOf(p), e = need.get(k);
          if (e) e.n++;
          else need.set(k, { p, n: 1 });
        }
      }
      for (const b of batches.values()) b.n = 0;
      for (const [k, e] of need) room(k, e.p, e.n);
      for (const f of shown) {
        for (const p of f.parts) {
          const b = batches.get(keyOf(p))!;
          b.body.setMatrixAt(b.n, p.matrixWorld);
          b.body.setColorAt(b.n, (p.material as THREE.MeshStandardMaterial).color);
          b.n++;
        }
      }
      for (const b of batches.values()) {
        b.body.count = b.ink.count = b.n;
        b.body.visible = b.ink.visible = b.n > 0;
        b.body.instanceMatrix.needsUpdate = true;
        if (b.body.instanceColor) b.body.instanceColor.needsUpdate = true;
      }
    },
  };
}

export interface PoseState {
  pose: Pose;
  /** Ground speed, m/s. */
  speed: number;
  /** Seconds since the last pose. */
  dt: number;
  /** 0..1 through a dive-roll. */
  roll: number;
  /** Where the arms point, up (+) or down. */
  pitch: number;
  /** How the figure is moving against where it faces, m/s: forward (+) or back, right (+) or left. */
  forward?: number;
  side?: number;
  /** -1..1: leaning out round a corner, left (-) or right. The upper body (gun and all) tips over so the head goes LEAN_REACH sideways; the feet stay planted. */
  lean?: number;
  /** 0..1: a shot just went off (the gun kicks up), it just got hit (it jolts back, to `flinchSide`), it just landed (it dips). */
  kick?: number;
  flinch?: number;
  flinchSide?: number;
  land?: number;
  /** 0..1 through putting a fresh magazine in: the gun dips and the left hand goes down for it. */
  reload?: number;
  /** How fast the joints ease to the pose, per second. Leave it out to snap. */
  blend?: number;
}

const RUN = 7.5;
const NAMES = ["tumble", "body", "spine", "legL", "legR", "kneeL", "kneeR", "armL", "armR", "elbowL", "elbowR", "head"] as const;
const was = NAMES.map(() => ({ q: new THREE.Quaternion(), p: new THREE.Vector3() }));

/** Puts the figure in a pose. Runs every frame; walking advances its stride. */
export function pose(f: Figure, s: PoseState) {
  const { waist: WAIST, hip: HIP, thigh: THIGH } = f.dims;
  const j = f.joints;
  const { tumble, body, spine, legL, legR, kneeL, kneeR, armL, armR, elbowL, elbowR, head } = j as Record<(typeof NAMES)[number], THREE.Object3D>;
  const blending = !!s.blend && s.dt > 0;
  if (blending) NAMES.forEach((n, i) => (was[i]!.q.copy(j[n]!.quaternion), was[i]!.p.copy(j[n]!.position)));
  f.clock += s.dt;

  const set = (g: THREE.Object3D, x: number, z = 0, y = 0) => g.rotation.set(x, y, z);
  for (const g of [tumble, spine, legL, legR, kneeL, kneeR, head]) set(g, 0);
  tumble.position.y = WAIST;
  body.position.y = -WAIST;
  // Holding the gun: the right upper arm hangs a little under the aim with the forearm (and the gun along
  // it) bent up onto the line; the left arm reaches across, elbow bent, to the barrel. Aiming up leans the
  // chest back a little and the arms do the rest; the head looks where the gun does.
  const tilt = s.pitch * 0.3, kick = s.kick ?? 0, flinch = s.flinch ?? 0;
  const aim = Math.PI / 2 + s.pitch - tilt + kick * 0.4, bendR = 0.35, bendL = 0.6;
  set(armR, aim - bendR, -0.2), set(elbowR, bendR);
  set(armL, aim - bendL, 0.85), set(elbowL, bendL);
  spine.rotation.x = tilt + kick * 0.1 + flinch * 0.35;
  spine.rotation.z = -(s.flinchSide ?? 0) * flinch * 0.3;
  head.rotation.x = s.pitch * 0.45 - tilt;

  const sp = Math.max(1e-6, s.speed), fw = (s.forward ?? s.speed) / sp, sd = (s.side ?? 0) / sp;
  if (s.pose === "stand") {
    // Running: legs swing the way you're going (sideways when strafing, the stride reversed backing
    // up), the body leans into it and bobs twice a stride, and the elbows give with each step so the
    // gun rides the stride instead of floating. Standing still, it breathes.
    const k = Math.min(1, s.speed / RUN), back = fw < -0.3 ? -1 : 1;
    f.stride += s.speed * s.dt * 1.9 * back;
    const a = Math.sin(f.stride) * 0.8 * k, swingX = Math.max(Math.abs(fw), 0.25) * Math.sign(fw || 1) * back, swingZ = sd * 0.55;
    set(legL, a * swingX, a * swingZ), set(legR, -a * swingX, -a * swingZ);
    set(kneeL, -Math.max(0, -Math.cos(f.stride) * back) * 1.2 * k), set(kneeR, -Math.max(0, Math.cos(f.stride) * back) * 1.2 * k);
    const give = Math.abs(Math.sin(f.stride)) * 0.18 * k;
    elbowR.rotation.x += give, elbowL.rotation.x += give;
    armR.rotation.x -= give * 0.6, armL.rotation.x -= give * 0.6;
    spine.rotation.x -= 0.2 * k * fw;
    spine.rotation.y = Math.sin(f.stride) * 0.12 * k;
    tumble.rotation.z = -sd * 0.12 * k;
    tumble.rotation.x = -0.06 * k * fw;
    body.position.y = -WAIST - Math.abs(Math.sin(f.stride)) * 0.06 * k + (1 - k) * Math.sin(f.clock * 2.2) * 0.008;
    spine.rotation.x += (1 - k) * Math.sin(f.clock * 2.2) * 0.02;
  } else if (s.pose === "kneel") {
    // Down on the right knee, the left foot planted ahead; shuffling, it bobs.
    body.position.y = -WAIST - (HIP - THIGH - 0.1) - Math.abs(Math.sin(f.stride)) * 0.03 * Math.min(1, s.speed / 3);
    f.stride += s.speed * s.dt * 2.4;
    set(legL, 1.5), set(kneeL, -1.5);
    set(legR, -0.1), set(kneeR, -1.45);
    spine.rotation.x += -0.12;
  } else if (s.pose === "prone") {
    // Face down, head forward, the gun out in front on bent elbows; the legs scissor and the elbows dig when crawling.
    tumble.rotation.x = -Math.PI / 2;
    tumble.position.y = 0.3 * Math.max(0.85, f.dims.chest * 0.9);
    f.stride += s.speed * s.dt * 3;
    const k = Math.min(1, s.speed / 1.5);
    set(legL, Math.sin(f.stride) * 0.3 * k, -0.1), set(legR, -Math.sin(f.stride) * 0.3 * k, 0.1);
    set(kneeL, -Math.max(0, Math.sin(f.stride)) * 0.8 * k), set(kneeR, -Math.max(0, -Math.sin(f.stride)) * 0.8 * k);
    const dig = 0.15;
    set(armR, Math.PI - 0.1 - dig + s.pitch * 0.5 + kick * 0.2 + Math.sin(f.stride) * 0.15 * k, 0.05), set(elbowR, dig);
    set(armL, Math.PI - 0.15 - dig - Math.sin(f.stride) * 0.15 * k, -0.3), set(elbowL, dig);
    spine.rotation.set(0, 0, 0);
    head.rotation.x = 1.1 + s.pitch * 0.3;
  } else if (s.pose === "tuck") {
    // A dive-roll: balled up, one full forward somersault round the waist.
    set(legL, 2.1), set(legR, 2.1), set(kneeL, -2.4), set(kneeR, -2.4);
    spine.rotation.set(-0.7, 0, 0);
    set(armL, 0.9, -0.2), set(armR, 0.9, 0.2), set(elbowL, 1.5), set(elbowR, 1.5);
    tumble.rotation.x = -s.roll * Math.PI * 2;
    tumble.position.y = WAIST * 0.6;
  } else if (s.pose === "air") {
    // Jumping: one knee up, the other leg trailing, still aiming.
    set(legL, 0.9), set(kneeL, -1.3);
    set(legR, -0.25), set(kneeR, -0.7);
    spine.rotation.x -= 0.1;
  } else if (s.pose === "star") {
    // Thrown by a blast or on fire: arms and legs flung wide, flailing.
    const w = Math.sin(f.clock * 18) * 0.35;
    set(armL, w, -2.1), set(armR, -w, 2.1), set(elbowL, 0.3 + w), set(elbowR, 0.3 - w);
    set(legL, -w, -0.5), set(legR, w, 0.5), set(kneeL, -0.3), set(kneeR, -0.3);
    tumble.rotation.x = -0.4;
    spine.rotation.set(0.2, 0, 0);
  } else if (s.pose === "hang") {
    // Under a parachute: arms straight up on the risers, legs dangling a little bent, the whole
    // figure swinging slowly in the harness.
    const sway = f.clock * 1.1;
    set(armL, Math.PI - 0.1, -0.3), set(armR, Math.PI - 0.1, 0.3), set(elbowL, 0.12), set(elbowR, 0.12);
    set(legL, 0.3 + Math.sin(sway) * 0.08, -0.12), set(legR, 0.18 - Math.sin(sway) * 0.08, 0.12);
    set(kneeL, -0.55), set(kneeR, -0.4);
    tumble.rotation.set(Math.sin(sway * 0.8) * 0.06, 0, Math.sin(sway) * 0.07);
    spine.rotation.set(0.1, 0, 0);
    head.rotation.x = -0.25 + s.pitch * 0.3;
  } else {
    // Surrender: on its knees, hands up, elbows out.
    body.position.y = -WAIST - (HIP - THIGH - 0.14);
    set(legL, -0.05), set(legR, -0.05), set(kneeL, -1.5), set(kneeR, -1.5);
    set(armL, Math.PI - 0.7, -0.4), set(armR, Math.PI - 0.7, 0.4), set(elbowL, 0.55), set(elbowR, 0.55);
    spine.rotation.set(0.15, 0, 0);
    head.rotation.x = 0.35;
  }
  // Leaning out round a corner: the waist tips a little and the spine the rest, so the head ends up
  // LEAN_REACH out to the side with the gun along; the legs tip back the other way to stay planted.
  const lean = s.lean ?? 0;
  if (lean && s.pose !== "prone" && s.pose !== "tuck" && s.pose !== "hang") {
    const a = Math.asin(Math.min(0.95, LEAN_REACH / f.dims.neck)) * lean;
    tumble.rotation.z -= a * 0.35;
    legL.rotation.z += a * 0.35, legR.rotation.z += a * 0.35;
    spine.rotation.z -= a * 0.65;
    head.rotation.z += a * 0.3;
  }
  // Reloading: the gun tips down and the left hand drops to the magazine and back.
  const rl = s.reload ? Math.sin(s.reload * Math.PI) : 0;
  if (rl > 0 && s.pose !== "tuck" && s.pose !== "star" && s.pose !== "surrender" && s.pose !== "hang") armR.rotation.x -= 0.55 * rl, armL.rotation.x -= 1.2 * rl, elbowL.rotation.x += 0.4 * rl, head.rotation.x -= 0.3 * rl;
  // Landing: the knees give and the body dips.
  const land = s.land ?? 0;
  if (land > 0 && s.pose !== "prone" && s.pose !== "tuck" && s.pose !== "hang") {
    body.position.y -= land * 0.16;
    legL.rotation.x += land * 0.5, legR.rotation.x += land * 0.5;
    kneeL.rotation.x -= land * 0.9, kneeR.rotation.x -= land * 0.9;
  }

  if (!blending) return;
  // Ease every joint from where it was towards where the pose put it. The roll's somersault
  // is a whole turn, which easing would cut short, so the waist follows it exactly.
  const a = 1 - Math.exp(-s.blend! * s.dt);
  NAMES.forEach((n, i) => {
    if (n === "tumble" && s.pose === "tuck") return;
    const g = j[n]!;
    g.quaternion.copy(was[i]!.q.slerp(g.quaternion, a));
    g.position.lerpVectors(was[i]!.p, g.position, a);
  });
}
