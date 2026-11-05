// What grows on the open world, near you and far: trees, scrub, ferns, flowers and rocks for each biome from
// Skate Tech Park's scenery set (its Blender-built pines, oaks, aspens, sequoias, palms, joshua trees, saguaros,
// sage, ferns, flowers, stumps and rocks; none of its park kit), plus grass, mushrooms, fallen logs and reeds
// made here. Each kind is one instanced mesh; the spots come from a hash of a 5 m grid, so the same ground
// always grows the same plants, and only the patch around you is planted. Past that, the forest goes on as
// flat cards, two crossed silhouettes a tree, out to a kilometre and more. Every plant leans in the wind, and
// no two are quite the same colour.
//
// Each playable biome also grows four native plants made in Blender from a spec (`flora/<id>.json`, `bun run flora`):
// pitch pine and pitcher plants in the Pine Barrens, bald cypress and palmetto on the bayou, and so on. Those come as
// a near model with every leaf and a far one with fewer, bigger leaves, swapped at the budget's `lod` (PLANT_BUDGET), and they keep their own
// smooth normals (leaves facing out of the crown) instead of the scenery set's facets.
//
// Where things grow follows the ground: nothing on the beach but reeds at the water's edge, no trees above the
// treeline and nothing but rock higher still, rock on the steep faces, glades in every forest where the trees
// stand back and the flowers come in, and the woods themselves in groves with open ground between.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Biome, Region } from "../regions.ts";
import { clamp01 } from "@rustybuns/util";
import type { World } from "./world.ts";
import type { Quality } from "@rustybuns/util/quality";
import { Culled } from "./cull.ts";
// Shared with Skate Tech Park rather than copied: Vite serves it from there and bundles it into this app.
import sceneryUrl from "../../../skate-tech-park/public/models/scenery-mid.glb?url";

/** The scenery set's kinds, then the ones made here. */
const SCENERY = ["pine", "aspen", "oak", "sequoia", "palm", "joshua", "saguaro", "snag", "sage", "bush", "fern", "flower", "stump", "rock"] as const;
const MADE = ["grass", "mushroom", "log", "reed", "boulder"] as const;
/** The native plants grown in Blender, four a playable biome: public/models/flora/<id>.glb from flora/<id>.json. */
export const GROWN = [
  "pitch-pine", "white-cedar", "blueberry", "pitcher-plant", // Pine Barrens
  "hemlock", "sugar-maple", "paper-birch", "rhododendron", // the eastern forests
  "red-cedar", "bigleaf-maple", "sword-fern", "skunk-cabbage", // the Pacific rainforest
  "white-pine", "tamarack", "red-osier", "cattail", // the Great Lakes
  "prickly-pear", "barrel-cactus", "ocotillo", "agave", // the Southwest desert
  "bald-cypress", "live-oak", "palmetto", "cypress-knees", // the bayou
  "eastern-redcedar", "sumac", "coneflower", "bluestem", // the Ozarks and the plains
] as const;
export const KINDS = [...SCENERY, ...MADE, ...GROWN] as const;
export type Grown = (typeof GROWN)[number];
const isGrown = (k: Kind): k is Grown => (GROWN as readonly string[]).includes(k);
export type Kind = (typeof KINDS)[number];
export const TALL: ReadonlySet<Kind> = new Set(["pine", "aspen", "oak", "sequoia", "palm", "joshua", "saguaro", "snag", "pitch-pine", "white-cedar", "hemlock",
  "sugar-maple", "paper-birch", "red-cedar", "bigleaf-maple", "white-pine", "tamarack", "bald-cypress", "live-oak", "eastern-redcedar"]);
/** Trees whose far card is a spire (the rest are round). */
const SPIRE: ReadonlySet<Kind> = new Set(["pine", "sequoia", "snag", "white-cedar", "hemlock", "red-cedar", "tamarack", "eastern-redcedar"]);
/** Plants of the water's edge: like reeds, they grow there and nowhere else. */
const WET: ReadonlySet<Kind> = new Set(["reed", "pitcher-plant", "skunk-cabbage", "cattail", "cypress-knees"]);
const CAP = 3200;      // instances a kind can show at once, near
const FAR_CAP = 9000;  // far cards a kind can show at once
const GRID = 5;        // metres between candidate spots, near
const FAR_GRID = 13;   // metres between candidate spots, far
export const TREELINE = 46; // game metres: no tree stands higher
export const BARE = 60;     // game metres: nothing but rock and snow above this
export const SNOWLINE = 38; // game metres: trees above this carry snow
const WATER_EDGE = 1.2;     // metres above the water: reeds grow this close to it and little else
const TURF_R = 70;          // metres round you the grass is drawn
const TURF_GRID = 1.15;     // metres between grass tufts

/** What a quality tier (@rustybuns/util/quality) plants: `reach`, metres round the near patch's centre the plants stand in
 * (past it the tall kinds go on as far cards and the small ones aren't drawn), and `lod`, metres past which a grown plant
 * is drawn with its far model. A phone on low plants a ring half as wide, a quarter of the plants (#3664). */
export const PLANT_BUDGET: Record<Quality, { reach: number; lod: number }> = {
  low: { reach: 110, lod: 35 }, mid: { reach: 1e6, lod: 60 }, high: { reach: 1e6, lod: 60 },
};
let budget = PLANT_BUDGET.high;
const reachU = { value: budget.reach };
/** Plants by tier from now on: main.ts sets it once, from the page's quality. */
export function setPlantBudget(q: Quality) { budget = PLANT_BUDGET[q]; reachU.value = budget.reach; }
/** Metres the camera moves, and how far it turns (the cosine), before the plants in view are picked again; each plant's
 * bounding sphere is grown by CULL_MARGIN so one picked a few frames ago still covers what is on screen. */
