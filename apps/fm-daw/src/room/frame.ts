// The gear room's frame, light enough for any page: its walls, the rack on its back wall and the pedal wall on its
// left, in metres. room.ts walks and reaches in it; a studio's gear wall (../studio/gear-wall.ts) stands it in a corner.
import type { Rect } from "../studio/walk.ts";

/** The live room: x from -HALF_W to HALF_W, z from -HALF_D (the back wall, with the rack) to HALF_D. */
export const HALF_W = 3.5, HALF_D = 3, WALL_H = 2.8;
/** The wall rack: a frame against the back wall, its shelves' tops in metres. */
export const RACK = { x0: -1.3, x1: 1.3, z0: -HALF_D, z1: -HALF_D + 0.45, shelves: [0.45, 0.95, 1.45] };
/**
 * The pedal wall: a pegboard standing out from the rack's left end, ledges facing in, where the pedals and Q Split
 * hang until you take one down. Rack and board make one corner, small enough to stand in any studio (#5393).
 */
export const PEDAL_WALL = { x0: -1.6, x1: -1.35, z0: -2.45, z1: -0.65, shelves: [1.0, 1.4] };
/** Everything with shelves: what blocks your walk and what a box set down can land on. */
export const SHELVING = [RACK, PEDAL_WALL];
/** The rack and the pedal wall as boxes on the floor, in the gear room's frame: what you walk round. */
export const shelvingRects = (): Rect[] => SHELVING.map((s) => ({ cx: (s.x0 + s.x1) / 2, cz: (s.z0 + s.z1) / 2, hw: (s.x1 - s.x0) / 2, hd: (s.z1 - s.z0) / 2, turn: 0 }));
/** Where a box may be set down: the gear room's walls, or (its gear wall in a studio) the studio's. */
export interface Bounds { x0: number; x1: number; z0: number; z1: number }
export const GEAR_ROOM: Bounds = { x0: -HALF_W, x1: HALF_W, z0: -HALF_D, z1: HALF_D };
