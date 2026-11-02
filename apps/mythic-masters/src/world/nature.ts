// The living part of the open world, without three.js: the day turning over you, the wind in the trees, patches
// of wild food you can pick for your line-up, and flocks of birds that flush when you walk into them and settle
// again further on. Everything comes from a hash of where it is, so the same ground always holds the same
// patch and the same roost, and a test can say where they are. src/world/life.ts draws the patches and the
// birds; src/world/view.ts turns the day and the wind into light and sway.
import { clamp, lerp } from "@rustybuns/util";
import type { Biome } from "../regions.ts";
import { dry, heightAt, regionAt, type World } from "./world.ts";

function hash(x: number, y: number, s: number) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Smooth noise along one axis, 0 to 1. */
function smooth1(t: number, s: number) {
  const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f);
  return lerp(hash(i, 0, s), hash(i + 1, 0, s), u);
}

// --- the day --------------------------------------------------------------------------------------------------------
export const DAY = 24 * 60;    // seconds of real time one game day takes: a region's walk sees a sunset
export const DAWN_HOUR = 8;    // the walk begins at eight in the morning
export type RGB = [number, number, number];
export interface Light {
  /** 0 to 24. */
  hour: number;
  /** Where the sun is, a unit vector; below the horizon at night (y < 0). */
  sun: [number, number, number];
  /** 0 by day, 1 in the deep of night. */
  night: number;
  sky: RGB; fog: RGB; sunColor: RGB;
  /** The sun's strength and the sky's glow, as light intensities. */
  sunlight: number; ambient: number;
  /** How far you see, metres: haze draws in at dusk and at night. */
  fogNear: number; fogFar: number;
}
const rgb = (hex: number): RGB => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const SKY_DAY = rgb(0xa8c8e8), SKY_DUSK = rgb(0xe8a070), SKY_NIGHT = rgb(0x0f1a2c);
const FOG_DAY = rgb(0xc8d8e4), FOG_DUSK = rgb(0xd8a888), FOG_NIGHT = rgb(0x18243a);
const SUN_DAY = rgb(0xfff2dc), SUN_LOW = rgb(0xffb070), MOON = rgb(0x9fb4d8);

/** The hour of the day `t` seconds into the walk. */
export const hourAt = (t: number) => (DAWN_HOUR + (24 * t) / DAY) % 24;

/** The sun, the sky and the haze at `t` seconds into the walk (or at `hour`, given). */
export function daylight(t: number, hour = hourAt(t)): Light {
  // The sun climbs from six to noon and sets at six; its arc tilts a little south.
  const el = (Math.PI * (hour - 6)) / 12, up = Math.sin(el);
  const sun: [number, number, number] = [-Math.cos(el), up, -0.35];
  const len = Math.hypot(...sun);
  sun[0] /= len; sun[1] /= len; sun[2] /= len;
  const night = clamp(-up * 4, 0, 1), low = clamp(1 - Math.abs(up) * 3.5, 0, 1); // low: within a few degrees of the horizon
  const dayness = clamp(up * 4, 0, 1);
  const sky = mix(mix(SKY_NIGHT, SKY_DAY, dayness), SKY_DUSK, low * 0.6);
  const fog = mix(mix(FOG_NIGHT, FOG_DAY, dayness), FOG_DUSK, low * 0.6);
  const sunColor = night > 0.5 ? MOON : mix(SUN_LOW, SUN_DAY, clamp(up * 2, 0, 1));
  return {
    hour, sun, night, sky, fog, sunColor,
    sunlight: lerp(2.2 * clamp(up * 1.5, 0.12, 1), 0.3, night),
    ambient: lerp(1.1, 0.3, night),
    fogNear: lerp(700, 250, Math.max(night, low * 0.5)), fogFar: lerp(9000, 2600, Math.max(night, low * 0.5)),
  };
}

// --- the wind -------------------------------------------------------------------------------------------------------
/** How hard the wind blows at `t` seconds, 0 (still) to 1 (a gale): a steady breath with gusts over it. */
export function wind(t: number): number {
  const breath = smooth1(t / 40, 71), gust = smooth1(t / 6, 72) * smooth1(t / 2.5, 73);
  return clamp(0.15 + 0.45 * breath + 0.4 * gust, 0, 1);
}

