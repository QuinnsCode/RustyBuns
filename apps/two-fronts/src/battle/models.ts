// Everything on the forest moon is built from three.js primitives: no assets to load or license.
// Models stand on y = 0 and face -z, the way yaw 0 faces in the sim.
//
// Each model is a rig: named joints (groups) with the parts hanging off them merged into one mesh
// per material, so a Marine is a couple of dozen draw calls, not a hundred. A model is built once
// and cloned after that, sharing its geometry. `animate` poses a clone every frame from what its
// unit is doing: walk cycles, the Wooka's waddle and club swing, recoil, wobbling antennas.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Faction } from "./contract.ts";
import type { Trooper, WookaRole } from "./sim.ts";

type V3 = [number, number, number];
type Mat = THREE.Material;

// --- Procedural textures: grey, so a material's colour tints them. None in a headless test. ---
const textures = new Map<string, THREE.Texture | null>();
export function texture(name: string, w: number, h: number, repeat: [number, number], draw: (c: CanvasRenderingContext2D, r: () => number) => void) {
  if (textures.has(name)) return textures.get(name) ?? null;
  let t: THREE.Texture | null = null;
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    let s = 7;
    draw(canvas.getContext("2d")!, () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296));
    t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
  }
  textures.set(name, t);
  return t;
}
const grey = (v: number, a = 1) => `rgba(${v},${v},${v},${a})`;
// Fur: short strands, mostly falling down.
const furMap = () => texture("fur", 128, 128, [3, 3], (c, r) => {
  c.fillStyle = grey(165);
  c.fillRect(0, 0, 128, 128);
  c.lineWidth = 1.2;
  for (let i = 0; i < 1600; i++) {
    const x = r() * 128, y = r() * 128, len = 3 + r() * 7, a = Math.PI / 2 + (r() - 0.5) * 0.9;
    c.strokeStyle = grey(90 + r() * 150, 0.7);
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    c.stroke();
  }
});
// Bark: deep vertical furrows.
const barkMap = () => texture("bark", 64, 256, [3, 6], (c, r) => {
  c.fillStyle = grey(150);
  c.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 70; i++) {
    const x = r() * 64, w = 1 + r() * 4;
    c.fillStyle = grey(r() < 0.5 ? 70 + r() * 40 : 190 + r() * 50, 0.6);
    c.fillRect(x, 0, w, 256);
  }
  for (let i = 0; i < 60; i++) {
    c.fillStyle = grey(60, 0.5);
    c.fillRect(r() * 64, r() * 256, 2 + r() * 8, 1 + r() * 2);
  }
});
// Wood grain, for clubs, logs and hulls.
const grainMap = () => texture("grain", 128, 128, [1, 2], (c, r) => {
  c.fillStyle = grey(170);
  c.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 40; i++) {
    c.strokeStyle = grey(90 + r() * 60, 0.5);
    c.lineWidth = 1 + r() * 2;
    c.beginPath();
    const x = r() * 128;
    c.moveTo(x, 0);
    for (let y = 0; y <= 128; y += 16) c.lineTo(x + Math.sin(y * 0.05 + i) * 3, y);
    c.stroke();
  }
});
// Hide: blotchy, with stitches.
const hideMap = () => texture("hide", 128, 128, [1, 1], (c, r) => {
  c.fillStyle = grey(185);
  c.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 30; i++) {
    c.fillStyle = grey(120 + r() * 100, 0.35);
    c.beginPath();
    c.arc(r() * 128, r() * 128, 6 + r() * 20, 0, Math.PI * 2);
    c.fill();
  }
  c.strokeStyle = grey(60, 0.9);
  c.lineWidth = 2;
  for (const y of [42, 86]) for (let x = 4; x < 128; x += 10) { c.beginPath(); c.moveTo(x, y - 3); c.lineTo(x + 4, y + 3); c.stroke(); }
});
// Armour: faint panel lines and scuffs, so black isn't a flat hole.
const panelMap = () => texture("panel", 128, 128, [2, 2], (c, r) => {
  c.fillStyle = grey(205);
  c.fillRect(0, 0, 128, 128);
  c.strokeStyle = grey(120, 0.6);
  c.lineWidth = 1;
  c.strokeRect(0.5, 0.5, 127, 127);
  c.beginPath(); c.moveTo(64, 0); c.lineTo(64, 64); c.lineTo(128, 64); c.stroke();
  for (let i = 0; i < 80; i++) { c.fillStyle = grey(r() < 0.5 ? 255 : 150, 0.25); c.fillRect(r() * 128, r() * 128, 1 + r() * 6, 1); }
});

// --- Materials ---
const std = (color: number, roughness = 0.6, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.05, ...extra });
const glow = (color: number) => new THREE.MeshBasicMaterial({ color });

// Thunder Marines: black armour with white trim, a full-face helmet with a snorkel mask on the
// front, and a backpack far too big for anyone, bristling with antennas that wobble.
const M = {
  get armour() { return lazy("m.armour", () => std(0x1d2026, 0.38, { metalness: 0.2, map: panelMap() })); },
  get suit() { return lazy("m.suit", () => std(0x2a2c30, 0.85, { map: panelMap() })); },
  get trim() { return lazy("m.trim", () => std(0xf1f3f6, 0.42, { map: panelMap() })); },
  get gold() { return lazy("m.gold", () => std(0xf0bb40, 0.32, { metalness: 0.45, map: panelMap() })); },
  get pack() { return lazy("m.pack", () => std(0x30343b, 0.55, { map: panelMap() })); },
  get glass() { return lazy("m.glass", () => std(0x7fcfff, 0.08, { metalness: 0.3, transparent: true, opacity: 0.82, emissive: 0x0b2a3c })); },
  get dark() { return lazy("m.dark", () => std(0x0a0b0d, 0.25, { metalness: 0.4, map: panelMap() })); },
  get orange() { return lazy("m.orange", () => std(0xff7a1a, 0.5, { map: panelMap() })); },
  get gun() { return lazy("m.gun", () => std(0x3b3f47, 0.4, { metalness: 0.55, map: panelMap() })); },
  get rubber() { return lazy("m.rubber", () => std(0x0d0e10, 0.95, { map: panelMap() })); },
  get red() { return lazy("m.red", () => glow(0xff3b3b)); },
  get green() { return lazy("m.green", () => glow(0x5dff7a)); },
  get lens() { return lazy("m.lens", () => glow(0x9fe6ff)); },
  get pennant() { return lazy("m.pennant", () => std(0xe6b23a, 0.6, { side: THREE.DoubleSide })); },
  get engine() { return lazy("m.engine", () => glow(0xff9a3c)); },
  get engineCore() { return lazy("m.engineCore", () => glow(0xfff1c2)); },
  get plume() { return lazy("m.plume", () => new THREE.MeshBasicMaterial({ color: 0xff9a3a, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending })); },
};
// The Wooka: round, fluffy, knee-high to a Marine, with big black eyes that have nothing behind
// them and a club with a nail in it. On purpose.
const W = {
  get fur() { return lazy("w.fur", () => std(0x9a6438, 0.95, { map: furMap() })); },
  get furDark() { return lazy("w.furDark", () => std(0x5a3518, 0.95, { map: furMap() })); },
  get belly() { return lazy("w.belly", () => std(0xd6ad78, 0.95, { map: furMap() })); },
  get chief() { return lazy("w.chief", () => std(0x3d3a38, 0.95, { map: furMap() })); }, // the chieftain's grey mantle
  get eye() { return lazy("w.eye", () => new THREE.MeshPhysicalMaterial({ color: 0x030303, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02 })); },
  get shine() { return lazy("w.shine", () => glow(0xffffff)); },
  get glint() { return lazy("w.glint", () => glow(0xb01818)); },
  get nose() { return lazy("w.nose", () => std(0x1a100b, 0.3, { map: furMap() })); },
  get mouth() { return lazy("w.mouth", () => std(0x2a0c0c, 0.8, { map: furMap() })); },
  get tooth() { return lazy("w.tooth", () => std(0xf3eedc, 0.5, { map: furMap() })); },
  get wood() { return lazy("w.wood", () => std(0x7a4f2a, 0.85, { map: grainMap() })); },
  get bark() { return lazy("w.bark", () => std(0x6b4a30, 0.95, { map: barkMap() })); },
  get cut() { return lazy("w.cut", () => std(0xd2a46a, 0.9, { map: grainMap() })); }, // sawn wood, the rings showing
  get nail() { return lazy("w.nail", () => std(0x9aa0a6, 0.35, { metalness: 0.8, map: grainMap() })); },
  get bone() { return lazy("w.bone", () => std(0xeee6cf, 0.6, { map: furMap() })); },
  get leather() { return lazy("w.leather", () => std(0x5e3a1f, 0.7, { map: furMap() })); },
  get rope() { return lazy("w.rope", () => std(0xb89a5a, 0.95, { map: furMap() })); },
  get hide() { return lazy("w.hide", () => std(0xc4a272, 0.9, { side: THREE.DoubleSide, map: hideMap() })); },
  get hideDark() { return lazy("w.hideDark", () => std(0x8f6c44, 0.9, { side: THREE.DoubleSide, map: hideMap() })); },
  get rock() { return lazy("w.rock", () => std(0x6f6559, 0.95, { flatShading: true })); },
  get thatch() { return lazy("w.thatch", () => std(0xa88a4a, 1, { map: grainMap() })); },
  get fire() { return lazy("w.fire", () => glow(0xff6a1a)); },
  get fireCore() { return lazy("w.fireCore", () => glow(0xffd65a)); },
  get paint() { return lazy("w.paint", () => std(0xb3261e, 0.8, { map: furMap() })); }, // the chieftain's war paint
  get silver() { return lazy("w.silver", () => std(0xb9bcc2, 0.9, { map: furMap() })); }, // Warbur's silverback
  get silverDark() { return lazy("w.silverDark", () => std(0x6e7178, 0.9, { map: furMap() })); },
  get hex() { return lazy("w.hex", () => glow(0x7dff6a)); },        // a Shanti's magic
  get powder() { return lazy("w.powder", () => std(0x3a2a1a, 0.7, { map: grainMap() })); }, // a Boomie's keg
  get mange() { return lazy("w.mange", () => std(0x6a5c48, 0.98, { map: furMap() })); },       // a Mossback's matted coat
  get mangeLight() { return lazy("w.mangeLight", () => std(0x8a7d66, 0.98, { map: furMap() })); },
  get skin() { return lazy("w.skin", () => std(0x8a7f78, 0.9, { map: furMap() })); },          // the bald, scabbed patches
  get moss() { return lazy("w.moss", () => std(0x62982f, 1, { map: furMap() })); },             // and what grows on it
  get mossDark() { return lazy("w.mossDark", () => std(0x2f4a1c, 1, { map: furMap() })); },
};
const made = new Map<string, unknown>();
function lazy<T>(key: string, make: () => T): T {
  if (!made.has(key)) made.set(key, make());
  return made.get(key) as T;
}

// --- Geometry ---
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
// Rounded boxes: small ones get a chamfer, big ones a proper curve.
const rbox = (w: number, h: number, d: number, r = 0.04) => new RoundedBoxGeometry(w, h, d, Math.min(w, h, d) < 0.3 ? 1 : 3, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
const ball = (r: number, ws = 16, hs = 12) => new THREE.SphereGeometry(r, ws, hs);
const dome = (r: number, ws = 16) => new THREE.SphereGeometry(r, ws, 8, 0, Math.PI * 2, 0, Math.PI / 2);
const cyl = (rt: number, rb: number, h: number, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);
const capsule = (r: number, len: number, seg = 10) => new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 4, seg);
const ring = (r: number, t: number, seg = 24, arc = Math.PI * 2) => new THREE.TorusGeometry(r, t, 6, seg, arc);
const cone = (r: number, h: number, seg = 8) => new THREE.ConeGeometry(r, h, seg);
// A flat outline in x, y, extruded depth along z and centred on it.
function prism(pts: [number, number][], depth: number, bevel = 0) {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1 });
  return g.translate(0, 0, -depth / 2);
}
// A flat outline lying on the ground plane: x across, z along (+z back), extruded up by `height`
// and centred on y = 0.
const slab = (pts: [number, number][], height: number, bevel = 0) => prism(pts.map(([x, z]) => [x, -z]), height, bevel).rotateX(-Math.PI / 2);
// A side profile: z along (+z back), y up, extruded across x by `width`.
const profile = (pts: [number, number][], width: number, bevel = 0) => prism(pts.map(([z, y]) => [-z, y]), width, bevel).rotateY(Math.PI / 2);
// A lumpy ball: an icosphere with each vertex pushed in or out by a hash of its direction, so the
// same vertex on two faces moves alike. Shag 0.1 is fur; 0.3 is an asteroid.
export function lumpy(r: number, detail = 2, shag = 0.08, seed = 1, smooth = true) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position as THREE.BufferAttribute, n = g.attributes.normal as THREE.BufferAttribute, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const h = Math.sin(Math.round(v.x * 500) * 12.9898 + Math.round(v.y * 500) * 78.233 + Math.round(v.z * 500) * 37.719 + seed) * 43758.5453;
    const k = 1 + ((h - Math.floor(h)) * 2 - 1) * shag;
    if (smooth) n.setXYZ(i, v.x, v.y, v.z);
    p.setXYZ(i, v.x * r * k, v.y * r * k, v.z * r * k);
  }
  if (!smooth) g.computeVertexNormals();
  return g;
}

