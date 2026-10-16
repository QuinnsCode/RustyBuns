// The levels: a piece of ground and a repo to fight through on it.
//   el-capitan  the real meadow under El Capitan, from Park Hide & Seek's heightmap, shrunk 8x
//   half-dome     the granite dome and its shoulders, the same way
//   glacier-point the rim 1,000 m above the valley, the same way
//   backyard      a plastic-army backyard: a sandbox, a raised deck, garden rows and a dug trench (stamps, Druids Curse style)
//   kitchen       the kitchen floor: table and chair legs to fight round, the sink cabinet a sheer plateau
//   garden        vegetable rows, a hose snaking across, and a pond standing in a crater (the water table)
// and placeLevel() makes one more from any lat/long (src/levels/place.ts reads the ground in the page).

import { heightmapTerrain, stampTerrain, zoneData, type Stamp, type Terrain, type ZoneData } from "@rustybuns/terrain";
import { COMPOUNDS, mapRepo, type RepoSnapshot } from "../sim/codemap.ts";
import rustybunsSnapshot from "./repos/rustybuns.json";

export interface LevelDef {
  id: string;
  name: string;
  blurb: string;
  ground: () => Terrain;
  repo: RepoSnapshot;
  seed: number;
}

/** Real ground is shrunk to a disc this wide (radius, metres in game): El Capitan's 1 km at one eighth. */
export const PLAY_RADIUS = 125;
const realGround = (zone: ZoneData) => () => heightmapTerrain(zone, zone.realRadius / PLAY_RADIUS);

/** Table and chair legs: little sheer-sided pillars, four to a piece of furniture. */
function legs(cx: number, cz: number, half: number, r: number, h: number): Stamp[] {
  return [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => ({ kind: "plateau" as const, x: cx + sx! * half, z: cz + sz! * half, r, h, falloff: 0.5 }));
}

// JSON infers links as plain arrays, not [a, b, n] tuples.
const rustybuns = rustybunsSnapshot as RepoSnapshot;

export const REPOS: Record<string, RepoSnapshot> = { rustybuns };

