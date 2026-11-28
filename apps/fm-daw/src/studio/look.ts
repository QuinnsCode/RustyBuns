// How a Qollab Studio room looks (#5008): the light, what every surface is made of, and the camera's lens and film.
// A room is data (room.ts); this turns its sizes and materials into something that should read as a photo of a real
// small studio: tone mapped light, ceiling downlights set off the walls so they wash them (no two alike), the floor's warm
// bounce lifting the tops of the walls, a soft fill washing the walls between the pools, the ceiling falling off into its corners, floor lamps in the free corners throwing their hourglass on the walls, soft shadows, contact shadows
// and shade in the corners baked once, reflections of the room itself,
// textures painted in code (planks with grain, ceiling tiles on their grid, wedge foam, folded curtains, brick, carpet),
// the room's absorbers (wedge foam cut as real ridges) and curtains hung where its data says, paint rolled on by hand, a framed
// control-room window whose glass reflects the room, the cables, tape, wall plates and road cases a room in use collects,
// the marks and paper of one people work in (scuffed walls, worn floor, posters, a music stand, a set list, a clock, sockets, air grilles), and on high a camera's depth of field focused on what is at the middle of the view, a little bloom, lens fringing toward the edges, a vignette and grain.
// Graphics settings (graphics.ts, #6475): four presets (low, medium, high, ultra) and the knobs behind them; ?quality=,
// Q or Settings, Graphics picks them, and `running` steps the picture down for the music.
// Other files build their meshes with `surface(name, color)` and mark a lamp or a screen with userData.glow.
import * as THREE from "three";
import { paintDesertFloor } from "@rustybuns/models/ground";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { FullScreenQuad, Pass } from "three/examples/jsm/postprocessing/Pass.js";
import { HorizontalBlurShader } from "three/examples/jsm/shaders/HorizontalBlurShader.js";
import { VerticalBlurShader } from "three/examples/jsm/shaders/VerticalBlurShader.js";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mulberry32 } from "@rustybuns/util";
import { floorAt, propBlocks, thingBox, wallPieces, type Side, type Spot, type StudioDef } from "./room.ts";
import { inFootprint } from "./gear-wall.ts";
import { MATERIALS, type Material } from "./sound.ts";
import { ALL_LIGHTS, pickGraphics, qualityOf, type Graphics, type Quality, type Running } from "./graphics.ts";
import type { StageLights } from "./stage-lights.ts";

export type { Quality };
/** Kept per browser: the knobs as JSON (an older visit kept "low" or "high" here, which still reads). */
const KEY = "qollab-studio:quality";

/** The old two settings, from the same place the graphics come from. */
export const pickQuality = (search: string, stored: string | null, coarse: boolean): Quality => qualityOf(pickGraphics(search, stored, coarse));
export function loadGraphics(): Graphics {
  let stored: string | null = null;
  try { stored = localStorage.getItem(KEY); } catch { /* no storage */ }
  return pickGraphics(location.search, stored, matchMedia("(pointer: coarse)").matches);
}
export const loadQuality = (): Quality => qualityOf(loadGraphics());
export function saveGraphics(g: Graphics) { try { localStorage.setItem(KEY, JSON.stringify(g)); } catch { /* this visit only */ } }

// ---- textures, painted on a canvas: one tile covers `metres` of surface, UVs are in metres (metreUV) ----
interface Painted { map: THREE.Texture; bump?: THREE.Texture; rough?: THREE.Texture; metres: number }
type Paint = (g: CanvasRenderingContext2D, n: number, rnd: () => number, base: THREE.Color) => void;

function canvasTex(n: number, draw: (g: CanvasRenderingContext2D) => void, color: boolean, tall = n): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = n; c.height = tall;
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
  // the walked-on desert floor (@rustybuns/models ground.ts, shared with Sound Guy Simulator's desert)
  sand: { paint: paintDesertFloor, metres: 3, rough: 1, bump: 1.2 },
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

/**
 * How much of the 4% gloss every painted surface has a room surface of colour `c` keeps (a MeshPhysicalMaterial's
 * `specularIntensity`). Paint darker than about 5% (a sound stage's flat black floor) is a matte finish: at full gloss,
 * seen low across the floor under bright cans, its sheen outshines the paint and the black reads light beige (#5257).
 * It keeps a share in step with how dark it is; every lighter colour keeps all of it.
 */
export function gloss(c: THREE.Color): number {
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; // linear light
  return Math.min(1, Math.max(0.12, lum / 0.05));
}
/** A room surface's material: a standard one, or one with a flat paint's sheen when it's painted that dark. */
export function roomMaterial(o: THREE.MeshStandardMaterialParameters & { color: THREE.Color }, tint = o.color): THREE.MeshStandardMaterial {
  const s = gloss(tint);
  return s < 1 ? new THREE.MeshPhysicalMaterial({ ...o, specularIntensity: s }) : new THREE.MeshStandardMaterial(o);
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
    m = roomMaterial({ color: p ? new THREE.Color(0xffffff) : c, map: p?.map ?? null, bumpMap: p?.bump ?? null, bumpScale: l?.bump ?? 1, roughness: l?.rough ?? 0.85, metalness: l?.metal ?? 0 }, c);
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
function hang(def: StudioDef, group: THREE.Group): Record<Side, [number, number][]> {
  const { h } = def.size, taken: Record<Side, [number, number][]> = { front: [], back: [], left: [], right: [] };
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
    // round 16: what stands off a wall shades it, the cans being overhead: a soft dark rim round each panel, deepest
    // under it and reaching further the prouder it stands, so a panel sits on the wall instead of floating in front
    const behind = new THREE.Group();
    const drop = (x: number, y: number, wide: number, tall: number, proud: number) =>
      behind.add(at(new THREE.Mesh(new THREE.PlaneGeometry(wide + 0.12 + proud * 2.4, tall + 0.1 + proud * 3), dropMat()), x, y - proud * 1.1, 0.0625));
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
        taken[side].push([c.position.x - wide / 2, c.position.x + wide / 2]);
        along += wide + 0.5;
      } else if (p.material === "panel") {
        // fabric-wrapped absorbers: 60 by 120 cm, 10 cm deep with soft rounded edges, standing tall at ear height,
        // two rows on a tall wall when one won't fit them
        const n = Math.max(1, Math.round(p.m2 / 0.72)), room = s.len / 2 - along - 0.3;
        const rows = n * 0.7 > room && h > 3 ? 2 : 1, cols = Math.ceil(n / rows), cell = Math.min(0.7, room / cols);
        const geo = metreUV(new RoundedBoxGeometry(0.6, 1.2, 0.1, 3, 0.025)), mat = surface("panel");
        const row = new THREE.Group();
        for (let i = 0; i < n; i++) {
          const x = along + 0.3 + (i % cols) * cell, y = rows === 1 ? 1.5 : 0.95 + Math.floor(i / cols) * 1.3;
          row.add(at(new THREE.Mesh(geo, mat), x, y, 0.11));
          drop(x, y, 0.6, 1.2, 0.1);
        }
        wall.add(flatten(row));
        taken[side].push([along, along + cols * cell]);
        along += cols * cell + 0.5;
      } else if (p.material === "slats") {
        const wide = Math.min(s.len / 2 - along - 0.3, p.m2 / Math.min(h - 0.6, 2.4));
        wall.add(slats(wide, Math.min(h - 0.6, 2.4), along));
        taken[side].push([along, along + wide]);
        along += wide + 0.5;
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
        // one rim round the whole block: the squares butt, so only its outside edge shades the wall
        drop(along + 0.3 + ((cols - 1) * cell) / 2, 1.45, (cols - 1) * cell + 0.58, (rows - 1) * 0.64 + 0.58, foam ? 0.06 : 0.05);
        taken[side].push([along, along + cols * cell]);
        along += cols * cell + 0.5;
      }
    }
    if (behind.children.length) wall.add(flatten(behind));
  }
  return taken;
}

let soft: THREE.CanvasTexture | null = null, dropShade: THREE.MeshBasicMaterial | null = null;
/** A panel's shade on its wall (hang()): clear at the plane's edges, full under the panel's middle, eased between. */
function dropMat() {
  soft ??= canvasTex(64, (g) => {
    const ease = (t: number) => { const k = Math.min(1, Math.max(0, t)); return k * k * (3 - 2 * k); };
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const u = Math.min(x, 63 - x) / 20, v = Math.min(y, 63 - y) / 20;
      g.fillStyle = `rgba(0,0,0,${(ease(u) * ease(v)).toFixed(3)})`; g.fillRect(x, y, 1, 1);
    }
  }, false);
  soft.wrapS = soft.wrapT = THREE.ClampToEdgeWrapping;
  return (dropShade ??= shade(soft, 0.68));
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
  // black, its alpha how near the floor it is, falling off as k^1.5 (round 13: a square left the shade under stands and legs thin)
  const depth = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
  depth.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace("gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );", "float k = 1.0 - fragCoordZ; gl_FragColor = vec4( vec3( 0.0 ), pow( k, 1.5 ) );");
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
  // a copy whose shade is pushed toward full, 1 - (1 - a)^gain (round 19: a stand's 7 mm leg blurred to a faint line, so its feet left no mark)
  const copy = (src: THREE.WebGLRenderTarget, gain: number) => {
    const c = target();
    quad.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: src.texture }, gain: { value: gain } }, blending: THREE.NoBlending,
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: "uniform sampler2D map; uniform float gain; varying vec2 vUv; void main() { float a = texture2D(map, vUv).a; gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0 - pow(1.0 - clamp(a, 0.0, 1.0), gain)); }",
    });
    renderer.setRenderTarget(c); renderer.clear(); quad.render(renderer); (quad.material as THREE.Material).dispose();
    return c;
  };
  const k = n / 1024; // the blurs are in centimetres: a texel is about 1 cm on high in a 10 m room
  blur(0.9 * k); blur(0.6 * k);
  const tight = copy(a, 2.6);
  // a middle shade a few centimetres round every foot, case and leg, where the floor meets what stands on it
  blur(2.5 * k); blur(3.5 * k);
  const near = copy(a, 2);
  for (let i = 0; i < 4; i++) blur((3 + i) * k);
  renderer.setRenderTarget(was.target); renderer.setClearColor(was.color, was.alpha);
  scene.background = was.bg; renderer.shadowMap.autoUpdate = was.shadows;
  for (const o of hidden) o.visible = true;
  quad.dispose(); depth.dispose(); b.dispose();
  // the tight line is dark; the wide shade is lighter, since the downlights and the bounce still reach under things
  for (const [rt, opacity] of [[tight, 1], [near, 0.85], [a, 1]] as const) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), shade(rt.texture, opacity));
    m.rotation.x = -Math.PI / 2; m.scale.y = -1; m.position.y = 0.002; m.name = "ground";
    group.add(m);
  }
  return n;
}

/**
 * A camera's depth of field (round 11): it focuses on the nearest thing at the middle of the view, as a phone's
 * autofocus does, and what is nearer or farther blurs by how far it is out of focus, as a disc (golden-angle taps).
 * A tap only lends its colour if it is itself blurred that far, so a sharp thing never smears over what is behind it.
 * Reads the scene's depth from the composer's own target, so it costs one pass and no second render of the room.
 */