// The shared materials parts merge into. A standard one reads roughness and metalness from a
// per-vertex attribute, so armour, rubber and trim can share a draw call and still look apart.
function family(mat: Mat): Mat {
  if (mat.transparent || mat.side !== THREE.FrontSide) return mat;
  if (mat.type === "MeshBasicMaterial") return lazy("family:glow", () => new THREE.MeshBasicMaterial({ vertexColors: true }));
  if (mat.type !== "MeshStandardMaterial") return mat;
  const m = mat as THREE.MeshStandardMaterial;
  if (m.flatShading || m.emissive.getHex() !== 0) return mat;
  return lazy(`family:${m.map?.uuid ?? "plain"}`, () => {
    const f = new THREE.MeshStandardMaterial({ vertexColors: true, map: m.map });
    f.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec2 pbr;\nvarying vec2 vPbr;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvPbr = pbr;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vPbr;")
        .replace("float roughnessFactor = roughness;", "float roughnessFactor = vPbr.x;")
        .replace("float metalnessFactor = metalness;", "float metalnessFactor = vPbr.y;");
    };
    f.customProgramCacheKey = () => "pbr-per-vertex";
    return f;
  });
}
function paint(g: THREE.BufferGeometry, m: THREE.MeshStandardMaterial) {
  const n = g.attributes.position!.count, color = new Float32Array(n * 3), pbr = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    color.set([m.color.r, m.color.g, m.color.b], i * 3);
    pbr.set([m.roughness ?? 1, m.metalness ?? 0], i * 2);
  }
  g.setAttribute("color", new THREE.BufferAttribute(color, 3));
  if (m.type === "MeshStandardMaterial") g.setAttribute("pbr", new THREE.BufferAttribute(pbr, 2));
}

interface Spot { x?: number; y?: number; z?: number; rx?: number; ry?: number; rz?: number; s?: number | V3 }
const DOWN = new THREE.Vector3(0, -1, 0), UP = new THREE.Vector3(0, 1, 0);

// Builds one rig: joints, and parts merged per joint and material when it's baked.
class Kit {
  readonly root = new THREE.Group();
  private parts = new Map<THREE.Object3D, Map<Mat, THREE.BufferGeometry[]>>();
  joint(name: string, parent: THREE.Object3D = this.root, x = 0, y = 0, z = 0) {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  }
  add(on: THREE.Object3D, geo: THREE.BufferGeometry, mat: Mat, p: Spot = {}) {
    const s = p.s ?? 1, sv = typeof s === "number" ? [s, s, s] as V3 : s;
    geo.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(p.x ?? 0, p.y ?? 0, p.z ?? 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0)),
      new THREE.Vector3(...sv),
    ));
    const byMat = this.parts.get(on) ?? new Map<Mat, THREE.BufferGeometry[]>();
    this.parts.set(on, byMat);
    const list = byMat.get(mat) ?? [];
    byMat.set(mat, list);
    list.push(geo.index ? geo.toNonIndexed() : geo);
    return this;
  }
  // The same part on both sides, x mirrored (by position and the y and z turns, never by scale).
  pair(on: THREE.Object3D, make: () => THREE.BufferGeometry, mat: Mat, p: Spot) {
    this.add(on, make(), mat, p);
    this.add(on, make(), mat, { ...p, x: -(p.x ?? 0), ry: -(p.ry ?? 0), rz: -(p.rz ?? 0) });
  }
  // A rod from a to b.
  rod(on: THREE.Object3D, a: V3, b: V3, r: number, mat: Mat, seg = 8, r2 = r) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const g = cyl(r2, r, A.distanceTo(B), seg);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, B.clone().sub(A).normalize()));
    g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
    return this.add(on, g, mat);
  }
  // Merges each joint's parts into as few meshes as it can: every opaque part sharing a texture
  // into one, its colour, roughness and metalness carried per vertex; every glowing part into
  // another. Glass, hide and the like keep their own.
  bake(model: string, extra: Record<string, string | number | boolean> = {}) {
    for (const [on, byMat] of this.parts) {
      const merged = new Map<Mat, THREE.BufferGeometry[]>();
      for (const [mat, geos] of byMat) {
        const into = family(mat);
        for (const g of geos) {
          for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
          g.clearGroups();
          if (into !== mat) paint(g, mat as THREE.MeshStandardMaterial);
        }
        merged.set(into, [...(merged.get(into) ?? []), ...geos]);
      }
      for (const [mat, geos] of merged) {
        const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
        mesh.castShadow = !(mat as THREE.MeshBasicMaterial).transparent;
        mesh.receiveShadow = true;
        on.add(mesh);
      }
    }
    this.root.userData = { model, ...extra };
    return this.root;
  }
}

// Each model is built once, then cloned: clones share geometry and materials.
const templates = new Map<string, THREE.Group>();
function cloneOf(key: string, build: () => THREE.Group) {
  let t = templates.get(key);
  if (!t) templates.set(key, (t = build()));
  return t.clone();
}

// Bends a two-bone limb so its end lands on `target`, the elbow or knee pushed towards `pole`.
// Positions are in the limb's parent's space; each bone hangs down its joint's -y.
function reach(upper: THREE.Object3D, lower: THREE.Object3D, target: V3, l1: number, l2: number, pole: V3) {
  const S = upper.position, T = new THREE.Vector3(...target), d = T.clone().sub(S);
  const dist = Math.min(d.length(), l1 + l2 - 1e-3), dir = d.normalize();
  const a = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist))));
  const P = new THREE.Vector3(...pole), bend = P.sub(dir.clone().multiplyScalar(P.dot(dir))).normalize();
  const up = dir.clone().multiplyScalar(Math.cos(a)).add(bend.multiplyScalar(Math.sin(a)));
  const elbow = S.clone().add(up.clone().multiplyScalar(l1));
  upper.quaternion.setFromUnitVectors(DOWN, up);
  const fore = T.clone().sub(elbow).normalize().applyQuaternion(upper.quaternion.clone().invert());
  lower.quaternion.setFromUnitVectors(DOWN, fore);
}

// ============================================================================================
// Thunder Marines
// ============================================================================================
const ARM = [0.31, 0.3] as const; // upper arm, forearm
const LEG = [0.44, 0.44] as const; // thigh, shin

// The guns, built along -z from the grip. Each says where the hands go, in its own space.
function carbine(k: Kit, gun: THREE.Object3D, trim: Mat, long = false) {
  const reach = long ? 0.5 : 0;
  k.add(gun, rbox(0.085, 0.14, 0.52, 0.025), M.gun, { y: 0.03, z: -0.12 });          // receiver
  k.add(gun, rbox(0.095, 0.1, 0.3 + reach * 0.3, 0.03), M.armour, { y: 0.03, z: -0.48 - reach * 0.15 }); // shroud
  k.add(gun, box(0.088, 0.025, 0.4), trim, { y: 0.095, z: -0.2 });                    // a white stripe along the top
  k.rod(gun, [0, 0.04, -0.6 - reach * 0.3], [0, 0.04, -0.82 - reach], 0.022, M.dark);  // barrel
  k.add(gun, cyl(0.04, 0.04, 0.09, 10).rotateX(Math.PI / 2), M.dark, { y: 0.04, z: -0.84 - reach }); // muzzle brake
  k.add(gun, rbox(0.05, 0.2, 0.09, 0.02), M.dark, { y: -0.1, z: -0.2, rx: 0.25 });      // magazine
  k.add(gun, rbox(0.05, 0.13, 0.06, 0.02), M.rubber, { y: -0.07, z: 0.0, rx: -0.3 });  // grip
  k.add(gun, rbox(0.06, 0.11, 0.26, 0.03), M.armour, { y: 0.0, z: 0.25 });             // stock
  k.add(gun, rbox(0.045, 0.1, 0.05, 0.015), M.rubber, { y: -0.04, z: -0.4 - reach * 0.15 }); // foregrip
  if (long) {
    // A scope, front and back lenses lit, and a folded bipod.
    k.add(gun, cyl(0.045, 0.045, 0.42, 12).rotateX(Math.PI / 2), M.dark, { y: 0.17, z: -0.15 });
    k.add(gun, cyl(0.058, 0.045, 0.06, 12).rotateX(Math.PI / 2), M.dark, { y: 0.17, z: -0.38 });
    k.add(gun, cyl(0.04, 0.04, 0.01, 12).rotateX(Math.PI / 2), M.lens, { y: 0.17, z: -0.415 });
    k.rod(gun, [0.03, -0.01, -0.9], [0.04, -0.02, -0.55], 0.012, M.dark);
    k.rod(gun, [-0.03, -0.01, -0.9], [-0.04, -0.02, -0.55], 0.012, M.dark);
  } else {
    k.add(gun, rbox(0.04, 0.05, 0.12, 0.012), M.dark, { y: 0.13, z: -0.1 });            // sight
    k.add(gun, box(0.02, 0.02, 0.01), M.red, { y: 0.135, z: -0.165 });
  }
  return { grip: [0, -0.05, 0.02] as V3, fore: [0, -0.06, -0.4 - reach * 0.15] as V3 };
}

function launcher(k: Kit, gun: THREE.Object3D, trim: Mat) {
  k.add(gun, cyl(0.13, 0.13, 1.4, 16).rotateX(Math.PI / 2), M.armour, { z: -0.2 });
  for (const z of [-0.75, 0.35]) k.add(gun, cyl(0.15, 0.15, 0.08, 16).rotateX(Math.PI / 2), trim, { z });
  k.add(gun, cyl(0.17, 0.13, 0.12, 16).rotateX(Math.PI / 2), M.orange, { z: -0.92 });   // the business end
  k.add(gun, cyl(0.11, 0.11, 0.02, 16).rotateX(Math.PI / 2), M.dark, { z: -0.985 });
  k.add(gun, cyl(0.13, 0.18, 0.14, 16).rotateX(Math.PI / 2), M.gun, { z: 0.56 });       // exhaust flare
  k.add(gun, rbox(0.1, 0.12, 0.22, 0.03), M.gun, { x: -0.16, y: 0.08, z: -0.35 });      // sight box
  k.add(gun, box(0.01, 0.06, 0.06), M.lens, { x: -0.16, y: 0.09, z: -0.465 });
  k.add(gun, rbox(0.05, 0.14, 0.06, 0.02), M.rubber, { y: -0.18, z: -0.05, rx: -0.2 }); // trigger grip
  k.add(gun, rbox(0.05, 0.12, 0.06, 0.02), M.rubber, { y: -0.17, z: -0.45 });
  return { grip: [0, -0.22, -0.05] as V3, fore: [0, -0.2, -0.45] as V3 };
}