// --- the weather --------------------------------------------------------------------------------------------------
// Rain comes and goes on its own slow noise, more in the wet biomes and never in the desert; it falls as snow where
// it is cold. Mist lies in the low wet country in the early morning. All three are 0 to 1.
export interface Weather { rain: number; snow: number; mist: number }
const WET: Partial<Record<Biome, number>> = { rainforest: 1, swamp: 0.9, jungle: 0.9, forest: 0.6, coast: 0.6, lake: 0.55, river: 0.55, "pine-barrens": 0.45, highlands: 0.5, mountains: 0.5, island: 0.5, plains: 0.3, savanna: 0.2, steppe: 0.2, tundra: 0.5, desert: 0 };
const COLD: ReadonlySet<Biome> = new Set(["tundra", "mountains"]);
const MISTY: ReadonlySet<Biome> = new Set(["lake", "swamp", "river", "forest", "rainforest", "pine-barrens"]);
export function weather(t: number, biome: Biome, hour = hourAt(t)): Weather {
  const front = smooth1(t / 420, 91) * 0.7 + smooth1(t / 95, 92) * 0.3, wet = WET[biome] ?? 0.4;
  const fall = clamp((front - (1 - wet * 0.55)) / 0.25, 0, 1);
  const cold = COLD.has(biome) ? 1 : 0;
  const dawn = clamp(1 - Math.abs(hour - 6.5) / 2.5, 0, 1);
  return { rain: fall * (1 - cold), snow: fall * cold, mist: MISTY.has(biome) ? dawn * 0.8 : dawn * 0.2 };
}

// --- wild food --------------------------------------------------------------------------------------------------------
// A biome grows one thing worth picking. Patches sit on a FORAGE_GRID-metre grid at FORAGE_CHANCE, on dry ground
// you may walk; walk within PICK_R of one and it is picked, and it is bare for REGROW seconds after.
export type Forage = "berries" | "mushrooms" | "fruit" | "herbs";
export const FORAGE: Record<Biome, { kind: Forage; name: string }> = {
  "pine-barrens": { kind: "berries", name: "Highbush blueberries" }, forest: { kind: "berries", name: "Blackberries" }, lake: { kind: "berries", name: "Wild raspberries" },
  river: { kind: "fruit", name: "Pawpaws" }, coast: { kind: "berries", name: "Beach plums" }, highlands: { kind: "berries", name: "Huckleberries" }, tundra: { kind: "berries", name: "Cloudberries" },
  rainforest: { kind: "mushrooms", name: "Chanterelles" }, swamp: { kind: "mushrooms", name: "Oyster mushrooms" }, jungle: { kind: "fruit", name: "Breadnuts" },
  desert: { kind: "fruit", name: "Prickly pear" }, savanna: { kind: "fruit", name: "Marula fruit" }, steppe: { kind: "fruit", name: "Wild apples" }, island: { kind: "fruit", name: "Coconuts" },
  plains: { kind: "herbs", name: "Wild onions" }, mountains: { kind: "herbs", name: "Pine nuts" },
};
export const FORAGE_GRID = 70, FORAGE_CHANCE = 0.3, PICK_R = 2.5, REGROW = 10 * 60;
/** How much of each hurt member's health a patch gives back. */
export const FORAGE_MEND = 0.25;
export interface Patch { id: string; kind: Forage; name: string; x: number; z: number; region: number }

/** The patches within `radius` of (x, z), on dry open ground. */
export function forageNear(w: World, x: number, z: number, radius: number, open: ReadonlySet<number>): Patch[] {
  const out: Patch[] = [];
  for (let gz = Math.floor((z - radius) / FORAGE_GRID); gz <= Math.floor((z + radius) / FORAGE_GRID); gz++)
    for (let gx = Math.floor((x - radius) / FORAGE_GRID); gx <= Math.floor((x + radius) / FORAGE_GRID); gx++) {
      if (hash(gx, gz, 51) > FORAGE_CHANCE) continue;
      const px = (gx + 0.2 + 0.6 * hash(gx, gz, 52)) * FORAGE_GRID, pz = (gz + 0.2 + 0.6 * hash(gx, gz, 53)) * FORAGE_GRID;
      if (Math.hypot(px - x, pz - z) > radius) continue;
      const g = regionAt(px, pz);
      if (!g || !open.has(g.n) || !dry(w, px, pz, 0.8)) continue;
      const f = FORAGE[g.biome];
      out.push({ id: `${gx},${gz}`, kind: f.kind, name: f.name, x: px, z: pz, region: g.n });
    }
  return out;
}
/** Picks patch p at time `now` (seconds). False while it is still bare from the last picking. */
export function pick(p: Patch, picked: Map<string, number>, now: number): boolean {
  const at = picked.get(p.id);
  if (at !== undefined && now - at < REGROW) return false;
  picked.set(p.id, now);
  return true;
}
/** Whether patch p is bare at `now`. */
export const bare = (p: Patch, picked: ReadonlyMap<string, number>, now: number) => { const at = picked.get(p.id); return at !== undefined && now - at < REGROW; };

