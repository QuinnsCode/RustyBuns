// How a Qollab Studio room looks (#5008): the light, what every surface is made of, and the camera's lens and film.
// A room is data (room.ts); this turns its sizes and materials into something that should read as a photo of a real
// small studio: tone mapped light, ceiling downlights set off the walls so they wash them (no two alike), the floor's warm
// bounce lifting the tops of the walls, a soft fill washing the walls between the pools, the ceiling falling off into its corners, floor lamps in the free corners throwing their hourglass on the walls, soft shadows, contact shadows
// and shade in the corners baked once, reflections of the room itself,
// textures painted in code (planks with grain, ceiling tiles on their grid, wedge foam, folded curtains, brick, carpet),
// the room's absorbers (wedge foam cut as real ridges) and curtains hung where its data says, paint rolled on by hand, a framed
// control-room window, the cables, tape, wall plates and road cases a room in use collects, and on high a little bloom, a vignette and grain.
// Two settings: `high` (shadows, post) and `low` (neither, for a weak laptop or a phone); ?quality= or Q picks one.
// Other files build their meshes with `surface(name, color)` and mark a lamp or a screen with userData.glow.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { HorizontalBlurShader } from "three/examples/jsm/shaders/HorizontalBlurShader.js";
import { VerticalBlurShader } from "three/examples/jsm/shaders/VerticalBlurShader.js";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mulberry32 } from "@rustybuns/util";
import { propBlocks, thingBox, wallPieces, type Side, type StudioDef } from "./room.ts";
import { MATERIALS, type Material } from "./sound.ts";

export type Quality = "low" | "high";
const KEY = "qollab-studio:quality";

/** The setting: ?quality= first, then what this browser chose last, else high unless it's a phone. */
export function pickQuality(search: string, stored: string | null, coarse: boolean): Quality {
  const q = new URLSearchParams(search).get("quality") ?? stored;
  return q === "low" || q === "high" ? q : coarse ? "low" : "high";
}
export function loadQuality(): Quality {
  let stored: string | null = null;
let sheen: THREE.CanvasTexture | null = null;
  try { stored = localStorage.getItem(KEY); } catch { /* no storage */ }
  return pickQuality(location.search, stored, matchMedia("(pointer: coarse)").matches);
}
export function saveQuality(q: Quality) { try { localStorage.setItem(KEY, q); } catch { /* this visit only */ } }

// ---- textures, painted on a canvas: one tile covers `metres` of surface, UVs are in metres (metreUV) ----
interface Painted { map: THREE.Texture; bump?: THREE.Texture; rough?: THREE.Texture; metres: number }
type Paint = (g: CanvasRenderingContext2D, n: number, rnd: () => number, base: THREE.Color) => void;

function canvasTex(n: number, draw: (g: CanvasRenderingContext2D) => void, color: boolean): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d");
  if (!g) throw new Error("no 2d canvas");
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const css = (c: THREE.Color, k = 1) => `rgb(${Math.min(255, c.r * 255 * k) | 0},${Math.min(255, c.g * 255 * k) | 0},${Math.min(255, c.b * 255 * k) | 0})`;
/** Speckle a canvas: `count` dots of alpha `a`, light or dark. */
function speckle(g: CanvasRenderingContext2D, n: number, rnd: () => number, count: number, a: number, size = 1.5) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${a * rnd()})` : `rgba(255,255,255,${a * rnd()})`;
    g.fillRect(rnd() * n, rnd() * n, size * (0.5 + rnd()), size * (0.5 + rnd()));
  }
}
/** Soft blotches, for concrete, plaster and the wear on a floor. */
function blotch(g: CanvasRenderingContext2D, n: number, rnd: () => number, count: number, a: number) {
  for (let i = 0; i < count; i++) {
    const x = rnd() * n, y = rnd() * n, r = n * (0.05 + rnd() * 0.2);
    const gr = g.createRadialGradient(x, y, 0, x, y, r), dark = rnd() < 0.5;
    gr.addColorStop(0, dark ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`);
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    for (const dx of [-n, 0, n]) for (const dy of [-n, 0, n]) { g.save(); g.translate(dx, dy); g.fillRect(x - r, y - r, r * 2, r * 2); g.restore(); }
  }
}

/** Boards across the tile: `rows` planks, each in lengths with staggered joints, grain running along them. */
const planks = (rows: number, vertical = false): Paint => (g, n, rnd, base) => {
  const h = n / rows;
  if (vertical) { g.translate(n, 0); g.rotate(Math.PI / 2); }
  for (let r = 0; r < rows; r++) {
    let x = -rnd() * n * 0.6;
    while (x < n) {
      const len = n * (0.45 + rnd() * 0.5), k = 0.78 + rnd() * 0.4;
      g.fillStyle = css(base, k);
      g.fillRect(x, r * h, len, h);
      // grain: long wobbling lines, darker and lighter
      for (let i = 0; i < 26; i++) {
        const y0 = r * h + rnd() * h, amp = 0.6 + rnd() * 2.5, f = 0.002 + rnd() * 0.01, ph = rnd() * 6;
        g.strokeStyle = rnd() < 0.7 ? `rgba(40,22,10,${0.08 + rnd() * 0.16})` : `rgba(255,230,190,${0.05 + rnd() * 0.08})`;
        g.lineWidth = 0.5 + rnd() * 1.6;
        g.beginPath();
        for (let px = x; px <= x + len; px += 6) { const py = y0 + Math.sin(px * f * 6.28 + ph) * amp; px === x ? g.moveTo(px, py) : g.lineTo(px, py); }
        g.stroke();
      }
      if (rnd() < 0.25) { // a knot
        const kx = x + rnd() * len, ky = r * h + h * (0.25 + rnd() * 0.5), kr = 3 + rnd() * 6;
        g.fillStyle = "rgba(50,25,10,0.45)"; g.beginPath(); g.ellipse(kx, ky, kr * 2.2, kr, 0, 0, 7); g.fill();
      }
      g.fillStyle = "rgba(20,10,5,0.75)"; g.fillRect(x, r * h, 2, h); // the joint
      x += len;
    }
    g.fillStyle = "rgba(20,10,5,0.7)"; g.fillRect(0, r * h, n, 2); // the seam between boards
  }
};
const bricks: Paint = (g, n, rnd, base) => {
  g.fillStyle = "#9a9286"; g.fillRect(0, 0, n, n); // mortar
  const rows = 16, h = n / rows, w = h * 2.1;
  for (let r = 0; r < rows; r++) for (let x = r % 2 ? -w / 2 : 0; x < n; x += w) {
    g.fillStyle = css(base, 0.7 + rnd() * 0.5);
    g.fillRect(x + 2, r * h + 2, w - 4, h - 4);
  }
  speckle(g, n, rnd, 9000, 0.25, 2);
};
/** A grid of tiles; the lines between are `line` times the tile's shade. */
const tiles = (count: number, line: number, lineW: number): Paint => (g, n, rnd, base) => {
  const s = n / count;
  for (let i = 0; i < count; i++) for (let j = 0; j < count; j++) { g.fillStyle = css(base, 0.92 + rnd() * 0.16); g.fillRect(i * s, j * s, s, s); }
  speckle(g, n, rnd, 16000, 0.35, 1.2);
  g.fillStyle = css(base, line);
  for (let i = 0; i < count; i++) { g.fillRect(i * s - lineW / 2, 0, lineW, n); g.fillRect(0, i * s - lineW / 2, n, lineW); }
};
const rough = (blotches: number, dots: number): Paint => (g, n, rnd, base) => {
  g.fillStyle = css(base); g.fillRect(0, 0, n, n);
  blotch(g, n, rnd, blotches, 0.035);
  speckle(g, n, rnd, dots, 0.1, 1.3);
};
/** Folds hanging straight down: light and shade across the tile, in bands. */
const folds: Paint = (g, n, rnd, base) => {
  for (let x = 0; x < n; x++) { const s = 0.75 + 0.25 * Math.sin((x / n) * Math.PI * 2 * 6) + 0.05 * Math.sin(x * 0.3); g.fillStyle = css(base, s); g.fillRect(x, 0, 1, n); }
  speckle(g, n, rnd, 20000, 0.12, 1);
};
/** Wedge foam: squares whose ridges turn a quarter each, as the sheets come. */
const wedges: Paint = (g, n, rnd, base) => {
  const cells = 2, s = n / cells, ridges = 6;
  for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
    const across = (i + j) % 2 === 0;
    for (let k = 0; k < s; k++) {
      const t = (k / s) * ridges % 1, shade = 0.55 + 0.6 * (t < 0.5 ? t * 2 : 2 - t * 2);
      g.fillStyle = css(base, shade);
      across ? g.fillRect(i * s + k, j * s, 1, s) : g.fillRect(i * s, j * s + k, s, 1);
    }
  }
  speckle(g, n, rnd, 30000, 0.2, 1);
};
const grille: Paint = (g, n, rnd, base) => {
  g.fillStyle = css(base); g.fillRect(0, 0, n, n);
  g.fillStyle = "rgba(255,255,255,0.08)";
  for (let y = 0; y < n; y += 4) for (let x = (y / 4) % 2 ? 2 : 0; x < n; x += 4) g.fillRect(x, y, 1.5, 1.5);
  speckle(g, n, rnd, 3000, 0.1, 1);
};

