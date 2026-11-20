// What a stock room's file writes its seats and surfaces with, so a new room is just its numbers.
import { newSpot } from "../builder.ts";
import type { Side, Spot, SpotKind, StudioDef } from "../room.ts";
import { MATERIALS, type Material } from "../sound.ts";

/** The same material on all four outside walls. */
export const all = (m: Material) => ({ front: m, back: m, left: m, right: m });
/** A room drawn in what it is made of. */
export const colors = (floor: Material, walls: Material, ceiling: Material) => ({ floor: MATERIALS[floor].color, walls: MATERIALS[walls].color, ceiling: MATERIALS[ceiling].color, trim: "#c8a46a" });
/** A seat: a kind's instrument, with its own label, facing `yaw`, playing `track` when given. */
export const seat = (id: string, kind: SpotKind, at: [number, number], yaw: number, label?: string, track?: string): Spot =>
  ({ ...newSpot(id, kind, at), yaw, ...(label ? { label } : {}), ...(track ? { track } : {}) });
/** Which way everything in a room moves (x, z, per metre grown) when it grows past one wall: the room stays centred. */
const SHIFT: Record<Side, [number, number]> = { front: [0, -0.5], back: [0, 0.5], left: [0.5, 0], right: [-0.5, 0] };
/**
 * The room `m` metres bigger out past one wall, everything in it staying where it stood against the other three: room
 * for its gear wall in a room that was full wall to wall.
 */
export function grow(def: StudioDef, side: Side, m: number): StudioDef {
  const [sx, sz] = SHIFT[side], wide = side === "left" || side === "right";
  // what stands against the wall that moves goes out with it (shelves, pictures, a desk pushed to it); the rest stays
  const edge = wide ? def.size.w / 2 : def.size.d / 2, out = (p: [number, number]) => edge - (wide ? -sx : -sz) * 2 * (wide ? p[0] : p[1]) < 0.7;
  const mv = (p: [number, number]): [number, number] => { const k = out(p) ? -1 : 1; return [p[0] + k * sx * m, p[1] + k * sz * m]; };
  return {
    ...def,
    size: { ...def.size, w: def.size.w + (wide ? m : 0), d: def.size.d + (wide ? 0 : m) },
    walls: def.walls.map((w) => ({ ...w, from: mv(w.from), to: mv(w.to) })),
    spots: def.spots.map((s) => ({ ...s, at: mv(s.at) })),
    door: { ...def.door, at: mv(def.door.at) },
    props: def.props?.map((p) => ({ ...p, at: mv(p.at) })),
  };
}
