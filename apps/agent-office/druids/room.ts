// The office's layout, from Agent Office's shared/layout.js (v0.1.206): the room, and what's on its walls,
// which the jungle grows around. North is -z (the boards), south +z (the balcony), west -x, east +x (the TV).

export const ROOM = { minX: -18, maxX: 18, minZ: -13, maxZ: 13, top: 6.8 };
/** The loft (boss office over the meeting room) in the south-east corner: 3 m to its floor. */
export const LOFT = { minX: 9, minZ: 8 };
export const STREET_Y = -3.6;
export const ROAD = { minZ: 22, maxZ: 32 };

export type Wall = "north" | "south" | "east" | "west";
export type Box = { minX: number; maxX: number; minZ: number; maxZ: number; bottom: number; top: number };
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
