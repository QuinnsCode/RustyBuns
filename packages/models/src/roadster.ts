// The rocket roadster, shared by Skate Tech Park and Git Recon: a faceted wedge on a dark sill with a
// gold-tinted visor, a headlight slit across the nose, a full-width tail light bar, four wheels and
// ten cold-gas thrusters. The nose points +z. Each app brings its own materials and draws its own
// plumes: every nozzle is a `mount` (at the bell's mouth, +y along the exhaust) to attach one to.
//
//   rear x4   out of the tail; the main one sits behind the plate and the plate hinges down off it
//   lift x4   down from the corners
//   spinL/R   sideways from the nose: the one on the right side turns the car left
import * as THREE from "three";

export type NozzleGroup = "rear" | "lift" | "spinL" | "spinR";
export type Nozzle = { group: NozzleGroup; main: boolean; mount: THREE.Object3D };
export type Roadster = {
  group: THREE.Group;
  nozzles: Nozzle[];
  /** Hinged along its bottom edge: rotation.x = -PI * 0.95 drops it clear of the main nozzle. */
  plate: THREE.Group;
  wheels: THREE.Object3D[];
};
export type RoadsterLook = {
  paint: THREE.Material;
  /** Sill, diffuser, nozzle bells' surroundings. */
  ink: THREE.Material;
  /** Visor glass. */
  glass: THREE.Material;
  tyre: THREE.Material;
  rim: THREE.Material;
  nozzle: THREE.Material;
  headlight: THREE.Material;
  taillight: THREE.Material;
  plate: THREE.Material;
  /** Draw an outline on each solid (Git Recon's paper-and-ink look). */
  edges?: THREE.Material;
};

export function roadsterLook(): RoadsterLook {
  const std = (color: number, roughness: number, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  return {
    paint: std(0xf4f5f2, 0.25, 0.1), ink: std(0x1b1c1f, 0.8), glass: std(0x2b2210, 0.12, 0.8),
    tyre: std(0x111111, 0.9), rim: std(0xb9bcc2, 0.3, 0.8), nozzle: std(0x2a2a2e, 0.3, 0.9),
    headlight: new THREE.MeshBasicMaterial({ color: 0xffffff }), taillight: new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
    plate: std(0xe9e6d8, 0.5),
  };
}

/** A side profile, (along, up) pairs, pushed out `wide` across the car. */
function profile(pts: [number, number][], wide: number) {
  const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(-z, y)));
  return new THREE.ExtrudeGeometry(shape, { depth: wide, bevelEnabled: false }).rotateY(Math.PI / 2).translate(-wide / 2, 0, 0);
}

const UP = new THREE.Vector3(0, 1, 0);

export function roadster(look: RoadsterLook = roadsterLook()): Roadster {
  const group = new THREE.Group();
  const piece = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    o.castShadow = true;
    if (look.edges) o.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), look.edges));
    group.add(o);
    return o;
  };
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => piece(new THREE.BoxGeometry(w, h, d), m, x, y, z);

  box(1.9, 0.24, 4.2, look.ink, 0, 0.36, 0);
  piece(profile([[2.35, 0.34], [2.4, 0.52], [0.95, 0.84], [-1.45, 0.96], [-2.25, 1.0], [-2.25, 0.6], [-2.05, 0.34]], 2.1), look.paint);
  piece(profile([[0.95, 0.84], [0.05, 1.24], [-0.55, 1.28], [-1.7, 0.99], [-1.45, 0.96]], 1.6), look.glass);
  box(1.7, 0.04, 0.04, look.headlight, 0, 0.56, 2.39); // the headlights hide in a slit across the nose
  box(2.12, 0.06, 0.04, look.taillight, 0, 0.94, -2.26); // the tail bar, the car's full width
  box(2.0, 0.26, 0.26, look.ink, 0, 0.47, -2.12); // the diffuser under it
  for (const x of [-1.06, 1.06]) box(0.02, 0.22, 0.55, look.ink, x, 0.66, -1.0); // intakes behind the doors

  const wheels: THREE.Object3D[] = [];
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.34, 18).rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.36, 10).rotateZ(Math.PI / 2);
  for (const [x, z] of [[-1.0, 1.4], [1.0, 1.4], [-1.0, -1.45], [1.0, -1.45]] as const) {
    const w = piece(wheelGeo, look.tyre, x, 0.42, z);
    w.add(new THREE.Mesh(rimGeo, look.rim));
    w.add(new THREE.Mesh(new THREE.BoxGeometry(0.37, 0.06, 0.6), look.ink)); // a spoke, to see it turn
    wheels.push(w);
  }

  const nozzles: Nozzle[] = [];
  const bell = new THREE.CylinderGeometry(0.09, 0.13, 0.18, 12).translate(0, 0.09, 0);
  const nozzle = (g: NozzleGroup, x: number, y: number, z: number, dir: THREE.Vector3, main = false) => {
    const n = piece(bell, look.nozzle, x, y, z);
    n.quaternion.setFromUnitVectors(UP, dir);
    const mount = new THREE.Object3D();
    mount.position.y = 0.18;
    n.add(mount);
    nozzles.push({ group: g, main, mount });
  };
  const back = new THREE.Vector3(0, 0, -1), down = new THREE.Vector3(0, -1, 0);
  nozzle("rear", 0, 0.55, -2.25, back, true);
  for (const x of [-0.72, 0.72]) nozzle("rear", x, 0.45, -2.25, back);
  nozzle("rear", 0, 0.3, -2.25, back);
  for (const [x, z] of [[-0.75, 1.85], [0.75, 1.85], [-0.75, -1.75], [0.75, -1.75]] as const) nozzle("lift", x, 0.2, z, down);
  nozzle("spinL", -1.06, 0.5, 1.7, new THREE.Vector3(-1, 0, 0));
  nozzle("spinR", 1.06, 0.5, 1.7, new THREE.Vector3(1, 0, 0));

  const plate = new THREE.Group();
  plate.position.set(0, 0.42, -2.5);
  const tag = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.26, 0.02), look.plate);
  tag.position.y = 0.13;
  plate.add(tag);
  group.add(plate);
  return { group, nozzles, plate, wheels };
}
