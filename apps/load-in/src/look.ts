// How a venue looks lit, and a light at your eyes. Each room gets the lights the real one has: a garage's two
// fluorescent strips and a work light at the door, a bar's warm spots over the stage, a neon sign and the load-in work
// light. A soft light rides with your eyes so whatever is in reach reads. Your hands are
// src/hands/. View only: the sim never reads it.
import * as THREE from "three";
import type { GearLook } from "@rustybuns/models/gear";
import type { Level } from "./sim.ts";

/** Lift the near-black gear paint a step so faces, grilles and edges show under stage light (real gear is black too). */
export function readable(look: GearLook) {
  const tune = (m: THREE.Material, color: number, roughness?: number, metalness?: number) => {
    if (!(m instanceof THREE.MeshStandardMaterial)) return;
    m.color.setHex(color);
    if (roughness !== undefined) m.roughness = roughness;
    if (metalness !== undefined) m.metalness = metalness;
  };
  tune(look.paint, 0x2b2d31);
  tune(look.tolex, 0x26241f, 0.75);
  tune(look.grille, 0x4a4e55, 0.4, 0.75);
  tune(look.panel, 0x5a5e66);
  tune(look.knob, 0x1c1c1c);
  tune(look.rubber, 0x1e1e1e);
}

type Fixture = { kind: "strip" | "spot" | "neon" | "work"; x: number; y: number; z: number; color: number; power: number; to?: [number, number, number] };

/** The fixtures in a room, from its size: where a real one would hang them. */
export function fixtures(l: Level): Fixture[] {
  if (l.outdoor) return [];
  const r = l.room, cx = (r.x0 + r.x1) / 2, d = r.z1 - r.z0, top = r.height - 0.04;
  const work: Fixture = { kind: "work", x: r.x1 - 0.4, y: 1.9, z: r.z1 - 0.6, color: 0xf4f8ff, power: 18, to: [cx, 0, r.z1 - 2.8] };
  if (l.name === "garage") return [
    { kind: "strip", x: cx, y: top, z: r.z0 + d * 0.28, color: 0xeef4ff, power: 7 },
    { kind: "strip", x: cx, y: top, z: r.z0 + d * 0.72, color: 0xeef4ff, power: 7 },
    work,
  ];
  // A bar: warm spots on the stage end, one over the room, a neon sign on the long wall, the work light by the door.
  return [
    { kind: "spot", x: cx - 1.2, y: top, z: r.z0 + 2.6, color: 0xffc47a, power: 40, to: [cx - 0.6, 0, r.z0 + 1.2] },
    { kind: "spot", x: cx + 1.2, y: top, z: r.z0 + 2.6, color: 0xffb36a, power: 40, to: [cx + 0.6, 0, r.z0 + 1.2] },
    { kind: "strip", x: cx, y: top, z: r.z0 + d * 0.6, color: 0xffd9a8, power: 9 },
    { kind: "neon", x: r.x1 - 0.03, y: 1.9, z: r.z0 + d * 0.45, color: 0xff3fa4, power: 5 },
    { kind: "neon", x: r.x0 + 0.03, y: 1.75, z: r.z0 + d * 0.7, color: 0x3fd8ff, power: 4 },
    work,
  ];
}

/** The lights and the fixtures you see for a level, as one group to add and remove with the room. */
export function venueLights(l: Level): THREE.Group {
  const g = new THREE.Group();
  const glow = (color: number) => new THREE.MeshBasicMaterial({ color });
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    g.add(b);
    return b;
  };
  for (const f of fixtures(l)) {
    if (f.kind === "strip") {
      box(1.25, 0.05, 0.14, new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.6 }), f.x, f.y, f.z);
      box(1.18, 0.02, 0.09, glow(f.color), f.x, f.y - 0.03, f.z);
      for (const dx of [-0.4, 0.4]) {
        const p = new THREE.PointLight(f.color, f.power, 9, 1.4);
        p.position.set(f.x + dx, f.y - 0.12, f.z);
        g.add(p);
      }
    } else if (f.kind === "neon") {
      // A sign of our own: a looped tube on a backing, washing the wall in its colour.
      const tube = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.018, 6, 28), glow(f.color));
      tube.position.set(f.x, f.y, f.z);
      tube.rotation.y = Math.PI / 2;
      tube.scale.set(1, 0.6, 1);
      g.add(tube);
      const bar = box(0.02, 0.03, 0.6, glow(f.color), f.x, f.y - 0.28, f.z);
      bar.position.x += f.x > 0 ? -0.01 : 0.01;
      const p = new THREE.PointLight(f.color, f.power, 5, 1.6);
      p.position.set(f.x + (f.x > 0 ? -0.35 : 0.35), f.y, f.z);
      g.add(p);
    } else {
      const s = new THREE.SpotLight(f.color, f.power, 14, f.kind === "work" ? 0.75 : 0.55, 0.5, 1.3);
      s.position.set(f.x, f.y, f.z);
      s.target.position.set(...(f.to ?? [f.x, 0, f.z]));
      g.add(s, s.target);
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.16, 10), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 }));
      can.position.set(f.x, f.y - (f.kind === "work" ? 0 : 0.06), f.z);
      can.lookAt(s.target.position);
      can.rotateX(Math.PI / 2);
      g.add(can);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.07, 12), glow(f.color));
      lens.position.copy(can.position).lerp(s.target.position, 0.09 / can.position.distanceTo(s.target.position));
      lens.lookAt(s.target.position);
      g.add(lens);
    }
  }
  return g;
}

/** A soft light at your eyes: what you can reach reads, however dark the corner. */
export function eyeFill(camera: THREE.Camera) {
  const p = new THREE.PointLight(0xfff1dc, 2.6, 4, 1.2);
  p.position.set(0, 0.1, 0.05);
  camera.add(p);
  return p;
}

