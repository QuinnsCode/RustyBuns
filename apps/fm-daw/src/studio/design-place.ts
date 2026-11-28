// Where the Design desk stands in a studio (design-desk.ts draws it): the place nearest the door that is clear of the
// seats, the walls and the gear wall. Worked out from the room, so every room has one without naming it. Pure: no DOM.
import { inFootprint } from "./gear-wall.ts";
import { solids } from "./jam.ts";
import { thingBox, type StudioDef } from "./room.ts";
import type { Rect } from "./walk.ts";

export const DESK_W = 1.1, DESK_D = 0.75;
/** How close you stand to open it. */
export const DESK_REACH = 1.5;
export interface DeskPlace { x: number; z: number; yaw: number }

/** The distance from (x, z) to a solid's edge (0 inside it). */
function toRect(x: number, z: number, r: Rect): number {
  const c = Math.cos(r.turn), n = Math.sin(r.turn), dx = x - r.cx, dz = z - r.cz;
  return Math.hypot(Math.max(0, Math.abs(dx * c - dz * n) - r.hw), Math.max(0, Math.abs(dx * n + dz * c) - r.hd));
}

export function deskPlace(def: StudioDef): DeskPlace {
  const { w, d } = def.size, [dx, dz] = def.door.at, blocks = solids(def);
  const taken = def.spots.flatMap((s) => { const b = thingBox(s); return [s.at, [b.cx, b.cz] as [number, number]]; });
  const clear = (x: number, z: number, room: number) =>
    Math.abs(x) <= w / 2 - 0.6 && Math.abs(z) <= d / 2 - 0.6
    && taken.every(([sx, sz]) => Math.hypot(x - sx, z - sz) >= room)
    && blocks.every((r) => toRect(x, z, r) >= 0.65)
    && !inFootprint(def, x, z, 0.4)
    && Math.hypot(x - dx, z - dz) >= 1.2;
  // rings out from the door, so it's the first thing near where you come in; a crowded room accepts a tighter fit
  for (const room of [1.5, 1.15, 0.9]) {
    for (let r = 1.4; r < Math.max(w, d); r += 0.3) {
      for (let i = 0; i < 24; i++) {
        const a = def.door.yaw + Math.PI / 2 + (i / 24) * Math.PI * 2, x = dx - Math.sin(a) * r, z = dz - Math.cos(a) * r;
        // it faces back toward the door
        if (clear(x, z, room)) return { x, z, yaw: Math.atan2(dx - x, dz - z) };
      }
    }
  }
  return { x: dx, z: dz - 1.4, yaw: 0 };
}
