// The arena's look. The layout (a ring of radius ARENA.radius, a lake past x = ARENA.lake.x, a low
// ceiling for flyers) is the sim's and never changes; a skin only repaints it, so a new stadium is a
// new entry in SKINS, not new rules.
import * as THREE from "three";
import { mulberry32 } from "@rustybuns/util";
import { mergeGeometries, toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ARENA } from "./sim.ts";
import { buildCrowd, type Crowd, type Seat } from "./crowd.ts";
import type { Biome } from "./regions.ts";
import type { Kind, Plant } from "./world/flora.ts";
import { SETS, type Horizon } from "./arena-sets.ts";
import { buildPocket, POCKETS } from "./pockets.ts";

/** What a floor is: mown turf, sand with ripples and pebbles, sand under a litter of pine needles, or cracked
 * basalt whose seams glow; plain grain for the rest. */
export type Floor = "grain" | "turf" | "sand" | "litter" | "basalt";
const S = 512;

/** A floor's grain: soft light and dark patches (turf, rock, cloud) around white, so `color` still sets the
 * tint, then the floor's own marks. Every mark is drawn wrapped, so the tile has no seam. */
function mottle(seed: number, floor: Floor = "grain", repeat = 6): THREE.CanvasTexture {
  const c = document.createElement("canvas"), rnd = mulberry32(seed);
  c.width = c.height = S;
  const x = c.getContext("2d")!, k = S / 256;
  const wrapped = (draw: (dx: number, dy: number) => void) => { for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) draw(dx, dy); };
  x.fillStyle = "#e6e6e6"; x.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    const r = (2 + rnd() * (i < 120 ? 34 : 7)) * k, v = Math.round(200 + rnd() * 55);
    x.fillStyle = `rgba(${v},${v},${v},${0.18 + rnd() * 0.22})`;
    const cx = rnd() * S, cy = rnd() * S;
    wrapped((dx, dy) => { x.beginPath(); x.arc(cx + dx, cy + dy, r, 0, Math.PI * 2); x.fill(); });
  }
  if (floor === "turf") {
    // mown stripes, then blades: short strokes light and dark
    for (let b = 0; b < 4; b++) { x.fillStyle = b % 2 ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.07)"; x.fillRect(0, (b * S) / 4, S, S / 4); }
    for (let i = 0; i < 9000; i++) {
      const cx = rnd() * S, cy = rnd() * S, len = 2 + rnd() * 4, a = -Math.PI / 2 + (rnd() - 0.5) * 0.9, v = rnd() < 0.5 ? 255 : 40;
      x.strokeStyle = `rgba(${v},${v},${v},${0.08 + rnd() * 0.12})`; x.lineWidth = 1;
      x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len); x.stroke();
    }
  }
  if (floor === "sand" || floor === "litter") {
    // wind ripples: soft wavy bands, then pebbles with a shadow on one side
    for (let row = 0; row < 26; row++) {
      const y0 = (row / 26) * S, ph = rnd() * 6;
      x.strokeStyle = `rgba(120,100,80,${0.07 + rnd() * 0.05})`; x.lineWidth = 2 * k;
      x.beginPath();
      for (let px = 0; px <= S; px += 8) x.lineTo(px, y0 + Math.sin((px / S) * Math.PI * 4 + ph) * 4 * k);
      x.stroke();
    }
    for (let i = 0; i < 55; i++) {
      const cx = rnd() * S, cy = rnd() * S, r = (0.8 + rnd() * 2.2) * k, v = Math.round(165 + rnd() * 40), turn = rnd();
      wrapped((dx, dy) => {
        x.fillStyle = "rgba(60,50,40,0.1)"; x.beginPath(); x.ellipse(cx + dx + r * 0.4, cy + dy + r * 0.4, r, r * 0.8, 0, 0, Math.PI * 2); x.fill();
        x.fillStyle = `rgb(${v},${v - 8},${v - 16})`; x.beginPath(); x.ellipse(cx + dx, cy + dy, r, r * 0.75, turn, 0, Math.PI * 2); x.fill();
      });
    }
  }
  if (floor === "litter") {
    // shed needles in rusty browns
    for (let i = 0; i < 5000; i++) {
      const cx = rnd() * S, cy = rnd() * S, len = (3 + rnd() * 5) * k, a = rnd() * Math.PI, t = rnd();
      x.strokeStyle = `rgba(${90 + t * 60},${55 + t * 30},${30 + t * 15},${0.12 + rnd() * 0.22})`; x.lineWidth = 0.8 * k;
      x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len); x.stroke();
    }
  }
  if (floor === "basalt") {
    x.fillStyle = "rgba(0,0,0,0.25)"; x.fillRect(0, 0, S, S);
    x.strokeStyle = "rgba(10,8,8,0.85)"; x.lineWidth = 3 * k;
    for (const path of crackPaths(seed)) strokeWrapped(x, path);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/** Which baked ground layer (blender/ground.py, public/ground-tex/) a floor stands on; a basalt floor has its own seams. */
const LAYER_OF: Partial<Record<Floor, string>> = { turf: "turf", sand: "sand", litter: "needles" };
/** Gives `m` the baked ground texture of a floor, `metres` a tile, over `span` metres of it. The grain map (mottle) stays until
 * the picture arrives, and a floor with no layer keeps it. The texture is a detail map (0.5 is the tint), so the colour is doubled. */
function groundMap(m: THREE.MeshStandardMaterial, floor: Floor, span: number, metres = 3.2) {
  const layer = LAYER_OF[floor];
  if (!layer) return m;
  new THREE.TextureLoader().load(`/ground-tex/${layer}.jpg`, (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(span / metres, span / metres); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    m.map = t; m.color.multiplyScalar(2); m.needsUpdate = true;
  });
  new THREE.ImageLoader().load(`/ground-tex/${layer}.n.jpg`, (img) => {
    const t = new THREE.CanvasTexture(tangentNormals(img));
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(span / metres, span / metres); t.anisotropy = 8;
    // the bake leans along the picture's down, a tangent-space map along its up: flip y
    m.normalMap = t; m.normalScale.set(3, -3); m.needsUpdate = true;
  });
  return m;
}

/** A baked ground normal map (RG: the lean, B: the layer's feature mask, blender/ground.py) as a tangent-space one: the
 * lean kept and z rebuilt from it, so three's normalMap reads it. */
export function tangentNormals(img: CanvasImageSource & { width: number; height: number }): HTMLCanvasElement {
  const c = document.createElement("canvas"), x = c.getContext("2d", { willReadFrequently: true })!;
  c.width = img.width; c.height = img.height;
  x.drawImage(img, 0, 0);
  const px = x.getImageData(0, 0, c.width, c.height);
  decodeNormals(px.data);
  x.putImageData(px, 0, 0);
  return c;
}
/** In place, RGBA bytes: B becomes the unit normal's z from its x and y in R and G. */
export function decodeNormals(d: Uint8ClampedArray) {
  for (let i = 0; i < d.length; i += 4) {
    const nx = d[i]! / 127.5 - 1, ny = d[i + 1]! / 127.5 - 1;
    d[i + 2] = Math.round(127.5 + 127.5 * Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)));
  }
}

