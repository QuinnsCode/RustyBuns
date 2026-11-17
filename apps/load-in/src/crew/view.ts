// Your crew in the scene: a body and a head per friend, in their own colour, crouching when they crouch.
import * as THREE from "three";
import { EYE, EYE_CROUCH, type Mate } from "../sim.ts";

const COLOURS = [0xf4a261, 0x2a9d8f, 0xe76f51, 0x8ecae6, 0xffb703, 0xb5838d];

export function crewView(scene: THREE.Scene) {
  const bodies = new Map<string, THREE.Group>();
  const make = (n: number) => {
    const paint = new THREE.MeshStandardMaterial({ color: COLOURS[n % COLOURS.length], roughness: 0.8 });
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 1, 12).translate(0, 0.5, 0), paint);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), paint);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.1).translate(0, 0, -0.14), paint);
    head.add(nose);
    g.add(body, head);
    g.userData = { body, head };
    scene.add(g);
    return g;
  };
  return {
    update(crew: Mate[]) {
      for (const [id, g] of bodies) if (!crew.some((m) => m.id === id)) { scene.remove(g); bodies.delete(id); }
      crew.forEach((m, n) => {
        const g = bodies.get(m.id) ?? make(n);
        bodies.set(m.id, g);
        const eye = m.crouch ? EYE_CROUCH : EYE;
        g.position.set(m.x, 0, m.z);
        g.rotation.y = m.yaw;
        g.userData.body.scale.y = eye - 0.2;
        g.userData.head.position.y = eye - 0.05;
      });
    },
  };
}
