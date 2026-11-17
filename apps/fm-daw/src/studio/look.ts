// How a Qollab Studio room looks (#5008): the light, what every surface is made of, and the camera's lens and film.
// A room is data (room.ts); this turns its sizes and materials into something that should read as a photo of a real
// small studio: tone mapped light, ceiling downlights set off the walls so they wash them (no two alike), the floor's warm
// bounce lifting the tops of the walls, floor lamps in the free corners, soft shadows, contact shadows
// and shade in the corners baked once, reflections of the room itself,
// textures painted in code (planks with grain, ceiling tiles on their grid, wedge foam, folded curtains, brick, carpet),
// the room's absorbers and curtains hung where its data says, and on high a little bloom, a vignette and grain.
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
import { mulberry32 } from "@rustybuns/util";
import type { Side, StudioDef } from "./room.ts";
import { MATERIALS } from "./sound.ts";

export type Quality = "low" | "high";
const KEY = "qollab-studio:quality";

/** The setting: ?quality= first, then what this browser chose last, else high unless it's a phone. */
export function pickQuality(search: string, stored: string | null, coarse: boolean): Quality {
  const q = new URLSearchParams(search).get("quality") ?? stored;
  return q === "low" || q === "high" ? q : coarse ? "low" : "high";
}
export function loadQuality(): Quality {
  let stored: string | null = null;
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
 * A material by what it is made of: a room material (sound.ts's names: floorboards, wood, carpet, foam, curtain, brick,
 * concrete, stone, tile, plaster, drywall, ceilingTile, glass) or `metal`, `chrome`, `plastic`, `rubber`, `fabric`,
 * `grille`, `screen`. The colour tints it (a room material's own colour when left out). Shared: don't change it.
 * Geometry built with it should carry UVs in metres (`metreUV`) so the grain comes out the right size.
 */
export function surface(name: string, color?: string): THREE.MeshStandardMaterial {
  const known = name in MATERIALS ? MATERIALS[name as keyof typeof MATERIALS].color : "#808080";
  const id = `${name}:${color ?? known}`, hit = mats.get(id);
  if (hit) return hit;
  const fromKit = kit?.(name, color);
  if (fromKit) { mats.set(id, fromKit); return fromKit; }
  const c = new THREE.Color(color ?? known), l = LOOKS[name];
  let m: THREE.MeshStandardMaterial;
  // glass is nearly clear: blended in linear light a few percent of a pale tint fogs the dark room behind it; its
  // reflections are what say it's there
  if (name === "glass") m = new THREE.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.35), transparent: true, opacity: 0.025, roughness: 0.04, metalness: 0, envMapIntensity: 0.8, depthWrite: false });
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

/** Where an outside wall is: its middle, which way along it runs, and the way into the room. */
function sideOf(def: StudioDef, side: Side) {
  const { w, d } = def.size;
  return side === "back" ? { cx: 0, cz: -d / 2, len: w, turn: 0 }
    : side === "front" ? { cx: 0, cz: d / 2, len: w, turn: Math.PI }
    : side === "left" ? { cx: -w / 2, cz: 0, len: d, turn: Math.PI / 2 }
    : { cx: w / 2, cz: 0, len: d, turn: -Math.PI / 2 };
}

/** The absorbers and curtains a room's `panels` list, hung on their walls; skirting along the floor. */
function hang(def: StudioDef, group: THREE.Group) {
  const { h } = def.size;
  for (const side of ["front", "back", "left", "right"] as const) {
    const s = sideOf(def, side), wall = new THREE.Group();
    wall.position.set(s.cx, 0, s.cz); wall.rotation.y = s.turn;
    group.add(wall);
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(s.len, 0.09, 0.015), surface("plastic", "#1d1e21"));
    skirt.position.set(0, 0.045, 0.068); wall.add(skirt);
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
      } else {
        // absorbers: 60 cm squares, five centimetres proud of the wall, centred at ear height, in rows of two or three
        const n = Math.max(1, Math.round(p.m2 / 0.36)), rows = Math.min(3, Math.max(1, Math.round(Math.sqrt(n / 2)))), cols = Math.ceil(n / rows);
        const tile = new THREE.BoxGeometry(0.58, 0.58, 0.05);
        const room = s.len / 2 - along - 0.3, cell = Math.min(0.64, room / Math.max(1, cols));
        for (let i = 0; i < n; i++) {
          const c = i % cols, r = Math.floor(i / cols), m = new THREE.Mesh(metreUV(tile.clone()), surface(p.material));
          m.position.set(along + 0.3 + c * cell, 1.45 + (r - (rows - 1) / 2) * 0.64, 0.085);
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

let fade: THREE.CanvasTexture | null = null;
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
  const { h } = def.size, mat = shade(fade, 0.55), top = shade(fade, 0.22); // the bounce off the floor lights the tops: only a hint of shade there
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
    band(h, 0.6, -s.len / 2 + 0.36, h / 2, -Math.PI / 2);
    band(h, 0.6, s.len / 2 - 0.36, h / 2, Math.PI / 2);
  }
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
 * for warm light at head height. A corner is free when no seat is within 1.4 m and no inner wall within half a
 * metre; of those, the two farthest from any seat, at most. A hall too big for a lamp to tell gets none.
 */
export function practicals(def: StudioDef): [number, number][] {
  const { w, d } = def.size;
  if (w > 16 || d > 16) return [];
  const inset = 0.45, near = (p: [number, number]) => Math.min(Infinity, ...def.spots.map((s) => Math.hypot(p[0] - s.at[0], p[1] - s.at[1])));
  const free = ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const)
    .map(([sx, sz]): [number, number] => [sx * (w / 2 - inset), sz * (d / 2 - inset)])
    .filter((p) => near(p) > 1.4 && def.walls.every((wl) => toSegment(p, wl.from, wl.to) > 0.5));
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
    const l = new THREE.SpotLight(warm.clone().lerp(cool, rnd()), power * (0.72 + rnd() * 0.45), 0, Math.PI * (0.28 + rnd() * 0.05), 0.85, 2);
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

  // floor lamps in the free corners (practicals()): a pole, a fabric drum shade lit from inside, warm light at head height
  const lampLights: THREE.PointLight[] = [];
  const shadeMat = new THREE.MeshStandardMaterial({ color: "#f3dcb4", emissive: "#ffc98a", emissiveIntensity: 1.1, roughness: 0.9, side: THREE.DoubleSide });
  const pole = surface("metal", "#2a2724");
  for (const [x, z] of practicals(def)) {
    const lamp = new THREE.Group(); lamp.name = "floor-lamp"; lamp.position.set(x, 0, z);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.025, 24), pole); foot.position.y = 0.012;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.45, 8), pole); stem.position.y = 0.74;
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.23, 0.3, 28, 1, true), shadeMat); drum.position.y = 1.55;
    const p = new THREE.PointLight(0xffc68c, 3.2, 7, 2); p.position.y = 1.5;
    lamp.add(foot, stem, drum, p);
    group.add(lamp);
    lampLights.push(p);
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
        if (o.material instanceof THREE.MeshStandardMaterial) { o.material.emissive.copy(mat.color); o.material.emissiveIntensity = 2 * glow; o.material.transparent = false; o.material.opacity = 1; o.material.depthWrite = true; } // a lit bulb is solid light, even one made of glass
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
