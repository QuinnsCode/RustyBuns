// The levels: a piece of ground and a repo to fight through on it.
//   el-capitan  the real meadow under El Capitan, from Park Hide & Seek's heightmap, shrunk 8x
//   backyard    a plastic-army backyard: a sandbox, a raised deck, garden rows and a dug trench (stamps, Druids Curse style)

import { heightmapTerrain, stampTerrain, type Terrain, type ZoneData } from "../sim/terrain.ts";
import type { RepoSnapshot } from "../sim/codemap.ts";
import elCapitan from "./data/el-capitan.json";
import rustybuns from "./repos/rustybuns.json";

export interface LevelDef {
  id: string;
  name: string;
  blurb: string;
  ground: () => Terrain;
  repo: RepoSnapshot;
  seed: number;
}

export const REPOS: Record<string, RepoSnapshot> = { rustybuns };

export const LEVELS: LevelDef[] = [
  {
    id: "el-capitan",
    name: "El Capitan",
    blurb: "Yosemite Valley's floor under the big wall. Real USGS ground, one eighth size.",
    ground: () => heightmapTerrain(elCapitan as unknown as ZoneData, 8),
    repo: rustybuns,
    seed: 7,
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
];