/** Random walks across the tile: a lava floor's cracks, the same for a seed, so the colour map and the glow agree. */
function crackPaths(seed: number): [number, number][][] {
  const rnd = mulberry32(seed + 101);
  return Array.from({ length: 34 }, () => {
    let px = rnd() * S, py = rnd() * S, a = rnd() * Math.PI * 2;
    const pts: [number, number][] = [[px, py]];
    for (let j = 0, len = 6 + Math.floor(rnd() * 14); j < len; j++) { a += (rnd() - 0.5) * 1.2; px += Math.cos(a) * 12; py += Math.sin(a) * 12; pts.push([px, py]); }
    return pts;
  });
}
function strokeWrapped(x: CanvasRenderingContext2D, pts: [number, number][]) {
  for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) { x.beginPath(); for (const [px, py] of pts) x.lineTo(px + dx, py + dy); x.stroke(); }
}
/** The glow in a basalt floor's cracks: black with orange seams, for `emissiveMap`; a third of the cracks run hot. */
function seams(seed: number): THREE.CanvasTexture {
  const c = document.createElement("canvas"), x = c.getContext("2d")!;
  c.width = c.height = S;
  x.fillStyle = "#000"; x.fillRect(0, 0, S, S);
  x.lineCap = "round";
  crackPaths(seed).forEach((path, i) => {
    if (i % 3) return;
    x.strokeStyle = "rgba(255,120,40,0.35)"; x.lineWidth = 7; strokeWrapped(x, path);
    x.strokeStyle = "rgba(255,190,90,0.95)"; x.lineWidth = 2; strokeWrapped(x, path);
  });
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 6); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Which floor a skin stands on. */
export function floorOf(skin: Skin): Floor {
  if (skin.under !== undefined) return "basalt";
  if (skin.props === "stands") return "turf";
  const c = new THREE.Color(skin.ground);
  if (c.g > c.r * 1.05) return "turf";
  if (skin.props === "trees") return "litter";
  return "sand";
}

export interface Skin {
  name: string;
  sky: number; fog: number; ground: number; line: number; water: number; rim: number; prop: number;
  props: "stands" | "rocks" | "clouds" | "trees";
  /** What glows far below the ring, if anything (the volcano's lava). */
  under?: number;
  /** A region's biome: what grows round its ring (the open world's plants, src/world/flora.ts). */
  biome?: Biome;
  /** A built region's id: its set piece, horizon and light (src/arena-sets.ts). */
  region?: string;
  /** A pocket's id (src/pockets.ts): walls, roof, fog and lanterns in place of the open sky and the set piece. */
  pocket?: string;
}
/** A light colour grade per skin, drawn from its own palette: a tint (the sky's, or the lava's glow under a dark sky)
 * pulled to a gentle lean, its brightest channel held at 1 so it never darkens, and a touch of saturation. */
