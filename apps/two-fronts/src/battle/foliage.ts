// The living part of the woods, for the eye only: nothing here is in the sim, so no shot, step,
// sight line or cover changes (a thicket that looks like it should block sight does not).
//
// Two things live here. The wind: a patch for a plant's material so its vertices sway, and bend
// away from units and blasts nearby and spring back (all in the vertex shader, so a thousand
// plants cost the CPU nothing). And the scenery: the forest floor (litter, twigs, needles,
// pebbles, mushrooms, moss, flowers, grass, nurse logs, thickets) varied for each kind of sector,
// and the jungle's extra storeys (canopy, lianas, buttress roots, broad leaves, palms and cycads,
// glowing fungi, low mist). Everything is instanced or merged, and textures are drawn on a canvas.
//
// `?foliage=low|mid|high` (or a number from 0.2 to 1) in the page's address turns the density
// down for a slow machine.
import * as THREE from "three";
import { WORLDS } from "./worlds.ts";
import type { SectorKind } from "./contract.ts";
import { lumpy, texture } from "./models.ts";
import { HALF, STRIKE_RADIUS, altitude, isVehicle, type Battle, type Tree } from "./sim.ts";

type Noise = (x: number, z: number, octaves?: number) => number;
type Mat = THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;

// --- The quality knob: a multiplier on how many of everything is scattered. ---
export function foliageQuality() {
  let v = 1;
  try {
    const q = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("foliage");
    if (q === "low") v = 0.3;
    else if (q === "mid") v = 0.6;
    else if (q && Number.isFinite(+q)) v = Math.min(1, Math.max(0.2, +q));
  } catch { /* no address to read */ }
  return v;
}

// --- Instances: one mesh, many places. ---
export function instancer(scene: THREE.Scene) {
  const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, count: number, cast = false, receive = true) => {
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
    mesh.count = 0;
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    scene.add(mesh);
    return mesh;
  };
  const put = (mesh: THREE.InstancedMesh, matrix: THREE.Matrix4, color?: THREE.Color) => {
    if (mesh.count >= mesh.instanceMatrix.count) return;
    mesh.setMatrixAt(mesh.count, matrix);
    if (color) mesh.setColorAt(mesh.count, color);
    mesh.count++;
  };
  const done = (...meshes: THREE.InstancedMesh[]) => {
    for (const mesh of meshes) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
  };
  return { inst, put, done };
}

// Pieces joined into one geometry (positions and uvs only; the normals are made again).
export function mergeAll(geos: THREE.BufferGeometry[]) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of parts) total += g.attributes.position!.count;
  const out = new THREE.BufferGeometry();
  for (const name of ["position", "uv"]) {
    const size = parts[0]!.attributes[name]!.itemSize, arr = new Float32Array(total * size);
    let o = 0;
    for (const g of parts) { arr.set(g.attributes[name]!.array as Float32Array, o); o += g.attributes[name]!.array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}
const faceUp = (g: THREE.BufferGeometry) => {
  const a = new Float32Array(g.attributes.position!.count * 3);
  for (let i = 1; i < a.length; i += 3) a[i] = 1;
  g.setAttribute("normal", new THREE.BufferAttribute(a, 3));
  return g;
};

// --- The wind: sway, and bending away from whoever's close. ---
const PUSHERS = 16;
export interface Wind {
  // A material that sways: `h` is the plant's height in its own units, `amp` how far the top
  // sways (metres), `bend` how far it gives way to a unit or blast. `hang` is for things that
  // hang from their origin (vines) instead of standing on it.
  patch<M extends Mat>(mat: M, opts: { h: number; amp?: number; bend?: number; hang?: boolean }): M;
  update(t: number, b: Battle, eye: THREE.Vector3): void;
}
export function makeWind(): Wind {
  const uniforms = { uTime: { value: 0 }, uPush: { value: Array.from({ length: PUSHERS }, () => new THREE.Vector4(0, 0, 1, 0)) } };
  const ripples: { x: number; z: number; r: number; age: number }[] = [];
  const seen = new WeakSet<object>();
  let last = 0;
  const f = (v: number) => v.toFixed(3);
  return {
    patch(mat, { h, amp = 0.1, bend = 1.2, hang = false }) {
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = uniforms.uTime;
        shader.uniforms.uPush = uniforms.uPush;
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", `#include <common>\nuniform float uTime;\nuniform vec4 uPush[${PUSHERS}];`)
          .replace("#include <begin_vertex>", `#include <begin_vertex>
          {
            #ifdef USE_INSTANCING
            mat4 swIm = instanceMatrix;
            #else
            mat4 swIm = mat4(1.0);
            #endif
            vec3 swBase = (modelMatrix * swIm * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
            float swW = clamp(${hang ? "-" : ""}transformed.y / ${f(h)}, 0.0, 1.0);
            swW = swW * swW;
            float swP = swBase.x * 0.35 + swBase.z * 0.27;
            vec2 swD = (vec2(sin(uTime * 1.3 + swP), cos(uTime * 1.1 + swP * 1.3)) + 0.3 * vec2(sin(uTime * 3.1 + swP * 2.0), cos(uTime * 2.7 + swP * 1.7))) * ${f(amp)};
            for (int i = 0; i < ${PUSHERS}; i++) {
              vec4 pu = uPush[i];
              vec2 off = swBase.xz - pu.xy;
              float d = length(off);
              swD += off / max(d, 0.05) * (1.0 - smoothstep(0.0, pu.z, d)) * pu.w * ${f(bend)};
            }
            swD *= swW;
            mat3 swR = mat3(swIm);
            vec3 swL = transpose(swR) * vec3(swD.x, 0.0, swD.y) / max(dot(swR[0], swR[0]), 0.0001);
            transformed += swL;
          }`);
      };
      mat.customProgramCacheKey = () => `sway${h}-${amp}-${bend}-${hang}`;
      return mat;
    },
    update(t, b, eye) {
      uniforms.uTime.value = t;
      const dt = Math.min(0.1, Math.max(0, t - last));
      last = t;
      // A blast shoves the plants round it, and they spring back swaying.
      for (const fx of b.fx) if (fx.kind === "blast" && !seen.has(fx)) { seen.add(fx); ripples.push({ x: fx.x, z: fx.z, r: fx.big ? STRIKE_RADIUS * 1.5 : 5, age: 0 }); }
      const slots = uniforms.uPush.value;
      let n = 0;
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i]!;
        rp.age += dt;
        if (rp.age > 2) { ripples.splice(i, 1); continue; }
        if (n < PUSHERS) slots[n++]!.set(rp.x, rp.z, rp.r * (0.5 + Math.min(1, rp.age * 4) * 0.5), Math.exp(-rp.age * 2.4) * (0.55 + 0.45 * Math.cos(rp.age * 11)));
      }
      // The units nearest the camera, the only ones whose plants are in view.
      const near: { x: number; z: number; r: number; d: number }[] = [];
      for (const u of b.units) {
        if (altitude(u) > 1) continue;
        const d = Math.hypot(u.x - eye.x, u.z - eye.z);
        if (d < 50) near.push({ x: u.x, z: u.z, r: isVehicle(u.kind) ? 3.6 : u.champ ? 2.4 : 1.7, d });
      }
      near.sort((a, c) => a.d - c.d);
      for (const u of near) { if (n >= PUSHERS) break; slots[n++]!.set(u.x, u.z, u.r, 1); }
      while (n < PUSHERS) slots[n++]!.set(0, 0, 1, 0);
    },
  };
}

