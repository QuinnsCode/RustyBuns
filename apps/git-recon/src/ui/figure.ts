// The soldiers: soft clay mannequins. Fat rounded limbs that run into each other,
// a ball for a head, no hands, feet or face. Yours is glossy black, the guards are
// orange. The head is a slot: a plain ball, or a block with a logo on it (heads.ts).
//
// Joints are groups; every limb hangs down its group's -y, so rotating a joint by +x
// swings the limb forward (towards -z, the way the figure faces) and -x swings it back.
//
//   root     at the feet, turned to the soldier's yaw
//   tumble   at the waist, for rolls and lying prone
//   body     the figure, feet at the root again
//     hips → legL/legR (hip → knee) and spine → armL/armR (shoulder), head, the gun in the right hand

import * as THREE from "three";

export type Pose = "stand" | "kneel" | "prone" | "tuck" | "star" | "surrender";

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

/** A build's joints, in metres. */
interface Dims { waist: number; hip: number; thigh: number; shin: number; shoulder: number; arm: number; neck: number; girth: number; chest: number; head: number }

function dims(b: Build): Dims {
  const t = b.tall;
  return { waist: 0.9 * t, hip: 0.88 * t, thigh: 0.44 * t, shin: 0.44 * t, shoulder: 0.5 * t, arm: 0.46 * t, neck: 0.78 * t, girth: b.girth, chest: b.chest, head: b.head };
}

export interface Figure {
  root: THREE.Group;
  /** The head slot: empty it and add a new head to swap. */
  head: THREE.Group;
  /** Distance walked, which sets the stride. */
  stride: number;
  dims: Dims;
}

function limb(mat: THREE.Material, r: number, len: number, name: string): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 6, 16), mat);
  m.position.y = -len / 2;
  m.castShadow = true;
  m.name = name;
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
  const knee = group("knee", 0, -d.thigh, 0);
  knee.add(limb(mat, 0.12 * d.girth, d.shin + 0.08, "shin"));
  hip.add(knee);
  return hip;
}

/** The plain head: a ball the same stuff as the body. */
export function ballHead(mat: THREE.Material, size = 1): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.21 * size, 24, 16), mat);
  m.castShadow = true;
  return m;
}

export function buildFigure(color: number, gloss: number, build: BuildId = "average"): Figure {
  const d = dims(BUILDS[build]);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: gloss, metalness: 0.04 });
  const root = group("figure");
  root.rotation.order = "YXZ";
  root.userData.mat = mat;
  const tumble = group("tumble", 0, d.waist, 0);
  const body = group("body", 0, -d.waist, 0);
  const hips = group("hips", 0, d.hip, 0);
  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.23, 20, 14), mat);
  pelvis.scale.set(1.05 * d.chest, 0.8, 0.85 * Math.max(1, d.girth * 0.9));
  pelvis.castShadow = true;
  const spine = group("spine");
  const torso = limb(mat, 0.25, 0.62 * (d.neck / 0.78), "torso");
  torso.position.y = 0.3 * (d.neck / 0.78);
  torso.scale.set(d.chest, 1, 0.8 * Math.max(0.8, d.chest * 0.9));
  const sx = 0.3 * d.chest;
  const armL = group("armL", -sx, d.shoulder, 0), armR = group("armR", sx, d.shoulder, 0);
  armL.add(limb(mat, 0.095 * d.girth, d.arm, "arm"));
  armR.add(limb(mat, 0.095 * d.girth, d.arm, "arm"));
  // The gun lies along the right forearm and sticks out past the hand, so it points wherever the arm does.
  // Paper white with ink lines, so it reads on a black body and an orange one.
  const gunGeo = new THREE.BoxGeometry(0.09, 0.62, 0.12);
  const gun = new THREE.Mesh(gunGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }));
  gun.add(new THREE.LineSegments(new THREE.EdgesGeometry(gunGeo), new THREE.LineBasicMaterial({ color: 0x1f1f1f })));
  gun.position.set(0, -d.arm - 0.12, 0.02);
  gun.castShadow = true;
  gun.name = "gun";
  armR.add(gun);
  const head = group("head", 0, d.neck, 0);
  head.userData.size = d.head;
  head.add(ballHead(mat, d.head));
  spine.add(torso, armL, armR, head);
  hips.add(pelvis, spine, leg(mat, d, -1), leg(mat, d, 1));
  body.add(hips);
  tumble.add(body);
  root.add(tumble);
  return { root, head, stride: 0, dims: d };
}

