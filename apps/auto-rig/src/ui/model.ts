// Models in: a glTF/GLB or a built-in sample. Every mesh is baked into world
// space as it's shown (an existing rig is thrown away: its current pose is the
// rest pose), then scaled so the model stands on the ground with a bounding
// box diagonal of 2. One merged buffer goes to the rigger; the meshes keep their
// materials for display and get their slice of the weights back.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Mesh as RawMesh } from "../rig/samples.ts";

export interface Part { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; start: number; count: number }
export interface Model { name: string; parts: Part[]; positions: Float32Array; indices: Uint32Array; triangles: number; credit?: string }

export const SAMPLES: { id: string; label: string; url?: string; credit?: string }[] = [
  { id: "gingerbread", label: "Gingerbread" },
  { id: "lizard", label: "Lizard" },
  {
    id: "fox", label: "Fox",
    url: "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Fox/glTF-Binary/Fox.glb",
    credit: "Fox: PixelMannen (CC0), rigging by @tomkranis (CC BY 4.0), Khronos glTF sample assets",
  },
  {
    id: "cesium-man", label: "Cesium Man",
    url: "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CesiumMan/glTF-Binary/CesiumMan.glb",
    credit: "Cesium Man: Cesium (CC BY 4.0), Khronos glTF sample assets",
  },
];

export async function loadGlb(data: ArrayBuffer, name: string, credit?: string): Promise<Model> {
  const gltf = await new GLTFLoader().parseAsync(data, "");
  gltf.scene.updateMatrixWorld(true);
  const sources: THREE.Mesh[] = [];
  gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.visible) sources.push(o as THREE.Mesh); });
  if (sources.length === 0) throw new Error("no meshes in this file");
  const baked = sources.map((m) => ({ geometry: bake(m), material: m.material }));
  return finish(name, baked, credit);
}

export function fromRaw(raw: RawMesh, name: string): Model {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(raw.positions.slice(), 3));
  g.setIndex(new THREE.BufferAttribute(raw.indices.slice(), 1));
  g.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ color: 0xc8874a, roughness: 0.75 });
  return finish(name, [{ geometry: g, material }]);
}

/** Positions as rendered right now (skinning and morphs applied), in world space. */
function bake(mesh: THREE.Mesh): THREE.BufferGeometry {
  const src = mesh.geometry;
  const n = src.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    mesh.getVertexPosition(i, v);
    v.applyMatrix4(mesh.matrixWorld);
    pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  if (src.attributes.uv) g.setAttribute("uv", src.attributes.uv.clone());
  if (src.attributes.color) g.setAttribute("color", src.attributes.color.clone());
  if (src.index) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(src.index.array as ArrayLike<number>), 1));
  else g.setIndex(new THREE.BufferAttribute(Uint32Array.from({ length: n }, (_, i) => i), 1));
  for (const gr of src.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
  g.computeVertexNormals();
  return g;
}

function finish(name: string, parts: { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] }[], credit?: string): Model {
  // stand it on the ground, centered, with a bounding box diagonal of 2
  const box = new THREE.Box3();
  for (const p of parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox!); }
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const s = 2 / Math.max(size.length(), 1e-9);
  const fit = new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));
  let V = 0, I = 0;
  for (const p of parts) { p.geometry.applyMatrix4(fit); V += p.geometry.attributes.position.count; I += p.geometry.index!.count; }
  const positions = new Float32Array(V * 3), indices = new Uint32Array(I);
  const out: Part[] = [];
  let v0 = 0, i0 = 0;
  for (const p of parts) {
    const pa = p.geometry.attributes.position.array as Float32Array, ia = p.geometry.index!.array;
    positions.set(pa, v0 * 3);
    for (let i = 0; i < ia.length; i++) indices[i0 + i] = ia[i] + v0;
    out.push({ geometry: p.geometry, material: p.material, start: v0, count: p.geometry.attributes.position.count });
    v0 += p.geometry.attributes.position.count; i0 += ia.length;
  }
  return { name, parts: out, positions, indices, triangles: I / 3, credit };
}
