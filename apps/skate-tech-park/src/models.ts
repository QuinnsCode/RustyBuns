// The giant fingerboard and the rocket roadster, from three.js primitives: nothing to load or
// license. The roadster is packages/models; its ten nozzles are where the exhaust comes from.
// Both face +z and stand on y = 0, so either one can be the skin over the same transform.
import { roadster as shared } from "@rustybuns/models";
import * as THREE from "three";

const mat = (color: number, rough = 0.6, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

export type Thruster = { group: "rear" | "lift" | "spinL" | "spinR"; mount: THREE.Object3D };

/** The shared roadster; `render/plumes.ts` draws the exhaust out of each nozzle's mount. */
export function roadster() {
  const car = shared();
  car.group.userData = { model: "roadster", thrusters: car.nozzles as Thruster[], plate: car.plate };
  return car.group;
}

/** Deck length and width, in metres: a fingerboard is about 3.5 times as long as it is wide. */
export const DECK = { length: 4.4, width: 1.25 };

/** A side profile (z forward, y up) pulled across the deck's width. */
function slab(points: [number, number][], width: number) {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(-z, y)));
  return new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false }).rotateY(Math.PI / 2).translate(-width / 2, 0, 0);
}

/** One huge fingerboard, no rider: a kicked deck, black grip tape, a colour-blocked underside, steel trucks. */
export function fingerboard() {
  const g = new THREE.Group();
  const half = DECK.length / 2, rise = 0.32, flat = 1.3; // the nose and tail kick up past +-flat
  const top = 0.52, thick = 0.1;
  // Flat in the middle, kicked up at both ends.
  const zs = [-half, -half + 0.35, -flat, flat, half - 0.35, half];
  const lift = (z: number) => (Math.abs(z) <= flat ? 0 : rise * Math.min(1, (Math.abs(z) - flat) / (half - flat)) ** 1.6);
  const upper = zs.map((z): [number, number] => [z, top + lift(z)]);
  const lower = zs.map((z): [number, number] => [z, top - thick + lift(z)]).reverse();
  const deck = new THREE.Mesh(slab([...upper, ...lower], DECK.width), mat(0xd9572b, 0.55));
  deck.castShadow = deck.receiveShadow = true;
  // Colour blocks on the underside, and grip tape on top.
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(DECK.width + 0.01, 0.02, 0.9), mat(0xf2e8d0, 0.6));
  stripe.position.set(0, top - thick - 0.005, 0);
  const grip = new THREE.Mesh(slab(zs.map((z): [number, number] => [z, top + 0.025 + lift(z)]).concat(zs.map((z): [number, number] => [z, top + lift(z)]).reverse()), DECK.width - 0.06), mat(0x1c1c1e, 0.95));
  const steel = mat(0xa5acb4, 0.3, 0.9), wheel = mat(0xf2efe2, 0.5), tyre = mat(0x2b2b2b, 0.8);
  const flipper = new THREE.Group(); // what a kickflip turns: the deck and everything bolted to it
  flipper.add(deck, stripe, grip);
  for (const z of [-0.95, 0.95]) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.4), steel);
    plate.position.set(0, top - thick - 0.04, z);
    const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 8).rotateZ(Math.PI / 2), steel);
    hanger.position.set(0, top - thick - 0.17, z);
    flipper.add(plate, hanger);
    for (const x of [-0.72, 0.72]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.2, 18).rotateZ(Math.PI / 2), wheel);
      w.position.set(x, 0.19, z);
      w.castShadow = true;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.22, 10).rotateZ(Math.PI / 2), tyre);
      hub.position.copy(w.position);
      flipper.add(w, hub);
    }
  }
  g.add(flipper);
  g.userData = { model: "fingerboard", flipper };
  return g;
}
