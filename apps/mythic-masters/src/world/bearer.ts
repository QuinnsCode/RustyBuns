// You in the open world (#3774): a shadowy figure carrying the Book, the same for every player, with your line-up of
// cryptids walking behind. What tells friends apart is the ground under them: a patch of tiles round each figure's
// feet, its look (pattern, colours, tile size) seeded from the player's public id, so a friend's patch is the same on
// every page. The tiles are laid in world coordinates, so walking reveals the pattern under you rather than dragging
// it along, and the patch is draped on the ground every step.
//
// Cheap on purpose: one figure is three meshes sharing geometry and materials with every other figure, and its patch is
// one 49-vertex plane. No skin, no puppet, no model to load.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mulberry32 } from "@rustybuns/util";

export const PATTERNS = ["grid", "brick", "diamond", "basket"] as const;
export type Pattern = (typeof PATTERNS)[number];
/** One player's ground: how the tiles are laid, two tile colours and the grout's (HSL, 0..1), and metres per tile. */
export interface TileLook { pattern: Pattern; hue: number; a: [number, number, number]; b: [number, number, number]; grout: [number, number, number]; tile: number }

/** The figure is this tall (metres), hood to hem: a name tag sits a little over it. */
export const HEIGHT = 1.8;
/** The patch is this wide (metres). */
const PATCH = 3.2;
const SEGS = 6;
/** Before you are seated in a room (offline, or before the room's `all`), your ground is seeded from this. */
export const NO_ID = "you";

