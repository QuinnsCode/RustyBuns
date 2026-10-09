// Scale and origin, done locally after download: free, exact and re-runnable.
// Change a size later and only the 001 -> 002 step reruns; no credits spent.
//
// The model's existing nodes go under one new root node carrying the scale and
// offset, so the mesh data is untouched and the result opens in any engine.

import { NodeIO, getBounds } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import type { Origin, Size } from "./presets.ts";

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

export interface FitResult { glb: Uint8Array; scale: number; before: [number, number, number]; after: [number, number, number] }

export async function fitGlb(input: Uint8Array, size: Size, origin: Origin): Promise<FitResult> {
  const doc = await io.readBinary(input);
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!scene) throw new Error("the .glb has no scene");
  const { min, max } = getBounds(scene);
  const dims: [number, number, number] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  if (!dims.every(Number.isFinite) || Math.max(...dims) <= 0) throw new Error("the .glb has no geometry to measure");

  // glTF is Y-up and in meters.
  const measured = "height" in size ? dims[1] : Math.max(...dims);
  const target = "height" in size ? size.height : size.longest;
  const s = target / measured;
  const pivot = origin === "bottom"
    ? [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2]
    : [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];

  const root = doc.createNode("meshy-studio-fit").setScale([s, s, s]).setTranslation([-pivot[0]! * s, -pivot[1]! * s, -pivot[2]! * s]);
  for (const child of scene.listChildren()) { scene.removeChild(child); root.addChild(child); }
  scene.addChild(root);

  return { glb: await io.writeBinary(doc), scale: s, before: dims, after: [dims[0] * s, dims[1] * s, dims[2] * s] };
}