const CULL_MOVE = 2, CULL_TURN = Math.cos((1.5 * Math.PI) / 180), CULL_MARGIN = 4;
/** Per biome: how thickly it grows (0-1), and each kind's share with its height range in metres. */
export type Plant = [kind: Kind, share: number, min: number, max: number];
const B = (density: number, ...kinds: Plant[]) => ({ density, kinds });
export const FLORA: Record<Biome, { density: number; kinds: Plant[] }> = {
  "pine-barrens": B(0.6, ["pitch-pine", 0.41, 8, 15], ["white-cedar", 0.1, 9, 16], ["blueberry", 0.2, 1, 2], ["sword-fern", 0.08, 0.6, 1.1], ["pitcher-plant", 0.04, 0.3, 0.6], ["snag", 0.04, 4, 8], ["flower", 0.04, 0.3, 0.6], ["mushroom", 0.03, 0.12, 0.3], ["log", 0.04, 2.5, 5], ["reed", 0.02, 1.2, 2]),
  forest: B(0.7, ["hemlock", 0.2, 12, 22], ["sugar-maple", 0.2, 12, 20], ["paper-birch", 0.12, 9, 16], ["rhododendron", 0.14, 2, 4], ["oak", 0.05, 8, 15], ["sword-fern", 0.12, 0.6, 1.2], ["stump", 0.02, 0.4, 0.8], ["rock", 0.05, 0.5, 1.6], ["mushroom", 0.05, 0.12, 0.35], ["log", 0.05, 3, 6]),
  rainforest: B(0.85, ["red-cedar", 0.26, 22, 40], ["bigleaf-maple", 0.14, 14, 22], ["sword-fern", 0.37, 0.8, 2], ["skunk-cabbage", 0.05, 0.5, 1], ["stump", 0.03, 0.5, 1], ["rock", 0.03, 0.6, 1.8], ["mushroom", 0.06, 0.15, 0.4], ["log", 0.06, 4, 9]),
  lake: B(0.5, ["white-pine", 0.22, 14, 26], ["tamarack", 0.12, 9, 15], ["red-osier", 0.16, 1.5, 2.6], ["cattail", 0.12, 1.6, 2.6], ["paper-birch", 0.08, 9, 15], ["flower", 0.12, 0.3, 0.6], ["rock", 0.1, 0.5, 1.6], ["reed", 0.06, 1.4, 2.4]),
  desert: B(0.22, ["prickly-pear", 0.18, 0.8, 1.6], ["barrel-cactus", 0.08, 0.6, 1.3], ["ocotillo", 0.07, 3, 5.5], ["agave", 0.14, 0.6, 1.2], ["saguaro", 0.06, 4, 9], ["joshua", 0.06, 3, 6], ["sage", 0.2, 0.5, 1.1], ["rock", 0.15, 0.4, 2.2], ["snag", 0.02, 2, 4], ["boulder", 0.03, 2.5, 6]),
  swamp: B(0.65, ["bald-cypress", 0.22, 14, 24], ["live-oak", 0.07, 9, 14], ["palmetto", 0.22, 1, 2], ["cypress-knees", 0.06, 0.4, 0.9], ["snag", 0.08, 5, 10], ["sword-fern", 0.1, 0.8, 1.6], ["flower", 0.04, 0.3, 0.6], ["reed", 0.12, 1.6, 2.6], ["mushroom", 0.02, 0.15, 0.4], ["log", 0.04, 3, 6]),
  plains: B(0.3, ["eastern-redcedar", 0.1, 5, 11], ["sumac", 0.1, 2, 4], ["coneflower", 0.26, 0.6, 1.1], ["bluestem", 0.22, 1.1, 2], ["flower", 0.12, 0.3, 0.6], ["sage", 0.1, 0.4, 0.9], ["sugar-maple", 0.04, 8, 14], ["rock", 0.06, 0.4, 1.2]),
  highlands: B(0.4, ["rock", 0.32, 0.5, 2.5], ["sage", 0.25, 0.4, 0.9], ["pine", 0.15, 6, 12], ["flower", 0.14, 0.3, 0.5], ["snag", 0.09, 3, 6], ["boulder", 0.05, 2.5, 7]),
  jungle: B(0.85, ["palm", 0.33, 7, 14], ["fern", 0.28, 1, 2.2], ["bush", 0.18, 1, 2], ["sequoia", 0.1, 18, 30], ["flower", 0.05, 0.3, 0.7], ["mushroom", 0.03, 0.15, 0.4], ["log", 0.03, 3, 7]),
  island: B(0.45, ["palm", 0.38, 6, 12], ["bush", 0.18, 0.8, 1.5], ["flower", 0.18, 0.3, 0.6], ["rock", 0.16, 0.5, 1.8], ["reed", 0.1, 1.2, 2]),
  mountains: B(0.45, ["pine", 0.3, 6, 14], ["rock", 0.36, 0.6, 3], ["snag", 0.14, 3, 7], ["sage", 0.13, 0.3, 0.7], ["boulder", 0.07, 3, 9]),
  river: B(0.55, ["oak", 0.22, 7, 13], ["bush", 0.22, 0.8, 1.6], ["fern", 0.16, 0.6, 1.2], ["flower", 0.16, 0.3, 0.6], ["palm", 0.08, 6, 10], ["reed", 0.16, 1.4, 2.4]),
  coast: B(0.45, ["pine", 0.22, 6, 13], ["rock", 0.3, 0.6, 2.4], ["bush", 0.2, 0.8, 1.5], ["sage", 0.14, 0.4, 0.8], ["reed", 0.1, 1, 1.8], ["boulder", 0.04, 2, 6]),
  savanna: B(0.3, ["oak", 0.12, 5, 9], ["sage", 0.4, 0.5, 1], ["rock", 0.2, 0.5, 1.6], ["joshua", 0.08, 3, 5], ["flower", 0.2, 0.3, 0.5]),
  tundra: B(0.22, ["rock", 0.46, 0.4, 1.8], ["sage", 0.3, 0.2, 0.5], ["flower", 0.19, 0.15, 0.35], ["boulder", 0.05, 2, 5]),
  steppe: B(0.28, ["sage", 0.5, 0.3, 0.8], ["flower", 0.3, 0.2, 0.5], ["rock", 0.2, 0.4, 1.4]),
};
/** Per biome: the grass. How much of the ground it covers (0-1), its colour and its height in metres. */
export const TURF: Record<Biome, { cover: number; colour: number; height: number }> = {
  "pine-barrens": { cover: 0.5, colour: 0x9aa060, height: 0.45 }, forest: { cover: 0.55, colour: 0x5f8a3c, height: 0.4 }, rainforest: { cover: 0.6, colour: 0x4d8040, height: 0.5 },
  lake: { cover: 0.7, colour: 0x7a9a48, height: 0.4 }, desert: { cover: 0.12, colour: 0xc0a868, height: 0.3 }, swamp: { cover: 0.75, colour: 0x6a8a3a, height: 0.6 },
  plains: { cover: 0.9, colour: 0x9ab050, height: 0.55 }, highlands: { cover: 0.6, colour: 0x8a9a50, height: 0.3 }, jungle: { cover: 0.5, colour: 0x4f8a3a, height: 0.6 },
  island: { cover: 0.5, colour: 0x8ab058, height: 0.35 }, mountains: { cover: 0.35, colour: 0x8a9460, height: 0.22 }, river: { cover: 0.8, colour: 0x80a850, height: 0.5 },
  coast: { cover: 0.55, colour: 0xa0a868, height: 0.4 }, savanna: { cover: 0.85, colour: 0xc0b060, height: 0.7 }, tundra: { cover: 0.5, colour: 0x98a080, height: 0.15 }, steppe: { cover: 0.85, colour: 0xb0a860, height: 0.4 },
};

