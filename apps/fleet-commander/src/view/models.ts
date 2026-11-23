// The hulls, made in code: plain three.js shapes, no files. The navy builds sharp wedges in pale grey; the Compact flies
// what it could weld together, long industrial hulls in rust and ochre with their drives showing.
import * as THREE from "three";
import type { Role, ShipKind, Side } from "../names.ts";

const navyHull = () => new THREE.MeshStandardMaterial({ color: 0xc9cdd3, roughness: 0.55, metalness: 0.35, flatShading: true });
const navyDark = () => new THREE.MeshStandardMaterial({ color: 0x6d737c, roughness: 0.7, metalness: 0.3, flatShading: true });
const rimHull = () => new THREE.MeshStandardMaterial({ color: 0x9a6a45, roughness: 0.8, metalness: 0.25, flatShading: true });
const rimDark = () => new THREE.MeshStandardMaterial({ color: 0x4d3a2d, roughness: 0.9, metalness: 0.2, flatShading: true });
const glow = (c: number) => new THREE.MeshBasicMaterial({ color: c });

export const ENGINE: Record<Side, number> = { navy: 0x9fd8ff, rim: 0xffb36b };

/** A flat wedge pointing +x: `len` long, `wide` at the stern, `tall` thick. */
function wedge(len: number, wide: number, tall: number, mat: THREE.Material) {
  const s = new THREE.Shape();
  s.moveTo(len / 2, 0); s.lineTo(-len / 2, wide / 2); s.lineTo(-len / 2, -wide / 2); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: tall, bevelEnabled: true, bevelThickness: tall * 0.35, bevelSize: tall * 0.3, bevelSegments: 1 });
  g.rotateX(-Math.PI / 2); g.translate(0, -tall / 2, 0);
  return new THREE.Mesh(g, mat);
}

const box = (x: number, y: number, z: number, mat: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(x, y, z), mat);
const cyl = (r: number, l: number, mat: THREE.Material, seg = 10) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, seg), mat); m.rotation.z = Math.PI / 2; return m; };

function engines(g: THREE.Group, x: number, zs: number[], r: number, side: Side) {
  for (const z of zs) { const e = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), glow(ENGINE[side])); e.position.set(x, 0, z); e.scale.set(0.5, 1, 1); e.userData.engine = true; g.add(e); }
}

/** A capital ship's model, about `HULL[kind].r * 2` long, nose along +x. */
export function shipModel(kind: ShipKind, side: Side): THREE.Group {
  const g = new THREE.Group();
  if (side === "navy") {
    const hull = navyHull(), dark = navyDark();
    const L = kind === "dreadnought" ? 470 : kind === "destroyer" ? 190 : 85;
    const W = kind === "dreadnought" ? 120 : kind === "destroyer" ? 115 : 42;
    const T = L * 0.07;
    g.add(wedge(L, W, T, hull));
    const top = wedge(L * 0.62, W * 0.55, T * 0.9, hull); top.position.set(-L * 0.17, T * 0.8, 0); g.add(top);
    const trench = box(L * 0.7, T * 0.4, W * 0.04, dark); trench.position.set(-L * 0.1, T * 1.35, 0); g.add(trench);
    if (kind !== "frigate") {
      // The command tower and its bridge bar, with two sensor globes.
      const tower = box(L * 0.09, T * 1.6, W * 0.16, hull); tower.position.set(-L * 0.38, T * 2.2, 0); g.add(tower);
      const bridge = box(L * 0.05, T * 0.35, W * 0.42, dark); bridge.position.set(-L * 0.38, T * 3.05, 0); g.add(bridge);
      for (const z of [-1, 1]) { const ball = new THREE.Mesh(new THREE.SphereGeometry(T * 0.32, 10, 8), hull); ball.position.set(-L * 0.38, T * 3.5, z * W * 0.12); g.add(ball); }
      // City lights along the hull: the size of the thing.
      const lights = new THREE.Group();
      for (let i = 0; i < 40; i++) { const k = Math.random(), x = L / 2 - k * L * 0.95, wz = (W / 2) * k * (Math.random() * 1.8 - 0.9); const l = box(1.6, 0.6, 1.6, glow(0xfff1c8)); l.position.set(x, T * 0.6, wz); lights.add(l); }
      g.add(lights);
      engines(g, -L / 2 - 2, kind === "dreadnought" ? [-36, -18, 0, 18, 36] : [-22, 0, 22], T * 0.55, side);
    } else {
      // The interdictor's well projectors: four domes.
      for (const [x, z] of [[-10, -12], [-10, 12], [8, -8], [8, 8]]) { const d = new THREE.Mesh(new THREE.SphereGeometry(6, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), dark); d.position.set(x, T, z); g.add(d); }
      engines(g, -L / 2 - 1, [-6, 6], 3.5, side);
    }
    return g;
  }
  const hull = rimHull(), dark = rimDark();
  if (kind === "cruiser") {
    // A long spine: armoured prow, ribbed mid-section, drive cylinder.
    g.add(box(150, 22, 30, hull));
    const prow = box(40, 28, 38, dark); prow.position.x = 70; g.add(prow);
    for (let i = 0; i < 6; i++) { const rib = box(5, 34, 44, dark); rib.position.x = -40 + i * 16; g.add(rib); }
    const drive = cyl(18, 30, dark, 12); drive.position.x = -88; g.add(drive);
    engines(g, -104, [0], 12, side);
  } else if (kind === "carrier") {
    // A broad body with a flight pod down each flank.
    g.add(box(140, 18, 50, hull));
    for (const z of [-42, 42]) { const pod = box(120, 14, 22, dark); pod.position.set(-6, 0, z); g.add(pod); const bay = box(100, 3, 16, glow(0x2a1a10)); bay.position.set(-6, 7.6, z); g.add(bay); }
    const head = box(30, 26, 36, hull); head.position.x = 70; g.add(head);
    engines(g, -78, [-14, 14], 9, side);
  } else if (kind === "corvette") {
    g.add(cyl(9, 44, hull, 8));
    const block = box(16, 20, 26, dark); block.position.x = 24; g.add(block);
    const pods = box(10, 10, 34, dark); pods.position.x = -18; g.add(pods);
    engines(g, -26, [-10, 0, 10], 4.5, side);
  } else if (kind === "station") {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(75, 7, 8, 32), hull); ring.rotation.x = Math.PI / 2; g.add(ring);
    const spindle = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 70, 10), dark); g.add(spindle);
    for (let i = 0; i < 4; i++) { const spoke = box(150, 5, 5, dark); spoke.rotation.y = (i * Math.PI) / 4; g.add(spoke); }
    const dish = new THREE.Mesh(new THREE.SphereGeometry(22, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), hull); dish.position.y = 35; g.add(dish);
  } else {
    g.add(box(120, 20, 40, hull));
  }
  return g;
}