// --- Textures, grey so a colour tints them. ---
const grey = (v: number, a = 1) => `rgba(${v | 0},${v | 0},${v | 0},${a})`;
const fadeEdge = (c: CanvasRenderingContext2D, s: number) => {
  const g = c.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s / 2);
  g.addColorStop(0, grey(255, 1)); g.addColorStop(1, grey(255, 0));
  c.globalCompositeOperation = "destination-in"; c.fillStyle = g; c.fillRect(0, 0, s, s);
  c.globalCompositeOperation = "source-over";
};
const leafShape = (c: CanvasRenderingContext2D, len: number, wid: number) => {
  c.beginPath(); c.moveTo(-len, 0); c.quadraticCurveTo(0, -wid * 1.3, len, 0); c.quadraticCurveTo(0, wid * 1.3, -len, 0); c.fill();
};
// A patch of fallen leaves and the odd needle.
const litterMap = () => texture("litter-patch", 128, 128, [1, 1], (c, r) => {
  c.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 24; i++) {
    c.save(); c.translate(14 + r() * 100, 14 + r() * 100); c.rotate(r() * 6.3);
    const len = 7 + r() * 9;
    c.fillStyle = grey(110 + r() * 145); leafShape(c, len, len * 0.38);
    c.strokeStyle = grey(55, 0.7); c.lineWidth = 1; c.beginPath(); c.moveTo(-len, 0); c.lineTo(len, 0); c.stroke();
    c.restore();
  }
  for (let i = 0; i < 28; i++) { c.strokeStyle = grey(150 + r() * 100, 0.9); c.lineWidth = 1; const x = 10 + r() * 108, y = 10 + r() * 108, a = r() * 6.3; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * 14, y + Math.sin(a) * 14); c.stroke(); }
  fadeEdge(c, 128);
});
// Pine needles in fans.
const needleMap = () => texture("needle-patch", 128, 128, [1, 1], (c, r) => {
  c.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 16; i++) {
    const x = 16 + r() * 96, y = 16 + r() * 96, a0 = r() * 6.3;
    c.strokeStyle = grey(120 + r() * 130, 0.95); c.lineWidth = 1.1;
    for (let j = 0; j < 14; j++) { const a = a0 + (j - 7) * 0.07, l = 14 + r() * 10; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke(); }
  }
  fadeEdge(c, 128);
});
// A tuft of grass blades, dark at the root and bright at the tip.
const grassMap = () => texture("grass-tuft", 64, 128, [1, 1], (c, r) => {
  c.clearRect(0, 0, 64, 128);
  for (let i = 0; i < 30; i++) {
    const x = 6 + r() * 52, tip = x + (r() - 0.5) * 22, h = 50 + r() * 74, w = 1.2 + r() * 2.2;
    const g = c.createLinearGradient(0, 128, 0, 128 - h);
    g.addColorStop(0, grey(95)); g.addColorStop(1, grey(190 + r() * 65));
    c.fillStyle = g; c.beginPath(); c.moveTo(x - w, 128); c.quadraticCurveTo(x, 128 - h * 0.5, tip, 128 - h); c.quadraticCurveTo(x + w * 0.2, 128 - h * 0.5, x + w, 128); c.fill();
  }
});
// A banana-type leaf: a broad blade, a stout midrib, side veins, torn at the edges.
const broadMap = () => texture("broadleaf", 128, 256, [1, 1], (c, r) => {
  c.clearRect(0, 0, 128, 256);
  const g = c.createLinearGradient(0, 256, 0, 0);
  g.addColorStop(0, grey(150)); g.addColorStop(1, grey(235));
  c.fillStyle = g; c.beginPath(); c.moveTo(64, 254); c.bezierCurveTo(-18, 190, -8, 70, 64, 4); c.bezierCurveTo(136, 70, 146, 190, 64, 254); c.fill();
  c.strokeStyle = grey(95, 0.9); c.lineWidth = 3; c.beginPath(); c.moveTo(64, 254); c.lineTo(64, 8); c.stroke();
  c.lineWidth = 1;
  for (let y = 236; y > 24; y -= 9) for (const s of [-1, 1]) { c.beginPath(); c.moveTo(64, y); c.lineTo(64 + s * 56, y - 18); c.stroke(); }
  c.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 9; i++) { const y = 40 + r() * 190, s = r() < 0.5 ? -1 : 1; c.lineWidth = 2 + r() * 2; c.beginPath(); c.moveTo(64 + s * (24 + r() * 8), y); c.lineTo(64 + s * 70, y - 16 + r() * 8); c.stroke(); }
  c.globalCompositeOperation = "source-over";
});
// A spray of broad leaves seen from underneath: the canopy.
const canopyMap = () => texture("canopy-cluster", 128, 128, [1, 1], (c, r) => {
  c.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 46; i++) {
    c.save(); c.translate(10 + r() * 108, 10 + r() * 108); c.rotate(r() * 6.3);
    const len = 12 + r() * 12;
    c.fillStyle = grey(105 + r() * 150); leafShape(c, len, len * 0.42);
    c.strokeStyle = grey(60, 0.6); c.beginPath(); c.moveTo(-len, 0); c.lineTo(len, 0); c.stroke();
    c.restore();
  }
  fadeEdge(c, 128);
});
// A lumpy patch of moss.
const mossMap = () => texture("moss-patch", 64, 64, [1, 1], (c, r) => {
  c.clearRect(0, 0, 64, 64);
  for (let i = 0; i < 34; i++) { const a = r() * 6.3, d = r() * 20; c.fillStyle = grey(125 + r() * 130); c.beginPath(); c.arc(32 + Math.cos(a) * d, 32 + Math.sin(a) * d, 4 + r() * 8, 0, 7); c.fill(); }
});
const mistMap = () => texture("mist", 128, 128, [1, 1], (c, r) => {
  c.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 14; i++) {
    const x = 30 + r() * 68, y = 30 + r() * 68, s = 18 + r() * 26, g = c.createRadialGradient(x, y, 0, x, y, s);
    g.addColorStop(0, grey(255, 0.5)); g.addColorStop(1, grey(255, 0));
    c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  }
  fadeEdge(c, 128);
});
const glow = () => texture("foliage-glow", 64, 64, [1, 1], (c) => {
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, grey(255, 1)); g.addColorStop(0.25, grey(255, 0.45)); g.addColorStop(1, grey(255, 0));
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
});

