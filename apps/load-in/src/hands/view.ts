// The two hands drawn: bare forearms and one smooth skin per hand (skin.ts: palm, knuckles, the thumb's web, tapered
// fingers and nails) over the skeleton's joints, posed by the grip solver (grip.ts) and placed by place.ts.
// `handsView(scene, camera)` takes a camera and a `Hold` and nothing from the game world, so any page can show them. A
// new grip is solved once (cached) and blended in over a fifth of a second, joint by joint; a frame only composes
// matrices. The forearm's material has an empty `tattoo` slot (its map) and the forearm's UVs run as one clean
// rectangle, round the arm by wrist to elbow, for the tattoos of #5029's step 11.
import * as THREE from "three";
import { FINGERS, FOREARM, HAND, HandSolver, gripFor, handMesh, localQuats, placeHand, type HandPose, type V3, type What } from "@rustybuns/rig/hand";
import { type Box, type Frame, blendFrame, carryFrames, elbow, reachFrame, showFrame, viewFrame } from "./place.ts";
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
  /** what's next (world space): an empty right hand reaches toward it */
  reach?: V3;
  /** looking at a piece you could take: empty hands drop out of the way so its face and label show */
  low?: boolean;
};

const SKIN = 0xb57a58;
const BLEND = 0.2;
/** Where the shirt's cuff sits along the forearm (0 the wrist, 1 the elbow), and how far past the elbow the sleeve runs. */
const CUFF = 0.07, SLEEVE_END = 1.3;

