// What the hippos found: a long-dead oil well, swallowed by the jungle. A rusted
// casing and valve at the geyser, a derrick that has fallen into the trees, a
// pump-jack half sunk in the mud, a couple of barrels. Barely anything built.
import * as THREE from "three";
import { barrels, derrick, pumpJack, RUST, DARK_IRON, VINE, type Animated } from "./industry.ts";

const MOSS = new THREE.MeshStandardMaterial({ color: 0x3c5a26, roughness: 1 });

function vine(a: THREE.Vector3, b: THREE.Vector3, sag: number): THREE.Mesh {
  const mid = a.clone().lerp(b, 0.5); mid.y -= sag;
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([a, mid, b]), 14, 0.04, 5), VINE);
}

export function ruins(): { group: THREE.Group; animated: Animated[] } {
  const g = new THREE.Group(), animated: Animated[] = [];
  const put = (o: THREE.Object3D, x: number, y: number, z: number) => { o.position.set(x, y, z); g.add(o); return o; };

  // the wellhead round the geyser: a rusted casing ring, a valve wheel, pipe stubs, all furred with moss
  const casing = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.22, 10, 36), RUST); casing.rotation.x = Math.PI / 2; casing.castShadow = true; put(casing, 0, 0.2, 0);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.06, 8, 24), RUST); wheel.rotation.set(0.5, 0.6, 0); wheel.castShadow = true; put(wheel, 2.3, 0.7, 1.2);
  for (const [x, z, tilt] of [[2.3, 1.2, 0.0], [-2.4, 1.6, 0.5], [-1.6, -2.4, -0.4]] as const) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 1.5, 10), x === 2.3 ? DARK_IRON : RUST); pipe.rotation.z = tilt; pipe.castShadow = true; put(pipe, x, 0.55, z);
    put(new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), MOSS), x, 0.1, z).scale.y = 0.5;
  }

  // the old derrick lies where it fell, propped on the treeline
  const rig = derrick(8); rig.rotation.set(0.1, 0.3, -1.1); rig.scale.setScalar(1.15); put(rig, -17.5, 0.2, -12);
  for (const dz of [-0.6, 0.5]) g.add(vine(new THREE.Vector3(-14.5, 5, -12 + dz), new THREE.Vector3(-16.5, 0.4, -11.5 + dz), 1.2));

  // a pump-jack the mud has half swallowed
  const jack = pumpJack(1.3); jack.rotation.y = -0.7; jack.scale.setScalar(1.1); put(jack, 15.5, -0.55, -9); animated.push(jack);

  const b = barrels(); b.rotation.set(0, 0.5, 0); put(b, -13.8, 0, 8.5);
  const tipped = barrels(); tipped.scale.setScalar(0.8); tipped.rotation.set(0, 1.2, 1.35); put(tipped, 14, 0.5, 11);
  return { group: g, animated };
}
