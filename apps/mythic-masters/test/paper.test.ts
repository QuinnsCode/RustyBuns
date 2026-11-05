import { describe, expect, test } from "bun:test";
import { deckle, DECKLE, png, vellum } from "../scripts/paper.ts";

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

// The deckle is nine-sliced and its edges repeat down a page thousands of pixels long: each repeat must join the next
// (the first row of an edge's middle matches the row after its last), the page must be whole inside it and gone at
// its outer corner.
test("the deckle mask: whole inside, cut at the edge, seamless where its edges repeat", () => {
  const { size, border } = DECKLE, m = deckle(size, border, 7), a = (x: number, y: number) => m[(y * size + x) * 2 + 1]!;
  expect(a(size / 2, size / 2)).toBe(255);
  expect(a(0, 0)).toBe(0);
  for (let d = 0; d < border; d++) {
    expect(a(d, border)).toBe(a(d, size - border)); // left edge
    expect(a(size - 1 - d, border)).toBe(a(size - 1 - d, size - border)); // right
    expect(a(border, d)).toBe(a(size - border, d)); // top
    expect(a(border, size - 1 - d)).toBe(a(size - border, size - 1 - d)); // bottom
  }
});
