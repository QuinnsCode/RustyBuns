import { describe, expect, test } from "bun:test";
import { hinges, leafFrames, penLines, penMask, penPace, swingFrames } from "../src/page.ts";

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

  // The newest ink is wet (#3717): the pen no longer wipes along at one speed. It writes each word at its own pace
  // and stops a moment between words, but never goes back over what it wrote and ends where the path ends.
  test("the pen's pace is uneven word by word, and still runs the whole path forward", () => {
    const line = { x: 0, y: 0, w: 300, h: 20 };
    const words = [{ x: 0, y: 0, w: 60, h: 20 }, { x: 70, y: 0, w: 110, h: 20 }, { x: 190, y: 0, w: 110, h: 20 }];
    const mask = penMask([line, { x: 0, y: 0, w: 300, h: 20 }], 1, words);
    const stops = [...mask.pace.matchAll(/(-?[\d.]+) (-?[\d.]+)%/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
    for (let i = 1; i < stops.length; i++) for (const k of [0, 1] as const) expect(stops[i]![k]).toBeGreaterThanOrEqual(stops[i - 1]![k]);
    expect(stops.at(-1)).toEqual([1, 100]);
    // a stop between words: time passes while the pen stays put
    expect(stops.some(([p, t], i) => i > 0 && p === stops[i - 1]![0] && t > stops[i - 1]![1])).toBe(true);
    // two words of one width take different times
    const across = (a: number, b: number) => { const at = (px: number) => { const p = px / mask.length, j = stops.findIndex(([q]) => q >= p); return stops[j]![1]; }; return at(b) - at(a); };
    expect(Math.abs(across(76, 186) - across(196, 306))).toBeGreaterThan(0.5);
    expect(penPace([], [], 100)).toBe("linear(0, 1)");
  });
});

// A sheet swinging away (the book closing over the world) or laid down (a result page) has nothing printed on its
// back. WebKit drew it mirrored anyway (#3717), so a sheet is not drawn at all while it faces away.
describe("a sheet swinging on its spine", () => {
  const shownAt = (frames: Keyframe[], p: number) => {
    const o = frames.filter((f) => f.opacity !== undefined);
    return o.reduce((v, f) => ((f.offset as number) <= p ? Number(f.opacity) : v), Number(o[0]!.opacity));
  };
  test.each([
    ["closing, forward", 0, -180, [[0.2, 1], [0.49, 1], [0.52, 0], [1, 0]]],
    ["closing, back", 0, 180, [[0.3, 1], [0.6, 0]]],
    ["laid down over the scene", -110, 0, [[0, 0], [0.15, 0], [0.2, 1], [1, 1]]],
  ] as const)("%s", (_, from, to, want) => {
    const frames = swingFrames(from, to);
    for (const [p, shown] of want) expect(shownAt(frames, p)).toBe(shown);
    expect(frames.some((f) => f.filter)).toBe(true);
  });
});

// The turning leaf is cut into strips that bend; lit one flat shade each, it read as folded card. Each strip is lit
// from hinge to hinge, so two strips must agree where they meet or the crease shows.
describe("the light across a turning leaf", () => {
  test("neighbouring strips agree at the hinge between them", () => {
    for (const k of [2, 8, 12, 20]) {
      const angles = leafFrames(0, -180)[k]!.angles;
      for (let i = 0; i < angles.length - 1; i++) expect(hinges(angles, i).edge).toBeCloseTo(hinges(angles, i + 1).spine, 6);
    }
  });
});