export function gradeOf(skin: Skin): { tint: THREE.Color; saturation: number } {
  const sky = new THREE.Color(skin.sky), lum = sky.r * 0.2126 + sky.g * 0.7152 + sky.b * 0.0722;
  const lean = new THREE.Color(skin.under !== undefined && lum < 0.1 ? skin.under : skin.sky);
  const tint = new THREE.Color(1, 1, 1).lerp(lean, 0.2);
  tint.multiplyScalar(1 / Math.max(tint.r, tint.g, tint.b));
  return { tint, saturation: skin.under !== undefined ? 1.12 : 1.06 };
}
export const SKINS: Record<string, Skin> = {
  stadium: { name: "Stadium", sky: 0x9fc7e8, fog: 0xbcd6ea, ground: 0x5f9b4c, line: 0xf2f2e6, water: 0x2f78b8, rim: 0xc9c2b0, prop: 0x8a8f99, props: "stands" },
  volcano: { name: "Volcano", sky: 0x2a1410, fog: 0x3a1c14, ground: 0x3b3430, line: 0xff7a2f, water: 0x3a9a9a, rim: 0x55301f, prop: 0x241c18, props: "rocks", under: 0xff5a1f },
  sky: { name: "Sky island", sky: 0x7fb6ff, fog: 0xd8ecff, ground: 0xc8d8a8, line: 0xffffff, water: 0x7fd0ff, rim: 0x9a8a70, prop: 0xffffff, props: "clouds" },
};