export const LEVELS: LevelDef[] = [
  {
    id: "el-capitan",
    name: "El Capitan",
    blurb: "Yosemite Valley's floor under the big wall. Real USGS ground, one eighth size.",
    ground: realGround(zoneData("el-capitan")),
    repo: rustybuns,
    seed: 7,
  },
  {
    id: "half-dome",
    name: "Half Dome",
    blurb: "The granite dome's sheer north face and the pine shoulders round it. Real USGS ground, one eighth size.",
    ground: realGround(zoneData("half-dome")),
    repo: rustybuns,
    seed: 11,
  },
  {
    id: "glacier-point",
    name: "Glacier Point",
    blurb: "The rim, a long way above the valley. Real USGS ground, one eighth size.",
    ground: realGround(zoneData("glacier-point")),
    repo: rustybuns,
    seed: 5,
  },
  {
    id: "backyard",
    name: "The Backyard",
    blurb: "Sandbox, deck, garden rows and a trench. Plastic-army backyard ground, built from stamps.",
    ground: () =>
      stampTerrain({
        R: 110,
        seed: 0x6a7,
        amp: 1.2,
        freq: 0.025,
        stamps: [
          // The sandbox: a sunken square-ish pit with a lip.
          { kind: "crater", x: -42, z: 30, r: 15, h: 1.4, falloff: 2 },
          { kind: "ridge", x1: -60, z1: 12, x2: -24, z2: 12, w: 0.6, h: 1.2, falloff: 0.8 },
          // The deck: a raised platform with a sheer edge.
          { kind: "plateau", x: 46, z: -42, r: 20, h: 3.2, falloff: 1.2 },
          // Garden rows.
          { kind: "ridge", x1: 10, z1: 40, x2: 70, z2: 40, w: 1, h: 1.1, falloff: 1.2 },
          { kind: "ridge", x1: 10, z1: 48, x2: 70, z2: 48, w: 1, h: 1.1, falloff: 1.2 },
          { kind: "ridge", x1: 10, z1: 56, x2: 70, z2: 56, w: 1, h: 1.1, falloff: 1.2 },
          // A trench across the middle, and the hill it was dug into.
          { kind: "plateau", x: -20, z: -35, r: 18, h: 6, falloff: 16 },
          { kind: "valley", x1: -70, z1: -5, x2: 30, z2: -12, w: 1.4, h: 1.8, falloff: 0.8 },
        ],
      }),
    repo: rustybuns,
    seed: 3,
  },
  {
    id: "kitchen",
    name: "The Kitchen Floor",
    blurb: "Table legs to hide behind, chairs pulled out, and the sink cabinet a cliff. Plastic-army ground, built from stamps.",
    ground: () =>
      stampTerrain({
        R: 110,
        seed: 0x41c,
        amp: 0.15,
        freq: 0.04,
        stamps: [
          // The sink cabinets along the north wall: a plateau too sheer to climb, its basin sunk in the top.
          { kind: "plateau", x: -20, z: -118, r: 24, h: 9, falloff: 1 },
          { kind: "plateau", x: 20, z: -118, r: 24, h: 9, falloff: 1 },
          { kind: "crater", x: 0, z: -102, r: 5, h: 2, falloff: 1 },
          // The table and its chairs, pulled out at all angles.
          ...legs(10, 5, 11, 1.6, 7),
          ...legs(-14, 8, 4.5, 1.2, 4),
          ...legs(34, 2, 4.5, 1.2, 4),
          ...legs(10, 30, 4.5, 1.2, 4),
          // A dropped dish towel rucked into folds.
          { kind: "ridge", x1: -60, z1: 40, x2: -40, z2: 52, w: 1.2, h: 0.9, falloff: 1.5 },
          { kind: "ridge", x1: -62, z1: 46, x2: -44, z2: 58, w: 1, h: 0.7, falloff: 1.5 },
          // The step down into the hall.
          { kind: "plateau", x: 90, z: 60, r: 26, h: 1.4, falloff: 0.6 },
        ],
      }),
    repo: rustybuns,
    seed: 9,
  },
  {
    id: "garden",
    name: "The Garden",
    blurb: "Vegetable rows, a hose across the lawn and a pond to wade. Plastic-army ground, built from stamps.",
    ground: () =>
      stampTerrain({
        R: 110,
        seed: 0x9a2,
        amp: 1,
        freq: 0.03,
        water: -1.2,
        stamps: [
          // Rows of vegetables, earthed up.
          ...[-62, -54, -46, -38].map((z): Stamp => ({ kind: "ridge", x1: -70, z1: z, x2: -10, z2: z, w: 0.9, h: 1.2, falloff: 1.2 })),
          // The pond: a crater the water table fills, shallow enough to wade.
          { kind: "crater", x: 40, z: 30, r: 9, h: 2.4, falloff: 6 },
          // The hose: a low ridge snaking across the lawn.
          { kind: "ridge", x1: -80, z1: 20, x2: -40, z2: 8, w: 0.4, h: 0.7, falloff: 0.5 },
          { kind: "ridge", x1: -40, z1: 8, x2: -10, z2: 30, w: 0.4, h: 0.7, falloff: 0.5 },
          { kind: "ridge", x1: -10, z1: 30, x2: 20, z2: 10, w: 0.4, h: 0.7, falloff: 0.5 },
          // A raised bed and the compost heap.
          { kind: "plateau", x: 50, z: -50, r: 12, h: 2, falloff: 0.8 },
          { kind: "plateau", x: -60, z: 70, r: 6, h: 4, falloff: 6 },
        ],
      }),
    repo: rustybuns,
    seed: 4,
  },
];

/**
 * A level from ground read round any lat/long (groundAt in place.ts), on this repo.
 * Nobody authored this ground, so it tries a few seeds and keeps the one that fits
 * the most compounds; throws if there's nowhere flat to fight (open sea is fine, a glacier may not be).
 */
export function placeLevel(zone: ZoneData): LevelDef {
  const ground = realGround(zone), t = ground();
  let seed = 1, most = -1;
  for (let s = 1; s <= 8 && most < COMPOUNDS; s++) {
    let n = -1;
    try {
      n = mapRepo(t, rustybuns, s).compounds.length;
    } catch {}
    if (n > most) seed = s, most = n;
  }
  if (most < 1) throw new Error(`nowhere flat enough to fight round ${zone.name}`);
  return {
    id: `place:${zone.id}`,
    name: zone.name,
    blurb: `Real ground from AWS Terrain Tiles, 1/${Math.round(zone.realRadius / PLAY_RADIUS)} size.`,
    ground,
    repo: rustybuns,
    seed,
  };
}
