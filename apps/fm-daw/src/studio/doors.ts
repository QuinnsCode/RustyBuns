// The doorways in a studio's drawn walls: the wall carried on over each one at door height, a casing round it, and a
// studio door (two for a wide opening) standing most of the way open on its hinges: solid, a small window at eye
// height, a steel lever each side. The jam room draws them full height; the builder's cutaway (`cut` lower than the
// door) draws each door only as high as its walls and lays its swing on the floor, as a house plan shows a door.
import * as THREE from "three";
import { metreUV } from "./look.ts";
import type { StudioDef, Wall } from "./room.ts";

export interface DoorLook { wallOf: (wl: Wall) => THREE.Material; casing: THREE.Material; leaf: THREE.Material; lever: THREE.Material; glass: THREE.Material }
/** How far a door stands open (radians from shut), and the widest opening that takes one door rather than two. */
const OPEN = 1.25, SINGLE = 1.2;
/** The plan's swing arc, drawn in the builder's orange. */
const SWING = new THREE.MeshBasicMaterial({ color: "#c98a3a", transparent: true, opacity: 0.7, side: THREE.DoubleSide });

export function doorways(def: StudioDef, h: number, look: DoorLook, cut = Infinity): THREE.Group {
  const out = new THREE.Group(), doorH = Math.min(2.1, h - 0.15), tall = Math.min(doorH, cut);
  out.name = "doorways";
  for (const wl of def.walls) {
    const [x0, z0] = wl.from, [x1, z1] = wl.to, len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.01) continue;
    const ux = (x1 - x0) / len, uz = (z1 - z0) / len;
    for (const [ga, gb] of wl.gaps ?? []) {
      const gw = gb - ga;
      if (gw < 0.5 || gw > 2.4) continue;
      const g = new THREE.Group(); g.position.set(x0 + ux * ga, 0, z0 + uz * ga); g.rotation.y = -Math.atan2(uz, ux); out.add(g);
      const piece = (bw: number, bh: number, bd: number, x: number, y: number, z: number, m: THREE.Material, to = g) => {
        const b = new THREE.Mesh(metreUV(new THREE.BoxGeometry(bw, bh, bd)), m); b.position.set(x, y, z); to.add(b); return b;
      };
      if (cut > doorH) {
        piece(gw, Math.min(h, cut) - doorH, 0.12, gw / 2, (Math.min(h, cut) + doorH) / 2, 0, look.wallOf(wl)); // over the door
        piece(gw, 0.05, 0.16, gw / 2, doorH - 0.025, 0, look.casing);
      }
      for (const x of [0.025, gw - 0.025]) piece(0.05, tall, 0.16, x, tall / 2, 0, look.casing);
      const leaves = gw > SINGLE ? 2 : 1, lw = (gw - 0.1) / leaves;
      for (let k = 0; k < leaves; k++) {
        const hinge = new THREE.Group(), right = k === 1, sx = right ? -1 : 1;
        hinge.position.set(right ? gw - 0.05 : 0.05, 0, 0.06); hinge.rotation.y = sx * OPEN; g.add(hinge);
        piece(lw, tall - 0.06, 0.05, (sx * lw) / 2, (tall - 0.06) / 2, 0.025, look.leaf, hinge);
        if (tall > 1.7) piece(0.22, 0.5, 0.054, (sx * lw) / 2, 1.45, 0.025, look.glass, hinge); // the vision panel
        if (tall > 1.1) for (const z of [-0.01, 0.06]) piece(0.13, 0.018, 0.02, sx * (lw - 0.12), 1.02, z, look.lever, hinge);
        if (cut < doorH) {
          // the plan's swing: a thin arc on the floor from shut to open
          const arc = new THREE.Mesh(new THREE.RingGeometry(lw - 0.012, lw, 24, 1, 0, OPEN).rotateX(-Math.PI / 2), SWING);
          arc.position.set(right ? gw - 0.05 : 0.05, 0.008, 0.06);
          if (right) arc.scale.x = -1;
          g.add(arc);
        }
      }
    }
  }
  return out;
}
