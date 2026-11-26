// What lies between a speaker and an ear out of doors: the air (its temperature and humidity), the ground under the
// crowd and the lie of the land. `fieldLoss` is the one number sound.ts takes off a level when a coverage map, a level
// or a delay is worked out over a field, so the builder's map, the Walk-in sound and the delay marks agree. No wave
// solver: ISO 9613-1 for the air, ISO 9613-2's octave-band ground method, and a bank or hill as a thin screen.
import type { Vec3 } from "./sound.ts";

/** Sea-level standard pressure, kPa (ISO 2533). */
export const SEA_LEVEL_KPA = 101.325;

/** Air pressure at an altitude, kPa: the barometric formula with an 8.4 km scale height (air at about 15 C). At 1,950 m
 * that is about 80 kPa, a fifth thinner than at the sea. */
export function pressureAt(altitudeM: number): number {
  return SEA_LEVEL_KPA * Math.exp(-altitudeM / 8434);
}

/** The speed of sound in dry air at a temperature, m/s: 331.3 √(1 + T / 273.15). It hangs on temperature alone, not on
 * pressure, so thin air at altitude carries sound no faster; a warm afternoon (30 C, 349 m/s) against a cool night
 * (12 C, 338 m/s) moves a 100 m delay by about 9 ms. */
export function speedOfSound(tempC: number): number {
  return 331.3 * Math.sqrt(1 + tempC / 273.15);
}

/**
 * Air absorption, dB per metre, at `freq` Hz (ISO 9613-1:1993, the full formula: oxygen and nitrogen relaxation and the
 * classical loss). Dry air takes the highs harder: at 8 kHz and 20 C, 50% humidity is about 0.11 dB/m and 15% about
 * 0.24 dB/m, so 100 m of dry air takes 20 dB or more off the top octave. Thinner air at altitude shifts the
 * relaxation peaks down and takes a little more again.
 */
export function airAbsorption(freq: number, tempC: number, humidity: number, kPa = SEA_LEVEL_KPA): number {
  const T = tempC + 273.15, T0 = 293.15, T01 = 273.16, pr = kPa / SEA_LEVEL_KPA;
  // Molar concentration of water vapour, percent, from the relative humidity and the saturation pressure.
  const psat = 10 ** (-6.8346 * (T01 / T) ** 1.261 + 4.6151);
  const h = (humidity * psat) / pr;
  const frO = pr * (24 + (4.04e4 * h * (0.02 + h)) / (0.391 + h));
  const frN = pr * (T / T0) ** -0.5 * (9 + 280 * h * Math.exp(-4.17 * ((T / T0) ** (-1 / 3) - 1)));
  const f2 = freq * freq;
  return 8.686 * f2 * (1.84e-11 / pr * (T / T0) ** 0.5
    + (T / T0) ** -2.5 * ((0.01275 * Math.exp(-2239.1 / T)) / (frO + f2 / frO) + (0.1068 * Math.exp(-3352 / T)) / (frN + f2 / frN)));
}

/** A barrier between the source and the listener (a rock behind the stage): Maekawa's chart, 10 log10(3 + 20 N) dB
 * with N the Fresnel number, 2 × the extra path over the top / wavelength. Bass bends round it; the highs don't. */
export function barrierLoss(extraPath: number, freq: number, c = 343): number {
  const n = (2 * extraPath * freq) / c;
  return Math.min(20, 10 * Math.log10(3 + 20 * Math.max(0, n)));
}

/** What the crowd stands on. */
export const GROUNDS = ["grass", "soil", "tarmac", "water"] as const;
export type Ground = (typeof GROUNDS)[number];

/** ISO 9613-2's ground factor G for each: 1 porous (grass, farmland), 0 hard (paving, water, ice), between for mixed.
 *  A field's soil after a day of feet is trodden hard in places: 0.5. */
export const GROUND_FACTOR: Record<Ground, number> = { grass: 1, soil: 0.5, tarmac: 0, water: 0 };

/**
 * The ground effect, dB, at one frequency, by ISO 9613-2's octave-band method (its table 3): a source region 30 × its
 * height out from the speaker, a receiver region 30 × the ear's height back from the listener, a middle between, each
 * term from the ground factor `g` (one surface under the whole field). Negative is a gain: hard ground hands back up
 * to 3 dB; porous ground takes a dip round 250 to 500 Hz near the ground, and leaves the top octaves alone.
 */
