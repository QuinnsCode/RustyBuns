// What grows on the open world, near you: trees, scrub, ferns, flowers and rocks for each biome, from Skate
// Tech Park's scenery set (its Blender-built pines, oaks, aspens, sequoias, palms, joshua trees, saguaros,
// sage, ferns, flowers, stumps and rocks; none of its park kit). Each kind is one instanced mesh; the spots
// come from a hash of a 5 m grid, so the same ground always grows the same plants, and only the patch
// around you is planted.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Biome, Region } from "../regions.ts";
import type { World } from "./world.ts";
// Shared with Skate Tech Park rather than copied: Vite serves it from there and bundles it into this app.
import sceneryUrl from "../../../skate-tech-park/public/models/scenery-mid.glb?url";

const KINDS = ["pine", "aspen", "oak", "sequoia", "palm", "joshua", "saguaro", "snag", "sage", "bush", "fern", "flower", "stump", "rock"] as const;
export type Kind = (typeof KINDS)[number];
export const TALL: ReadonlySet<Kind> = new Set(["pine", "aspen", "oak", "sequoia", "palm", "joshua", "saguaro", "snag"]);
const CAP = 2600;     // instances a kind can show at once
const GRID = 5;       // metres between candidate spots

/** Per biome: how thickly it grows (0-1), and each kind's share with its height range in metres. */
export type Plant = [kind: Kind, share: number, min: number, max: number];
const B = (density: number, ...kinds: Plant[]) => ({ density, kinds });
export const FLORA: Record<Biome, { density: number; kinds: Plant[] }> = {
  "pine-barrens": B(0.6, ["pine", 0.45, 7, 15], ["oak", 0.1, 5, 9], ["bush", 0.2, 0.8, 1.6], ["fern", 0.13, 0.6, 1.1], ["snag", 0.05, 4, 8], ["flower", 0.07, 0.3, 0.6]),
  forest: B(0.7, ["oak", 0.3, 8, 15], ["pine", 0.2, 10, 18], ["aspen", 0.12, 7, 12], ["bush", 0.14, 0.8, 1.6], ["fern", 0.14, 0.6, 1.2], ["stump", 0.04, 0.4, 0.8], ["rock", 0.06, 0.5, 1.6]),
  rainforest: B(0.85, ["sequoia", 0.28, 22, 42], ["pine", 0.15, 14, 24], ["fern", 0.35, 0.9, 2], ["bush", 0.12, 1, 2], ["stump", 0.05, 0.5, 1], ["rock", 0.05, 0.6, 1.8]),
  lake: B(0.5, ["aspen", 0.2, 6, 11], ["pine", 0.2, 8, 15], ["bush", 0.25, 0.8, 1.5], ["flower", 0.2, 0.3, 0.6], ["rock", 0.15, 0.5, 1.6]),
  desert: B(0.22, ["saguaro", 0.12, 4, 9], ["joshua", 0.15, 3, 6], ["sage", 0.4, 0.5, 1.1], ["rock", 0.28, 0.4, 2.2], ["snag", 0.05, 2, 4]),
  swamp: B(0.65, ["palm", 0.15, 6, 11], ["snag", 0.15, 5, 10], ["fern", 0.3, 0.8, 1.6], ["bush", 0.25, 0.8, 1.6], ["flower", 0.15, 0.3, 0.6]),
  plains: B(0.3, ["flower", 0.35, 0.3, 0.6], ["sage", 0.2, 0.4, 0.9], ["bush", 0.15, 0.8, 1.5], ["oak", 0.1, 7, 12], ["aspen", 0.1, 6, 10], ["rock", 0.1, 0.4, 1.2]),
  highlands: B(0.4, ["rock", 0.35, 0.5, 2.5], ["sage", 0.25, 0.4, 0.9], ["pine", 0.15, 6, 12], ["flower", 0.15, 0.3, 0.5], ["snag", 0.1, 3, 6]),
  jungle: B(0.85, ["palm", 0.35, 7, 14], ["fern", 0.3, 1, 2.2], ["bush", 0.2, 1, 2], ["sequoia", 0.1, 18, 30], ["flower", 0.05, 0.3, 0.7]),
  island: B(0.45, ["palm", 0.4, 6, 12], ["bush", 0.2, 0.8, 1.5], ["flower", 0.2, 0.3, 0.6], ["rock", 0.2, 0.5, 1.8]),
  mountains: B(0.45, ["pine", 0.3, 6, 14], ["rock", 0.4, 0.6, 3], ["snag", 0.15, 3, 7], ["sage", 0.15, 0.3, 0.7]),
  river: B(0.55, ["oak", 0.25, 7, 13], ["bush", 0.25, 0.8, 1.6], ["fern", 0.2, 0.6, 1.2], ["flower", 0.2, 0.3, 0.6], ["palm", 0.1, 6, 10]),
  coast: B(0.45, ["pine", 0.25, 6, 13], ["rock", 0.35, 0.6, 2.4], ["bush", 0.25, 0.8, 1.5], ["sage", 0.15, 0.4, 0.8]),
  savanna: B(0.3, ["oak", 0.12, 5, 9], ["sage", 0.4, 0.5, 1], ["rock", 0.2, 0.5, 1.6], ["joshua", 0.08, 3, 5], ["flower", 0.2, 0.3, 0.5]),
  tundra: B(0.22, ["rock", 0.5, 0.4, 1.8], ["sage", 0.3, 0.2, 0.5], ["flower", 0.2, 0.15, 0.35]),
  steppe: B(0.28, ["sage", 0.5, 0.3, 0.8], ["flower", 0.3, 0.2, 0.5], ["rock", 0.2, 0.4, 1.4]),
};