function hash(x: number, y: number, s: number) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Groves and the open ground between: a slow wave over the ground, 0 to 1. */
export const grove = (x: number, z: number) => 0.5 + 0.28 * Math.sin(x * 0.011 + 1.3) * Math.cos(z * 0.013) + 0.22 * Math.sin((x + z) * 0.027 + 2) * Math.cos((x - z) * 0.021);
/** Glades: another wave, longer; above GLADE the trees stand back and the flowers and grass come in. */
export const glade = (x: number, z: number) => 0.5 + 0.3 * Math.sin(x * 0.0071 + 0.4) * Math.sin(z * 0.0083 + 1.1) + 0.2 * Math.cos((x - z) * 0.0137 + 3);
export const GLADE = 0.74;
/** How much of the ground at (x, z) the biome's grass covers, 0 to 1: what scatterTurf lays and the ground is tinted by. */
export const turfAt = (biome: Biome, x: number, z: number) => Math.min(1, TURF[biome].cover * (glade(x, z) > GLADE ? 1.3 : 1) * (0.5 + 0.7 * grove(x + 37, z - 51)));

export interface Flora {
  group: THREE.Group;
  /** The near plants, one instanced mesh a kind. */
  meshes: Map<Kind, THREE.InstancedMesh>;
  /** The grown plants past PLANT_BUDGET's `lod`: their far models, one instanced mesh a kind. */
  lo: Map<Kind, THREE.InstancedMesh>;
  /** The far cards, one instanced mesh a tall kind. */
  cards: Map<Kind, THREE.InstancedMesh>;
  /** The grass round your feet. */
  turf: THREE.InstancedMesh | null;
  /** The far forest's next laying, row by row (scatterFar), until it is copied into `cards` at once. */
  farJob: { cx: number; cz: number; gz: number; counts: Map<Kind, number>; mats: Map<Kind, Float32Array>; cols: Map<Kind, Float32Array> } | null;
  /** The grass's next laying, row by row (scatterTurf), until it is copied into `turf` at once. */
  turfJob: { cx: number; cz: number; gz: number; n: number; mats: Float32Array; cols: Float32Array } | null;
  /** Near plants, far cards and grass tufts planted now. */
  spots: number; far: number; tufts: number;
  /** Near plants and far cards in the camera's view at the last pick: what the GPU is handed (src/world/cull.ts). */
  shown: number;
  /** Each near plant's and far card's mesh, with everything planted in it, picked down to what is in view before each render. */
  culled: Map<THREE.InstancedMesh, Culled>;
  /** Where you stand: a plant between the camera and you is cut away so it never hides you. */
  you: THREE.Vector3;
  /** Where the near plants are centred (x, z) and how far they reach (z): a far card inside that ring is hidden. */
  near: THREE.Vector3;
  /** Moves the wind: `t` seconds, `wind` 0 to 1. */
  tick(t: number, wind: number): void;
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
      for (let p: THREE.Object3D | null = o; p && !kind; p = p.parent) kind = SCENERY.find((k) => k === p!.name);
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

/** The grown plants: near and far geometry a kind, stood on its foot at 1 m tall (both by the near model's height),
 * with their own normals and baked colours. Loaded once, shared by the open world and the arenas. */
let grownP: Promise<Map<Kind, { near: THREE.BufferGeometry; far: THREE.BufferGeometry }>> | null = null;
export function grown(): Promise<Map<Kind, { near: THREE.BufferGeometry; far: THREE.BufferGeometry }>> {
  return grownP ??= (async () => {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder), out = new Map<Kind, { near: THREE.BufferGeometry; far: THREE.BufferGeometry }>();
    await Promise.all(GROWN.map(async (id) => {
      const gltf = await loader.loadAsync(`/models/flora/${id}.glb`).catch(() => null);
      if (!gltf) return;
      const byName = new Map<string, THREE.BufferGeometry>();
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => { if (o instanceof THREE.Mesh) byName.set(o.name, o.geometry.clone().applyMatrix4(o.matrixWorld)); });
      const near = byName.get(id), far = byName.get(`${id}-lo`) ?? near;
      if (!near || !far) return;
      near.computeBoundingBox();
      const bb = near.boundingBox!, h = Math.max(0.01, bb.max.y - bb.min.y);
      for (const g of new Set([near, far])) {
        for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "color" && k !== "normal") g.deleteAttribute(k);
        g.translate(0, -bb.min.y, 0).scale(1 / h, 1 / h, 1 / h);
      }
      out.set(id, { near, far });
    }));
    return out;
  })();
}

