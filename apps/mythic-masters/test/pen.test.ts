import { describe, expect, test } from "bun:test";
import { hinges, leafFrames, penLines, penMask } from "../src/page.ts";

// The tome's ink is written, not wiped (#3671): a block's text boxes become the lines a pen runs along in reading
// order. A Range hands back one box per run of text per line, often several on one line (a word in italic, a link),
// and a block can hold a picture beside its words, which must stay a stroke of its own.
const box = { left: 100, top: 50, width: 400, height: 200 };
const r = (left: number, top: number, width: number, height: number) => ({ left: box.left + left, top: box.top + top, width, height });

describe("the pen's path through a block", () => {
  test.each([
    ["one run", [r(0, 0, 120, 20)], [], [[0, 0, 120, 20]]],
    ["three runs on one line, out of order", [r(80, 0, 40, 20), r(0, 0, 60, 20), r(60, 2, 20, 16)], [], [[0, 0, 120, 20]]],
    ["a paragraph that wraps", [r(0, 0, 380, 20), r(0, 22, 380, 20), r(0, 44, 90, 20)], [], [[0, 0, 380, 20], [0, 22, 380, 20], [0, 44, 90, 20]]],
    ["a plate beside two lines stays its own stroke", [r(80, 0, 200, 20), r(80, 22, 150, 20)], [r(0, 0, 64, 64)], [[80, 0, 200, 20], [0, 0, 64, 64], [80, 22, 150, 20]]],
    ["empty runs are skipped", [r(0, 0, 0, 20), r(0, 0, 50, 20)], [r(0, 30, 10, 0)], [[0, 0, 50, 20]]],
  ])("%s", (_, words, pictures, want) => {
    expect(penLines(words, pictures, box)?.map((l) => [l.x, l.y, l.w, l.h])).toEqual(want);
  });

  test("a block measured before it was laid out gives no path, so it takes the drop", () => {
    expect(penLines([r(4800, 2100, 120, 20)], [], box)).toBeNull();
  });

  test("each line's mask starts where the last one ended, so the lines are written one after another", () => {
    const mask = penMask([{ x: 0, y: 0, w: 100, h: 20 }, { x: 0, y: 22, w: 60, h: 20 }]);
    expect(mask.images.match(/transparent calc\(var\(--pen\) \* 1px - (\d+)px\)/g)).toEqual(["transparent calc(var(--pen) * 1px - 0px)", "transparent calc(var(--pen) * 1px - 112px)"]);
    expect(mask.length).toBe(112 + 72 + 22);
  });
});

// The turning leaf is cut into strips that bend; lit one flat shade each, it read as folded card. Each strip is lit
// from hinge to hinge, so two strips must agree where they meet or the crease shows.
describe("the light across a turning leaf", () => {
  test("neighbouring strips agree at the hinge between them", () => {
    for (const k of [2, 8, 12, 20]) {
      const angles = leafFrames(0, -180, 600)[k]!.angles;
      for (let i = 0; i < angles.length - 1; i++) expect(hinges(angles, i).edge).toBeCloseTo(hinges(angles, i + 1).spine, 6);
    }
  });
});
