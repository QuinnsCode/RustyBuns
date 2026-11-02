// What grows on the open world, near you and far: trees, scrub, ferns, flowers and rocks for each biome from
// Skate Tech Park's scenery set (its Blender-built pines, oaks, aspens, sequoias, palms, joshua trees, saguaros,
// sage, ferns, flowers, stumps and rocks; none of its park kit), plus grass, mushrooms, fallen logs and reeds
// made here. Each kind is one instanced mesh; the spots come from a hash of a 5 m grid, so the same ground
// always grows the same plants, and only the patch around you is planted. Past that, the forest goes on as
// flat cards, two crossed silhouettes a tree, out to a kilometre and more. Every plant leans in the wind, and
// no two are quite the same colour.
//
// Where things grow follows the ground: nothing on the beach but reeds at the water's edge, no trees above the
// treeline and nothing but rock higher still, rock on the steep faces, glades in every forest where the trees
// stand back and the flowers come in, and the woods themselves in groves with open ground between.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Biome, Region } from "../regions.ts";
import type { World } from "./world.ts";
// Shared with Skate Tech Park rather than copied: Vite serves it from there and bundles it into this app.
import sceneryUrl from "../../../skate-tech-park/public/models/scenery-mid.glb?url";

/** The scenery set's kinds, then the ones made here. */
const SCENERY = ["pine", "aspen", "oak", "sequoia", "palm", "joshua", "saguaro", "snag", "sage", "bush", "fern", "flower", "stump", "rock"] as const;
const MADE = ["grass", "mushroom", "log", "reed"] as const;
export const KINDS = [...SCENERY, ...MADE] as const;
export type Kind = (typeof KINDS)[number];
export const TALL: ReadonlySet<Kind> = new Set(["pine", "aspen", "oak", "sequoia", "palm", "joshua", "saguaro", "snag"]);
/** Trees whose far card is a spire (the rest are round). */
const SPIRE: ReadonlySet<Kind> = new Set(["pine", "sequoia", "snag"]);
const CAP = 3200;      // instances a kind can show at once, near
const FAR_CAP = 9000;  // far cards a kind can show at once
const GRID = 5;        // metres between candidate spots, near
const FAR_GRID = 13;   // metres between candidate spots, far
export const TREELINE = 46; // game metres: no tree stands higher
export const BARE = 60;     // game metres: nothing but rock and snow above this
const WATER_EDGE = 1.6;     // game metres: reeds grow below this, little else
const TURF_R = 70;          // metres round you the grass is drawn
const TURF_GRID = 1.15;     // metres between grass tufts