function buildMarine(hero: boolean, kit: Trooper) {
  const k = new Kit(), trim = hero ? M.gold : M.trim;
  const hips = k.joint("hips", k.root, 0, 0.98, 0);
  k.add(hips, rbox(0.5, 0.24, 0.32, 0.09), M.armour, { y: 0.02 });
  k.add(hips, rbox(0.47, 0.065, 0.31, 0.03), trim, { y: 0.11 });                      // belt
  k.add(hips, rbox(0.12, 0.08, 0.04, 0.02), M.gun, { y: 0.11, z: -0.16 });            // buckle
  k.pair(hips, () => rbox(0.1, 0.13, 0.09, 0.025), M.pack, { x: 0.19, y: 0.03, z: -0.12 }); // pouches
  k.pair(hips, () => rbox(0.08, 0.12, 0.08, 0.025), M.pack, { x: 0.25, y: 0.03, z: 0.04 });
  for (const s of [-1, 1]) {
    const leg = k.joint(s < 0 ? "legL" : "legR", hips, s * 0.12, -0.04, 0);
    k.add(leg, capsule(0.1, LEG[0] + 0.06), M.suit, { y: -LEG[0] / 2 });
    k.add(leg, rbox(0.25, 0.34, 0.27, 0.08), M.armour, { y: -0.2, z: -0.01 });            // thigh plate
    k.add(leg, box(0.02, 0.24, 0.06), trim, { x: s * 0.1, y: -0.2 });                  // its stripe
    const knee = k.joint(s < 0 ? "kneeL" : "kneeR", leg, 0, -LEG[0], 0);
    k.add(knee, rbox(0.17, 0.15, 0.09, 0.04), trim, { z: -0.1 });                     // knee pad
    k.add(knee, capsule(0.09, LEG[1]), M.suit, { y: -LEG[1] / 2 + 0.02 });
    k.add(knee, rbox(0.23, 0.3, 0.25, 0.08), M.armour, { y: -0.22, z: -0.01 });        // shin guard
    k.add(knee, cone(0.04, 0.1, 5).rotateX(-Math.PI / 2), M.gold, { y: 0.0, z: -0.17 });  // knee spike
    k.add(knee, rbox(0.26, 0.17, 0.36, 0.07), M.armour, { y: -0.44 + 0.0, z: -0.05 });  // boot, a big one
    k.add(knee, rbox(0.21, 0.04, 0.34, 0.015), M.rubber, { y: -0.52, z: -0.05 });      // sole
    k.add(knee, rbox(0.14, 0.05, 0.08, 0.02), trim, { y: -0.4, z: -0.2 });             // toe cap
  }

  const torso = k.joint("torso", hips, 0, 0.12, 0);
  k.add(torso, rbox(0.36, 0.24, 0.25, 0.08), M.suit, { y: 0.1 });                      // waist
  k.add(torso, rbox(0.72, 0.46, 0.42, 0.14), M.armour, { y: 0.38 });                    // chest, built like a fridge
  k.add(torso, rbox(0.52, 0.22, 0.06, 0.03), trim, { y: 0.45, z: -0.2 });           // chest plate
  k.pair(torso, () => cone(0.035, 0.12, 5).rotateX(-Math.PI / 2), M.gold, { x: 0.2, y: 0.28, z: -0.24 }); // two studs, for the look
  k.add(torso, rbox(0.3, 0.3, 0.03, 0.01), M.trim, { y: -0.12, z: -0.2 });          // a tabard hanging from the belt
  k.add(torso, prism([[0.05, 0.1], [-0.05, -0.02], [0.0, -0.02], [-0.04, -0.12], [0.06, 0.0], [0.0, 0.0]], 0.02), M.orange, { y: -0.1, z: -0.225 });
  k.add(torso, rbox(0.3, 0.12, 0.05, 0.03), M.armour, { y: 0.24, z: -0.15 });         // ab plate
  // A thunderbolt on the chest, in orange (gold for the hero).
  k.add(torso, prism([[0.05, 0.12], [-0.06, 0.0], [0.0, 0.0], [-0.05, -0.12], [0.06, 0.01], [0.0, 0.01]], 0.02), hero ? M.gold : M.orange, { y: 0.45, z: -0.235 });
  k.add(torso, ring(0.17, 0.06, 16).rotateX(Math.PI / 2), M.armour, { y: 0.62 });     // collar
  k.pair(torso, () => rbox(0.07, 0.05, 0.42, 0.02), M.pack, { x: 0.15, y: 0.6, z: 0.08 }); // pack straps

  // The helmet: a dome, a white ridge front to back, and the snorkel mask on the front.
  const head = k.joint("head", torso, 0, 0.68, 0);
  head.scale.setScalar(1.18);                                                          // a big helmet on a big man
  k.add(head, ball(0.2, 24, 16), M.armour, { y: 0.12, s: [1, 1.08, 1.06] });
  k.add(head, ring(0.215, 0.025, 20, Math.PI), trim, { y: 0.11, ry: Math.PI / 2 });   // ridge
  k.add(head, rbox(0.04, 0.12, 0.34, 0.015), hero ? M.gold : M.orange, { y: 0.34, z: 0.02 }); // a crest down the middle
  k.pair(head, () => cone(0.03, 0.16, 5), M.dark, { x: 0.17, y: 0.3, z: 0.0, rz: -0.5 }); // little horns
  k.add(head, rbox(0.38, 0.06, 0.3, 0.03), M.armour, { y: -0.02, z: 0.04 });          // jaw guard
  k.pair(head, () => cyl(0.07, 0.07, 0.05, 14).rotateZ(Math.PI / 2), M.armour, { x: 0.205, y: 0.08 }); // ear pieces
  k.pair(head, () => cyl(0.04, 0.04, 0.02, 14).rotateZ(Math.PI / 2), trim, { x: 0.235, y: 0.08 });
  k.add(head, ball(0.14, 18, 12), M.glass, { y: 0.09, z: -0.16, s: [1.15, 0.85, 0.55] }); // the mask
  k.add(head, ring(0.14, 0.024, 20), trim, { y: 0.09, z: -0.2, s: [1.15, 0.85, 1] });
  k.add(head, cyl(0.06, 0.07, 0.09, 12).rotateX(Math.PI / 2), M.orange, { y: -0.02, z: -0.25 }); // snout
  k.add(head, cyl(0.045, 0.045, 0.02, 12).rotateX(Math.PI / 2), M.dark, { y: -0.02, z: -0.3 });
  // The snorkel itself: up from the snout, past the right cheek and over the helmet.
  k.rod(head, [0.04, -0.02, -0.27], [0.18, 0.02, -0.18], 0.028, M.orange);
  k.rod(head, [0.18, 0.02, -0.18], [0.21, 0.3, -0.14], 0.028, M.orange);
  k.rod(head, [0.21, 0.3, -0.14], [0.2, 0.52, -0.1], 0.028, M.orange);
  k.add(head, cyl(0.045, 0.045, 0.07, 12), M.orange, { x: 0.2, y: 0.56, z: -0.1 });
  if (kit === "sniper") {
    // A rangefinder over the left eye.
    k.add(head, rbox(0.06, 0.06, 0.12, 0.02), M.dark, { x: -0.2, y: 0.17, z: -0.12 });
    k.add(head, cyl(0.025, 0.025, 0.01, 10).rotateX(Math.PI / 2), M.red, { x: -0.2, y: 0.17, z: -0.185 });
  }

  // The backpack. Nobody knows why it's this big.
  const pack = { y: 0.48, z: 0.56, w: 0.95, h: 1.32, d: 0.72 };
  k.add(torso, rbox(pack.w, pack.h, pack.d, 0.12), M.pack, { y: pack.y, z: pack.z });
  for (const y of [pack.y - 0.4, pack.y + 0.42]) k.add(torso, rbox(pack.w + 0.03, 0.06, pack.d + 0.03, 0.03), trim, { y, z: pack.z });
  for (let i = 0; i < 5; i++) k.add(torso, box(0.5, 0.035, 0.04), M.dark, { y: pack.y - 0.15 + i * 0.07, z: pack.z + pack.d / 2 + 0.01 }); // vents
  k.pair(torso, () => cyl(0.11, 0.11, 0.9, 14), M.armour, { x: pack.w / 2 + 0.06, y: pack.y + 0.05, z: pack.z + 0.1 }); // canisters
  k.pair(torso, () => cyl(0.115, 0.115, 0.05, 14), trim, { x: pack.w / 2 + 0.06, y: pack.y + 0.5, z: pack.z + 0.1 });
  k.pair(torso, () => cyl(0.115, 0.115, 0.05, 14), trim, { x: pack.w / 2 + 0.06, y: pack.y - 0.4, z: pack.z + 0.1 });
  const top = pack.y + pack.h / 2;
  k.add(torso, rbox(0.42, 0.18, 0.3, 0.05), M.armour, { x: -0.18, y: top + 0.08, z: pack.z - 0.05 }); // radio
  for (const x of [-0.3, -0.2, -0.1]) k.add(torso, cyl(0.025, 0.025, 0.05, 8), M.gun, { x, y: top + 0.19, z: pack.z - 0.12 });
  k.add(torso, ball(0.035, 8, 6), M.green, { x: -0.06, y: top + 0.17, z: pack.z + 0.06 });
  k.add(torso, cyl(0.16, 0.04, 0.08, 16), M.trim, { x: 0.24, y: top + 0.15, z: pack.z + 0.15, rx: -0.5 }); // dish
  k.rod(torso, [0.24, top, pack.z + 0.15], [0.24, top + 0.12, pack.z + 0.15], 0.02, M.gun);
  // Antennas, two joints each so they bend as they wobble.
  const antennas: [number, number, number][] = [[-0.35, 2.6, 0.38], [0.05, 3.4, 0.74], [0.36, 1.9, 0.5]];
  antennas.forEach(([x, h, z], i) => {
    const base = k.joint(`ant${i}`, torso, x, top, z);
    k.add(base, cyl(0.05, 0.06, 0.1, 10), M.gun, { y: 0.05 });
    k.add(base, cyl(0.016, 0.026, h / 2, 6), M.dark, { y: h / 4 });
    k.add(base, ring(0.03, 0.01, 8).rotateX(Math.PI / 2), trim, { y: h / 4 });
    const mid = k.joint(`ant${i}b`, base, 0, h / 2, 0);
    k.add(mid, cyl(0.009, 0.016, h / 2, 6), M.dark, { y: h / 4 });
    k.add(mid, ball(0.055, 10, 8), M.red, { y: h / 2 });
    if (hero && i === 1) k.add(mid, new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0, 0.12), new THREE.Vector2(0.4, 0), new THREE.Vector2(0, -0.12)])), M.pennant, { y: h / 2 - 0.22, ry: Math.PI / 2 }); // the hero's pennant
  });
  if (kit === "engineer") {
    // An orange toolbox strapped to the pack, a wrench, and a coil of cable.
    k.add(torso, rbox(0.7, 0.36, 0.3, 0.05), M.orange, { y: pack.y - 0.48, z: pack.z + 0.42 });
    k.add(torso, ring(0.09, 0.02, 12, Math.PI), M.dark, { y: pack.y - 0.3, z: pack.z + 0.42 });
    k.rod(torso, [-0.55, pack.y - 0.3, pack.z], [-0.55, pack.y + 0.4, pack.z], 0.03, M.gun);
    k.add(torso, ring(0.08, 0.025, 12, Math.PI * 1.5), M.gun, { x: -0.55, y: pack.y + 0.48, z: pack.z, ry: Math.PI / 2 });
    k.add(torso, ring(0.14, 0.03, 16), M.orange, { x: 0.55, y: pack.y - 0.2, z: pack.z + 0.2, ry: Math.PI / 2 });
  }

  // Arms: shoulder → elbow, each with a pauldron.
  const shoulders: Record<"L" | "R", THREE.Object3D[]> = { L: [], R: [] };
  for (const s of [-1, 1]) {
    const side = s < 0 ? "L" : "R";
    const arm = k.joint(`arm${side}`, torso, s * 0.46, 0.54, -0.02);
    // The pauldron sits on the torso, so it stays put while the arm aims.
    k.add(torso, dome(0.27, 18), M.armour, { x: s * 0.48, y: 0.58, z: -0.02, rz: -s * 0.35, s: [1, 0.8, 1.1] });
    k.add(torso, ring(0.265, 0.03, 18).rotateX(Math.PI / 2), trim, { x: s * 0.48, y: 0.58, z: -0.02, rz: -s * 0.35, s: [1, 1, 1.1] });
    k.add(torso, cone(0.045, 0.2, 6), M.gold, { x: s * 0.52, y: 0.8, z: -0.02, rz: -s * 0.5 });  // a spike on each, for the meme
    k.add(arm, capsule(0.08, ARM[0]), M.suit, { y: -ARM[0] / 2 });
    k.add(arm, rbox(0.15, 0.17, 0.16, 0.05), M.armour, { y: -0.17 });
    const elbow = k.joint(`elbow${side}`, arm, 0, -ARM[0], 0);
    k.add(elbow, capsule(0.072, ARM[1]), M.suit, { y: -ARM[1] / 2 });
    k.add(elbow, rbox(0.14, 0.17, 0.15, 0.05), M.armour, { y: -0.13 });
    k.add(elbow, rbox(0.15, 0.04, 0.16, 0.015), trim, { y: -0.04 });
    k.add(elbow, rbox(0.1, 0.11, 0.12, 0.04), M.rubber, { y: -ARM[1] - 0.02 });       // glove
    shoulders[side] = [arm, elbow];
  }

  // The gun, and both hands on it.
  const heavy = kit === "heavy";
  const gun = k.joint("gun", torso, heavy ? 0.3 : 0.08, heavy ? 0.74 : kit === "sniper" ? 0.34 : 0.26, heavy ? -0.02 : -0.16);
  const hands = heavy ? launcher(k, gun, trim) : carbine(k, gun, trim, kit === "sniper");
  const at = (h: V3): V3 => [gun.position.x + h[0], gun.position.y + h[1], gun.position.z + h[2]];
  reach(shoulders.R[0]!, shoulders.R[1]!, at(hands.grip), ARM[0], ARM[1], [1, -0.4, 0.6]);
  reach(shoulders.L[0]!, shoulders.L[1]!, at(hands.fore), ARM[0], ARM[1], [-1, -0.8, 0.3]);
  return k.bake("marine", { hero });
}

export function marine(hero = false, kit: Trooper = "assault") {
  return cloneOf(`marine:${hero}:${kit}`, () => buildMarine(hero, kit));
}

