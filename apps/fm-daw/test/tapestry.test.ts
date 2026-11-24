import { expect, test } from "bun:test";
import { drape } from "../src/studio/tapestry.ts";

test("the booth's cloth reaches the sand and never cuts into the table it hangs over", () => {
  for (const [w, d, h, seed] of [[3.2, 0.6, 0.95, 4242], [2.4, 0.7, 0.9, 7]] as const) {
    const pos = drape(w, d, h, seed).attributes.position!;
    let low = Infinity, inside = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      low = Math.min(low, y);
      // below the board, nothing may be inside the table's footprint (the DJ's side, +z, is open)
      if (y < h - 0.01 && Math.abs(x) < w / 2 - 0.001 && z < d / 2 && z > -d / 2 + 0.001) inside++;
    }
    expect(low).toBeLessThan(0.01);
    expect(low).toBeGreaterThanOrEqual(0);
    expect(inside).toBe(0);
  }
});