/** Swaps what sits on the neck. */
export function setHead(f: Figure, head: THREE.Object3D) {
  for (const c of [...f.head.children]) f.head.remove(c);
  f.head.add(head);
}

export interface PoseState {
  pose: Pose;
  /** Ground speed, m/s. */
  speed: number;
  /** Seconds into the move, for walking and rolling. */
  dt: number;
  /** 0..1 through a dive-roll. */
  roll: number;
  /** Where the arms point, up (+) or down. */
  pitch: number;
}

const set = (g: THREE.Object3D | undefined, x: number, z = 0) => g && g.rotation.set(x, 0, z);

/** Puts the figure in a pose. Runs every frame; walking advances its stride. */
export function pose(f: Figure, s: PoseState) {
  const { waist: WAIST, hip: HIP, thigh: THIGH } = f.dims;
  const get = (name: string) => f.root.getObjectByName(name)!;
  const tumble = get("tumble"), body = get("body"), spine = get("spine"), legL = get("legL"), legR = get("legR"), armL = get("armL"), armR = get("armR");
  const kneeL = legL.getObjectByName("knee")!, kneeR = legR.getObjectByName("knee")!;
  tumble.rotation.set(0, 0, 0);
  tumble.position.y = WAIST;
  body.position.y = -WAIST;
  spine.rotation.set(0, 0, 0);
  // Holding the gun: both arms forward, the left one reaching across to the barrel.
  const aim = Math.PI / 2 + s.pitch;
  set(armR, aim, 0.05);
  set(armL, aim, -0.45);
  armL.rotation.y = -0.5;

  if (s.pose === "stand") {
    const k = Math.min(1, s.speed / 7.5);
    f.stride += s.speed * s.dt * 1.9;
    const a = Math.sin(f.stride) * 0.75 * k, b = Math.sin(f.stride + Math.PI) * 0.75 * k;
    set(legL, a), set(legR, b);
    set(kneeL, -Math.max(0, -Math.cos(f.stride)) * 1.1 * k), set(kneeR, -Math.max(0, Math.cos(f.stride)) * 1.1 * k);
    spine.rotation.x = 0.12 * k;
    body.position.y = -WAIST - Math.abs(Math.sin(f.stride)) * 0.04 * k;
  } else if (s.pose === "kneel") {
    // Down on the right knee, the left foot planted ahead.
    body.position.y = -WAIST - (HIP - THIGH - 0.06);
    set(legL, 1.5), set(kneeL, -1.5);
    set(legR, -0.1), set(kneeR, -1.45);
    spine.rotation.x = 0.15;
  } else if (s.pose === "prone") {
    // Face down, head forward, the gun out in front; the legs scissor when crawling.
    tumble.rotation.x = -Math.PI / 2;
    tumble.position.y = 0.26 * Math.max(0.85, f.dims.chest * 0.9);
    f.stride += s.speed * s.dt * 3;
    const k = Math.min(1, s.speed / 1.5);
    set(legL, Math.sin(f.stride) * 0.3 * k, -0.1), set(legR, -Math.sin(f.stride) * 0.3 * k, 0.1);
    set(kneeL, -Math.max(0, Math.sin(f.stride)) * 0.8 * k), set(kneeR, -Math.max(0, -Math.sin(f.stride)) * 0.8 * k);
    set(armR, Math.PI - 0.15 + s.pitch * 0.5, 0.05), set(armL, Math.PI - 0.2, -0.3);
  } else if (s.pose === "tuck") {
    // A dive-roll: balled up, one full forward somersault round the waist.
    set(legL, 2.1), set(legR, 2.1), set(kneeL, -2.4), set(kneeR, -2.4);
    spine.rotation.x = 0.7;
    set(armL, 1.2, -0.2), set(armR, 1.2, 0.2);
    tumble.rotation.x = -s.roll * Math.PI * 2;
    tumble.position.y = WAIST * 0.6;
  } else if (s.pose === "star") {
    // Thrown by a blast: arms and legs flung wide.
    set(armL, 0, -2.1), set(armR, 0, 2.1), armL.rotation.y = 0;
    set(legL, 0, -0.5), set(legR, 0, 0.5), set(kneeL, 0), set(kneeR, 0);
    tumble.rotation.x = -0.4;
  } else {
    // Surrender: on its knees, hands up.
    body.position.y = -WAIST - (HIP - THIGH - 0.1);
    set(legL, -0.05), set(legR, -0.05), set(kneeL, -1.5), set(kneeR, -1.5);
    set(armL, Math.PI - 0.25, -0.35), set(armR, Math.PI - 0.25, 0.35), armL.rotation.y = 0;
  }
}
