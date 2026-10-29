// A creature's body as a mesh, until the procedural models (#2706) replace the capsule. The arena and the
// world both draw it.
import * as THREE from "three";
import { COLOR } from "./fields.ts";
import { body, type Creature } from "./roster.ts";

/** Children: [0] the torso (its material flashes), "wing" ×2 for a flyer, "guard" the guard ring. */
export function creatureModel(c: Creature): THREE.Group {
  const b = body(c), g = new THREE.Group(), color = COLOR[c.fields[0]!];
  const skin = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const len = Math.max(0.01, b.height - b.radius * 2);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(b.radius, len, 6, 16), skin);
  torso.position.y = b.height / 2; torso.castShadow = true; g.add(torso);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(b.radius * 0.35, b.radius * 0.9, 12), new THREE.MeshStandardMaterial({ color: 0x222222 }));
  nose.rotation.z = -Math.PI / 2; nose.position.set(b.radius * 1.05, b.height * 0.7, 0); g.add(nose);
  if (b.air === "flight") for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(b.radius * 1.2, 0.06, b.radius * 2.6), skin);
    wing.position.set(-b.radius * 0.2, b.height * 0.65, s * b.radius * 1.6); wing.name = "wing"; g.add(wing);
  }
  const ring = new THREE.Mesh(new THREE.RingGeometry(b.radius * 1.15, b.radius * 1.35, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; ring.name = "guard"; ring.visible = false; g.add(ring);
  return g;
}
