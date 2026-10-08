// Fewer draw calls: the scene is built from many small meshes (teeth, vials, medals,
// flowers, boulders), which is easy to write and slow to draw. Once a part is built,
// its static meshes are baked into one mesh per material.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const ATTRS = ["position", "normal", "uv"] as const;

/** A copy with exactly position, normal and uv, so any two can be merged. */
function normalised(src: THREE.BufferGeometry, flat: boolean): THREE.BufferGeometry {
  const g = flat && src.index ? src.toNonIndexed() : src.clone();
  for (const name of Object.keys(g.attributes)) if (!(ATTRS as readonly string[]).includes(name)) g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position!.count * 2), 2));
  g.clearGroups(); g.morphAttributes = {};
  return g;
}

/**
 * Replace the direct Mesh children of `parent` (except those `keep` names) with one mesh
 * per material and shadow setting, their transforms baked in. Groups, instanced meshes
 * and anything kept are left alone, so animated parts stay separate. Returns how many
 * meshes went away.
 */
export function mergeChildren(parent: THREE.Object3D, keep: (o: THREE.Object3D) => boolean = () => false): number {
  const meshes = parent.children.filter((o): o is THREE.Mesh =>
    o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh) && !Array.isArray(o.material) && o.visible && !keep(o));
  const buckets = new Map<string, THREE.Mesh[]>();
  for (const m of meshes) {
    const key = `${(m.material as THREE.Material).uuid}|${m.castShadow}|${m.receiveShadow}`;
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(m);
  }
  let removed = 0;
  for (const group of buckets.values()) {
    if (group.length < 2) continue;
    const flat = group.some((m) => !m.geometry.index);                 // mergeGeometries wants all indexed or none
    const geos = group.map((m) => { m.updateMatrix(); return normalised(m.geometry, flat).applyMatrix4(m.matrix); });
    const geo = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!geo) continue;
    const merged = new THREE.Mesh(geo, group[0]!.material);
    merged.castShadow = group[0]!.castShadow; merged.receiveShadow = group[0]!.receiveShadow;
    merged.name = "merged";
    for (const m of group) { parent.remove(m); m.geometry.dispose(); }
    parent.add(merged);
    removed += group.length - 1;
  }
  return removed;
}

/** Count what the GPU will be asked to draw under `root` (meshes, instanced meshes, points, sprites). */
export function countDrawables(root: THREE.Object3D): number {
  let n = 0;
  root.traverseVisible((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Sprite) n += Array.isArray((o as THREE.Mesh).material) ? ((o as THREE.Mesh).material as THREE.Material[]).length : 1;
  });
  return n;
}