/** A plain material for a grown plant standing still (the arenas): its baked colours, both sides of every leaf, and
 * the leaf normals kept facing out of the crown on the back face too. */
export function grownMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\n  normal *= faceDirection;"); };
  m.customProgramCacheKey = () => "grown-still";
  return m;
}

// --- the plants made here: triangles with vertex colours, 1 m tall on their foot like the set's ------------------------
function coloured(pos: number[], col: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
const tri = (pos: number[], col: number[], a: number[], b: number[], c: number[], ca: number[], cb: number[], cc: number[]) => { pos.push(...a, ...b, ...c); col.push(...ca, ...cb, ...cc); };
/** `blades` tapering blades round the foot, leaning out, `width` wide at the base, `dark` at the root to `light` at the tip. */
function tuft(blades: number, width: number, dark: number[], light: number[], lean = 0.25): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [];
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + 0.3, dx = Math.cos(a), dz = Math.sin(a), px = -dz * width / 2, pz = dx * width / 2, lx = dx * lean, lz = dz * lean;
    const foot = [dx * 0.05, 0, dz * 0.05];
    tri(pos, col, [foot[0]! - px, 0, foot[2]! - pz], [foot[0]! + px, 0, foot[2]! + pz], [foot[0]! + lx, 1, foot[2]! + lz], dark, dark, light);
  }
  return coloured(pos, col);
}
/** A cap on a stem. */
function mushroom(): THREE.BufferGeometry {
  const stem = new THREE.CylinderGeometry(0.1, 0.13, 0.55, 6), cap = new THREE.SphereGeometry(0.42, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  stem.translate(0, 0.275, 0); cap.scale(1, 0.85, 1); cap.translate(0, 0.52, 0);
  const paint = (g: THREE.BufferGeometry, c: number[]) => { const n = g.attributes.position!.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set(c, i * 3); g.setAttribute("color", new THREE.BufferAttribute(a, 3)); return g.toNonIndexed(); };
  const g = mergeGeometries([paint(stem, [0.86, 0.8, 0.66]), paint(cap, [0.62, 0.3, 0.18])])!;
  for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "color") g.deleteAttribute(k);
  g.computeVertexNormals();
  return g;
}
/** A boulder: a lumpy stone, grey with a lichen-green side. */
function boulder(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.5, 1).toNonIndexed(), p = g.attributes.position!, n = p.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + 0.18 * Math.sin(x * 9.1 + y * 7.3) * Math.cos(z * 8.7);
    p.setXYZ(i, x * k * 1.15, (y * k + 0.5) * 0.85, z * k);
    const lichen = 0.25 + 0.5 * Math.max(0, Math.sin(x * 4 + 1) * 0.5 + y * 0.6);
    a.set([0.5 - lichen * 0.12, 0.49, 0.46 - lichen * 0.15], i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(a, 3));
  g.deleteAttribute("uv"); g.deleteAttribute("normal"); g.computeVertexNormals();
  return g;
}
/** A trunk on its side, 1 m long and a quarter as tall: `size` is its length. */
function log(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.12, 0.14, 1, 7).toNonIndexed();
  g.rotateZ(Math.PI / 2); g.translate(0, 0.12, 0);
  const n = g.attributes.position!.count, a = new Float32Array(n * 3), p = g.attributes.position!;
  for (let i = 0; i < n; i++) { const end = Math.abs(p.getX(i)) > 0.49; a.set(end ? [0.72, 0.6, 0.42] : [0.36, 0.26, 0.17], i * 3); }
  g.setAttribute("color", new THREE.BufferAttribute(a, 3));
  g.deleteAttribute("uv");
  return g;
}
/** The far card of a tall kind: two crossed silhouettes, a trunk and a canopy in the kind's own colour. */
function card(kind: Kind, canopy: THREE.Color): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], trunk = [0.3, 0.22, 0.15], leaf = [canopy.r, canopy.g, canopy.b];
  const spire = SPIRE.has(kind), base = spire ? 0.12 : 0.35, top = spire ? 0.02 : 0.2, wide = spire ? 0.36 : 0.5;
  for (const rot of [0, Math.PI / 2]) {
    const c = Math.cos(rot), s = Math.sin(rot), P = (x: number, y: number) => [x * c, y, x * s];
    tri(pos, col, P(-0.05, 0), P(0.05, 0), P(0.05, base + 0.05), trunk, trunk, trunk);
    tri(pos, col, P(-0.05, 0), P(0.05, base + 0.05), P(-0.05, base + 0.05), trunk, trunk, trunk);
    // The canopy, as a fan of triangles from its middle so round and spire shapes both read.
    const mid = P(0, (base + 1) / 2), ring: number[][] = [];
    const steps = 7;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps, y = base + u * (1 - base);
      const w = spire ? wide * (1 - u) + top : wide * Math.sin(Math.PI * Math.min(1, u * 0.95 + 0.05)) + top * (1 - u);
      ring.push(P(-w, y), P(w, y));
    }
    for (let i = 0; i + 2 < ring.length; i += 2) {
      tri(pos, col, ring[i]!, ring[i + 2]!, mid, leaf, leaf, leaf);
      tri(pos, col, ring[i + 3]!, ring[i + 1]!, mid, leaf, leaf, leaf);
    }
    tri(pos, col, ring[0]!, mid, ring[1]!, leaf, leaf, leaf);
    tri(pos, col, ring.at(-2)!, ring.at(-1)!, mid, leaf, leaf, leaf);
  }
  return coloured(pos, col);
}
/** The mean colour of a kind's upper half: what its canopy looks like from far off. */
function canopyColour(g: THREE.BufferGeometry): THREE.Color {
  const p = g.attributes.position!, c = g.attributes.color!, sum = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0.4) { sum[0]! += c.getX(i); sum[1]! += c.getY(i); sum[2]! += c.getZ(i); n++; }
  return n ? new THREE.Color(sum[0]! / n, sum[1]! / n, sum[2]! / n) : new THREE.Color(0x4a6a3a);
}