// ============================================================================================
// The Wooka
// ============================================================================================
// Each kind of Wooka carries its own kit: a Chub is bigger with a bigger club, a Sticky has a
// spear and a quiver of more, a Boomie a lit keg on its back, a Shanti a skull mask and a staff
// that glows. Warbur is a silverback, half again as big as a Chub, and twice as mean.
function buildWooka(hero: boolean, role: WookaRole | "warbur" = "fodder") {
  const k = new Kit();
  const body = k.joint("body");
  const warbur = role === "warbur";
  body.scale.setScalar(warbur ? 2.6 : role === "chub" ? 1.4 : hero ? 1.45 : 1); // the chieftain: bigger, and wearing something's bones
  const fur = warbur ? W.silver : W.fur, tuft = (on: THREE.Object3D, n: number, r: number, y: number, z: number, spread: number, len = 0.12) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, tilt = 0.5 + ((i * 37) % 7) / 14;
      k.add(on, cone(0.05, len + ((i * 13) % 5) * 0.02, 5), fur, { x: Math.cos(a) * r, y: y + Math.sin(a * 3) * 0.02, z: z + Math.sin(a) * r * spread, rz: -Math.cos(a) * tilt, rx: Math.sin(a) * tilt * spread });
    }
  };
  // The body: a fat ball of fur with a paler belly, shaggy round the middle.
  k.add(body, lumpy(0.45, 3, 0.1, 1), fur, { y: 0.56, s: [1, 1.05, 0.95] });
  k.add(body, lumpy(0.31, 2, 0.06, 2), W.belly, { y: 0.5, z: -0.22, s: [1, 1.1, 0.5] });
  // A leather strap over one shoulder, with a pouch and a string of teeth.
  k.add(body, ring(0.47, 0.03, 28), W.leather, { y: 0.6, rz: 0.55, ry: Math.PI / 2, s: [1, 1, 0.9] });
  k.add(body, rbox(0.14, 0.12, 0.08, 0.03), W.leather, { x: 0.22, y: 0.36, z: -0.33, rz: 0.4 });
  for (let i = 0; i < 4; i++) k.add(body, cone(0.02, 0.07, 4), W.tooth, { x: -0.16 + i * 0.09, y: 0.76 - i * 0.07, z: -0.42, rx: Math.PI });

  const head = k.joint("head", body, 0, 1.0, -0.02);
  k.add(head, lumpy(0.37, 3, 0.08, 3), fur, { s: [1.06, 0.95, 1] });
  tuft(head, 9, 0.12, 0.3, 0, 1, 0.13);                                     // a tuft on top
  k.add(head, ball(0.25, 18, 12), W.belly, { y: -0.04, z: -0.22, s: [1.2, 1, 0.5] }); // the face, paler
  // The eyes: big, black and glossy, with nothing behind them. A pin of red, if you look.
  for (const s of [-1, 1]) {
    k.add(head, ball(0.125, 20, 14), W.eye, { x: s * 0.14, y: 0.05, z: -0.29, s: [1, 1.15, 0.7] });
    k.add(head, ball(0.026, 8, 6), W.shine, { x: s * 0.14 - 0.04, y: 0.11, z: -0.375 });
    k.add(head, ball(0.012, 6, 4), W.shine, { x: s * 0.14 + 0.03, y: 0.0, z: -0.38 });
    k.add(head, ball(0.012, 6, 4), W.glint, { x: s * 0.14, y: 0.04, z: -0.385 });
    k.add(head, capsule(0.035, 0.17, 6), W.furDark, { x: s * 0.13, y: 0.19, z: -0.31, rz: s * 1.2 }); // a scowl
  }
  k.add(head, ball(0.11, 14, 10), W.belly, { y: -0.1, z: -0.33, s: [1.25, 0.8, 1] }); // snout
  k.add(head, ball(0.045, 10, 8), W.nose, { y: -0.06, z: -0.43, s: [1.3, 0.8, 0.8] });
  k.add(head, rbox(0.13, 0.025, 0.03, 0.01), W.mouth, { y: -0.16, z: -0.4 });
  for (const x of [-0.04, 0.04]) k.add(head, cone(0.018, 0.06, 4), W.tooth, { x, y: -0.185, z: -0.41, rx: Math.PI });
  for (const s of [-1, 1]) {
    const ear = k.joint(s < 0 ? "earL" : "earR", head, s * 0.25, 0.25, 0.02);
    k.add(ear, ball(0.11, 12, 10), fur, { y: 0.03, s: [1, 1, 0.5] });
    k.add(ear, ball(0.07, 10, 8), W.belly, { y: 0.03, z: -0.035, s: [1, 1, 0.3] });
  }

  // Stubby arms; the right one holds the club.
  for (const s of [-1, 1]) {
    const side = s < 0 ? "L" : "R";
    const arm = k.joint(`arm${side}`, body, s * 0.39, 0.74, -0.04);
    arm.rotation.z = s * 0.35;
    k.add(arm, capsule(0.09, 0.32, 8), fur, { y: -0.13 });
    k.add(arm, ball(0.085, 10, 8), warbur ? W.silverDark : W.furDark, { y: -0.28 });
    if (s < 0 && role === "shanti") {
      // The staff, topped with something that glows.
      const staff = k.joint("staff", arm, 0, -0.28, -0.02);
      k.add(staff, cyl(0.025, 0.03, 1.3, 6), W.wood, { y: 0.3 });
      k.add(staff, ball(0.1, 10, 8), W.hex, { y: 0.98 });
      for (let i = 0; i < 3; i++) k.add(staff, cone(0.02, 0.12, 4), W.bone, { y: 0.92, rz: (i - 1) * 0.9 });
    }
    if (s > 0 && role === "sticky") {
      // A spear: a long shaft with a knapped stone point.
      const club = k.joint("club", arm, 0, -0.28, -0.02);
      club.rotation.x = 0.45;
      k.add(club, cyl(0.02, 0.025, 1.4, 6), W.wood, { y: 0.3 });
      k.add(club, cone(0.05, 0.2, 5), W.bone, { y: 1.08 });
      k.add(club, ring(0.03, 0.01, 8).rotateX(Math.PI / 2), W.rope, { y: 0.96 });
    } else if (s > 0 && role !== "boomie" && role !== "shanti") {
      const club = k.joint("club", arm, 0, -0.28, -0.02);
      club.rotation.x = 0.45; // up over the shoulder
      if (role === "chub" || warbur) club.scale.setScalar(1.5);
      k.add(club, cyl(0.035, 0.045, 0.62, 8), W.wood, { y: 0.15 });
      for (const y of [-0.04, 0.02, 0.08]) k.add(club, ring(0.045, 0.012, 10).rotateX(Math.PI / 2), W.rope, { y });
      k.add(club, lumpy(0.12, 1, 0.12, 5, false), W.wood, { y: 0.52, s: [0.9, 1.6, 0.9] });
      // The nail. On purpose. The chieftain's club has bones in it as well.
      k.add(club, cone(0.018, 0.2, 5), W.nail, { x: 0.12, y: 0.58, rz: -Math.PI / 2 });
      k.add(club, cyl(0.03, 0.03, 0.015, 8), W.nail, { x: 0.03, y: 0.58, rz: Math.PI / 2 });
      if (hero) for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.6;
        k.add(club, cone(0.03, 0.18, 5), W.bone, { x: Math.cos(a) * 0.12, y: 0.5 + i * 0.04, z: Math.sin(a) * 0.12, rz: -Math.cos(a) * 1.3, rx: Math.sin(a) * 1.3 });
      }
    }
  }
  // Dishevelled: matted tufts sticking out every which way, burrs and twigs caught in the fur, a
  // lopsided pointy cap (the woodland-critter look), one ear bent over, a snaggletooth.
  if (role !== "shanti" && !hero) {
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4, up = 0.15 + ((i * 7) % 5) * 0.1;
      k.add(body, cone(0.06, 0.2 + (i % 3) * 0.06, 5), fur, { x: Math.cos(a) * 0.4, y: 0.5 + Math.sin(i * 1.7) * 0.28, z: Math.sin(a) * 0.38, rz: -Math.cos(a) * (1.1 + up), rx: Math.sin(a) * (1.1 + up) });
    }
    for (let i = 0; i < 3; i++) k.rod(body, [0.3 - i * 0.3, 0.55 + i * 0.1, 0.33], [0.4 - i * 0.35, 0.72 + i * 0.12, 0.45], 0.012, W.wood, 4); // twigs in the back fur
    for (const [x, y, z] of [[-0.3, 0.7, -0.33], [0.25, 0.45, -0.38], [-0.1, 0.3, 0.4]] as V3[]) k.add(body, lumpy(0.05, 1, 0.3, 4, false), W.furDark, { x, y, z }); // burrs
    if (role === "fodder" || role === "sticky") {
      // The cap flops over to one side, its bobble hanging off the end.
      const capMat = role === "sticky" ? W.paint : W.hideDark;
      k.add(head, cone(0.19, 0.4, 8), capMat, { x: 0.12, y: 0.31, z: 0.02, rz: -0.95 });
      k.add(head, ring(0.2, 0.04, 12).rotateX(Math.PI / 2), W.rope, { y: 0.24, x: 0.02, rz: 0.1 });
      k.add(head, ball(0.06, 8, 6), W.bone, { x: 0.38, y: 0.17, z: 0.02 });
    }
    k.add(head, cone(0.02, 0.07, 4), W.tooth, { x: -0.07, y: -0.16, z: -0.41, rx: Math.PI, rz: 0.2 }); // snaggletooth
  }
  // War flags, the Wooka's answer to the Marines' antennas: a pole lashed to the back with a ragged
  // hide banner that streams and flaps. Chubs, Stickies and the champions carry one; Warbur's is huge.
  if (role === "chub" || role === "sticky" || warbur || hero) {
    const h = warbur ? 2.3 : role === "chub" ? 1.9 : 1.5, w = warbur ? 1.1 : 0.6;
    const pole = k.joint("flag", body, 0.15, 0.5, 0.4);
    k.add(pole, cyl(0.025, 0.035, h, 6), W.wood, { y: h / 2 });
    k.add(pole, cone(0.045, 0.14, 5), W.bone, { y: h + 0.07 });
    const cloth = k.joint("flagB", pole, 0, h - 0.08, 0);
    const rag = new THREE.Shape([new THREE.Vector2(0, 0.0), new THREE.Vector2(w * 0.5, 0.04), new THREE.Vector2(w, -0.02), new THREE.Vector2(w * 0.8, -0.14), new THREE.Vector2(w, -0.28), new THREE.Vector2(w * 0.55, -0.24), new THREE.Vector2(w * 0.3, -0.34), new THREE.Vector2(0, -0.3)]);
    k.add(cloth, new THREE.ShapeGeometry(rag), role === "sticky" ? W.hideDark : W.hide, { ry: Math.PI / 2 });
    k.add(cloth, ball(0.07, 8, 6), W.bone, { z: -w * 0.45, y: -0.15, s: [1, 1.1, 0.5] }); // a skull sewn on
  }
  // Feet.
  for (const s of [-1, 1]) {
    const foot =k.joint(s < 0 ? "footL" : "footR", body, s * 0.19, 0.2, 0);
    k.add(foot, capsule(0.1, 0.22, 8), fur, { y: -0.04 });
    k.add(foot, ball(0.12, 12, 8), W.furDark, { y: -0.13, z: -0.06, s: [1, 0.55, 1.4] });
    for (const x of [-0.05, 0, 0.05]) k.add(foot, ball(0.035, 6, 4), W.furDark, { x, y: -0.16, z: -0.21 });
  }

  if (role === "sticky") for (let i = 0; i < 3; i++) k.rod(body, [-0.15 + i * 0.08, 0.5, 0.35], [-0.25 + i * 0.1, 1.35, 0.45], 0.015, W.wood, 4); // the quiver
  if (role === "boomie") {
    // A keg of powder on its back, the fuse lit, and a red rag round its head.
    k.add(body, cyl(0.22, 0.22, 0.45, 10), W.powder, { y: 0.7, z: 0.38, rx: 0.2 });
    for (const y of [0.55, 0.85]) k.add(body, ring(0.225, 0.015, 12).rotateX(Math.PI / 2), W.rope, { y, z: 0.38 });
    k.add(body, ball(0.06, 6, 4), W.fire, { y: 1.0, z: 0.42 });
    k.add(head, ring(0.36, 0.04, 16).rotateX(Math.PI / 2), W.paint, { y: 0.12 });
  }
  if (role === "shanti") {
    // A skull for a mask, and a mantle of grey.
    k.add(head, ball(0.2, 12, 10), W.bone, { y: 0.02, z: -0.28, s: [1.1, 1.1, 0.6] });
    for (const x of [-0.08, 0.08]) k.add(head, ball(0.05, 8, 6), W.hex, { x, y: 0.05, z: -0.39 });
    k.add(body, lumpy(0.3, 2, 0.15, 9), W.chief, { y: 0.86, z: 0.08, s: [1.6, 0.6, 1.3] });
  }
  if (role === "chub") for (let i = 0; i < 5; i++) k.add(body, cone(0.04, 0.16, 5), W.tooth, { x: -0.24 + i * 0.12, y: 0.82 - Math.abs(i - 2) * 0.04, z: -0.4, rx: Math.PI });
  if (warbur) {
    // The troll: hunched, tusked, a bandolier of spears across his back and a skull or two on a belt.
    body.rotation.x = 0.18;
    for (const x of [-1, 1]) k.add(head, cone(0.06, 0.28, 6), W.tooth, { x: x * 0.09, y: -0.12, z: -0.4, rx: Math.PI - 0.5, rz: x * 0.15 }); // tusks
    k.add(head, lumpy(0.13, 1, 0.1, 17), W.silverDark, { x: 0.2, y: 0.28, z: -0.1, s: [1, 0.6, 1] });   // a heavy brow
    for (let i = 0; i < 4; i++) {
      const dx = -0.3 + i * 0.2;
      k.rod(body, [dx, 0.2, 0.42], [dx + 0.18, 1.7, 0.5], 0.03, W.wood, 5);              // a spear slung on his back
      k.add(body, cone(0.06, 0.25, 5), W.bone, { x: dx + 0.18, y: 1.78, z: 0.5, rz: -0.1 });
    }
    for (let i = 0; i < 3; i++) k.add(body, ball(0.06, 8, 6), W.bone, { x: -0.25 + i * 0.25, y: 0.3, z: -0.42 }); // skulls on a belt
  }
  if (warbur) {
    // A silverback's mane, and scars.
    k.add(body, lumpy(0.32, 2, 0.2, 13), W.silverDark, { y: 0.9, z: 0.1, s: [1.8, 0.7, 1.5] });
    for (const dz of [0, 0.06]) k.add(body, rbox(0.3, 0.02, 0.02, 0.005), W.paint, { x: 0.1, y: 0.62 + dz, z: -0.43, rz: 0.5 });
  }
  if (hero) {
    // A mantle of grey fur, a crown of bones, red paint across the eyes, and a necklace of skulls.
    k.add(body, lumpy(0.3, 2, 0.15, 9), W.chief, { y: 0.86, z: 0.08, s: [1.7, 0.6, 1.4] });
    for (let i = 0; i < 7; i++) {
      const a = -1.2 + (i / 6) * 2.4;
      k.add(head, cone(0.04, 0.34 + (i % 2) * 0.1, 5), W.bone, { x: Math.sin(a) * 0.3, y: 0.38 + Math.cos(a) * 0.03, z: -Math.cos(a) * 0.1, rz: -Math.sin(a) * 0.5 });
    }
    for (const s of [-1, 1]) for (const dy of [0, -0.05]) k.add(head, rbox(0.1, 0.025, 0.04, 0.01), W.paint, { x: s * 0.27, y: -0.05 + dy, z: -0.25, ry: s * 0.6 });
    for (let i = 0; i < 5; i++) {
      const a = Math.PI + (i - 2) * 0.45;
      const x = Math.sin(a) * 0.3, z = Math.cos(a) * 0.26;
      k.add(body, ball(0.055, 10, 8), W.bone, { x, y: 0.78 - Math.abs(i - 2) * 0.03, z });
      k.add(body, ball(0.014, 6, 4), W.nose, { x: x - 0.02, y: 0.79 - Math.abs(i - 2) * 0.03, z: z - 0.05 });
      k.add(body, ball(0.014, 6, 4), W.nose, { x: x + 0.02, y: 0.79 - Math.abs(i - 2) * 0.03, z: z - 0.05 });
    }
  }
  return k.bake("wooka", { hero });
}

export function wooka(hero = false, role: WookaRole | "warbur" = "fodder") {
  return cloneOf(`wooka:${hero}:${role}`, () => (role === "mossback" ? buildMossback() : buildWooka(hero, role)));
}

