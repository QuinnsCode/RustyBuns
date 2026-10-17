// The edge of a park, drawn: a paper-white wall with an orange hazard band at its foot and a post every few
// strides, standing where the sim stops the board. It brightens as the rider closes on it.
import * as THREE from "three";
import type { Bounds } from "../level.ts";

const STEP = 4; // metres between wall columns
const TALL = 14; // metres above the ground the wall stands
const POSTS = 24; // metres between posts
const NEAR = 40; // metres from the wall where it starts to glow

/** The wall's footprint walked once round, a column every `step` metres: the corner of each side opens the next. */
export function perimeter(b: Bounds, step = STEP): { x: number; z: number }[] {
  const sides: [number, number, number, number][] = [[b.minX, b.minZ, b.maxX, b.minZ], [b.maxX, b.minZ, b.maxX, b.maxZ], [b.maxX, b.maxZ, b.minX, b.maxZ], [b.minX, b.maxZ, b.minX, b.minZ]];
  return sides.flatMap(([x0, z0, x1, z1]) => {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / step));
    return Array.from({ length: n }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / n, z: z0 + ((z1 - z0) * i) / n }));
  });
}

/** Hazard stripes at the foot, a fading pane above, a bright orange cap. */
function skin() {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 256;
  const g = c.getContext("2d")!;
  const fade = g.createLinearGradient(0, 0, 0, 256);
  fade.addColorStop(0, "rgba(255,255,255,0.0)");
  fade.addColorStop(0.15, "rgba(255,244,230,0.35)");
  fade.addColorStop(0.7, "rgba(255,255,255,0.12)");
  fade.addColorStop(1, "rgba(255,255,255,0.0)");
  g.fillStyle = fade;
  g.fillRect(0, 0, 128, 256);
  g.fillStyle = "#ff7a1a"; g.fillRect(0, 12, 128, 5); // the cap, up the wall
  g.fillStyle = "#f4efe6"; g.fillRect(0, 196, 128, 60); // the foot: orange chevrons on paper
  g.fillStyle = "#ff7a1a";
  for (let x = -64; x < 192; x += 32) { g.beginPath(); g.moveTo(x, 256); g.lineTo(x + 16, 256); g.lineTo(x + 48, 196); g.lineTo(x + 32, 196); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Barrier {
  readonly group = new THREE.Group();
  private readonly pane: THREE.MeshBasicMaterial;
  private readonly bounds: Bounds;

  constructor(bounds: Bounds, ground: (x: number, z: number) => number) {
    this.bounds = bounds;
    const ring = perimeter(bounds), n = ring.length, pos: number[] = [], uv: number[] = [], idx: number[] = [];
    ring.forEach((p, i) => {
      const y = ground(p.x, p.z), u = (i * STEP) / 16;
      pos.push(p.x, y - 1, p.z, p.x, y + TALL, p.z);
      uv.push(u, 0, u, 1);
      const a = i * 2, b = ((i + 1) % n) * 2;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    this.pane = new THREE.MeshBasicMaterial({ map: skin(), transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.55 });
    const wall = new THREE.Mesh(geo, this.pane);
    wall.renderOrder = 2;
    this.group.add(wall);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, TALL + 1, 0.5), new THREE.MeshBasicMaterial({ color: 0xff7a1a }));
    for (let i = 0; i < n; i += POSTS / STEP) {
      const p = ring[i]!, m = post.clone();
      m.position.set(p.x, ground(p.x, p.z) + (TALL - 1) / 2, p.z);
      this.group.add(m);
    }
  }

  /** Solid when the rider is at the wall, a faint hint far off. */
  update(x: number, z: number) {
    const b = this.bounds, d = Math.min(x - b.minX, b.maxX - x, z - b.minZ, b.maxZ - z);
    this.pane.opacity = 0.35 + 0.65 * Math.max(0, 1 - d / NEAR);
  }
}
