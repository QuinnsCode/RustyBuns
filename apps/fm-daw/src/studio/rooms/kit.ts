// What a stock room's file writes its seats and surfaces with, so a new room is just its numbers.
import { newSpot } from "../builder.ts";
import type { Spot, SpotKind } from "../room.ts";
import { MATERIALS, type Material } from "../sound.ts";

/** The same material on all four outside walls. */
export const all = (m: Material) => ({ front: m, back: m, left: m, right: m });
/** A room drawn in what it is made of. */
export const colors = (floor: Material, walls: Material, ceiling: Material) => ({ floor: MATERIALS[floor].color, walls: MATERIALS[walls].color, ceiling: MATERIALS[ceiling].color, trim: "#c8a46a" });
/** A seat: a kind's instrument, with its own label, facing `yaw`, playing `track` when given. */
export const seat = (id: string, kind: SpotKind, at: [number, number], yaw: number, label?: string, track?: string): Spot =>
  ({ ...newSpot(id, kind, at), yaw, ...(label ? { label } : {}), ...(track ? { track } : {}) });
