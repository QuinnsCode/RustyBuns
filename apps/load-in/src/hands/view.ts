// The two hands drawn: bare forearms and one smooth skin per hand (skin.ts: palm, knuckles, the thumb's web, tapered
// fingers and nails) over the skeleton's joints, posed by the grip solver (grip.ts) and placed by place.ts.
// `handsView(scene, camera)` takes a camera and a `Hold` and nothing from the game world, so any page can show them. A
// new grip is solved once (cached) and blended in over a fifth of a second, joint by joint; a frame only composes
// matrices. The forearm's material has an empty `tattoo` slot (its map) and the forearm's UVs run as one clean
// rectangle, round the arm by wrist to elbow, for the tattoos of #5029's step 11.
import * as THREE from "three";
import { HandSolver, gripFor, type HandPose, type What } from "./grip.ts";
import { type Box, type Frame, type Side, carryFrames, elbow, showFrame, viewFrame } from "./place.ts";
import { FINGERS, FOREARM, HAND, type V3 } from "./skeleton.ts";
import { buildSkin, type SkinMesh } from "./skin.ts";
import { connectorMesh } from "../cables/ends-view.ts";
import type { Connector } from "../cables/ends.ts";

/** What your hands are doing: each hand's grip, the weight in them, and if it's a carry, the box; a cable end's lead. */
export type Hold = {
  right: What;
  left: What;
  kg: number;
  /** a cabinet carried in both hands (world space) */
  carry?: Box;
  /** where the cable leaving your fist goes (world space), its colour, and the connector on the end you hold */
  lead?: { at: V3; color: number; end?: Connector };
  /** looking at your arms: both forearms raised into view (empty hands only) */
  show?: boolean;
};

const SKIN = 0xb57a58;
const BLEND = 0.2;

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

/** One hand: a joint per bone (its matrix set each frame), the skin over them, and a nail riding each last joint. */
function handMesh(side: Side, skin: THREE.Material, nail: THREE.Material) {
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
  return { root, bones };
}

/** A pose's joint rotations, each relative to its parent's, so two poses blend joint by joint. */
function localQuats(p: HandPose): THREE.Quaternion[] {
  const w = HAND.bones.map((_, j) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().fromArray(p.mats, j * 16)));
  return HAND.bones.map((b, j) => (b.parent < 0 ? w[j].clone() : w[b.parent].clone().invert().multiply(w[j])));
}


