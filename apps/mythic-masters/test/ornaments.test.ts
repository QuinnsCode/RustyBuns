import { describe, expect, test } from "bun:test";
import { emblem, weights } from "../src/ornaments.ts";

// Every chapter has a frontispiece; each is one well-formed inline SVG that costs under two kilobytes.
describe("the tome's engravings", () => {
  test.each(["lineup", "bestiary", "regions"] as const)("%s: an svg under 2 KB", (c) => {
    const s = emblem(c);
    expect(s.startsWith("<svg ") && s.endsWith("</svg>")).toBe(true);
    expect(s).toContain('aria-hidden="true"');
    expect(weights()[c]).toBeLessThan(2048);
  });
});