// The Mossback: a Wooka that kept growing. Big as a Marine from the shoulder, mangy and
// matted, with moss in the back of its coat and bald scabs where it doesn't take, arms so long
// the knuckles drag, and a heavy brow over small red eyes. It lopes on its fists. Its arms are
// two joints each (upper arm, forearm), so it can swing them down and stretch them out in a leap.
function buildMossback() {
  const k = new Kit();
  const body = k.joint("body", k.root, 0, 1.0, 0);
  body.rotation.x = -0.45; // hunched over, head forward
  k.add(body, lumpy(0.8, 3, 0.16, 21), W.mange, { y: 0.6, s: [1.2, 1.1, 1.05] });                    // the great matted chest
  k.add(body, lumpy(0.55, 2, 0.12, 22), W.mangeLight, { y: 0.2, z: -0.38, s: [1.1, 1, 0.55] });     // a paler belly
  k.add(body, lumpy(0.62, 2, 0.14, 23), W.mange, { y: 0.0, z: 0.28, s: [1.1, 0.9, 1] });             // the haunches
  // Moss on the shoulders and the back, in clumps, and strands of it hanging off.
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2, r = 0.5 + ((i * 37) % 5) * 0.05;
    k.add(body, lumpy(0.17 + ((i * 13) % 4) * 0.03, 1, 0.25, 30 + i), i % 3 ? W.moss : W.mossDark, { x: Math.cos(a) * r * 1.1, y: 0.95 + Math.sin(a * 2) * 0.12, z: 0.22 + Math.sin(a) * r * 0.7, s: [1, 0.6, 1] });
  }
  for (let i = 0; i < 6; i++) k.rod(body, [-0.6 + i * 0.24, 1.05, 0.5], [-0.65 + i * 0.26, 0.45 - (i % 2) * 0.2, 0.62], 0.025, W.moss, 4);
  // Bald scabs where the coat gave out.
  for (const [x, y, z] of [[0.45, 0.7, -0.55], [-0.5, 0.35, -0.5], [0.3, 0.1, 0.62]] as const) k.add(body, lumpy(0.2, 1, 0.1, 40 + x), W.skin, { x, y, z, s: [1.2, 1, 0.4] });
  // Head, low and forward: a brow like a shelf, small red eyes under it, an underbite with tusks.
  const head = k.joint("head", body, 0, 1.15, -0.6);
  head.rotation.x = 0.5; // it carries it level though the body leans
  k.add(head, lumpy(0.42, 3, 0.1, 25), W.mange, { s: [1.1, 0.95, 1.05] });
  k.add(head, rbox(0.8, 0.16, 0.3, 0.05), W.mangeLight, { y: 0.1, z: -0.3, rx: 0.1 });              // the brow
  k.add(head, ball(0.2, 14, 10), W.skin, { y: -0.08, z: -0.36, s: [1.3, 0.8, 0.7] });                // the muzzle
  for (const s of [-1, 1]) {
    k.add(head, ball(0.065, 10, 8), W.eye, { x: s * 0.17, y: 0.0, z: -0.4 });
    k.add(head, ball(0.025, 6, 4), W.glint, { x: s * 0.17, y: 0.0, z: -0.45 });
    k.add(head, cone(0.04, 0.32, 6), W.tooth, { x: s * 0.16, y: -0.2, z: -0.5, rx: -0.2, rz: -s * 0.1 }); // tusks
    k.add(head, lumpy(0.1, 1, 0.2, 50 + s), W.mange, { x: s * 0.4, y: 0.15, z: 0.0, s: [0.7, 1, 0.5] });  // ears, chewed
  }
  k.add(head, rbox(0.34, 0.1, 0.2, 0.03), W.mouth, { y: -0.22, z: -0.42 });
  for (let i = 0; i < 5; i++) k.add(head, cone(0.018, 0.07, 4), W.tooth, { x: -0.12 + i * 0.06, y: -0.19, z: -0.5, rx: Math.PI });
  for (let i = 0; i < 4; i++) k.add(head, lumpy(0.1, 1, 0.25, 60 + i), W.moss, { x: -0.2 + i * 0.13, y: 0.4, z: 0.05, s: [1, 0.6, 1] }); // moss on the crown
  // Arms: long. Upper arm from the shoulder, forearm from the elbow, a fist with knuckles at the end.
  for (const s of [-1, 1]) {
    const side = s < 0 ? "L" : "R";
    const arm = k.joint(`arm${side}`, body, s * 0.98, 1.0, -0.05);
    arm.rotation.z = s * 0.1;
    k.add(arm, lumpy(0.3, 2, 0.12, 70 + s), W.mange, { y: 0.0, s: [1.1, 1, 1] });                       // the shoulder
    k.add(arm, capsule(0.2, 1.0, 8), W.mange, { y: -0.48 });
    k.add(arm, lumpy(0.2, 1, 0.3, 80 + s), W.moss, { x: s * 0.08, y: -0.1, z: 0.1, s: [1, 0.6, 1] });
    const fore = k.joint(`fore${side}`, arm, 0, -0.95, 0);
    k.add(fore, capsule(0.17, 0.8, 8), W.mangeLight, { y: -0.4 });
    k.add(fore, lumpy(0.27, 2, 0.1, 90 + s), W.skin, { y: -0.85, s: [1, 0.9, 1.1] });                       // the fist
    for (const x of [-0.12, 0, 0.12]) k.add(fore, ball(0.07, 6, 4), W.bone, { x, y: -1.05, z: -0.1 });  // knuckles
  }
  // Legs: short, bowed, big in the thigh.
  for (const s of [-1, 1]) {
    const leg = k.joint(s < 0 ? "legL" : "legR", k.root, s * 0.42, 0.85, 0.1);
    k.add(leg, capsule(0.27, 0.85, 8), W.mange, { y: -0.3, rz: -s * 0.1 });
    k.add(leg, ball(0.3, 12, 8), W.furDark, { y: -0.74, z: -0.1, s: [1, 0.5, 1.5] });
  }
  k.root.scale.setScalar(0.85);
  return k.bake("mossback", {});
}

// ============================================================================================
// Vehicles and fortifications. All Marine-built: the Wooka's share comes as more Wooka.
// ============================================================================================
function buildTank() {
  const k = new Kit();
  const hull = k.joint("hull");
  // Tracks: a belt each side, road wheels, sprocket and idler, and a mudguard.
  for (const s of [-1, 1]) {
    const x = s * 1.35;
    k.add(hull, profile([[-2.55, 0.35], [-2.2, 0.95], [2.2, 0.95], [2.6, 0.45], [2.25, 0.05], [-2.2, 0.05]], 0.7), M.rubber, { x });
    for (let i = 0; i < 5; i++) k.add(hull, cyl(0.32, 0.32, 0.74, 14).rotateZ(Math.PI / 2), M.gun, { x, y: 0.38, z: -1.6 + i * 0.8 });
    for (let i = 0; i < 5; i++) k.add(hull, cyl(0.14, 0.14, 0.76, 10).rotateZ(Math.PI / 2), M.dark, { x, y: 0.38, z: -1.6 + i * 0.8 });
    for (let i = 0; i < 20; i++) k.add(hull, box(0.72, 0.05, 0.1), M.dark, { x, y: 0.96, z: -2.1 + i * 0.22 }); // track links
    k.add(hull, rbox(0.82, 0.08, 5.3, 0.03), M.armour, { x, y: 1.06 });
    k.add(hull, box(0.04, 0.09, 5.32), M.trim, { x: x + s * 0.42, y: 1.06 });
  }
  // The hull: a sloped glacis up front, white trim, engine deck behind.
  k.add(hull, profile([[-2.6, 0.55], [-1.6, 1.55], [2.3, 1.55], [2.55, 1.2], [2.5, 0.5], [-2.3, 0.4]], 2.0, 0.05), M.armour);
  k.add(hull, profile([[-2.15, 1.08], [-2.05, 1.18], [-1.95, 1.08], [-2.05, 0.98]], 2.08), M.trim);
  k.add(hull, profile([[-1.6, 1.55], [2.3, 1.55], [2.3, 1.45], [-1.5, 1.45]], 2.04), M.trim);
  for (let i = 0; i < 4; i++) k.add(hull, box(1.4, 0.04, 0.12), M.dark, { y: 1.57, z: 1.2 + i * 0.25 }); // engine grille
  k.pair(hull, () => cyl(0.14, 0.14, 0.12, 12).rotateX(Math.PI / 2), M.engine, { x: 0.55, y: 1.0, z: 2.53 }); // exhausts glowing
  k.pair(hull, () => ball(0.1, 10, 8), M.lens, { x: 0.8, y: 1.15, z: -2.35 });      // headlights

  const turret = k.joint("turret", hull, 0, 1.55, 0.3);
  k.add(turret, slab([[-0.6, -1.25], [0.6, -1.25], [1.1, -0.6], [1.1, 0.95], [-1.1, 0.95], [-1.1, -0.6]], 0.75, 0.08), M.armour, { y: 0.38 });
  k.add(turret, slab([[-0.62, -1.27], [0.62, -1.27], [1.12, -0.62], [1.12, 0.97], [-1.12, 0.97], [-1.12, -0.62]], 0.08), M.trim, { y: 0.55 });
  k.add(turret, cyl(0.35, 0.38, 0.15, 16), M.armour, { x: 0.45, y: 0.82, z: 0.35 });    // hatch
  k.add(turret, rbox(0.25, 0.2, 0.3, 0.05), M.gun, { x: -0.6, y: 0.85, z: 0.2 });      // sensor
  k.add(turret, box(0.2, 0.08, 0.02), M.red, { x: -0.6, y: 0.88, z: 0.04 });
  k.rod(turret, [0.65, 0.85, 0.6], [0.65, 2.6, 0.75], 0.02, M.dark);
  k.add(turret, ball(0.05, 8, 6), M.red, { x: 0.65, y: 2.6, z: 0.75 });
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) k.add(turret, cyl(0.06, 0.06, 0.25, 8).rotateX(-1.1), M.gun, { x: s * (0.8 + i * 0.1), y: 0.7, z: -0.95 + i * 0.05 }); // smoke launchers
  const barrel = k.joint("barrel", turret, 0, 0.4, -1.2);
  k.add(barrel, rbox(0.55, 0.45, 0.4, 0.08), M.armour, { z: 0 });                     // mantlet
  k.add(barrel, cyl(0.13, 0.15, 3.0, 14).rotateX(Math.PI / 2), M.gun, { z: -1.6 });
  k.add(barrel, cyl(0.2, 0.2, 0.5, 14).rotateX(Math.PI / 2), M.gun, { z: -1.2 });   // fume extractor
  k.add(barrel, rbox(0.38, 0.22, 0.4, 0.05), M.gun, { z: -3.15 });                  // muzzle brake
  k.add(barrel, box(0.4, 0.05, 0.3), M.trim, { y: 0.06, z: -1.2 });
  return k.bake("tank");
}
export const tank = () => cloneOf("tank", buildTank);

const WALKER_BEND = 0.5;
// A two-legged walker: a cockpit high on long legs that bend back at the knee, with chin guns.
function buildWalker() {
  const k = new Kit();
  const body = k.joint("body", k.root, 0, 0.7 + 4.8 * Math.cos(WALKER_BEND) + 0.5, 0);
  k.add(body, profile([[-2.3, 0.2], [-1.6, 1.2], [1.4, 1.3], [2.0, 0.6], [1.8, -0.8], [-1.6, -0.9], [-2.3, -0.3]], 2.8, 0.1), M.armour, { y: 0.6 });
  k.add(body, profile([[-2.36, 0.25], [-1.62, 1.3], [-1.55, 1.2], [-2.25, 0.25]], 2.84), M.trim, { y: 0.6 });
  k.add(body, profile([[-2.4, 0.3], [-2.12, 0.7], [-2.04, 0.7], [-2.32, 0.3]], 2.0), M.glass, { y: 0.6 }); // the viewport, proud of the slope
  k.add(body, rbox(3.0, 0.2, 3.6, 0.06), M.trim, { y: -0.35 });
  k.pair(body, () => rbox(0.1, 0.9, 2.2, 0.04), M.pack, { x: 1.42, y: 0.8, z: 0.3 });   // side hatches
  k.pair(body, () => box(0.12, 0.08, 2.4), M.trim, { x: 1.43, y: 1.35, z: 0.3 });
  k.pair(body, () => cyl(0.2, 0.2, 0.1, 10).rotateZ(Math.PI / 2), M.gun, { x: 1.45, y: 0.8, z: -0.4 });
  for (let i = 0; i < 3; i++) k.pair(body, () => box(0.12, 0.06, 0.6), M.dark, { x: 1.43, y: 0.1 + i * 0.12, z: 1.4 });
  for (const s of [-1, 1]) {
    k.add(body, rbox(0.5, 0.5, 1.4, 0.1), M.gun, { x: s * 1.0, y: -0.6, z: -1.6 });           // gun pods
    k.rod(body, [s * 1.0, -0.6, -2.2], [s * 1.0, -0.6, -3.6], 0.1, M.dark);
    k.add(body, cyl(0.16, 0.16, 0.3, 10).rotateX(Math.PI / 2), M.dark, { x: s * 1.0, y: -0.6, z: -3.6 });
    k.add(body, ball(0.12, 10, 8), M.red, { x: s * 1.2, y: 0.9, z: -1.9 });
  }
  k.add(body, cyl(0.4, 0.4, 2.8, 12).rotateZ(Math.PI / 2), M.gun, { y: -0.7, z: 0.4 });  // hip axle
  for (let i = 0; i < 4; i++) k.add(body, box(2.2, 0.06, 0.12), M.dark, { y: 1.85, z: 0.2 + i * 0.3 });
  k.rod(body, [0.9, 1.9, 1.2], [0.9, 4.2, 1.5], 0.04, M.dark);                         // a mast: it's a Marine machine
  k.add(body, ball(0.12, 8, 6), M.red, { x: 0.9, y: 4.2, z: 1.5 });
  for (const s of [-1, 1]) {
    const side = s < 0 ? "L" : "R";
    const leg = k.joint(`leg${side}`, body, s * 1.55, -0.7, 0.4);
    k.add(leg, cyl(0.55, 0.55, 0.4, 16).rotateZ(Math.PI / 2), M.armour);
    k.add(leg, rbox(0.45, 2.3, 0.7, 0.12), M.armour, { y: -1.15, z: -0.1 });
    k.add(leg, box(0.12, 1.6, 0.06), M.trim, { y: -1.1, z: -0.47 });
    k.rod(leg, [0, -0.3, 0.45], [0, -2.0, 0.5], 0.09, M.gun);                         // a piston
    const knee = k.joint(`knee${side}`, leg, 0, -2.4, -0.1);
    k.add(knee, cyl(0.38, 0.38, 0.5, 14).rotateZ(Math.PI / 2), M.gun);
    k.add(knee, rbox(0.38, 2.4, 0.55, 0.1), M.armour, { y: -1.2 });
    const ankle = k.joint(`ankle${side}`, knee, 0, -2.4, 0);
    k.add(ankle, cyl(0.25, 0.25, 0.42, 12).rotateZ(Math.PI / 2), M.gun);
    k.add(ankle, slab([[-0.5, -1.0], [0.5, -1.0], [0.6, 0.4], [-0.6, 0.4]], 0.3, 0.05), M.armour, { y: -0.35, z: -0.1 });
    k.add(ankle, slab([[-0.52, -1.05], [0.52, -1.05], [0.52, -0.8], [-0.52, -0.8]], 0.32), M.trim, { y: -0.35, z: -0.1 });
    for (const x of [-0.35, 0, 0.35]) k.add(ankle, cone(0.12, 0.35, 6).rotateX(-Math.PI / 2), M.gun, { x, y: -0.4, z: -1.2 }); // toes
  }
  // Hip → knee 2.4, knee → ankle 2.4, ankle → sole 0.5: it stands on y = 0 with its knees bent.
  for (const side of ["L", "R"]) {
    k.root.getObjectByName(`leg${side}`)!.rotation.x = WALKER_BEND;
    k.root.getObjectByName(`knee${side}`)!.rotation.x = -2 * WALKER_BEND;
    k.root.getObjectByName(`ankle${side}`)!.rotation.x = WALKER_BEND;
  }
  return k.bake("walker");
}
export function walker() {
  const g = cloneOf("walker", buildWalker);
  return g;
}

