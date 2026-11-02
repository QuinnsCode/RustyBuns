// The arena's look. The layout (a ring of radius ARENA.radius, a lake past x = ARENA.lake.x, a low
// ceiling for flyers) is the sim's and never changes; a skin only repaints it, so a new stadium is a
// new entry in SKINS, not new rules.
import * as THREE from "three";
import { mulberry32 } from "@rustybuns/util";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ARENA } from "./sim.ts";
import { buildCrowd, type Crowd, type Seat } from "./crowd.ts";
import type { Biome } from "./regions.ts";
import type { Kind, Plant } from "./world/flora.ts";

/** What a floor is: mown turf, sand with ripples and pebbles, sand under a litter of pine needles, or cracked
 * basalt whose seams glow; plain grain for the rest. */
type Floor = "grain" | "turf" | "sand" | "litter" | "basalt";
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
function floorOf(skin: Skin): Floor {
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
  scene.background = new THREE.Color(skin.sky);
  scene.fog = new THREE.Fog(new THREE.Color(skin.fog).lerp(new THREE.Color(skin.sky), 0.25), 30, 90);
  const R = ARENA.radius;
  const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });

  const kind = floorOf(skin);
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.92, 1.2, 64), mat(skin.ground, {
    map: mottle(7, kind), ...(kind === "basalt" ? { emissiveMap: seams(7), emissive: new THREE.Color(skin.under ?? 0xff5a1f), emissiveIntensity: 1.6 } : {}),
  }));
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
  if (skin.props === "stands") g.add(stands(R, skin.prop));
  if (skin.props === "rocks" || skin.props === "trees") g.add(dressing(skin, R));
  if (skin.under !== undefined) {
    const glow = new THREE.Mesh(new THREE.CircleGeometry(R + 30, 48), new THREE.MeshBasicMaterial({ color: skin.under }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = -7; g.add(glow);
  }
  if (skin.props === "clouds") ring(14, R + 12, (i) => { const m = new THREE.Mesh(new THREE.SphereGeometry(3 + (i % 3), 12, 8), mat(skin.prop, { transparent: true, opacity: 0.8 })); m.position.y = -6 + (i % 4); m.scale.y = 0.45; return m; });

  g.add(skyDome(skin), hills(skin));
  // the lake's bank: a strip of wet sand where the turf meets the water, so the shore isn't a cut
  const chord = 2 * Math.sin(a) * R;
  const bank = new THREE.Mesh(new THREE.PlaneGeometry(1.1, chord - 0.4), mat(new THREE.Color(skin.ground).lerp(new THREE.Color(0xd8c8a0), 0.6).getHex(), { roughness: 0.75, map: (() => { const t = mottle(33, "sand"); t.repeat.set(1, 6); return t; })() }));
  bank.rotation.x = -Math.PI / 2; bank.position.set(ARENA.lake.x - 0.35, 0.015, 0); bank.receiveShadow = true; g.add(bank);
  const foam = new THREE.Mesh(new THREE.PlaneGeometry(0.22, chord - 0.4), new THREE.MeshBasicMaterial({ color: 0xf4f8f8, transparent: true, opacity: 0.55, depthWrite: false }));
  foam.rotation.x = -Math.PI / 2; foam.position.set(ARENA.lake.x + 0.3, 0.035, 0); g.add(foam);

  // a warm key from the sun's side of the sky, against the cool sky fill and the cool rim behind
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.5);
  sun.position.copy(SUN); sun.castShadow = true;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -22; sun.shadow.camera.right = sun.shadow.camera.top = 22;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
  // a cool light from behind the far side: an edge of light along every back and head, so a black hide reads
  const back = new THREE.DirectionalLight(0xcfe0ff, 1.6);
  back.name = "rim"; // main.ts keeps it opposite the camera, so it always edges the side you see
  back.position.set(14, 9, -16);
  g.add(sun, back, new THREE.HemisphereLight(skin.sky, skin.ground, 0.8));
  if (skin.under === undefined) {
    // light thrown back up from the floor: every belly and jaw picks up the arena's ground colour
    const bounce = new THREE.DirectionalLight(new THREE.Color(skin.ground).lerp(new THREE.Color(0xffffff), 0.15), 0.7);
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
    const ground = new THREE.Mesh(new THREE.RingGeometry(R - 0.3, 70, 96, 4), new THREE.MeshStandardMaterial({
      color: new THREE.Color(skin.ground).lerp(new THREE.Color(skin.prop), 0.35).multiplyScalar(0.85), roughness: 1, map: mottle(9, floorOf(skin), 14),
    }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.35; ground.receiveShadow = true; g.add(ground);
  }
  void import("./world/flora.ts").then(async ({ scenery, FLORA, TALL }) => {
    const set = await scenery();
    if (!set.size) return;
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
      const geo = set.get(kind);
      if (!geo) continue;
      const soft = kind !== "rock";
      const mesh = new THREE.InstancedMesh(soft ? softened(geo) : geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: !soft, color: kind === "rock" || floating ? rockTint : 0xffffff }), ms.length);
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
function skyDome(skin: Skin): THREE.Mesh {
  const top = deepen(new THREE.Color(skin.sky)), horizon = new THREE.Color(skin.fog);
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

/** Low hills all the way round, far enough out that the fog hazes them: a horizon instead of the sky meeting the floor. */
function hills(skin: Skin): THREE.Mesh {
  const N = 160, r = 58, pos: number[] = [], idx: number[] = [], rnd = mulberry32(11);
  const peaks = Array.from({ length: 9 }, () => [rnd() * Math.PI * 2, 4 + rnd() * 10, 0.2 + rnd() * 0.5] as const);
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2;
    let y = 3;
    for (const [at, hgt, w] of peaks) { const d = Math.atan2(Math.sin(t - at), Math.cos(t - at)) / w; y += hgt * Math.exp(-d * d); }
    pos.push(Math.cos(t) * r, -8, Math.sin(t) * r, Math.cos(t) * r, y, Math.sin(t) * r);
    if (i < N) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  const color = new THREE.Color(skin.prop).lerp(new THREE.Color(skin.ground), 0.3);
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide }));
}

/** A stadium bowl: concrete terraces stepping up and back from the ring, with a crowd of small low-poly people (hats, shirts, arms up when a hit lands) on them. */
function stands(R: number, prop: number): THREE.Group {
  const g = new THREE.Group(), STEPS = 7, RUN = 1.5, RISE = 0.85, inner = R + 3.5, base = -0.6;
  const profile = [new THREE.Vector2(inner, -4)];
  for (let i = 0; i < STEPS; i++) {
    const r = inner + i * RUN, y = base + i * RISE;
    profile.push(new THREE.Vector2(r, y + RISE), new THREE.Vector2(r + RUN, y + RISE));
  }
  profile.push(new THREE.Vector2(inner + STEPS * RUN, base + STEPS * RISE + 1.4), new THREE.Vector2(inner + STEPS * RUN + 0.4, base + STEPS * RISE + 1.4), new THREE.Vector2(inner + STEPS * RUN + 0.4, -4));
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(profile, 96), new THREE.MeshStandardMaterial({ color: prop, roughness: 0.95, side: THREE.DoubleSide, map: (() => { const t = mottle(3); t.repeat.set(40, 3); return t; })() }));
  bowl.receiveShadow = true;
  g.add(bowl);
  // the front wall facing the ring, darker, with a painted band along its top
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(inner, inner, 0.5, 96, 1, true), new THREE.MeshStandardMaterial({ color: 0x2c5a8a, roughness: 0.6, side: THREE.DoubleSide }));
  wall.position.y = base + RISE - 0.2; g.add(wall);
  const rnd = mulberry32(5), seats: Seat[] = [];
  for (let i = 0; i < STEPS; i++) {
    const r = inner + i * RUN + RUN * 0.55, y = base + (i + 1) * RISE, n = Math.floor((Math.PI * 2 * r) / 0.9);
    for (let j = 0; j < n; j++) {
      if (rnd() < 0.3) continue; // empty seats
      const t = ((j + rnd() * 0.4) / n) * Math.PI * 2;
      seats.push({ pos: new THREE.Vector3(Math.cos(t) * r, y, Math.sin(t) * r), yaw: -t });
    }
  }
  const crowd = buildCrowd(seats, rnd);
  g.add(crowd.group);
  crowds.set(g, crowd);
  return g;
}

/** The stadium's crowd, if this arena has one. */
const crowds = new WeakMap<THREE.Group, Crowd>();
export const crowdOf = (arena: THREE.Group | null): Crowd | undefined => (arena ? crowds.get(arena) : undefined);
