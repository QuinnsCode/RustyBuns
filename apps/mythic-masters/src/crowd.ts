// The stadium crowd: "a list of models + instanced placements". A CrowdModel is a few parts (torso, head, hat, two
// arms); every model becomes one InstancedMesh per part, and a seat is just a place and a pick of model, so more
// models (later: players' own) are added to CROWD_MODELS or passed to buildCrowd. Figures are in metres, about 0.6
// tall, local +x pointing away from the ring (they face -x), shoulders along z.
import * as THREE from "three";

/** What colours a part: the person's shirt, their skin tone, their hat, or one fixed colour. */
export type Tint = "shirt" | "skin" | "hat" | number;
export interface CrowdPart {
  geo: THREE.BufferGeometry;
  tint: Tint;
  /** An arm: pivots at `pivot` about the x axis; side is -1 (left, -z) or 1 (right, +z). Hangs down at rest, up when cheering. */
  arm?: { pivot: THREE.Vector3; side: -1 | 1 };
}
export interface CrowdModel { name: string; parts: CrowdPart[] }
export interface Seat { pos: THREE.Vector3; yaw: number }

const box = (w: number, h: number, d: number, y: number) => new THREE.BoxGeometry(d, h, w).translate(0, y, 0);

function figure(name: string, o: { wide?: number; hat?: "cap" | "cone" | "bobble" | null } = {}): CrowdModel {
  const w = o.wide ?? 1, shoulder = 0.13 * w;
  const parts: CrowdPart[] = [
    { geo: box(0.22 * w, 0.28, 0.15, 0.14), tint: "shirt" },
    { geo: new THREE.SphereGeometry(0.095, 8, 6).translate(0, 0.37, 0), tint: "skin" },
  ];
  for (const side of [-1, 1] as const) {
    parts.push({ geo: new THREE.BoxGeometry(0.06, 0.2, 0.06).translate(0, -0.1, 0), tint: "shirt", arm: { pivot: new THREE.Vector3(0, 0.27, side * shoulder), side } });
  }
  if (o.hat === "cap") parts.push({ geo: new THREE.SphereGeometry(0.1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.39, 0), tint: "hat" }, { geo: box(0.12, 0.015, 0.09, 0.4).translate(-0.09, 0, 0), tint: "hat" });
  if (o.hat === "cone") parts.push({ geo: new THREE.ConeGeometry(0.075, 0.2, 6).translate(0, 0.54, 0), tint: "hat" });
  if (o.hat === "bobble") parts.push({ geo: new THREE.SphereGeometry(0.1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.4, 0), tint: "hat" }, { geo: new THREE.SphereGeometry(0.035, 6, 4).translate(0, 0.5, 0), tint: 0xf2f2f2 });
  return { name, parts };
}

/** The default people. Weights say how common each is in the stands. */
export const CROWD_MODELS: { model: CrowdModel; weight: number }[] = [
  { model: figure("fan"), weight: 5 },
  { model: figure("big fan", { wide: 1.3 }), weight: 2 },
  { model: figure("cap", { hat: "cap" }), weight: 3 },
  { model: figure("party hat", { hat: "cone" }), weight: 1 },
  { model: figure("beanie", { hat: "bobble" }), weight: 2 },
];

const SHIRTS = [0xc8423a, 0x2f6fb8, 0xe8e2d0, 0x3a3a42, 0xe0a83a, 0x4a8a4a, 0x8a4ab0, 0xd87a9a, 0x6a5040];
const SKINS = [0xe8c4a0, 0xc89870, 0x8a5a3a, 0x5a3a28, 0xf0d0b0];
const HATS = [0xc8423a, 0x2f6fb8, 0xe0a83a, 0x4a8a4a, 0x2a2a30, 0xf2f2e6];
const SIZE = 1.35; // people are drawn this much bigger than their model, so fewer of them read as people, not dots
const RAISED = 2.9; // radians an arm swings from hanging to up

export interface Crowd {
  group: THREE.Group;
  people: number;
  /** A hit landed: the stands get to their feet, in proportion (0..1). */
  cheer(strength: number): void;
  /** Eases the cheer off and moves the arms; call each frame. */
  update(dt: number): void;
}

export function buildCrowd(seats: Seat[], rnd: () => number, models = CROWD_MODELS): Crowd {
  const group = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  const total = models.reduce((s, m) => s + m.weight, 0);
  const pick = () => { let r = rnd() * total; for (const m of models) if ((r -= m.weight) < 0) return m.model; return models[0]!.model; };
  const by = new Map<CrowdModel, { seat: Seat; shirt: THREE.Color; skin: THREE.Color; hat: THREE.Color; fire: number }[]>();
  for (const seat of seats) {
    const model = pick(), list = by.get(model) ?? [];
    by.set(model, list);
    list.push({ seat, shirt: new THREE.Color(SHIRTS[Math.floor(rnd() * SHIRTS.length)]!).lerp(new THREE.Color(0x707070), 0.4), skin: new THREE.Color(SKINS[Math.floor(rnd() * SKINS.length)]!), hat: new THREE.Color(HATS[Math.floor(rnd() * HATS.length)]!), fire: rnd() });
  }
  const armers: { mesh: THREE.InstancedMesh; part: CrowdPart; people: { seat: Seat; fire: number }[] }[] = [];
  const place = new THREE.Matrix4(), local = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(SIZE, SIZE, SIZE);
  for (const [model, people] of by) {
    for (const part of model.parts) {
      const mesh = new THREE.InstancedMesh(part.geo, mat, people.length);
      mesh.frustumCulled = false; mesh.castShadow = false;
      people.forEach((p, i) => {
        place.compose(p.seat.pos, q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.seat.yaw), one);
        if (part.arm) place.multiply(local.makeTranslation(part.arm.pivot.x, part.arm.pivot.y, part.arm.pivot.z));
        mesh.setMatrixAt(i, place);
        mesh.setColorAt(i, typeof part.tint === "number" ? new THREE.Color(part.tint) : p[part.tint]);
      });
      group.add(mesh);
      if (part.arm) armers.push({ mesh, part, people });
    }
  }
  let excite = 0, drawn = 1;
  const axis = new THREE.Vector3(1, 0, 0), swing = new THREE.Quaternion(), yaw = new THREE.Vector3(0, 1, 0), at = new THREE.Vector3();
  const pose = () => {
    for (const { mesh, part, people } of armers) {
      const arm = part.arm!;
      people.forEach((p, i) => {
        // each person gets up a little after or before their neighbour, and a cheer big enough reaches everyone
        const up = Math.min(1, Math.max(0, excite * 1.6 - p.fire * 0.6));
        const wave = up * (0.85 + 0.15 * Math.sin(performance.now() / 120 + p.fire * 40));
        q.setFromAxisAngle(yaw, p.seat.yaw);
        swing.setFromAxisAngle(axis, arm.side * RAISED * wave);
        at.copy(arm.pivot).multiplyScalar(SIZE).applyQuaternion(q).add(p.seat.pos);
        mesh.setMatrixAt(i, place.compose(at, q.multiply(swing), one));
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  };
  return {
    group, people: seats.length,
    cheer(strength) { excite = Math.min(1, Math.max(excite, strength)); },
    update(dt) {
      if (excite <= 0 && drawn <= 0) return;
      excite = Math.max(0, excite - dt * 0.45); drawn = excite;
      pose();
    },
  };
}
