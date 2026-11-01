// A beast's skin is decimated to a few thousand triangles after Blender smooths it, so every fold sharper
// than its 40° auto-smooth comes out as a hard edge and the hide looks cut from card. Here every vertex that
// shares a position with others (across parts too, so a blob or a part meets the body without a seam) takes
// the average of their normals, skipping any more than `crease` degrees off its own: a horn's tip, a tooth
// or a claw stays sharp. Only normals change; positions, order and count stay, so the rig's weights still fit.
import type * as THREE from "three";

export function smoothNormals(geometries: THREE.BufferGeometry[], crease = 70): void {
  const cos = Math.cos((crease * Math.PI) / 180);
  const at = new Map<string, number[]>(); // position key -> flat list of [geometry, vertex] pairs
  for (let g = 0; g < geometries.length; g++) {
    const pos = geometries[g]!.getAttribute("position");
    if (!geometries[g]!.getAttribute("normal")) continue;
    for (let v = 0; v < pos.count; v++) {
      const k = `${Math.round(pos.getX(v) * 1e4)},${Math.round(pos.getY(v) * 1e4)},${Math.round(pos.getZ(v) * 1e4)}`;
      let list = at.get(k);
      if (!list) at.set(k, (list = []));
      list.push(g, v);
    }
  }
  const before = geometries.map((g) => (g.getAttribute("normal") ? Float32Array.from(g.getAttribute("normal").array) : null));
  for (const list of at.values()) {
    if (list.length < 4) continue; // alone at its position: nothing to blend with
    for (let i = 0; i < list.length; i += 2) {
      const a = before[list[i]!]!, ai = list[i + 1]! * 3;
      let x = 0, y = 0, z = 0;
      for (let j = 0; j < list.length; j += 2) {
        const b = before[list[j]!]!, bi = list[j + 1]! * 3;
        if (a[ai]! * b[bi]! + a[ai + 1]! * b[bi + 1]! + a[ai + 2]! * b[bi + 2]! < cos) continue;
        x += b[bi]!; y += b[bi + 1]!; z += b[bi + 2]!;
      }
      const len = Math.hypot(x, y, z) || 1;
      geometries[list[i]!]!.getAttribute("normal").setXYZ(list[i + 1]!, x / len, y / len, z / len);
    }
  }
  for (const g of geometries) { const n = g.getAttribute("normal"); if (n) n.needsUpdate = true; }
}