/** Per biome: how thickly it grows (0-1), and each kind's share with its height range in metres. */
export type Plant = [kind: Kind, share: number, min: number, max: number];
const B = (density: number, ...kinds: Plant[]) => ({ density, kinds });
export const FLORA: Record<Biome, { density: number; kinds: Plant[] }> = {
  "pine-barrens": B(0.6, ["pine", 0.42, 7, 15], ["oak", 0.1, 5, 9], ["bush", 0.18, 0.8, 1.6], ["fern", 0.1, 0.6, 1.1], ["snag", 0.05, 4, 8], ["flower", 0.06, 0.3, 0.6], ["mushroom", 0.04, 0.12, 0.3], ["log", 0.03, 2.5, 5], ["reed", 0.02, 1.2, 2]),
  forest: B(0.7, ["oak", 0.28, 8, 15], ["pine", 0.18, 10, 18], ["aspen", 0.12, 7, 12], ["bush", 0.12, 0.8, 1.6], ["fern", 0.12, 0.6, 1.2], ["stump", 0.03, 0.4, 0.8], ["rock", 0.05, 0.5, 1.6], ["mushroom", 0.06, 0.12, 0.35], ["log", 0.04, 3, 6]),
  rainforest: B(0.85, ["sequoia", 0.26, 22, 42], ["pine", 0.13, 14, 24], ["fern", 0.32, 0.9, 2], ["bush", 0.1, 1, 2], ["stump", 0.04, 0.5, 1], ["rock", 0.04, 0.6, 1.8], ["mushroom", 0.07, 0.15, 0.4], ["log", 0.04, 4, 9]),
  lake: B(0.5, ["aspen", 0.18, 6, 11], ["pine", 0.18, 8, 15], ["bush", 0.2, 0.8, 1.5], ["flower", 0.18, 0.3, 0.6], ["rock", 0.12, 0.5, 1.6], ["reed", 0.14, 1.4, 2.4]),
  desert: B(0.22, ["saguaro", 0.12, 4, 9], ["joshua", 0.15, 3, 6], ["sage", 0.4, 0.5, 1.1], ["rock", 0.28, 0.4, 2.2], ["snag", 0.05, 2, 4]),
  swamp: B(0.65, ["palm", 0.13, 6, 11], ["snag", 0.14, 5, 10], ["fern", 0.25, 0.8, 1.6], ["bush", 0.18, 0.8, 1.6], ["flower", 0.08, 0.3, 0.6], ["reed", 0.16, 1.6, 2.6], ["mushroom", 0.03, 0.15, 0.4], ["log", 0.03, 3, 6]),
  plains: B(0.3, ["flower", 0.35, 0.3, 0.6], ["sage", 0.2, 0.4, 0.9], ["bush", 0.15, 0.8, 1.5], ["oak", 0.1, 7, 12], ["aspen", 0.1, 6, 10], ["rock", 0.1, 0.4, 1.2]),
  highlands: B(0.4, ["rock", 0.35, 0.5, 2.5], ["sage", 0.25, 0.4, 0.9], ["pine", 0.15, 6, 12], ["flower", 0.15, 0.3, 0.5], ["snag", 0.1, 3, 6]),
  jungle: B(0.85, ["palm", 0.33, 7, 14], ["fern", 0.28, 1, 2.2], ["bush", 0.18, 1, 2], ["sequoia", 0.1, 18, 30], ["flower", 0.05, 0.3, 0.7], ["mushroom", 0.03, 0.15, 0.4], ["log", 0.03, 3, 7]),
  island: B(0.45, ["palm", 0.38, 6, 12], ["bush", 0.18, 0.8, 1.5], ["flower", 0.18, 0.3, 0.6], ["rock", 0.16, 0.5, 1.8], ["reed", 0.1, 1.2, 2]),
  mountains: B(0.45, ["pine", 0.3, 6, 14], ["rock", 0.4, 0.6, 3], ["snag", 0.15, 3, 7], ["sage", 0.15, 0.3, 0.7]),
  river: B(0.55, ["oak", 0.22, 7, 13], ["bush", 0.22, 0.8, 1.6], ["fern", 0.16, 0.6, 1.2], ["flower", 0.16, 0.3, 0.6], ["palm", 0.08, 6, 10], ["reed", 0.16, 1.4, 2.4]),
  coast: B(0.45, ["pine", 0.22, 6, 13], ["rock", 0.32, 0.6, 2.4], ["bush", 0.22, 0.8, 1.5], ["sage", 0.14, 0.4, 0.8], ["reed", 0.1, 1, 1.8]),
  savanna: B(0.3, ["oak", 0.12, 5, 9], ["sage", 0.4, 0.5, 1], ["rock", 0.2, 0.5, 1.6], ["joshua", 0.08, 3, 5], ["flower", 0.2, 0.3, 0.5]),
  tundra: B(0.22, ["rock", 0.5, 0.4, 1.8], ["sage", 0.3, 0.2, 0.5], ["flower", 0.2, 0.15, 0.35]),
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
  /** The far cards, one instanced mesh a tall kind. */
  cards: Map<Kind, THREE.InstancedMesh>;
  /** The grass round your feet. */
  turf: THREE.InstancedMesh | null;
  /** Near plants, far cards and grass tufts drawn now. */
  spots: number; far: number; tufts: number;
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
function plantMaterial(you: THREE.Vector3, time: { value: number }, gust: { value: number }, sway: number, twoSided = false, near?: THREE.Vector3): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, side: twoSided ? THREE.DoubleSide : THREE.FrontSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uYou = { value: you }; sh.uniforms.uTime = time; sh.uniforms.uGust = gust; sh.uniforms.uSway = { value: sway }; sh.uniforms.uNear = { value: near ?? new THREE.Vector3(0, 0, -1) };
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vPlant;\nvarying float vNear;\nuniform float uTime;\nuniform float uGust;\nuniform float uSway;\nuniform vec3 uNear;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
  #ifdef USE_INSTANCING
  vec2 ip = instanceMatrix[3].xz;
  float ph = uTime * 1.6 + ip.x * 0.17 + ip.y * 0.13;
  float bend = (sin(ph) + 0.5 * sin(ph * 2.3 + 1.0)) * uSway * (0.25 + uGust) * transformed.y * transformed.y;
  transformed.x += bend; transformed.z += bend * 0.4;
  vNear = distance(ip, uNear.xy) - uNear.z;
  #else
  vNear = 1.0;
  #endif
  vPlant = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vPlant;\nvarying float vNear;\nuniform vec3 uYou;")
      .replace("void main() {", `void main() {
  if (vNear < 0.0) discard;
  vec3 seg = uYou - cameraPosition; float t = clamp(dot(vPlant - cameraPosition, seg) / dot(seg, seg), 0.0, 1.0);
  if (t < 0.97 && distance(vPlant, cameraPosition + seg * t) < ${SIGHTLINE.toFixed(1)}) discard;`);
  };
  return mat;
}
/** How far each kind's top swings, in its own height: grass and reeds a lot, flowers and ferns some, trees a little, rock none. */
const SWAY: Partial<Record<Kind, number>> = { grass: 0.16, reed: 0.14, flower: 0.08, fern: 0.07, sage: 0.05, bush: 0.04, aspen: 0.03, oak: 0.02, pine: 0.02, palm: 0.05, sequoia: 0.012, joshua: 0.015, snag: 0.01, saguaro: 0, rock: 0, stump: 0, log: 0, mushroom: 0.01 };
const made = (): Map<Kind, THREE.BufferGeometry> => new Map<Kind, THREE.BufferGeometry>([
  ["grass", tuft(6, 0.16, [0.22, 0.34, 0.12], [0.62, 0.74, 0.3], 0.4)],
  ["reed", tuft(5, 0.06, [0.3, 0.38, 0.14], [0.68, 0.66, 0.34], 0.12)],
  ["mushroom", mushroom()],
  ["log", log()],
]);

