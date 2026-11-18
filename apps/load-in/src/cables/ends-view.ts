// The connectors on a cable's ends, drawn at their real size so you can tell them apart in your hand and on the floor:
// a wall plug's flat blades and round pin, an IEC socket's three slots, an XLR's latch with pins (male) or holes
// (female), a speakON's blue twist ring, a quarter-inch jack's tip. Each is a group whose +Y points out of the plug's
// face, its body centred on the origin: aim +Y along where the plug goes in.
import * as THREE from "three";
import type { Connector } from "./ends.ts";

const RUBBER = new THREE.MeshStandardMaterial({ color: 0x1b1b1e, roughness: 0.75 });
const METAL = new THREE.MeshStandardMaterial({ color: 0xc9ccd2, metalness: 0.85, roughness: 0.3 });
const BRASS = new THREE.MeshStandardMaterial({ color: 0xd4b05a, metalness: 0.85, roughness: 0.3 });
const HOLE = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 1 });
const SPEAKON = new THREE.MeshStandardMaterial({ color: 0x2f6fd6, roughness: 0.45 });
const POWER = new THREE.MeshStandardMaterial({ color: 0xe0611a, roughness: 0.6 });

const cyl = (r: number, len: number, mat: THREE.Material, y = 0, seg = 14) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  m.position.y = y;
  return m;
};
const cube = (w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
};
/** Three pins (or holes) in the XLR's triangle on its face at height `y`. */
const xlrTriangle = (y: number, make: () => THREE.Mesh) => [0, 1, 2].map((i) => {
  const m = make(), a = Math.PI / 2 + (i * Math.PI * 2) / 3;
  m.position.set(Math.cos(a) * 0.0045, y, Math.sin(a) * 0.0045);
  return m;
});

/** A connector as meshes, +Y out of its face. */
export function connectorMesh(kind: Connector): THREE.Group {
  const g = new THREE.Group();
  g.name = `end:${kind}`;
  switch (kind) {
    case "edison":
      // A moulded wall plug: a chunky body, two flat blades and the round ground pin, an orange strain relief.
      g.add(cube(0.034, 0.04, 0.022, RUBBER), cyl(0.008, 0.02, POWER, -0.028));
      g.add(cube(0.0065, 0.016, 0.0015, METAL, -0.0065, 0.028), cube(0.0065, 0.016, 0.0015, METAL, 0.0065, 0.028), cyl(0.0024, 0.018, METAL, 0.027, 8));
      g.children.at(-1)!.position.z = 0.0075;
      break;
    case "iec":
      // A kettle-lead socket: a rectangular body with its notched face and three slots.
      g.add(cube(0.03, 0.036, 0.022, RUBBER), cyl(0.008, 0.02, POWER, -0.026));
      for (const x of [-0.007, 0, 0.007]) g.add(cube(0.002, 0.002, 0.006, HOLE, x, 0.0181, x === 0 ? 0.004 : -0.002));
      break;
    case "xlr-f":
    case "xlr-m": {
      // A barrel with a metal shell and the latch: a male shows three pins inside a skirt, a female three holes.
      g.add(cyl(0.0095, 0.045, RUBBER, -0.01), cyl(0.0098, 0.022, METAL, 0.018));
      g.add(cube(0.004, 0.012, 0.003, METAL, 0, 0.022, 0.0098));
      if (kind === "xlr-m") g.add(...xlrTriangle(0.032, () => cyl(0.0008, 0.008, BRASS, 0, 6)));
      else g.add(...xlrTriangle(0.0291, () => cyl(0.0012, 0.001, HOLE, 0, 6)));
      break;
    }
    case "speakon":
      // A fat barrel with the blue twist-lock ring at its face.
      g.add(cyl(0.012, 0.05, RUBBER, -0.008), cyl(0.0135, 0.012, SPEAKON, 0.019), cyl(0.0085, 0.004, HOLE, 0.026));
      break;
    case "ts":
      // A quarter-inch jack: a barrel and the silver shaft with its tip.
      g.add(cyl(0.008, 0.04, RUBBER, -0.01), cyl(0.0032, 0.028, METAL, 0.024), cyl(0.0034, 0.004, BRASS, 0.039));
      break;
    case "rca":
    case "coax":
      g.add(cyl(0.005, 0.03, kind === "rca" ? POWER : RUBBER, -0.006), cyl(0.0042, 0.008, METAL, 0.013), cyl(0.001, 0.008, BRASS, 0.018, 6));
      break;
    case "spade":
      g.add(cyl(0.003, 0.012, RUBBER, -0.006), cube(0.007, 0.014, 0.001, BRASS, 0, 0.006));
      break;
  }
  return g;
}

const UP = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();
/** Set a connector at `at`, pointing from `from` to `at` (out of the cable's last stretch, into its jack). */
export function aimEnd(m: THREE.Object3D, at: { x: number; y: number; z: number }, from: { x: number; y: number; z: number }) {
  dir.set(at.x - from.x, at.y - from.y, at.z - from.z);
  if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1);
  m.quaternion.setFromUnitVectors(UP, dir.normalize());
  // The body sits on the cable's end, its face a plug's length on.
  m.position.set(at.x, at.y, at.z).addScaledVector(dir, 0.01);
}
