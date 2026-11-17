// How a studio sounds, from its shape and what it is made of. The space a spot is in is found by flooding the floor
// from the spot until walls stop it (doors count as shut), so the vocal booth that a room's walls close off rings
// like a booth and not like the room around it. That space's air and surfaces give how long it rings in each octave
// band, and its shape gives an impulse response: the direct sound, the first reflections, then a tail falling at
// each band's ring time.
//
// Pure, no DOM: the builder page turns `impulse()` into a ConvolverNode, a test reads the numbers.
import { mulberry32 } from "@rustybuns/util";
import type { Side, Spot, StudioDef, Wall } from "./room.ts";

/** Octave bands the sound is worked out in, Hz. */
export const BANDS = [125, 250, 500, 1000, 2000, 4000] as const;

/**
 * What a surface can be made of: how much of the sound striking it each one soaks up per band (0 bounces it all
 * back, 1 takes it all; rounded from the usual published absorption tables), and the colour the room draws it in.
 */
export const MATERIALS = {
  concrete: { name: "Painted concrete", color: "#6f7176", a: [0.01, 0.01, 0.02, 0.02, 0.02, 0.03] },
  brick: { name: "Bare brick", color: "#8a4b33", a: [0.03, 0.03, 0.03, 0.04, 0.05, 0.07] },
  stone: { name: "Polished stone", color: "#9a958c", a: [0.01, 0.01, 0.01, 0.01, 0.02, 0.02] },
  tile: { name: "Glazed tile", color: "#c9cdc8", a: [0.01, 0.01, 0.01, 0.02, 0.02, 0.02] },
  plaster: { name: "Plaster", color: "#cfc6b4", a: [0.013, 0.015, 0.02, 0.03, 0.04, 0.05] },
  drywall: { name: "Drywall on studs", color: "#3c3f46", a: [0.29, 0.1, 0.05, 0.04, 0.07, 0.09] },
  wood: { name: "Wood panelling", color: "#8a6440", a: [0.28, 0.22, 0.17, 0.09, 0.1, 0.11] },
  floorboards: { name: "Wooden floor", color: "#7a5a3e", a: [0.15, 0.11, 0.1, 0.07, 0.06, 0.07] },
  carpet: { name: "Carpet", color: "#4a3f5c", a: [0.02, 0.06, 0.14, 0.37, 0.6, 0.65] },
  curtain: { name: "Heavy curtain", color: "#6e2a35", a: [0.14, 0.35, 0.55, 0.72, 0.7, 0.65] },
  glass: { name: "Glass", color: "#8fd0ff", a: [0.18, 0.06, 0.04, 0.03, 0.02, 0.02] },
  ceilingTile: { name: "Acoustic ceiling tile", color: "#24262b", a: [0.7, 0.66, 0.72, 0.92, 0.88, 0.75] },
  foam: { name: "Thick absorber", color: "#2b2d33", a: [0.45, 0.9, 0.98, 0.98, 0.98, 0.98] },
} as const satisfies Record<string, { name: string; color: string; a: readonly number[] }>;
export type Material = keyof typeof MATERIALS;
export const MATERIAL_IDS = Object.keys(MATERIALS) as Material[];

/** A room's materials when its definition doesn't say: a drywall room with a wooden floor. */
export const PLAIN = { floor: "floorboards", ceiling: "drywall", walls: { front: "drywall", back: "drywall", left: "drywall", right: "drywall" } } as const;
export const wallMaterial = (w: Wall): Material => w.glass ? "glass" : w.material ?? "drywall";

// ---- the space a spot is in ----

export interface Space {
  /** Floor area m², air m³, and every surface's area by material. */
  floor: number;
  volume: number;
  surfaces: Partial<Record<Material, number>>;
  /** The box it fits in (x0, z0 to x1, z1), for the first reflections, and how much each of its four sides soaks up on average. */
  box: [number, number, number, number];
  sides: Record<Side, number>;
  /** Whether walls close it off from most of the room (a booth, a control room). */
  closed: boolean;
}

