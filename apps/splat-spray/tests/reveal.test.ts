import { test, expect } from "bun:test";
import { rowSpans } from "../src/reveal.ts";

// A shot uploads only the texels it painted: one span per touched row, never crossing a row.
const cases: { name: string; indices: number[]; spans: [number, number][] }[] = [
  { name: "one row", indices: [5, 2, 6], spans: [[2, 5]] },
  { name: "across a row break", indices: [7, 8, 3, 17], spans: [[3, 5], [8, 1], [17, 1]] },
  { name: "nothing painted", indices: [], spans: [] },
];
test.each(cases)("rowSpans: $name", ({ indices, spans }) => {
  expect(rowSpans(Uint32Array.from(indices), 8)).toEqual(spans);
});
