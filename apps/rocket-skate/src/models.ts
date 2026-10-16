// The skater, the board and the roadster, from three.js primitives: nothing to load or license.
// The roadster is a low white wedge with ten cold-gas thrusters. Four point back, the main one
// behind a licence plate that hinges down to uncover it. Four point down from the corners for
// lift, and two point sideways from the nose to spin it. Each nozzle has a plume the view scales
// by what the sim says is firing.
import * as THREE from "three";

const mat = (color: number, rough = 0.6, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z);
  o.castShadow = true;
  return o;
};

export type Thruster = { group: "rear" | "lift" | "spinL" | "spinR"; plume: THREE.Mesh };

const PLUME = new THREE.MeshBasicMaterial({ color: 0xe4f2ff, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });

function nozzle(group: Thruster["group"], dir: THREE.Vector3, at: THREE.Vector3, out: Thruster[]) {
  const g = new THREE.Group();
  g.position.copy(at);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.14, 12, 1, true), mat(0x2a2a2e, 0.3, 0.9));
  bell.position.y = 0.07;
  const plume = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1, 12, 1, true), PLUME);
  plume.position.y = 0.64; // wide at the bell, its tip trailing away
  plume.visible = false;
  g.add(bell, plume);
  out.push({ group, plume });
  return g;
}

/** A side profile (z forward, y up) pulled across the car's width. */
function wedge(points: [number, number][], width: number, m: THREE.Material) {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 });
  geo.translate(0, 0, -width / 2);
  geo.rotateY(-Math.PI / 2); // the shape's x becomes the car's z
  const o = new THREE.Mesh(geo, m);
  o.castShadow = true;
  return o;
}

export function roadster() {
  const car = new THREE.Group();
  const paint = mat(0xf4f5f2, 0.25, 0.1);
  // Long nose, a canopy set well back, a short squared tail: angles, no curves.
  car.add(wedge([[2.2, 0.32], [2.25, 0.5], [0.9, 0.78], [-1.6, 0.92], [-2.15, 0.88], [-2.2, 0.32]], 1.9, paint));
  car.add(wedge([[0.75, 0.8], [-0.35, 1.18], [-1.45, 1.12], [-1.85, 0.92], [-0.9, 0.92]], 1.36, mat(0x15181d, 0.1, 0.6)));
  car.add(box(1.86, 0.22, 4.3, mat(0x1b1c1f, 0.8), 0, 0.3, 0)); // the dark sill and diffuser band
  car.add(box(1.7, 0.04, 0.04, new THREE.MeshBasicMaterial({ color: 0xffffff }), 0, 0.52, 2.22)); // light bar
  car.add(box(1.8, 0.05, 0.04, new THREE.MeshBasicMaterial({ color: 0xff2a2a }), 0, 0.8, -2.2)); // tail bar
  const tyre = mat(0x111111, 0.9), rim = mat(0xb9bcc2, 0.3, 0.8);
  for (const [x, z] of [[0.97, 1.4], [-0.97, 1.4], [0.99, -1.35], [-0.99, -1.35]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.3, 24), tyre);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.36, z);
    w.castShadow = true;
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.31, 10), rim);
    r.rotation.z = Math.PI / 2;
    r.position.copy(w.position);
    car.add(w, r);
  }
  const thrusters: Thruster[] = [];
  const back = new THREE.Vector3(0, 0, -1), down = new THREE.Vector3(0, -1, 0);
  car.add(nozzle("rear", back, new THREE.Vector3(0, 0.55, -2.22), thrusters)); // the main one, behind the plate
  for (const x of [-0.72, 0.72]) car.add(nozzle("rear", back, new THREE.Vector3(x, 0.45, -2.22), thrusters));
  car.add(nozzle("rear", back, new THREE.Vector3(0, 0.28, -2.18), thrusters)); // in the diffuser
  for (const [x, z] of [[0.7, 1.9], [-0.7, 1.9], [0.7, -1.9], [-0.7, -1.9]]) car.add(nozzle("lift", down, new THREE.Vector3(x, 0.2, z), thrusters));
  // A push out of the right side of the nose turns the car left, and the other way round.
  car.add(nozzle("spinL", new THREE.Vector3(-1, 0, 0), new THREE.Vector3(-0.95, 0.45, 1.9), thrusters));
  car.add(nozzle("spinR", new THREE.Vector3(1, 0, 0), new THREE.Vector3(0.95, 0.45, 1.9), thrusters));

  // The licence plate, hinged along its bottom edge.
  const plate = new THREE.Group();
  plate.position.set(0, 0.44, -2.26);
  plate.add(box(0.52, 0.24, 0.02, mat(0xe9e6d8, 0.5), 0, 0.12, 0));
  car.add(plate);
  car.userData = { model: "roadster", thrusters, plate };
  return car;
}

export function skater() {
  const rider = new THREE.Group();
  const board = new THREE.Group();
  board.add(box(0.22, 0.03, 0.8, mat(0x2b2b2b, 0.9), 0, 0.11, 0));
  for (const z of [-0.28, 0.28]) {
    board.add(box(0.18, 0.04, 0.05, mat(0x9aa0a6, 0.3, 0.8), 0, 0.075, z));
    for (const x of [-0.09, 0.09]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.035, 10), mat(0xf2efe2, 0.5));
      w.rotation.z = Math.PI / 2;
      w.position.set(x, 0.03, z);
      board.add(w);
    }
  }
  const body = new THREE.Group();
  const shirt = mat(0xd9572b, 0.8), jeans = mat(0x34465e, 0.9), skin = mat(0xc89070, 0.7);
  // Sideways on the board, feet over the trucks, facing +x.
  body.add(box(0.14, 0.62, 0.12, jeans, 0, 0.47, 0.2), box(0.14, 0.62, 0.12, jeans, 0, 0.47, -0.2));
  body.add(box(0.2, 0.5, 0.32, shirt, 0, 1.03, 0));
  body.add(box(0.09, 0.42, 0.09, shirt, 0.04, 1.0, 0.22), box(0.09, 0.42, 0.09, shirt, -0.04, 1.0, -0.22));
  body.add(box(0.2, 0.22, 0.2, skin, 0, 1.42, 0));
  body.add(box(0.25, 0.08, 0.23, mat(0x1d1d1d, 0.8), 0.02, 1.55, 0));
  rider.add(board, body);
  rider.userData = { model: "skater", board, body };
  return rider;
}
