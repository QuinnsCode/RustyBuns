import { expect, test } from "bun:test";
import { cutAll, cutNote, drawNote, findNote, MIN_LEN, moveNote, snapBeat, stretchEnd, stretchStart } from "../src/roll.ts";
import { sanitizeNotes } from "../src/project.ts";

const n = (s: number, l: number, m = 60) => ({ s, l, m, v: 0.8 });

test("snap off keeps the beat; snap on finds the nearest line, triplets too", () => {
  expect(snapBeat(1.2345678, null)).toBe(1.234568);
  expect(snapBeat(1.2, 0.5)).toBe(1);
  expect(snapBeat(1.3, 0.5)).toBe(1.5);
  expect(snapBeat(0.4, 1 / 3)).toBeCloseTo(1 / 3, 6);
});

test("a free note is exactly the drag, and survives the project's sanitize as drawn", () => {
  const d = drawNote(0.37, 1.513, 64, null, 8, 0.25);
  expect(d).toEqual({ s: 0.37, l: 1.143, m: 64, v: 0.8 });
  expect(sanitizeNotes([d], 8)).toEqual([d]);
  // drawn right to left is the same note
  expect(drawNote(1.513, 0.37, 64, null, 8, 0.25)).toEqual(d);
  // a press with no drag is the default length, at the press
  expect(drawNote(2.11, 2.11, 60, null, 8, 0.25)).toEqual(n(2.11, 0.25));
});

test("a note on the grid fills the cells the drag crossed", () => {
  expect(drawNote(0.6, 0.6, 60, 0.5, 8, 0.5)).toEqual(n(0.5, 0.5));
  expect(drawNote(0.6, 1.6, 60, 0.5, 8, 0.5)).toEqual(n(0.5, 1.5));
  // a drag past the window's end stops at it
  expect(drawNote(7.6, 12, 60, 0.5, 8, 0.5)).toEqual(n(7.5, 0.5));
});

test("move keeps the length; free it lands anywhere, on the grid it lands on a line", () => {
  expect(moveNote(n(1, 0.5), 0.133, 2, null, 8)).toEqual(n(1.133, 0.5, 62));
  expect(moveNote(n(1.133, 0.5), 0.2, 0, 0.25, 8)).toEqual(n(1.25, 0.5));
  expect(moveNote(n(1, 0.5), -5, -200, null, 8)).toEqual(n(0, 0.5, 0));
  expect(moveNote(n(1, 0.5), 50, 0, null, 8).s).toBeLessThan(8);
  // a note that starts before a zoomed window keeps its place when only its pitch moves, and stretches from there
  expect(moveNote(n(-0.75, 2), 0, 1, null, 4)).toEqual(n(-0.75, 2, 61));
  expect(moveNote(n(-0.75, 2), 0.5, 0, null, 4)).toEqual(n(-0.25, 2));
  expect(stretchEnd(n(-0.75, 2), 1.5, null)).toEqual(n(-0.75, 2.25));
});

test("stretching either end leaves the other where it was", () => {
  expect(stretchEnd(n(1, 0.5), 2.27, null)).toEqual(n(1, 1.27));
  expect(stretchEnd(n(1, 0.5), 2.27, 0.5)).toEqual(n(1, 1.5));
  expect(stretchEnd(n(1, 0.5), 0.2, null).l).toBe(MIN_LEN);
  expect(stretchEnd(n(1, 0.5), 0.2, 0.5)).toEqual(n(1, 0.5));
  // the transient's start moves, the end stays on beat 2
  expect(stretchStart(n(1, 1), 1.31, null)).toEqual(n(1.31, 0.69));
  expect(stretchStart(n(1, 1), 1.31, 0.5)).toEqual(n(1.5, 0.5));
  expect(stretchStart(n(1, 1), 5, 0.5)).toEqual(n(1.5, 0.5));
  const s = stretchStart(n(1, 1), 5, null);
  expect(s.s + s.l).toBeCloseTo(2, 6);
  expect(s.l).toBeCloseTo(MIN_LEN, 6);
});

test("a cut makes two notes that sound as the one did; a miss leaves it", () => {
  expect(cutNote(n(1, 1), 1.5)).toEqual([n(1, 0.5), n(1.5, 0.5)]);
  expect(cutNote(n(1, 1), 1)).toEqual([n(1, 1)]);
  expect(cutNote(n(1, 1), 2)).toEqual([n(1, 1)]);
  expect(cutNote(n(1, 1), 3)).toEqual([n(1, 1)]);
  expect(cutAll([n(0, 4, 60), n(1, 0.25, 62), n(1.5, 2, 64)], 2)).toEqual([n(0, 2, 60), n(2, 2, 60), n(1, 0.25, 62), n(1.5, 0.5, 64), n(2, 1.5, 64)]);
});

test("a note is found again after the list changed under the drag", () => {
  const list = [n(0, 1), n(1, 1, 62), n(2, 1)];
  expect(findNote(list, n(1, 1, 62))).toBe(1);
  expect(findNote(list, n(1, 1, 63))).toBe(-1);
});
