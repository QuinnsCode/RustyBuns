// The gear room page's own room, as data: a warehouse bay round the gear corner (frame.ts's rack and pedal wall), a
// lounge in it, and where each thing stands. Pure, so room.ts walks round the same footprints lounge.ts draws.
// x runs left to right, z from the back wall (the rack's brick) toward the roller door, y up, all in metres.
import type { Rect } from "../studio/walk.ts";
import { HALF_D, type Bounds } from "./frame.ts";
import type { LoungeModel } from "./lounge-models.ts";

/** The bay: 12 m across, 9 m from the brick to the roller door. Its back wall is the rack's, so saved rooms stand where they did. */
export const BAY: Bounds = { x0: -6, x1: 6, z0: -HALF_D, z1: 6 };
/** The steel roof deck's underside; the trusses' bottom chords hang at TRUSS. */
export const ROOF = 4.6, TRUSS = 3.85;
/** Where the trusses span the bay (z), and the posts that hold them. */
export const TRUSSES = [-1.4, 1.6, 4.6];
export const POSTS: [number, number][] = [[-3.1, 1.6], [-3.1, 4.6]];

/** The pallet racking along the left wall: its bays (z ranges), depth and beam heights. */
export const RACKING = { x0: -6, x1: -4.95, bays: [[-2.4, 0.1], [0.1, 2.6], [2.6, 5.1]] as [number, number][], beams: [0.14, 1.45, 2.75] };

/** The lounge rug and the zone round it. */
export const RUG = { at: [3.95, 2.6] as [number, number], w: 3.3, d: 3.0 };

/** A model from LOUNGE_MODELS standing somewhere: `yaw` turns its front (+z) about y; `on` stands it on another's top. */
export interface Piece { model: LoungeModel; at: [number, number]; yaw: number; on?: number; y?: number; foot?: [number, number] }

/** Everything Poly Haven brings, where it stands. `foot` (w, d before the turn) is what you walk round. */
export const PIECES: Piece[] = [
  { model: "sofa_02", at: [5.38, 2.6], yaw: -Math.PI / 2, foot: [1.8, 0.85] },
  { model: "industrial_coffee_table", at: [4.15, 2.6], yaw: Math.PI / 2, foot: [0.8, 1.3] },
  { model: "mid_century_lounge_chair", at: [2.75, 1.65], yaw: 1.0, foot: [0.95, 0.95] },
  { model: "modern_arm_chair_01", at: [2.75, 3.6], yaw: 2.2, foot: [0.85, 0.9] },
  { model: "side_table_01", at: [5.45, 1.25], yaw: -Math.PI / 2, foot: [0.56, 0.46] },
  { model: "potted_plant_02", at: [5.45, 4.25], yaw: 0.6, foot: [0.6, 0.6] },
  { model: "potted_plant_04", at: [4.0, 2.35], yaw: 0, on: 1 },
  { model: "wooden_bookshelf_worn", at: [3.35, -2.68], yaw: 0, foot: [1.4, 0.6] },
  { model: "worn_metal_rack", at: [4.85, -2.68], yaw: 0, foot: [0.95, 0.6] },
  { model: "vintage_suitcase", at: [5.62, -1.55], yaw: -Math.PI / 2, foot: [0.3, 1.6] },
  { model: "wooden_crate_02", at: [-4.4, 5.35], yaw: 0, foot: [0.55, 1.2] },
  { model: "boombox", at: [-4.4, 5.35], yaw: 0.3, on: 10 },
  { model: "metal_stool_02", at: [-4.3, -1.0], yaw: 0, foot: [0.45, 0.45] },
  { model: "metal_stool_02", at: [3.05, 0.25], yaw: 0, foot: [0.45, 0.45] },
  { model: "plastic_crate_01", at: [5.0, -2.1], yaw: 0.2, foot: [0.32, 0.42] },
  { model: "plastic_crate_01", at: [5.0, -2.1], yaw: -0.15, on: 14 },
  { model: "cardboard_box_01", at: [4.2, 5.5], yaw: 0.4, foot: [0.45, 0.55] },
  { model: "potted_plant_02", at: [1.95, 5.45], yaw: 2.1, foot: [0.6, 0.6] },
  { model: "potted_plant_02", at: [-3.5, 5.5], yaw: -0.9, foot: [0.6, 0.6] },
  { model: "potted_plant_04", at: [3.0, -2.68], yaw: 0.4, on: 7 },
];