/** What each surface is: its painting, how big one tile is, how shiny, and how its bumps read. */
const LOOKS: Record<string, { paint: Paint; metres: number; rough: number; metal?: number; bump?: number; n?: number }> = {
  floorboards: { paint: planks(12), metres: 1.8, rough: 0.42, bump: 0.6 },
  wood: { paint: planks(10, true), metres: 1.6, rough: 0.55, bump: 0.5 },
  woodPanel: { paint: planks(10, true), metres: 1.6, rough: 0.55, bump: 0.5 },
  panel: { paint: rough(20, 50000), metres: 0.6, rough: 1, bump: 0.8 },
  carpet: { paint: rough(30, 60000), metres: 1, rough: 1, bump: 1.2 },
  curtain: { paint: folds, metres: 1.4, rough: 0.95, bump: 3 },
  foam: { paint: wedges, metres: 1.2, rough: 1, bump: 4 },
  brick: { paint: bricks, metres: 1.4, rough: 0.9, bump: 2.5 },
  concrete: { paint: rough(60, 30000), metres: 2.5, rough: 0.8, bump: 0.6 },
  stone: { paint: tiles(3, 0.7, 2), metres: 2.4, rough: 0.3, bump: 0.4 },
  tile: { paint: tiles(6, 0.85, 3), metres: 1.2, rough: 0.2, bump: 0.6 },
  plaster: { paint: rough(80, 20000), metres: 2, rough: 0.9 },
  drywall: { paint: rough(40, 12000), metres: 2, rough: 0.88 },
  ceilingTile: { paint: tiles(4, 0.7, 7), metres: 2.4, rough: 0.95, bump: 1.4 },
  fabric: { paint: rough(20, 50000), metres: 0.6, rough: 0.95, bump: 0.8 },
  grille: { paint: grille, metres: 0.25, rough: 0.9, bump: 0.6, n: 256 },
};
const painted = new Map<string, Painted>();
function paint(name: string, base: THREE.Color): Painted | null {
  const l = LOOKS[name];
  if (!l) return null;
  const id = `${name}:${base.getHexString()}`, hit = painted.get(id);
  if (hit) return hit;
  const n = l.n ?? 1024, seed = [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const map = canvasTex(n, (g) => l.paint(g, n, mulberry32(seed), base), true);
  // the bump is the same painting in grey: dark seams sink, light grain stands up
  // one filtered copy, not a filter on every stroke (that took the GL context down in headless Chrome)
  const img = map.image;
  const bump = l.bump && img instanceof HTMLCanvasElement ? canvasTex(n, (g) => { g.filter = "grayscale(1) contrast(1.6)"; g.drawImage(img, 0, 0); }, false) : undefined;
  const p = { map, bump, metres: l.metres };
  painted.set(id, p);
  return p;
}

const mats = new Map<string, THREE.MeshStandardMaterial>();
type Kit = (name: string, color?: string) => THREE.MeshStandardMaterial | null;
let kit: Kit | null = null;
/** Gear surfaces (metal, plastic, rubber, tolex, cloth, steel, ply, grille) from the photo-texture kit (gear-kit.ts):
 * set once before the room is built, and `surface()` asks it first. Left unset (tests, a tool page), they're flat. */
export function useKit(k: Kit) { kit = k; }
/**
 * A material by what it is made of: a room material (sound.ts's names: floorboards, wood, carpet, foam, panel, slats,
 * curtain, brick, concrete, stone, tile, plaster, drywall, ceilingTile, glass), `woodPanel` (wood as a wall's veneer), or `metal`, `chrome`, `plastic`, `rubber`, `fabric`,
 * `grille`, `screen`. The colour tints it (a room material's own colour when left out). Shared: don't change it.
 * Geometry built with it should carry UVs in metres (`metreUV`) so the grain comes out the right size.
 */
export function surface(name: string, color?: string): THREE.MeshStandardMaterial {
  const as = name === "woodPanel" ? "wood" : name;
  const known = as in MATERIALS ? MATERIALS[as as Material].color : "#808080";
  const id = `${name}:${color ?? known}`, hit = mats.get(id);
  if (hit) return hit;
  const fromKit = kit?.(name, color);
  if (fromKit) { mats.set(id, fromKit); return fromKit; }
  const c = new THREE.Color(color ?? known), l = LOOKS[name];
  let m: THREE.MeshStandardMaterial;
  // glass is nearly clear: blended in linear light a few percent of a pale tint fogs the dark room behind it; its
  // reflections are what say it's there
  if (name === "glass") m = new THREE.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.35), transparent: true, opacity: 0.04, roughness: 0.04, metalness: 0, envMapIntensity: 1.6, depthWrite: false });
  else if (name === "metal") m = new THREE.MeshStandardMaterial({ color: c, metalness: 0.85, roughness: 0.38 });
  else if (name === "chrome") m = new THREE.MeshStandardMaterial({ color: c, metalness: 1, roughness: 0.12 });
  else if (name === "plastic") m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.45 });
  else if (name === "rubber") m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 });
  else if (name === "screen") m = new THREE.MeshStandardMaterial({ color: "#05070a", emissive: c, emissiveIntensity: 1.4, roughness: 0.2 });
  else {
    const p = paint(name, c);
    m = new THREE.MeshStandardMaterial({ color: p ? 0xffffff : c, map: p?.map ?? null, bumpMap: p?.bump ?? null, bumpScale: l?.bump ?? 1, roughness: l?.rough ?? 0.85, metalness: l?.metal ?? 0 });
    if (p) { const s = 1 / p.metres; for (const t of [p.map, p.bump]) t?.repeat.set(s, s); }
  }
  m.name = name;
  mats.set(id, m);
  return m;
}

/** What an outside or inside wall of `m` is drawn in: wood on a wall is veneer sheets, its grain running up. */
export const wallSurface = (m: Material) => m === "wood" ? "woodPanel" : m;
/** Walls with no paint on them: no skirting along their foot, and no roller marks. */
const BARE = new Set<Material>(["brick", "stone", "concrete", "tile", "glass"]);

/** Give a geometry UVs in metres from its own positions, each face projected along the axis it faces. */
export function metreUV<G extends THREE.BufferGeometry>(geo: G, at: [number, number, number] = [0, 0, 0]): G {
  const p = geo.getAttribute("position"), nrm = geo.getAttribute("normal"), uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + at[0], y = p.getY(i) + at[1], z = p.getZ(i) + at[2];
    const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i)), az = Math.abs(nrm.getZ(i));
    const [u, v] = ay >= ax && ay >= az ? [x, z] : ax >= az ? [z, y] : [x, y];
    uv[i * 2] = u; uv[i * 2 + 1] = v;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geo;
}

// ---- the room's dressing from its data: absorbers, curtains, skirting, the lights in the ceiling ----

let skirtPaint: THREE.MeshStandardMaterial | null = null, joint: THREE.MeshStandardMaterial | null = null, felt: THREE.MeshStandardMaterial | null = null;
const jointMat = () => (joint ??= new THREE.MeshStandardMaterial({ color: "#0e0a07", roughness: 1, name: "veneer-joint" }));
const at = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T => { o.position.set(x, y, z); return o; };

