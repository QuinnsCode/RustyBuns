// The craft, built from their drawing sheets (`craft-sheets.ts`). A wing is an `InstancedMesh` of up to 200, so a
// whole craft is one geometry in one material: its paint is baked into vertex colours, and it keeps to a few hundred
// triangles.
import * as THREE from "three";
import type { Role, Side } from "../names.ts";
import { CRAFT_SHEETS, type CraftSheet, type Paint } from "./craft-sheets.ts";
import { V, loft, merge, rod } from "./piece.ts";

const PAINT: Record<Side, Record<Paint, number>> = {
  navy: { hull: 0xd8dde4, plate: 0xb4bac3, dark: 0x59606a, glass: 0x2f6f9f, glow: 0xbfe8ff },
  rim: { hull: 0xc98a55, plate: 0xc9a05a, dark: 0x5a4536, glass: 0x6a4a1e, glow: 0xffc27a },
};

/** A craft's parts in its own metres, each with the paint it takes. */
function craftParts(s: CraftSheet): [THREE.BufferGeometry, Paint][] {
  const out: [THREE.BufferGeometry, Paint][] = [];
  for (const b of s.bodies) out.push([loft(b.stations, 6).translate(0, b.y ?? 0, b.z ?? 0), b.paint]);
  const slab = (profile: readonly (readonly [number, number])[], thick: number) =>
    new THREE.ExtrudeGeometry(new THREE.Shape(profile.map(([x, y]) => new THREE.Vector2(x, y))), { depth: thick, bevelEnabled: false }).translate(0, 0, -thick / 2);
  for (const w of s.wings) {
    const root = Math.min(...w.plan.map(([, z]) => z));
    for (const side of [1, -1]) {
      // Laid flat (the shape's y becomes z), then hung from its root so the tip droops.
      const g = slab(w.plan.map(([x, z]) => [x, z * side] as const), w.thick).rotateX(Math.PI / 2);
      g.translate(0, 0, -side * root).rotateX(side * (w.droop ?? 0)).translate(0, w.y, side * root);
      out.push([g, w.paint]);
    }
  }
  for (const f of s.fins) for (const side of f.z ? [1, -1] : [1]) out.push([slab(f.profile, f.thick).rotateX(side * f.cant).translate(0, f.y, side * f.z), f.paint]);
  for (const r of s.rods) for (const side of r.mirror ? [1, -1] : [1]) out.push([rod(V(r.x0, r.y, side * r.z), V(r.x1, r.y, side * r.z), r.radius, 5), r.paint]);
  for (const b of s.blocks) for (const side of b.mirror ? [1, -1] : [1]) out.push([new THREE.BoxGeometry(...b.size).translate(b.at[0], b.at[1], side * b.at[2]), b.paint]);
  for (const [x, y, z, r] of s.drives) {
    out.push([new THREE.CylinderGeometry(r, r * 0.8, 1.4, 6, 1, true).rotateZ(-Math.PI / 2).translate(x + 0.7, y, z), "dark"]);
    out.push([new THREE.CircleGeometry(r * 0.85, 6).rotateY(-Math.PI / 2).translate(x + 0.2, y, z), "glow"]);
  }
  return out;
}

/** A craft's one geometry at the battle's size, nose along +x, painted by vertex. */
export function craftGeometry(role: Role, side: Side): THREE.BufferGeometry {
  const sheet = CRAFT_SHEETS[side][role], parts = craftParts(sheet).map(([g, paint]) => [g.index ? g.toNonIndexed() : g, paint] as const);
  const out = merge(parts.map(([g]) => g));
  const colours = new Float32Array(out.getAttribute("position").count * 3), c = new THREE.Color();
  let at = 0;
  for (const [g, paint] of parts) {
    c.setHex(PAINT[side][paint]);
    for (let i = 0; i < g.getAttribute("position").count; i++, at += 3) c.toArray(colours, at);
  }
  out.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  const k = sheet.gameLength / sheet.length;
  return out.scale(k, k, k);
}

export const craftMaterial = (side: Side) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3, flatShading: true, emissive: side === "navy" ? 0x18222c : 0x2a1608 });
