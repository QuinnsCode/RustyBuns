import { describe, expect, test } from "bun:test";
import { emblem, frame, marginalia, seal, tear, weights } from "../src/ornaments.ts";

// Every chapter has a frontispiece; each is one well-formed inline SVG that costs under two kilobytes.
describe("the tome's engravings", () => {
  test("a plate's frame is one svg; a folio's marginalia are a hand, a figure per field and a sprig", () => {
    expect(frame().startsWith("<svg ") && frame().endsWith("</svg>")).toBe(true);
    expect(marginalia(["ember", "tide"]).match(/<svg /g)).toHaveLength(4);
    expect(weights().frame).toBeLessThan(6144);
  });
  test.each(["lineup", "bestiary", "regions", "title", "witch"] as const)("%s: an svg under 2 KB", (c) => {
    const s = emblem(c);
    expect(s.startsWith("<svg ") && s.endsWith("</svg>")).toBe(true);
    expect(s).toContain('aria-hidden="true"');
    expect(weights()[c]).toBeLessThan(2048);
  });
});

// A result note's outcome art: the wax seal is one svg; the tear's clip runs from the top edge to the right edge, so
// the corner it cuts is the one its fibres are drawn along.
test("a bind's seal and a loss's tear", () => {
  expect(seal().startsWith("<svg ") && seal().endsWith("</svg>")).toBe(true);
  const { clip, svg } = tear(3), pts = clip.slice("polygon(".length, -1).split(", ");
  expect(pts[0]).toBe("0 0");
  expect(pts[1]).toMatch(/\) 0\.0px$/); // the rip starts on the top edge
  expect(pts.at(-3)).toMatch(/^calc\(100% - 0\.0px\) /); // and ends on the right edge
  expect(pts.slice(-2)).toEqual(["100% 100%", "0 100%"]);
  expect(svg.length + seal().length).toBeLessThan(6144);
});
