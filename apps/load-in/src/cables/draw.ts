// The cables on screen: a tube along each laid-out rope's points, coloured by kind and as thick as the real cable,
// rebuilt each frame it moved, and its roll as a coil: hanging off your fingers, rolling on its edge, lying flat, or
// tucked under the jack it is plugged into. Points still on the coil are drawn as the coil, not the tube. Each end
// off the coil wears its own connector (ends-view.ts); the one in your hand is the hands' to draw.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Cables } from "./cables.ts";
import { CABLE, ROLL_R, leftM } from "./roll.ts";
import type { Vec } from "./rope.ts";
import { endOf } from "./ends.ts";
import { aimEnd, connectorMesh } from "./ends-view.ts";

export const COLOR: Record<string, number> = { power: 0x26262a, speaker: 0x2a3f8f, xlr: 0x3a3a3a, instrument: 0x8f2a2a };

/** Where your hand holds a carried roll (world space) and which way you face: the coil hangs off it. */
export type HeldAt = { at: THREE.Vector3; yaw: number };

/** The coil's loop radius, and how thick a bundle `leftM` of cable makes wound on it (turns side by side, packed
 * about 80%): 10 m of cord is a 2 cm bundle, 25 m of feeder 7 cm. */
const LOOP_R = ROLL_R - 0.03;
export const bundleR = (leftM: number, radius: number) => Math.max(0.006, radius * Math.sqrt(leftM / (2 * Math.PI * LOOP_R) / 0.8));

/**
 * A coil as the loops it is: one ring of cable for each turn left on it (16 at most), packed into the bundle, each a
 * little off the next, so light catches the strands and it reads as coiled cable and not as a tyre.
 */
export function coilGeometry(tube: number, cableR: number): THREE.BufferGeometry {
  const n = Math.max(1, Math.min(16, Math.round((tube / cableR) ** 2 * 0.8)));
  if (n === 1) return new THREE.TorusGeometry(LOOP_R, Math.max(tube, cableR), 6, 32);
  const rings: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    // Sunflower packing across the bundle's cross-section.
    const a = i * 2.39996, d = (tube - cableR) * Math.sqrt((i + 0.5) / n);
    rings.push(new THREE.TorusGeometry(LOOP_R + Math.cos(a) * d, cableR, 6, 32).rotateX(Math.sin(i * 1.7) * 0.035).rotateZ(i * 0.9).translate(0, 0, Math.sin(a) * d));
  }
  const merged = mergeGeometries(rings);
  for (const g of rings) g.dispose();
  return merged;
}

const STRAP = new THREE.MeshStandardMaterial({ color: 0xe0611a, roughness: 0.9 });
/** The tie round a coil: a strap of orange hook-and-loop, a third of the way round from the top. Call again when the bundle's thickness changes. */
export function strapOn(coil: THREE.Mesh, tube: number) {
  const old = coil.getObjectByName("strap");
  if (old instanceof THREE.Mesh) { old.geometry.dispose(); coil.remove(old); }
  const strap = new THREE.Mesh(new THREE.TorusGeometry(tube * 1.12, Math.max(0.003, tube * 0.14), 6, 16).scale(1, 1, 3).rotateY(Math.PI / 2).rotateZ((Math.PI * 3) / 4), STRAP);
  strap.name = "strap";
  strap.position.set(LOOP_R * Math.SQRT1_2, LOOP_R * Math.SQRT1_2, 0);
  coil.add(strap);
}

export function cableView(scene: THREE.Scene) {
  const tubes = new Map<string, THREE.Mesh<THREE.TubeGeometry, THREE.MeshStandardMaterial>>();
  const coils = new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>>();
  const sums = new Map<string, number>();
  const ends = new Map<string, THREE.Group>();
  const endOn = (key: string, kind: Parameters<typeof endOf>[0], end: "a" | "b") => {
    let m = ends.get(`${key}:${end}`);
    if (!m) { m = connectorMesh(endOf(kind, end)); ends.set(`${key}:${end}`, m); scene.add(m); }
    return m;
  };
  const coilOf = (key: string, color: number) => {
    let m = coils.get(key);
    if (!m) {
      m = new THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>(new THREE.TorusGeometry(LOOP_R, 1, 10, 32), new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
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
        if (!run.rope) { if (m) m.visible = false; if (coil) coil.visible = false; for (const e of ["a", "b"]) { const p = ends.get(`${run.key}:${e}`); if (p) p.visible = false; } continue; }
        // The ends: the outer one once it is off the coil, the inner one once every metre is.
        const rp = run.rope.pts, n = rp.length;
        for (const [end, i, j, off] of [["a", 0, 1, !!roll?.tailIn], ["b", n - 1, n - 2, !!roll && roll.state !== "out" && roll.state !== "tied"]] as const) {
          const p = endOn(run.key, run.kind, end);
          p.visible = !off && !("hand" in run[end]) && n > 1;
          if (p.visible) aimEnd(p, rp[i]!, rp[j]!);
        }
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
            coil.geometry = coilGeometry(tube, CABLE[roll.kind].radius);
            strapOn(coil, tube);
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
      for (const m of ends.values()) scene.remove(m);
      tubes.clear(); coils.clear(); sums.clear(); ends.clear();
    },
  };
}
