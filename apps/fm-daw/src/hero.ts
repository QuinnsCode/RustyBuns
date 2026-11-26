// The front door's hero (#6019): a field at dusk, two stacks at its head, and the coverage map of their highs on the
// grass, over the night's air and (when asked) a bank across the field. It is @rustybuns/gear's own model, the one the
// Event Planner's outdoor map uses (field.ts: ISO 9613-1 air, ISO 9613-2 ground, a bank as a thin screen), worked at
// one band you can hear go: the highs, 4 kHz, where the air takes the most. The colours are against one fixed level
// (the middle of the field on the starting night), so a dry cold evening darkens the back of the field. Pure: the page is
// src/front-hero.ts.
import { banks, source, speedOfSound, splAt, sumPower, type Bank, type Field, type Grid, type Source } from "@rustybuns/gear";

/** What you change on the hero: the air (C, % relative humidity) and whether a bank runs across the field. */
export type HeroAir = { tempC: number; humidity: number; bank: boolean };
/** A mild late-summer evening on grass. */
export const HERO_START: HeroAir = { tempC: 18, humidity: 60, bank: false };
/** The sliders' ends, as the Event Planner's own (builder.ts TEMP_C, HUMIDITY). */
export const TEMP_RANGE = [-10, 40] as const, HUMIDITY_RANGE = [10, 100] as const;

/** The field: x across, z away from the stacks (they stand at z = 0 and face +z), metres. */
export const FIELD = { x0: -26, x1: 26, z0: 0, z1: 52 } as const;
/** Metres a cell of the map. */
export const CELL = 1;
/** Ear height, metres. */
export const EAR_Y = 1.6;
/** The band the map and the back seat's highs are worked at, Hz. */
export const HI_HZ = 4000;
/** The two stacks: where each stands and its yaw (0 faces +z, positive turns toward +x), toed in a little. */
export const STACKS = [{ x: -7, z: 0, yaw: 0.12 }, { x: 7, z: 0, yaw: -0.12 }] as const;
/** The bank, when it is up: a crest across the field, halfway down, 2.4 m high. */
export const BANK: Bank = { at: [0, 24], yaw: 0, len: 34, h: 2.4 };
/** Where "from the back" is. */
export const BACK = { x: 0, z: 48 } as const;
/** The bands the back seat is heard in, Hz (the page's EQ). */
export const BANDS = [250, 500, 1000, 2000, 4000, 8000] as const;

/** Each stack as two mid-high horn boxes, one on the other (@rustybuns/gear's catalog). */
export const heroSources = (): Source[] =>
  STACKS.flatMap((s) => [1.6, 2.5].map((y) => source("stack-mid-high", { x: s.x, y, z: s.z }, { yaw: s.yaw })));

/** The field the sound crosses: the air given, grass under the crowd, and the bank if it is up. */
export const heroField = (a: HeroAir): Field => ({ tempC: a.tempC, humidity: a.humidity, ground: "grass", terrain: a.bank ? banks([BANK]) : undefined });

/** The level at (x, z) at `hz`, dB SPL: every box summed as power, over the field. */
export const heroLevel = (src: readonly Source[], f: Field, x: number, z: number, hz = HI_HZ) =>
  sumPower(src.map((s) => splAt(s, { x, y: EAR_Y, z }, f, hz)));

const REF_AT = { x: 0, z: (FIELD.z0 + FIELD.z1) / 2 } as const;
/** The map's fixed reference at each band: the middle of the field, on the starting night (the Event Planner's map is against its floor's middle too). */
const refAt = (hz: number) => heroLevel(heroSources(), heroField(HERO_START), REF_AT.x, REF_AT.z, hz);

/** The map: the highs over the whole field, a cell a metre, row by row along z. */
export function heroMap(a: HeroAir): Grid & { ref: number } {
  const src = heroSources(), f = heroField(a), nx = (FIELD.x1 - FIELD.x0) / CELL, nz = (FIELD.z1 - FIELD.z0) / CELL;
  const db = new Float32Array(nx * nz);
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) db[iz * nx + ix] = heroLevel(src, f, FIELD.x0 + (ix + 0.5) * CELL, FIELD.z0 + (iz + 0.5) * CELL);
  return { ...FIELD, y: EAR_Y, nx, nz, db, ref: refAt(HI_HZ) };
}

/** The map in a few numbers: dB under the reference, the mean over the near half and over the far half of the field. */
export function mapSummary(m: Grid & { ref: number }): { near: number; far: number } {
  let near = 0, far = 0, n = 0, k = 0;
  for (let iz = 0; iz < m.nz; iz++) for (let ix = 0; ix < m.nx; ix++) {
    const down = m.ref - m.db[iz * m.nx + ix]!;
    if (iz < m.nz / 2) { near += down; n++; } else { far += down; k++; }
  }
  return { near: +(near / n).toFixed(2), far: +(far / k).toFixed(2) };
}

/** The back of the field as you'd hear it: how far each band is down against the reference spot, dB, how much more the
 *  highs lost than the low mids (4 kHz against 500 Hz), and when the near stack's sound lands, ms. */
export function backSeat(a: HeroAir): { down: number[]; dull: number; ms: number } {
  const src = heroSources(), f = heroField(a);
  const down = BANDS.map((hz) => +(refAt(hz) - heroLevel(src, f, BACK.x, BACK.z, hz)).toFixed(2));
  const near = Math.min(...STACKS.map((s) => Math.hypot(BACK.x - s.x, BACK.z - s.z)));
  return { down, dull: +(down[BANDS.indexOf(4000)]! - down[BANDS.indexOf(500)]!).toFixed(2), ms: Math.round((near / speedOfSound(a.tempC)) * 1000) };
}
