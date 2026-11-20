// The gear wall: the sesh's gear room (src/room/room.ts) standing in a corner of every Qollab Studio room, so you
// cable a pedal into the studio where you jam. The rack, the pedal wall and every box keep the gear room's own frame
// (the sesh's patch is one patch, src/studio.ts, whichever page moves it); a studio says where that frame stands
// (`def.gear`), and this file turns points between the two. The hands that work in it are gear-hands.ts.
// Pure and light (the frame's numbers only): the jam room's walking and the builder's checks read it.
import { GEAR_ROOM, type Bounds, PEDAL_WALL, RACK, shelvingRects } from "../room/frame.ts";
import type { GearPlace, StudioDef } from "./room.ts";
import type { Rect } from "./walk.ts";

/** Where the gear room's frame stands in a studio. Left out, the back left corner: the rack on the back wall, the pedal wall on the left. */
export const gearPlace = (def: StudioDef): GearPlace => def.gear ?? { at: [-def.size.w / 2 - GEAR_ROOM.x0, -def.size.d / 2 - GEAR_ROOM.z0], yaw: 0 };

/** A point in the gear room's frame to the studio's (as three.js turns a group by rotation.y). */
export function toStudio(g: GearPlace, x: number, z: number): [number, number] {
  const c = Math.cos(g.yaw), s = Math.sin(g.yaw);
  return [g.at[0] + x * c + z * s, g.at[1] - x * s + z * c];
}
/** A point in the studio to the gear room's frame. */
export function toGear(g: GearPlace, x: number, z: number): [number, number] {
  const dx = x - g.at[0], dz = z - g.at[1], c = Math.cos(g.yaw), s = Math.sin(g.yaw);
  return [dx * c - dz * s, dx * s + dz * c];
}

/** The rack and the pedal wall as the studio's floor has them: what you walk round. */
export function gearSolids(def: StudioDef): Rect[] {
  const g = gearPlace(def);
  return shelvingRects().map((r) => { const [cx, cz] = toStudio(g, r.cx, r.cz); return { ...r, cx, cz, turn: r.turn + g.yaw }; });
}

/** The studio's walls in the gear room's frame: where a box can be set down there. */
export function gearBounds(def: StudioDef): Bounds {
  const g = gearPlace(def), w = def.size.w / 2, d = def.size.d / 2;
  const corners = [[-w, -d], [w, -d], [w, d], [-w, d]].map(([x, z]) => toGear(g, x, z));
  const xs = corners.map((p) => p[0]), zs = corners.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
}

/**
 * The gear wall's footprint on the studio's floor: the rack and the pedal wall, and the strip in front of them where
 * the cab, the guitar and the patch bay start (startPatch) and you stand to reach the shelves. A studio's seats,
 * walls and furniture stay out of it (builder.ts `problems`).
 */
export const GEAR_FOOTPRINT: Bounds = { x0: PEDAL_WALL.x0, x1: RACK.x1 + 1, z0: RACK.z0, z1: PEDAL_WALL.z1 + 0.75 };
/** The footprint's corners on the studio's floor. */
export function footprint(def: StudioDef): [number, number][] {
  const g = gearPlace(def), f = GEAR_FOOTPRINT;
  return [[f.x0, f.z0], [f.x1, f.z0], [f.x1, f.z1], [f.x0, f.z1]].map(([x, z]) => toStudio(g, x, z));
}
/** Whether (x, z) on the studio's floor is within `pad` metres of the gear wall's footprint. */
export function inFootprint(def: StudioDef, x: number, z: number, pad = 0): boolean {
  const [lx, lz] = toGear(gearPlace(def), x, z), f = GEAR_FOOTPRINT;
  return lx > f.x0 - pad && lx < f.x1 + pad && lz > f.z0 - pad && lz < f.z1 + pad;
}