/**
 * A slatted wood diffuser `wide` by `tall`, its left edge `from` metres along the wall: walnut slats 4.5 cm wide on
 * a black felt backing, 1.8 cm apart, their depths stepping through a quadratic residue sequence (n² mod 7) the way a
 * real diffuser's are cut, so the light catches a skyline of ends, not a flat fence.
 */
export function slats(wide: number, tall: number, from: number): THREE.Group {
  const g = new THREE.Group(), y = 0.3 + tall / 2, wood = surface("woodPanel", "#7a5434");
  felt ??= new THREE.MeshStandardMaterial({ color: "#121214", roughness: 1, name: "felt" });
  g.add(at(new THREE.Mesh(new THREE.BoxGeometry(wide, tall, 0.012), felt), from + wide / 2, y, 0.066));
  const pitch = 0.063, n = Math.max(1, Math.floor((wide - 0.045) / pitch) + 1), x0 = from + (wide - (n - 1) * pitch) / 2;
  for (let i = 0; i < n; i++) {
    const deep = 0.025 + ((i * i) % 7) * 0.012, x = x0 + i * pitch;
    g.add(at(new THREE.Mesh(metreUV(new THREE.BoxGeometry(0.045, tall, deep), [x, y, 0]), wood), x, y, 0.072 + deep / 2));
  }
  // a frame along the top and the bottom
  for (const fy of [0.3, 0.3 + tall]) g.add(at(new THREE.Mesh(metreUV(new THREE.BoxGeometry(wide + 0.04, 0.04, 0.11)), wood), from + wide / 2, fy, 0.115));
  return flatten(g);
}

/** Where an outside wall is: its middle, which way along it runs, and the way into the room. */
function sideOf(def: StudioDef, side: Side) {
  const { w, d } = def.size;
  return side === "back" ? { cx: 0, cz: -d / 2, len: w, turn: 0 }
    : side === "front" ? { cx: 0, cz: d / 2, len: w, turn: Math.PI }
    : side === "left" ? { cx: -w / 2, cz: 0, len: d, turn: Math.PI / 2 }
    : { cx: w / 2, cz: 0, len: d, turn: -Math.PI / 2 };
}

let wedgeGeo: THREE.BufferGeometry | null = null;
/**
 * A 58 cm absorber of wedge foam as geometry: a 2.5 cm base, then four by four squares of three ridges each, 3.5 cm
 * tall, every square turned a quarter from its neighbours as the sheets come. Back at z = 0, facing +z. The colour
 * on each corner is how much of the room it sees: the valleys between ridges are dark, the peaks light.
 */
export function wedges3d(size = 0.58, cells = 4, ridges = 3, base = 0.025, peak = 0.035): THREE.BufferGeometry {
  if (wedgeGeo && size === 0.58) return wedgeGeo;
  const pos: number[] = [], col: number[] = [], h = size / 2;
  type P = [number, number, number];
  // a triangle wound to face `out`
  const tri = (a: P, b: P, c: P, k: [number, number, number], out: P) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const [p1, p2, k1, k2] = n[0]! * out[0] + n[1]! * out[1] + n[2]! * out[2] >= 0 ? [b, c, k[1], k[2]] : [c, b, k[2], k[1]];
    for (const [p, s] of [[a, k[0]], [p1, k1], [p2, k2]] as const) { pos.push(...p); col.push(s, s, s); }
  };
  const dark = 0.32, lit = 1;
  const cell = size / cells, period = cell / ridges;
  for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
    const x0 = -h + i * cell, y0 = -h + j * cell, alongY = (i + j) % 2 === 0;
    // in the square's own frame: `a` across the ridges, `b` along them; to x, y
    const at = (a: number, b: number, z: number): P => alongY ? [x0 + a, y0 + b, z] : [x0 + b, y0 + a, z];
    const across: P = alongY ? [1, 0, 0] : [0, 1, 0], along: P = alongY ? [0, 1, 0] : [1, 0, 0];
    for (let k = 0; k < ridges; k++) {
      const a0 = k * period, am = a0 + period / 2, a1 = a0 + period, top = base + peak;
      for (const [va, sgn] of [[a0, -1], [a1, 1]] as const) {
        const out: P = [across[0] * sgn, across[1] * sgn, 1];
        tri(at(va, 0, base), at(am, 0, top), at(am, cell, top), [dark, lit, lit], out);
        tri(at(va, 0, base), at(am, cell, top), at(va, cell, base), [dark, lit, dark], out);
      }
      // the ridge's two ends, seen where the next square turns the other way
      for (const [b, sgn] of [[0, -1], [cell, 1]] as const) {
        tri(at(a0, b, base), at(am, b, top), at(a1, b, base), [dark, lit, dark], [along[0] * sgn, along[1] * sgn, 0]);
      }
    }
  }
  // the base's four sides
  for (const [ax, sgn] of [[0, -1], [0, 1], [1, -1], [1, 1]] as const) {
    const e = sgn * h, c = (t: number, z: number): P => ax === 0 ? [e, t, z] : [t, e, z];
    const out: P = ax === 0 ? [sgn, 0, 0] : [0, sgn, 0], k: [number, number, number] = [0.55, 0.75, 0.75];
    tri(c(-h, 0), c(-h, base), c(h, base), k, out);
    tri(c(-h, 0), c(h, base), c(h, 0), [0.55, 0.75, 0.55], out);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals(); // not indexed: each face keeps its own flat normal, as cut foam does
  metreUV(g);
  if (size === 0.58) wedgeGeo = g;
  return g;
}

/** The wedges' material: the foam's colour with a fine open-cell grain, darkened into the valleys by the geometry's colours. */
function foamMat(): THREE.MeshStandardMaterial {
  const id = "foam:wedges", hit = mats.get(id);
  if (hit) return hit;
  const base = MATERIALS.foam.color, p = paint("fabric", new THREE.Color(base));
  const m = new THREE.MeshStandardMaterial({ color: p ? 0xffffff : base, map: p?.map ?? null, bumpMap: p?.bump ?? null, bumpScale: 0.6, roughness: 1, vertexColors: true, envMapIntensity: 0.5 });
  if (p) { const s = 1 / p.metres; for (const t of [p.map, p.bump]) t?.repeat.set(s, s); }
  m.name = "foam-wedges";
  mats.set(id, m);
  return m;
}

