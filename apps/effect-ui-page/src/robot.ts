// A player's body in Agent Galaxy: a robot built from its parts (galaxy.ts's Look), front toward -z, its feet on 0
// and about 6 units tall. Only the page's own scene draws one (land3d.ts): a world is never told what anyone looks
// like.
import * as THREE from "three";
import { type Look, PAINTS } from "./galaxy.ts";

export function robot(look: Look): THREE.Group {
  const g = new THREE.Group();
  const metal = (color: string) => new THREE.MeshStandardMaterial({ color, metalness: 0.25, roughness: 0.4 });
  const body = metal(PAINTS[look.paint]!), trim = metal("#c9d1dc"), dark = metal("#2b2f3a");
  const light = (color: string) => new THREE.MeshBasicMaterial({ color });
  const eye = light("#8ffcff");
  const put = (geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const tube = (r: number, h: number, sides = 12) => new THREE.CylinderGeometry(r, r, h, sides);
  const ball = (r: number) => new THREE.SphereGeometry(r, 16, 12);

  if (look.feet === "wheels") for (const x of [-1.15, 1.15]) {
    put(tube(0.75, 0.6, 18), dark, x, 0.75).rotation.z = Math.PI / 2;
    put(tube(0.28, 0.7), trim, x, 0.75).rotation.z = Math.PI / 2;
  }
  if (look.feet === "legs") for (const x of [-0.6, 0.6]) { put(tube(0.24, 1.2), trim, x, 0.75); put(box(0.75, 0.34, 1.1), dark, x, 0.17, -0.15); }
  if (look.feet === "hover") {
    put(new THREE.ConeGeometry(0.9, 0.9, 18), dark, 0, 1.15).rotation.x = Math.PI;
    put(new THREE.TorusGeometry(0.75, 0.12, 8, 28), eye, 0, 0.55).rotation.x = Math.PI / 2;
  }
  // The body, its three lamps, arms and pack.
  const y = 1.35 + (look.feet === "hover" ? 0.7 : 0);
  put(box(2, 1.9, 1.5), body, 0, y + 0.95);
  put(box(1.1, 0.8, 0.1), dark, 0, y + 1.05, -0.78);
  ["#ff5a5a", "#ffd24a", "#6dff8a"].forEach((c, i) => put(ball(0.1), light(c), -0.3 + i * 0.3, y + 1.05, -0.85));
  for (const x of [-1.25, 1.25]) {
    put(ball(0.28), trim, x, y + 1.55);
    put(tube(0.16, 1.2, 8), trim, x * 1.04, y + 0.95);
    put(ball(0.3), dark, x * 1.06, y + 0.3);
  }
  put(tube(0.3, 0.3), dark, 0, y + 2.05);
  put(box(1.4, 1.2, 0.4), trim, 0, y + 1.05, 0.92);
  put(box(0.9, 0.16, 0.1), eye, 0, y + 1.3, 1.15);
  // The head, and where its face and crown are.
  const h = y + 2.9;
  let face = -0.72, crown = h + 0.7;
  if (look.head === "box") put(box(1.7, 1.35, 1.4), body, 0, h);
  if (look.head === "dome") {
    put(tube(0.9, 0.8, 24), body, 0, h - 0.25);
    put(new THREE.SphereGeometry(0.9, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), body, 0, h + 0.15);
    face = -0.9; crown = h + 1.05;
  }
  if (look.head === "screen") { put(box(2.1, 1.5, 1.1), body, 0, h); put(box(1.75, 1.15, 0.1), dark, 0, h, -0.56); face = -0.62; crown = h + 0.75; }
  if (look.eyes === "two") for (const x of [-0.38, 0.38]) put(ball(0.2), eye, x, h, face);
  if (look.eyes === "visor") put(box(1.25, 0.26, 0.18), eye, 0, h + 0.02, face);
  if (look.eyes === "one") { put(new THREE.TorusGeometry(0.4, 0.09, 8, 28), trim, 0, h, face); put(ball(0.26), eye, 0, h, face); }
  if (look.top === "antenna") { put(tube(0.05, 0.9, 6), trim, 0, crown + 0.4); put(ball(0.18), light("#ff4f6a"), 0, crown + 0.95); }
  if (look.top === "propeller") { put(tube(0.07, 0.45, 6), dark, 0, crown + 0.2); put(box(2, 0.07, 0.24), metal("#ffd24a"), 0, crown + 0.45).name = "spins"; }
  if (look.top === "ears") for (const x of [-0.5, 0.5]) put(new THREE.ConeGeometry(0.28, 0.65, 4), body, x, crown + 0.25);
  return g;
}