function hash(x: number, y: number, s: number) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Groves and glades: a slow wave over the ground, 0 to 1. */
const grove = (x: number, z: number) => 0.5 + 0.28 * Math.sin(x * 0.011 + 1.3) * Math.cos(z * 0.013) + 0.22 * Math.sin((x + z) * 0.027 + 2) * Math.cos((x - z) * 0.021);

export interface Flora {
  group: THREE.Group; meshes: Map<Kind, THREE.InstancedMesh>; spots: number;
  /** Where you stand: a plant between the camera and you is cut away so it never hides you. */
  you: THREE.Vector3;
}
const SIGHTLINE = 4; // metres either side of the camera's line to you kept clear

/** The scenery set's plants, one geometry per kind (vertex-coloured, standing on its foot at 1 m tall), loaded once
 * and shared by the open world and the arenas' set dressing; empty when the set can't load. */
let sceneryP: Promise<Map<Kind, THREE.BufferGeometry>> | null = null;
export function scenery(): Promise<Map<Kind, THREE.BufferGeometry>> {
  return sceneryP ??= new GLTFLoader().loadAsync(sceneryUrl).then((gltf) => {
    gltf.scene.updateMatrixWorld(true);
    const byKind = new Map<Kind, THREE.BufferGeometry[]>();
    gltf.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || !(o.material instanceof THREE.MeshStandardMaterial)) return;
      // The exporter splits an object into a mesh per material; the kind is the object's name, up the tree.
      let kind: Kind | undefined;
      for (let p: THREE.Object3D | null = o; p && !kind; p = p.parent) kind = KINDS.find((k) => k === p!.name);
      if (!kind) return; // the park's own things (cairns, signs, tents) stay in the park
      const g = o.geometry.clone().applyMatrix4(o.matrixWorld), c = o.material.color, n = g.attributes.position!.count, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
      g.setAttribute("color", new THREE.BufferAttribute(a, 3));
      for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "color") g.deleteAttribute(k);
      byKind.set(kind, [...(byKind.get(kind) ?? []), g.index ? g.toNonIndexed() : g]);
    });
    const out = new Map<Kind, THREE.BufferGeometry>();
    for (const [kind, parts] of byKind) {
      const geo = mergeGeometries(parts);
      if (!geo) continue;
      // The set is toy-sized for a fingerboard: stand each kind on its foot at 1 m tall, and size it per plant.
      geo.computeBoundingBox();
      const bb = geo.boundingBox!, h = Math.max(0.01, bb.max.y - bb.min.y);
      geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2).scale(1 / h, 1 / h, 1 / h);
      out.set(kind, geo);
    }
    return out;
  }).catch(() => new Map());
}

