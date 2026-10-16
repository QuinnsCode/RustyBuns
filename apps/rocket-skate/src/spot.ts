// The skate spot as data: the sim reads its heights and the view builds its meshes from the same
// list, so what you see is what you ride. Every ramp rises along z; a box is a flat top.

export type Ramp = { kind: "ramp"; x0: number; x1: number; z0: number; z1: number; h0: number; h1: number; name: string };
export type Rail = { x: number; z0: number; z1: number; y: number };

const ramp = (name: string, x0: number, x1: number, z0: number, z1: number, h0: number, h1: number): Ramp =>
  ({ kind: "ramp", name, x0, x1, z0, z1, h0, h1 });

export const HALF = 40; // the plaza is 80 m across, walled in

export const RAMPS: Ramp[] = [
  // A kicker in the middle of the plaza.
  ramp("kicker", -3, 3, 8, 13, 0, 1.5),
  // A funbox: up, a flat top, down.
  ramp("funbox up", 10, 18, -6, -3, 0, 0.6),
  ramp("funbox", 10, 18, -3, 3, 0.6, 0.6),
  ramp("funbox down", 10, 18, 3, 6, 0.6, 0),
  // The gap: a 4 m kicker, 12 m of nothing, and a landing that runs back down to the floor.
  // Too far to push across on a board; the roadster's rear thrusters clear it.
  ramp("gap kicker", 22, 32, -28, -14, 0, 4),
  ramp("gap landing", 22, 32, -2, 14, 3, 0),
];

export const RAILS: Rail[] = [{ x: -12, z0: -10, z1: 10, y: 0.9 }];

/** The floor's height under (x, z): the highest ramp there, or 0. */
export function groundAt(x: number, z: number): number {
  let h = 0;
  for (const r of RAMPS) {
    if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) continue;
    h = Math.max(h, r.h0 + ((z - r.z0) / (r.z1 - r.z0)) * (r.h1 - r.h0));
  }
  return h;
}