/** Factory pendants hung from the trusses (x, z): each a warm lamp. The first ones throw shadows on high. */
export const PENDANTS: [number, number][] = [[-0.1, 0.5], [4.0, 2.6], [-4.0, 1.2], [1.2, 4.6], [-2.2, -1.6]];
/** A floor lamp in the lounge's corner. */
export const FLOOR_LAMP: [number, number] = [5.5, 0.55];

/** Road cases of our own (w, h, d), standing on the floor (x, z) or on the racking's beams. */
export const CASES: { at: [number, number]; y?: number; size: [number, number, number]; yaw: number }[] = [
  { at: [-1.2, 5.35], size: [0.75, 0.62, 0.6], yaw: 0.05 },
  { at: [-1.2, 5.35], y: 0.62, size: [0.62, 0.5, 0.5], yaw: -0.1 },
  { at: [-2.15, 5.4], size: [1.2, 0.5, 0.55], yaw: 0 },
  { at: [-5.48, -1.6], y: 0.14, size: [0.9, 0.7, 0.7], yaw: Math.PI / 2 },
  { at: [-5.48, -0.6], y: 0.14, size: [0.8, 0.9, 0.7], yaw: Math.PI / 2 },
  { at: [-5.48, 1.0], y: 0.14, size: [1.2, 0.55, 0.75], yaw: Math.PI / 2 },
  { at: [-5.48, 2.0], y: 0.14, size: [0.6, 0.6, 0.6], yaw: Math.PI / 2 },
  { at: [-5.48, 3.5], y: 0.14, size: [1.4, 0.8, 0.8], yaw: Math.PI / 2 },
  { at: [-5.48, -1.3], y: 1.45, size: [1.1, 0.45, 0.6], yaw: Math.PI / 2 },
  { at: [-5.48, 4.4], y: 1.45, size: [0.7, 0.7, 0.7], yaw: Math.PI / 2 },
  { at: [-5.48, 0.9], y: 2.75, size: [0.9, 0.5, 0.6], yaw: Math.PI / 2 },
];
/** Cardboard boxes on the racking's upper beams (x, z, y, yaw). */
export const SHELF_BOXES: [number, number, number, number][] = [
  [-5.5, 0.4, 1.45, 0.1], [-5.45, 0.95, 1.45, -0.2], [-5.5, 1.5, 1.45, 1.6], [-5.5, 2.95, 1.45, 0.05], [-5.45, 3.5, 1.45, 0.3],
  [-5.5, -1.9, 2.75, 0], [-5.45, -1.35, 2.75, 0.25], [-5.5, 2.2, 2.75, -0.1], [-5.5, 3.3, 2.75, 1.5], [-5.45, 3.85, 2.75, 0], [-5.5, 4.5, 2.75, 0.2],
  [-5.5, 0.35, 0.14, 0.15], [-5.45, 4.7, 0.14, 0],
];

const turned = (cx: number, cz: number, [w, d]: [number, number], yaw: number): Rect => ({ cx, cz, hw: w / 2, hd: d / 2, turn: yaw });

/** What you walk round in the bay, besides the gear corner: the racking, the posts, the furniture and the cases on the floor. */
export const BAY_SOLIDS: Rect[] = [
  { cx: (RACKING.x0 + RACKING.x1) / 2, cz: (RACKING.bays[0]![0] + RACKING.bays[RACKING.bays.length - 1]![1]) / 2, hw: (RACKING.x1 - RACKING.x0) / 2, hd: (RACKING.bays[RACKING.bays.length - 1]![1] - RACKING.bays[0]![0]) / 2, turn: 0 },
  ...POSTS.map(([cx, cz]) => ({ cx, cz, hw: 0.12, hd: 0.12, turn: 0 })),
  ...PIECES.flatMap((p) => (p.foot && p.on === undefined ? [turned(p.at[0], p.at[1], p.foot, p.yaw)] : [])),
  ...CASES.filter((c) => !c.y).map((c) => turned(c.at[0], c.at[1], [c.size[0], c.size[2]], c.yaw)),
];