/** One material a kind: the sightline cut, and the wind: a sway that grows with height up the plant. A far card
 * (`near` given) is also cut where the near plants grow, so the two never stand side by side. */
function plantMaterial(you: THREE.Vector3, time: { value: number }, gust: { value: number }, sway: number, twoSided = false, near?: THREE.Vector3, smooth = false): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: smooth ? 0.85 : 1, flatShading: !smooth, side: twoSided ? THREE.DoubleSide : THREE.FrontSide });
  // A grown plant's leaves are cards seen from both sides, their normals pointing out of the crown: keep that way
  // round on the back face too, or a crown flickers light and dark as it turns.
  if (smooth) mat.customProgramCacheKey = () => "grown";
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uYou = { value: you }; sh.uniforms.uTime = time; sh.uniforms.uGust = gust; sh.uniforms.uSway = { value: sway }; sh.uniforms.uNear = { value: near ?? new THREE.Vector3(0, 0, -1) }; sh.uniforms.uReach = reachU;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vPlant;\nvarying float vNear;\nuniform float uTime;\nuniform float uGust;\nuniform float uSway;\nuniform vec3 uNear;\nuniform float uReach;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
  #ifdef USE_INSTANCING
  vec2 ip = instanceMatrix[3].xz;
  float ph = uTime * 1.6 + ip.x * 0.17 + ip.y * 0.13;
  float bend = (sin(ph) + 0.5 * sin(ph * 2.3 + 1.0)) * uSway * (0.25 + uGust) * transformed.y * transformed.y;
  transformed.x += bend; transformed.z += bend * 0.4;
  vNear = distance(ip, uNear.xy) - min(uNear.z, uReach);
  #else
  vNear = 1.0;
  #endif
  vPlant = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vPlant;\nvarying float vNear;\nuniform vec3 uYou;")
      .replace("void main() {", `void main() {
  if (vNear < 0.0) discard;
  vec3 seg = uYou - cameraPosition; float t = clamp(dot(vPlant - cameraPosition, seg) / dot(seg, seg), 0.0, 1.0);
  if (t < 0.97 && distance(vPlant, cameraPosition + seg * t) < ${SIGHTLINE.toFixed(1)}) discard;`);
    if (smooth) sh.fragmentShader = sh.fragmentShader.replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\n  normal *= faceDirection;");
  };
  return mat;
}
/** How far each kind's top swings, in its own height: grass and reeds a lot, flowers and ferns some, trees a little, rock none. */
const SWAY: Partial<Record<Kind, number>> = {
  "sword-fern": 0.07, "skunk-cabbage": 0.04, cattail: 0.12, bluestem: 0.14, coneflower: 0.1, "pitcher-plant": 0.03, palmetto: 0.05, agave: 0, "prickly-pear": 0, "barrel-cactus": 0,
  ocotillo: 0.04, "cypress-knees": 0, blueberry: 0.04, rhododendron: 0.03, "red-osier": 0.04, sumac: 0.04, "paper-birch": 0.03, tamarack: 0.025, "sugar-maple": 0.02, "bigleaf-maple": 0.02,
  grass: 0.16, reed: 0.14, flower: 0.08, fern: 0.07, sage: 0.05, bush: 0.04, aspen: 0.03, oak: 0.02, pine: 0.02, palm: 0.05, sequoia: 0.012, joshua: 0.015, snag: 0.01, saguaro: 0, rock: 0, stump: 0, log: 0, mushroom: 0.01, boulder: 0 };