// A speeder: a long, low bike that floats a metre up, steering vanes out front, a rider.
function buildSpeeder() {
  const k = new Kit();
  const bike = k.joint("bike", k.root, 0, 1.0, 0);
  k.add(bike, profile([[-1.0, 0.05], [-0.7, 0.32], [1.2, 0.35], [1.9, 0.15], [1.8, -0.25], [-0.8, -0.25]], 0.75, 0.06), M.armour);
  k.add(bike, profile([[-0.98, 0.1], [-0.68, 0.36], [1.2, 0.39], [1.2, 0.34], [-0.7, 0.31]], 0.78), M.trim);
  k.add(bike, cyl(0.28, 0.3, 0.6, 14).rotateX(Math.PI / 2), M.gun, { y: -0.05, z: 1.85 });  // engine
  k.add(bike, cyl(0.22, 0.22, 0.02, 14).rotateX(Math.PI / 2), M.engine, { y: -0.05, z: 2.16 });
  k.add(bike, cone(0.2, 0.9, 12).rotateX(-Math.PI / 2), M.plume, { y: -0.05, z: 2.6 });
  for (const s of [-1, 1]) {
    k.rod(bike, [s * 0.25, 0.1, -0.9], [s * 0.35, 0.05, -2.6], 0.04, M.gun);             // forks
    k.add(bike, rbox(0.06, 0.5, 0.9, 0.03), M.armour, { x: s * 0.42, y: 0.0, z: -2.7 }); // steering vanes
    k.add(bike, box(0.065, 0.06, 0.92), M.trim, { x: s * 0.42, y: 0.25, z: -2.7 });
  }
  k.add(bike, rbox(0.25, 0.18, 0.5, 0.05), M.dark, { y: 0.4, z: 0.35 });                // seat
  k.rod(bike, [-0.4, 0.55, -0.6], [0.4, 0.55, -0.6], 0.03, M.gun);                      // handlebars
  k.add(bike, rbox(0.3, 0.06, 0.2, 0.02), M.glass, { y: 0.48, z: -0.75, rx: -0.6 });
  k.add(bike, box(0.3, 0.1, 0.02), M.red, { y: 0.0, z: 2.17 });
  // The rider, hunched forward with the pack still on.
  const rider = k.joint("rider", bike, 0, 0.4, 0.3);
  k.add(rider, rbox(0.45, 0.45, 0.3, 0.1), M.armour, { y: 0.35, z: -0.05, rx: -0.6 });
  k.add(rider, ball(0.18, 16, 12), M.armour, { y: 0.62, z: -0.35 });
  k.add(rider, ball(0.12, 12, 8), M.glass, { y: 0.6, z: -0.48, s: [1.1, 0.8, 0.5] });
  k.add(rider, rbox(0.6, 0.8, 0.5, 0.1), M.pack, { y: 0.5, z: 0.32, rx: -0.4 });
  k.add(rider, box(0.62, 0.05, 0.52), M.trim, { y: 0.75, z: 0.25, rx: -0.4 });
  k.rod(rider, [0.2, 0.8, 0.4], [0.3, 2.4, 0.9], 0.015, M.dark);
  k.add(rider, ball(0.04, 8, 6), M.red, { x: 0.3, y: 2.4, z: 0.9 });
  for (const s of [-1, 1]) {
    k.rod(rider, [s * 0.22, 0.45, -0.05], [s * 0.38, 0.18, -0.85], 0.07, M.suit);         // arms to the bars
    k.rod(rider, [s * 0.15, 0.05, 0.05], [s * 0.3, -0.15, -0.4], 0.09, M.armour);          // legs
  }
  return k.bake("speeder");
}
export const speeder = () => cloneOf("speeder", buildSpeeder);

// A gunship: a fat hull with a glass nose, stub wings with an engine pod each that tilts, a chin
// turret and a tail boom.
function buildGunship() {
  const k = new Kit();
  const hull = k.joint("hull");
  k.add(hull, profile([[-3.6, -0.2], [-3.0, 0.7], [-1.2, 1.15], [2.4, 1.0], [5.6, 0.45], [5.8, 0.1], [2.4, -0.7], [-2.6, -1.0]], 2.4, 0.15), M.armour);
  k.add(hull, profile([[-3.62, -0.2], [-3.02, 0.72], [-2.85, 0.8], [-3.45, -0.25]], 2.0), M.trim);
  k.add(hull, profile([[-3.62, 0.0], [-3.08, 0.86], [-1.7, 1.28], [-1.9, 0.3]], 2.0), M.glass);     // canopy
  k.add(hull, rbox(2.66, 0.12, 4.2, 0.05), M.trim, { y: 0.2, z: 0.2 });
  k.add(hull, rbox(0.12, 1.0, 1.2, 0.04), M.dark, { x: 1.25, y: -0.1, z: 0.0 });          // door
  k.add(hull, rbox(0.12, 1.0, 1.2, 0.04), M.dark, { x: -1.25, y: -0.1, z: 0.0 });
  k.add(hull, profile([[4.2, 0.6], [5.6, 2.6], [6.3, 2.6], [5.9, 0.4]], 0.3, 0.04), M.armour); // tail fin
  k.add(hull, profile([[5.45, 2.4], [5.6, 2.62], [6.3, 2.62], [6.24, 2.4]], 0.34), M.trim);
  k.add(hull, slab([[-2.2, 5.2], [2.2, 5.2], [1.8, 6.0], [-1.8, 6.0]], 0.15), M.armour, { y: 0.55 });      // tailplane
  k.pair(hull, () => ball(0.12, 8, 6), M.red, { x: 2.2, y: 0.55, z: 5.6 });
  // Stub wings, and an engine pod on each end that tilts with speed.
  k.add(hull, slab([[-4.2, -0.5], [4.2, -0.5], [4.2, 1.0], [-4.2, 1.0]], 0.28, 0.05), M.armour, { y: 0.35, z: 0.5 });
  k.add(hull, slab([[-4.22, -0.55], [4.22, -0.55], [4.22, -0.35], [-4.22, -0.35]], 0.3), M.trim, { y: 0.35, z: 0.5 });
  for (const s of [-1, 1]) {
    k.add(hull, cyl(0.12, 0.12, 0.8, 8).rotateZ(Math.PI / 2), M.gun, { x: s * 2.5, y: -0.1, z: 0.2 }); // rocket rack
    k.add(hull, rbox(0.5, 0.5, 1.4, 0.1), M.gun, { x: s * 2.8, y: -0.1, z: 0.3 });
    for (const [dx, dy] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]] as const) k.add(hull, cyl(0.07, 0.07, 0.02, 8).rotateX(Math.PI / 2), M.orange, { x: s * 2.8 + dx, y: -0.1 + dy, z: -0.41 });
    const pod = k.joint(s < 0 ? "podL" : "podR", hull, s * 4.4, 0.35, 0.6);
    k.add(pod, cyl(0.62, 0.62, 2.4, 18).rotateX(Math.PI / 2), M.pack);
    k.add(pod, ring(0.63, 0.06, 18), M.trim, { z: -1.1 });
    k.add(pod, cyl(0.5, 0.5, 0.02, 18).rotateX(Math.PI / 2), M.dark, { z: -1.21 });
    k.add(pod, cyl(0.45, 0.45, 0.02, 18).rotateX(Math.PI / 2), M.engine, { z: 1.21 });
    k.add(pod, cone(0.4, 1.6, 14).rotateX(-Math.PI / 2), M.plume, { z: 2.0 });
  }
  const chin = k.joint("chin", hull, 0, -1.0, -2.6);
  k.add(chin, ball(0.45, 14, 10), M.gun);
  for (const x of [-0.12, 0.12]) k.rod(chin, [x, -0.05, -0.3], [x, -0.05, -1.5], 0.06, M.dark);
  return k.bake("gunship");
}
export const gunship = () => cloneOf("gunship", buildGunship);