export function buildArena(scene: THREE.Scene, skin: Skin): THREE.Group {
  const g = new THREE.Group();
  const pocket = skin.pocket ? POCKETS[skin.pocket] : undefined;
  const piece = skin.region && !pocket ? SETS[skin.region] : undefined, mood = piece?.mood;
  scene.background = new THREE.Color(pocket?.fog.color ?? skin.sky);
  scene.fog = pocket ? new THREE.Fog(pocket.fog.color, pocket.fog.near, pocket.fog.far)
    : new THREE.Fog(new THREE.Color(skin.fog).lerp(new THREE.Color(skin.sky), 0.25), mood?.fog[0] ?? 30, mood?.fog[1] ?? 90);
  const R = ARENA.radius;
  const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });

  const kind = floorOf(skin);
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.92, 1.2, 64), groundMap(mat(skin.ground, {
    map: mottle(7, kind), ...(pocket ? { envMapIntensity: 0.12, color: new THREE.Color(skin.ground).multiplyScalar(0.55) } : {}), ...(kind === "basalt" ? { emissiveMap: seams(7), emissive: new THREE.Color(skin.under ?? 0xff5a1f), emissiveIntensity: 1.6 } : {}),
  }), kind, R * 2));
  floor.position.y = -0.6; floor.receiveShadow = true; g.add(floor);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.16, 12, 128), mat(skin.rim, { map: (() => { const t = mottle(21, "grain"); t.repeat.set(48, 1); return t; })(), roughness: 0.8 }));
  rim.castShadow = rim.receiveShadow = true;
  rim.rotation.x = Math.PI / 2; rim.position.y = 0.02; g.add(rim);
  const centre = new THREE.Mesh(new THREE.RingGeometry(2.4, 2.55, 48), new THREE.MeshBasicMaterial({ color: skin.line }));
  centre.rotation.x = -Math.PI / 2; centre.position.y = 0.01; g.add(centre);

  // The lake: the slice of the ring past x = lake.x.
  const a = Math.acos(ARENA.lake.x / R), shape = new THREE.Shape();
  shape.moveTo(ARENA.lake.x, -Math.sin(a) * R);
  shape.absarc(0, 0, R - 0.05, -a, a, false);
  shape.lineTo(ARENA.lake.x, -Math.sin(a) * R);
  const lake = new THREE.Mesh(new THREE.ShapeGeometry(shape, 32), lakeMaterial(skin, ARENA.lake.x, R));
  lake.rotation.x = -Math.PI / 2; lake.rotation.z = 0; lake.scale.y = -1; lake.position.y = 0.03; g.add(lake);

  // Props sit outside the ring: scenery, not walls.
  const ring = (n: number, r: number, make: (i: number) => THREE.Object3D) => {
    for (let i = 0; i < n; i++) { const o = make(i), t = (i / n) * Math.PI * 2; o.position.x += Math.cos(t) * r; o.position.z += Math.sin(t) * r; o.rotation.y = -t; g.add(o); }
  };
  if (skin.props === "stands" && !pocket) g.add(stands(R, skin.prop, g));
  if ((skin.props === "rocks" || skin.props === "trees") && !pocket) g.add(dressing(skin, R));
  if (skin.under !== undefined) {
    const glow = new THREE.Mesh(new THREE.CircleGeometry(R + 30, 48), new THREE.MeshBasicMaterial({ color: skin.under }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = -7; g.add(glow);
  }
  if (skin.props === "clouds") ring(14, R + 12, (i) => { const m = new THREE.Mesh(new THREE.SphereGeometry(3 + (i % 3), 12, 8), mat(skin.prop, { transparent: true, opacity: 0.8 })); m.position.y = -6 + (i % 4); m.scale.y = 0.45; return m; });

  if (pocket) ticks.set(g, buildPocket(g, pocket, R));
  // a stadium's bowl closes the view: no rolling hills over its rim, where one peak in the stands' grey read as a dome
  // in the sky (#3840); a region's own horizon still stands
  else g.add(skyDome(skin, mood?.haze ?? 0), hills(skin, piece?.horizon ?? (skin.props === "stands" ? "flat" : "hills")));
  if (piece) { const tick = piece.build(g, R); if (tick) ticks.set(g, tick); }
  // the lake's bank: a strip of wet sand where the turf meets the water, so the shore isn't a cut
  const chord = 2 * Math.sin(a) * R;
  const bank = new THREE.Mesh(new THREE.PlaneGeometry(1.1, chord - 0.4), mat(new THREE.Color(skin.ground).lerp(new THREE.Color(0xd8c8a0), 0.6).getHex(), { roughness: 0.75, map: (() => { const t = mottle(33, "sand"); t.repeat.set(1, 6); return t; })() }));
  bank.rotation.x = -Math.PI / 2; bank.position.set(ARENA.lake.x - 0.35, 0.015, 0); bank.receiveShadow = true; g.add(bank);
  const foam = new THREE.Mesh(new THREE.PlaneGeometry(0.22, chord - 0.4), new THREE.MeshBasicMaterial({ color: 0xf4f8f8, transparent: true, opacity: 0.55, depthWrite: false }));
  foam.rotation.x = -Math.PI / 2; foam.position.set(ARENA.lake.x + 0.3, 0.035, 0); g.add(foam);

  // a warm key from the sun's side of the sky, against the cool sky fill and the cool rim behind
  const sun = new THREE.DirectionalLight(mood?.sunColour ?? 0xfff0d8, pocket ? 0.25 : mood?.sunPower ?? 2.5);
  sun.position.copy(mood ? new THREE.Vector3(...mood.sun) : SUN); sun.castShadow = true;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -22; sun.shadow.camera.right = sun.shadow.camera.top = 22;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
  // a cool light from behind the far side: an edge of light along every back and head, so a black hide reads
  const back = new THREE.DirectionalLight(0xcfe0ff, 1.6);
  back.name = "rim"; // main.ts keeps it opposite the camera, so it always edges the side you see
  back.position.set(14, 9, -16);
  g.add(sun, back, new THREE.HemisphereLight(pocket ? pocket.roof.color : skin.sky, skin.ground, pocket ? 0.35 : mood?.fill ?? 0.8));
  if (skin.under === undefined) {
    // light thrown back up from the floor: every belly and jaw picks up the arena's ground colour
    const bounce = new THREE.DirectionalLight(new THREE.Color(skin.ground).lerp(new THREE.Color(0xffffff), 0.15), pocket ? 0.15 : 0.7);
    bounce.position.set(0, -10, 0); g.add(bounce);
  }
  if (skin.under !== undefined) {
    // the lava below lights every belly and jaw from underneath
    const lava = new THREE.DirectionalLight(skin.under, 1.4);
    lava.position.set(4, -10, 3); g.add(lava);
  }
  scene.add(g);
  return g;
}

/** What stands round a ring that isn't a stadium: ground running out to the hills, and the open world's plants
 * (trees behind, ferns, bushes and stones at the ring's edge) for the region's biome. A ring over lava (`under`)
 * has no ground, only rock spires rising out of the glow. The plants come in a moment after the ring, when the
 * shared scenery set has loaded. */
function dressing(skin: Skin, R: number): THREE.Group {
  const g = new THREE.Group(), floating = skin.under !== undefined;
  if (!floating) {
    const ground = new THREE.Mesh(new THREE.RingGeometry(R - 0.3, 70, 96, 4), groundMap(new THREE.MeshStandardMaterial({
      color: new THREE.Color(skin.ground).lerp(new THREE.Color(skin.prop), 0.35).multiplyScalar(0.85), roughness: 1, map: mottle(9, floorOf(skin), 14),
    }), floorOf(skin), 140, 4.5));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.35; ground.receiveShadow = true; g.add(ground);
  }
  void import("./world/flora.ts").then(async ({ scenery, grown, grownMaterial, FLORA, TALL }) => {
    const [plain, more] = await Promise.all([scenery(), grown()]);
    if (!plain.size && !more.size) return;
    const spec: Plant[] = floating ? [["rock", 0.75, 6, 13], ["snag", 0.25, 5, 9]]
      : skin.biome ? FLORA[skin.biome].kinds : skin.props === "rocks" ? [["rock", 0.7, 1, 4], ["sage", 0.3, 0.4, 1]] : FLORA["pine-barrens"].kinds;
    const total = spec.reduce((a, k) => a + k[1], 0), rnd = mulberry32(17), o = new THREE.Object3D();
    const rockTint = floating ? new THREE.Color(skin.prop).multiplyScalar(2.6) : skin.props === "rocks" ? new THREE.Color(0xffffff).lerp(new THREE.Color(skin.prop), 0.55) : new THREE.Color(0xffffff);
    const placed = new Map<Kind, THREE.Matrix4[]>();
    const N = floating ? 26 : 230;
    for (let i = 0; i < N; i++) {
      let roll = rnd() * total, pick = spec[0]!;
      for (const k of spec) if ((roll -= k[1]) < 0) { pick = k; break; }
      const [kind, , lo, hi] = pick, tall = TALL.has(kind);
      // tall things stand back so they frame the ring without hiding it; small ones crowd its edge
      const r = floating ? R + 5 + rnd() * 16 : tall ? R + 6 + rnd() * rnd() * 34 : R + 1 + rnd() * rnd() * 16;
      const t = rnd() * Math.PI * 2, size = lo + (hi - lo) * rnd(), girth = kind === "rock" ? (floating ? 0.3 : 1.2) + rnd() * (floating ? 0.3 : 0.6) : tall ? 0.85 + 0.3 * rnd() : 1.1;
      o.position.set(Math.cos(t) * r, floating ? -9 + rnd() * 2 : -0.35 - (kind === "rock" ? size * 0.2 : 0.05), Math.sin(t) * r);
      o.rotation.set(0, rnd() * Math.PI * 2, 0);
      o.scale.set(size * girth, size * (floating && kind === "rock" ? 2 : 1), size * girth * (kind === "rock" ? 0.8 + 0.4 * rnd() : 1));
      o.updateMatrix();
      placed.set(kind, [...(placed.get(kind) ?? []), o.matrix.clone()]);
    }
    for (const [kind, ms] of placed) {
      const near = more.get(kind)?.near, geo = near ?? plain.get(kind);
      if (!geo) continue;
      const soft = kind !== "rock";
      // a grown plant keeps its own normals (leaves facing out of the crown); the scenery set's are softened here
      const mesh = new THREE.InstancedMesh(near ? geo : soft ? softened(geo) : geo, near ? grownMaterial() : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: !soft, color: kind === "rock" || floating ? rockTint : 0xffffff }), ms.length);
      ms.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.castShadow = !floating; mesh.receiveShadow = true;
      g.add(mesh);
    }
  });
  return g;
}