/** The plants' meshes, empty until the scenery set loads (a moment after the world first shows); then `loaded`. */
export function flora(loaded: () => void): Flora {
  const time = { value: 0 }, gust = { value: 0.3 };
  const f: Flora = { group: new THREE.Group(), meshes: new Map(), cards: new Map(), turf: null, spots: 0, far: 0, tufts: 0, you: new THREE.Vector3(0, -1e6, 0), near: new THREE.Vector3(0, 0, -1), tick(t, w) { time.value = t; gust.value = w; } };
  void scenery().then((kinds) => {
    for (const [k, g] of made()) kinds.set(k, g);
    for (const [kind, geo] of kinds) {
      const m = new THREE.InstancedMesh(geo, plantMaterial(f.you, time, gust, SWAY[kind] ?? 0.02, kind === "grass" || kind === "reed"), CAP);
      m.count = 0; m.frustumCulled = false;
      f.meshes.set(kind, m); f.group.add(m);
      if (TALL.has(kind)) {
        const c = new THREE.InstancedMesh(card(kind, canopyColour(geo)), plantMaterial(f.you, time, gust, 0, true, f.near), FAR_CAP);
        c.count = 0; c.frustumCulled = false;
        f.cards.set(kind, c); f.group.add(c);
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
/** A plant's own shade of its kind's colour: a little lighter or darker, a little warmer or cooler, paler high up. */
function tint(gx: number, gz: number, y: number): THREE.Color {
  const l = 0.84 + 0.32 * hash(gx, gz, 11), warm = 0.94 + 0.12 * hash(gx, gz, 12), high = Math.max(0, (y - 30) / 40);
  return tintC.setRGB(l * warm + high * 0.15, l + high * 0.1, l / warm);
}
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
export function scatterFlora(f: Flora, cx: number, cz: number, radius: number, regionOf: (x: number, z: number) => Region | undefined, yAt: (x: number, z: number) => number, w: World) {
  if (!f.meshes.size) return;
  const counts = new Map<Kind, number>();
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
      if (kind === "reed" ? y < -0.3 || y > WATER_EDGE : y < 0.3) continue;
      // In a glade the trees stand back: a tree there is a flower or grass instead, twice as often.
      if (open && TALL.has(kind)) { if (hash(gx, gz, 13) > 0.5) continue; [kind, , lo, hi] = spec.kinds.find((k) => k[0] === "flower") ?? spec.kinds.find((k) => k[0] === "sage") ?? ["grass", 1, 0.4, 0.7]; }
      // Above the treeline, and on steep faces, only rock stands.
      const slope = slopeAt(yAt, x, z, y);
      if ((y > TREELINE && TALL.has(kind)) || (slope > 0.6 && kind !== "rock")) { if (hash(gx, gz, 6) > 0.3) continue; kind = "rock"; lo = 0.5; hi = 2; }
      const m = f.meshes.get(kind), n = counts.get(kind) ?? 0;
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
      counts.set(kind, n + 1);
    }
  f.spots = 0;
  for (const [kind, m] of f.meshes) { m.count = counts.get(kind) ?? 0; f.spots += m.count; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
}

/**
 * The far forest: tall kinds only, as cards, between `inner` and `outer` metres of (cx, cz), on a coarser grid than
 * the near plants so the two don't match spot for spot (they are never seen side by side: the near ring hides the join).
 */
export function scatterFar(f: Flora, cx: number, cz: number, inner: number, outer: number, regionOf: (x: number, z: number) => Region | undefined, yAt: (x: number, z: number) => number) {
  if (!f.cards.size) return;
  const counts = new Map<Kind, number>();
  for (let gz = Math.floor((cz - outer) / FAR_GRID); gz <= Math.floor((cz + outer) / FAR_GRID); gz++)
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
      if (y < 0.3 || y > TREELINE || slopeAt(yAt, x, z, y, 6) > 0.6) continue;
      const m = f.cards.get(kind), n = counts.get(kind) ?? 0;
      if (!m || n >= FAR_CAP) continue;
      const size = lo + (hi - lo) * hash(gx, gz, 25), girth = 0.9 + 0.3 * hash(gx, gz, 26);
      o.position.set(x, y - 0.3, z); o.rotation.set(0, hash(gx, gz, 27) * Math.PI, 0); o.scale.set(size * girth, size, size * girth);
      o.updateMatrix();
      m.setMatrixAt(n, o.matrix);
      m.setColorAt(n, tint(gx, gz, y));
      counts.set(kind, n + 1);
    }
  f.far = 0;
  for (const [kind, m] of f.cards) { m.count = counts.get(kind) ?? 0; f.far += m.count; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
}

/** The grass within TURF_R of (cx, cz): a tuft every TURF_GRID metres where the biome's turf covers, in its colour. */
export function scatterTurf(f: Flora, cx: number, cz: number, regionOf: (x: number, z: number) => Region | undefined, yAt: (x: number, z: number) => number) {
  const m = f.turf;
  if (!m) return;
  let n = 0;
  for (let gz = Math.floor((cz - TURF_R) / TURF_GRID); gz <= Math.floor((cz + TURF_R) / TURF_GRID); gz++)
    for (let gx = Math.floor((cx - TURF_R) / TURF_GRID); gx <= Math.floor((cx + TURF_R) / TURF_GRID); gx++) {
      if (n >= m.instanceMatrix.count) break;
      const x = (gx + hash(gx, gz, 31)) * TURF_GRID, z = (gz + hash(gx, gz, 32)) * TURF_GRID;
      if (Math.hypot(x - cx, z - cz) > TURF_R) continue;
      const g = regionOf(x, z);
      if (!g) continue;
      const turf = TURF[g.biome], y = yAt(x, z);
      if (y < 0.3 || y > TREELINE + 6 || hash(gx, gz, 33) > turfAt(g.biome, x, z)) continue;
      const h = turf.height * (0.7 + 0.6 * hash(gx, gz, 34));
      o.position.set(x, y - 0.03, z); o.rotation.set(0, hash(gx, gz, 35) * Math.PI, 0); o.scale.set(h * 2.2, h, h * 2.2);
      o.updateMatrix();
      m.setMatrixAt(n, o.matrix);
      m.setColorAt(n, tint(gx, gz, y).multiply(tintC.clone().setHex(turf.colour)).multiplyScalar(2.2));
      n++;
    }
  m.count = f.tufts = n;
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
}