const mean = (m: Material) => MATERIALS[m].a.reduce((t, a) => t + a, 0) / BANDS.length;

/** The space around [x, z]: the floor flooded from there on a grid until the outside or inside walls stop it. */
export function spaceAt(def: StudioDef, at: readonly number[]): Space {
  const { w, d, h } = def.size, mats = def.materials ?? PLAIN;
  const g = Math.max(0.1, Math.max(w, d) / 250), nx = Math.ceil(w / g), nz = Math.ceil(d / g);
  const cell = (x: number, z: number) => [Math.floor((x + w / 2) / g), Math.floor((z + d / 2) / g)];
  // Walls on the grid: each cell a wall crosses holds that wall's material.
  const wall = new Map<number, Material>();
  for (const wl of def.walls) {
    const [x0, z0] = wl.from, [x1, z1] = wl.to, n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (g / 2));
    for (let i = 0; i <= n; i++) {
      const [ix, iz] = cell(x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n);
      if (ix >= 0 && ix < nx && iz >= 0 && iz < nz) wall.set(iz * nx + ix, wallMaterial(wl));
    }
  }
  // Start from the nearest free cell (a seat can sit right against a wall).
  let [sx, sz] = cell(at[0], at[1]);
  sx = Math.min(nx - 1, Math.max(0, sx)); sz = Math.min(nz - 1, Math.max(0, sz));
  for (let r = 1; wall.has(sz * nx + sx) && r < 6; r++) {
    const near = [[sx + r, sz], [sx - r, sz], [sx, sz + r], [sx, sz - r]].find(([x, z]) => x >= 0 && x < nx && z >= 0 && z < nz && !wall.has(z * nx + x));
    if (near) [sx, sz] = near;
  }
  const seen = new Uint8Array(nx * nz), queue = [sz * nx + sx];
  seen[queue[0]] = 1;
  const edge: Record<Side, Partial<Record<Material, number>>> = { front: {}, back: {}, left: {}, right: {} };
  const outside: Record<Side, number> = { front: 0, back: 0, left: 0, right: 0 };
  const add = (side: Side, m: Material) => { edge[side][m] = (edge[side][m] ?? 0) + g * h; };
  let cells = 0, bx0 = nx, bz0 = nz, bx1 = 0, bz1 = 0;
  while (queue.length) {
    const c = queue.pop()!, ix = c % nx, iz = (c - ix) / nx;
    cells++; bx0 = Math.min(bx0, ix); bx1 = Math.max(bx1, ix); bz0 = Math.min(bz0, iz); bz1 = Math.max(bz1, iz);
    for (const [dx, dz, side] of [[-1, 0, "left"], [1, 0, "right"], [0, -1, "back"], [0, 1, "front"]] as const) {
      const x = ix + dx, z = iz + dz;
      if (x < 0 || x >= nx || z < 0 || z >= nz) { add(side, mats.walls[side]); outside[side] += g; continue; }
      const k = z * nx + x, m = wall.get(k);
      if (m) { add(side, m); continue; }
      if (!seen[k]) { seen[k] = 1; queue.push(k); }
    }
  }
  // Panels hang on the outside walls; this space gets the share of each that faces it.
  for (const p of def.panels ?? []) {
    const share = outside[p.wall] / (p.wall === "front" || p.wall === "back" ? w : d), m2 = p.m2 * share;
    const base = mats.walls[p.wall];
    const take = Math.min(m2, edge[p.wall][base] ?? 0);
    edge[p.wall][base] = (edge[p.wall][base] ?? 0) - take;
    edge[p.wall][p.material] = (edge[p.wall][p.material] ?? 0) + take;
  }
  const floor = cells * g * g;
  const surfaces: Partial<Record<Material, number>> = {};
  const put = (m: Material, m2: number) => { surfaces[m] = (surfaces[m] ?? 0) + m2; };
  put(mats.floor, floor); put(mats.ceiling, floor);
  const sides = { front: 0, back: 0, left: 0, right: 0 };
  for (const side of ["front", "back", "left", "right"] as const) {
    let m2s = 0, ab = 0;
    for (const [m, m2] of Object.entries(edge[side]) as [Material, number][]) { put(m, m2); m2s += m2; ab += m2 * mean(m); }
    sides[side] = m2s ? ab / m2s : 0;
  }
  const box: Space["box"] = [bx0 * g - w / 2, bz0 * g - d / 2, (bx1 + 1) * g - w / 2, (bz1 + 1) * g - d / 2];
  return { floor, volume: floor * h, surfaces, box, sides, closed: cells < (nx * nz - wall.size) / 2 };
}

