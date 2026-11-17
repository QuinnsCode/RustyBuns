// The cables on screen: a tube along each laid-out rope's points, coloured by kind and as thick as the real cable,
// rebuilt each frame it moved, and its roll as a coil: hanging off your fingers, rolling on its edge, lying flat, or
// tucked under the jack it is plugged into. Points still on the coil are drawn as the coil, not the tube.
import * as THREE from "three";
import type { Cables } from "./cables.ts";
import { CABLE, ROLL_R, leftM } from "./roll.ts";
import type { Vec } from "./rope.ts";

export const COLOR: Record<string, number> = { power: 0x1b1b1b, speaker: 0x2a3f8f, xlr: 0x3a3a3a, instrument: 0x8f2a2a };

/** Where your hand holds a carried roll (world space) and which way you face: the coil hangs off it. */
export type HeldAt = { at: THREE.Vector3; yaw: number };

/** The coil's loop radius, and how thick a bundle `leftM` of cable makes wound on it (turns side by side, packed
 * about 80%): 10 m of cord is a 2 cm bundle, 25 m of feeder 7 cm. */
const LOOP_R = ROLL_R - 0.03;
export const bundleR = (leftM: number, radius: number) => Math.max(0.006, radius * Math.sqrt(leftM / (2 * Math.PI * LOOP_R) / 0.8));

export function cableView(scene: THREE.Scene) {
  const tubes = new Map<string, THREE.Mesh<THREE.TubeGeometry, THREE.MeshStandardMaterial>>();
  const coils = new Map<string, THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>>();
  const sums = new Map<string, number>();
  const coilOf = (key: string, color: number) => {
    let m = coils.get(key);
    if (!m) {
      m = new THREE.Mesh(new THREE.TorusGeometry(LOOP_R, 1, 10, 32), new THREE.MeshStandardMaterial({ color, roughness: 0.55 }));
      m.userData.tube = 1;
      m.rotation.order = "YXZ";
      coils.set(key, m);
      scene.add(m);
    }
    return m;
  };
  return {
    /** `held` is where your hand is when you carry a roll, so the coil hangs from your fingers, not from your chest. */
    update(c: Cables, held?: HeldAt) {
      for (const run of c.runs) {
        let m = tubes.get(run.key);
        const roll = run.roll, coil = roll ? coilOf(run.key, COLOR[run.kind] ?? 0x222222) : coils.get(run.key);
        if (!run.rope) { if (m) m.visible = false; if (coil) coil.visible = false; continue; }
        // The coil: where the roll is, as fat as the cable left on it.
        const left = roll ? leftM(roll) : 0, inHands = roll?.state === "held" && !!held;
        let bottom: Vec | null = null;
        if (roll && coil) {
          coil.visible = left > 0.3;
          const up = roll.state === "rolling" || roll.state === "held";
          const r = LOOP_R, tube = bundleR(left, CABLE[roll.kind].radius);
          // A new bundle thickness is a new torus (every few metres paid out, not every frame).
          if (Math.abs(tube - coil.userData.tube) > coil.userData.tube * 0.08) {
            coil.geometry.dispose();
            coil.geometry = new THREE.TorusGeometry(LOOP_R, tube, 10, 32);
            coil.userData.tube = tube;
          }
          if (inHands) {
            coil.position.set(held!.at.x, held!.at.y - r, held!.at.z);
            bottom = { x: held!.at.x, y: held!.at.y - 2 * r, z: held!.at.z };
          } else coil.position.set(roll.x, roll.state === "held" ? roll.y - 0.1 : roll.y, roll.z);
          // In your hand it hangs off the fingers swung out to the side, so you see it edge on, not as a wheel.
          // Rolling, a floppy coil leans off its edge, more as it slows (roll.ts drifts its line the same way).
          const lean = roll.state === "rolling" ? (Math.sign(roll.lean) || 1) * Math.min(0.6, 0.18 + 0.35 / (1 + roll.v) + Math.abs(roll.lean)) : 0;
          coil.rotation.set(up ? lean : Math.PI / 2, up ? (inHands ? held!.yaw + 0.6 : roll.dir + Math.PI / 2) : 0, up && !inHands ? -roll.spin : 0);
        }
        // The tube: the points off the coil, one every 3 cm (the ones still wound on sit together at its mouth).
        const pts = run.rope.pts, keep: THREE.Vector3[] = [], mouth = roll && roll.state !== "out" ? pts[pts.length - 1]! : null;
        for (const p of pts) {
          const q = bottom && mouth && Math.hypot(p.x - mouth.x, p.y - mouth.y, p.z - mouth.z) < 1e-3 ? bottom : p, last = keep.at(-1);
          if (!last || Math.hypot(q.x - last.x, q.y - last.y, q.z - last.z) > 0.03) keep.push(new THREE.Vector3(q.x, q.y, q.z));
        }
        if (keep.length < 2) { if (m) m.visible = false; continue; }
        const sum = keep.reduce((s, p, i) => s + (p.x + p.y * 3 + p.z * 7) * (i + 1), 0);
        if (m && m.visible && sums.get(run.key) === sum) continue;
        sums.set(run.key, sum);
        const radius = roll ? Math.max(0.004, CABLE[roll.kind].radius) : run.kind === "power" ? 0.009 : 0.006;
        const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(keep), keep.length * 3, radius, 6, false);
        if (!m) {
          m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: COLOR[run.kind] ?? 0x222222, roughness: 0.6 }));
          tubes.set(run.key, m);
          scene.add(m);
        } else { m.geometry.dispose(); m.geometry = geo; }
        m.visible = true;
      }
    },
    clear() {
      for (const m of [...tubes.values(), ...coils.values()]) { scene.remove(m); m.geometry.dispose(); }
      tubes.clear(); coils.clear(); sums.clear();
    },
  };
}