class Focus extends Pass {
  readonly mat: THREE.ShaderMaterial;
  readonly quad: FullScreenQuad;
  constructor(readonly camera: THREE.PerspectiveCamera) {
    super();
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, near: { value: 0.1 }, far: { value: 100 }, px: { value: new THREE.Vector2(1, 1) }, size: { value: 4 } },
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `#include <packing>
        uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform float near; uniform float far; uniform vec2 px; uniform float size;
        varying vec2 vUv;
        float dist(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, near, far); }
        // how many pixels across a point at distance z blurs to, focused at f
        float coc(float z, float f) { return min(size * abs(1.0 - f / z) * 1.4, size * 2.0); }
        void main() {
          float f = 1e4;
          for (int i = 0; i < 5; i++) { vec2 o = vec2(i == 1 ? 1.0 : i == 2 ? -1.0 : 0.0, i == 3 ? 1.0 : i == 4 ? -1.0 : 0.0) * 0.03; f = min(f, dist(vec2(0.5) + o)); }
          float r = coc(dist(vUv), f);
          vec4 sum = texture2D(tDiffuse, vUv); float n = 1.0;
          if (r > 0.5) {
            for (int i = 1; i < 24; i++) {
              float k = float(i) / 24.0, a = float(i) * 2.39996;
              vec2 o = vec2(cos(a), sin(a)) * sqrt(k) * r;
              vec2 uv = vUv + o * px;
              float w = clamp(coc(dist(uv), f) - length(o) + 1.0, 0.0, 1.0);
              sum += texture2D(tDiffuse, uv) * w; n += w;
            }
          }
          gl_FragColor = sum / n;
        }`,
    });
    this.quad = new FullScreenQuad(this.mat);
  }
  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    const u = this.mat.uniforms;
    u.tDiffuse!.value = readBuffer.texture; u.tDepth!.value = readBuffer.depthTexture;
    u.near!.value = this.camera.near; u.far!.value = this.camera.far;
    u.px!.value.set(1 / readBuffer.width, 1 / readBuffer.height);
    u.size!.value = readBuffer.height / 360; // about 2 px of blur at 720 for something twice as far as the focus
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  override dispose() { this.mat.dispose(); this.quad.dispose(); }
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
  const { h } = def.size, mat = shade(fade, 0.62), top = shade(fade, 0.26), deep = shade(fade, 0.86); // the bounce off the floor lights the tops: only a hint of shade there
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
    band(h, 1.3, -s.len / 2 + 0.71, h / 2, -Math.PI / 2, deep); // deeper and wider than the foot: two walls shade each other
    band(h, 1.3, s.len / 2 - 0.71, h / 2, Math.PI / 2, deep);
    // round 12: the light falls away along the whole wall toward its ends, far from the cans in the middle of the
    // room, and most at its foot and top, so a wall reads lit in the middle and dim at the edges, not one flat grey
    const ends = new THREE.Mesh(new THREE.PlaneGeometry(s.len, h), shade(falloff(), 0.5));
    ends.position.set(0, h / 2, 0.0615); ends.name = "corner"; wall.add(ends);
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

let ends: THREE.CanvasTexture | null = null;
/** A whole wall's falloff (corners()): clear in its lit middle, darkening toward both ends and a little to its foot and top. */
function falloff() {
  ends ??= canvasTex(64, (g) => {
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const u = Math.abs(x / 63 - 0.5) * 2, v = Math.abs(y / 63 - 0.52) * 2;
      const a = Math.min(1, u ** 2.4 * 0.85 + v ** 3 * 0.35);
      g.fillStyle = `rgba(0,0,0,${a.toFixed(3)})`; g.fillRect(x, y, 1, 1);
    }
  }, false);
  ends.wrapS = ends.wrapT = THREE.ClampToEdgeWrapping;
  return ends;
}

let poolTex: THREE.CanvasTexture | null = null, scallop: THREE.CanvasTexture | null = null, footFloor: THREE.CanvasTexture | null = null;
/**
 * Where each can's light lands (round 16): a downlight near a wall throws a scallop on it, a bright arch whose crown
 * is where the cone first meets the wall, sharpest at that edge and fading down toward the floor, dark above. The
 * spotlights alone, wide and soft, lit every wall one flat grey. Baked: an additive warm arch on the outside wall behind
 * each can within 1.8 m of it, none on glass. And the floor darkens along every wall's foot, where the wall shades it.
 */
function pools(def: StudioDef, group: THREE.Group, spots: [number, number][]) {
  // u across the arch, v up the wall: the crown at v 0.8, the edge falling as a hyperbola does toward its sides
  scallop ??= canvasTex(64, (g) => {
    const step = (a: number, b: number, t: number) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };
    for (let y = 0; y < 128; y++) for (let x = 0; x < 64; x++) {
      const u = (x / 63 - 0.5) * 2, v = 1 - y / 127, edge = 0.8 - 0.62 * u * u;
      const under = edge - v, lit = step(0.05, -0.04, -under), body = 0.3 + 0.7 * Math.exp(-Math.max(0, under) * 3.2);
      const a = lit * body * Math.exp(-u * u * 1.4) * step(0, 0.25, v);
      g.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`; g.fillRect(x, y, 1, 1);
    }
  }, false, 128);
  scallop.wrapS = scallop.wrapT = THREE.ClampToEdgeWrapping;
  const { h } = def.size, rnd = mulberry32(6265), p = new THREE.Vector3();
  const tone = new THREE.Color(0xffd9ae);
  footFloor ??= canvasTex(8, (g) => {
    for (let y = 0; y < 64; y++) { const t = y / 63; g.fillStyle = `rgba(0,0,0,${((1 - t) ** 2.2).toFixed(3)})`; g.fillRect(0, y, 8, 1); }
  }, false, 64);
  footFloor.wrapS = footFloor.wrapT = THREE.ClampToEdgeWrapping;
  const band = shade(footFloor, 0.55);
  const archMat = new THREE.MeshBasicMaterial({ vertexColors: true, map: scallop, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
  for (const side of ["front", "back", "left", "right"] as const) {
    if ((def.materials?.walls[side] ?? "drywall") === "glass") continue;
    const s = sideOf(def, side), wall = new THREE.Group();
    wall.position.set(s.cx, 0, s.cz); wall.rotation.y = s.turn; group.add(wall); wall.updateMatrixWorld(true);
    const arches = new THREE.Group();
    for (const [x, z] of spots) {
      wall.worldToLocal(p.set(x, 0, z));
      const off = p.z - 0.06; // how far the can hangs off this wall
      if (off < 0.2 || off > 1.8 || Math.abs(p.x) > s.len / 2 - 0.3) continue;
      // nearer the wall: a narrower, brighter arch whose crown sits higher
      const k = 1 - (off - 0.2) / 1.6, wide = 1.2 + off * 1.3, tall = h * (0.78 + 0.12 * k);
      // each arch's own strength in its vertex colours, so a wall's arches merge into one draw call
      const geo = new THREE.PlaneGeometry(wide, tall), c = tone.clone().multiplyScalar((0.22 + 0.22 * k) * (0.8 + rnd() * 0.4));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(Array.from({ length: geo.getAttribute("position").count }, () => [c.r, c.g, c.b]).flat(), 3));
      arches.add(at(new THREE.Mesh(geo, archMat), p.x, tall / 2, 0.0612));
    }
    if (arches.children.length) { const merged = flatten(arches); merged.name = "pools"; wall.add(merged); }
    // the floor along the wall's foot: the wall stands between it and half the room's light. Laid flat, the plane's
    // top edge (the canvas's dark top) turns toward the wall
    const foot = new THREE.Mesh(new THREE.PlaneGeometry(s.len, 0.45), band);
    foot.rotation.x = -Math.PI / 2; foot.position.set(0, 0.003, 0.06 + 0.225); foot.name = "corner";
    wall.add(foot);
  }
  // the pool on the floor under each can (round 17): a bright core with a soft edge, a lamp's hot spot where the soft
  // fill alone reads flat. Just over the rug, so the pool lands on it too; every pool one merged mesh, strength in
  // vertex colours, each can a little off plumb and its own size
  poolTex ??= canvasTex(128, (g) => {
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const r = Math.hypot(x - 63.5, y - 63.5) / 63.5;
      const a = r >= 1 ? 0 : 0.55 * Math.exp(-r * r * 9) + 0.45 * (1 - r * r) ** 2.4;
      g.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`; g.fillRect(x, y, 1, 1);
    }
  }, false, 128);
  poolTex.wrapS = poolTex.wrapT = THREE.ClampToEdgeWrapping;
  const floorMat = new THREE.MeshBasicMaterial({ vertexColors: true, map: poolTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 });
  const discs = new THREE.Group(), lean = mulberry32(6325);
  for (const [x, z] of spots) {
    const size = h * (0.6 + lean() * 0.2), geo = new THREE.PlaneGeometry(size, size);
    const c = tone.clone().multiplyScalar(0.5 + lean() * 0.16);
    geo.setAttribute("color", new THREE.Float32BufferAttribute(Array.from({ length: geo.getAttribute("position").count }, () => [c.r, c.g, c.b]).flat(), 3));
    const disc = new THREE.Mesh(geo, floorMat);
    disc.rotation.x = -Math.PI / 2;
    discs.add(at(disc, x + (lean() - 0.5) * 0.3, 0.012, z + (lean() - 0.5) * 0.3));
  }
  if (discs.children.length) { const merged = flatten(discs); merged.name = "pools"; group.add(merged); }
  if ((def.materials?.floor ?? "floorboards") !== "carpet") group.add(streaks(spots, h));
}

/**
 * Each can mirrored in the lacquered boards (round 18): a glossy floor shows a light as a streak where the light's mirror
 * image under the floor lines up with the eye, stretched toward whoever looks, longer the lower the look. Baked pools
 * can't follow the eye, so every streak is placed in its vertex shader from the camera: one quad per can, one draw call.
 */