// ---- how long it rings ----

/** Sound soaked up by the air itself over a metre, per band (4m in the reverb formula, 20 °C, half humidity). */
const AIR = [0, 0, 0.0005, 0.0012, 0.003, 0.0096];
const C = 343;

export interface Acoustics {
  space: Space;
  /** Seconds for a sound to fall 60 dB, per band (Eyring, with the air's share). */
  rt60: number[];
  /** The average across 500 Hz and 1 kHz, the one number people quote. */
  mid: number;
  /** In a word. */
  word: "dead" | "tight" | "warm" | "live" | "big" | "huge";
}

/** How the space at `spot` rings (the middle of the room when no spot is given). */
export function acoustics(def: StudioDef, spot?: Pick<Spot, "at">): Acoustics {
  const space = spaceAt(def, spot?.at ?? [0, 0]);
  const parts = Object.entries(space.surfaces) as [Material, number][];
  const surface = parts.reduce((t, [, m2]) => t + m2, 0);
  const rt60 = BANDS.map((_, i) => {
    const sabins = parts.reduce((t, [m, m2]) => t + m2 * MATERIALS[m].a[i], 0);
    const alpha = Math.min(0.99, sabins / surface);
    return 0.161 * space.volume / (-surface * Math.log(1 - alpha) + 4 * AIR[i] * space.volume);
  });
  const mid = (rt60[2] + rt60[3]) / 2;
  const word = mid < 0.25 ? "dead" : mid < 0.5 ? "tight" : mid < 0.9 ? "warm" : mid < 1.5 ? "live" : mid < 2.4 ? "big" : "huge";
  return { space, rt60, mid, word };
}

// ---- the impulse response ----

/** How far the room mic stands from the source, metres: far enough that the room is in the sound. */
export const MIC_M = 1.5;
/** The longest impulse response built, seconds. */
export const MAX_IR_S = 6;

export type Face = "floor" | "ceiling" | Side;
export interface Impulse {
  rate: number;
  /** Left and right: one set of reflections, two tails that differ, so the room sounds wide. */
  l: Float32Array<ArrayBuffer>;
  r: Float32Array<ArrayBuffer>;
  /** When each first reflection arrives after the direct sound, ms, and how loud it is (0 to 1). */
  early: { face: Face; ms: number; gain: number }[];
}

/**
 * The impulse response of a source at `spotId` (the room's middle when it's not a spot) heard by a mic `MIC_M` toward
 * the middle of its space: the direct sound, the six first reflections in the box the space fits in (image sources,
 * each softened by what that side soaks up), then octave bands of noise falling at each band's RT60. Seeded, so a
 * room always gives the same response.
 */