function buildTurret(f: Faction) {
  const k = new Kit();
  if (f === "wooka") {
    // A rock-chucker: a lashed frame of logs, a throwing arm, and a rock in a hide sling.
    for (const s of [-1, 1]) {
      k.rod(k.root, [s * 0.9, 0, -1.0], [s * 0.7, 2.4, 0], 0.12, W.bark);
      k.rod(k.root, [s * 0.9, 0, 1.0], [s * 0.7, 2.4, 0], 0.12, W.bark);
      k.rod(k.root, [s * 0.9, 0.1, -1.2], [s * 0.9, 0.1, 1.4], 0.14, W.bark);
      k.add(k.root, ring(0.17, 0.04, 10), W.rope, { x: s * 0.7, y: 2.35, ry: Math.PI / 2 });
    }
    k.rod(k.root, [-0.9, 2.4, 0], [0.9, 2.4, 0], 0.1, W.wood);                          // axle
    k.add(k.root, lumpy(0.45, 1, 0.2, 7, false), W.rock, { x: 0, y: 0.45, z: 1.2 });      // counterweight pile
    k.add(k.root, lumpy(0.3, 1, 0.2, 8, false), W.rock, { x: 0.5, y: 0.3, z: 1.4 });
    const arm = k.joint("arm", k.root, 0, 2.4, 0);
    arm.rotation.x = 0.9;
    k.rod(arm, [0, -0.8, 0], [0, 2.4, 0], 0.09, W.wood, 8, 0.07);
    k.add(arm, ball(0.35, 10, 6), W.hide, { y: 2.45, s: [1, 0.4, 1] });
    k.add(arm, lumpy(0.3, 1, 0.25, 4, false), W.rock, { y: 2.65 });
    k.add(arm, lumpy(0.42, 1, 0.2, 11, false), W.rock, { y: -0.95 });
    for (let i = 0; i < 3; i++) k.add(k.root, cone(0.04, 0.4, 4), W.bone, { x: -0.6 + i * 0.6, y: 0.2, z: -1.3, rx: -0.3 }); // trophies
    k.add(k.root, ball(0.16, 10, 8), W.bone, { x: 0.9, y: 2.7, z: 0 });               // a skull on the frame
    return k.bake("rockChucker");
  }
  // A Marine gun tower: a ringed bunker base, a head that turns, twin barrels.
  k.add(k.root, cyl(1.3, 1.6, 2.0, 18), M.armour, { y: 1.0 });
  k.add(k.root, cyl(1.32, 1.32, 0.15, 18), M.trim, { y: 1.75 });
  k.add(k.root, cyl(1.65, 1.7, 0.25, 18), M.gun, { y: 0.12 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    k.add(k.root, rbox(0.4, 0.8, 0.2, 0.05), M.pack, { x: Math.sin(a) * 1.55, y: 0.6, z: Math.cos(a) * 1.55, ry: a });
  }
  const head = k.joint("head", k.root, 0, 2.6, 0);
  k.add(head, rbox(1.7, 1.0, 1.8, 0.25), M.armour);
  k.add(head, box(1.72, 0.12, 1.82), M.trim, { y: 0.15 });
  k.add(head, rbox(1.1, 0.25, 0.1, 0.04), M.glass, { y: 0.25, z: -0.88 });
  k.rod(head, [0.6, 0.5, 0.5], [0.6, 2.0, 0.6], 0.02, M.dark);
  k.add(head, ball(0.06, 8, 6), M.red, { x: 0.6, y: 2.0, z: 0.6 });
  const barrel = k.joint("barrel", head, 0, -0.1, -0.9);
  for (const x of [-0.35, 0.35]) {
    k.add(barrel, cyl(0.12, 0.14, 2.2, 12).rotateX(Math.PI / 2), M.gun, { x, z: -1.1 });
    k.add(barrel, cyl(0.18, 0.18, 0.3, 12).rotateX(Math.PI / 2), M.dark, { x, z: -2.2 });
  }
  return k.bake("gunTower");
}
export const turret = (f: Faction) => cloneOf(`turret:${f}`, () => buildTurret(f));

// ============================================================================================
// Animation
// ============================================================================================
export interface Motion {
  t: number;      // seconds, for idling
  dt: number;     // since the last frame
  moved: number;  // metres covered since the last frame
  since: number;  // seconds since it last fired or swung
}
interface Pose { base: Map<THREE.Object3D, { p: THREE.Vector3; q: THREE.Quaternion }>; joints: Record<string, THREE.Object3D>; phase: number; walk: number; speed: number }
const poses = new WeakMap<THREE.Object3D, Pose>();
const e = new THREE.Euler(), dq = new THREE.Quaternion();
function poseOf(g: THREE.Object3D): Pose {
  let p = poses.get(g);
  if (!p) {
    const joints: Record<string, THREE.Object3D> = {}, base = new Map<THREE.Object3D, { p: THREE.Vector3; q: THREE.Quaternion }>();
    g.traverse((o) => { if (o.name) { joints[o.name] = o; base.set(o, { p: o.position.clone(), q: o.quaternion.clone() }); } });
    poses.set(g, (p = { base, joints, phase: (g.id * 1.7) % 6.28, walk: 0, speed: 0 }));
  }
  return p;
}
// Sets a joint to its rest pose, turned by rx, ry, rz on top and moved by dx, dy, dz.
function set(p: Pose, name: string, rx = 0, ry = 0, rz = 0, dx = 0, dy = 0, dz = 0) {
  const j = p.joints[name], b = j && p.base.get(j);
  if (!j || !b) return;
  j.position.set(b.p.x + dx, b.p.y + dy, b.p.z + dz);
  j.quaternion.copy(b.q).multiply(dq.setFromEuler(e.set(rx, ry, rz)));
}
const ease = (from: number, to: number, rate: number, dt: number) => from + (to - from) * (1 - Math.exp(-rate * dt));

// Poses a model from what its unit is doing this frame.
export function animate(g: THREE.Object3D, m: Motion) {
  const p = poseOf(g), model = g.userData.model as string, dt = Math.max(1e-3, m.dt);
  p.speed = ease(p.speed, m.moved / dt, 10, dt);
  p.walk = ease(p.walk, p.speed > 0.4 ? 1 : 0, 8, dt);
  const a = p.walk, t = m.t;
  if (model === "marine") {
    p.phase += (m.moved / 1.7) * Math.PI * 2;
    const s = Math.sin(p.phase), c = Math.cos(p.phase);
    set(p, "legL", s * 0.6 * a);
    set(p, "legR", -s * 0.6 * a);
    set(p, "kneeL", -a * (0.1 + 0.9 * Math.max(0, c)));
    set(p, "kneeR", -a * (0.1 + 0.9 * Math.max(0, -c)));
    const kick = m.since < 0.15 ? 1 - m.since / 0.15 : 0;
    set(p, "hips", 0, 0, 0, 0, -a * 0.06 * Math.abs(s) - a * 0.02);
    set(p, "torso", 0.1 * a - kick * 0.06, s * 0.1 * a, 0, 0, Math.sin(t * 2) * 0.006);
    set(p, "head", -0.08 * a, -s * 0.08 * a);
    set(p, "gun", 0, 0, 0, 0, 0, kick * 0.07);
    // The antennas lag behind the walk and wobble on their own.
    for (let i = 0; i < 3; i++) {
      const w = 0.04 + 0.16 * a;
      set(p, `ant${i}`, 0.08 * a + Math.cos(t * (4 + i)) * w * 0.7, 0, Math.sin(t * (5 + i) + i) * w);
      set(p, `ant${i}b`, Math.cos(t * (4 + i) - 0.6) * w, 0, Math.sin(t * (5 + i) + i - 0.6) * w * 1.4);
    }
  } else if (model === "wooka") {
    // A waddle: short fast steps, rocking side to side, bouncing.
    p.phase += (m.moved / 1.0) * Math.PI * 2;
    const s = Math.sin(p.phase);
    set(p, "body", 0.14 * a, 0, s * 0.16 * a, 0, a * Math.abs(s) * 0.13);
    set(p, "footL", s * 0.8 * a, 0, 0, 0, Math.max(0, s) * 0.08 * a);
    set(p, "footR", -s * 0.8 * a, 0, 0, 0, Math.max(0, -s) * 0.08 * a);
    set(p, "armL", -s * 0.6 * a - 0.2 * a);
    // The club comes up over the head and down hard.
    const swing = m.since < 0.4 ? m.since / 0.4 : 1, rest = 0.35 + Math.sin(t * 3 + g.id) * 0.08;
    const club = swing < 0.35 ? rest + (2.7 - rest) * (swing / 0.35) : swing < 1 ? 2.7 - 1.9 * ((swing - 0.35) / 0.65) : rest;
    set(p, "armR", club);
    // The head tilts, slowly, the way a thing does when it's working out if you're food.
    set(p, "head", -0.1 * a, Math.sin(t * 0.6 + g.id) * 0.2 * (1 - a), Math.sin(t * 0.9 + g.id) * 0.18 * (1 - a));
    // The war flag streams back behind a run and flaps in its own time.
    set(p, "flag", 0.15 * a + Math.sin(t * 2 + g.id) * 0.04, 0, Math.cos(t * 2.4 + g.id) * 0.05);
    set(p, "flagB", 0, Math.sin(t * 7 + g.id) * (0.2 + 0.3 * a), Math.sin(t * 5 + g.id) * 0.1);
    set(p, "earL", 0, 0, 0.15 + Math.sin(t * 3 + g.id) * 0.08 + s * 0.2 * a);
    set(p, "earR", 0, 0, -0.15 - Math.sin(t * 2.6 + g.id) * 0.08 + s * 0.2 * a);
  } else if (model === "mossback") {
    // Knuckle-running: the fists land in turn, the great back rocks, and the head stays level.
    // Fast enough (the leap) and it stretches out, arms thrown forward and legs kicked back. A
    // swing brings both fists up over the head and down hard.
    p.phase += (m.moved / 2.6) * Math.PI * 2;
    const s = Math.sin(p.phase), c = Math.cos(p.phase), leap = Math.min(1, Math.max(0, (p.speed - 14) / 6));
    const swing = m.since < 0.7 ? m.since / 0.7 : 1;
    const slam = swing < 0.3 ? -2.5 * (swing / 0.3) : swing < 1 ? -2.5 + 2.2 * ((swing - 0.3) / 0.7) : 0;
    set(p, "body", (-0.12 * leap) + Math.sin(t * 1.4 + g.id) * 0.02 + 0.08 * a * s * s, s * 0.1 * a, s * 0.06 * a, 0, a * Math.abs(c) * 0.12 + leap * 0.2);
    set(p, "head", 0.1 * leap - 0.05 * a, Math.sin(t * 0.7 + g.id) * 0.25 * (1 - a), Math.sin(t * 1.1 + g.id) * 0.1 * (1 - a));
    set(p, "armL", -s * 0.9 * a - 0.1 + slam - 2.4 * leap);
    set(p, "armR", s * 0.9 * a - 0.1 + slam - 2.4 * leap);
    set(p, "foreL", -Math.max(0, -s) * 0.7 * a - 0.15 * (1 - leap));
    set(p, "foreR", -Math.max(0, s) * 0.7 * a - 0.15 * (1 - leap));
    set(p, "legL", s * 0.7 * a + leap * 1.0);
    set(p, "legR", -s * 0.7 * a + leap * 1.0);
  } else if (model === "walker") {
    p.phase += (m.moved / 7) * Math.PI * 2;
    const s = Math.sin(p.phase), c = Math.cos(p.phase);
    // On top of its bent-knee stance: the legs swing, and the one going forward lifts.
    for (const [side, k] of [["L", 1], ["R", -1]] as const) {
      const swing = k * s * 0.35 * a, lift = Math.max(0, k * c) * 0.5 * a;
      set(p, `leg${side}`, swing + lift);
      set(p, `knee${side}`, -lift * 1.6);
      set(p, `ankle${side}`, -swing + lift * 0.6);
    }
    set(p, "body", 0, s * 0.04 * a, s * 0.03 * a, 0, -Math.abs(c) * 0.25 * a);
  } else if (model === "tank") {
    const kick = m.since < 0.3 ? 1 - m.since / 0.3 : 0;
    set(p, "hull", -kick * 0.05 + Math.sin(t * 14) * 0.004 * a);
    set(p, "barrel", 0, 0, 0, 0, 0, kick * 0.5);
  } else if (model === "speeder") {
    set(p, "bike", -0.08 * a, 0, Math.sin(t * 1.3 + g.id) * 0.05, 0, Math.sin(t * 2.2 + g.id) * 0.08);
  } else if (model === "gunship") {
    set(p, "hull", 0.08 * a, 0, Math.sin(t * 0.8 + g.id) * 0.04, 0, Math.sin(t * 1.4 + g.id) * 0.3);
    set(p, "podL", -0.5 * a + 0.2);
    set(p, "podR", -0.5 * a + 0.2);
  } else if (model === "gunTower") {
    const kick = m.since < 0.25 ? 1 - m.since / 0.25 : 0;
    set(p, "barrel", 0, 0, 0, 0, 0, kick * 0.4);
  } else if (model === "rockChucker") {
    // The arm flings over, then is winched back down.
    const k = m.since < 0.3 ? m.since / 0.3 : Math.max(0, 1 - (m.since - 0.3) / 0.9);
    set(p, "arm", -1.9 * k);
  } else if (model === "fighter" || model === "cruiser") {
    // Engine fire flickers.
    const f = 1 + Math.sin(t * 31 + g.id) * 0.08 + Math.sin(t * 17 + g.id * 3) * 0.06;
    const j = p.joints.flame;
    if (j) j.scale.set(1, 1, f);
  }
}

// ============================================================================================
// The Wooka's side of the woods (the forest itself is terrain.ts): trophy totems, a Marine's
// helmet on a spike over carved faces, and the huts they keep up in the trunks.
// ============================================================================================
function buildTotem() {
  const k = new Kit(), g = k.root;
  // Three carved logs, each a face: black eyes, a grin of teeth, stripes of red paint.
  for (let i = 0; i < 3; i++) {
    const y = 0.75 + i * 1.3;
    k.add(g, cyl(0.42 - i * 0.04, 0.48 - i * 0.04, 1.25, 12), W.bark, { y });
    k.pair(g, () => ball(0.11, 10, 8), W.eye, { x: 0.16, y: y + 0.22, z: -0.4 });
    k.add(g, box(0.42, 0.08, 0.08), W.tooth, { y: y - 0.2, z: -0.43 });
    k.add(g, ring(0.47 - i * 0.04, 0.035, 16), W.paint, { y: y + 0.45, rx: Math.PI / 2 });
  }
  // The trophy: a Thunder Marine's helmet, white trim and snorkel and all, jammed on a spike.
  k.rod(g, [0, 4.4, 0], [0, 5.4, 0], 0.05, W.bone);
  k.add(g, dome(0.36, 18), M.armour, { y: 5.12, s: [1, 1.15, 1.05] });
  k.add(g, ring(0.36, 0.04, 18), M.trim, { y: 5.15, rx: Math.PI / 2 });
  k.add(g, box(0.42, 0.12, 0.08), M.dark, { y: 5.32, z: -0.33 });           // the visor
  k.add(g, cyl(0.07, 0.09, 0.3, 8), M.trim, { y: 5.05, z: -0.4, rx: 0.4 });  // the snorkel
  // Feathers and bones hanging off the top log.
  for (const s of [-1, 1]) {
    k.rod(g, [s * 0.4, 4.1, 0], [s * 0.7, 4.9, 0.1], 0.04, W.bone);
    k.add(g, cone(0.08, 0.55, 5), W.paint, { x: s * 0.75, y: 5.1, z: 0.1, rz: -s * 0.4 });
  }
  return k.bake("totem");
}
export const totem = () => cloneOf("totem", buildTotem);

// A hut round a trunk: a deck of planks on log beams, a thatched cone with a fire glowing in its
// door, and a rope ladder down. Centred on the trunk; its deck at y = 0.
function buildHut() {
  const k = new Kit(), g = k.root;
  k.add(g, cyl(6, 6, 0.4, 16), W.wood, { y: -0.2 });
  for (let i = 0; i < 4; i++) k.add(g, box(13, 0.5, 0.5), W.bark, { y: -0.6, ry: (i * Math.PI) / 4 });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    k.rod(g, [Math.sin(a) * 5.8, 0, Math.cos(a) * 5.8], [Math.sin(a) * 5.8, 1.1, Math.cos(a) * 5.8], 0.08, W.bark, 5);
  }
  k.add(g, ring(5.8, 0.06, 32), W.rope, { y: 1.05, rx: Math.PI / 2 });
  k.add(g, cyl(2.6, 2.8, 2.4, 12), W.hide, { x: 3.4, y: 1.2 });
  k.add(g, cone(3.6, 3, 12), W.thatch, { x: 3.4, y: 3.9 });
  k.add(g, box(1, 1.5, 0.1), W.fire, { x: 3.4, y: 0.8, z: -2.75 });
  k.rod(g, [5.5, 0, -3], [5.5, -14, -3.4], 0.05, W.rope, 4);
  k.rod(g, [6.1, 0, -2.6], [6.1, -14, -3], 0.05, W.rope, 4);
  return k.bake("hut");
}
export const hut = () => cloneOf("hut", buildHut);

// ============================================================================================
// In orbit. Models are centred on the craft and face -z, like yaw 0 and pitch 0 in the sim.
// ============================================================================================