/** A charcoal-and-rust work-shirt flannel, as plain texels (no canvas, so a page without a DOM can make it). */
function flannel(): THREE.DataTexture {
  const n = 32, px = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const bx = x % 16 < 5, by = y % 16 < 5, thin = x % 16 === 9 || y % 16 === 9, weave = ((x + y) & 1) * 6;
    const c = bx && by ? [104, 46, 38] : bx || by ? [78, 44, 40] : thin ? [70, 74, 78] : [44, 47, 52];
    px.set([c[0] + weave, c[1] + weave, c[2] + weave, 255], (y * n + x) * 4);
  }
  const t = new THREE.DataTexture(px, n, n);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 1.5);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
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
  // The sleeve: a flannel work shirt, in the forearm's own unit space (y 0 the wrist, 1 the elbow), loose over the arm
  // from a buttoned cuff just past the wrist bone. It runs on past the elbow, out of the view. Looking at your arms (Y)
  // pushes the sleeves up, so the ink shows.
  const armR = (v: number) => FOREARM.wrist * 0.9 + (FOREARM.elbow - FOREARM.wrist * 0.9) * v;
  const sleeveGeo = new THREE.CylinderGeometry(armR(1) * 1.3, armR(CUFF) * 1.22, SLEEVE_END - CUFF, 24, 4, true).translate(0, (CUFF + SLEEVE_END) / 2, 0);
  const cuffGeo = new THREE.CylinderGeometry(armR(CUFF + 0.14) * 1.3, armR(CUFF) * 1.3, 0.14, 24, 1, true).translate(0, CUFF + 0.07, 0);
  const cloth = new THREE.MeshStandardMaterial({ map: flannel(), roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  const cuffCloth = new THREE.MeshStandardMaterial({ map: cloth.map, color: 0x8a8a8a, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  const sides = ([1, -1] as const).map((side) => {
    const h = handMesh(side, skin, nail), forearm = new THREE.Mesh(forearmGeo, side === 1 ? arm : armLeft);
    const sleeve = new THREE.Mesh(sleeveGeo, cloth), cuff = new THREE.Mesh(cuffGeo, cuffCloth);
    forearm.matrixAutoUpdate = false;
    forearm.add(sleeve, cuff);
    camera.add(h.root, forearm);
    return {
      ...h, forearm, sleeve, cuff, key: "", reachK: 0, pose: null as HandPose | null, since: 0,
      /** the joint turns and the placement shown now, and where a blend started from */
      cur: HAND.bones.map(() => new THREE.Quaternion()), from: [] as THREE.Quaternion[], to: [] as THREE.Quaternion[],
      lastReach: null as Frame | null, at: new THREE.Vector3(), turn: new THREE.Quaternion(), fromAt: null as THREE.Vector3 | null, fromTurn: new THREE.Quaternion(),
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

  let lastT = -1;
  const mPlace = new THREE.Matrix4(), camInv = new THREE.Matrix4();
  const vR = new THREE.Vector3(), tAt = new THREE.Vector3(), tTurn = new THREE.Quaternion();
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  const toV = (v: V3, out = new THREE.Vector3()) => out.set(v[0], v[1], v[2]);
  /** The middle of what the right hand grips (world space), as of the last update: where a page hangs a coil. */
  const gripWorld = new THREE.Vector3();
  const fromV = (v: THREE.Vector3): V3 => [v.x, v.y, v.z];
  /** How far the empty hands have dropped (0 up, 1 down), eased toward `hold.low`. */
  let low = 0, lowAt = -1;
  /** A world-space frame (a carry) in the camera's space. */
  const toCam = (f: Frame): Frame => {
    const r = (v: V3) => fromV(toV(v, vA).transformDirection(camInv));
    return { o: fromV(toV(f.o, vA).applyMatrix4(camInv)), x: r(f.x), y: r(f.y), z: r(f.z) };
  };

  return {
    /** Pose and place both hands for this frame; `speed` (m/s) sets the bob of your steps. */
    update(hold: Hold, t: number, speed = 0) {
      const dt = lastT < 0 ? 1 : Math.max(0, Math.min(0.1, t - lastT));
      lastT = t;
      camera.updateMatrixWorld();
      camInv.copy(camera.matrixWorld).invert();
      const narrow = camera instanceof THREE.PerspectiveCamera ? Math.min(1, Math.max(0.62, camera.aspect)) : 1;
      const carry = hold.carry ? carryFrames(hold.carry, hold.kg) : null;
      // The right hand reaches for what's next when it's free and ahead of you; it eases in and out over a third of a second.
      const reachTo = hold.reach && !hold.show && !carry && hold.right.kind === "rest" ? toV(hold.reach, vR).applyMatrix4(camInv) : null;
      const reach = reachTo ? reachFrame(fromV(reachTo), t, speed) : null;
      const far = reachTo ? Math.min(1, Math.max(0.45, 1.5 - reachTo.length() / 8)) : 0;
      const lowDt = lowAt < 0 ? 0 : Math.min(0.1, Math.max(0, t - lowAt));
      lowAt = t;
      low += ((hold.low ? 1 : 0) - low) * Math.min(1, lowDt * 7);
      for (const s of sides) {
        const what = s.side > 0 ? hold.right : hold.left;
        const show = !!hold.show && !carry && what.kind === "rest";
        const want = s.side > 0 && reach ? far : 0;
        s.reachK += (want - s.reachK) * Math.min(1, dt * 6);
        if (Math.abs(want - s.reachK) < 0.01) s.reachK = want;
        const grip = gripFor(what);
        s.sleeve.visible = s.cuff.visible = !show;
        const rest = carry ? toCam(s.side > 0 ? carry.right : carry.left) : show ? showFrame(t, s.side) : viewFrame(what.kind, hold.kg, t, speed, s.side);
        const lastReach = s.side > 0 ? reach ?? s.lastReach : null;
        if (s.side > 0 && reach) s.lastReach = reach;
        const f = !carry && !show && lastReach && s.reachK > 0 ? blendFrame(rest, lastReach, s.reachK) : rest;
        // On a tall, narrow screen (a phone held upright) the hands come in toward the middle so they stay in view. Not
        // the raised arms: they already reach across the view, and pulled in they cross in the middle (#5157).
        if (!carry && !show && narrow < 1) f.o = [f.o[0] * narrow, f.o[1], f.o[2]];
        // Out of the way while you look at a piece: down and apart, out to the sides so they leave its tape label clear. A hand reaching for the next piece stays on it.
        const drop = low * (1 - s.reachK);
        if (!carry && !show && what.kind === "rest" && drop > 0.001) f.o = [f.o[0] * (1 + 0.32 * drop), f.o[1] - 0.05 * drop, f.o[2]];
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
        placeHand(s, mPlace, s.cur);
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
