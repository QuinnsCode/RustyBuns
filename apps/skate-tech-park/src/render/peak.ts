// A far landmark modelled in Blender (blender/landmark.py): a whole mountain standing past the park's edge, so the place
// reads from the spawn at a kilometre where fog and grey ground hide the park's own relief. Nothing rides on it. Its
// materials ignore the fog (a mountain shows through the snow) but take a share of the haze, so it still sits in the air.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { Peak } from "../levels/park.ts";

export const PEAK_BUDGETS = ["hi", "mid", "low"] as const;
export type PeakBudget = (typeof PEAK_BUDGETS)[number];

/** How much of the haze the mountain takes on: enough to sit far away, little enough to stay darker than the sky. */
const HAZE = 0.18;

/** The model scaled so its crest is `p.tall` metres above `p.y`, turned by `p.yaw`, with the air's haze mixed into its colours. */
export async function dressPeak(p: Peak, glb: ArrayBuffer | string, haze: number): Promise<THREE.Group> {
  const loader = new GLTFLoader();
  const gltf = typeof glb === "string" ? await loader.loadAsync(glb) : await loader.parseAsync(glb, "");
  const tint = new THREE.Color(haze), seen = new Map<THREE.Material, THREE.Material>();
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const src = m.material as THREE.MeshStandardMaterial;
    if (!seen.has(src)) {
      const mat = src.clone();
      mat.fog = false;
      mat.color.lerp(tint, HAZE);
      mat.roughness = 1;
      seen.set(src, mat);
    }
    m.material = seen.get(src)!;
  });
  const g = new THREE.Group();
  g.add(gltf.scene);
  g.scale.setScalar(p.tall);
  g.rotation.y = p.yaw ?? 0;
  g.position.set(p.x, p.y, p.z);
  g.userData.peak = p.model;
  return g;
}
