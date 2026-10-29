// A creature's body as a mesh: built by `beast()` in packages/models from its look (a body plan plus the parts
// its legend gives it), scaled to its body height. The arena and the world both draw it.
import * as THREE from "three";
import { beast } from "@rustybuns/models";
import { body, type Creature } from "./roster.ts";

export const ELEMENT: Record<string, number> = { air: 0xcfe0ff, water: 0x3d8bfd, earth: 0xb08a50, fire: 0xff6b35, shadow: 0x9a6fd0, wild: 0x58b85c };

const seedOf = (id: string) => [...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

/** Groups named "wing" (one each side, hinged at the shoulder) flap; meshes painted "hide" flash; "guard" is the guard ring. */
export function creatureModel(c: Creature): THREE.Group {
  const b = body(c), g = new THREE.Group(), shape = beast(c.look, seedOf(c.id));
  shape.scale.setScalar(b.height);
  shape.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  g.add(shape);
  const ring = new THREE.Mesh(new THREE.RingGeometry(b.radius * 1.15, b.radius * 1.35, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; ring.name = "guard"; ring.visible = false; g.add(ring);
  return g;
}
