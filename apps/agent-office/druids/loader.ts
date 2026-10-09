// Every model the office loads comes through here. The game's GLBs carry KTX2 (Basis) textures, which need a
// transcoder and the renderer's GPU support, so loads wait until the office hands over its renderer
// (forest.ts calls `decoders(renderer)` on the first frame). The transcoder ships at /druids/basis/.
import { Box3, Vector3, VectorKeyframeTrack, type Object3D, type AnimationClip, type SkinnedMesh, type WebGLRenderer } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { modelUrl } from "./assets.ts";
import { bareClip } from "./cast.ts";

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
let ready: (() => void) | null = null;
const wired = new Promise<void>((resolve) => (ready = resolve));

/** Once, with the office's renderer. */
export function decoders(renderer: WebGLRenderer) {
  if (!ready) return;
  loader.setKTX2Loader(new KTX2Loader().setTranscoderPath("/druids/basis/").detectSupport(renderer));
  ready();
  ready = null;
}

const cache = new Map<string, Promise<{ scene: Object3D; animations: AnimationClip[] }>>();
/** A model by its path under /druids/models/, loaded once. */
export function gltf(path: string) {
  let p = cache.get(path);
  if (!p) cache.set(path, (p = wired.then(() => loader.loadAsync(modelUrl(path)))));
  return p;
}

const rigs = new Map<string, Promise<{ scene: Object3D; clips: Map<string, AnimationClip> }>>();
/** A rigged character: its scene, and its clips by bare name, held in place. */
export function rigged(path: string) {
  let p = rigs.get(path);
  if (!p) {
    p = gltf(path).then((g) => {
      const root = (g.scene.getObjectByProperty("isSkinnedMesh", true) as SkinnedMesh | undefined)?.skeleton.bones[0]?.name;
      return { scene: g.scene, clips: new Map(g.animations.map((c) => [bareClip(c.name), inPlace(c, root)])) };
    });
    rigs.set(path, p);
  }
  return p;
}

/** Meshy clips walk off across the room (root motion); a character stays put, so pin the root bone's x/z. */
function inPlace(clip: AnimationClip, root?: string) {
  for (const t of clip.tracks) {
    if (!(t instanceof VectorKeyframeTrack) || t.name !== `${root}.position`) continue;
    for (let i = 0; i < t.values.length; i += 3) {
      t.values[i] = t.values[0]!;
      t.values[i + 2] = t.values[2]!;
    }
  }
  return clip;
}

/** How tall a character stands in its bind pose. Meshy rigs carry a 0.01 armature scale that their raw
 *  geometry knows nothing about, so measure the skinned vertices, not the geometry. */
export function heightOf(o: Object3D) {
  o.updateMatrixWorld(true);
  const box = new Box3(), part = new Box3();
  o.traverse((m) => {
    const s = m as SkinnedMesh;
    if (s.isSkinnedMesh) {
      s.skeleton.update();
      s.computeBoundingBox();
      box.union(part.copy(s.boundingBox!).applyMatrix4(s.matrixWorld));
    } else if ((m as SkinnedMesh).isMesh) box.union(part.setFromObject(m));
  });
  return box.getSize(new Vector3()).y || 1;
}
