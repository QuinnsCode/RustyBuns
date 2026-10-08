import * as THREE from "three";
import { A_REST, RAIL_HALF, SEAT_NAMES, SEATS, WALL_R, seatAngle } from "../../sim/rules.ts";
import { LOOKS } from "./looks.ts";

/** Sim (x, y) on the pan -> three.js (x, height, -y). */
export const at = (x: number, y: number, h = 0) => new THREE.Vector3(x, h, -y);

function nameplate(text: string, color: number): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas"); c.width = 512; c.height = 96;
  const g = c.getContext("2d")!;
  g.fillStyle = "#2a1a05"; g.fillRect(0, 0, 512, 96);
  g.strokeStyle = "#e8b923"; g.lineWidth = 6; g.strokeRect(6, 6, 500, 84);
  g.fillStyle = "#" + color.toString(16).padStart(6, "0");
  g.font = "bold 46px Georgia, serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text.toUpperCase(), 256, 52);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function office(seat: number): THREE.Group {
  const L = LOOKS[seat]!, g = new THREE.Group();
  const wall = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.7 });
  const neon = new THREE.MeshStandardMaterial({ color: L.accent, emissive: L.accent, emissiveIntensity: 1.4 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9971c, metalness: 1, roughness: 0.3 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x555a60, metalness: 0.8, roughness: 0.45 });
  const mesh = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
  // back wall and gaudy roof trim
  mesh(new THREE.BoxGeometry(RAIL_HALF * 2 + 3, 1.4, 0.8), wall, 0, 0.7, 2.8);
  mesh(new THREE.BoxGeometry(RAIL_HALF * 2 + 3.4, 0.3, 1.2), brass, 0, 1.5, 2.8);
  for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.7, 2.2, 2.2), wall, s * (RAIL_HALF + 1.4), 1.1, 1.8);
  for (const s of [-1, 1]) mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.4, 6), steel, s * 2.2, 2.7, 2.6);
  // lip the hippo shuffles along
  mesh(new THREE.BoxGeometry(RAIL_HALF * 2 + 2, 0.14, 0.3), brass, 0, 0.07, 1.25);
  // neon dollar sign
  mesh(new THREE.TorusGeometry(0.45, 0.08, 8, 16, Math.PI * 1.5), neon, 0, 3.2, 2.35);
  mesh(new THREE.BoxGeometry(0.1, 1.4, 0.1), neon, 0, 3.2, 2.35);
  const tex = nameplate(SEAT_NAMES[seat]!, 0xf2d27a);
  if (tex) for (const back of [false, true]) {   // readable from the pan and from outside
    const pl = mesh(new THREE.PlaneGeometry(4.2, 0.8), new THREE.MeshBasicMaterial({ map: tex }), 0, 4.2, back ? 2.62 : 2.58);
    pl.rotation.y = back ? 0 : Math.PI;
  }
  // derrick: a lattice tower on each side, because oil money
  for (const s of [-1, 1]) {
    const x = s * (RAIL_HALF + 2.7);
    mesh(new THREE.ConeGeometry(0.9, 5, 4), new THREE.MeshStandardMaterial({ color: 0x777c82, metalness: 0.8, roughness: 0.4, wireframe: true }), x, 2.5, 2.2);
    mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 6), steel, x, 5.6, 2.2);
    mesh(new THREE.SphereGeometry(0.16, 10, 8), neon, x, 6.4, 2.2);
  }
  return g;
}

export function buildArena(): THREE.Group {
  const g = new THREE.Group();
  const pan = new THREE.Mesh(new THREE.CircleGeometry(WALL_R, 72), new THREE.MeshStandardMaterial({ color: 0x5a4a38, metalness: 0.35, roughness: 0.45 }));
  pan.rotation.x = -Math.PI / 2; pan.receiveShadow = true; g.add(pan);
  for (const r of [3, 6, 9]) {   // faint rings so the dishing and the speed read
    const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.03, r + 0.03, 72), new THREE.MeshBasicMaterial({ color: 0x4a3b22, transparent: true, opacity: 0.55 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01; g.add(ring);
  }
  const rim = new THREE.Mesh(new THREE.TorusGeometry(WALL_R + 0.25, 0.4, 12, 80), new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.9, roughness: 0.3 }));
  rim.rotation.x = Math.PI / 2; rim.position.y = 0.3; g.add(rim);
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 0.5, 20), new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.9, roughness: 0.35, emissive: 0x442200, emissiveIntensity: 0.6 }));
  pipe.position.y = 0.25; g.add(pipe);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; g.add(ground);
  for (let i = 0; i < SEATS; i++) {
    const o = office(i);
    const a = seatAngle(i), d = A_REST;
    // the office sits at the hippo's axis; its local +z is "behind the hippo"
    o.position.set(Math.cos(a) * d, 0, -Math.sin(a) * d);
    o.rotation.y = Math.atan2(Math.cos(a), -Math.sin(a));
    g.add(o);
  }
  return g;
}