const made = (): Map<Kind, THREE.BufferGeometry> => new Map<Kind, THREE.BufferGeometry>([
  ["grass", tuft(6, 0.16, [0.22, 0.34, 0.12], [0.62, 0.74, 0.3], 0.4)],
  ["reed", tuft(5, 0.06, [0.3, 0.38, 0.14], [0.68, 0.66, 0.34], 0.12)],
  ["mushroom", mushroom()],
  ["log", log()],
  ["boulder", boulder()],
]);

/** The plants' meshes, empty until the scenery set loads (a moment after the world first shows); then `loaded`. */
export function flora(loaded: () => void): Flora {
  const time = { value: 0 }, gust = { value: 0.3 };
  const f: Flora = { group: new THREE.Group(), meshes: new Map(), lo: new Map(), cards: new Map(), turf: null, farJob: null, turfJob: null, spots: 0, far: 0, tufts: 0, shown: 0, culled: new Map(), you: new THREE.Vector3(0, -1e6, 0), near: new THREE.Vector3(0, 0, -1), tick(t, w) { time.value = t; gust.value = w; hook(); } };
  // The pick runs as the scene starts to render, with the camera it renders with, before three uploads the instances.
  let hooked = false;
  const hook = () => {
    if (hooked) return;
    let sc = f.group.parent;
    while (sc && !(sc instanceof THREE.Scene)) sc = sc.parent;
    if (!sc) return;
    const was = sc.onBeforeRender.bind(sc);
    sc.onBeforeRender = (...a) => { was(...a); if (a[2] instanceof THREE.PerspectiveCamera) cullPlants(f, a[2]); };
    hooked = true;
  };
  void Promise.all([scenery(), grown()]).then(([plain, more]) => {
    const kinds = new Map(plain);
    for (const [k, g] of made()) kinds.set(k, g);
    for (const [k, g] of more) kinds.set(k, g.near);
    for (const [kind, geo] of kinds) {
      const smooth = isGrown(kind), mat = plantMaterial(f.you, time, gust, SWAY[kind] ?? 0.02, smooth || kind === "grass" || kind === "reed", undefined, smooth);
      const m = new THREE.InstancedMesh(geo, mat, CAP);
      m.count = 0; m.frustumCulled = false; m.visible = false;
      f.meshes.set(kind, m); f.group.add(m); f.culled.set(m, new Culled(m));
      const far = more.get(kind)?.far;
      if (far) {
        const l = new THREE.InstancedMesh(far, mat, CAP);
        l.count = 0; l.frustumCulled = false; l.visible = false;
        f.lo.set(kind, l); f.group.add(l); f.culled.set(l, new Culled(l));
      }
      if (TALL.has(kind)) {
        const c = new THREE.InstancedMesh(card(kind, canopyColour(geo)), plantMaterial(f.you, time, gust, 0, true, f.near), FAR_CAP);
        c.count = 0; c.frustumCulled = false;
        f.cards.set(kind, c); f.group.add(c); f.culled.set(c, new Culled(c));
      }
    }
    f.turf = new THREE.InstancedMesh(kinds.get("grass")!, plantMaterial(f.you, time, gust, SWAY.grass!, true), Math.ceil((TURF_R * 2 / TURF_GRID) ** 2 * 0.8));
    f.turf.count = 0; f.turf.frustumCulled = false;
    f.group.add(f.turf);
    loaded();
  });
  return f;
}

const o = new THREE.Object3D(), tintC = new THREE.Color();
/** A plant's own shade of its kind's colour: a little lighter or darker, a little warmer or cooler, and snowed on high up. */
function tint(gx: number, gz: number, y: number): THREE.Color {
  const l = 0.84 + 0.32 * hash(gx, gz, 11), warm = 0.94 + 0.12 * hash(gx, gz, 12), snow = clamp01((y - SNOWLINE) / 10);
  return tintC.setRGB(l * warm, l, l / warm).lerp(snowC, snow * 0.8);
}
const snowC = new THREE.Color(2.4, 2.5, 2.7); // over a dark green it reads as white
/** Which of a biome's kinds a roll lands on. */
function draw(spec: { kinds: Plant[] }, roll: number): Plant {
  let r = roll * spec.kinds.reduce((a, k) => a + k[1], 0);
  for (const k of spec.kinds) if ((r -= k[1]) < 0) return k;
  return spec.kinds[0]!;
}
/** Steepness at (x, z): rise over a 2 m run, from `yAt`. */
const slopeAt = (yAt: (x: number, z: number) => number, x: number, z: number, y: number, run = 2) => Math.max(Math.abs(yAt(x + run, z) - y), Math.abs(yAt(x, z + run) - y)) / run;

/**
 * Plants the ground within `radius` of (cx, cz). `regionOf` says whose ground a spot is (undefined: plant
 * nothing there), `yAt` how high the drawn ground is.
 */