// Voxel ships: chunky cubes on a grid, like a toy village built from blocks. Flat colours, no
// textures, so the blocks read from far off in the 2.5D view.
const V = {
  get hull() { return lazy("v.hull", () => std(0x2b3039, 0.55, { metalness: 0.25 })); },
  get hullDark() { return lazy("v.hullDark", () => std(0x1b1e24, 0.5, { metalness: 0.3 })); },
  get deck() { return lazy("v.deck", () => std(0x3d434e, 0.6, { metalness: 0.2 })); },
  get trim() { return lazy("v.trim", () => std(0xeef1f5, 0.45)); },
  get gold() { return lazy("v.gold", () => std(0xf0bb40, 0.35, { metalness: 0.45 })); },
  get gun() { return lazy("v.gun", () => std(0x555b66, 0.4, { metalness: 0.5 })); },
  get wood() { return lazy("v.wood", () => std(0x8a5a30, 0.9)); },
  get woodDark() { return lazy("v.woodDark", () => std(0x5e3b1e, 0.9)); },
  get plank() { return lazy("v.plank", () => std(0xc7965c, 0.9)); },
  get thatch() { return lazy("v.thatch", () => std(0xd9b25a, 1)); },
  get hide() { return lazy("v.hide", () => std(0xd7b07a, 0.9)); },
  get hideDark() { return lazy("v.hideDark", () => std(0xa47c4c, 0.9)); },
  get fur() { return lazy("v.fur", () => std(0x9a6438, 1)); },
  get rope() { return lazy("v.rope", () => std(0xcdb27a, 1)); },
  get leaf() { return lazy("v.leaf", () => std(0x4f8f3a, 1)); },
  get bone() { return lazy("v.bone", () => std(0xeee6cf, 0.6)); },
  get black() { return lazy("v.black", () => std(0x060606, 0.15, { metalness: 0.3 })); },
};

// A voxel grid: a material per cell. Baked into a Kit, only the cubes with an open face are
// kept, so a solid hull costs just its skin.
class Voxels {
  private cells = new Map<string, [number, number, number, Mat]>();
  set(x: number, y: number, z: number, m: Mat) { this.cells.set(`${x},${y},${z}`, [x, y, z, m]); return this; }
  has(x: number, y: number, z: number) { return this.cells.has(`${x},${y},${z}`); }
  fill(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: Mat) {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) this.set(x, y, z, m);
    return this;
  }
  bake(k: Kit, on: THREE.Object3D, u: number) {
    for (const [x, y, z, m] of this.cells.values()) {
      if (this.has(x + 1, y, z) && this.has(x - 1, y, z) && this.has(x, y + 1, z) && this.has(x, y - 1, z) && this.has(x, y, z + 1) && this.has(x, y, z - 1)) continue;
      k.add(on, box(u, u, u), m, { x: x * u, y: y * u, z: z * u });
    }
  }
}
// A repeatable scatter, for greebles.
const seeded = (s: number) => () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);

// A Marine fighter: a black dart with white-tipped wings, a lit canopy, twin fins and two
// engines. The hero's has gold trim.
function buildMarineFighter(hero: boolean) {
  const k = new Kit(), v = new Voxels(), trim = hero ? V.gold : V.trim;
  v.fill(0, 0, 0, 0, -4, 3, V.hull).set(0, 0, -5, trim);
  v.fill(-1, 1, 0, 0, -1, 3, V.hull).set(0, 1, -2, M.lens).set(0, 1, -1, M.lens);
  for (const s of [-1, 1]) {
    v.fill(s * 2, s * 2, 0, 0, 0, 2, V.hull).fill(s * 3, s * 3, 0, 0, 1, 2, V.hull);
    v.fill(s * 4, s * 4, 0, 0, 0, 2, trim).set(s * 4, 0, -1, V.gun).set(s * 4, 0, -2, V.gun);
    v.fill(s, s, 1, 2, 2, 3, V.hullDark).set(s, 2, 3, trim);
    v.set(s, 0, 4, M.engine);
  }
  v.bake(k, k.root, 0.6);
  const flame = k.joint("flame", k.root, 0, 0, 2.75);
  for (const s of [-1, 1]) k.add(flame, cone(0.3, 1.8, 8).rotateX(-Math.PI / 2), M.plume, { x: s * 0.6, z: 0.9 });
  return k.bake("fighter");
}

// A Wooka fighter: a hollowed-out log with hide sails for wings, one Wooka sitting in it, and a
// bonfire in the back end.
function buildWookaFighter(hero: boolean) {
  const k = new Kit(), v = new Voxels();
  for (let z = -4; z <= 3; z++) for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) {
    if (Math.abs(x) + Math.abs(y) === 2) continue;
    v.set(x, y, z, (z + 4) % 3 ? V.wood : V.woodDark);
  }
  v.set(0, 2, -1, V.fur).set(0, 2, 0, V.fur).set(0, 3, -1, V.fur).set(-1, 2, -1, V.fur).set(1, 2, -1, V.fur);
  v.set(0, 2, -2, V.black);
  for (const s of [-1, 1]) {
    v.fill(s * 2, s * 5, 0, 0, -1, 1, V.hide).set(s * 4, 0, 0, V.hideDark).fill(s * 2, s * 5, 1, 1, -1, -1, V.wood);
  }
  if (hero) v.set(0, 0, -5, V.bone).set(0, 4, -1, V.bone);
  v.set(0, 0, 4, W.fire).set(-1, 0, 4, W.fireCore).set(1, 0, 4, W.fire);
  v.bake(k, k.root, 0.6);
  const flame = k.joint("flame", k.root, 0, 0, 2.75);
  k.add(flame, cone(0.5, 2.2, 7).rotateX(-Math.PI / 2), W.fire, { z: 1.1 });
  k.add(flame, cone(0.28, 1.3, 6).rotateX(-Math.PI / 2), W.fireCore, { z: 0.7 });
  return k.bake("fighter");
}

export const fighter = (f: Faction, hero = false) => cloneOf(`fighter:${f}:${hero}`, () => (f === "wooka" ? buildWookaFighter(hero) : buildMarineFighter(hero)));

// A Marine capital ship: a long wedge stepped up in tiers like a ziggurat, black with white trim
// along its edges, rows of lit windows in each step, turrets on the deck, a command tower at the
// back with a bridge across its top, and a bank of engines.
function buildMarineCruiser() {
  const k = new Kit(), v = new Voxels(), r = seeded(5);
  const NOSE = -24, TAIL = 18;
  const half = (z: number) => Math.round(1 + ((z - NOSE) / (TAIL - NOSE)) * 9);
  // The tiers: how far each is set in from the edge, and where it starts.
  const tiers = [{ y: -2, in: 5, from: -12 }, { y: -1, in: 2, from: -20 }, { y: 0, in: 0, from: NOSE }, { y: 1, in: 1, from: -21 }, { y: 2, in: 3, from: -14 }, { y: 3, in: 5, from: -6 }];
  for (let z = NOSE; z <= TAIL; z++) {
    for (const t of tiers) {
      if (z < t.from) continue;
      const w = half(z) - t.in;
      if (w < 0) continue;
      for (let x = -w; x <= w; x++) {
        const edge = Math.abs(x) === w, top = t.y === 3;
        v.set(x, t.y, z, t.y === 0 && edge ? V.trim : edge && (t.y === 1 || t.y === 2) && z % 4 === 0 ? M.lens : top && x === 0 ? V.trim : t.y < 0 ? V.hullDark : (x + z) % 7 === 0 ? V.deck : V.hull);
      }
    }
  }
  // Greebles on the top tier, and turrets along the second.
  for (let i = 0; i < 26; i++) {
    const z = Math.floor(-4 + r() * 14), w = half(z) - 5, x = Math.round((r() * 2 - 1) * w);
    if (x !== 0) v.set(x, 4, z, r() < 0.5 ? V.hullDark : V.deck);
  }
  for (const z of [-12, -6, 0, 6]) for (const s of [-1, 1]) {
    const x = s * (half(z) - 2);
    v.set(x, 2, z, V.gun).set(x, 3, z, V.gun).set(x, 3, z - 1, V.gun).set(x, 3, z - 2, V.gun);
  }
  // The command tower and its bridge.
  v.fill(-2, 2, 4, 7, 10, 15, V.hull).fill(-3, 3, 4, 4, 9, 16, V.hullDark);
  v.fill(-6, 6, 8, 9, 11, 13, V.hull).fill(-6, 6, 9, 9, 10, 10, M.lens).fill(-6, 6, 10, 10, 11, 13, V.trim);
  v.set(-5, 11, 12, V.trim).set(5, 11, 12, V.trim).fill(0, 0, 11, 13, 14, 14, V.hullDark).set(0, 14, 14, M.red);
  // Running lights and the engine bank.
  v.set(-half(NOSE + 2), 0, NOSE + 2, M.red).set(half(NOSE + 2), 0, NOSE + 2, M.green);
  for (let x = -8; x <= 8; x += 2) v.set(x, 0, TAIL + 1, M.engine).set(x, 1, TAIL + 1, M.engineCore);
  const u = 1.5;
  v.bake(k, k.root, u);
  const flame = k.joint("flame", k.root, 0, u * 0.5, (TAIL + 1.5) * u);
  for (let x = -8; x <= 8; x += 4) k.add(flame, cone(1.6, 9, 10).rotateX(-Math.PI / 2), M.plume, { x: x * u, z: 4.5 });
  return k.bake("cruiser");
}

// A Wooka capital ship: a village on a raft of lashed logs. Plank decks, huts with thatched roofs
// and lit doorways, a little tree, two masts of patched hide, a carved Wooka head for a figurehead
// and bonfires burning out the back.
function buildWookaCruiser() {
  const k = new Kit(), v = new Voxels(), r = seeded(9);
  const BOW = -20, STERN = 18;
  for (let z = BOW; z <= STERN; z++) {
    const taper = z < BOW + 4 ? BOW + 4 - z : 0;
    for (let x = -8 + taper; x <= 8 - taper; x++) for (let y = -4; y <= 0; y++) {
      if ((x * x) / 64 + ((y + 1.5) * (y + 1.5)) / 7 > 1) continue;
      const log = Math.floor((x + 8) / 2) % 2 ? V.wood : V.woodDark;
      v.set(x, y, z, (z - BOW) % 9 === 4 && Math.abs(x) >= 6 ? V.rope : log);
    }
    if (z > BOW + 3) for (let x = -6; x <= 6; x++) v.set(x, 1, z, (x + z) % 5 === 0 ? V.wood : V.plank);
  }
  // Huts: walls of wood with a lit doorway, and a stepped thatch roof.
  const hut = (cx: number, cz: number, base: number, size: number) => {
    v.fill(cx - size, cx + size, base, base + 2, cz - size, cz + size, V.wood);
    v.set(cx, base, cz - size, W.fire).set(cx, base + 1, cz - size, W.fire);
    for (let i = 0; i <= size + 1; i++) v.fill(cx - size - 1 + i, cx + size + 1 - i, base + 3 + i, base + 3 + i, cz - size - 1 + i, cz + size + 1 - i, V.thatch);
  };
  hut(-3, -10, 2, 2); hut(3, 0, 2, 2); hut(-3, 9, 2, 1); hut(-3, 9, 7, 1); hut(4, 13, 2, 1);
  // A little tree on the deck.
  v.fill(4, 4, 2, 6, -10, -10, V.woodDark);
  for (let x = -2; x <= 2; x++) for (let y = -1; y <= 2; y++) for (let z = -2; z <= 2; z++) if (x * x + y * y + z * z <= 5) v.set(4 + x, 7 + y, -10 + z, V.leaf);
  // Masts and their sails, patched.
  for (const [z, h] of [[-4, 16], [6, 13]] as const) {
    v.fill(0, 0, 2, 2 + h, z, z, V.wood);
    v.fill(-6, 6, 2 + h - 1, 2 + h - 1, z, z, V.woodDark);
    for (let x = -5; x <= 5; x++) for (let y = 6; y <= h - 1; y++) v.set(x, y, z + 1, r() < 0.15 ? V.hideDark : V.hide);
  }
  // The figurehead: a carved Wooka head, eyes blacked in.
  for (let x = -3; x <= 3; x++) for (let y = -3; y <= 3; y++) for (let z = -3; z <= 3; z++) if (x * x + y * y + z * z <= 10) v.set(x, 2 + y, BOW - 2 + z, V.fur);
  v.set(-1, 3, BOW - 5, V.black).set(1, 3, BOW - 5, V.black).set(-1, 3, BOW - 4, V.black).set(1, 3, BOW - 4, V.black).set(0, 2, BOW - 5, V.woodDark);
  v.set(-2, 5, BOW - 2, V.fur).set(2, 5, BOW - 2, V.fur);
  // Lanterns along the rails, and the bonfires astern.
  for (let z = BOW + 6; z < STERN; z += 6) v.set(-6, 2, z, W.fire).set(6, 2, z, W.fire);
  for (let x = -5; x <= 5; x += 2) v.set(x, -1, STERN + 1, W.fire).set(x, 0, STERN + 1, W.fireCore);
  const u = 1.5;
  v.bake(k, k.root, u);
  const flame = k.joint("flame", k.root, 0, -0.5 * u, (STERN + 1.5) * u);
  for (const [x, sz] of [[0, 1], [-4, 0.75], [4, 0.75]] as const) {
    k.add(flame, cone(3.5 * sz, 12 * sz, 7).rotateX(-Math.PI / 2), W.fire, { x: x * u, z: 5 * sz });
    k.add(flame, cone(2 * sz, 7 * sz, 6).rotateX(-Math.PI / 2), W.fireCore, { x: x * u, z: 3 * sz });
  }
  return k.bake("cruiser");
}

export const cruiser = (f: Faction) => cloneOf(`cruiser:${f}`, () => (f === "wooka" ? buildWookaCruiser() : buildMarineCruiser()));