/** The absorbers and curtains a room's `panels` list, hung on their walls; skirting along the floor. */
function hang(def: StudioDef, group: THREE.Group) {
  const { h } = def.size;
  for (const side of ["front", "back", "left", "right"] as const) {
    const s = sideOf(def, side), wall = new THREE.Group();
    wall.position.set(s.cx, 0, s.cz); wall.rotation.y = s.turn;
    group.add(wall);
    const made = def.materials?.walls[side] ?? "drywall";
    if (!BARE.has(made)) {
      // a skirting board: 12 cm of painted MDF with a rounded top, in the trim's wood along veneer, satin paint along the rest
      const board = made === "wood" ? surface("woodPanel", def.colors.trim) : (skirtPaint ??= new THREE.MeshStandardMaterial({ color: "#2a2b2f", roughness: 0.42, name: "skirting" }));
      const skirt = new THREE.Mesh(metreUV(new THREE.BoxGeometry(s.len, 0.12, 0.016)), board);
      skirt.position.set(0, 0.06, 0.068);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, s.len, 8), board);
      cap.rotation.z = Math.PI / 2; cap.position.set(0, 0.12, 0.068);
      wall.add(skirt, cap);
    }
    // veneer comes in sheets 1.22 m wide and 2.44 m tall: a dark joint where two meet
    if (made === "wood") {
      const joints = new THREE.Group();
      for (let x = -s.len / 2 + 1.22; x < s.len / 2 - 0.1; x += 1.22) joints.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.005, h, 0.002), jointMat()), x, h / 2, 0.0605));
      if (h > 2.6) joints.add(at(new THREE.Mesh(new THREE.BoxGeometry(s.len, 0.005, 0.002), jointMat()), 0, 2.44, 0.0605));
      wall.add(flatten(joints));
    }
    const panels = (def.panels ?? []).filter((p) => p.wall === side);
    let along = -s.len / 2 + 0.6; // panels fill the wall from its left end in, a gap between each kind
    for (const p of panels) {
      if (p.material === "curtain") {
        const tall = Math.min(h - 0.15, 4.5), wide = Math.min(s.len - 0.4, p.m2 / tall);
        const geo = new THREE.PlaneGeometry(wide, tall, Math.ceil(wide * 24), 1), pos = geo.getAttribute("position");
        for (let i = 0; i < pos.count; i++) pos.setZ(i, 0.05 * Math.sin(pos.getX(i) * 2 * Math.PI * 4.5)); // the folds
        geo.computeVertexNormals();
        const c = new THREE.Mesh(metreUV(geo), surface("curtain"));
        c.position.set(Math.min(along + wide / 2, s.len / 2 - wide / 2 - 0.2), tall / 2 + (h - tall) - 0.1, 0.16); wall.add(c);
        const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, wide + 0.2, 8), surface("metal", "#2a2b2e"));
        rail.rotation.z = Math.PI / 2; rail.position.set(c.position.x, h - 0.08, 0.16); wall.add(rail);
        along += wide + 0.5;
      } else if (p.material === "panel") {
        // fabric-wrapped absorbers: 60 by 120 cm, 10 cm deep with soft rounded edges, standing tall at ear height,
        // two rows on a tall wall when one won't fit them
        const n = Math.max(1, Math.round(p.m2 / 0.72)), room = s.len / 2 - along - 0.3;
        const rows = n * 0.7 > room && h > 3 ? 2 : 1, cols = Math.ceil(n / rows), cell = Math.min(0.7, room / cols);
        const geo = metreUV(new RoundedBoxGeometry(0.6, 1.2, 0.1, 3, 0.025)), mat = surface("panel");
        const row = new THREE.Group();
        for (let i = 0; i < n; i++) row.add(at(new THREE.Mesh(geo, mat), along + 0.3 + (i % cols) * cell, rows === 1 ? 1.5 : 0.95 + Math.floor(i / cols) * 1.3, 0.11));
        wall.add(flatten(row));
        along += cols * cell + 0.5;
      } else if (p.material === "slats") {
        wall.add(slats(Math.min(s.len / 2 - along - 0.3, p.m2 / Math.min(h - 0.6, 2.4)), Math.min(h - 0.6, 2.4), along));
        along += Math.min(s.len / 2 - along - 0.3, p.m2 / Math.min(h - 0.6, 2.4)) + 0.5;
      } else {
        // absorbers: 60 cm squares, five centimetres proud of the wall, centred at ear height, in rows of two or three
        const n = Math.max(1, Math.round(p.m2 / 0.36)), rows = Math.min(3, Math.max(1, Math.round(Math.sqrt(n / 2)))), cols = Math.ceil(n / rows);
        // foam is cut as real wedges, so the downlights rake across its ridges; anything else is a flat box
        const foam = p.material === "foam", tile = foam ? wedges3d() : new THREE.BoxGeometry(0.58, 0.58, 0.05);
        const mat = foam ? foamMat() : surface(p.material);
        const room = s.len / 2 - along - 0.3, cell = Math.min(0.64, room / Math.max(1, cols));
        for (let i = 0; i < n; i++) {
          const c = i % cols, r = Math.floor(i / cols), m = new THREE.Mesh(foam ? tile : metreUV(tile.clone()), mat);
          m.position.set(along + 0.3 + c * cell, 1.45 + (r - (rows - 1) / 2) * 0.64, foam ? 0.06 : 0.085);
          wall.add(m);
        }
        along += cols * cell + 0.5;
      }
    }
  }
}

// ---- light that stays put, baked once: where things meet the floor, and the room's own reflections ----

/**
 * The floor's contact shadows and ambient occlusion, baked once from below: everything within `reach` of the floor is
 * drawn looking up, darker the lower it is, then blurred twice, a little for the dark line where a leg or a wall meets
 * the floor and a lot for the soft shade under a desk or a kit. Two planes just over the floor carry them. The people
 * aren't in the room yet when it is baked, so only what stands still is. Returns the bake's texels across.
 */
function ground(renderer: THREE.WebGLRenderer, scene: THREE.Scene, group: THREE.Group, def: StudioDef, high: boolean): number {
  const { w, d } = def.size, n = high ? 1024 : 512, reach = 1.1;
  const target = () => new THREE.WebGLRenderTarget(n, n, { type: THREE.HalfFloatType });
  const [a, b] = [target(), target()];
  const cam = new THREE.OrthographicCamera(-w / 2, w / 2, d / 2, -d / 2, 0.01, reach + 0.02);
  cam.position.y = -0.02; // just under the floor, so a box standing on it is seen by its underside, not clipped
  cam.rotation.x = Math.PI / 2; // looking up from the floor, so the undersides of what stands on it are what it sees
  // black, its alpha how near the floor it is, falling off as a square so only what's close casts much
  const depth = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
  depth.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace("gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );", "float k = 1.0 - fragCoordZ; gl_FragColor = vec4( vec3( 0.0 ), k * k );");
  };
  const was = { target: renderer.getRenderTarget(), alpha: renderer.getClearAlpha(), color: renderer.getClearColor(new THREE.Color()), bg: scene.background, over: scene.overrideMaterial, shadows: renderer.shadowMap.autoUpdate };
  // the glass casts nothing, and what lies flat on the floor (the floor, a rug) is the floor
  const hidden: THREE.Object3D[] = [], box = new THREE.Box3();
  scene.updateMatrixWorld();
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.visible) return;
    box.setFromObject(o);
    if ((o.material instanceof THREE.Material && o.material.transparent) || (box.max.y - box.min.y < 0.03 && box.min.y < 0.03)) { o.visible = false; hidden.push(o); }
  });
  scene.background = null; scene.overrideMaterial = depth; renderer.shadowMap.autoUpdate = false;
  renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(a); renderer.clear(); renderer.render(scene, cam);
  scene.overrideMaterial = was.over;
  // blur, ping-ponging the two targets: `px` texels each way, horizontally then vertically
  const blurH = new ShaderPass(HorizontalBlurShader), blurV = new ShaderPass(VerticalBlurShader);
  const quad = new FullScreenQuad();
  const blur = (px: number) => {
    for (const [pass, from, to, key] of [[blurH, a, b, "h"], [blurV, b, a, "v"]] as const) {
      pass.uniforms.tDiffuse.value = from.texture; pass.uniforms[key].value = px / n;
      quad.material = pass.material; renderer.setRenderTarget(to); renderer.clear(); quad.render(renderer);
    }
  };
  const copy = (src: THREE.WebGLRenderTarget) => { const c = target(); quad.material = new THREE.MeshBasicMaterial({ map: src.texture, transparent: true, blending: THREE.NoBlending }); renderer.setRenderTarget(c); renderer.clear(); quad.render(renderer); return c; };
  const k = n / 1024; // the blurs are in centimetres: a texel is about 1 cm on high in a 10 m room
  blur(0.9 * k); blur(0.6 * k);
  const tight = copy(a);
  for (let i = 0; i < 5; i++) blur((2 + i) * k);
  renderer.setRenderTarget(was.target); renderer.setClearColor(was.color, was.alpha);
  scene.background = was.bg; renderer.shadowMap.autoUpdate = was.shadows;
  for (const o of hidden) o.visible = true;
  quad.dispose(); depth.dispose(); b.dispose();
  // the tight line is dark; the wide shade is lighter, since the downlights and the bounce still reach under things
  for (const [rt, opacity] of [[tight, 1], [a, 0.8]] as const) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), shade(rt.texture, opacity));
    m.rotation.x = -Math.PI / 2; m.scale.y = -1; m.position.y = 0.002; m.name = "ground";
    group.add(m);
  }
  return n;
}

/** A see-through black that darkens what's under it by its texture's alpha: drawn over a surface, never hiding it. */
function shade(map: THREE.Texture, opacity: number) {
  return new THREE.MeshBasicMaterial({ color: 0x000000, map, transparent: true, opacity, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 });
}

let fillWash: THREE.CanvasTexture | null = null, fade: THREE.CanvasTexture | null = null, shadeGlow: THREE.CanvasTexture | null = null, ceilingFade: THREE.CanvasTexture | null = null;
/**
 * The shade light doesn't reach into a room's corners: along the foot and the top of every outside wall, and up
 * each corner where two walls meet, a band that fades out over half a metre or so.
 */
