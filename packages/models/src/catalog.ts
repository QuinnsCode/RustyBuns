// Every shared procedural model as GLB, one file each, for scripts/usdz to turn into USDZ for native iOS.
// Seeded, so the same plant comes out every run.
import * as THREE from "three";
import { barrel, pear, saguaro, shrub } from "./flora.ts";
import { roadster } from "./roadster.ts";
import { toGlb } from "./glb.ts";

/** A plant's geometry in a mesh that reads its `color` attribute, as the apps' instanced meshes do. */
const plant = (geo: THREE.BufferGeometry) => new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }));

const MODELS: Record<string, () => THREE.Object3D> = {
  roadster: () => roadster().group,
  shrub: () => plant(shrub(1)),
  "shrub-berries": () => plant(shrub(2, { wide: 1.2, berries: true })),
  saguaro: () => plant(saguaro(1)),
  barrel: () => plant(barrel(1)),
  pear: () => plant(pear(1)),
};

/** Writes `<dir>/<name>.glb` for every model; returns the paths. */
export async function writeProceduralGlbs(dir: string): Promise<string[]> {
  const paths: string[] = [];
  for (const [name, build] of Object.entries(MODELS)) {
    const path = `${dir}/${name}.glb`;
    await Bun.write(path, await toGlb(build()));
    paths.push(path);
  }
  return paths;
}
