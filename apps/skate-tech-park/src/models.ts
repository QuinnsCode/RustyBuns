// The skater and the board, from three.js primitives: nothing to load or license. The roadster
// is packages/models; this gives each of its ten nozzles a plume.
import { roadster as shared } from "@rustybuns/models";
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

/** The shared roadster with a plume on each nozzle for the view to scale by what the sim says is firing. */
export function roadster() {
  const car = shared();
  const thrusters: Thruster[] = car.nozzles.map((n) => {
    const plume = new THREE.Mesh(new THREE.ConeGeometry(0.2, 1, 12, 1, true), PLUME);
    plume.position.y = 0.5;
    plume.visible = false;
    n.mount.add(plume);
    return { group: n.group, plume };
  });
  car.group.userData = { model: "roadster", thrusters, plate: car.plate };
  return car.group;
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
