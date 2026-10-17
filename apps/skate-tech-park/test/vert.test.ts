// Vert, the way a rider reads it: a board thrown off a wall comes back down onto it, and a board that tops out
// on the coping falls back instead of being snatched onto a rail or stopped dead mid-wall.
import { expect, test } from "bun:test";
import { makeLevel } from "../src/level.ts";
import { halfpipe, quarterPipe } from "../src/levels/pieces.ts";
import { DT, IDLE, start, step } from "../src/sim.ts";

const flat = (pieces: ReturnType<typeof quarterPipe>["pieces"], rails: ReturnType<typeof quarterPipe>["rails"] = []) =>
  makeLevel({ name: "t", pieces, rails, spawns: [], bounds: { minX: -300, maxX: 300, minZ: -300, maxZ: 300 } });

test("off a halfpipe's vert wall the board drops back in, not out onto the flat", () => {
  const level = flat(halfpipe({ x: 0, z: 0 }, { w: 20, d: 40, h: 3 }).pieces);
  for (const speed of [18, 24]) {
    const s = Object.assign(start(0, 0, Math.PI / 2, level), { speed });
    let reentered = false, left = false, far = 0;
    for (let i = 0; i < 10 / DT; i++) {
      step(s, IDLE, level);
      far = Math.max(far, Math.abs(s.x));
      if (s.air && Math.abs(s.x) > 15) left = true;
      if (left && !s.air && Math.abs(s.x) < 17) reentered = true;
    }
    expect(left).toBe(true);
    expect(reentered).toBe(true);
    expect(far).toBeLessThan(18); // never flew out onto the deck
  }
});

test("a board that tops out on a quarter pipe's coping does not stall into a rail grind and bail off it", () => {
  const pipe = quarterPipe({ x: 0, z: 0 }, { w: 14, d: 7, h: 3.6 });
  const level = flat(pipe.pieces, pipe.rails);
  for (const speed of [17]) { // topping out at almost no speed
    const s = Object.assign(start(0, -6.3, 0, level), { speed });
    for (let i = 0; i < 6 / DT; i++) step(s, IDLE, level);
    expect(s.last?.name ?? "").not.toMatch(/fell off the rail/);
  }
});