export function impulse(def: StudioDef, spotId: string | undefined, rate = 48000): Impulse {
  const spot = def.spots.find((s) => s.id === spotId);
  const ac = acoustics(def, spot);
  const { box, sides } = ac.space, mats = def.materials ?? PLAIN, h = def.size.h;
  const at = spot?.at ?? [0, 0];
  const mid = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], toMid = Math.hypot(mid[0] - at[0], mid[1] - at[1]);
  const step = Math.min(MIC_M, Math.max(0.5, toMid)), dir = toMid > 1e-6 ? [(mid[0] - at[0]) / toMid, (mid[1] - at[1]) / toMid] : [0, 1];
  const src = [at[0], 1.2, at[1]], mic = [at[0] + dir[0] * step, 1.2, at[1] + dir[1] * step];
  const direct = Math.hypot(mic[0] - src[0], mic[2] - src[2]);
  const mirror = (axis: 0 | 1 | 2, plane: number) => { const im = [...src]; im[axis] = 2 * plane - src[axis]; return im; };
  const images: [Face, number[], number][] = [
    ["left", mirror(0, box[0]), sides.left], ["right", mirror(0, box[2]), sides.right],
    ["floor", mirror(1, 0), mean(mats.floor)], ["ceiling", mirror(1, h), mean(mats.ceiling)],
    ["back", mirror(2, box[1]), sides.back], ["front", mirror(2, box[3]), sides.front],
  ];
  const early = images.map(([face, im, a]) => {
    const dist = Math.hypot(mic[0] - im[0], mic[1] - im[1], mic[2] - im[2]);
    return { face, ms: (dist - direct) / C * 1000, gain: Math.sqrt(1 - a) * direct / dist };
  });

  const len = Math.ceil(Math.min(MAX_IR_S, Math.max(...ac.rt60) * 1.1 + 0.05) * rate);
  const l = new Float32Array(len), r = new Float32Array(len);
  l[0] = r[0] = 1;
  for (const [i, e] of early.entries()) {
    const n = Math.round(e.ms / 1000 * rate);
    if (n <= 0 || n >= len) continue;
    // A side wall's reflection leans to its own ear; the rest land in both.
    const pan = e.face === "left" ? 0.85 : e.face === "right" ? 0.15 : i % 2 ? 0.45 : 0.55;
    l[n] += e.gain * Math.sqrt(pan) * Math.SQRT2;
    r[n] += e.gain * Math.sqrt(1 - pan) * Math.SQRT2;
  }
  // The tail comes in as the reflections pile up (the mixing time, about √V ms).
  const onset = Math.max(...early.map((e) => e.ms), Math.sqrt(ac.space.volume)) / 1000;
  const level = Math.min(0.6, 0.5 * Math.sqrt(Math.max(...early.map((e) => e.gain))));
  tail(l, rate, ac.rt60, onset, level, 0x51ab ^ hash(def.id));
  tail(r, rate, ac.rt60, onset, level, 0xbeef ^ hash(def.id));
  return { rate, l, r, early };
}

function hash(s: string) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

/** Noise split into octave bands, each band falling 60 dB in its RT60, added into `out` from `onset` seconds. */
function tail(out: Float32Array, rate: number, rt60: number[], onset: number, level: number, seed: number) {
  const rand = mulberry32(seed);
  const noise = new Float32Array(out.length);
  for (let i = 0; i < noise.length; i++) noise[i] = rand() * 2 - 1;
  const start = Math.round(onset * rate), ramp = Math.max(1, start);
  for (const [b, f0] of BANDS.entries()) {
    if (f0 >= rate / 2) continue;
    // A band-pass biquad an octave wide (Q √2), run over the noise.
    const w0 = 2 * Math.PI * f0 / rate, alpha = Math.sin(w0) / (2 * Math.SQRT2), a0 = 1 + alpha;
    const b0 = alpha / a0, b2 = -alpha / a0, a1 = -2 * Math.cos(w0) / a0, a2 = (1 - alpha) / a0;
    const k = -6.9078 / (rt60[b] * rate);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < out.length; i++) {
      const x = noise[i], y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      if (i < start / 2) continue;
      out[i] += y * level * Math.min(1, (i - start / 2) / ramp) * Math.exp(k * i);
    }
  }
}
