// What a world's frame says its land is: kept only when it is well formed and stays on its own plot.
import { describe, expect, test } from "bun:test";
import { DAY, landFrom, PLOT } from "../src/land.ts";

const triangle = (x: number) => ({ p: [x, 0, 0, x + 1, 0, 0, x, 1, 0], c: "#3f7a3a" });
const copyAt = (x: number, big = 1) => [big, 0, 0, 0, 0, big, 0, 0, 0, 0, big, 0, x, 0, 0, 1];

describe("a plot's land", () => {
  test.each([
    ["a shape on the plot", triangle(10), true],
    ["copies on the plot", { ...triangle(0), m: copyAt(PLOT / 2 - 6) }, true],
    ["a shape over a neighbour", triangle(PLOT), false],
    ["a copy placed on a neighbour", { ...triangle(0), m: copyAt(PLOT) }, false],
    ["a copy stretched over everyone", { ...triangle(0), m: copyAt(0, 500) }, false],
    ["a face pointing at a corner that isn't there", { ...triangle(0), i: [0, 1, 9] }, false],
  ] as const)("%s", (_, part, kept) => {
    expect(landFrom({ parts: [part] }) !== null).toBe(kept);
  });

  const night = { ...DAY, top: "#0b0824", weather: "rain", smoke: [{ x: 5, y: 12, z: -5 }], cars: true } as const;
  test.each([
    ["is kept with the land", night, true],
    ["with a colour that isn't one is left behind", { ...night, top: "url(x)" }, false],
    ["with fog pulled over everyone is left behind", { ...night, far: 1 }, false],
    ["with smoke over a neighbour is left behind", { ...night, smoke: [{ x: PLOT, y: 12, z: 0 }] }, false],
  ])("a mood %s", (_, mood, kept) => {
    const land = landFrom({ parts: [triangle(0)], mood });
    expect(land?.parts).toHaveLength(1);
    expect(land?.mood?.top).toBe(kept ? night.top : undefined);
  });

  test.each([[null], [{ parts: "all of it" }], [{ parts: [{ p: [0, 0, 0], c: "url(x)" }] }]])("is nothing when the frame says %j", (said) => {
    expect(landFrom(said)).toBeNull();
  });
});