/** A string's FNV-1a hash, the seed of its tile look. */
function hash(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** The tile look for a player's public id (src/edge/region.ts publicId): the same id gives the same ground on any page. */
export function tileLook(id: string): TileLook {
  const r = mulberry32(hash(id));
  const pattern = PATTERNS[Math.floor(r() * PATTERNS.length)]!;
  // A hue anywhere round the wheel, the two tiles a step apart in lightness (and a nudge in hue), the grout dark.
  const hue = r(), sat = 0.35 + r() * 0.35, light = 0.42 + r() * 0.18;
  return {
    pattern, hue,
    a: [hue, sat, light],
    b: [(hue + 0.04 + r() * 0.06) % 1, sat * 0.85, light - 0.12 - r() * 0.08],
    grout: [hue, 0.15, 0.12 + r() * 0.08],
    tile: [0.5, 0.65, 0.8][Math.floor(r() * 3)]!,
  };
}

const css = ([h, s, l]: readonly number[]) => `hsl(${(h! * 360).toFixed(0)} ${(s! * 100).toFixed(0)}% ${(l! * 100).toFixed(0)}%)`;

/** The tile pattern, 4 x 4 tiles to the canvas so it repeats seamlessly. */
function drawTiles(look: TileLook) {
  const N = 256, T = N / 4, cv = document.createElement("canvas");
  cv.width = cv.height = N;
  const g = cv.getContext("2d")!;
  g.fillStyle = css(look.grout); g.fillRect(0, 0, N, N);
  const gap = 5, tile = (x: number, y: number, w: number, h: number, k: number) => { g.fillStyle = css(k % 2 ? look.b : look.a); g.fillRect(x + gap / 2, y + gap / 2, w - gap, h - gap); };
  if (look.pattern === "grid") for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) tile(i * T, j * T, T, T, i + j);
  if (look.pattern === "brick") for (let j = 0; j < 8; j++) for (let i = -1; i < 4; i++) tile(i * T + (j % 2) * T / 2, j * T / 2, T, T / 2, i + j * 3);
  if (look.pattern === "basket") for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    if ((i + j) % 2) { tile(i * T, j * T, T / 2, T, 0); tile(i * T + T / 2, j * T, T / 2, T, 1); }
    else { tile(i * T, j * T, T, T / 2, 1); tile(i * T, j * T + T / 2, T, T / 2, 0); }
  }
  if (look.pattern === "diamond") {
    // squares turned 45 degrees: each a diamond round a grid point, the corners between them the second colour
    g.fillStyle = css(look.b); g.fillRect(0, 0, N, N);
    g.strokeStyle = css(look.grout); g.lineWidth = gap;
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
      const cx = i * T, cy = j * T;
      g.beginPath(); g.moveTo(cx, cy - T / 2); g.lineTo(cx + T / 2, cy); g.lineTo(cx, cy + T / 2); g.lineTo(cx - T / 2, cy); g.closePath();
      g.fillStyle = css(look.a); g.fill(); g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** The patch's edge: solid in the middle, fading out to a ragged round edge (white is kept). */
let fadeTex: THREE.Texture | null = null;
function fade() {
  if (fadeTex) return fadeTex;
  const N = 128, cv = document.createElement("canvas");
  cv.width = cv.height = N;
  const g = cv.getContext("2d")!, grad = g.createRadialGradient(N / 2, N / 2, N * 0.22, N / 2, N / 2, N / 2);
  grad.addColorStop(0, "#fff"); grad.addColorStop(0.55, "#ccc"); grad.addColorStop(1, "#000");
  g.fillStyle = grad; g.fillRect(0, 0, N, N);
  fadeTex = new THREE.CanvasTexture(cv);
  fadeTex.channel = 1;
  return fadeTex;
}

const grounds = new Map<string, THREE.MeshStandardMaterial>();
/** A player's ground material, made once per id and shared by every patch drawn for them. */
function groundMat(id: string) {
  let m = grounds.get(id);
  if (!m) {
    const look = tileLook(id), map = drawTiles(look);
    // a world metre is 1 / (4 tiles x tile metres) of the canvas
    map.repeat.set(1 / (4 * look.tile), 1 / (4 * look.tile));
    // a faint glow of its own colours, so a friend's ground still tells them apart at night
    m = new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.18, alphaMap: fade(), transparent: true, depthWrite: false, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    grounds.set(id, m);
  }
  return m;
}

/** The figure's three meshes (cloak, book cover, pages), built once, facing +x, feet at y = 0. */
let figure: { cloak: THREE.BufferGeometry; cover: THREE.BufferGeometry; pages: THREE.BufferGeometry; mats: THREE.Material[] } | null = null;
function figureParts() {
  if (figure) return figure;
  // the cloak: a robe lathed from hem to shoulders, a hood over it, two sleeves reaching to the book at the chest
  const robe = new THREE.LatheGeometry([[0, 0], [0.42, 0], [0.38, 0.35], [0.3, 0.9], [0.24, 1.3], [0.2, 1.42], [0, 1.46]].map(([x, y]) => new THREE.Vector2(x, y)), 9);
  const hood = new THREE.SphereGeometry(0.17, 9, 7, 0, Math.PI * 2, 0, Math.PI * 0.75);
  hood.scale(1.05, 1.25, 1.05); hood.translate(-0.03, 1.6, 0);
  const sleeve = (side: number) => {
    const s = new THREE.CylinderGeometry(0.06, 0.08, 0.5, 6);
    s.rotateZ(Math.PI / 2 - 0.5); s.translate(0.2, 1.12, side * 0.17);
    return s;
  };
  const cloak = mergeGeometries([robe, hood, sleeve(1), sleeve(-1)].map((g) => g.toNonIndexed()))!;
  // the Book, held open at the chest, tipped up toward the face
  const book = (w: number, h: number, d: number) => { const b = new THREE.BoxGeometry(w, h, d); b.rotateZ(0.6); b.translate(0.42, 1.08, 0); return b; };
  const cover = book(0.26, 0.05, 0.36), pages = book(0.24, 0.07, 0.32);
  pages.translate(0.005, 0.015, 0);
  const mats = [
    new THREE.MeshStandardMaterial({ color: 0x0d0b12, roughness: 1, emissive: 0x1a1428, emissiveIntensity: 0.4 }),
    new THREE.MeshStandardMaterial({ color: 0x2a1610, roughness: 0.7 }),
    // the possessed Book's pages give off a faint warm light, so a figure reads at night by its book and its ground
    new THREE.MeshStandardMaterial({ color: 0xe8d9b0, emissive: 0xffb24a, emissiveIntensity: 0.9 }),
  ];
  figure = { cloak, cover, pages, mats };
  return figure;
}

/** One player in the world: their figure and the patch of their ground under it. */
export class Bearer {
  readonly group = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly patch: THREE.Mesh;
  private readonly pos: THREE.BufferAttribute;
  private readonly uv: THREE.BufferAttribute;
  private walked = 0;
  private laid = { x: NaN, z: NaN };
  private last = { x: NaN, z: NaN };
  /** Metres the tile pattern takes to repeat: the patch's UVs are kept within a few of these of zero. */
  private readonly period: number;

  /** `ground(x, z)` is the height to stand and lay the patch on; `patch` false for a figure who isn't a player (Gary). */
  constructor(readonly id: string, parent: THREE.Object3D, private readonly ground: (x: number, z: number) => number, patch = true) {
    const f = figureParts();
    for (const [g, m] of [[f.cloak, f.mats[0]], [f.cover, f.mats[1]], [f.pages, f.mats[2]]] as const) {
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = true;
      this.body.add(mesh);
    }
    const plane = new THREE.PlaneGeometry(PATCH, PATCH, SEGS, SEGS);
    plane.rotateX(-Math.PI / 2);
    plane.setAttribute("uv1", plane.getAttribute("uv").clone());
    this.period = 4 * tileLook(id).tile;
    this.patch = new THREE.Mesh(plane, groundMat(id));
    this.patch.renderOrder = 1;
    this.pos = plane.getAttribute("position") as THREE.BufferAttribute;
    this.uv = plane.getAttribute("uv") as THREE.BufferAttribute;
    this.group.add(this.body, this.patch);
    // Not a player (Gary): the figure alone, none of a player's ground (the patch, or anything else laid with it).
    if (!patch) for (const o of [...this.group.children]) if (o !== this.body) this.group.remove(o);
    parent.add(this.group);
  }

  set visible(v: boolean) { this.group.visible = v; }

  /** Stand at (x, z) facing `yaw` (0 is +x), on `y`. The figure sways a little as it walks; the patch is laid again
   *  every step, its tiles fixed to the world. */
  update(x: number, y: number, z: number, yaw: number) {
    const moved = Number.isNaN(this.last.x) ? 0 : Math.hypot(x - this.last.x, z - this.last.z);
    this.last = { x, z };
    if (moved < 2) this.walked += moved;
    const k = this.walked * 2.6; // a bob a stride
    this.body.position.set(x, y + Math.abs(Math.sin(k)) * 0.05, z);
    this.body.rotation.y = -yaw;
    if (Math.hypot(x - this.laid.x, z - this.laid.z) < 0.1) return;
    this.laid = { x, z };
    const u = this.uv, p = this.pos, P = this.period, ox = Math.floor(x / P) * P, oz = Math.floor(z / P) * P;
    // the plane's vertex at local (lx, lz) sits on the ground at (x + lx, z + lz), its tile texture at that world spot
    this.patch.position.set(x, 0, z);
    for (let i = 0; i < p.count; i++) {
      const lx = ((i % (SEGS + 1)) / SEGS - 0.5) * PATCH, lz = (Math.floor(i / (SEGS + 1)) / SEGS - 0.5) * PATCH;
      p.setY(i, this.ground(x + lx, z + lz) + 0.04);
      u.setXY(i, x + lx - ox, oz - z - lz);
    }
    p.needsUpdate = true; u.needsUpdate = true;
    this.patch.geometry.computeBoundingSphere();
  }

  dispose() { this.group.removeFromParent(); this.patch.geometry.dispose(); }
}
