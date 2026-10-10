// Every Druids Curse model the office uses, as paths under the game's /non_repo/models/ (and the office's
// /druids/models/). rustybunsify.ts downloads exactly these; nothing from the game is committed here.
import { CAST } from "./cast.ts";

const range = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}_${i + 1}`);

/** The forest, by what forest.ts does with it. */
export const FOREST = {
  /** the wood outside the windows */
  wood: [...range("trees/MapleTree", 3), ...range("trees/BirchTree", 3), "trees/Willow_1", "set_piece/megaflora_shromTree001_1024"],
  /** knee-high and under, scattered over the free floor */
  ground: [
    "ground/Grass_Large", "ground/Grass_Small", "ground/Flower_1_Clump", "ground/Flower_5_Clump",
    "ground/Bush_Flowers", "clutter/flora_bioshrom001_256", "clutter/flora_trumpetshrom001_256", "props/Rock_Moss_1",
  ],
  /** against the walls */
  edge: ["props/TreeStump_Moss", "props/WoodLog_Moss", "props/Rock_Moss_2", "props/Rock_Moss_3"],
  /** the council fire, in the biggest clearing */
  hearth: "landmark/structure_HengeHearth001_1024",
  /** a beacon outside, seen through the windows */
  beacon: "landmark/structure_DruidCouncilBeacon001_1024",
};

/** The council's furniture and loot (council.ts). */
export const COUNCIL = {
  panel: "landmark/interact_DruidPanel001_512",
  staff: "props/DruidStaff001",
  chambers: "landmark/structure_DruidCouncilChambers001_1024",
  hut: "landmark/structure_HumanHut001_1024",
  loot: {
    small: [
      "items/item_voidshard001_256", "items/item_voidshard002_256", "items/item_voidwolfTail001_256",
      "items/item_bonefall001_256", "props/DruidFocus001", "clutter/flora_pinshrom001_256", "clutter/flora_cacshrom001_256",
    ],
    big: ["items/item_voidwolfPelt001_256", "items/item_bonefall001_256", "clutter/flora_ichorshrom001_256", "clutter/environ_groundLeaf001_256"],
  },
};

export const MODELS: string[] = [...new Set([
  ...Object.values(CAST).map((c) => c.file),
  ...FOREST.wood, ...FOREST.ground, ...FOREST.edge, FOREST.hearth, FOREST.beacon,
  COUNCIL.panel, COUNCIL.staff, COUNCIL.chambers, COUNCIL.hut, ...COUNCIL.loot.small, ...COUNCIL.loot.big,
])];

export const modelUrl = (path: string) => `/druids/models/${path}.glb`;