export function scatterFlora(f: Flora, cx: number, cz: number, radius: number, regionOf: (x: number, z: number) => Region | undefined, yAt: (x: number, z: number) => number, w: World, waterAt: (x: number, z: number) => number = () => 0) {
  if (!f.meshes.size) return;
  radius = Math.min(radius, budget.reach);
  const counts = new Map<string, number>();
  for (let gz = Math.floor((cz - radius) / GRID); gz <= Math.floor((cz + radius) / GRID); gz++)
    for (let gx = Math.floor((cx - radius) / GRID); gx <= Math.floor((cx + radius) / GRID); gx++) {
      const x = (gx + hash(gx, gz, 1)) * GRID, z = (gz + hash(gx, gz, 2)) * GRID;
      if (Math.hypot(x - cx, z - cz) > radius) continue;
      const g = regionOf(x, z);
      if (!g) continue;
      const spec = FLORA[g.biome], open = glade(x, z) > GLADE;
      if (hash(gx, gz, 3) > spec.density * (0.25 + 0.95 * grove(x, z))) continue;
      const pad = w.pads.get(g.n);
      if (pad && Math.hypot(x - pad.x, z - pad.z) < 24) continue; // the arena stands in a clearing
      const y = yAt(x, z);
      if (y > BARE) continue;
      let [kind, , lo, hi] = draw(spec, hash(gx, gz, 4));
      // The water's edge grows reeds and nothing else; reeds grow nowhere else.
      const above = y - waterAt(x, z);
      if (WET.has(kind) ? above < -0.3 || above > WATER_EDGE : above < 0.3) continue;
      // In a glade the trees stand back: a tree there is a flower or grass instead, twice as often.
      if (open && TALL.has(kind)) { if (hash(gx, gz, 13) > 0.5) continue; [kind, , lo, hi] = spec.kinds.find((k) => k[0] === "flower") ?? spec.kinds.find((k) => k[0] === "sage") ?? ["grass", 1, 0.4, 0.7]; }
      // Above the treeline, and on steep faces, only rock stands.
      const slope = slopeAt(yAt, x, z, y);
      if ((y > TREELINE && TALL.has(kind)) || (slope > 0.6 && kind !== "rock")) { if (hash(gx, gz, 6) > 0.3) continue; kind = "rock"; lo = 0.5; hi = 2; }
      const far = f.lo.has(kind) && Math.hypot(x - cx, z - cz) > budget.lod, m = far ? f.lo.get(kind) : f.meshes.get(kind), key = far ? `${kind}-lo` : kind, n = counts.get(key) ?? 0;
      if (!m || n >= CAP) continue;
      const size = lo + (hi - lo) * hash(gx, gz, 5), girth = kind === "rock" ? 1.2 + hash(gx, gz, 7) : TALL.has(kind) ? 0.85 + 0.3 * hash(gx, gz, 7) : kind === "log" ? 0.6 : 1.1;
      o.position.set(x, y - (kind === "rock" ? size * 0.25 : 0.05), z);
      // A tree stands up; a rock, a log and a tuft lie with the ground.
      if (TALL.has(kind) || kind === "mushroom") o.rotation.set(0, hash(gx, gz, 8) * Math.PI * 2, 0);
      else o.rotation.set(Math.atan2(y - yAt(x, z + 2), 2) * 0.5, hash(gx, gz, 8) * Math.PI * 2, Math.atan2(yAt(x + 2, z) - y, 2) * 0.5);
      o.scale.set(size * girth, kind === "log" ? size * 0.5 : size, size * girth * (kind === "rock" ? 0.8 + 0.4 * hash(gx, gz, 9) : 1));
      o.updateMatrix();
      m.setMatrixAt(n, o.matrix);
      m.setColorAt(n, tint(gx, gz, y));
      counts.set(key, n + 1);
    }
  f.spots = 0;
  const done = (m: THREE.InstancedMesh, n: number) => { f.culled.get(m)?.keep(n); f.spots += n; };
  for (const [kind, m] of f.meshes) done(m, counts.get(kind) ?? 0);
  for (const [kind, m] of f.lo) done(m, counts.get(`${kind}-lo`) ?? 0);
  stale = true;
}

let stale = true;
const lastEye = new THREE.Vector3(Infinity, 0, 0), lastLook = new THREE.Vector3(), look = new THREE.Vector3(), frustum = new THREE.Frustum(), viewProj = new THREE.Matrix4();
let lastProj = 0;
/** Hands the GPU only the plants and far cards in `cam`'s view: picked again when something was planted, the camera moved
 * CULL_MOVE metres or turned, or its lens changed. */