/** Smooth normals for plants, so a tree reads as a soft crown instead of facets that clash with the smooth beasts; rocks stay faceted. */
const softs = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
function softened(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  let out = softs.get(geo);
  if (!out) { out = toCreasedNormals(geo, Math.PI / 2.5); softs.set(geo, out); }
  return out;
}

/** The sky's top, deeper and a touch more saturated than the skin's sky colour, so a pale sky isn't washed out. */
function deepen(c: THREE.Color): THREE.Color {
  const hsl = c.getHSL({ h: 0, s: 0, l: 0 });
  return c.setHSL(hsl.h, Math.min(1, hsl.s * 1.25 + 0.05), hsl.l * 0.72);
}

/** The lake: shallow and pale at the bank, deep in the middle, a soft edge into the turf, and two layers of
 * ripple sheen drifting over it. The shape's x runs from the shore (`x0`) out to the ring (`R`). */
function lakeMaterial(skin: Skin, x0: number, R: number): THREE.ShaderMaterial {
  const deep = new THREE.Color(skin.water).multiplyScalar(0.55), shallow = new THREE.Color(skin.water).lerp(new THREE.Color(0xd8f0e8), 0.45);
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { deep: { value: deep }, shallow: { value: shallow }, time: { value: 0 }, x0: { value: x0 }, span: { value: R - x0 } },
    vertexShader: "varying vec2 p; void main() { p = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform vec3 deep; uniform vec3 shallow; uniform float time; uniform float x0; uniform float span; varying vec2 p;
float rip(vec2 q, float t) { return sin(q.x * 3.1 + t * 0.9 + sin(q.y * 2.3 + t * 0.6) * 1.7) * sin(q.y * 2.7 - t * 0.7 + sin(q.x * 1.9 - t * 0.5) * 1.3); }
void main() {
  float d = clamp((p.x - x0) / span, 0.0, 1.0);
  float depth = smoothstep(0.0, 0.55, d);
  vec3 c = mix(shallow, deep, depth);
  float s = rip(p, time) + 0.6 * rip(p * 2.3 + 5.0, time * 1.4);
  c += vec3(0.8, 0.92, 1.0) * smoothstep(0.75, 1.3, s) * (0.25 + 0.35 * depth);
  float edge = smoothstep(0.0, 0.06, d);
  gl_FragColor = vec4(c, mix(0.0, 0.9, edge));
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`,
  });
  const clock = new THREE.Clock();
  m.onBeforeRender = () => { m.uniforms.time!.value = clock.getElapsedTime(); };
  return m;
}

/** Where the sun stands: the key light comes from here, and the sky draws its glow here. */
const SUN = new THREE.Vector3(-12, 24, 10);

/** A sky that fades from a deeper blue overhead to the fog's colour at the horizon, with soft clouds drifting
 * across it and a glow round the sun, so the ring sits in air, not on a flat card. A dark sky (the volcano's)
 * gets smoke lit from below by `under` instead of white clouds. */
function skyDome(skin: Skin, haze = 0): THREE.Mesh {
  const horizon = new THREE.Color(skin.fog), top = deepen(new THREE.Color(skin.sky)).lerp(horizon, haze * 0.6);
  const dark = new THREE.Color(skin.sky).getHSL({ h: 0, s: 0, l: 0 }).l < 0.25;
  const cloud = dark ? new THREE.Color(skin.under ?? skin.fog).multiplyScalar(0.35) : new THREE.Color(0xffffff).lerp(horizon, 0.25);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: top }, horizon: { value: horizon }, cloud: { value: cloud }, sun: { value: SUN.clone().normalize() }, glow: { value: dark ? 0 : 1 } },
    vertexShader: "varying vec3 d; void main() { d = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 cloud; uniform vec3 sun; uniform float glow; varying vec3 d;
float sh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(sh(i), sh(i + vec2(1, 0)), f.x), mix(sh(i + vec2(0, 1)), sh(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * sn(p); p = p * 2.03 + 17.0; a *= 0.5; } return v; }
void main() {
  vec3 n = normalize(d);
  vec3 c = mix(horizon, top, smoothstep(-0.05, 0.55, n.y));
  float s = max(dot(n, sun), 0.0);
  c += glow * vec3(1.0, 0.86, 0.6) * (pow(s, 64.0) * 1.1 + pow(s, 8.0) * 0.22);
  c = mix(c, c * vec3(1.06, 1.0, 0.92), glow * smoothstep(0.0, 0.6, s));
  // clouds on a plane overhead: thick near the horizon, thin above, faded out at the very horizon
  vec2 uv = n.xz / max(n.y + 0.12, 0.05) * 1.6;
  float k = smoothstep(0.48, 0.78, fbm(uv + 3.0));
  float lit = 0.82 + 0.18 * smoothstep(0.4, 0.9, fbm(uv * 1.7 + 9.0));
  c = mix(c, cloud * lit, k * 0.85 * smoothstep(0.0, 0.12, n.y));
  gl_FragColor = vec4(c, 1.0);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(240, 48, 24), m);
  dome.renderOrder = -1;
  return dome;
}

/** The horizon all the way round, far enough out that the fog hazes it, in the region's shape: rolling hills, sharp
 * ridges one behind another, low ground under mesas, a flat line (a lake, a prairie), or a ragged wall of trees. */
function hills(skin: Skin, horizon: Horizon = "hills"): THREE.Mesh {
  const N = horizon === "treeline" ? 480 : 160, r = 58, pos: number[] = [], idx: number[] = [], rnd = mulberry32(11);
  const shape = { hills: [9, 4, 10, 0.2, 0.5], ridges: [18, 6, 12, 0.08, 0.2], mesas: [5, 1, 3, 0.3, 0.6], flat: [3, 0.3, 1, 0.4, 0.8], treeline: [7, 2, 5, 0.3, 0.6] }[horizon];
  const peaks = Array.from({ length: shape[0]! }, () => [rnd() * Math.PI * 2, shape[1]! + rnd() * shape[2]!, shape[3]! + rnd() * shape[4]!] as const);
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2;
    let y = horizon === "flat" ? 0.5 : horizon === "mesas" ? 1.5 : horizon === "treeline" ? 9 : 3;
    // ridges are pointed (a tent of |d|), hills round (a bell of d²)
    for (const [at, hgt, w] of peaks) { const d = Math.atan2(Math.sin(t - at), Math.cos(t - at)) / w; y += hgt * (horizon === "ridges" ? Math.exp(-Math.abs(d) * 1.6) : Math.exp(-d * d)); }
    // a treeline's tops: spires and crowns at random heights, every few metres
    if (horizon === "treeline") y += 2.5 * Math.abs(Math.sin(i * 1.7)) * (0.5 + 0.5 * Math.sin(i * 0.37)) + (i % 3 === 0 ? 1.8 : 0);
    pos.push(Math.cos(t) * r, -8, Math.sin(t) * r, Math.cos(t) * r, y, Math.sin(t) * r);
    if (i < N) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  const color = horizon === "treeline" ? new THREE.Color(skin.prop).multiplyScalar(0.8) : new THREE.Color(skin.prop).lerp(new THREE.Color(skin.ground), 0.3);
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide }));
}

/** A stadium bowl: concrete terraces stepping up and back from the ring, with a crowd of codeSplitter-avatar people on them, who cheer (src/crowd.ts) when a hit lands. */
function stands(R: number, prop: number, arena: THREE.Group): THREE.Group {
  const g = new THREE.Group(), STEPS = 7, RUN = 1.5, RISE = 0.85, inner = R + 3.5, base = -0.6, SEG = 128;
  const outer = inner + STEPS * RUN, top = base + STEPS * RISE, BACK = 3.4;
  // Sections between aisles: seats in alternating colours, a stair and a handrail up each aisle.
  const SECTIONS = 16, AISLE = 1.4, SEAT_COLOURS = [0x2b5ea8, 0xb8402c];
  const sectionOf = (t: number, r: number) => {
    const per = (Math.PI * 2) / SECTIONS, k = Math.floor((t + per / 2) / per), off = (t + per / 2) - k * per - per / 2; // off: angle from the aisle
    return { k: ((k % SECTIONS) + SECTIONS) % SECTIONS, aisle: Math.abs(off) * r < AISLE / 2 };
  };
  // Rows further back sit under the roof, out of the sun: each tier a shade darker.
  const shadeOf = (i: number) => 1 - 0.38 * (i / (STEPS - 1)) ** 1.3;
  const tinted = (geo: THREE.BufferGeometry, c: THREE.Color) => {
    const n = geo.attributes.position!.count;
    geo.setAttribute("color", new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [c.r, c.g, c.b]).flat(), 3));
    return geo;
  };
  const tread = new THREE.Color(prop).lerp(new THREE.Color(0xb8b4aa), 0.4), riser = new THREE.Color(prop).multiplyScalar(0.42);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < STEPS; i++) {
    const r = inner + i * RUN, y = base + (i + 1) * RISE, s = shadeOf(i);
    parts.push(tinted(new THREE.RingGeometry(r, r + RUN, SEG, 1).rotateX(-Math.PI / 2).translate(0, y, 0), tread.clone().multiplyScalar(s)));
    parts.push(tinted(new THREE.CylinderGeometry(r, r, RISE + (i ? 0 : 4), SEG, 1, true).translate(0, y - (RISE + (i ? 0 : 4)) / 2, 0), riser.clone().multiplyScalar(s)));
  }
  // the back wall and the roof over the top rows: dark, so the bowl has a back and the light falls off into it
  const back = new THREE.Color(0x2a2e36);
  parts.push(tinted(new THREE.CylinderGeometry(outer, outer, BACK + 4.6, SEG, 1, true).translate(0, top + (BACK - 4.6) / 2, 0), back));
  parts.push(tinted(new THREE.CylinderGeometry(outer - 4.2, outer + 0.2, 1.1, SEG, 1, true).translate(0, top + BACK + 0.5, 0), back.clone().multiplyScalar(0.8)));
  const bowl = new THREE.Mesh(mergeGeometries(parts.map((p) => p.toNonIndexed())), new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95, side: THREE.DoubleSide, map: (() => { const t = mottle(3); t.repeat.set(40, 3); return t; })() }));
  bowl.receiveShadow = true;
  g.add(bowl);
  // the roof's front edge, a painted fascia with floodlights under it
  const fascia = new THREE.Mesh(new THREE.CylinderGeometry(outer - 4.2, outer - 4.2, 0.45, SEG, 1, true), new THREE.MeshStandardMaterial({ color: 0x1d3f73, roughness: 0.6, side: THREE.DoubleSide }));
  fascia.position.y = top + BACK + 0.05; g.add(fascia);
  const LAMPS = 32, lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.2, 0.9), new THREE.MeshStandardMaterial({ color: 0x202020, emissive: 0xfff4d8, emissiveIntensity: 1.6 }), LAMPS);
  const o = new THREE.Object3D();
  for (let i = 0; i < LAMPS; i++) {
    const t = ((i + 0.5) / LAMPS) * Math.PI * 2, r = outer - 4.0;
    o.position.set(Math.cos(t) * r, top + BACK - 0.25, Math.sin(t) * r); o.rotation.set(0, -t, 0); o.updateMatrix();
    lamps.setMatrixAt(i, o.matrix);
  }
  g.add(lamps);
  // the boards round the front, the arena's own names and colours, and a rail along the first row
  const boards = new THREE.Mesh(new THREE.CylinderGeometry(inner - 0.04, inner - 0.04, 0.8, SEG, 1, true), new THREE.MeshStandardMaterial({ map: boardTexture(), roughness: 0.55, side: THREE.DoubleSide }));
  boards.position.y = 0.35; g.add(boards);
  const steel = new THREE.MeshStandardMaterial({ color: 0x7a8088, metalness: 0.6, roughness: 0.45 });
  const rail = new THREE.Mesh(new THREE.TorusGeometry(inner + 0.15, 0.035, 6, SEG * 2), steel);
  rail.rotation.x = Math.PI / 2; rail.position.y = base + RISE + 0.95; g.add(rail);
  // up each aisle: a step at every tier's half and a handrail; a hanging banner on the back wall between them
  const half = new THREE.BoxGeometry(RUN / 2, RISE / 2, AISLE * 0.9), stairs = new THREE.InstancedMesh(half, new THREE.MeshStandardMaterial({ roughness: 0.95 }), SECTIONS * STEPS);
  const step = tread.clone().lerp(riser, 0.35);
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.022, 0.022, 1, 5), steel, SECTIONS);
  const banner = bannerMaterials(), flags: THREE.Mesh[] = [];
  const per = (Math.PI * 2) / SECTIONS, slope = Math.hypot(STEPS * RUN, STEPS * RISE);
  for (let k = 0; k < SECTIONS; k++) {
    const t = k * per, c = Math.cos(t), s = Math.sin(t);
    for (let i = 0; i < STEPS; i++) {
      const r = inner + i * RUN + RUN * 0.75, y = base + (i + 1) * RISE + RISE / 4;
      o.position.set(c * r, y, s * r); o.rotation.set(0, -t, 0); o.updateMatrix(); stairs.setMatrixAt(k * STEPS + i, o.matrix); stairs.setColorAt(k * STEPS + i, step.clone().multiplyScalar(shadeOf(i)));
    }
    const mid = (inner + outer) / 2;
    o.position.set(c * mid, (base + RISE + top) / 2 + 0.95, s * mid); o.rotation.set(0, -t, -Math.atan2(STEPS * RUN, STEPS * RISE));
    o.scale.set(1, slope, 1); o.updateMatrix(); poles.setMatrixAt(k, o.matrix); o.scale.set(1, 1, 1);
    const b = t + per / 2, flag = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.6), banner[k % banner.length]!);
    flag.position.set(Math.cos(b) * (outer - 0.06), top + BACK - 1.6, Math.sin(b) * (outer - 0.06)); flag.lookAt(0, flag.position.y, 0);
    flags.push(flag);
  }
  stairs.receiveShadow = true;
  g.add(stairs, poles, ...flags);
  // the seats, every one, coloured by section; people stand on 70% of them
  const rnd = mulberry32(5), seats: Seat[] = [], chairs: { m: THREE.Matrix4; c: THREE.Color }[] = [];
  const chair = mergeGeometries([new THREE.BoxGeometry(0.42, 0.07, 0.44).translate(0, 0.3, 0), new THREE.BoxGeometry(0.07, 0.42, 0.44).translate(0.22, 0.5, 0)]);
  for (let i = 0; i < STEPS; i++) {
    const r = inner + i * RUN + RUN * 0.55, y = base + (i + 1) * RISE, n = Math.floor((Math.PI * 2 * r) / 0.9), shade = shadeOf(i);
    for (let j = 0; j < n; j++) {
      const t = ((j + 0.5) / n) * Math.PI * 2, sec = sectionOf(t, r);
      if (sec.aisle) continue;
      o.position.set(Math.cos(t) * (r + 0.05), y, Math.sin(t) * (r + 0.05)); o.rotation.set(0, -t, 0); o.updateMatrix();
      chairs.push({ m: o.matrix.clone(), c: new THREE.Color(SEAT_COLOURS[sec.k % 2]!).multiplyScalar(shade) });
      if (rnd() < 0.3) continue; // empty seats
      const tt = t + ((rnd() - 0.5) * 0.25 * Math.PI * 2) / n;
      seats.push({ pos: new THREE.Vector3(Math.cos(tt) * r, y, Math.sin(tt) * r), yaw: -tt, shade });
    }
  }
  const seatMesh = new THREE.InstancedMesh(chair, new THREE.MeshStandardMaterial({ roughness: 0.5 }), chairs.length);
  chairs.forEach(({ m, c }, i) => { seatMesh.setMatrixAt(i, m); seatMesh.setColorAt(i, c); });
  g.add(seatMesh);
  const crowd = buildCrowd(seats, rnd);
  g.add(crowd.group);
  crowds.set(arena, crowd); // crowdOf looks it up by the arena it stands in
  return g;
}

/** The boards round the stadium's front wall: five panels, each its own colour with a name across it, four times round.
 * Seen from inside the wall, so the picture runs backwards along it (repeat.x < 0) to read the right way. */
function boardTexture(): THREE.Texture {
  if (typeof document === "undefined") return new THREE.DataTexture(new Uint8Array([40, 70, 130, 255]), 1, 1);
  const PANELS: [string, string, string][] = [["#1d3f73", "#f4f1e8", "MYTHIC MASTERS"], ["#b8402c", "#fff3d6", "CRYPTID CUP"], ["#22302a", "#e8c46a", "THE BESTIARY"], ["#f0e6cc", "#1d3f73", "HUNT  BIND  FIGHT"], ["#3c2a5a", "#f4f1e8", "THE BOOK IS WATCHING"]];
  const W = 512, H = 64, c = document.createElement("canvas"), x = c.getContext("2d")!;
  c.width = W * PANELS.length; c.height = H;
  PANELS.forEach(([bg, ink, word], i) => {
    x.fillStyle = bg; x.fillRect(i * W, 0, W, H);
    x.fillStyle = "rgba(255,255,255,0.12)"; x.fillRect(i * W, 0, W, 6);
    x.fillStyle = "rgba(0,0,0,0.35)"; x.fillRect(i * W, 0, 4, H);
    x.fillStyle = ink; x.font = "bold 34px system-ui, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText(word, i * W + W / 2, H / 2 + 2);
  });
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.repeat.set(-4, 1); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/** The banners hanging on the stands' back wall: a colour field, a hem, and an emblem (a ring, a diamond, a star, a claw mark). */
function bannerMaterials(): THREE.MeshStandardMaterial[] {
  const SETS: [string, string][] = [["#1d3f73", "#e8c46a"], ["#b8402c", "#f4f1e8"], ["#22302a", "#e8c46a"], ["#3c2a5a", "#f4f1e8"]];
  return SETS.map(([bg, ink], k) => {
    const m = new THREE.MeshStandardMaterial({ color: bg, roughness: 0.8, side: THREE.DoubleSide });
    if (typeof document === "undefined") return m;
    const c = document.createElement("canvas"), x = c.getContext("2d")!, W = 96, H = 166;
    c.width = W; c.height = H;
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    x.fillStyle = ink; x.fillRect(0, 8, W, 5); x.fillRect(0, H - 30, W, 5);
    // a swallowtail hem: cut a notch out of the bottom
    x.globalCompositeOperation = "destination-out"; x.beginPath(); x.moveTo(0, H); x.lineTo(W / 2, H - 18); x.lineTo(W, H); x.fill();
    x.globalCompositeOperation = "source-over"; x.strokeStyle = ink; x.fillStyle = ink; x.lineWidth = 7;
    const cx = W / 2, cy = 70;
    x.beginPath();
    if (k === 0) { x.arc(cx, cy, 24, 0, Math.PI * 2); x.stroke(); }
    else if (k === 1) { x.moveTo(cx, cy - 30); x.lineTo(cx + 22, cy); x.lineTo(cx, cy + 30); x.lineTo(cx - 22, cy); x.closePath(); x.fill(); }
    else if (k === 2) { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 11 : 28; x.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } x.closePath(); x.fill(); }
    else for (const dx of [-14, 0, 14]) { x.moveTo(cx + dx - 6, cy - 28); x.quadraticCurveTo(cx + dx + 8, cy, cx + dx - 2, cy + 28); x.stroke(); x.beginPath(); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    m.map = t; m.color.set(0xffffff); m.transparent = true; m.alphaTest = 0.5;
    return m;
  });
}

/** What moves in a regional arena each frame (fireflies, fog), keyed by its group. */
const ticks = new WeakMap<THREE.Group, (t: number) => void>();
/** Moves a regional arena's fireflies and fog; `t` in seconds. */
export const tickArena = (arena: THREE.Group | null, t: number) => { if (arena) ticks.get(arena)?.(t); };

/** The stadium's crowd, if this arena has one. */
const crowds = new WeakMap<THREE.Group, Crowd>();
export const crowdOf = (arena: THREE.Group | null): Crowd | undefined => (arena ? crowds.get(arena) : undefined);
