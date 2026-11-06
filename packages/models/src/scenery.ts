// The scenery set (skate-tech-park's scripts/scenery.ts, one GLB with an object per kind) split back into one
// geometry per kind. Skate Tech Park plants its parks with it and Mythic Masters its open world, so both read it here.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Each of `kinds` in a loaded scenery scene as one merged, non-indexed geometry in world space, its material colour
 * baked into a `color` attribute so every kind draws with one vertex-coloured material. The exporter splits an object
 * into a mesh per material and names them after it, so a mesh's kind is the nearest object up the tree named for one;
 * a mesh under no listed kind is left out. Only position and colour are kept, plus the normals with `normals`.
 */
export function sceneryKinds<K extends string>(scene: THREE.Object3D, kinds: readonly K[], { normals = false } = {}): Map<K, THREE.BufferGeometry> {
  scene.updateMatrixWorld(true);
  const byKind = new Map<K, THREE.BufferGeometry[]>();
  const kindOf = (o: THREE.Object3D | null): K | undefined => {
    for (let p = o; p; p = p.parent) { const k = kinds.find((x) => x === p!.name); if (k) return k; }
  };
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !(o.material instanceof THREE.MeshStandardMaterial)) return;
    const kind = kindOf(o);
    if (!kind) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld), c = o.material.color, n = g.attributes.position!.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(a, 3));
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "color" && !(normals && k === "normal")) g.deleteAttribute(k);
    byKind.set(kind, [...(byKind.get(kind) ?? []), g.index ? g.toNonIndexed() : g]);
  });
  const out = new Map<K, THREE.BufferGeometry>();
  for (const [kind, parts] of byKind) { const geo = mergeGeometries(parts); if (geo) out.set(kind, geo); }
  return out;
}