function cullPlants(f: Flora, cam: THREE.PerspectiveCamera) {
  if (!f.culled.size) return;
  if (f.group.parent?.visible === false) { stale = true; return; } // the world is put away: a fight, the title
  cam.getWorldDirection(look);
  const proj = cam.projectionMatrix.elements[0]! * 7 + cam.projectionMatrix.elements[5]!;
  if (!stale && cam.position.distanceTo(lastEye) < CULL_MOVE && look.dot(lastLook) > CULL_TURN && proj === lastProj) return;
  stale = false; lastEye.copy(cam.position); lastLook.copy(look); lastProj = proj;
  frustum.setFromProjectionMatrix(viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  f.shown = 0;
  for (const [m, c] of f.culled) if (c.planted || m.count) f.shown += c.show(frustum, CULL_MARGIN);
}

/** A scratch colour for the cards' and the grass's tints. */
const turfC = new THREE.Color();
/**
 * The far forest: tall kinds only, as cards, between `inner` and `outer` metres of (cx, cz), on a coarser grid than
 * the near plants so the two don't match spot for spot (they are never seen side by side: the near ring hides the join).
 */
export function scatterFar(f: Flora, cx: number, cz: number, inner: number, outer: number, regionOf: (x: number, z: number) => Region | undefined, yAt: (x: number, z: number) => number, waterAt: (x: number, z: number) => number = () => 0, budget = Infinity): boolean {
  if (!f.cards.size) return true;
  // Like scatterTurf: rows for up to `budget` ms into arrays of its own, copied into the cards at once when done.
  const t0 = performance.now(), gz0 = Math.floor((cz - outer) / FAR_GRID), gz1 = Math.floor((cz + outer) / FAR_GRID);
  let j = f.farJob;
  if (!j || j.cx !== cx || j.cz !== cz) {
    const mats = j?.mats ?? new Map([...f.cards].map(([k, m]) => [k, new Float32Array(m.instanceMatrix.array.length)]));
    const cols = j?.cols ?? new Map([...f.cards].map(([k, m]) => [k, new Float32Array(m.instanceMatrix.count * 3)]));
    j = f.farJob = { cx, cz, gz: gz0, counts: new Map(), mats, cols };
  }
  const counts = j.counts;
  for (; j.gz <= gz1; j.gz++) {
    if (j.gz > gz0 && performance.now() - t0 > budget) return false;
    const gz = j.gz;
    for (let gx = Math.floor((cx - outer) / FAR_GRID); gx <= Math.floor((cx + outer) / FAR_GRID); gx++) {
      const x = (gx + hash(gx, gz, 21)) * FAR_GRID, z = (gz + hash(gx, gz, 22)) * FAR_GRID, d = Math.hypot(x - cx, z - cz);
      if (d < inner || d > outer) continue;
      const g = regionOf(x, z);
      if (!g) continue;
      const spec = FLORA[g.biome];
      if (glade(x, z) > GLADE || hash(gx, gz, 23) > spec.density * (0.25 + 0.95 * grove(x, z))) continue;
      const [kind, , lo, hi] = draw(spec, hash(gx, gz, 24));
      if (!TALL.has(kind)) continue;
      const y = yAt(x, z);
      if (y - waterAt(x, z) < 0.3 || y > TREELINE || slopeAt(yAt, x, z, y, 6) > 0.6) continue;
      const mats = j.mats.get(kind), n = counts.get(kind) ?? 0;
      if (!mats || n >= FAR_CAP) continue;
      const size = lo + (hi - lo) * hash(gx, gz, 25), girth = 0.9 + 0.3 * hash(gx, gz, 26);
      o.position.set(x, y - 0.3, z); o.rotation.set(0, hash(gx, gz, 27) * Math.PI, 0); o.scale.set(size * girth, size, size * girth);
      o.updateMatrix();
      o.matrix.toArray(mats, n * 16);
      tint(gx, gz, y).toArray(j.cols.get(kind)!, n * 3);
      counts.set(kind, n + 1);
    }
  }
  f.far = 0;
  for (const [kind, m] of f.cards) {
    const n = counts.get(kind) ?? 0;
    m.instanceMatrix.array.set(j.mats.get(kind)!.subarray(0, n * 16));
    if (!m.instanceColor) m.setColorAt(0, turfC);
    m.instanceColor!.array.set(j.cols.get(kind)!.subarray(0, n * 3));
    f.culled.get(m)?.keep(n); f.far += n;
  }
  f.farJob = null;
  stale = true;
  return true;
}

/** The grass within TURF_R of (cx, cz): a tuft every TURF_GRID metres where the biome's turf covers, in its colour. Lays
 * rows for up to `budget` ms into arrays of its own and answers true once they are copied into the mesh, all at once, so no
 * frame draws half the old grass and half the new; called again for another centre, it starts over there. */
export function scatterTurf(f: Flora, cx: number, cz: number, regionOf: (x: number, z: number) => Region | undefined, yAt: (x: number, z: number) => number, waterAt: (x: number, z: number) => number = () => 0, budget = Infinity): boolean {
  const m = f.turf;
  if (!m) return true;
  const t0 = performance.now(), gz0 = Math.floor((cz - TURF_R) / TURF_GRID), gz1 = Math.floor((cz + TURF_R) / TURF_GRID);
  let j = f.turfJob;
  if (!j || j.cx !== cx || j.cz !== cz) j = f.turfJob = { cx, cz, gz: gz0, n: 0, mats: j?.mats ?? new Float32Array(m.instanceMatrix.array.length), cols: j?.cols ?? new Float32Array(m.instanceMatrix.count * 3) };
  let n = j.n;
  for (; j.gz <= gz1; j.gz++) {
    if (j.gz > gz0 && performance.now() - t0 > budget) { j.n = n; return false; }
    const gz = j.gz;
    for (let gx = Math.floor((cx - TURF_R) / TURF_GRID); gx <= Math.floor((cx + TURF_R) / TURF_GRID); gx++) {
      if (n >= m.instanceMatrix.count) break;
      const x = (gx + hash(gx, gz, 31)) * TURF_GRID, z = (gz + hash(gx, gz, 32)) * TURF_GRID;
      if (Math.hypot(x - cx, z - cz) > TURF_R) continue;
      const g = regionOf(x, z);
      if (!g) continue;
      const turf = TURF[g.biome], y = yAt(x, z);
      if (y - waterAt(x, z) < 0.3 || y > TREELINE + 6 || hash(gx, gz, 33) > turfAt(g.biome, x, z)) continue;
      const h = turf.height * (0.7 + 0.6 * hash(gx, gz, 34));
      o.position.set(x, y - 0.03, z); o.rotation.set(0, hash(gx, gz, 35) * Math.PI, 0); o.scale.set(h * 2.2, h, h * 2.2);
      o.updateMatrix();
      o.matrix.toArray(j.mats, n * 16);
      tint(gx, gz, y).multiply(turfC.setHex(turf.colour)).multiplyScalar(2.2).toArray(j.cols, n * 3);
      n++;
    }
  }
  m.instanceMatrix.array.set(j.mats.subarray(0, n * 16));
  if (!m.instanceColor) m.setColorAt(0, turfC);
  m.instanceColor!.array.set(j.cols.subarray(0, n * 3));
  m.count = f.tufts = n;
  m.instanceMatrix.needsUpdate = true;
  m.instanceColor!.needsUpdate = true;
  f.turfJob = null;
  return true;
}
