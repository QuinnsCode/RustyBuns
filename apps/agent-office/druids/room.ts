// The office's layout, from Agent Office's shared/layout.js (v0.1.206): the room, and what's on its walls,
// which the jungle grows around. North is -z (the boards), south +z (the balcony), west -x, east +x (the TV).

export const ROOM = { minX: -18, maxX: 18, minZ: -13, maxZ: 13, top: 6.8 };
/** The loft (boss office over the meeting room) in the south-east corner: 3 m to its floor. */
export const LOFT = { minX: 9, minZ: 8 };
export const STREET_Y = -3.6;
export const ROAD = { minZ: 22, maxZ: 32 };

export type Wall = "north" | "south" | "east" | "west";
/** An office collider. `fence` marks a board agent's kiosk (and the agent behind it). */
export type Box = { minX: number; maxX: number; minZ: number; maxZ: number; bottom: number; top: number; fence?: boolean };
/** Whether (x, z) is within `pad` of a board agent's kiosk, where nothing tall may hide the agent. */
export const byKiosk = (colliders: Box[], x: number, z: number, pad = 1.2) =>
  colliders.some((c) => c.fence && x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad);
/** How tall the office's desks are (DESK_SIZE.height): each agent desk is a collider this tall. */
export const DESK_TOP = 0.78;

/**
 * Clip every desk collider (a box DESK_TOP tall, not a fence) whose middle is under a panel down to that panel's
 * footprint, and as tall as it. Clipped ones are `top` tall, so running this again leaves them be: the back
 * office's desks only push their colliders once their row is built, so this runs now and then.
 */
export function fitDesks(colliders: Box[], panels: { minX: number; maxX: number; minZ: number; maxZ: number }[], top: number) {
  for (const c of colliders) {
    if (c.fence || Math.abs(c.top - DESK_TOP) > 0.01) continue;
    const x = (c.minX + c.maxX) / 2, z = (c.minZ + c.maxZ) / 2;
    const p = panels.find((p) => x > p.minX && x < p.maxX && z > p.minZ && z < p.maxZ);
    if (!p) continue;
    c.minX = Math.max(c.minX, p.minX);
    c.maxX = Math.min(c.maxX, p.maxX);
    c.minZ = Math.max(c.minZ, p.minZ);
    c.maxZ = Math.min(c.maxZ, p.maxZ);
    c.top = top;
  }
}

/**
 * A board agent's kiosk keeps its own fence collider, from the wall to just in front of the kiosk, but its panel
 * stands 0.4 m further into the room and 0.2 m wider either side: give the panel's footprint a collider of its own,
 * `top` tall, once (the same footprint twice, as when the office rebuilds, adds nothing).
 */
export function fenceKiosk(colliders: Box[], panel: { minX: number; maxX: number; minZ: number; maxZ: number }, top: number) {
  const same = (c: Box) => c.minX === panel.minX && c.maxX === panel.maxX && c.minZ === panel.minZ && c.maxZ === panel.maxZ;
  if (!colliders.some(same)) colliders.push({ ...panel, bottom: 0, top });
}

/** Something on a wall: `u` is its centre along the wall (x on north/south, z on east/west). */
export type Feature = { name: string; wall: Wall; u: number; width: number; y0: number; y1: number };

const window = (wall: Wall, u: number, width = 3, y0 = 1.1, y1 = 3.3): Feature => ({ name: "window", wall, u, width, y0, y1 });

export const FEATURES: Feature[] = [
  { name: "issues", wall: "north", u: -11.7, width: 6, y0: 0.6, y1: 3.6 },
  { name: "queue", wall: "north", u: -3.9, width: 6, y0: 0.6, y1: 3.6 },
  { name: "pulls", wall: "north", u: 3.9, width: 6, y0: 0.6, y1: 3.6 },
  { name: "elevator", wall: "north", u: 8.5, width: 2.8, y0: 0, y1: 6.8 },
  { name: "gong", wall: "north", u: 11.8, width: 1.9, y0: 0, y1: 2.45 },
  { name: "services", wall: "east", u: -8.2, width: 6, y0: 0.6, y1: 3.6 },
  { name: "tv", wall: "east", u: 0, width: 6.4, y0: 0.4, y1: 4 },
  { name: "jukebox", wall: "east", u: 5.4, width: 1.3, y0: 0, y1: 1.85 },
  { name: "cabinet", wall: "east", u: 7.05, width: 0.8, y0: 0, y1: 1.9 },
  { name: "machine", wall: "west", u: -6, width: 2.3, y0: 1.55, y1: 2.85 },
  ...[-9, -3, 3].map((u) => window("west", u)),
  { name: "exit door", wall: "west", u: 6.5, width: 1.4, y0: 0, y1: 2.4 },
  ...[-14, -9, 1].map((u) => window("south", u)),
  { name: "balcony door", wall: "south", u: -4, width: 3, y0: 0, y1: 2.5 },
  { name: "bookshelf", wall: "south", u: -6.5, width: 1.7, y0: 0, y1: 2.3 },
  window("south", 11, 2.8, 3.9, 5.5),
  window("east", 10.5, 2.8, 3.9, 5.5),
];
