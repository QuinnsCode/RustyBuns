// Built rooms (rooms/): the packed PLY must decode in the game that plays it, and a layout must never stand
// furniture inside other furniture or outside the walls. The Blender bake itself runs on a desktop only.
import { expect, test } from "bun:test";
import { mulberry32 } from "@rustybuns/util";
import { THEMES } from "../rooms/catalog.ts";
import { packPly, ROW } from "../rooms/pack.ts";
import { recipe } from "../rooms/recipe.ts";
import { readPly } from "../../splat-spray/src/levels/ply.ts";

test("packed splats come back out of Splat Spray's decoder", () => {
  const rand = mulberry32(5);
  const n = 1000;   // four chunks, the last one partial
  const rows = new Float32Array(n * ROW);
  for (let i = 0; i < n; i++) {
    const q = [rand() - 0.5, rand() - 0.5, rand() - 0.5, rand() - 0.5];
    const l = Math.hypot(...q);
    rows.set([rand() * 5, rand() * 4, rand() * 2.7, 0.004 + rand() * 0.01, 0.004 + rand() * 0.01, 0.0012,
      ...q.map((v) => v / l), rand(), rand(), rand(), 0.95], i * ROW);
  }
  const back = readPly(packPly(rows));
  expect(back?.count).toBe(n);
  if (!back) return;
  // order changes (Morton sort), so match each decoded splat to the nearest source splat
  for (let i = 0; i < n; i++) {
    let j = 0, best = Infinity;
    for (let k = 0; k < n; k++) {
      const d = Math.hypot(back.pos[i * 3]! - rows[k * ROW]!, back.pos[i * 3 + 1]! - rows[k * ROW + 1]!, back.pos[i * 3 + 2]! - rows[k * ROW + 2]!);
      if (d < best) { best = d; j = k; }
    }
    for (let a = 0; a < 3; a++) {
      expect(Math.abs(back.pos[i * 3 + a]! - rows[j * ROW + a]!)).toBeLessThan(0.01);
      expect(Math.abs(back.color[i * 3 + a]! - rows[j * ROW + 10 + a]!)).toBeLessThan(0.01);
      expect(back.scale[i * 3 + a]! / rows[j * ROW + 3 + a]!).toBeCloseTo(1, 1);
    }
    expect(back.opacity[i]!).toBeCloseTo(0.95, 2);
    // the decoder returns x y z w; the same rotation up to sign
    const dot = back.quat[i * 4 + 3]! * rows[j * ROW + 6]! + back.quat[i * 4]! * rows[j * ROW + 7]! +
      back.quat[i * 4 + 1]! * rows[j * ROW + 8]! + back.quat[i * 4 + 2]! * rows[j * ROW + 9]!;
    expect(Math.abs(dot)).toBeGreaterThan(0.999);
  }
});

test("layouts keep furniture apart and inside the room, windows clear, the same for the same seed", () => {
  for (const [id, theme] of Object.entries(THEMES)) {
    expect(recipe(theme, 3, id)).toEqual(recipe(theme, 3, id));
    for (let seed = 1; seed <= 40; seed++) {
      const r = recipe(theme, seed, id);
      const foot = r.furniture.map((f) => {
        const a = theme.assets.find((x) => x.id === f.asset)!;
        const side = Math.abs(f.yaw - (a.turn ?? 0)) % 180 === 90;   // sizes are as seen from the front
        const hw = (side ? a.size[1] : a.size[0]) / 2, hd = (side ? a.size[0] : a.size[1]) / 2;
        return [f.x - hw, f.y - hd, f.x + hw, f.y + hd] as const;
      });
      expect(r.furniture.length).toBeGreaterThanOrEqual(5);   // a small bedroom: the bed and four more
      expect(r.openings.filter((o) => o.kind === "door")).toHaveLength(1);
      // nothing taller than a sill stands in front of a window: you'd see a wardrobe's back in the glass
      for (const o of r.openings.filter((x) => x.kind === "window")) {
        const [x0, x1] = [o.from, o.to];
        for (const [i, f] of r.furniture.entries()) {
          const a = theme.assets.find((x) => x.id === f.asset)!;
          const b = foot[i]!;
          const yaw = (((f.yaw - (a.turn ?? 0)) % 360) + 360) % 360;   // which wall it backs onto, as onWall turns it
          const near = yaw === [180, 270, 0, 90][o.wall] && [b[1] < 0.8, b[2] > r.room.w - 0.8, b[3] > r.room.d - 0.8, b[0] < 0.8][o.wall]!;
          const along = o.wall % 2 === 0 ? [b[0], b[2]] : [b[1], b[3]];
          const span = o.wall === 2 ? [r.room.w - along[1]!, r.room.w - along[0]!] : o.wall === 3 ? [r.room.d - along[1]!, r.room.d - along[0]!] : along;
          if (a.role === "wall" && near && span[0]! < x1 && span[1]! > x0) expect(a.size[2]).toBeLessThan(0.9);
        }
      }
      for (const [i, b] of foot.entries()) {
        expect(b[0] > -0.01 && b[1] > -0.01 && b[2] < r.room.w + 0.01 && b[3] < r.room.d + 0.01).toBe(true);
        for (const o of foot.slice(i + 1)) {
          const overlap = Math.min(b[2], o[2]) - Math.max(b[0], o[0]) > 0.02 && Math.min(b[3], o[3]) - Math.max(b[1], o[1]) > 0.02;
          expect(overlap).toBe(false);
        }
      }
    }
  }
});