/** The plants' meshes, empty until the scenery set loads (a moment after the world first shows); then `loaded`. */
export function flora(loaded: () => void): Flora {
  const f: Flora = { group: new THREE.Group(), meshes: new Map(), spots: 0, you: new THREE.Vector3(0, -1e6, 0) };
  void scenery().then((kinds) => {
    if (!kinds.size) return; // no scenery set: the world still walks, just bare
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uYou = { value: f.you };
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vPlant;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvPlant = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vPlant;\nuniform vec3 uYou;")
        .replace("void main() {", `void main() {
  vec3 seg = uYou - cameraPosition; float t = clamp(dot(vPlant - cameraPosition, seg) / dot(seg, seg), 0.0, 1.0);
  if (t < 0.97 && distance(vPlant, cameraPosition + seg * t) < ${SIGHTLINE.toFixed(1)}) discard;`);
    };
    for (const [kind, geo] of kinds) {
      const m = new THREE.InstancedMesh(geo, mat, CAP);
      m.count = 0; m.frustumCulled = false;
      f.meshes.set(kind, m); f.group.add(m);
    }
    loaded();
  });
  return f;
}

/**
 * Plants the ground within `radius` of (cx, cz). `regionOf` says whose ground a spot is (undefined: plant
 * nothing there), `yAt` how high the drawn ground is.
 */
export function scatterFlora(f: Flora, cx: number, cz: number, radius: number, regionOf: (x: number, z: number) => Region | undefined, yAt: (x: number, z: number) => number, w: World) {
  if (!f.meshes.size) return;
  const counts = new Map<Kind, number>(), o = new THREE.Object3D();
  for (let gz = Math.floor((cz - radius) / GRID); gz <= Math.floor((cz + radius) / GRID); gz++)
    for (let gx = Math.floor((cx - radius) / GRID); gx <= Math.floor((cx + radius) / GRID); gx++) {
      const x = (gx + hash(gx, gz, 1)) * GRID, z = (gz + hash(gx, gz, 2)) * GRID;
      if (Math.hypot(x - cx, z - cz) > radius) continue;
      const g = regionOf(x, z);
      if (!g) continue;
      const spec = FLORA[g.biome];
      if (hash(gx, gz, 3) > spec.density * (0.25 + 0.95 * grove(x, z))) continue;
      const pad = w.pads.get(g.n);
      if (pad && Math.hypot(x - pad.x, z - pad.z) < 24) continue; // the arena stands in a clearing
      const y = yAt(x, z);
      if (y < 0.5 || y > 26) continue; // not on the beach, not on the snow
      let roll = hash(gx, gz, 4) * spec.kinds.reduce((a, k) => a + k[1], 0), plant = spec.kinds[0]!;
      for (const k of spec.kinds) { if ((roll -= k[1]) < 0) { plant = k; break; } }
      let [kind, , lo, hi] = plant;
      // High and steep ground keeps only rock.
      const slope = Math.max(Math.abs(yAt(x + 2, z) - y), Math.abs(yAt(x, z + 2) - y)) / 2;
      if ((y > 16 || slope > 0.6) && kind !== "rock") { if (hash(gx, gz, 6) > 0.3) continue; kind = "rock"; lo = 0.5; hi = 2; }
      const m = f.meshes.get(kind), n = counts.get(kind) ?? 0;
      if (!m || n >= CAP) continue;
      const size = lo + (hi - lo) * hash(gx, gz, 5), girth = kind === "rock" ? 1.2 + hash(gx, gz, 7) : TALL.has(kind) ? 0.85 + 0.3 * hash(gx, gz, 7) : 1.1;
      o.position.set(x, y - (kind === "rock" ? size * 0.25 : 0.05), z);
      o.rotation.set(0, hash(gx, gz, 8) * Math.PI * 2, 0);
      o.scale.set(size * girth, size, size * girth * (kind === "rock" ? 0.8 + 0.4 * hash(gx, gz, 9) : 1));
      o.updateMatrix();
      m.setMatrixAt(n, o.matrix);
      counts.set(kind, n + 1);
    }
  f.spots = 0;
  for (const [kind, m] of f.meshes) { m.count = counts.get(kind) ?? 0; f.spots += m.count; m.instanceMatrix.needsUpdate = true; }
}