// A frond bent up and out then drooping: `rise` and `droop` shape it, `n` of them round a stem.
function frondRing(w: number, len: number, rise: number, droop: number, n: number, tilt = 0) {
  const one = new THREE.PlaneGeometry(w, len, 1, 8).translate(0, len / 2, 0);
  const pos = one.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) { const f = pos.getY(i) / len; pos.setXYZ(i, pos.getX(i), len * (rise * f - droop * f * f * 0.5), -len * f * 0.85); }
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) parts.push(one.clone().rotateX(-tilt * (i % 3) * 0.12).rotateY((i / n) * Math.PI * 2 + (i % 2) * 0.25));
  const g = mergeAll(parts);
  g.computeVertexNormals();
  return g;
}

// What each kind of sector's floor is like: how much of each thing is scattered (at full quality).
interface Floor {
  litter: number; needles: number; twigs: number; pebbles: number; boulders: number; shrooms: number; moss: number;
  flowers: number; grass: number; nurse: number; thickets: number;
  leaf: [number, number, number][]; // litter colours, as h s l
  flower: number[]; grassHue: number; grassLight: number; mossAmount: number;
}
export const FLOORS: Record<SectorKind, Floor> = {
  // The shield generator's clearing: open, bright, meadow-like.
  shield: { litter: 1400, needles: 500, twigs: 380, pebbles: 300, boulders: 18, shrooms: 14, moss: 240, flowers: 800, grass: 1900, nurse: 8, thickets: 14, leaf: [[0.08, 0.5, 0.28], [0.11, 0.55, 0.35], [0.14, 0.5, 0.3]], flower: [0xf6f0dc, 0xf2d34a, 0xb48be8, 0xe9a3c8], grassHue: 0.22, grassLight: 0.34, mossAmount: 0.15 },
  // The capital's redwood duff: deep needle drifts, sorrel and pink-white blossom.
  capital: { litter: 1300, needles: 2000, twigs: 520, pebbles: 240, boulders: 20, shrooms: 24, moss: 230, flowers: 450, grass: 900, nurse: 10, thickets: 18, leaf: [[0.05, 0.55, 0.24], [0.07, 0.6, 0.3], [0.1, 0.5, 0.26]], flower: [0xffffff, 0xf4a0c0, 0xf9e6f0], grassHue: 0.25, grassLight: 0.28, mossAmount: 0.22 },
  // The spaceport's edges: weeds, wind-blown litter and loose stone round the pads.
  spaceport: { litter: 500, needles: 400, twigs: 160, pebbles: 450, boulders: 10, shrooms: 6, moss: 100, flowers: 260, grass: 1500, nurse: 3, thickets: 6, leaf: [[0.1, 0.35, 0.3], [0.12, 0.4, 0.38]], flower: [0xf2d34a, 0xffffff], grassHue: 0.18, grassLight: 0.36, mossAmount: 0.05 },
  // The cannon's shore: dry beach grass and a few flowers on the dunes, sticks, shingle and wrack, no woods.
  cannon: { litter: 160, needles: 0, twigs: 520, pebbles: 700, boulders: 0, shrooms: 0, moss: 0, flowers: 220, grass: 900, nurse: 0, thickets: 0, leaf: [[0.11, 0.35, 0.5], [0.09, 0.3, 0.42]], flower: [0xf6f0dc, 0xf08a9a, 0xf2d34a, 0xc8a0f0], grassHue: 0.15, grassLight: 0.42, mossAmount: 0 },
  // The mining canyon: dry tufts, grit and stones; no woods.
  canyon: { litter: 0, needles: 0, twigs: 160, pebbles: 950, boulders: 0, shrooms: 0, moss: 0, flowers: 0, grass: 520, nurse: 0, thickets: 0, leaf: [[0.07, 0.4, 0.3]], flower: [0xe8c050], grassHue: 0.1, grassLight: 0.4, mossAmount: 0 },
  // The jungle: wet, thick and green over everything.
  jungle: { litter: 3000, needles: 0, twigs: 800, pebbles: 400, boulders: 70, shrooms: 40, moss: 650, flowers: 850, grass: 2300, nurse: 16, thickets: 26, leaf: [[0.09, 0.5, 0.2], [0.2, 0.5, 0.18], [0.13, 0.55, 0.26]], flower: [0xff5a8a, 0xff9a30, 0xd070ff, 0xf5f5f5], grassHue: 0.26, grassLight: 0.28, mossAmount: 0.45 },
};

export interface FoliageCtx {
  scene: THREE.Scene;
  b: Battle;
  kind: SectorKind;
  r: () => number;
  n: Noise;
  heightAt(x: number, z: number): number;
  bare(x: number, z: number, room?: number): boolean;
  trees: Tree[];                // the field's trunks first, then the banks'
  trail: { x: number; z: number }[];
  shiftAt(z: number): number;  // how far the trail wanders sideways at this z
  fernGeo: THREE.BufferGeometry;
  frond: THREE.Texture | null;
  bark: THREE.Texture | null;
  wind: Wind;
  fog: THREE.Color;
}
export interface Foliage { update(t: number, eye: THREE.Vector3): void }