// --- birds ------------------------------------------------------------------------------------------------------------
// A roost per FLOCK_GRID-metre cell at FLOCK_CHANCE. The flock sits on the ground until you come within FLUSH_R, then
// lifts, flies FLIGHT metres the way it was facing (away from you), and settles there for its next roost.
export type Bird = "crows" | "gulls" | "sparrows" | "herons";
const BIRD_OF: Record<Biome, Bird> = {
  "pine-barrens": "crows", forest: "crows", rainforest: "crows", highlands: "crows", mountains: "crows",
  lake: "gulls", coast: "gulls", island: "gulls",
  swamp: "herons", river: "herons", jungle: "herons",
  plains: "sparrows", steppe: "sparrows", savanna: "sparrows", desert: "sparrows", tundra: "sparrows",
};
/** Birds in a flock, how long they stay up, how high they fly, and how big they are (wingspan, metres). */
export const BIRDS: Record<Bird, { n: [number, number]; air: number; high: number; span: number; colour: number }> = {
  crows: { n: [5, 11], air: 9, high: 16, span: 0.9, colour: 0x1a1a22 },
  gulls: { n: [6, 14], air: 11, high: 22, span: 1.2, colour: 0xf0f0f4 },
  sparrows: { n: [10, 18], air: 6, high: 8, span: 0.4, colour: 0x7a6a50 },
  herons: { n: [1, 3], air: 12, high: 12, span: 1.8, colour: 0x8a94a0 },
};
export const FLOCK_GRID = 110, FLOCK_CHANCE = 0.3, FLUSH_R = 20, FLIGHT = 110;
export interface Flock { id: string; kind: Bird; n: number; x: number; z: number; region: number; heading: number }

/** The roosts within `radius` of (x, z) on open ground; `moved` holds where a flock settled after it was last flushed. */
export function flocksNear(w: World, x: number, z: number, radius: number, open: ReadonlySet<number>, moved?: ReadonlyMap<string, { x: number; z: number }>): Flock[] {
  const out: Flock[] = [];
  for (let gz = Math.floor((z - radius - FLIGHT) / FLOCK_GRID); gz <= Math.floor((z + radius + FLIGHT) / FLOCK_GRID); gz++)
    for (let gx = Math.floor((x - radius - FLIGHT) / FLOCK_GRID); gx <= Math.floor((x + radius + FLIGHT) / FLOCK_GRID); gx++) {
      if (hash(gx, gz, 61) > FLOCK_CHANCE) continue;
      const id = `${gx},${gz}`, home = moved?.get(id), fx = home?.x ?? (gx + 0.15 + 0.7 * hash(gx, gz, 62)) * FLOCK_GRID, fz = home?.z ?? (gz + 0.15 + 0.7 * hash(gx, gz, 63)) * FLOCK_GRID;
      if (Math.hypot(fx - x, fz - z) > radius) continue;
      const g = regionAt(fx, fz);
      if (!g || !open.has(g.n) || !dry(w, fx, fz)) continue;
      const kind = BIRD_OF[g.biome], [lo, hi] = BIRDS[kind].n;
      out.push({ id, kind, n: lo + Math.floor(hash(gx, gz, 64) * (hi - lo + 1)), x: fx, z: fz, region: g.n, heading: hash(gx, gz, 65) * Math.PI * 2 });
    }
  return out;
}
/** Where a flock flushed at (x, z) by someone at `from` flies: straight away from them. */
export const flushHeading = (f: Pick<Flock, "x" | "z">, from: { x: number; z: number }) => Math.atan2(f.z - from.z, f.x - from.x);
/** Where a flock lands after flying `heading`. */
export const landing = (f: Pick<Flock, "x" | "z">, heading: number) => ({ x: f.x + Math.cos(heading) * FLIGHT, z: f.z + Math.sin(heading) * FLIGHT });
/**
 * Bird i of flock f, `since` seconds after it was flushed along `heading` (null: still roosting), relative to the
 * ground: metres from the roost, height above the ground, which way it faces, and how far through a wingbeat it is.
 * Past the flock's time in the air it has landed: `down` is true and it sits where `landing` says.
 */
export function birdAt(f: Flock, i: number, since: number | null, heading: number, t: number): { dx: number; dz: number; h: number; yaw: number; flap: number; down: boolean } {
  const b = BIRDS[f.kind], spread = 1.2 + 2.5 * hash(i, f.n, 66), ang = hash(i, f.n, 67) * Math.PI * 2;
  const ox = Math.cos(ang) * spread, oz = Math.sin(ang) * spread;
  if (since === null) return { dx: ox, dz: oz, h: 0, yaw: hash(i, f.n, 68) * Math.PI * 2, flap: 0, down: true };
  const u = clamp(since / b.air, 0, 1);
  if (u >= 1) return { dx: Math.cos(heading) * FLIGHT + ox, dz: Math.sin(heading) * FLIGHT + oz, h: 0, yaw: heading, flap: 0, down: true };
  // Each bird leaves a beat later than the last, climbs in an arc and glides down to the far roost.
  const lag = clamp(u * 1.3 - (i / f.n) * 0.3, 0, 1), along = lag * FLIGHT;
  const wobble = Math.sin(t * 3 + i) * 0.4;
  return {
    dx: Math.cos(heading) * along + ox * (1 + lag * 2), dz: Math.sin(heading) * along + oz * (1 + lag * 2),
    h: Math.sin(Math.PI * lag) * b.high * (0.7 + 0.3 * hash(i, f.n, 69)) + wobble,
    yaw: heading, flap: lag < 0.7 ? Math.sin(t * 14 + i * 1.7) : 0.2, down: false,
  };
}