export function groundLoss(g: number, hs: number, hr: number, dp: number, freq: number): number {
  const region = (h: number) => {
    const k = 1 - Math.exp(-dp / 50);
    if (freq < 90) return -1.5;
    if (freq < 177) return -1.5 + g * (1.5 + 3 * Math.exp(-0.12 * (h - 5) ** 2) * k + 5.7 * Math.exp(-0.09 * h * h) * (1 - Math.exp(-2.8e-6 * dp * dp)));
    if (freq < 354) return -1.5 + g * (1.5 + 8.6 * Math.exp(-0.09 * h * h) * k);
    if (freq < 707) return -1.5 + g * (1.5 + 14 * Math.exp(-0.46 * h * h) * k);
    if (freq < 1414) return -1.5 + g * (1.5 + 5 * Math.exp(-0.9 * h * h) * k);
    return -1.5 * (1 - g);
  };
  const q = dp <= 30 * (hs + hr) ? 0 : 1 - (30 * (hs + hr)) / dp;
  return region(hs) + region(hr) - 3 * q * (freq < 90 ? 1 : 1 - g);
}

/** The lie of the land: the ground's height at (x, z), metres above the flat floor. */
export type Terrain = (x: number, z: number) => number;

/** A bank (a berm, a hump, a fold of the hill) across the field: its crest through `at`, `len` metres long, turned
 *  `yaw` as a speaker is (its faces look along yaw's +z and back), `h` metres high, its foot `width` across (4 h, at
 *  least 2 m, when left out). Smooth: a cosine bump across, tapering off at the ends. */
export type Bank = { at: [number, number]; yaw: number; len: number; h: number; width?: number };

/** Banks as a height map: the highest of them where they cross. */
export function banks(list: readonly Bank[]): Terrain {
  const parts = list.map((b) => ({ ...b, w: b.width ?? Math.max(2, 4 * b.h), c: Math.cos(b.yaw), s: Math.sin(b.yaw) }));
  return (x, z) => {
    let top = 0;
    for (const b of parts) {
      const dx = x - b.at[0], dz = z - b.at[1];
      const across = dx * b.s + dz * b.c, along = Math.abs(dx * b.c - dz * b.s) - b.len / 2;
      const r = Math.hypot(across, Math.max(0, along));
      if (r < b.w / 2) top = Math.max(top, b.h * Math.cos((Math.PI * r) / b.w) ** 2);
    }
    return top;
  };
}

/** How much further sound has to go over the land between `a` and `b` (both at their heights above the flat floor
 *  plus the land under them) than straight, metres: 0 when they see each other. The worst crest along the way. */
export function screenPath(t: Terrain, a: Vec3, b: Vec3): number {
  const dp = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(4, Math.min(200, Math.ceil(dp / 0.5))), d = Math.hypot(dp, b.y - a.y);
  let over = 0;
  for (let i = 1; i < n; i++) {
    const u = i / n, x = a.x + (b.x - a.x) * u, z = a.z + (b.z - a.z) * u, top = t(x, z);
    if (top <= a.y + (b.y - a.y) * u) continue;
    const s = u * dp;
    over = Math.max(over, Math.hypot(s, top - a.y) + Math.hypot(dp - s, b.y - top) - d);
  }
  return over;
}

/** The field the sound crosses: the air's temperature (C) and relative humidity (%), the ground under the crowd, the
 *  land's heights (flat when left out), and the air's pressure (sea level when left out). */
export type Field = { tempC: number; humidity: number; ground: Ground; terrain?: Terrain; kPa?: number };

/** A mild evening on trodden soil: what a field is when nobody said. */
export const MILD_FIELD: Field = { tempC: 20, humidity: 50, ground: "soil" };

/** The octaves a "high" level (mids and highs) is the power mean of. */
export const HIGH_BANDS = [500, 1000, 2000, 4000, 8000] as const;

/**
 * dB lost on the way from `a` to `b` over `field`, both already standing on the land (y the height above the flat
 * floor, land included): the air's absorption over the distance, then the ground effect, or a bank in the way where
 * one is, whichever takes more (ISO 9613-2: a screen replaces the ground term). At one frequency, or with none the
 * power mean over HIGH_BANDS: what a mids-and-highs level is down by.
 */
export function fieldLoss(a: Vec3, b: Vec3, field: Field, freq?: number): number {
  const dp = Math.hypot(b.x - a.x, b.z - a.z), d = Math.hypot(dp, b.y - a.y), t = field.terrain;
  const hs = Math.max(0, a.y - (t ? t(a.x, a.z) : 0)), hr = Math.max(0, b.y - (t ? t(b.x, b.z) : 0));
  const over = t ? screenPath(t, a, b) : 0, g = GROUND_FACTOR[field.ground], c = speedOfSound(field.tempC);
  const at = (hz: number) => airAbsorption(hz, field.tempC, field.humidity, field.kPa) * d + Math.max(groundLoss(g, hs, hr, dp, hz), over > 0 ? barrierLoss(over, hz, c) : -Infinity);
  if (freq !== undefined) return at(freq);
  let p = 0;
  for (const hz of HIGH_BANDS) p += 10 ** (-at(hz) / 10);
  return -10 * Math.log10(p / HIGH_BANDS.length);
}

/** A point stood on the land: its height above the flat floor plus the land's under it. */
export const onLand = (p: Vec3, t: Terrain | undefined): Vec3 => (t ? { x: p.x, y: p.y + t(p.x, p.z), z: p.z } : p);