export function buildFoliage(ctx: FoliageCtx): Foliage {
  const { scene, b, kind, r, n, heightAt, bare, trees, wind } = ctx;
  const fl = FLOORS[kind], Q = foliageQuality(), jungle = kind === "jungle", woods = WORLDS[kind].trees !== null;
  // A big map gets more of everything, though not quite as thick, to keep the frame rate.
  const cnt = (v: number) => Math.round(v * Q * Math.min(1.6, (b.half / HALF) ** 2));
  const { inst, put, done } = instancer(scene);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), k = new THREE.Vector3(), col = new THREE.Color(), e = new THREE.Euler();
  const UP = new THREE.Vector3(0, 1, 0);
  const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0, ...extra });
  const leafy = (map: THREE.Texture | null, extra: THREE.MeshStandardMaterialParameters = {}) => std(0xffffff, { map, alphaTest: 0.4, side: THREE.DoubleSide, ...extra });
  const flat = (geo: THREE.BufferGeometry) => geo.rotateX(-Math.PI / 2);
  const anywhere = (spread = 1.1) => ({ x: (r() - 0.5) * b.half * 2 * spread, z: (r() - 0.5) * b.half * 2 * spread });
  const field = trees.slice(0, b.trees.length);
  // A spot where something may grow; half the time round a trunk, where the woods are thickest.
  const spot = (room = 1, nearTrunks = 0.5) => {
    for (let i = 0; i < 12; i++) {
      let at = anywhere();
      if (field.length && r() < nearTrunks) { const t = field[Math.floor(r() * field.length)]!; at = { x: t.x + (r() - 0.5) * 16, z: t.z + (r() - 0.5) * 16 }; }
      if (!bare(at.x, at.z, room)) return at;
    }
    return null;
  };
  const yAt = (x: number, z: number, dy = 0) => heightAt(x, z) + dy;
  const set = (x: number, y: number, z: number, ry: number, sx: number, sy = sx, sz = sx) => m.compose(p.set(x, y, z), q.setFromAxisAngle(UP, ry), k.set(sx, sy, sz));
  const hsl = (c: [number, number, number], v = 0.05) => col.setHSL(c[0] + (r() - 0.5) * 0.03, c[1], c[2] + (r() - 0.5) * v * 2);
  const decal = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 };

  const mist: THREE.InstancedMesh[] = [];
  const glints: { mat: THREE.PointsMaterial; phase: number; speed: number; base: number }[] = [];

  // --- The floor: leaf litter, pine needles, twigs, pebbles, moss. ---
  if (fl.litter) {
    const mesh = inst(flat(new THREE.PlaneGeometry(1, 1)), leafy(litterMap(), decal), cnt(fl.litter), false);
    for (let i = 0; i < fl.litter * 3 && mesh.count < mesh.instanceMatrix.count; i++) {
      const at = spot(0.3, 0.6); if (!at) continue;
      const s = 1.2 + r() * 2.2;
      hsl(fl.leaf[Math.floor(r() * fl.leaf.length)]!);
      put(mesh, set(at.x, yAt(at.x, at.z, 0.035 + r() * 0.03), at.z, r() * 6.3, s), col);
    }
    done(mesh);
  }
  if (fl.needles) {
    const mesh = inst(flat(new THREE.PlaneGeometry(1, 1)), leafy(needleMap(), decal), cnt(fl.needles), false);
    for (let i = 0; i < fl.needles * 3 && mesh.count < mesh.instanceMatrix.count; i++) {
      const at = spot(0.3, 0.7); if (!at) continue;
      const s = 1.6 + r() * 2.2;
      col.setHSL(0.06 + r() * 0.04, 0.6, 0.3 + r() * 0.15);
      put(mesh, set(at.x, yAt(at.x, at.z, 0.06 + r() * 0.03), at.z, r() * 6.3, s), col);
    }
    done(mesh);
  }
  if (fl.moss) {
    const mesh = inst(flat(new THREE.PlaneGeometry(1, 1)), leafy(mossMap(), { alphaTest: 0.5, roughness: 1, ...decal }), cnt(fl.moss), false);
    for (let i = 0; i < fl.moss * 3 && mesh.count < mesh.instanceMatrix.count; i++) {
      const at = spot(0.3, 0.5); if (!at) continue;
      // Moss is where it's damp: in the dips, more of it.
      if (r() > 0.45 + 0.8 * fl.mossAmount + n(at.x / 9, at.z / 9, 2) * 0.5) continue;
      const s = 1.5 + r() * 4.5;
      col.setHSL(0.22 + r() * 0.07, 0.55, 0.16 + r() * 0.1);
      put(mesh, set(at.x, yAt(at.x, at.z, 0.05 + r() * 0.04), at.z, r() * 6.3, s, 1, s * (0.6 + r() * 0.5)), col);
    }
    done(mesh);
  }
  if (fl.twigs) {
    const mesh = inst(new THREE.CylinderGeometry(0.014, 0.022, 1, 3).rotateZ(Math.PI / 2), std(0xffffff), cnt(fl.twigs), false);
    for (let i = 0; i < fl.twigs * 3 && mesh.count < mesh.instanceMatrix.count; i++) {
      const at = spot(0.3, 0.6); if (!at) continue;
      const len = 0.25 + r() * 1.1;
      q.setFromEuler(e.set((r() - 0.5) * 0.25, r() * 6.3, (r() - 0.5) * 0.25));
      m.compose(p.set(at.x, yAt(at.x, at.z, 0.04 + r() * 0.04), at.z), q, k.set(len, 1 + r() * 0.8, 1 + r() * 0.8));
      col.setHSL(0.07 + r() * 0.04, 0.35, 0.16 + r() * 0.14);
      put(mesh, m, col);
    }
    done(mesh);
  }
  if (fl.pebbles) {
    const mesh = inst(new THREE.IcosahedronGeometry(0.5, 0), std(0xffffff, { flatShading: true }), cnt(fl.pebbles), false);
    for (let i = 0; i < fl.pebbles * 3 && mesh.count < mesh.instanceMatrix.count; i++) {
      const at = spot(0.3, 0.3); if (!at) continue;
      const s = 0.08 + r() * 0.22;
      q.setFromEuler(e.set(r() * 3, r() * 6, r() * 3));
      m.compose(p.set(at.x, yAt(at.x, at.z, s * 0.15), at.z), q, k.set(s * (1 + r()), s * 0.6, s * (0.8 + r() * 0.6)));
      col.setHSL(kind === "canyon" ? 0.05 : 0.12, kind === "canyon" ? 0.3 : 0.07, 0.35 + r() * 0.3);
      put(mesh, m, col);
    }
    done(mesh);
  }
  // Boulders worn smooth, a cap of moss on the top of each.
  if (fl.boulders) {
    const rockGeo = lumpy(1, 1, 0.22, 5, false);
    const rocks = inst(rockGeo, std(0xffffff, { flatShading: true }), cnt(fl.boulders), true);
    const caps = inst(lumpy(1, 1, 0.3, 9, false), std(0xffffff, { roughness: 1, flatShading: true }), cnt(fl.boulders), false);
    for (let i = 0; i < fl.boulders * 6 && rocks.count < rocks.instanceMatrix.count; i++) {
      const at = spot(2.5, 0.3); if (!at) continue;
      const s = 0.7 + r() * 1.5, y = yAt(at.x, at.z), ry = r() * 6.3;
      col.setHSL(0.13, 0.06, 0.3 + r() * 0.2);
      put(rocks, set(at.x, y + s * 0.3, at.z, ry, s * 1.2, s * 0.8, s), col);
      col.setHSL(0.22 + r() * 0.06, 0.55, 0.17 + r() * 0.08);
      put(caps, set(at.x, y + s * 0.72, at.z, ry, s * 0.9, s * 0.3, s * 0.78), col);
    }
    done(rocks, caps);
  }

  // --- Mushroom clusters; in the jungle most glow. ---
  if (fl.shrooms && woods) {
    const nCl = cnt(fl.shrooms), per = 5;
    const stems = inst(new THREE.CylinderGeometry(0.04, 0.06, 1, 5).translate(0, 0.5, 0), std(0xe8e0cc), nCl * per, false);
    const capGeo = new THREE.SphereGeometry(0.5, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    const caps = inst(capGeo, std(0xffffff, { roughness: 0.6 }), nCl * per, false);
    const lamps = inst(capGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), nCl * per, false);
    const spores: number[] = [], sporeCols: number[] = [];
    const palette = [0xd8c8a0, 0xb8502c, 0xe8d8b8, 0xd09a3c, 0x8a5a3a];
    const glowPalette = [0x7ff0d8, 0xa0ff90, 0xff9ae0, 0x9ab8ff];
    for (let i = 0; i < nCl * 6 && stems.count < stems.instanceMatrix.count - per; i++) {
      const at = spot(1, 0.8); if (!at) continue;
      const lit = jungle && r() < 0.65, base = glowPalette[Math.floor(r() * glowPalette.length)]!, cap = palette[Math.floor(r() * palette.length)]!;
      for (let j = 0; j < 3 + Math.floor(r() * 3); j++) {
        const a = r() * 6.3, d = r() * 0.6, x = at.x + Math.cos(a) * d, z = at.z + Math.sin(a) * d, h = 0.12 + r() * 0.3, w = 0.1 + r() * 0.2, y = yAt(x, z, -0.01);
        put(stems, set(x, y, z, 0, w * 0.5, h, w * 0.5));
        col.setHex(lit ? base : cap);
        put(lit ? lamps : caps, set(x, y + h, z, r() * 6, w, w * 0.7, w), col);
        if (lit) { spores.push(x, y + h + 0.1, z); col.setHex(base); sporeCols.push(col.r, col.g, col.b); }
      }
    }
    done(stems, caps, lamps);
    if (spores.length) addGlints(spores, sporeCols, 1.4);
  }

  // --- Grass and flowering ground cover. ---
  const grassGeo = (() => {
    const one = new THREE.PlaneGeometry(1.1, 1, 1, 3).translate(0, 0.5, 0);
    return faceUp(mergeAll([0, 1, 2].map((i) => one.clone().rotateY((i * Math.PI) / 3))));
  })();
  if (fl.grass) {
    const mesh = inst(grassGeo, wind.patch(leafy(grassMap(), { roughness: 1 }), { h: 1, amp: 0.1, bend: 0.9 }), cnt(fl.grass), false);
    for (let i = 0; i < fl.grass * 3 && mesh.count < mesh.instanceMatrix.count; i++) {
      const at = spot(0.4, 0.4); if (!at) continue;
      const s = 0.8 + r() * 1.1;
      col.setHSL(fl.grassHue + (r() - 0.5) * 0.05, 0.5, fl.grassLight + (r() - 0.5) * 0.12);
      put(mesh, set(at.x, yAt(at.x, at.z, -0.02), at.z, r() * 6, s, s * (0.7 + r() * 0.9), s), col);
    }
    done(mesh);
  }
  if (fl.flowers) {
    const nF = cnt(fl.flowers);
    const tufts = inst(faceUp(mergeAll([0, 1].map((i) => new THREE.PlaneGeometry(0.7, 0.5, 1, 2).translate(0, 0.25, 0).rotateY((i * Math.PI) / 2)))), wind.patch(leafy(grassMap(), { roughness: 1 }), { h: 0.5, amp: 0.05, bend: 0.5 }), nF, false);
    const ico = new THREE.IcosahedronGeometry(0.06, 0);
    const bloomGeo = mergeAll([ico.clone().translate(0.1, 0.46, 0), ico.clone().translate(-0.08, 0.38, 0.1), ico.clone().translate(0, 0.52, -0.1)]);
    bloomGeo.computeVertexNormals();
    const blooms = inst(bloomGeo, wind.patch(std(0xffffff, { roughness: 0.6 }), { h: 0.5, amp: 0.05, bend: 0.5 }), nF, false);
    for (let i = 0; i < fl.flowers * 3 && tufts.count < nF; i++) {
      // Flowers come in drifts: a patch of one colour.
      const at = spot(0.4, 0.3); if (!at) continue;
      const drift = Math.floor((n(at.x / 18 + 9, at.z / 18, 2) * 0.5 + 0.5) * fl.flower.length * 1.5) % fl.flower.length;
      if (n(at.x / 11, at.z / 11 + 5, 2) < -0.1) continue;
      const s = 0.9 + r() * 0.9, ry = r() * 6;
      col.setHSL(fl.grassHue, 0.5, fl.grassLight);
      put(tufts, set(at.x, yAt(at.x, at.z, -0.02), at.z, ry, s), col);
      col.setHex(fl.flower[r() < 0.8 ? drift : Math.floor(r() * fl.flower.length)]!);
      put(blooms, set(at.x, yAt(at.x, at.z, -0.02), at.z, ry, s), col);
    }
    done(tufts, blooms);
  }

  // --- Nurse logs: fallen trunks with ferns, saplings and mushrooms growing off them. ---
  if (fl.nurse) {
    const nL = cnt(fl.nurse);
    const logs = inst(new THREE.CylinderGeometry(1, 1.08, 1, 10).rotateZ(Math.PI / 2), std(0xffffff, { map: ctx.bark }), nL, true);
    const mossy = inst(new THREE.CylinderGeometry(1.06, 1.06, 0.96, 10, 1, true, Math.PI / 2 - 1.1, 2.2).rotateZ(Math.PI / 2), std(0xffffff, { roughness: 1, map: ctx.bark }), nL, false);
    const sprouts = inst(ctx.fernGeo, wind.patch(leafy(ctx.frond, { roughness: 0.85 }), { h: 1.5, amp: 0.08, bend: 1.1 }), nL * 7, false);
    const saplingStem = inst(new THREE.CylinderGeometry(0.03, 0.05, 1, 4).translate(0, 0.5, 0), std(0x5a4128), nL * 2, false);
    const saplingTop = inst(new THREE.ConeGeometry(0.4, 1, 6).translate(0, 0.5, 0), wind.patch(std(0xffffff), { h: 1, amp: 0.06, bend: 0.8 }), nL * 2, false);
    const shelf = inst(new THREE.SphereGeometry(0.5, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), std(0xffffff, { roughness: 0.6 }), nL * 4, false);
    for (let i = 0; i < nL * 8 && logs.count < nL; i++) {
      const at = spot(4, 0.2); if (!at) continue;
      const len = 7 + r() * 9, rad = 0.45 + r() * 0.45, ry = r() * Math.PI, y = yAt(at.x, at.z, rad * 0.8);
      m.compose(p.set(at.x, y, at.z), q.setFromAxisAngle(UP, ry), k.set(len, rad, rad));
      col.setHSL(0.07, 0.4, 0.18 + r() * 0.08);
      put(logs, m, col); put(mossy, m, col.setHex(jungle ? 0x4a6e26 : 0x55702c));
      const ax = Math.cos(ry), az = -Math.sin(ry);
      for (let j = 0; j < 7; j++) {
        const d = (r() - 0.5) * len * 0.9, x = at.x + ax * d, z = at.z + az * d, top = yAt(x, z, rad * 1.7);
        col.setHSL(0.21 + r() * 0.08, 0.55, 0.3 + r() * 0.14);
        put(sprouts, set(x, top - 0.1, z, r() * 6, 0.35 + r() * 0.4), col);
      }
      for (let j = 0; j < 2; j++) {
        const d = (r() - 0.5) * len * 0.8, x = at.x + ax * d, z = at.z + az * d, top = yAt(x, z, rad * 1.7), h = 0.5 + r() * 0.7;
        put(saplingStem, set(x, top - 0.1, z, 0, 1, h, 1));
        col.setHSL(0.27 + r() * 0.05, 0.5, 0.25 + r() * 0.08);
        put(saplingTop, set(x, top - 0.1 + h * 0.5, z, 0, 1, h * 0.8, 1), col);
      }
      for (let j = 0; j < 4; j++) {
        const d = (r() - 0.5) * len * 0.9, a = r() * 6, w = 0.12 + r() * 0.14;
        col.setHex([0xd8c8a0, 0xb8502c, 0xe8d8b8][Math.floor(r() * 3)]!);
        put(shelf, set(at.x + ax * d + Math.cos(a) * rad * 0.9, yAt(at.x, at.z, rad * 0.8 + Math.sin(a) * rad * 0.9), at.z + az * d, r() * 6, w, w * 0.6, w), col);
      }
    }
    done(logs, mossy, sprouts, saplingStem, saplingTop, shelf);
  }

  // --- Thickets: dense shrubs in the gaps between the trees (the sim's sight lines are unchanged). ---
  if (fl.thickets && woods) {
    const nB = cnt(fl.thickets * 14);
    const bushes = inst(ctx.fernGeo, wind.patch(leafy(ctx.frond, { roughness: 0.85 }), { h: 1.5, amp: 0.1, bend: 1.8 }), nB, jungle);
    const berry = inst(new THREE.IcosahedronGeometry(0.05, 0), std(0xffffff, { roughness: 0.4 }), nB * 3, false);
    for (let i = 0; i < fl.thickets * Q; i++) {
      // Between two trunks when it can be.
      let cx = 0, cz = 0, found = false;
      for (let tries = 0; tries < 12 && !found; tries++) {
        const a = field[Math.floor(r() * field.length)], c = field[Math.floor(r() * field.length)];
        if (a && c && a !== c && Math.hypot(a.x - c.x, a.z - c.z) < 24) { cx = (a.x + c.x) / 2; cz = (a.z + c.z) / 2; found = !bare(cx, cz, 2); }
        else { const at = anywhere(1.05); cx = at.x; cz = at.z; found = !bare(cx, cz, 3); }
      }
      if (!found) continue;
      const berries = r() < 0.4, bc = [0xc02838, 0x4a2a6a, 0xe0a030][Math.floor(r() * 3)]!;
      for (let j = 0; j < 14; j++) {
        const a = r() * 6.3, d = Math.sqrt(r()) * 4.2, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
        if (bare(x, z, 1)) continue;
        const w = (1 - d / 6) * (2.2 + r() * 2);
        col.setHSL(0.24 + r() * 0.07, 0.5, 0.17 + r() * 0.09);
        put(bushes, set(x, yAt(x, z, -0.1), z, r() * 6, w, w * (0.9 + r() * 0.5), w), col);
        if (berries) for (let c = 0; c < 2; c++) put(berry, set(x + (r() - 0.5) * w, yAt(x, z, 0.5 + r() * w * 0.8), z + (r() - 0.5) * w, 0, 1), col.setHex(bc));
      }
    }
    done(bushes, berry);
  }

  // --- Dry tufts and grit are all the canyon gets; the rest is the woods'. ---
  function addGlints(pos: number[], cols: number[], size: number, base = 0.8) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    const mat = new THREE.PointsMaterial({ size, map: glow(), vertexColors: true, transparent: true, opacity: base, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    scene.add(pts);
    glints.push({ mat, phase: r() * 6, speed: 0.6 + r() * 1.2, base });
  }

  if (jungle) buildJungle();

  return {
    update(t, eye) {
      wind.update(t, b, eye);
      for (const g of glints) g.mat.opacity = g.base * (0.6 + 0.4 * Math.sin(t * g.speed + g.phase));
      mist.forEach((mesh, i) => mesh.position.set(Math.sin(t * 0.04 + i * 2) * 7, 0, Math.cos(t * 0.03 + i) * 5));
    },
  };

  // The jungle's other storeys: a canopy overhead, lianas, buttresses, broad leaves, palms and
  // cycads, fungi on the trunks, bioluminescent spots in the dark, roots over the trail and mist.
  function buildJungle() {
    const all = trees;
    const bark = ctx.bark;
    const barkMat = std(0x5d4a2e, { map: bark });

    // Canopy: two layers of leaf sprays overhead, holes between so the sun dapples through.
    const upper = inst(flat(new THREE.PlaneGeometry(1, 1)), leafy(canopyMap(), { roughness: 0.9 }), cnt(170), true, true);
    const mid = inst(flat(new THREE.PlaneGeometry(1, 1)), leafy(canopyMap(), { roughness: 0.9 }), cnt(240), true, true);
    for (let i = 0; i < 170 * 2 && upper.count < upper.instanceMatrix.count; i++) {
      const at = anywhere(1.3), s = 14 + r() * 10;
      q.setFromEuler(e.set((r() - 0.5) * 0.3, r() * 6.3, (r() - 0.5) * 0.3));
      col.setHSL(0.27 + r() * 0.05, 0.5, 0.14 + r() * 0.08);
      put(upper, m.compose(p.set(at.x, yAt(at.x, at.z, 30 + r() * 14), at.z), q, k.set(s, 1, s)), col);
    }
    for (let i = 0; i < 240 * 2 && mid.count < mid.instanceMatrix.count; i++) {
      const at = anywhere(1.2), s = 6 + r() * 6;
      q.setFromEuler(e.set((r() - 0.5) * 0.5, r() * 6.3, (r() - 0.5) * 0.5));
      col.setHSL(0.25 + r() * 0.06, 0.55, 0.2 + r() * 0.1);
      put(mid, m.compose(p.set(at.x, yAt(at.x, at.z, 12 + r() * 8), at.z), q, k.set(s, 1, s)), col);
    }
    done(upper, mid);

    // Lianas hang from the high boughs, and swag from trunk to trunk.
    const lianaCurve = new THREE.CatmullRomCurve3([[0, 0, 0], [0.14, -0.25, 0.1], [-0.1, -0.5, -0.05], [0.12, -0.75, 0.08], [0, -1, 0]].map(([x, y, z]) => new THREE.Vector3(x, y, z)));
    const lianaMat = wind.patch(std(0xffffff), { h: 1, amp: 0.5, bend: 1.2, hang: true });
    const lianas = inst(new THREE.TubeGeometry(lianaCurve, 8, 0.035, 4, false), lianaMat, cnt(all.length * 3), false, false);
    const swagCurve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.5, -2, 0), new THREE.Vector3(1, 0, 0));
    const swags = inst(new THREE.TubeGeometry(swagCurve, 10, 0.05, 4, false), wind.patch(std(0xffffff), { h: 1.1, amp: 0.2, bend: 0.8, hang: true }), cnt(150), false, false);
    const liane: number[] = [];
    for (const t of all) {
      if (lianas.count >= lianas.instanceMatrix.count) break;
      const y0 = yAt(t.x, t.z), top = y0 + 18 + r() * 14;
      for (let v = 0; v < 3; v++) {
        const x = t.x + (r() - 0.5) * 7, z = t.z + (r() - 0.5) * 7, len = 8 + r() * Math.min(26, top - y0 - 1);
        col.setHSL(0.2 + r() * 0.12, 0.35, 0.12 + r() * 0.12);
        put(lianas, set(x, top, z, r() * 6, 1 + r() * 2.5, len, 1 + r() * 2.5), col);
        if (r() < 0.12) liane.push(x, top - len + 0.4, z);
      }
    }
    for (let i = 0; i < 400 && swags.count < swags.instanceMatrix.count; i++) {
      const a = all[Math.floor(r() * all.length)]!, c = all[Math.floor(r() * all.length)]!, d = Math.hypot(a.x - c.x, a.z - c.z);
      if (d < 7 || d > 26) continue;
      const y = yAt(a.x, a.z) + 8 + r() * 16, ry = Math.atan2(-(c.z - a.z), c.x - a.x);
      col.setHSL(0.22 + r() * 0.08, 0.4, 0.14 + r() * 0.1);
      put(swags, set(a.x, y, a.z, ry, d, 0.6 + r() * 0.8, 1), col);
    }
    done(lianas, swags);

    // Buttress roots: thin fins flaring out from the foot of each trunk.
    const fin = new THREE.Shape();
    fin.moveTo(0, 0); fin.lineTo(1, 0); fin.quadraticCurveTo(0.14, 0.1, 0, 1); fin.closePath();
    const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.24, bevelEnabled: false, curveSegments: 4 }).translate(0, 0, -0.12);
    const fins = inst(finGeo, barkMat, cnt(all.length * 4), false);
    // Moss up the side of the trunk, ragged at the top.
    const sleeve = new THREE.LatheGeometry([[1.06, 0], [1.03, 0.1], [1.0, 0.2], [0.96, 0.3]].map(([x, y]) => new THREE.Vector2(x, y)), 12);
    const sp = sleeve.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < sp.count; i++) if (sp.getY(i) > 0.25) sp.setY(i, sp.getY(i) + (((i * 7919) % 13) / 13 - 0.4) * 0.12);
    sleeve.computeVertexNormals();
    const sleeves = inst(sleeve, std(0x3e5e1e, { map: bark, roughness: 1 }), cnt(all.length), false);
    const shelves = inst(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 8, 1, false, 0, Math.PI), new THREE.MeshBasicMaterial({ color: 0xffffff }), cnt(320), false, false);
    const sparkPos: number[] = [], sparkCols: number[] = [];
    const glowCols = [0x6af0d0, 0xff9a40, 0xb070ff, 0x8aff7a];
    for (const [ti, t] of all.entries()) {
      const y0 = yAt(t.x, t.z), h = 22 + (ti % 7) * 3, nFins = 3 + (ti % 3);
      for (let j = 0; j < nFins; j++) {
        const a = r() * 6.3, reach = t.r * 1.8 + 0.8 + r() * 1.5, up = 2.5 + t.r * 2.2 + r() * 2;
        put(fins, set(t.x + Math.cos(a) * t.r * 0.55, y0 - 0.05, t.z - Math.sin(a) * t.r * 0.55, a, reach, up, 0.7 + r() * 0.7));
      }
      put(sleeves, set(t.x, y0, t.z, 0, t.r * 1.03, h * (0.8 + r() * 0.5), t.r * 1.03));
      if (r() < 0.45) for (let j = 0; j < 1 + Math.floor(r() * 2); j++) {
        const a = r() * 6.3, f = 0.02 + r() * 0.2, rr = t.r * (1 - f * 0.4) + 0.05, w = 0.4 + r() * 0.6, c = glowCols[Math.floor(r() * glowCols.length)]!;
        col.setHex(c).multiplyScalar(0.8);
        put(shelves, set(t.x + Math.cos(a) * rr, y0 + h * f, t.z - Math.sin(a) * rr, a, w), col);
        sparkPos.push(t.x + Math.cos(a) * (rr + 0.3), y0 + h * f + 0.1, t.z - Math.sin(a) * (rr + 0.3));
        col.setHex(c); sparkCols.push(col.r, col.g, col.b);
      }
    }
    done(fins, sleeves, shelves);

    // Roots over the dirt trail: arches the units step across.
    const arch = new THREE.TorusGeometry(1, 0.12, 5, 10, Math.PI);
    const roots = inst(arch, std(0xffffff, { map: bark }), cnt(150), false);
    const segs = ctx.trail.slice(1).map((c, i) => ({ a: ctx.trail[i]!, c, len: Math.hypot(c.x - ctx.trail[i]!.x, c.z - ctx.trail[i]!.z) }));
    const total = segs.reduce((s, g) => s + g.len, 0);
    for (let i = 0; i < 400 && roots.count < roots.instanceMatrix.count; i++) {
      let d = r() * total, g = segs[0]!;
      for (const sg of segs) { if (d <= sg.len) { g = sg; break; } d -= sg.len; }
      const f = d / (g.len || 1), z = g.a.z + (g.c.z - g.a.z) * f, x = g.a.x + (g.c.x - g.a.x) * f - ctx.shiftAt(z);
      if (b.posts.some((po) => Math.hypot(po.x - x, po.z - z) < 7)) continue;
      const dx = (g.c.x - g.a.x) / (g.len || 1), dz = (g.c.z - g.a.z) / (g.len || 1), w = 1.4 + r() * 2.6;
      col.setHSL(0.08 + r() * 0.05, 0.3, 0.28 + r() * 0.12);
      m.compose(p.set(x + (r() - 0.5) * 2, yAt(x, z, -0.12), z), q.setFromEuler(e.set(0, Math.atan2(-dx, -dz), 0)), k.set(w, 0.28 + r() * 0.3, 1 + r()));
      put(roots, m, col);
    }
    done(roots);

    // Broad-leaf plants in the understory, and the big ferns.
    const broadOne = new THREE.PlaneGeometry(1.5, 3.4, 2, 7).translate(0, 1.7, 0);
    const bp = broadOne.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < bp.count; i++) { const f = bp.getY(i) / 3.4; bp.setXYZ(i, bp.getX(i), 3.4 * (0.9 * f - 0.5 * f * f), -f * 2 * (0.6 + f)); }
    const broadGeo = mergeAll(Array.from({ length: 7 }, (_, i) => broadOne.clone().rotateX(-0.2 * (i % 2)).rotateY((i / 7) * Math.PI * 2)));
    broadGeo.computeVertexNormals();
    const broad = inst(broadGeo, wind.patch(leafy(broadMap(), { roughness: 0.7 }), { h: 3, amp: 0.2, bend: 2.4 }), cnt(260), false);
    const bigGeo = frondRing(0.9, 3.4, 1.2, 1.4, 13, 1);
    const bigFerns = inst(bigGeo, wind.patch(leafy(ctx.frond, { roughness: 0.85 }), { h: 3, amp: 0.2, bend: 2.2 }), cnt(300), false);
    for (let i = 0; i < 1500 && (broad.count < broad.instanceMatrix.count || bigFerns.count < bigFerns.instanceMatrix.count); i++) {
      const at = spot(1.5, 0.55); if (!at) continue;
      const y = yAt(at.x, at.z, -0.1);
      if (r() < 0.45 && broad.count < broad.instanceMatrix.count) {
        const s = 0.7 + r() * 1.0;
        col.setHSL(0.27 + r() * 0.06, 0.55, 0.22 + r() * 0.1);
        put(broad, set(at.x, y, at.z, r() * 6, s, s * (0.8 + r() * 0.5), s), col);
      } else if (bigFerns.count < bigFerns.instanceMatrix.count) {
        const s = 0.6 + r() * 0.7;
        col.setHSL(0.24 + r() * 0.06, 0.55, 0.22 + r() * 0.1);
        put(bigFerns, set(at.x, y, at.z, r() * 6, s), col);
      }
    }
    // Palms, cycads and tree ferns: a trunk and a crown of fronds each.
    const palmCrown = inst(frondRing(0.75, 5, 0.7, 1.6, 12, 1), wind.patch(leafy(ctx.frond, { roughness: 0.8 }), { h: 5, amp: 0.4, bend: 2.5 }), cnt(80), false);
    const cycadCrown = inst(frondRing(0.5, 2.8, 0.6, 0.5, 22, 1), wind.patch(leafy(ctx.frond, { roughness: 0.8 }), { h: 2.8, amp: 0.1, bend: 1.6 }), cnt(70), false);
    const palmTrunk = inst(new THREE.CylinderGeometry(0.2, 0.34, 1, 7, 5).translate(0, 0.5, 0), std(0xffffff, { map: bark }), cnt(80), false);
    const stemTrunk = inst(new THREE.CylinderGeometry(0.85, 1, 1, 8).translate(0, 0.5, 0), std(0xffffff, { map: bark }), cnt(130), false);
    for (let i = 0; i < 600 && palmTrunk.count < palmTrunk.instanceMatrix.count; i++) {
      const at = spot(2, 0.35); if (!at) continue;
      const y = yAt(at.x, at.z, -0.1), roll = r();
      if (roll < 0.45) {
        const h = 8 + r() * 7, lean = 0.06 + r() * 0.2, ry = r() * 6.3;
        q.setFromEuler(e.set(lean, ry, 0, "YXZ"));
        m.compose(p.set(at.x, y, at.z), q, k.set(1, h, 1));
        col.setHSL(0.09, 0.3, 0.3 + r() * 0.1);
        put(palmTrunk, m, col);
        const top = new THREE.Vector3(0, h, 0).applyQuaternion(q).add(p.set(at.x, y, at.z));
        col.setHSL(0.28 + r() * 0.05, 0.55, 0.24 + r() * 0.08);
        put(palmCrown, set(top.x, top.y - 0.2, top.z, r() * 6, 0.9 + r() * 0.5), col);
      } else if (roll < 0.75 && cycadCrown.count < cycadCrown.instanceMatrix.count) {
        const h = 0.9 + r() * 1.2, w = 0.5 + r() * 0.3;
        col.setHSL(0.09, 0.35, 0.22 + r() * 0.08);
        put(stemTrunk, set(at.x, y, at.z, r() * 6, w, h, w), col);
        col.setHSL(0.3 + r() * 0.04, 0.5, 0.2 + r() * 0.08);
        put(cycadCrown, set(at.x, y + h - 0.1, at.z, r() * 6, 0.8 + r() * 0.5), col);
      } else if (bigFerns.count < bigFerns.instanceMatrix.count) {
        // A tree fern: a thin stem under a big crown.
        const h = 2 + r() * 3.5, w = 0.2 + r() * 0.12;
        col.setHSL(0.08, 0.3, 0.17 + r() * 0.06);
        put(stemTrunk, set(at.x, y, at.z, 0, w, h, w), col);
        col.setHSL(0.26 + r() * 0.05, 0.55, 0.22 + r() * 0.1);
        put(bigFerns, set(at.x, y + h - 0.2, at.z, r() * 6, 0.9 + r() * 0.5), col);
      }
    }
    done(broad, bigFerns, palmCrown, cycadCrown, palmTrunk, stemTrunk);

    // Bioluminescent spots: in the gloom between the trunks and on the lianas, two sets that pulse apart.
    for (let i = 0; i < cnt(260); i++) {
      const at = spot(0.5, 0.7); if (!at) continue;
      const c = glowCols[Math.floor(r() * glowCols.length)]!;
      sparkPos.push(at.x, yAt(at.x, at.z, 0.1 + r() * 2.2), at.z);
      col.setHex(c); sparkCols.push(col.r, col.g, col.b);
    }
    for (let i = 0; i < liane.length; i += 3) { sparkPos.push(liane[i]!, liane[i + 1]!, liane[i + 2]!); col.setHex(0x8affb0); sparkCols.push(col.r, col.g, col.b); }
    const half = Math.floor(sparkPos.length / 6) * 3;
    addGlints(sparkPos.slice(0, half), sparkCols.slice(0, half), 1.1);
    addGlints(sparkPos.slice(half), sparkCols.slice(half), 0.9);

    // Mist sitting low: wide soft sheets a body's height off the ground, drifting.
    for (const [i, count] of [cnt(90), cnt(70)].entries()) {
      const sheet = inst(flat(new THREE.CircleGeometry(1, 14)), new THREE.MeshBasicMaterial({ map: mistMap(), color: ctx.fog, transparent: true, opacity: i ? 0.2 : 0.26, depthWrite: false, side: THREE.DoubleSide }), count, false, false);
      for (let j = 0; j < count; j++) {
        const at = anywhere(1.1), s = 12 + r() * 20;
        put(sheet, set(at.x, yAt(at.x, at.z, 0.5 + i * 1.6 + r() * 1.3), at.z, r() * 6, s, 1, s));
      }
      done(sheet);
      sheet.frustumCulled = false;
      mist.push(sheet);
    }
  }
}