/** A fighter's model, nose along +x, drawn larger than life so a wing reads at fleet scale. */
export function craftGeometry(role: Role, side: Side): THREE.BufferGeometry {
  const s = new THREE.Shape();
  if (role === "interceptor") { s.moveTo(9, 0); s.lineTo(-6, 6); s.lineTo(-3, 0); s.lineTo(-6, -6); s.closePath(); }
  else if (role === "bomber") { s.moveTo(7, 0); s.lineTo(2, 5); s.lineTo(-7, 6); s.lineTo(-7, -6); s.lineTo(2, -5); s.closePath(); }
  else { s.moveTo(8, 0); s.lineTo(0, 7); s.lineTo(-7, 4); s.lineTo(-7, -4); s.lineTo(0, -7); s.closePath(); }
  const g = new THREE.ExtrudeGeometry(s, { depth: 2, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  if (side === "rim") g.scale(1.05, 1, 1.1);
  return g;
}

export const craftMaterial = (side: Side) => new THREE.MeshStandardMaterial({ color: side === "navy" ? 0xd8dde4 : 0xc98a55, roughness: 0.6, metalness: 0.3, flatShading: true, emissive: side === "navy" ? 0x18222c : 0x2a1608 });

/** A planet's skin: banded continents and cloud, drawn into a canvas from a seed. */
export function planetTexture(seed: number): THREE.CanvasTexture {
  const c = document.createElement("canvas"); c.width = 512; c.height = 256;
  const x = c.getContext("2d")!;
  let s = seed >>> 0;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  x.fillStyle = "#1d3b52"; x.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 90; i++) {
    x.fillStyle = ["#3b5a3a", "#5d6b3f", "#7a6a48", "#2f4a33"][Math.floor(r() * 4)];
    x.beginPath(); x.ellipse(r() * 512, 40 + r() * 176, 10 + r() * 50, 6 + r() * 24, r() * 3, 0, Math.PI * 2); x.fill();
  }
  x.globalAlpha = 0.35; x.fillStyle = "#e8eef2";
  for (let i = 0; i < 70; i++) { x.beginPath(); x.ellipse(r() * 512, r() * 256, 20 + r() * 60, 2 + r() * 6, 0, 0, Math.PI * 2); x.fill(); }
  x.globalAlpha = 0.9; x.fillStyle = "#f4f7fa"; x.fillRect(0, 0, 512, 10); x.fillRect(0, 246, 512, 10);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A soft round dot for glows and explosions. */
export function dotTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const x = c.getContext("2d")!, g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.25, "rgba(255,255,255,0.65)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
