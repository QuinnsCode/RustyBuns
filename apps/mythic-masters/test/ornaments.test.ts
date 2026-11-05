import { describe, expect, test } from "bun:test";
import { emblem, frame, marginalia, weights } from "../src/ornaments.ts";

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
