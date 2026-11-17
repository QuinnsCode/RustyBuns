// The two hands drawn: bare forearms, a palm, and fingers of rounded segments with knuckles, posed by the grip solver
// (grip.ts) and placed by place.ts. `handsView(scene, camera)` takes a camera and a `Hold` and nothing from the game
// world, so any page can show them. A new grip is solved once (cached) and blended in over a fifth of a second, joint by
// joint; a frame only composes matrices. The forearm's material has an empty `tattoo` slot (its map) and the forearm's
// UVs run as one clean rectangle, round the arm by wrist to elbow, for the tattoos of #5029's step 11.
import * as THREE from "three";
import { HandSolver, gripFor, type HandPose, type What } from "./grip.ts";
import { type Box, type Frame, type Side, carryFrames, elbow, viewFrame } from "./place.ts";
import { FINGERS, FOREARM, HAND, PALM, type V3 } from "./skeleton.ts";

/** What your hands are doing: each hand's grip, the weight in them, and if it's a carry, the box; a cable end's lead. */
export type Hold = {
  right: What;
  left: What;
  kg: number;
  /** a cabinet carried in both hands (world space) */
  carry?: Box;
  /** where the cable leaving your fist goes (world space), and its colour */
  lead?: { at: V3; color: number };
};

const SKIN = 0xb57a58;
const BLEND = 0.2;

/** One hand's meshes: an object per joint (its matrix set each frame), with the segment to its child and a knuckle. */
function handMesh(side: Side, skin: THREE.Material) {
  const root = new THREE.Group();
  const bones = HAND.bones.map(() => { const o = new THREE.Object3D(); o.matrixAutoUpdate = false; root.add(o); return o; });
  const m = (v: V3): V3 => [v[0] * side, v[1], v[2]];
  const capsule = (from: V3, to: V3, r: number) => {
    const d = new THREE.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]), len = d.length();
    const c = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, len), 4, 10), skin);
    c.position.set((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2);
    c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    return c;
  };
  HAND.bones.forEach((b, j) => {
    if (b.parent < 0) return;
    const kids = HAND.bones.filter((k) => k.parent === j);
    for (const k of kids) bones[j].add(capsule([0, 0, 0], m([k.at[0] - b.at[0], k.at[1] - b.at[1], k.at[2] - b.at[2]]), b.radius));
    if (kids.length) {
      const knuckle = new THREE.Mesh(new THREE.SphereGeometry(b.radius * 1.08, 10, 8), skin);
      bones[j].add(knuckle);
    }
  });
  // The palm: a soft slab, the metacarpals under it as ridges to each knuckle, and the thumb's pad.
  const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), skin);
  palm.scale.set(PALM.half, (PALM.back - PALM.front) / 2, PALM.length / 2);
  palm.position.set(side * 0.004, (PALM.back + PALM.front) / 2, -PALM.length / 2 + 0.002);
  bones[0].add(palm);
  for (const f of FINGERS) {
    if (f === "thumb") continue;
    const k = HAND.bones[HAND.chains[f][0]].at;
    bones[0].add(capsule(m([k[0] * 0.7, 0.002, -0.012]), m(k), 0.0105));
  }
  const tb = HAND.bones[HAND.chains.thumb[0]].at;
  bones[0].add(capsule(m([-0.006, -0.006, -0.012]), m(tb), 0.016));
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
  const skin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.62, metalness: 0 });
  /** The forearm's skin: its `map` is the tattoo slot, empty until a tattoo is put there. */
  const arm = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.66, metalness: 0 });
  arm.userData.slot = "tattoo";
  // A tapered tube, wrist (v 0) to elbow (v 1), U once round: an unwrapped rectangle. Drawn wider across than deep, as a forearm is.
  const forearmGeo = new THREE.CylinderGeometry(FOREARM.elbow, FOREARM.wrist, 1, 20, 1, true).translate(0, 0.5, 0);
  const sides = ([1, -1] as const).map((side) => {
    const h = handMesh(side, skin), forearm = new THREE.Mesh(forearmGeo, arm);
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
  const plug = new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.0105, 0.075, 12), new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.8, roughness: 0.3 }));
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
        const f = carry ? toCam(s.side > 0 ? carry.right : carry.left) : viewFrame(what.kind, hold.kg, t, speed, s.side);
        // On a tall, narrow screen (a phone held upright) the hands come in toward the middle so they stay in view.
        if (!carry && narrow < 1) f.o = [f.o[0] * narrow, f.o[1], f.o[2]];
        mPlace.makeBasis(toV(f.x, vA), toV(f.y, vB), toV(f.z, vC)).setPosition(f.o[0], f.o[1], f.o[2]);
        tAt.setFromMatrixPosition(mPlace);
        tTurn.setFromRotationMatrix(mPlace);
        if (grip.key !== s.key) {
          // A new grip: solve it (once, cached) and blend from what is shown now.
          const first = !s.pose;
          s.key = grip.key;
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
    /** Step 11's tattoos: a texture on both forearms (null takes it off). */
    setTattoo(tex: THREE.Texture | null) { arm.map = tex; arm.needsUpdate = true; },
    /** Solve the grips a page will use ahead of time, so the first grab doesn't hitch. */
    warm(whats: What[]) { for (const w of whats) solver.pose(gripFor(w)); },
  };
}