/** Your two hands and forearms, children of the camera. `update(hold, t, speed)` each frame; `state()` for the harness. */
export function handsView(scene: THREE.Scene, camera: THREE.Camera) {
  const solver = new HandSolver();
  const skin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.58, metalness: 0 });
  const nail = new THREE.MeshStandardMaterial({ color: 0xc99a86, roughness: 0.35, metalness: 0 });
  /** The forearm's skin: its `map` is the tattoo slot, empty until a tattoo is put there. */
  const arm = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.58, metalness: 0 });
  arm.userData.slot = "tattoo";
  /** The left forearm has its own sheet, so each arm carries its own ink. */
  const armLeft = arm.clone();
  // A tapered tube, wrist (v 0) to elbow (v 1), U once round: an unwrapped rectangle. Drawn wider across than deep, as a forearm is.
  // Its wrist end a little slimmer than the hand's wrist, which covers it (skin.ts).
  const forearmGeo = new THREE.CylinderGeometry(FOREARM.elbow, FOREARM.wrist * 0.9, 1, 32, 1, true).translate(0, 0.5, 0);
  const sides = ([1, -1] as const).map((side) => {
    const h = handMesh(side, skin, nail), forearm = new THREE.Mesh(forearmGeo, side === 1 ? arm : armLeft);
    forearm.matrixAutoUpdate = false;
    camera.add(h.root, forearm);
    return {
      side, ...h, forearm, key: "", pose: null as HandPose | null, since: 0,
      /** the joint turns and the placement shown now, and where a blend started from */
      cur: HAND.bones.map(() => new THREE.Quaternion()), from: [] as THREE.Quaternion[], to: [] as THREE.Quaternion[],
      at: new THREE.Vector3(), turn: new THREE.Quaternion(), fromAt: null as THREE.Vector3 | null, fromTurn: new THREE.Quaternion(),
      mats: HAND.bones.map(() => new THREE.Matrix4()),
    };
  });
  const lead = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1, 6).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 }));
  // The plug in your fist: the connector on the end you hold (an XLR male, a wall plug), swapped when the end changes.
  const plug = new THREE.Group();
  let plugIs: Connector | "" = "";
  const plugAs = (end: Connector) => {
    if (end === plugIs) return;
    plug.clear();
    plug.add(connectorMesh(end).translateY(-0.012));
    plugIs = end;
  };
  plugAs("xlr-m");
  scene.add(lead);
  camera.add(plug);
  lead.visible = plug.visible = false;

  const mPlace = new THREE.Matrix4(), mLocal = new THREE.Matrix4(), mJoint = new THREE.Matrix4(), mirrorX = new THREE.Matrix4().makeScale(-1, 1, 1), camInv = new THREE.Matrix4();
  const tAt = new THREE.Vector3(), tTurn = new THREE.Quaternion();
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  const toV = (v: V3, out = new THREE.Vector3()) => out.set(v[0], v[1], v[2]);
  /** The middle of what the right hand grips (world space), as of the last update: where a page hangs a coil. */
  const gripWorld = new THREE.Vector3();
  const fromV = (v: THREE.Vector3): V3 => [v.x, v.y, v.z];
  /** A world-space frame (a carry) in the camera's space. */
  const toCam = (f: Frame): Frame => {
    const r = (v: V3) => fromV(toV(v, vA).transformDirection(camInv));
    return { o: fromV(toV(f.o, vA).applyMatrix4(camInv)), x: r(f.x), y: r(f.y), z: r(f.z) };
  };

  return {
    /** Pose and place both hands for this frame; `speed` (m/s) sets the bob of your steps. */
    update(hold: Hold, t: number, speed = 0) {
      camera.updateMatrixWorld();
      camInv.copy(camera.matrixWorld).invert();
      const narrow = camera instanceof THREE.PerspectiveCamera ? Math.min(1, Math.max(0.62, camera.aspect)) : 1;
      const carry = hold.carry ? carryFrames(hold.carry, hold.kg) : null;
      for (const s of sides) {
        const what = s.side > 0 ? hold.right : hold.left, grip = gripFor(what);
        const show = !!hold.show && !carry && what.kind === "rest";
        const f = carry ? toCam(s.side > 0 ? carry.right : carry.left) : show ? showFrame(t, s.side) : viewFrame(what.kind, hold.kg, t, speed, s.side);
        // On a tall, narrow screen (a phone held upright) the hands come in toward the middle so they stay in view.
        if (!carry && narrow < 1) f.o = [f.o[0] * narrow, f.o[1], f.o[2]];
        mPlace.makeBasis(toV(f.x, vA), toV(f.y, vB), toV(f.z, vC)).setPosition(f.o[0], f.o[1], f.o[2]);
        tAt.setFromMatrixPosition(mPlace);
        tTurn.setFromRotationMatrix(mPlace);
        const key = show ? grip.key + " shown" : grip.key;
        if (key !== s.key) {
          // A new grip: solve it (once, cached) and blend from what is shown now.
          const first = !s.pose;
          s.key = key;
          s.pose = solver.pose(grip);
          s.to = localQuats(s.pose);
          s.from = first ? s.to : s.cur.map((q) => q.clone());
          s.fromAt = first ? null : s.at.clone();
          s.fromTurn.copy(s.turn);
          s.since = t;
        }
        const k = Math.min(1, Math.max(0, (t - s.since) / BLEND)), e = k * k * (3 - 2 * k);
        s.cur.forEach((q, j) => q.copy(s.from[j]).slerp(s.to[j], e));
        if (s.fromAt && e < 1) { s.at.copy(s.fromAt).lerp(tAt, e); s.turn.copy(s.fromTurn).slerp(tTurn, e); }
        else { s.at.copy(tAt); s.turn.copy(tTurn); }
        mPlace.compose(s.at, s.turn, one);
        // Down the chain: each joint's rest offset from its parent, then its turn.
        HAND.bones.forEach((b, j) => {
          mLocal.makeRotationFromQuaternion(s.cur[j]);
          if (b.parent < 0) { s.mats[j].copy(mLocal); return; }
          const p = HAND.bones[b.parent].at;
          mLocal.setPosition(b.at[0] - p[0], b.at[1] - p[1], b.at[2] - p[2]);
          s.mats[j].multiplyMatrices(s.mats[b.parent], mLocal);
        });
        HAND.bones.forEach((_, j) => {
          // The left hand is the right one mirrored: S J S, in its own mirrored frame.
          mJoint.copy(s.mats[j]);
          if (s.side < 0) mJoint.premultiply(mirrorX).multiply(mirrorX);
          s.bones[j].matrix.multiplyMatrices(mPlace, mJoint);
          s.bones[j].matrixWorldNeedsUpdate = true;
        });
        // The forearm, wrist to elbow, its flat side with the back of the hand; a touch thicker under load.
        const shown: Frame = { o: fromV(s.at), x: [0, 0, 0], y: [0, 0, 0], z: fromV(vA.set(0, 0, 1).applyQuaternion(s.turn)) };
        const dir = toV(elbow(shown, s.side, hold.kg), vB).sub(s.at), len = dir.length();
        dir.normalize();
        vC.set(1, 0, 0).applyQuaternion(s.turn);
        vC.addScaledVector(dir, -vC.dot(dir)).normalize();
        const deep = vA.crossVectors(vC, dir), tense = 1 + Math.min(0.12, hold.kg / 250);
        s.forearm.matrix.makeBasis(vC.multiplyScalar(tense), dir.multiplyScalar(len), deep.multiplyScalar(0.75 * tense)).setPosition(s.at);
        s.forearm.matrixWorldNeedsUpdate = true;
      }
      // A cable end: the plug out of the thumb side of the right fist, the lead out the bottom to where the rope starts.
      const right = sides[0], g = gripFor(hold.right).surface;
      mPlace.compose(right.at, right.turn, one);
      gripWorld.set(0, g?.kind === "cylinder" ? g.y : 0, g?.kind === "cylinder" ? g.z : -0.08).applyMatrix4(mPlace).applyMatrix4(camera.matrixWorld);
      lead.visible = plug.visible = (hold.right.kind === "cable" || hold.right.kind === "plug") && !!hold.lead && g?.kind === "cylinder";
      if (lead.visible && hold.lead && g?.kind === "cylinder") {
        mPlace.compose(right.at, right.turn, one);
        const axis = (x: number) => new THREE.Vector3(x, g.y, g.z).applyMatrix4(mPlace);
        const thumbEnd = axis(-0.06), from = axis(0.045);
        plugAs(hold.lead.end ?? "xlr-m");
        plug.position.copy(thumbEnd);
        plug.quaternion.setFromUnitVectors(up, vA.copy(thumbEnd).sub(from).normalize());
        from.applyMatrix4(camera.matrixWorld);
        const d = toV(hold.lead.at, vB).sub(from);
        lead.position.copy(from);
        const thick = hold.right.kind === "cable" ? Math.max(0.5, hold.right.radius / 0.004) : 1;
        lead.scale.set(thick, d.length(), thick);
        lead.quaternion.setFromUnitVectors(up, d.normalize());
        (lead.material as THREE.MeshStandardMaterial).color.setHex(hold.lead.color);
      }
    },
    /** Each hand's grip and its fingertips' gaps to what they hold, in mm (null holding nothing), and joints in range. */
    state() {
      const one = (s: (typeof sides)[number]) => {
        const p = s.pose;
        if (!p) return null;
        const tips = Object.fromEntries(FINGERS.map((f) => { const d = p.tips[f]; return [f, d === null ? null : Math.round(d * 10000) / 10]; }));
        return { grip: p.grip, tips, limitsHeld: p.limitsHeld };
      };
      return { right: one(sides[0]), left: one(sides[1]) };
    },
    /** The middle of what the right hand grips, in world space (a coil hangs from here). */
    gripAt: () => gripWorld.clone(),
    /** Step 11's tattoos: a sheet for the right forearm and one for the left (the same if only one is given; null takes it off). */
    setTattoo(right: THREE.Texture | null, left: THREE.Texture | null = right) {
      arm.map = right; armLeft.map = left;
      arm.needsUpdate = armLeft.needsUpdate = true;
    },
    /** Solve the grips a page will use ahead of time, so the first grab doesn't hitch. */
    warm(whats: What[]) { for (const w of whats) solver.pose(gripFor(w)); },
  };
}
