// A hand in three.js: the skin (skin.ts) meshed once and bound to a bone per joint of the skeleton (skeleton.ts), a
// nail on each last joint, and `placeHand` to set every bone from a placement and a joint turn each. The left hand is
// the right one mirrored. Sound Guy Simulator's first-person hands and Qollab Studio's players wear the same one.
import * as THREE from "three";
import type { HandPose } from "./grip.ts";
import { HAND, type V3 } from "./skeleton.ts";
import { buildSkin, type SkinMesh } from "./skin.ts";

export type Side = -1 | 1;

/** The skin, meshed once for both hands (the left is it mirrored). */
let skinGeo: { right: THREE.BufferGeometry; left: THREE.BufferGeometry; nails: SkinMesh["nails"] } | null = null;
function skinGeometry() {
  if (skinGeo) return skinGeo;
  const s = buildSkin(), g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(s.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(s.normals, 3));
  g.setAttribute("color", new THREE.BufferAttribute(s.colors, 3));
  g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(s.joints, 4));
  g.setAttribute("skinWeight", new THREE.BufferAttribute(s.weights, 4));
  g.setIndex(new THREE.BufferAttribute(s.index, 1));
  return (skinGeo = { right: g, left: mirrored(g), nails: s.nails });
}

/** A geometry mirrored in x, its triangles turned back round so they still face out. */
function mirrored(g: THREE.BufferGeometry) {
  const m = g.clone().applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1)), ix = m.getIndex()!;
  for (let i = 0; i < ix.count; i += 3) { const a = ix.getX(i + 1); ix.setX(i + 1, ix.getX(i + 2)); ix.setX(i + 2, a); }
  return m;
}

/** The skin's own tone (linear light): its vertex colours are this with the palm lighter and the tips flushed, so a
 *  material coloured `tone / SKIN_TONE` wears another skin and keeps that shading. */
export const SKIN_TONE = new THREE.Color().setRGB(0.71 ** 2.2, 0.48 ** 2.2, 0.35 ** 2.2);

export type HandMesh = { root: THREE.Group; bones: THREE.Bone[]; side: Side; mats: THREE.Matrix4[] };

/** One hand: a joint per bone (its matrix set by `placeHand`), the skin over them, and a nail riding each last joint. */
export function handMesh(side: Side, skin: THREE.Material, nail: THREE.Material): HandMesh {
  const root = new THREE.Group(), geo = skinGeometry();
  const m = (v: V3): V3 => [v[0] * side, v[1], v[2]];
  const bones = HAND.bones.map(() => { const o = new THREE.Bone(); o.matrixAutoUpdate = false; root.add(o); return o; });
  // Bound at rest: each joint where the skeleton puts it, turned the way the skin was meshed.
  const inverses = HAND.bones.map((b) => { const a = m(b.at); return new THREE.Matrix4().makeTranslation(-a[0], -a[1], -a[2]); });
  const mesh = new THREE.SkinnedMesh(side > 0 ? geo.right : geo.left, skin);
  mesh.bind(new THREE.Skeleton(bones, inverses), new THREE.Matrix4());
  mesh.frustumCulled = false;
  root.add(mesh);
  const nailGeo = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  for (const n of geo.nails) {
    const b = HAND.bones[n.bone].at, across = new THREE.Vector3(...n.along).cross(new THREE.Vector3(...n.out));
    const o = new THREE.Mesh(nailGeo, nail);
    // a shallow dome on the back of the finger: wide across it, long along it, barely raised
    const basis = new THREE.Matrix4().makeBasis(across.multiplyScalar(n.w / 2), new THREE.Vector3(...n.out).multiplyScalar(0.0034), new THREE.Vector3(...n.along).multiplyScalar(n.l / 2));
    basis.setPosition(n.at[0] - b[0], n.at[1] - b[1], n.at[2] - b[2]);
    if (side < 0) basis.premultiply(new THREE.Matrix4().makeScale(-1, 1, 1));
    o.matrix.copy(basis);
    o.matrixAutoUpdate = false;
    bones[n.bone].add(o);
  }
  return { root, bones, side, mats: HAND.bones.map(() => new THREE.Matrix4()) };
}

/** A pose's joint rotations, each relative to its parent's, so two poses blend joint by joint. */
export function localQuats(p: HandPose): THREE.Quaternion[] {
  const w = HAND.bones.map((_, j) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().fromArray(p.mats, j * 16)));
  return HAND.bones.map((b, j) => (b.parent < 0 ? w[j].clone() : w[b.parent].clone().invert().multiply(w[j])));
}

const mLocal = new THREE.Matrix4(), mJoint = new THREE.Matrix4(), mirrorX = new THREE.Matrix4().makeScale(-1, 1, 1);

/** Set every bone: `place` is the wrist's frame in the root's parent space (a right hand's axes, the left's too: the
 *  mirror is done here), `turns` each joint's rotation relative to its parent (localQuats). Down the chain, each joint's
 *  rest offset from its parent, then its turn. `h.mats` keeps each joint in the hand's own (unmirrored) frame. */
export function placeHand(h: HandMesh, place: THREE.Matrix4, turns: THREE.Quaternion[]) {
  HAND.bones.forEach((b, j) => {
    mLocal.makeRotationFromQuaternion(turns[j]);
    if (b.parent < 0) { h.mats[j].copy(mLocal); return; }
    const p = HAND.bones[b.parent].at;
    mLocal.setPosition(b.at[0] - p[0], b.at[1] - p[1], b.at[2] - p[2]);
    h.mats[j].multiplyMatrices(h.mats[b.parent], mLocal);
  });
  HAND.bones.forEach((_, j) => {
    // The left hand is the right one mirrored: S J S, in its own mirrored frame.
    mJoint.copy(h.mats[j]);
    if (h.side < 0) mJoint.premultiply(mirrorX).multiply(mirrorX);
    h.bones[j].matrix.multiplyMatrices(place, mJoint);
    h.bones[j].matrixWorldNeedsUpdate = true;
  });
}
