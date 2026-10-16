// The first level: an 80 m walled plaza with a kicker, a funbox, a rail and a gap.
import { makeLevel, piece } from "../level.ts";

export const HALF = 40;

// A ramp from world-space corners, as it was first written: rises along z from h0 to h1.
const ramp = (name: string, x0: number, x1: number, z0: number, z1: number, h0: number, h1: number) =>
  piece(h0 === h1 ? "box" : "ramp", name, (x0 + x1) / 2, (z0 + z1) / 2, 0, x1 - x0, z1 - z0, h0, h1);

export const plaza = makeLevel({
  name: "plaza",
  pieces: [
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
  ],
  rails: [{ kind: "rail", a: { x: -12, z: -10 }, b: { x: -12, z: 10 }, y: 0.9 }],
  spawns: [
    { name: "car", x: 27, z: -38, yaw: 0 },
    { name: "skate", x: -12, z: -20, yaw: 0 },
    { name: "showroom", x: 0, z: -20, yaw: 0 },
  ],
  bounds: { minX: -HALF, maxX: HALF, minZ: -HALF, maxZ: HALF },
});
