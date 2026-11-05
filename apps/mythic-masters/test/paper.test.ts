import { describe, expect, test } from "bun:test";
import { png, vellum } from "../scripts/paper.ts";

// The rendered sheet: a real PNG of the asked size, the same every run, and seamless (its lattice wraps).
describe("the tome's vellum", () => {
  test("a seeded, well-formed PNG; the same sheet twice", () => {
    const a = vellum(32, 7), b = vellum(32, 7);
    expect(a).toEqual(b);
    const file = png(a, 32);
    expect([...file.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(new DataView(file.buffer).getUint32(16)).toBe(32); // IHDR width
  });
});