function corners(def: StudioDef, group: THREE.Group) {
  // one gradient, dark at its bottom edge, eased so it melts into the wall
  fade ??= canvasTex(64, (g) => {
    for (let y = 0; y < 64; y++) { const t = 1 - y / 63; g.fillStyle = `rgba(0,0,0,${(t * t * t).toFixed(3)})`; g.fillRect(0, 63 - y, 64, 1); }
  }, false);
  fade.wrapS = fade.wrapT = THREE.ClampToEdgeWrapping;
  const { h } = def.size, mat = shade(fade, 0.55), top = shade(fade, 0.22), deep = shade(fade, 0.72); // the bounce off the floor lights the tops: only a hint of shade there
  for (const side of ["front", "back", "left", "right"] as const) {
    const s = sideOf(def, side), wall = new THREE.Group();
    wall.position.set(s.cx, 0, s.cz); wall.rotation.y = s.turn;
    group.add(wall);
    const band = (wide: number, tall: number, x: number, y: number, turn: number, m0 = mat) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(wide, tall), m0);
      m.position.set(x, y, 0.062); m.rotation.z = turn; m.name = "corner"; wall.add(m);
    };
    band(s.len, 0.7, 0, 0.35, 0); // the foot
    band(s.len, 0.6, 0, h - 0.3, Math.PI, top); // the top, dark side up
    // the corners, dark side toward each end: the plane turned on its side, so its "wide" runs up the wall
    band(h, 0.9, -s.len / 2 + 0.51, h / 2, -Math.PI / 2, deep); // deeper and wider than the foot: two walls shade each other
    band(h, 0.9, s.len / 2 - 0.51, h / 2, Math.PI / 2, deep);
  }
  // the fill between the pools: light that has bounced round the room reaches every wall from all over it, soft
  // and shadowless, brightest at head height and fading to the floor and the ceiling. Baked as a faint wash of the
  // wall's own colour added over it (what that light would show of it), not four more lights: those cost a third of a frame.
  fillWash ??= canvasTex(64, (g) => {
    for (let y = 0; y < 64; y++) { const t = (y / 63 - 0.55) / 0.42, a = Math.exp(-t * t * 1.6); g.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`; g.fillRect(0, 63 - y, 64, 1); }
  }, false);
  fillWash.wrapS = fillWash.wrapT = THREE.ClampToEdgeWrapping;
  const wash = new THREE.MeshBasicMaterial({ color: new THREE.Color(def.colors.walls).lerp(new THREE.Color(0xffe2c0), 0.25).multiplyScalar(0.22), map: fillWash, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
  for (const side of ["front", "back", "left", "right"] as const) {
    const s = sideOf(def, side), m = new THREE.Mesh(new THREE.PlaneGeometry(s.len, h), wash);
    m.position.set(s.cx, h / 2, s.cz); m.rotation.y = s.turn; m.translateZ(0.06); m.name = "fill";
    group.add(m);
  }
  // the ceiling falls off toward its edges and darkest into its corners: the cans light down, and only the bounce
  // reaches up there, weakest where it has the furthest to come
  ceilingFade ??= canvasTex(64, (g) => {
    const ease = (t: number) => { const k = Math.min(1, t / 0.6); return k * k * (3 - 2 * k); };
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const u = Math.min(x, 63 - x) / 31.5, v = Math.min(y, 63 - y) / 31.5;
      g.fillStyle = `rgba(0,0,0,${(1 - ease(u) * ease(v)) ** 1.6})`; g.fillRect(x, y, 1, 1);
    }
  }, false);
  ceilingFade.wrapS = ceilingFade.wrapT = THREE.ClampToEdgeWrapping;
  const { w, d } = def.size, ceiling = new THREE.Mesh(new THREE.PlaneGeometry(w, d), shade(ceilingFade, 0.8));
  ceiling.rotation.x = Math.PI / 2; ceiling.position.y = h - 0.004; ceiling.name = "corner";
  group.add(ceiling);
}

let roller: THREE.CanvasTexture | null = null;
let sheen: THREE.CanvasTexture | null = null;
/**
 * Paint that was rolled on by hand: no wall comes out one flat grey. Each outside wall gets a faint pattern of the
 * roller's overlapping strokes and patched spots darkening it a little, and a slight cast of its own, the walls by the
 * lamps a touch warmer and the ones opposite a touch cooler, as light that has bounced off different things reaches them.
 */
function walls(def: StudioDef, group: THREE.Group) {
  roller ??= canvasTex(256, (g) => {
    const rnd = mulberry32(5153);
    // vertical strokes about a roller wide (a tile is 2 m, so 30 px is 23 cm), each its own coat, edges soft
    for (let x = -30; x < 256; x += 18 + rnd() * 16) {
      const a = 0.05 + rnd() * 0.12, wide = 24 + rnd() * 14, gr = g.createLinearGradient(x, 0, x + wide, 0);
      gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(0.3, `rgba(0,0,0,${a})`); gr.addColorStop(0.7, `rgba(0,0,0,${a})`); gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr;
      for (const dx of [-256, 0, 256]) g.fillRect(x + dx, 0, wide, 256);
    }
    blotch(g, 256, rnd, 10, 0.16); // filled holes and touch-ups, a shade off the wall
  }, false);
  const { h } = def.size, mat = shade(roller, 0.4);
  roller.repeat.set(0.5, 0.5);
  const lamps = practicals(def);
  for (const side of ["front", "back", "left", "right"] as const) {
    const s = sideOf(def, side), geo = new THREE.PlaneGeometry(s.len, h), uv = geo.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * s.len, uv.getY(i) * h);
    const made = def.materials?.walls[side] ?? "drywall";
    const m = new THREE.Mesh(geo, mat);
    m.position.set(s.cx, h / 2, s.cz); m.rotation.y = s.turn; m.translateZ(0.061); m.name = "roller";
    if (!BARE.has(made) && made !== "wood") group.add(m);
    // warm by a lamp, cool across from one: multiplied over the wall, so it shifts the paint's colour, not its light
    const lit = lamps.some(([x, z]) => Math.hypot(x - s.cx, z - s.cz) < Math.max(def.size.w, def.size.d) / 2 + 0.2);
    const cast = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: lit ? 0xfff0dc : 0xe9eff7, blending: THREE.MultiplyBlending, premultipliedAlpha: true, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    cast.position.copy(m.position); cast.rotation.copy(m.rotation); cast.translateZ(-0.0005); cast.name = "cast";
    group.add(cast);
  }
}

/** Many small meshes as one per material, so a road case of forty parts is a few draw calls. Keeps the root's own place. */
function flatten(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert(), by = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !(o.material instanceof THREE.Material)) return;
    const g = o.geometry.clone();
    g.applyMatrix4(inv.clone().multiply(o.matrixWorld));
    by.set(o.material, [...(by.get(o.material) ?? []), g]);
  });
  const out = new THREE.Group(); out.name = root.name;
  out.position.copy(root.position); out.quaternion.copy(root.quaternion); out.scale.copy(root.scale);
  for (const [m, gs] of by) { const merged = mergeGeometries(gs); if (merged) out.add(new THREE.Mesh(merged, m)); }
  return out;
}

/**
 * The control room's window as a window: every glass wall gets a dark frame, posts at its ends and every three and a
 * half metres, a head along its top and the wall closed over it to the ceiling, and a rubber bead where the pane meets
 * the sill, so looking through it from the desk reads as glass in a wall, not an empty gap.
 */
function windows(def: StudioDef, group: THREE.Group) {
  const { h } = def.size, frame = surface("metal", "#55585d"), bead = surface("rubber", "#101113"), head = surface("drywall", def.colors.walls);
  const top = h - 0.2, low = 0.92;
  sheen ??= canvasTex(128, (g) => {
    const rnd = mulberry32(8);
    for (const [x, wide, a] of [[18, 26, 0.5], [52, 10, 0.3], [88, 34, 0.35]] as const) {
      const k = rnd() * 6, gr = g.createLinearGradient(x + k, 0, x + k + wide, 0);
      gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(0.5, `rgba(255,255,255,${a})`); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.save(); g.translate(64, 64); g.transform(1, 0, -0.6, 1, 0, 0); g.translate(-64, -64); g.fillStyle = gr; g.fillRect(x + k - 80, -20, wide, 170); g.fillRect(x + k + 48, -20, wide, 170); g.restore();
    }
  }, false);
  const sheenMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xdfe9f0).multiplyScalar(0.3), map: sheen, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const edgeGlass = new THREE.MeshStandardMaterial({ color: "#5f8f7c", roughness: 0.1, metalness: 0, transparent: true, opacity: 0.55 });
  for (const wl of def.walls) {
    if (!wl.glass) continue;
    for (const p of wallPieces(wl, 0.12)) {
      const g = new THREE.Group(); g.position.set(p.cx, 0, p.cz); g.rotation.y = p.turn; g.name = "window";
      const box = (bw: number, bh: number, bd: number, y: number, x: number, m: THREE.Material) => {
        const b = new THREE.Mesh(metreUV(new THREE.BoxGeometry(bw, bh, bd)), m); b.position.set(x, y, 0); g.add(b); return b;
      };
      const len = p.hw * 2, n = Math.max(1, Math.ceil(len / 3.4));
      for (let i = 0; i <= n; i++) box(0.05, top - low, p.hd * 2 + 0.04, (top + low) / 2, -p.hw + (i / n) * len + (i === 0 ? 0.025 : i === n ? -0.025 : 0), frame);
      // the pane's own edge, green where it sits in the frame: the one place thick glass shows its colour
      for (const y of [low + 0.012, top - 0.07]) { const e = box(len, 0.012, 0.012, y, 0, edgeGlass); e.position.z = 0; }
      box(len, 0.06, p.hd * 2 + 0.04, top - 0.03, 0, frame); // the head
      box(len, h - top, p.hd * 2, (h + top) / 2, 0, head); // the wall over it, to the ceiling
      box(len, 0.025, p.hd * 2 + 0.03, low - 0.008, 0, bead); // where the pane sits on the sill
      // the light the pane catches: a couple of soft streaks across it, added over what's seen through, both faces
      const pane = new THREE.PlaneGeometry(len, top - low - 0.06), uv = pane.getAttribute("uv");
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 2.4, uv.getY(i));
      const st = new THREE.Mesh(pane, sheenMat); st.position.set(0, (top + low) / 2 - 0.03, 0); g.add(st);
      group.add(flatten(g));
    }
  }
}

/**
 * Where a room's road cases stand: against an outside wall, at least 1.4 m from every seat and its instrument, clear of the
 * door, the floor lamps and any inner wall, so nobody walks or plays into them. `pick` (0 to 1) chooses among the free
 * stretches, the same every visit. A hall too big to notice them, or a room with no free wall, gets none.
 */
export function caseSpot(def: StudioDef, pick: number): { at: [number, number]; turn: number } | null {
  const { w, d } = def.size;
  if (w > 16 || d > 16) return null;
  const lamps = practicals(def), door = def.door.at;
  const near = (p: [number, number]) => Math.min(Infinity, ...def.spots.map((s) => { const b = thingBox(s); return Math.min(Math.hypot(p[0] - s.at[0], p[1] - s.at[1]), Math.hypot(p[0] - b.cx, p[1] - b.cz) - Math.max(b.hw, b.hd)); }));
  const free: { at: [number, number]; turn: number }[] = [];
  for (const side of ["front", "back", "left", "right"] as const) {
    const sd = sideOf(def, side), ux = Math.cos(sd.turn), uz = -Math.sin(sd.turn), nx = Math.sin(sd.turn), nz = Math.cos(sd.turn);
    for (let a = -sd.len / 2 + 0.9; a <= sd.len / 2 - 0.9; a += 0.5) {
      const p: [number, number] = [sd.cx + ux * a + nx * 0.38, sd.cz + uz * a + nz * 0.38];
      if (near(p) < 1.4 || Math.hypot(p[0] - door[0], p[1] - door[1]) < 1.2 || lamps.some((l) => Math.hypot(p[0] - l[0], p[1] - l[1]) < 0.9)) continue;
      if (def.walls.some((wl) => toSegment(p, wl.from, wl.to) < 0.7)) continue;
      free.push({ at: p, turn: sd.turn });
    }
  }
  return free.length ? free[Math.floor(pick * free.length)]! : null;
}

/**
 * What a room in use collects on its floor and walls. Every instrument that plugs in runs a cable or two across the
 * boards to the nearest wall, taped down where people walk, into a plate of sockets just over the skirting; road cases
 * stand against a wall nobody plays at, the top one with a mug and a pair of headphones left on it. Placed from the
 * room's data, the same every visit.
 */
function lived(def: StudioDef, group: THREE.Group) {
  const { w, d } = def.size, rnd = mulberry32([...def.id].reduce((a, ch) => (a * 33 + ch.charCodeAt(0)) | 0, 11));
  const rubber = surface("rubber", "#0e0f11"), tape = new THREE.MeshStandardMaterial({ color: "#4a4b4d", roughness: 0.62, metalness: 0 });
  const plate = surface("steel", "#c9cacb"), socket = surface("rubber", "#151618");
  const inRoom = (x: number, z: number) => Math.abs(x) < w / 2 - 0.1 && Math.abs(z) < d / 2 - 0.1;
  // the nearest outside wall to a point: where on it, and which way the room is from there
  const wallAt = (x: number, z: number) => {
    const opts = [{ x, z: -d / 2, nx: 0, nz: 1, dist: z + d / 2 }, { x, z: d / 2, nx: 0, nz: -1, dist: d / 2 - z }, { x: -w / 2, z, nx: 1, nz: 0, dist: x + w / 2 }, { x: w / 2, z, nx: -1, nz: 0, dist: w / 2 - x }];
    return opts.sort((a, b) => a.dist - b.dist)[0]!;
  };
  const crosses = (a: [number, number], b: [number, number]) => def.walls.some((wl) => {
    const [x1, z1] = wl.from, [x2, z2] = wl.to, side = (px: number, pz: number) => Math.sign((x2 - x1) * (pz - z1) - (z2 - z1) * (px - x1));
    const other = (px: number, pz: number) => Math.sign((b[0] - a[0]) * (pz - a[1]) - (b[1] - a[1]) * (px - a[0]));
    return side(a[0], a[1]) !== side(b[0], b[1]) && other(x1, z1) !== other(x2, z2);
  });
  const taped = new THREE.Group(); taped.name = "tape";
  for (const s of def.spots) {
    if (s.kind !== "keys" && s.kind !== "bass") continue;
    const b = thingBox(s), wall = wallAt(b.cx, b.cz);
    if (crosses([b.cx, b.cz], [wall.x, wall.z])) continue; // an inner wall in the way: it goes under the floor there
    for (const k of [0, 1]) {
      // from under the instrument to the wall, wandering a little as a cable kicked about does, flat on the boards
      const off = (k - 0.5) * 0.09, ex = wall.x + wall.nx * 0.12 + wall.nz * off, ez = wall.z + wall.nz * 0.12 + wall.nx * off;
      const sx = b.cx + (rnd() - 0.5) * 0.3, sz = b.cz + (rnd() - 0.5) * 0.2, steps = Math.max(3, Math.round(Math.hypot(ex - sx, ez - sz) / 0.45));
      const pts: THREE.Vector3[] = [new THREE.Vector3(sx, 0.55, sz), new THREE.Vector3(sx + 0.03, 0.05, sz + 0.02)];
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, sway = Math.sin(t * Math.PI) * (rnd() - 0.5) * 0.35;
        const x = sx + (ex - sx) * t + wall.nz * sway, z = sz + (ez - sz) * t + wall.nx * sway;
        if (inRoom(x, z) || i === steps) pts.push(new THREE.Vector3(x, 0.005, z));
      }
      pts.push(new THREE.Vector3(ex - wall.nx * 0.03, 0.14, ez - wall.nz * 0.03), new THREE.Vector3(ex - wall.nx * 0.045, 0.27, ez - wall.nz * 0.045));
      const curve = new THREE.CatmullRomCurve3(pts);
      group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, pts.length * 12, 0.0045, 6), rubber));
      // tape across it every metre or so where it lies flat, the last strip short of the wall
      if (k === 1) for (let t = 0.3; t < 0.85; t += 0.22 + rnd() * 0.12) {
        const p = curve.getPointAt(t), dir = curve.getTangentAt(t);
        if (p.y > 0.02) continue;
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.0012, 0.048), tape);
        strip.position.set(p.x, 0.0055, p.z); strip.rotation.y = Math.atan2(dir.x, dir.z) + (rnd() - 0.5) * 0.25;
        taped.add(strip);
      }
    }
    // the plate the cables go into, over the skirting
    const pg = new THREE.Group(); pg.position.set(wall.x, 0.3, wall.z); pg.rotation.y = Math.atan2(wall.nx, wall.nz);
    const pl = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.012), plate); pl.position.z = 0.066; pg.add(pl);
    for (const x of [-0.07, 0, 0.07]) { const so = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.006, 14).rotateX(Math.PI / 2), socket); so.position.set(x, 0, 0.074); pg.add(so); }
    group.add(flatten(pg));
  }
  group.add(flatten(taped));
  // road cases against a wall nobody plays at (caseSpot())
  const pick = caseSpot(def, rnd());
  if (!pick) return;
  const tolex = surface("tolex", "#141416"), edge = surface("metal", "#b9bcc0"), latch = surface("chrome", "#c8cacd");
  const stack = new THREE.Group(); stack.position.set(pick.at[0], 0, pick.at[1]); stack.rotation.y = pick.turn + (rnd() - 0.5) * 0.08; stack.name = "road-cases";
  const caseAt = (cw: number, ch: number, cd: number, y: number, turn: number) => {
    const c = new THREE.Group(); c.position.y = y; c.rotation.y = turn; stack.add(c);
    const body = new THREE.Mesh(metreUV(new THREE.BoxGeometry(cw, ch, cd)), tolex); body.position.y = ch / 2; c.add(body);
    // aluminium extrusions along every edge, the lid's seam a third of the way down, ball corners, two latches, a handle
    const e = 0.018;
    for (const sy of [0, ch, ch * 0.68]) for (const sz of [-cd / 2, cd / 2]) { const bar = new THREE.Mesh(new THREE.BoxGeometry(cw + 0.004, e, e), edge); bar.position.set(0, sy, sz); c.add(bar); }
    for (const sy of [0, ch]) for (const sx of [-cw / 2, cw / 2]) { const bar = new THREE.Mesh(new THREE.BoxGeometry(e, e, cd + 0.004), edge); bar.position.set(sx, sy, 0); c.add(bar); }
    for (const sx of [-cw / 2, cw / 2]) for (const sz of [-cd / 2, cd / 2]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(e, ch, e), edge); bar.position.set(sx, ch / 2, sz); c.add(bar);
      for (const sy of [0.012, ch - 0.012]) { const ball = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), latch); ball.position.set(sx, sy, sz); c.add(ball); }
    }
    for (const sx of [-cw * 0.3, cw * 0.3]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.012), latch); l.position.set(sx, ch * 0.68, cd / 2 + 0.008); c.add(l); }
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 6, 14, Math.PI), rubber); handle.position.set(cw / 2 + 0.012, ch * 0.45, 0); handle.rotation.set(0, Math.PI / 2, 0); c.add(handle);
  };
  caseAt(0.9, 0.52, 0.5, 0, 0);
  caseAt(0.62, 0.3, 0.42, 0.53, (rnd() - 0.5) * 0.3);
  // left on top: a mug and a pair of closed-back headphones
  const mug = new THREE.Group(); mug.position.set(-0.12, 0.83, 0.05);
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.04, 0.095, 20), new THREE.MeshStandardMaterial({ color: "#e8e1d6", roughness: 0.3 })); cup.position.y = 0.048;
  const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.038, 18), new THREE.MeshStandardMaterial({ color: "#2a170c", roughness: 0.15 })); coffee.rotation.x = -Math.PI / 2; coffee.position.y = 0.086;
  const ear = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.008, 6, 14), cup.material); ear.position.set(0.05, 0.05, 0);
  mug.add(cup, coffee, ear); stack.add(mug);
  const cans2 = new THREE.Group(); cans2.position.set(0.14, 0.83, -0.02); cans2.rotation.set(-Math.PI / 2 + 0.12, 0, 0.6);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.009, 6, 20, Math.PI), plate.clone()); band.material.color.set("#2b2c2f");
  cans2.add(band);
  for (const sx of [-0.085, 0.085]) {
    const cup2 = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.035, 18), rubber); cup2.rotation.z = Math.PI / 2; cup2.position.set(sx, 0, 0);
    cans2.add(cup2);
  }
  cans2.position.y = 0.83 + 0.05;
  stack.add(cans2);
  group.add(flatten(stack));
}

/**
 * Where the ceiling's downlights go in a room `w` by `d` metres: a grid of cans, at most three each way. In a room
 * of a normal size the outer ones sit about a metre off the walls, as an installer sets them, so each throws a scallop
 * of light down its wall; a hall too big for nine cans keeps them evenly spread instead.
 */
export function cans(w: number, d: number): [number, number][] {
  const row = (len: number) => {
    const k = Math.max(1, Math.min(3, Math.round(len / 3.2))), inset = len > 12 ? len / (2 * k) : Math.min(1.1, len / 4);
    return Array.from({ length: k }, (_, i) => (k === 1 ? 0 : -len / 2 + inset + (i * (len - 2 * inset)) / (k - 1)));
  };
  const xs = row(w), zs = row(d);
  return xs.flatMap((x) => zs.map((z): [number, number] => [x, z]));
}

/** How far a point is from the segment a to b, on the floor. */
function toSegment(p: [number, number], a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0], dz = b[1] - a[1], len2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

/**
 * Where a room's floor lamps stand: the corners nobody plays in, as a real room keeps a lamp or two out of the way
 * for warm light at head height. A corner is free when no seat is within 1.4 m, no inner wall within half a
 * metre and no furniture the room set there (a desk, a cabinet); of those, the two farthest from any seat, at most. A hall too big for a lamp to tell gets none.
 */
export function practicals(def: StudioDef): [number, number][] {
  const { w, d } = def.size;
  if (w > 16 || d > 16) return [];
  const inset = 0.45, near = (p: [number, number]) => Math.min(Infinity, ...def.spots.map((s) => Math.hypot(p[0] - s.at[0], p[1] - s.at[1])));
  const free = ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const)
    .map(([sx, sz]): [number, number] => [sx * (w / 2 - inset), sz * (d / 2 - inset)])
    .filter((p) => near(p) > 1.4 && def.walls.every((wl) => toSegment(p, wl.from, wl.to) > 0.5) && (def.props ?? []).every((q) => !propBlocks(q) || Math.hypot(p[0] - q.at[0], p[1] - q.at[1]) > Math.max(q.w, q.d) / 2 + 0.35));
  return free.sort((a, b) => near(b) - near(a)).slice(0, 2);
}

export interface LookState { quality: Quality; lights: number; shadows: number; post: string[]; tone: string; exposure: number; drawCalls: number; triangles: number; fps: number; ground: number; env: "room" | "generated" }

/** The renderer set up for one room: call `render` every frame and `resize` with the canvas. */
export interface Look { render(camera: THREE.Camera): void; resize(w: number, h: number): void; state(): LookState; quality: Quality }

export function dress(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, def: StudioDef, quality: Quality): Look {
  const high = quality === "high";
  renderer.info.autoReset = false; // a frame through the post is several passes: count them all
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = high;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(high ? 1.5 : 1, devicePixelRatio));
  // reflections and the soft fill a real room's bounce light gives, from a generated room (no download)
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.32;
  pm.dispose();
  scene.background = new THREE.Color(0x0d0e10);

  const group = new THREE.Group();
  group.name = "look";
  scene.add(group);
  hang(def, group);
  corners(def, group);
  walls(def, group);
  windows(def, group);
  lived(def, group);
  scene.add(new THREE.HemisphereLight(0xf4efe8, 0x4a3a2e, 0.42)); // the bounce that reaches the tops of the walls

  // downlights in the ceiling (cans()), each a warm spot with a soft edge; on high the ones nearest the middle throw shadows
  const { w, d, h } = def.size, spots = cans(w, d);
  const can = new THREE.CylinderGeometry(0.09, 0.09, 0.02, 20), rim = new THREE.TorusGeometry(0.095, 0.012, 6, 24);
  const bulb = new THREE.MeshStandardMaterial({ color: "#000", emissive: "#ffe6c4", emissiveIntensity: 6 }), trim = surface("metal", "#d9d6d0");
  const lights: THREE.SpotLight[] = [];
  const per = (w * d) / spots.length, power = 16 * per * Math.max(1, h / 3.4); // candela, so a big room's few lights still light it
  // no two cans alike, as in a real room: lamps of different ages, a touch warmer or brighter, the same every visit
  const rnd = mulberry32([...def.id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7));
  const warm = new THREE.Color(0xffd2a0), cool = new THREE.Color(0xffe8cc);
  for (const [x, z] of spots) {
    const l = new THREE.SpotLight(warm.clone().lerp(cool, rnd()), power * (0.72 + rnd() * 0.45), 0, Math.PI * (0.29 + rnd() * 0.05), 0.78 + rnd() * 0.15, 2); // a real can throws a scallop whose edge melts into the wall, each its own
    l.position.set(x, h - 0.03, z);
    l.target.position.set(x, 0, z);
    group.add(l, l.target);
    lights.push(l);
    const c = new THREE.Mesh(can, bulb); c.position.set(x, h - 0.012, z);
    const r = new THREE.Mesh(rim, trim); r.rotation.x = Math.PI / 2; r.position.set(x, h - 0.02, z);
    group.add(c, r);
  }
  const shadowers = high ? [...lights].sort((a, b) => Math.hypot(a.position.x, a.position.z) - Math.hypot(b.position.x, b.position.z)).slice(0, 3) : [];
  for (const l of shadowers) {
    l.castShadow = true;
    l.shadow.mapSize.set(1024, 1024);
    l.shadow.bias = -0.0004; l.shadow.normalBias = 0.03; l.shadow.radius = 4;
    l.shadow.camera.near = 0.2; l.shadow.camera.far = h + 1;
  }

  // the bounce: light the floor throws back up, warm with the floor's colour, as a panel lying on it facing the
  // ceiling. It lifts the tops of the walls and the ceiling's edges out of the black, the way a lit floor does.
  RectAreaLightUniformsLib.init();
  const floorTone = new THREE.Color(def.colors.floor).lerp(new THREE.Color(0xffe0bc), 0.55);
  const bounce = new THREE.RectAreaLight(floorTone, 2.4 * Math.max(1, h / 3.4), w * 0.9, d * 0.9);
  bounce.position.set(0, 0.05, 0);
  bounce.lookAt(0, h, 0);
  group.add(bounce);

  // floor lamps in the free corners (practicals()): a pole, a fabric drum shade glowing from inside, darker at its
  // middle where the cloth is thickest seen edge on; light spills out of its open top and bottom as two cones, the
  // bright hourglass a shaded lamp throws on the wall behind it, and a little through the cloth all round
  const lampLights: THREE.Light[] = [];
  shadeGlow ??= canvasTex(64, (g) => {
    for (let y = 0; y < 64; y++) { const t = Math.abs(y / 63 - 0.5) * 2, k = 0.55 + 0.45 * t * t; g.fillStyle = `rgb(${Math.round(255 * k)},${Math.round(236 * k)},${Math.round(206 * k)})`; g.fillRect(0, y, 64, 1); }
  }, true);
  const shadeMat = new THREE.MeshStandardMaterial({ color: "#8f7150", emissive: "#ff9e4a", emissiveMap: shadeGlow, emissiveIntensity: 0.6, roughness: 0.95, side: THREE.DoubleSide });
  const pole = surface("metal", "#2a2724");
  for (const [x, z] of practicals(def)) {
    const lamp = new THREE.Group(); lamp.name = "floor-lamp"; lamp.position.set(x, 0, z);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.025, 24), pole); foot.position.y = 0.012;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.45, 8), pole); stem.position.y = 0.74;
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.23, 0.3, 28, 1, true), shadeMat); drum.position.y = 1.55;
    const glow = new THREE.PointLight(0xffb878, 0.9, 4, 2); glow.position.y = 1.55;
    lamp.add(foot, stem, drum, glow);
    lampLights.push(glow);
    for (const [dy, cd, cone] of [[0.16, 30, 0.9], [-0.16, 22, 0.8]] as const) {
      const sp = new THREE.SpotLight(0xffc488, cd, 6, cone, 0.8, 2); // the cloth's rim blurs the cone's edge
      sp.position.set(0, 1.55 + dy * 0.2, 0); sp.target.position.set(0, dy > 0 ? 3 : 0, 0);
      lamp.add(sp, sp.target);
      lampLights.push(sp);
    }
    group.add(lamp);
  }

  // baked once the room stands: the shade where things meet the floor, then the reflections, taken from this room
  // under its own lights (from head height in the middle, lit by the generated room as its first bounce), so the
  // floor and the glass show the walls, the lights and the gear in front of them rather than a white box
  const bake = ground(renderer, scene, group, def, high);
  const pm2 = new THREE.PMREMGenerator(renderer);
  bulb.emissiveIntensity = 1.2; // the cans as the room sees them: bright, not a sun smeared across every reflection
  const roomEnv = pm2.fromScene(scene, 0.02, 0.05, Math.hypot(w, d, h), { size: high ? 256 : 128, position: new THREE.Vector3(0, Math.min(1.5, h / 2), 0) });
  pm2.dispose();
  bulb.emissiveIntensity = 6;
  scene.environment = roomEnv.texture;
  scene.environmentIntensity = 0.5; // the downlights light the room already: this is their bounce

  // the post: a little bloom on the lights, the lens's vignette and grain
  const post: string[] = [];
  // (no screen-space AO: its depth pass takes the glass for a wall and fogs the view through it, and it costs the most)
  let composer: EffectComposer | null = null, film: ShaderPass | null = null;
  if (high) {
    composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    composer.addPass(new RenderPass(scene, camera));
    // only light sources bloom (the cans glow at 6): a lit surface under a can, like white keys, stays crisp
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.18, 0.35, 4));
    composer.addPass(new OutputPass());
    film = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, t: { value: 0 } },
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `uniform sampler2D tDiffuse; uniform float t; varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + t) * 43758.5453); }
        void main() {
          vec4 c = texture2D(tDiffuse, vUv);
          vec2 q = vUv - 0.5;
          c.rgb *= 1.0 - dot(q, q) * 0.55;            // the lens darkens toward its corners
          c.rgb += (hash(vUv * 977.0) - 0.5) * 0.025; // film grain
          gl_FragColor = c;
        }`,
    });
    composer.addPass(film);
    post.push("bloom", "vignette", "grain");
  }

  // every mesh casts and takes shadows, glowing ones get their light: checked now and then, as people come and go
  const lamps: THREE.PointLight[] = [];
  let frames = 0, fps = 0, since = performance.now(), count = 0;
  function walk() {
    scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o.userData.looked) return;
      o.userData.looked = true;
      const glow = typeof o.userData.glow === "number" ? o.userData.glow : 0;
      const mat = o.material;
      if (glow > 0 && mat instanceof THREE.MeshStandardMaterial) {
        o.material = mat.clone();
        if (o.material instanceof THREE.MeshStandardMaterial) { if (mat.emissive.getHex() === 0) o.material.emissive.copy(mat.color); /* a screen is dark glass lit by its own colour: keep it */ o.material.emissiveIntensity = 2 * glow; o.material.transparent = false; o.material.opacity = 1; o.material.depthWrite = true; } // a lit bulb is solid light, even one made of glass
        if (o.userData.lamp && lamps.length < 4) { const p = new THREE.PointLight(0xffd7a8, 6 * glow, 6, 2); o.add(p); lamps.push(p); }
        return;
      }
      const see = !(mat instanceof THREE.Material && mat.transparent);
      o.castShadow = see && o.parent !== group;
      o.receiveShadow = see;
    });
  }
  walk();

  return {
    quality,
    render(cam) {
      if (frames++ % 60 === 0) walk();
      renderer.info.reset();
      count++;
      const now = performance.now();
      if (now - since > 1000) { fps = Math.round((count * 1000) / (now - since)); count = 0; since = now; }
      if (composer && film) { film.uniforms.t.value = (now / 1000) % 10; composer.render(); }
      else renderer.render(scene, cam);
    },
    resize(wpx, hpx) {
      renderer.setSize(wpx, hpx, false);
      if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(wpx, hpx); }
    },
    state: () => ({ quality, lights: lights.length + lamps.length + lampLights.length + 1, shadows: shadowers.length, post, tone: "aces", exposure: renderer.toneMappingExposure, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, fps, ground: bake, env: "room" }),
  };
}
