// The Blender plants (blender/flora.py -> public/models/flora.glb): bushes, saguaros, barrel cacti and prickly
// pear. Each plant becomes one geometry with its materials baked into vertex colours, so a zone draws every
// plant of a kind as one instanced mesh and tints each copy a little.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { hashString } from "../geo.ts";

export const BUSHES = ["bush0", "bush1", "bush2"] as const;
export const SAGUAROS = ["saguaro0", "saguaro1"] as const;
export const CACTI = ["barrel", "pear"] as const;

let plants: Map<string, THREE.BufferGeometry> | null = null;
let loading: Promise<boolean> | null = null;

/** The plants' geometries once the model is in, else null (draw the primitives meanwhile). */
export const flora = (): ReadonlyMap<string, THREE.BufferGeometry> | null => plants;

/** Resolves true once the plants are in, false if the model couldn't load. */
export function floraReady(): Promise<boolean> {
  if (!loading) {
    loading = typeof document === "undefined" ? Promise.resolve(false)
      : new GLTFLoader().loadAsync(new URL("models/flora.glb", document.baseURI).href).then(
        (gltf) => { useFloraModel(gltf.scene); return true; },
        (e) => { console.warn("flora model", e); return false; });
  }
  return loading;
}

/** Takes the plants out of a loaded flora.glb: one geometry per plant, its material colours in a colour attribute. */
export function useFloraModel(scene: THREE.Object3D) {
  const found = new Map<string, THREE.BufferGeometry>();
  scene.updateMatrixWorld(true);
  for (const node of scene.children) {
    const pieces: THREE.BufferGeometry[] = [];
    node.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", m.geometry.attributes.position.clone());
      geo.setAttribute("normal", m.geometry.attributes.normal.clone());
      if (m.geometry.index) geo.setIndex(m.geometry.index.clone());
      geo.applyMatrix4(m.matrixWorld);
      const c = (m.material as THREE.MeshStandardMaterial).color;
      const n = geo.attributes.position.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      pieces.push(geo);
    });
    const merged = pieces.length ? mergeGeometries(pieces) : null;
    if (merged) found.set(node.name, merged);
  }
  plants = found;
}

/** Which of a family a prop at (x, y) is: fixed by where it stands, so every player sees the same one. */
export function variant<T extends string>(family: readonly T[], x: number, y: number): T {
  return family[hashString(`${x.toFixed(2)},${y.toFixed(2)}`) % family.length];
}