function streaks(spots: [number, number][], h: number) {
  const pos: number[] = [], can: number[] = [], corner: number[] = [], index: number[] = [], rnd = mulberry32(6348);
  spots.forEach(([x, z], i) => {
    const k = 0.75 + rnd() * 0.5;
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { pos.push(x, 0, z); can.push(x, h, z, k); corner.push(u!, v!); }
    index.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("can", new THREE.Float32BufferAttribute(can, 4));
  geo.setAttribute("corner", new THREE.Float32BufferAttribute(corner, 2));
  geo.setIndex(index);
  const mat = new THREE.ShaderMaterial({
    uniforms: { tint: { value: new THREE.Color(0xffdcb4).multiplyScalar(0.7) } },
    vertexShader: /* glsl */ `
      attribute vec4 can; attribute vec2 corner; varying vec2 vUv; varying float vK;
      void main() {
        vec3 c = (modelMatrix * vec4(can.xyz, 1.0)).xyz, foot = (modelMatrix * vec4(can.x, 0.0, can.z, 1.0)).xyz;
        float above = c.y - foot.y, eye = max(cameraPosition.y - foot.y, 0.05);
        // where the eye's line to the can's mirror image (as far under the floor as the can is over it) meets the floor
        vec3 hit = cameraPosition + (eye / (eye + above)) * (vec3(c.x, foot.y - above, c.z) - cameraPosition);
        vec2 to = cameraPosition.xz - hit.xz; float far = length(to); vec2 dir = far > 0.001 ? to / far : vec2(0.0, 1.0);
        vec2 side = vec2(-dir.y, dir.x);
        float along = 0.22 + 0.55 * clamp(far / (eye * 4.0), 0.0, 1.0), wide = 0.12 + 0.04 * can.w;
        // the streak runs mostly toward the eye from the mirror point, a little past it
        vec2 at = hit.xz + dir * (corner.y * along + along * 0.45) + side * corner.x * wide;
        vUv = corner; vK = can.w;
        gl_Position = projectionMatrix * viewMatrix * vec4(at.x, foot.y + 0.014, at.y, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 tint; varying vec2 vUv; varying float vK;
      void main() {
        float a = exp(-vUv.x * vUv.x * 5.0) * exp(-pow(abs(vUv.y + 0.35), 1.6) * 3.2) * smoothstep(1.0, 0.7, abs(vUv.y));
        // a hot core where the mirror point is, the rest a soft sheen
        a *= 0.55 + 0.45 * exp(-vUv.x * vUv.x * 30.0);
        gl_FragColor = vec4(tint * vK * a, 1.0);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -10,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false; m.name = "streaks";
  return m;
}

let glowFrom: THREE.CanvasTexture | null = null;
/** What a warm wall gives back (round 12): the light a brick or wood wall throws off is its own colour. */
const BOUNCE: Partial<Record<string, number>> = { brick: 0xc0603c, wood: 0xb57a42 };
/**
 * A brick or wood wall colours what is near it: the floor in front of it and the ends of the walls beside it take
 * a faint warm wash of its colour, strongest at the wall and gone a metre and a half out. Baked as additive planes,
 * not a light per wall (an area light costs a twelfth of a frame).
 */
function warmth(def: StudioDef, group: THREE.Group) {
  // one gradient, bright at its bottom edge, eased out
  glowFrom ??= canvasTex(64, (g) => {
    for (let y = 0; y < 64; y++) { const t = 1 - y / 63; g.fillStyle = `rgba(255,255,255,${(t * t).toFixed(3)})`; g.fillRect(0, 63 - y, 64, 1); }
  }, false);
  glowFrom.wrapS = glowFrom.wrapT = THREE.ClampToEdgeWrapping;
  const { h } = def.size, reach = 1.6;
  const order = ["back", "right", "front", "left"] as const; // round the room, so each wall's neighbours are either side of it
  for (const side of order) {
    const tone = BOUNCE[def.materials?.walls[side] ?? ""];
    if (tone === undefined) continue;
    const mat = (k: number) => new THREE.MeshBasicMaterial({ color: new THREE.Color(tone).multiplyScalar(k), map: glowFrom, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
    const s = sideOf(def, side), wall = new THREE.Group();
    wall.position.set(s.cx, 0, s.cz); wall.rotation.y = s.turn; group.add(wall);
    // the floor in front of it: the plane's bright edge at the wall's foot
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(s.len, reach), mat(0.3));
    floor.rotation.x = -Math.PI / 2; floor.rotation.z = Math.PI; floor.position.set(0, 0.006, reach / 2); floor.name = "warmth";
    wall.add(floor);
    // the ceiling over it, fainter: only the bounce reaches up there
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(s.len, reach), mat(0.1));
    ceiling.rotation.x = Math.PI / 2; ceiling.position.set(0, h - 0.006, reach / 2); ceiling.name = "warmth";
    wall.add(ceiling);
    // the ends of the two walls beside it, bright at the shared corner
    const i = order.indexOf(side);
    for (const [next, end] of [[order[(i + 1) % 4], -1], [order[(i + 3) % 4], 1]] as const) {
      const n = sideOf(def, next), side2 = new THREE.Group();
      side2.position.set(n.cx, 0, n.cz); side2.rotation.y = n.turn; group.add(side2);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(h, reach), mat(0.24));
      m.rotation.z = end > 0 ? Math.PI / 2 : -Math.PI / 2; // the bright edge to the end that meets the warm wall
      m.position.set(end * (n.len / 2 - reach / 2), h / 2, 0.063); m.name = "warmth";
      side2.add(m);
    }
  }
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
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); // a rounded box has no index, and one merge takes all or none
    g.applyMatrix4(inv.clone().multiply(o.matrixWorld));
    by.set(o.material, [...(by.get(o.material) ?? []), g]);
  });
  const out = new THREE.Group(); out.name = root.name;
  out.position.copy(root.position); out.quaternion.copy(root.quaternion); out.scale.copy(root.scale);
  for (const [m, gs] of by) { const merged = mergeGeometries(gs); if (merged) out.add(new THREE.Mesh(merged, m)); }
  return out;
}

/** The windows' glass (windows()): hidden while the room bakes its own reflections, so the panes don't reflect themselves. */
let glassFace: THREE.MeshPhysicalMaterial | null = null;

/**
 * The control room's window as a window: every glass wall gets a satin frame with rounded edges that catch the light,
 * posts only at its ends and the door (long panes butt at a clear silicone seam every 2.7 m, as a studio glazes them,
 * so nothing stands in the desk's view), a head along its top and the wall closed over it to the ceiling, a rubber bead
 * where the pane meets the sill, and the glass itself: a black dielectric face drawn over what's seen through it, so
 * it reflects the lit room and the cans the way glass does, faint head on and strong at a slant (Fresnel).
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
  const sheenMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xdfe9f0).multiplyScalar(0.12), map: sheen, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const edgeGlass = new THREE.MeshStandardMaterial({ color: "#5f8f7c", roughness: 0.1, metalness: 0, transparent: true, opacity: 0.55 });
  // black, so it adds only what it reflects; the room's own environment (baked in dress()) and the cans' highlights
  glassFace ??= (() => {
    const m = new THREE.MeshPhysicalMaterial({ color: "#000", roughness: 0.04, metalness: 0, specularIntensity: 0.3, envMapIntensity: 12, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    // a can mirrored in the pane came back past the bloom's threshold and, through the camera's blur, as a big halo over
    // the kit (round 13): what each pane adds stops well under the threshold (the panes add up where they overlap)
    m.onBeforeCompile = (s) => { s.fragmentShader = s.fragmentShader.replace("#include <opaque_fragment>", "#include <opaque_fragment>\ngl_FragColor.rgb = min(gl_FragColor.rgb, vec3(0.3));"); };
    m.customProgramCacheKey = () => "glass-face-capped";
    return m;
  })();
  const seam = new THREE.MeshStandardMaterial({ color: "#a9b3ae", roughness: 0.3, metalness: 0, transparent: true, opacity: 0.18 });
  for (const wl of def.walls) {
    if (!wl.glass) continue;
    for (const p of wallPieces(wl, 0.12)) {
      const g = new THREE.Group(); g.position.set(p.cx, 0, p.cz); g.rotation.y = p.turn; g.name = "window";
      // every frame part is an extrusion with its edges eased, so each catches a thin line of light along its corner
      const box = (bw: number, bh: number, bd: number, y: number, x: number, m: THREE.Material, r = 0.008) => {
        const geo = r > 0 ? new RoundedBoxGeometry(bw, bh, bd, 2, Math.min(r, bw / 2.2, bh / 2.2, bd / 2.2)) : new THREE.BoxGeometry(bw, bh, bd);
        const b = new THREE.Mesh(metreUV(geo), m); b.position.set(x, y, 0); g.add(b); return b;
      };
      const len = p.hw * 2, panes = Math.max(1, Math.ceil(len / 2.7));
      for (const x of [-p.hw + 0.03, p.hw - 0.03]) box(0.06, top - low, p.hd * 2 + 0.04, (top + low) / 2, x, frame, 0.012);
      // where two panes butt: a clear silicone joint
      for (let i = 1; i < panes; i++) {
        const x = -p.hw + (i / panes) * len;
        box(0.006, top - low - 0.06, 0.02, (top + low) / 2 - 0.03, x, seam, 0);
      }
      // the pane's own edge, green where it sits in the frame: the one place thick glass shows its colour
      for (const y of [low + 0.012, top - 0.07]) { const e = box(len - 0.12, 0.012, 0.012, y, 0, edgeGlass, 0); e.position.z = 0; }
      box(len, 0.07, p.hd * 2 + 0.04, top - 0.035, 0, frame, 0.012); // the head
      box(len, h - top, p.hd * 2, (h + top) / 2, 0, head, 0); // the wall over it, to the ceiling
      box(len - 0.12, 0.025, p.hd * 2 + 0.03, low - 0.008, 0, bead, 0.008); // where the pane sits on the sill
      const pane = new THREE.PlaneGeometry(len - 0.12, top - low - 0.07), uv = pane.getAttribute("uv");
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 2.4, uv.getY(i));
      const y = (top + low) / 2 - 0.035;
      const face = new THREE.Mesh(pane, glassFace); face.position.set(0, y, 0); g.add(face);
      // and the smudges and streaks it catches, faint now the reflection carries it
      const st = new THREE.Mesh(pane, sheenMat); st.position.set(0, y, 0); g.add(st);
      group.add(flatten(g));
    }
  }
}

/**
 * Where a room's road cases stand: against an outside wall, at least 1.4 m from every seat and its instrument, clear of the
 * door, the floor lamps, the gear wall and any inner wall, so nobody walks or plays into them. `pick` (0 to 1) chooses among the free
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
      if (near(p) < 1.4 || Math.hypot(p[0] - door[0], p[1] - door[1]) < 1.2 || lamps.some((l) => Math.hypot(p[0] - l[0], p[1] - l[1]) < 0.9) || inFootprint(def, p[0], p[1], 0.5)) continue;
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
  // beside them a spare mic stand on its round base, a cable coiled at its foot, and a roll of gaffer left on the lid
  const dark = surface("metal", "#1c1d1f");
  const part = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => at(new THREE.Mesh(geo, m), x, y, z);
  stack.add(part(new THREE.CylinderGeometry(0.13, 0.135, 0.018, 24), dark, 0.68, 0.009, 0), part(new THREE.CylinderGeometry(0.011, 0.011, 0.9, 8), dark, 0.68, 0.46, 0),
    part(new THREE.CylinderGeometry(0.016, 0.016, 0.05, 10), rubber, 0.68, 0.9, 0), part(new THREE.CylinderGeometry(0.008, 0.008, 0.6, 8), latch, 0.68, 1.18, 0),
    part(new THREE.BoxGeometry(0.03, 0.05, 0.03), rubber, 0.68, 1.5, 0));
  for (let i = 0; i < 4; i++) {
    const loop = part(new THREE.TorusGeometry(0.14 + rnd() * 0.025, 0.0055, 6, 28), rubber, 0.66 + (rnd() - 0.5) * 0.03, 0.007 + i * 0.01, 0.36 + (rnd() - 0.5) * 0.03);
    loop.rotation.set(Math.PI / 2 + (rnd() - 0.5) * 0.06, (rnd() - 0.5) * 0.06, 0);
    stack.add(loop);
  }
  const roll = part(new THREE.TorusGeometry(0.042, 0.021, 8, 22), tape, 0.02, 0.851, 0.13); roll.rotation.x = Math.PI / 2;
  stack.add(roll);
  group.add(flatten(stack));
}

let kicks: THREE.CanvasTexture | null = null, wear: THREE.CanvasTexture | null = null, sheets: THREE.CanvasTexture | null = null;
/** Cells across the paper atlas (`sheets`): four posters, a page of music, a set list, a clock's face (the top two thirds of its cell). */
const SHEETS = 7;
/** Walls nothing is pinned or hung on: soft ones, and glass. */
const SOFT = new Set<Material>(["foam", "curtain", "panel", "glass"]);

/**
 * The clear stretches of an outside wall, each [from, to] in metres along it from its middle and at least `min` long:
 * not behind what hangs there (`taken`, as hang() lays the panels out), not where an inner wall meets it, not behind
 * a floor lamp or the room's own furniture. Where a poster can go.
 */
export function clearWall(def: StudioDef, side: Side, taken: [number, number][], min = 1.1): [number, number][] {
  const s = sideOf(def, side), ux = Math.cos(s.turn), uz = -Math.sin(s.turn), nx = Math.sin(s.turn), nz = Math.cos(s.turn);
  const lamps = practicals(def), runs: [number, number][] = [], end = s.len / 2 - 0.5;
  const blocked = (a: number) => {
    const p: [number, number] = [s.cx + ux * a + nx * 0.2, s.cz + uz * a + nz * 0.2];
    return taken.some(([f, t]) => a > f - 0.2 && a < t + 0.2) || def.walls.some((wl) => toSegment(p, wl.from, wl.to) < 0.4)
      || lamps.some((l) => Math.hypot(p[0] - l[0], p[1] - l[1]) < 0.7)
      || (def.props ?? []).some((q) => Math.hypot(p[0] - q.at[0], p[1] - q.at[1]) < Math.max(q.w, q.d) / 2 + 0.3);
  };
  let from: number | null = null;
  for (let i = 0; ; i++) {
    const a = -end + i * 0.1, open = a <= end + 1e-9 && !blocked(a);
    if (open && from === null) from = a;
    if (!open && from !== null) { if (a - 0.1 - from >= min) runs.push([from, a - 0.1]); from = null; }
    if (a > end) break;
  }
  return runs;
}

/**
 * Where a keys player's music stand goes: beside the instrument, a step off its end, on whichever side is clear of
 * the walls, the other seats and their gear, and the furniture. Null when neither side is.
 */
export function standSpot(def: StudioDef, s: Spot): [number, number] | null {
  const { w, d } = def.size, b = thingBox(s), rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
  const clear = (p: [number, number]) => Math.abs(p[0]) < w / 2 - 0.4 && Math.abs(p[1]) < d / 2 - 0.4 && def.walls.every((wl) => toSegment(p, wl.from, wl.to) > 0.4)
    && def.spots.every((o) => { const ob = thingBox(o); return o === s || (Math.hypot(p[0] - o.at[0], p[1] - o.at[1]) > 0.8 && Math.hypot(p[0] - ob.cx, p[1] - ob.cz) > Math.max(ob.hw, ob.hd) + 0.35); })
    && (def.props ?? []).every((q) => !propBlocks(q) || Math.hypot(p[0] - q.at[0], p[1] - q.at[1]) > Math.max(q.w, q.d) / 2 + 0.3);
  return ([1, -1] as const).map((k): [number, number] => [b.cx + rx * k * (b.hw + 0.42), b.cz + rz * k * (b.hw + 0.42)]).find(clear) ?? null;
}

/** The paper in a room, painted once: gig posters in flat inks with blocks for type (nothing to read, nobody's name), a page of music, a set list in marker. */
function paperSheets() {
  const W = 256, H = 384;
  return canvasTex(W * SHEETS, (g) => {
    const r = mulberry32(5305);
    const type = (x: number, y: number, wide: number, tall: number, ink: string) => {
      g.fillStyle = ink;
      for (let x0 = x; x0 < x + wide - tall;) { const ww = tall * (1.2 + r() * 4); g.fillRect(x0, y, Math.min(ww, x + wide - x0), tall); x0 += ww + tall * 0.6; }
    };
    const disc = (x: number, y: number, rad: number, ink: string) => { g.fillStyle = ink; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill(); };
    const inks = [["#e9dfc8", "#b5432e", "#1d2a33"], ["#1f2d3a", "#e3b23c", "#efe6d2"], ["#d9a441", "#22201d", "#f1e9d6"], ["#ece4d2", "#2f6b62", "#c9532f"]] as const;
    inks.forEach(([paper, a, b], i) => {
      g.save(); g.translate(i * W, 0); g.beginPath(); g.rect(0, 0, W, H); g.clip();
      g.fillStyle = paper; g.fillRect(0, 0, W, H);
      if (i === 0) { for (let k = 6; k >= 1; k--) disc(128, 168, k * 17, k % 2 ? a : paper); type(24, 296, 208, 26, b); type(24, 334, 208, 6, b); type(24, 348, 150, 6, b); type(24, 20, 120, 6, a); }
      if (i === 1) {
        g.fillStyle = a;
        for (let k = 0; k < 24; k += 2) { g.beginPath(); g.moveTo(128, 210); g.arc(128, 210, 300, (k / 24) * Math.PI * 2, ((k + 1) / 24) * Math.PI * 2); g.fill(); }
        disc(128, 210, 46, b); disc(128, 210, 30, paper);
        g.fillStyle = paper; g.fillRect(0, 0, W, 78); g.fillRect(0, 322, W, 62);
        type(20, 26, 216, 30, b); type(20, 336, 216, 7, a); type(20, 352, 130, 7, b);
      }
      if (i === 2) { disc(150, 176, 64, b); g.fillStyle = a; for (let y = 124; y < 260; y += 30) g.fillRect(0, y, W, 13); type(22, 300, 212, 24, a); type(22, 336, 180, 6, a); type(22, 24, 90, 8, b); }
      if (i === 3) {
        for (let yy = 0; yy < 9; yy++) for (let xx = 0; xx < 9; xx++) disc(36 + xx * 23, 96 + yy * 23, 2 + yy * 1.1, a);
        g.fillStyle = b; g.beginPath(); g.moveTo(0, 0); g.lineTo(150, 0); g.lineTo(0, 70); g.fill();
        type(24, 318, 208, 22, b); type(24, 350, 160, 6, a); type(110, 30, 122, 7, a);
      }
      // folded in four to post it
      g.fillStyle = "rgba(0,0,0,0.09)"; g.fillRect(0, H / 2, W, 1); g.fillRect(W / 2, 0, 1, H);
      g.fillStyle = "rgba(255,255,255,0.12)"; g.fillRect(0, H / 2 + 1, W, 1); g.fillRect(W / 2 + 1, 0, 1, H);
      g.restore();
    });
    // a page of music: nine staves, notes on stems, a title
    g.save(); g.translate(4 * W, 0);
    g.fillStyle = "#f3efe4"; g.fillRect(0, 0, W, H);
    type(78, 14, 110, 7, "#2a2a2c");
    g.strokeStyle = "rgba(30,30,32,0.75)"; g.fillStyle = "#1c1c1e"; g.lineWidth = 0.8;
    for (let s = 0; s < 9; s++) {
      const y0 = 40 + s * 38;
      for (let l = 0; l < 5; l++) { g.beginPath(); g.moveTo(22, y0 + l * 4); g.lineTo(234, y0 + l * 4); g.stroke(); }
      for (let x = 22; x <= 234; x += 53) { g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y0 + 16); g.stroke(); }
      for (let n = 0; n < 13; n++) {
        const x = 32 + n * 15.5 + r() * 5, y = y0 + Math.round(r() * 10 - 2) * 2;
        g.beginPath(); g.ellipse(x, y, 2.7, 2, -0.35, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.moveTo(x + 2.4, y); g.lineTo(x + 2.4, y - 12); g.stroke();
      }
    }
    g.restore();
    // a set list: a title underlined, nine songs in marker, one struck out
    g.save(); g.translate(5 * W, 0);
    g.fillStyle = "#f1ede2"; g.fillRect(0, 0, W, H);
    g.strokeStyle = "#1b1b22"; g.lineCap = "round"; g.lineJoin = "round";
    const scrawl = (x: number, y: number, len: number, wide: number) => {
      g.lineWidth = wide; g.beginPath(); g.moveTo(x, y);
      for (let x0 = x + 7; x0 < x + len; x0 += 5 + r() * 6) g.lineTo(x0, y + (r() - 0.5) * 13);
      g.stroke();
    };
    scrawl(70, 26, 110, 6); g.lineWidth = 3; g.beginPath(); g.moveTo(62, 40); g.lineTo(196, 43); g.stroke();
    for (let i = 0; i < 9; i++) { const y = 74 + i * 33, len = 80 + r() * 100; scrawl(24, y, 8, 4); scrawl(46, y, len, 4.5); if (i === 5) { g.strokeStyle = "#a3231f"; g.lineWidth = 3; g.beginPath(); g.moveTo(40, y + 2); g.lineTo(52 + len, y - 3); g.stroke(); g.strokeStyle = "#1b1b22"; } }
    g.restore();
    speckle(g, W * 6, r, 5000, 0.07, 2); // handled, a little foxed
    // a wall clock's face: twelve ticks, the hands at ten past ten
    g.save(); g.translate(6 * W + 128, 128);
    g.fillStyle = "#efece4"; g.fillRect(-128, -128, W, W);
    g.strokeStyle = "#17181a"; g.lineCap = "butt";
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; g.lineWidth = k % 3 ? 4 : 9; g.beginPath(); g.moveTo(Math.sin(a) * 98, -Math.cos(a) * 98); g.lineTo(Math.sin(a) * 116, -Math.cos(a) * 116); g.stroke(); }
    for (const [a, len, wide] of [[-1.0, 62, 9], [1.05, 92, 6]] as const) { g.lineWidth = wide; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.sin(a) * len, -Math.cos(a) * len); g.stroke(); }
    g.fillStyle = "#17181a"; g.beginPath(); g.arc(0, 0, 9, 0, Math.PI * 2); g.fill();
    g.restore();
  }, true, H);
}

let trodden: THREE.CanvasTexture | null = null;
type Wall = StudioDef["walls"][number];
/** Where segment p to q crosses wall `wl` on the floor, in metres along the wall from its `from` end; null if it doesn't. */
function crossing(p: [number, number], q: [number, number], wl: Wall): number | null {
  const [ax, az] = wl.from, ex = wl.to[0] - ax, ez = wl.to[1] - az, dx = q[0] - p[0], dz = q[1] - p[1], den = dx * ez - dz * ex;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((ax - p[0]) * ez - (az - p[1]) * ex) / den, u = ((ax - p[0]) * dz - (az - p[1]) * dx) / den;
  return t > 0 && t < 1 && u > 0 && u < 1 ? u * Math.hypot(ex, ez) : null;
}

/**
 * The way people walk (round 19): from the door to every seat on the boards, a trodden lane where the lacquer has gone
 * dull and dark, darkest down its middle and in streaks along it, bowing a little as feet do. A seat behind an inner wall
 * is reached through that wall's doorway. Each lane stops short of its seat, whose own worn ring (used()) takes over.
 */
function paths(def: StudioDef): THREE.Mesh[] {
  const rnd = mulberry32([...def.id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 19));
  // one tile is the lane's width across by 2 m along it: a soft middle, scuffed streaks along the walk, blotches
  trodden ??= canvasTex(128, (g) => {
    const r = mulberry32(12), across = g.createLinearGradient(0, 0, 128, 0);
    for (const [at, a] of [[0, 0], [0.18, 0.3], [0.5, 0.62], [0.82, 0.3], [1, 0]] as const) across.addColorStop(at, `rgba(0,0,0,${a})`);
    g.fillStyle = across; g.fillRect(0, 0, 128, 512);
    g.lineCap = "round";
    for (let i = 0; i < 70; i++) {
      const x = 64 + (r() + r() + r() - 1.5) * 52, y = r() * 512, len = 20 + r() * 120;
      g.strokeStyle = `rgba(0,0,0,${0.08 + r() * 0.2})`; g.lineWidth = 0.8 + r() * 3;
      for (const dy of [0, -512]) { g.beginPath(); g.moveTo(x, y + dy); g.lineTo(x + (r() - 0.5) * 6, y + dy + len); g.stroke(); }
    }
    for (let i = 0; i < 14; i++) {
      const x = 64 + (r() - 0.5) * 60, y = r() * 512, rad = 12 + r() * 22, gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, `rgba(0,0,0,${0.08 + r() * 0.1})`); gr.addColorStop(1, "rgba(0,0,0,0)");
      for (const dy of [0, -512, 512]) { g.fillStyle = gr; g.save(); g.translate(0, dy); g.fillRect(x - rad, y - rad, rad * 2, rad * 2); g.restore(); }
    }
  }, false, 512);
  trodden.wrapS = THREE.ClampToEdgeWrapping;
  const mat = shade(trodden, 1), wide = 1.1, door = def.door.at;
  const doorways = (wl: Wall): [number, number][] => {
    const len = Math.hypot(wl.to[0] - wl.from[0], wl.to[1] - wl.from[1]);
    return (wl.gaps ?? []).map(([a, b]) => { const f = (a + b) / 2 / len; return [wl.from[0] + (wl.to[0] - wl.from[0]) * f, wl.from[1] + (wl.to[1] - wl.from[1]) * f]; });
  };
  const blocked = (p: [number, number], q: [number, number], wl: Wall) => {
    const u = crossing(p, q, wl);
    return u !== null && !(wl.gaps ?? []).some(([a, b]) => u > a && u < b);
  };
  /** One lane along p, (a bend), q as a strip of quads, its V in metres walked. */
  const lane = (p: [number, number], q: [number, number]) => {
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]), steps = Math.max(2, Math.ceil(len / 0.25)), bow = (rnd() - 0.5) * Math.min(0.6, len * 0.15);
    const nx = -(q[1] - p[1]) / len, nz = (q[0] - p[0]) / len, pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, s = Math.sin(Math.PI * t) * bow, x = p[0] + (q[0] - p[0]) * t + nx * s, z = p[1] + (q[1] - p[1]) * t + nz * s;
      // the lane narrows into nothing at its seat end, and fans a little at the door
      const half = (wide / 2) * (1.1 - 0.25 * t) * Math.min(1, (1 - t) * 6 + 0.2), v = (t * len) / 2;
      pos.push(x - nx * half, 0, z - nz * half, x + nx * half, 0, z + nz * half); uv.push(0, v, 1, v);
      if (i) { const b = i * 2; idx.push(b - 2, b - 1, b, b - 1, b + 1, b); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat); m.position.y = 0.0025;
    return m;
  };
  const out: THREE.Mesh[] = [], walked = new Set<string>();
  for (const s of def.spots) {
    if (s.kind === "couch" || s.kind === "booth" || floorAt(def, s.at[0], s.at[1]) > 0) continue;
    // stop 0.7 m short of the seat, on the line toward it
    let from = door;
    const through = def.walls.find((wl) => blocked(from, s.at, wl));
    if (through) {
      const gap = doorways(through).sort((a, b) => Math.hypot(a[0] - door[0], a[1] - door[1]) - Math.hypot(b[0] - door[0], b[1] - door[1]))[0];
      if (!gap || def.walls.some((wl) => blocked(door, gap, wl))) continue;
      if (!walked.has(`${gap}`)) { walked.add(`${gap}`); out.push(lane(door, gap)); }
      from = gap;
    }
    const len = Math.hypot(s.at[0] - from[0], s.at[1] - from[1]);
    if (len < 1.2) continue;
    const f = (len - 0.7) / len;
    out.push(lane(from, [from[0] + (s.at[0] - from[0]) * f, from[1] + (s.at[1] - from[1]) * f]));
  }
  return out;
}

/**
 * What a room people work in picks up (round 10). Scuffs low on the painted walls and on the wall under the glass,
 * where cases, stands and shoes knock them, and a dirty line over the skirting; the floor worn dull round every
 * seat. Paper: gig posters on the clear stretches of the walls (clearWall()), taped up in pairs with their bottom
 * corners curling on paint, framed on brick; a music stand beside the keys with pages on it (standSpot()) and a set
 * list gaffered to the floor by the stool. And the fittings nobody draws: socket plates, two air grilles and a smoke
 * detector in the ceiling. All of it merged per material, so it is a dozen draw calls. A hall too big to tell gets none.
 */
function used(def: StudioDef, group: THREE.Group, taken: Record<Side, [number, number][]>) {
  const { w, d, h } = def.size;
  if (w > 16 || d > 16) return;
  const rnd = mulberry32([...def.id].reduce((a, ch) => (a * 37 + ch.charCodeAt(0)) | 0, 10));
  // one tile is 4 m of wall by its bottom metre: rubber streaks, most of them low, rubbed patches, the dirty line at the foot
  kicks ??= canvasTex(512, (g) => {
    const r = mulberry32(10);
    g.lineCap = "round";
    for (let i = 0; i < 60; i++) {
      const y = 122 - r() ** 2 * 104, x = r() * 512, len = 3 + r() ** 2 * 60, bend = (r() - 0.5) * 1.6, drop = (r() - 0.5) * 2.4;
      g.strokeStyle = `rgba(0,0,0,${0.05 + r() ** 2 * 0.4})`; g.lineWidth = 0.5 + r() ** 2 * 2.4;
      for (const dx of [0, -512]) { g.beginPath(); g.moveTo(x + dx, y); g.quadraticCurveTo(x + dx + len / 2, y - bend, x + dx + len, y + drop); g.stroke(); }
    }
    for (let i = 0; i < 9; i++) {
      const x = r() * 512, y = 128 - r() * 70, rad = 14 + r() * 26, gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, "rgba(0,0,0,0.16)"); gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    const foot = g.createLinearGradient(0, 128, 0, 100);
    foot.addColorStop(0, "rgba(0,0,0,0.22)"); foot.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = foot; g.fillRect(0, 100, 512, 28);
  }, false, 128);
  kicks.wrapT = THREE.ClampToEdgeWrapping;
  // 1.7 m of floor round a seat: the finish gone dull, arcs where a stool's feet turn, scratches from stands dragged
  wear ??= canvasTex(256, (g) => {
    const r = mulberry32(11), halo = g.createRadialGradient(128, 128, 10, 128, 128, 124);
    halo.addColorStop(0, "rgba(0,0,0,0.3)"); halo.addColorStop(0.6, "rgba(0,0,0,0.14)"); halo.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = halo; g.fillRect(0, 0, 256, 256);
    g.lineCap = "round";
    for (let i = 0; i < 46; i++) {
      const rad = 16 + r() * 92, a0 = r() * Math.PI * 2;
      g.strokeStyle = `rgba(0,0,0,${0.1 + r() * 0.3})`; g.lineWidth = 0.5 + r() * 1.6;
      g.beginPath(); g.arc(128 + (r() - 0.5) * 30, 128 + (r() - 0.5) * 30, rad, a0, a0 + 0.08 + r() * 0.45); g.stroke();
    }
    for (let i = 0; i < 30; i++) {
      const a = r() * Math.PI * 2, rad = r() * 100, x = 128 + Math.cos(a) * rad, y = 128 + Math.sin(a) * rad, t = r() * Math.PI, len = 4 + r() * 22;
      g.strokeStyle = `rgba(0,0,0,${0.1 + r() * 0.25})`; g.lineWidth = 0.5 + r();
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(t) * len, y + Math.sin(t) * len); g.stroke();
    }
  }, false);
  wear.wrapS = wear.wrapT = THREE.ClampToEdgeWrapping;
  sheets ??= paperSheets();
  const marks = shade(kicks, 0.5), worn = shade(wear, 0.85);
  const paper = new THREE.MeshStandardMaterial({ map: sheets, color: "#b4b1aa", roughness: 0.82, side: THREE.DoubleSide, name: "paper" });
  const masking = new THREE.MeshStandardMaterial({ color: "#d9cfb2", roughness: 0.6 }), gaffer = new THREE.MeshStandardMaterial({ color: "#3d3e40", roughness: 0.62 });
  const black = surface("metal", "#1a1b1d"), white = new THREE.MeshStandardMaterial({ color: "#d8d5cd", roughness: 0.45, name: "fitting" }), hole = surface("rubber", "#151618");
  const stuff = new THREE.Group(), flat = new THREE.Group();
  stuff.name = "used"; flat.name = "floor-marks";
  const box = (bw: number, bh: number, bd: number, m: THREE.Material, x: number, y: number, z: number) => at(new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), m), x, y, z);
  /** One cell of the paper atlas on a sheet `pw` by `ph`; `curl` lifts its bottom corners off the wall. */
  const page = (cell: number, pw: number, ph: number, curl = 0) => {
    const geo = new THREE.PlaneGeometry(pw, ph, curl ? 6 : 1, curl ? 8 : 1), uv = geo.getAttribute("uv"), pos = geo.getAttribute("position");
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i), v = uv.getY(i);
      if (curl) pos.setZ(i, curl * (1 - v) ** 3 * (2 * u - 1) ** 2);
      uv.setX(i, (cell + 0.01 + u * 0.98) / SHEETS);
    }
    if (curl) geo.computeVertexNormals();
    return new THREE.Mesh(geo, paper);
  };
  /** A strip of the scuffs `len` along a wall and `tall` up it, starting somewhere of its own along the tile. */
  const scuffs = (len: number, tall: number) => {
    const geo = new THREE.PlaneGeometry(len, tall), uv = geo.getAttribute("uv"), off = rnd();
    for (let i = 0; i < uv.count; i++) uv.setXY(i, off + (uv.getX(i) * len) / 4, uv.getY(i) * tall);
    return new THREE.Mesh(geo, marks);
  };
  const outlet = () => {
    const o = new THREE.Group();
    o.add(new THREE.Mesh(new RoundedBoxGeometry(0.078, 0.118, 0.007, 2, 0.003), white));
    for (const sy of [-0.026, 0.026]) o.add(box(0.034, 0.024, 0.002, hole, 0, sy, 0.0035));
    return o;
  };

  let cell = Math.floor(rnd() * 4), fitted = false;
  for (const side of ["front", "back", "left", "right"] as const) {
    const s = sideOf(def, side), g = new THREE.Group(), made = def.materials?.walls[side] ?? "drywall", painted = !BARE.has(made) && made !== "wood" && !SOFT.has(made);
    g.position.set(s.cx, 0, s.cz); g.rotation.y = s.turn; stuff.add(g);
    if (painted) g.add(at(scuffs(s.len, 1), 0, 0.62, 0.063));
    if (SOFT.has(made)) continue;
    const run = clearWall(def, side, taken[side]).sort((p, q) => q[1] - q[0] - (p[1] - p[0]))[0];
    if (!run) continue;
    const len = run[1] - run[0], y = Math.min(1.62, h * 0.52);
    if (painted) g.add(at(outlet(), run[0] + 0.2 + rnd() * 0.3, 0.34, 0.0635));
    if (painted && !fitted && len > 2.4 && h > 2.7) {
      // one wall keeps the clock, up out of the way, and the bin under it
      fitted = true;
      const face = new THREE.CircleGeometry(0.14, 36), uv = face.getAttribute("uv");
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (6 + uv.getX(i)) / SHEETS, 1 - ((1 - uv.getY(i)) * 2) / 3);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.146, 0.013, 8, 36), black);
      g.add(at(new THREE.Mesh(face, paper), run[1] - 0.35, 2.3, 0.072), at(rim, run[1] - 0.35, 2.3, 0.072), at(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.012, 24).rotateX(Math.PI / 2), black), run[1] - 0.35, 2.3, 0.064));
      const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.11, 0.3, 20), black), top = new THREE.Mesh(new THREE.CircleGeometry(0.128, 20).rotateX(-Math.PI / 2), hole);
      const wad = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 0), white);
      g.add(at(bin, run[1] - 0.3, 0.15, 0.24), at(top, run[1] - 0.3, 0.3005, 0.24), at(wad, run[1] - 0.33, 0.3, 0.26));
    }
    if (painted && len > 1.9 && rnd() < 0.6) {
      // two posters taped up side by side, neither quite level, their bottom corners curling
      const mid = run[0] + 0.7 + rnd() * (len - 1.4);
      for (const k of [-1, 1]) {
        const p = new THREE.Group(); p.position.set(mid + k * (0.27 + rnd() * 0.06), y + (rnd() - 0.5) * 0.14, 0.0635); p.rotation.z = (rnd() - 0.5) * 0.05;
        p.add(page(cell++ % 4, 0.42, 0.63, 0.016));
        for (const sx of [-1, 1]) { const t = box(0.055, 0.02, 0.0008, masking, sx * 0.195, 0.3, 0.001); t.rotation.z = -sx * (0.7 + rnd() * 0.3); p.add(t); }
        g.add(p);
      }
    } else {
      // one poster in a thin black frame
      const p = new THREE.Group(), pw = 0.6, ph = 0.9, bar = 0.022;
      p.position.set(run[0] + 0.5 + rnd() * (len - 1), y, 0.06); p.rotation.z = (rnd() - 0.5) * 0.012;
      p.add(at(page(cell++ % 4, pw, ph), 0, 0, 0.014), box(pw + bar, ph + bar, 0.012, black, 0, 0, 0.006));
      for (const k of [-1, 1]) p.add(box(pw + 2 * bar, bar, 0.028, black, 0, (k * (ph + bar)) / 2, 0.014), box(bar, ph, 0.028, black, (k * (pw + bar)) / 2, 0, 0.014));
      g.add(p);
    }
  }
  // the wall under each window: knocked about on both sides, a socket on one
  for (const wl of def.walls) {
    if (!wl.glass) continue;
    for (const p of wallPieces(wl, 0.12)) {
      const g = new THREE.Group(); g.position.set(p.cx, 0, p.cz); g.rotation.y = p.turn; stuff.add(g);
      for (const k of [-1, 1]) { const m = at(scuffs(p.hw * 2, 0.86), 0, 0.44, k * (p.hd + 0.0115)); if (k < 0) m.rotation.y = Math.PI; g.add(m); }
      if (p.hw > 1) g.add(at(outlet(), (rnd() - 0.5) * p.hw, 0.34, p.hd + 0.0135));
    }
  }
  // the floor round every seat that stands on bare boards
  const hard = (def.materials?.floor ?? "floorboards") !== "carpet";
  for (const s of def.spots) {
    if (!hard || s.kind === "drums" || s.kind === "couch" || floorAt(def, s.at[0], s.at[1]) > 0) continue;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), worn);
    m.rotation.set(-Math.PI / 2, 0, rnd() * Math.PI * 2); m.position.set(s.at[0], 0.003, s.at[1]);
    flat.add(m);
  }
  if (hard) flat.add(...paths(def));
  // the keys player's music stand and set list
  const rod =(a: THREE.Vector3, b: THREE.Vector3, r: number) => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, a.distanceTo(b), 8), black);
    c.position.copy(a).add(b).multiplyScalar(0.5); c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    return c;
  };
  for (const s of def.spots) {
    if (s.kind !== "keys" || floorAt(def, s.at[0], s.at[1]) > 0) continue;
    const spot = standSpot(def, s);
    if (!spot) continue;
    const st = new THREE.Group(); st.position.set(spot[0], 0, spot[1]); st.rotation.y = Math.atan2(s.at[0] - spot[0], s.at[1] - spot[1]) + (rnd() - 0.5) * 0.3;
    for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2 + 0.5; st.add(rod(new THREE.Vector3(0, 0.34, 0), new THREE.Vector3(Math.cos(a) * 0.3, 0.006, Math.sin(a) * 0.3), 0.007)); }
    st.add(rod(new THREE.Vector3(0, 0.1, 0), new THREE.Vector3(0, 0.72, 0), 0.011), rod(new THREE.Vector3(0, 0.7, 0), new THREE.Vector3(0, 1.1, 0), 0.008), rod(new THREE.Vector3(0, 0.7, 0), new THREE.Vector3(0, 0.75, 0), 0.016));
    const desk = new THREE.Group(); desk.position.y = 1.08; desk.rotation.x = -0.3;
    desk.add(box(0.48, 0.32, 0.004, black, 0, 0.16, 0), box(0.48, 0.012, 0.045, black, 0, 0.004, 0.022));
    for (const [x, turn, z] of [[-0.11, 0.02, 0.004], [0.112, -0.045, 0.005], [0.02, 0.09, 0.003]] as const) { const pg = at(page(4, 0.21, 0.297), x, 0.162, z); pg.rotation.z = turn; desk.add(pg); }
    st.add(desk); stuff.add(st);
    // the set list, gaffered to the boards on the stool's other side, its top toward the keys
    const b = thingBox(s), side = Math.sign((spot[0] - b.cx) * Math.cos(s.yaw) - (spot[1] - b.cz) * Math.sin(s.yaw)) || 1;
    const list = new THREE.Group(); list.position.set(s.at[0] - side * Math.cos(s.yaw) * 0.55 - Math.sin(s.yaw) * 0.1, 0.004, s.at[1] + side * Math.sin(s.yaw) * 0.55 - Math.cos(s.yaw) * 0.1); list.rotation.y = s.yaw + (rnd() - 0.5) * 0.5;
    const sheet = page(5, 0.21, 0.297); sheet.rotation.x = -Math.PI / 2;
    list.add(sheet, box(0.09, 0.001, 0.024, gaffer, 0, 0.0008, -0.146), box(0.09, 0.001, 0.024, gaffer, 0, 0.0008, 0.146));
    flat.add(list);
  }
  // in the ceiling: two air grilles and a smoke detector, clear of the cans and the inner walls
  if (h <= 4.5) {
    const lit = cans(w, d), free = (p: [number, number]) => Math.abs(p[0]) < w / 2 - 0.6 && Math.abs(p[1]) < d / 2 - 0.6 && lit.every(([x, z]) => Math.hypot(p[0] - x, p[1] - z) > 0.75) && def.walls.every((wl) => toSegment(p, wl.from, wl.to) > 0.5);
    const first = (fx: number, fz: number) => { for (let n = 0; n < 6; n++) { const p: [number, number] = [fx * w + n * 0.45, fz * d + (n % 2) * 0.45]; if (free(p)) return p; } return null; };
    for (const [fx, fz] of [[-0.24, 0.2], [0.26, -0.27]] as const) {
      const p = first(fx, fz);
      if (!p) continue;
      const v = new THREE.Group(); v.position.set(p[0], h, p[1]);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.52), hole); back.rotation.x = Math.PI / 2; back.position.y = -0.002;
      v.add(back);
      for (const k of [-1, 1]) v.add(box(0.58, 0.01, 0.035, white, 0, -0.005, k * 0.2725), box(0.035, 0.01, 0.51, white, k * 0.2725, -0.005, 0));
      for (let i = 0; i < 13; i++) { const l = box(0.51, 0.003, 0.044, white, 0, -0.014, -0.234 + i * 0.039); l.rotation.x = 0.8; v.add(l); }
      stuff.add(v);
    }
    const p = first(0.06, 0.09);
    if (p) stuff.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.062, 0.032, 20), white), p[0], h - 0.016, p[1]));
  }
  group.add(flatten(stuff), flatten(flat));
}

/**
 * Where the floor's clutter goes (strewn()): the free boards nearest `near`, on a 0.3 m grid, clear of every seat and
 * instrument, the walls, the door's way in and what was already put down (`kept`, each a point and how far it reaches).
 */
export function freeFloor(def: StudioDef, near: [number, number], reach: number, kept: [number, number, number][]): [number, number] | null {
  const { w, d } = def.size, clear = (x: number, z: number) => {
    if (Math.abs(x) > w / 2 - 0.5 - reach || Math.abs(z) > d / 2 - 0.5 - reach || floorAt(def, x, z) > 0) return false;
    if (Math.hypot(x - def.door.at[0], z - def.door.at[1]) < 0.5 + reach) return false;
    if (def.walls.some((wl) => toSegment([x, z], wl.from, wl.to) < 0.4 + reach)) return false;
    if (kept.some(([kx, kz, kr]) => Math.hypot(x - kx, z - kz) < kr + reach)) return false;
    return def.spots.every((s) => {
      const b = thingBox(s);
      return Math.hypot(x - s.at[0], z - s.at[1]) > 0.75 + reach && Math.hypot(x - b.cx, z - b.cz) > Math.max(b.hw, b.hd) + 0.35 + reach;
    });
  };
  let best: [number, number] | null = null, far = Infinity;
  for (let x = -w / 2; x <= w / 2; x += 0.3) for (let z = -d / 2; z <= d / 2; z += 0.3) {
    const dist = Math.hypot(x - near[0], z - near[1]);
    if (dist < far && clear(x, z)) { far = dist; best = [x, z]; }
  }
  return best;
}

/**
 * What a band leaves on the floor between the kit and the keys (round 15): a pedalboard with its patch leads and two
 * instrument leads wandering off it, a guitar's hard case laid flat, and a vocal mic on a stand whose XLR runs down the
 * pole and across the boards to its spare length coiled on the floor. A room with no kit or no keys keeps a clear floor.
 */
function strewn(def: StudioDef, group: THREE.Group) {
  const { w, d } = def.size, drums = def.spots.find((s) => s.kind === "drums"), keys = def.spots.find((s) => s.kind === "keys");
  if (w > 16 || d > 16 || !drums || !keys) return;
  const rnd = mulberry32([...def.id].reduce((a, ch) => (a * 41 + ch.charCodeAt(0)) | 0, 15));
  // between the two players, a step behind the drummer's back (the way the band faces is toward the kit's front)
  const back: [number, number] = [Math.sin(drums.yaw), Math.cos(drums.yaw)];
  const near: [number, number] = [(drums.at[0] + keys.at[0]) / 2 + back[0] * 1.2, (drums.at[1] + keys.at[1]) / 2 + back[1] * 1.2];
  const kept: [number, number, number][] = [];
  const put = (reach: number, off: [number, number]) => {
    const p = freeFloor(def, [near[0] + off[0], near[1] + off[1]], reach, kept);
    if (p) kept.push([p[0], p[1], reach]);
    return p;
  };
  const rubber = surface("rubber", "#0e0f11"), chrome = surface("chrome", "#c8cacd"), black = surface("metal", "#17181a");
  const stuff = new THREE.Group(); stuff.name = "strewn";
  const lead = (pts: THREE.Vector3[], r = 0.0036) => stuff.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 10, r, 6), rubber));
  /** A lead lying on the boards from (x, z) toward `to`, kicked about on the way: `n` bends, the last one short of it. */
  const wander = (x: number, z: number, to: [number, number], n: number, sway: number) => {
    const pts: THREE.Vector3[] = [];
    const nx = -(to[1] - z), nz = to[0] - x, nl = Math.hypot(nx, nz) || 1;
    for (let i = 0; i <= n; i++) {
      const t = i / n, s = Math.sin(t * Math.PI) * (rnd() - 0.5) * sway;
      pts.push(new THREE.Vector3(x + (to[0] - x) * t + (nx / nl) * s, 0.0042, z + (to[1] - z) * t + (nz / nl) * s));
    }
    return pts;
  };
  /** A jack plug lying at the end of a lead, pointing along it. */
  const plug = (p: THREE.Vector3, from: THREE.Vector3, xlr = false) => {
    const g = new THREE.Group(); g.position.copy(p); g.rotation.y = Math.atan2(p.x - from.x, p.z - from.z);
    const boot = new THREE.Mesh(new THREE.CylinderGeometry(xlr ? 0.011 : 0.007, 0.004, 0.035, 10).rotateX(Math.PI / 2), xlr ? chrome : black); boot.position.set(0, xlr ? 0.011 : 0.007, 0.017);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(xlr ? 0.0105 : 0.0032, xlr ? 0.0105 : 0.0032, xlr ? 0.03 : 0.03, 10).rotateX(Math.PI / 2), chrome); tip.position.set(0, xlr ? 0.011 : 0.007, xlr ? 0.05 : 0.048);
    g.add(boot, tip); stuff.add(g);
  };

  // the pedalboard: a sloped black frame, felt on top, six pedals in a row patched one to the next, the power under it
  const pb = put(0.4, [0.3, 0.15]);
  if (pb) {
    const g = new THREE.Group(); g.position.set(pb[0], 0, pb[1]); g.rotation.y = Math.atan2(-back[0], -back[1]) + Math.PI + (rnd() - 0.5) * 0.5;
    const deck = new THREE.Group(); deck.rotation.x = 0.1; deck.position.y = 0.035; g.add(deck);
    deck.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.028, 0.32), black), 0, 0, 0), at(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.004, 0.3), surface("cloth", "#1f2023")), 0, 0.016, 0));
    g.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.02), black), 0, 0.025, -0.15), at(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.09), surface("metal", "#2c2e31")), 0.1, 0.018, -0.1));
    const colors = ["#cfc6ae", "#34483a", "#9ea3a8", "#2a3a55", "#a8582e", "#5a2828"];
    const knob = surface("plastic", "#141416"), led = new THREE.MeshStandardMaterial({ color: "#200", emissive: "#ff3a2a", emissiveIntensity: 2.2 });
    const jacks: [number, number][] = [];
    for (let i = 0; i < 6; i++) {
      const big = i === 0, pw = big ? 0.09 : 0.072, x = -0.25 + i * 0.1 + (big ? -0.008 : 0), z = (i % 2 ? 0.035 : -0.025) + (rnd() - 0.5) * 0.02;
      const p = new THREE.Group(); p.position.set(x, 0.018, z); p.rotation.y = (rnd() - 0.5) * 0.06; deck.add(p);
      p.add(at(new THREE.Mesh(new RoundedBoxGeometry(pw, 0.04, 0.12, 2, 0.006), surface("metal", colors[i]!)), 0, 0.02, 0));
      for (const [kx, kz] of big ? [[0, -0.03]] : [[-0.02, -0.035], [0.02, -0.035], [0, -0.008]]) p.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0085, 0.013, 12), knob), kx!, 0.046, kz!));
      p.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0065, 0.012, 10), chrome), 0, 0.046, 0.032), at(new THREE.Mesh(new THREE.SphereGeometry(0.003, 6, 4), led), 0, 0.041, 0.012));
      jacks.push([x, z]);
    }
    // patch leads between neighbours, arcing over the gap at the pedals' sides
    for (let i = 0; i < 5; i++) {
      const [ax, az] = jacks[i]!, [bx, bz] = jacks[i + 1]!, y = 0.054;
      const pts = [new THREE.Vector3(ax + 0.035, y, az - 0.04), new THREE.Vector3((ax + bx) / 2, y + 0.022, (az + bz) / 2 - 0.05), new THREE.Vector3(bx - 0.035, y, bz - 0.04)];
      deck.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.0028, 5), rubber));
    }
    stuff.add(flatten(g));
    // the leads in and out: off the board's ends and across the boards, one to the keys' side, one loose with its plug
    g.updateMatrixWorld(true);
    const end = (sx: number) => new THREE.Vector3(sx, 0.012, 0).applyMatrix4(g.matrixWorld);
    const a = end(0.33), b = end(-0.33);
    const inLead = wander(a.x, a.z, [keys.at[0] + (rnd() - 0.5) * 0.4, keys.at[1] + back[1] * 0.3], 7, 0.5);
    inLead[0]!.y = 0.03; lead(inLead);
    const loose: [number, number] = [b.x + (b.x - a.x) * 1.4 + (rnd() - 0.5) * 0.3, b.z + (b.z - a.z) * 1.4 + (rnd() - 0.5) * 0.3];
    const outLead = wander(b.x, b.z, loose, 5, 0.6);
    outLead[0]!.y = 0.03; lead(outLead);
    plug(outLead.at(-1)!, outLead.at(-2)!);
  }

  // a guitar's hard case laid flat: a moulded outline (two bouts, a waist, the neck, the head) in black tolex, latches down one side
  const gc = put(0.45, [-0.6, 0.25]);
  if (gc) {
    const bout = (y: number, cy: number, r: number) => (Math.abs(y - cy) < r ? Math.sqrt(r * r - (y - cy) ** 2) : 0);
    const half = (y: number) => Math.max(bout(y, 0, 0.215), bout(y, 0.37, 0.17), y > 0.08 && y < 0.3 ? 0.158 : 0, y > 0.4 && y < 0.98 ? 0.07 : 0, y >= 0.98 ? 0.088 : 0);
    const shape = new THREE.Shape(), ys: number[] = [];
    for (let y = -0.213; y <= 1.1; y += 0.02) ys.push(y);
    ys.forEach((y, i) => (i ? shape.lineTo(half(y), y) : shape.moveTo(half(y), y)));
    for (const y of [...ys].reverse()) shape.lineTo(-half(y), y);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.022, bevelSize: 0.018, bevelSegments: 3, curveSegments: 4 });
    geo.rotateX(-Math.PI / 2); geo.translate(0, 0.022, 0);
    const g = new THREE.Group(); g.position.set(gc[0], 0, gc[1]); g.rotation.y = Math.PI / 2 + 0.35 + (rnd() - 0.5) * 0.4;
    g.add(new THREE.Mesh(metreUV(geo), surface("tolex", "#111214")));
    // the seam where lid meets base, and the latches and handle on the treble side
    const seam = new THREE.ExtrudeGeometry(shape, { depth: 0.006, bevelEnabled: true, bevelThickness: 0, bevelSize: 0.021, bevelSegments: 1, curveSegments: 4 });
    seam.rotateX(-Math.PI / 2); g.add(at(new THREE.Mesh(seam, surface("rubber", "#050506")), 0, 0.072, 0));
    for (const y of [-0.05, 0.25, 0.62]) {
      const l = at(new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.04), chrome), half(y) + 0.036, 0.075, -y);
      g.add(l);
    }
    const handle = at(new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.01, 6, 14, Math.PI), rubber), 0.21, 0.075, -0.2); handle.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    g.add(handle);
    stuff.add(flatten(g));
  }

  // a vocal mic on a straight stand, its XLR clipped down the pole, across the boards, and the spare coiled on the floor
  const ms = put(0.3, [0.6, -0.55]), coil = ms && put(0.3, [-0.1, -0.45]);
  if (ms && coil) {
    const g = new THREE.Group(); g.position.set(ms[0], 0, ms[1]); g.rotation.y = Math.atan2(keys.at[0] - ms[0], keys.at[1] - ms[1]);
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.135, 0.018, 24), black), 0, 0.009, 0), at(new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.95, 8), black), 0, 0.48, 0));
    g.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.05, 10), rubber), 0, 0.95, 0), at(new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 0.42, 8), chrome), 0, 1.18, 0));
    const mic = new THREE.Group(); mic.position.set(0, 1.4, 0.02); mic.rotation.x = 1.1; g.add(mic);
    mic.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.014, 0.13, 14), black), 0, -0.02, 0), at(new THREE.Mesh(new THREE.SphereGeometry(0.027, 14, 10), surface("grille", "#9a9ca0")), 0, 0.07, 0));
    stuff.add(flatten(g));
    // down the pole on the side away from the player, off the base and out to the coil
    const t = Math.atan2(keys.at[0] - ms[0], keys.at[1] - ms[1]), ox = -Math.sin(t) * 0.018, oz = -Math.cos(t) * 0.018;
    const run = wander(ms[0] + ox * 7, ms[1] + oz * 7, coil, 6, 0.7);
    lead([new THREE.Vector3(ms[0] + ox, 1.36, ms[1] + oz), new THREE.Vector3(ms[0] + ox, 0.9, ms[1] + oz), new THREE.Vector3(ms[0] + ox, 0.3, ms[1] + oz), new THREE.Vector3(ms[0] + ox * 4, 0.03, ms[1] + oz * 4), ...run], 0.0042);
    // the coil: five loose loops that don't sit on each other quite, the end with its plug lying out of it
    const pts: THREE.Vector3[] = [], turns = 5;
    for (let i = 0; i <= turns * 18; i++) {
      const a = (i / 18) * Math.PI * 2, r = 0.17 + Math.sin(a * 0.6) * 0.025 + (i / (turns * 18)) * 0.03;
      pts.push(new THREE.Vector3(coil[0] + Math.cos(a) * r + (i / 90) * 0.05, 0.005 + (i / (turns * 18)) * 0.03, coil[1] + Math.sin(a) * r * 0.92));
    }
    lead(pts, 0.0042);
    const last = pts.at(-1)!, out = new THREE.Vector3(last.x + 0.25, 0.0045, last.z + 0.12);
    lead([last, new THREE.Vector3((last.x + out.x) / 2, 0.012, (last.z + out.z) / 2 + 0.04), out], 0.0042);
    plug(out, last, true);
  }
  group.add(flatten(stuff));
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

export interface LookState { quality: Quality; graphics?: Graphics; running?: Running & { level: number }; lights: number; shadows: number; post: string[]; tone: string; exposure: number; drawCalls: number; triangles: number; fps: number; ground: number; env: "room" | "generated" | "none" }

/** The renderer set up for one room: call `render` every frame and `resize` with the canvas. */
export interface Look { render(camera: THREE.Camera): void; resize(w: number, h: number): void; state(): LookState; quality: Quality; /** The light desk's colour and lasers, where the room has a truss. */ stage?(l: StageLights): void }

export function dress(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, def: StudioDef, g: Graphics): Look {
  const quality = qualityOf(g), high = quality === "high", full = g.shadows === "full";
  renderer.info.autoReset = false; // a frame through the post is several passes: count them all
  renderer.toneMapping = g.tone ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = full;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(g.scale, devicePixelRatio));
  // reflections and the soft fill a real room's bounce light gives, from a generated room (no download)
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.32;
  pm.dispose();
  scene.background = new THREE.Color(0x0d0e10);

  const group = new THREE.Group();
  group.name = "look";
  scene.add(group);
  const taken = hang(def, group);
  corners(def, group);
  warmth(def, group);
  walls(def, group);
  windows(def, group);
  lived(def, group);
  used(def, group, taken);
  strewn(def, group);
  // the bounce that reaches the tops of the walls; fainter since round 16, so the scallops and shade read over it
  scene.add(new THREE.HemisphereLight(0xf4efe8, 0x4a3a2e, 0.32));

  // downlights in the ceiling (cans()), each a warm spot with a soft edge; on high the ones nearest the middle throw shadows
  const { w, d, h } = def.size, spots = cans(w, d);
  pools(def, group, spots);
  const can =new THREE.CylinderGeometry(0.09, 0.09, 0.02, 20), rim = new THREE.TorusGeometry(0.095, 0.012, 6, 24);
  const bulb = new THREE.MeshStandardMaterial({ color: "#000", emissive: "#ffe6c4", emissiveIntensity: 6 }), trim = surface("metal", "#d9d6d0");
  const lights: THREE.SpotLight[] = [];
  const per = (w * d) / spots.length, power = 16 * per * Math.max(1, h / 3.4); // candela, so a big room's few lights still light it
  // no two cans alike, as in a real room: lamps of different ages, a touch warmer or brighter, the same every visit
  const rnd = mulberry32([...def.id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7));
  const warm = new THREE.Color(0xffd2a0), cool = new THREE.Color(0xffe8cc), aim = mulberry32(6032);
  // `g.lights` lights only that many nearest the middle (low: 4), a little brighter: every lit material's shader carries
  // every light, and software GL took ~37 s to compile a room's 16 (#5919); the other cans still glow
  const lit = new Set(g.lights >= ALL_LIGHTS ? spots : [...spots].sort((a, b) => Math.hypot(...a) - Math.hypot(...b)).slice(0, g.lights));
  const boost = Math.min(2, spots.length / lit.size);
  for (const spot of spots) {
    const [x, z] = spot, tint = rnd(), strength = power * (0.72 + rnd() * 0.45) * boost;
    const c = new THREE.Mesh(can, bulb); c.position.set(x, h - 0.012, z);
    const r = new THREE.Mesh(rim, trim); r.rotation.x = Math.PI / 2; r.position.set(x, h - 0.02, z);
    group.add(c, r);
    if (!lit.has(spot)) { rnd(); rnd(); continue; }
    // a real can throws a pool with a soft edge, each its own: a 38 to 45 degree cone (round 17; the 60 degree cones
    // before lit the floor evenly, so the room read flat), and no two aimed quite plumb (a can's gimbal is set by
    // hand), so the pools and scallops land at different spots and leans
    const l = new THREE.SpotLight(warm.clone().lerp(cool, tint), strength * 0.85, 0, Math.PI * (0.21 + rnd() * 0.04), 0.6 + rnd() * 0.15, 2);
    l.position.set(x, h - 0.03, z);
    l.target.position.set(x + (aim() - 0.5) * 1.6, 0, z + (aim() - 0.5) * 1.6);
    group.add(l, l.target);
    lights.push(l);
  }
  const shadowers = full ? [...lights].sort((a, b) => Math.hypot(a.position.x, a.position.z) - Math.hypot(b.position.x, b.position.z)).slice(0, 3) : [];
  for (const l of shadowers) {
    l.castShadow = true;
    l.shadow.mapSize.setScalar(g.preset === "ultra" ? 2048 : 1024);
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
  if (high) group.add(bounce);

  // floor lamps in the free corners (practicals()): a pole, a fabric drum shade glowing from inside, darker at its
  // middle where the cloth is thickest seen edge on; light spills out of its open top and bottom as two cones, the
  // bright hourglass a shaded lamp throws on the wall behind it, and a little through the cloth all round
  const lampLights: THREE.Light[] = [];
  shadeGlow ??= canvasTex(64, (g) => {
    for (let y = 0; y < 64; y++) { const t = Math.abs(y / 63 - 0.5) * 2, k = 0.55 + 0.45 * t * t; g.fillStyle = `rgb(${Math.round(255 * k)},${Math.round(236 * k)},${Math.round(206 * k)})`; g.fillRect(0, y, 64, 1); }
  }, true);
  // unlit (round 13): the bulb's own lights sit 20 cm inside it, lit the cloth past the bloom's threshold and threw a
  // halo round the lamp no lens makes. The cloth glows by its map alone, bright but under the bloom, and the lights
  // inside light only the room.
  const shadeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffb87a").multiplyScalar(1.3), map: shadeGlow, side: THREE.DoubleSide });
  const pole = surface("metal", "#2a2724");
  for (const [x, z] of practicals(def)) {
    const lamp = new THREE.Group(); lamp.name = "floor-lamp"; lamp.position.set(x, 0, z);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.025, 24), pole); foot.position.y = 0.012;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.45, 8), pole); stem.position.y = 0.74;
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.23, 0.3, 28, 1, true), shadeMat); drum.position.y = 1.55;
    const glow = new THREE.PointLight(0xffb878, 0.9, 4, 2); glow.position.y = 1.55;
    lamp.add(foot, stem, drum);
    group.add(lamp);
    if (!high) continue; // on low the shade glows and lights nothing
    lamp.add(glow);
    lampLights.push(glow);
    for (const [dy, cd, cone] of [[0.16, 30, 0.9], [-0.16, 22, 0.8]] as const) {
      const sp = new THREE.SpotLight(0xffc488, cd, 6, cone, 0.8, 2); // the cloth's rim blurs the cone's edge
      sp.position.set(0, 1.55 + dy * 0.2, 0); sp.target.position.set(0, dy > 0 ? 3 : 0, 0);
      lamp.add(sp, sp.target);
      lampLights.push(sp);
    }
  }

  // baked once the room stands: the shade where things meet the floor, then the reflections, taken from this room
  // under its own lights (from head height in the middle, lit by the generated room as its first bounce), so the
  // floor and the glass show the walls, the lights and the gear in front of them rather than a white box
  const bake = g.shadows === "off" ? 0 : ground(renderer, scene, group, def, high);
  // on low the generated room stays the reflection: baking this one renders the room six times and, at another size,
  // compiles every material a second time
  if (high) {
    const pm2 = new THREE.PMREMGenerator(renderer);
    bulb.emissiveIntensity = 1.2; // the cans as the room sees them: bright, not a sun smeared across every reflection
    if (glassFace) glassFace.visible = false;
    const roomEnv = pm2.fromScene(scene, 0.02, 0.05, Math.hypot(w, d, h), { size: 256, position: new THREE.Vector3(0, Math.min(1.5, h / 2), 0) });
    pm2.dispose();
    bulb.emissiveIntensity = 6;
    if (glassFace) { glassFace.visible = true; glassFace.envMap = roomEnv.texture; } // its own map: a scene environment would override its strength
    scene.environment = roomEnv.texture;
    scene.environmentIntensity = 0.5; // the downlights light the room already: this is their bounce
  }

  // the post: a little bloom on the lights, the lens's vignette and grain
  const post: string[] = [];
  // (no screen-space AO: its depth pass takes the glass for a wall and fogs the view through it, and it costs the most)
  let composer: EffectComposer | null = null, film: ShaderPass | null = null;
  if (g.bloom || g.lens) {
    composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(1, 1) }));
    composer.addPass(new RenderPass(scene, camera));
    if (g.lens) composer.addPass(new Focus(camera)); // before the bloom, so a blurred lamp still blooms round its blur
    // only light sources bloom (the cans glow at 6): a lit surface under a can, like white keys, stays crisp
    if (g.bloom) composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.18, 0.35, 4));
    composer.addPass(new OutputPass());
    film = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, t: { value: 0 } },
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `uniform sampler2D tDiffuse; uniform float t; varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + t) * 43758.5453); }
        void main() {
          vec2 q = vUv - 0.5;
          vec4 c = texture2D(tDiffuse, vUv);
          // a real lens fringes a little toward its edges: red and blue land a hair apart, nothing at the middle
          c.r = texture2D(tDiffuse, vUv + q * 0.0025).r;
          c.b = texture2D(tDiffuse, vUv - q * 0.0025).b;
          c.rgb *= 1.0 - dot(q, q) * 0.55;            // the lens darkens toward its corners
          c.rgb += (hash(vUv * 977.0) - 0.5) * 0.025; // film grain
          gl_FragColor = c;
        }`,
    });
    if (g.lens) composer.addPass(film);
    post.push(...(g.lens ? ["focus"] : []), ...(g.bloom ? ["bloom"] : []), ...(g.lens ? ["fringe", "vignette", "grain"] : []));
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
      // a lamp's shade (glowing and open, so seen from both sides) is unlit (round 13): the bulb's light 13 cm inside it lit
      // the cloth past the bloom's threshold, a halo round the lamp no lens makes. It glows by its own colour, under the bloom.
      if (glow > 0 && mat instanceof THREE.MeshStandardMaterial && mat.side === THREE.DoubleSide) {
        o.material = new THREE.MeshBasicMaterial({ color: mat.color.clone().multiplyScalar(1 + 1.2 * glow), map: mat.map, side: THREE.DoubleSide });
        return;
      }
      if (glow > 0 && mat instanceof THREE.MeshStandardMaterial) {
        o.material = mat.clone();
        if (o.material instanceof THREE.MeshStandardMaterial) { if (mat.emissive.getHex() === 0) o.material.emissive.copy(mat.color); /* a screen is dark glass lit by its own colour: keep it */ o.material.emissiveIntensity = 2 * glow; o.material.transparent = false; o.material.opacity = 1; o.material.depthWrite = true; } // a lit bulb is solid light, even one made of glass
        if (o.userData.lamp && lamps.length < (high ? 4 : 0)) { const p = new THREE.PointLight(0xffd7a8, 6 * glow, 6, 2); o.add(p); lamps.push(p); }
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
    state: () => ({ quality, lights: lights.length + lamps.length + lampLights.length + 1, shadows: shadowers.length, post, tone: g.tone ? "aces" : "none", exposure: renderer.toneMappingExposure, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, fps, ground: bake, env: high ? "room" : "generated" }),
  };
}

/** Any room's look with the knobs that change while it runs (#6475): the render scale, frozen shadows and the frame cap. */
export interface Governed extends Look { run(r: Running, level: number): void }
export function runningLook(look: Look, renderer: THREE.WebGLRenderer, g: Graphics): Governed {
  let now: Running & { level: number } = { scale: g.scale, freezeShadows: false, cap: g.cap, level: 0 }, size: [number, number] = [1, 1], last = 0;
  renderer.setPixelRatio(Math.min(g.scale, devicePixelRatio)); // the open air sets its own: the knob wins
  // With no GPU every draw is the processor's, and drawn back to back they leave the page no time for its clicks and its
  // room's messages (#6555: three rooms in headless Chrome never got in). One a second; the frames between still walk and listen.
  const gl = renderer.getContext(), info = gl.getExtension("WEBGL_debug_renderer_info");
  const software = /swiftshader|llvmpipe|software/i.test(String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : ""));
  return {
    quality: look.quality,
    render(cam) {
      // a cap skips a draw, never the frame: walking and the clock still run every frame
      const cap = software ? 1 : now.cap;
      if (cap) { const t = performance.now(); if (t - last < 1000 / cap - 2) return; last = t; }
      look.render(cam);
    },
    resize(w, h) { size = [w, h]; look.resize(w, h); },
    stage: (l) => look.stage?.(l),
    run(r, level) {
      if (r.scale !== now.scale) { renderer.setPixelRatio(Math.min(r.scale, devicePixelRatio)); look.resize(...size); }
      // frozen, the cans' shadow maps stop being drawn every frame: what stands still keeps its shadow, and no shader recompiles
      if (r.freezeShadows !== now.freezeShadows) { renderer.shadowMap.autoUpdate = !r.freezeShadows; renderer.shadowMap.needsUpdate = true; }
      now = { ...r, level };
    },
    state: () => ({ ...look.state(), graphics: g, running: now }),
  };
}
