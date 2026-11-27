import { expect, test } from "bun:test";
import { drawNote, editNotes, findNote, MIN_LEN, moveNote, snapBeat, trimNote } from "../src/roll.ts";
import { sanitizeNotes } from "../src/project.ts";

const n = (s: number, l: number, m = 60) => ({ s, l, m, v: 0.8 });

test("snap off keeps the beat; snap on finds the nearest line, triplets too", () => {
  expect(snapBeat(1.2345678, null)).toBe(1.234568);
  expect(snapBeat(1.2, 0.5)).toBe(1);
  expect(snapBeat(1.3, 0.5)).toBe(1.5);
  expect(snapBeat(0.4, 1 / 3)).toBeCloseTo(1 / 3, 6);
});

test.each([
  // [what, press, release, snap, the note]
  ["free, it is exactly the drag", 0.37, 1.513, null, n(0.37, 1.143)],
  ["drawn right to left is the same note", 1.513, 0.37, null, n(0.37, 1.143)],
  ["on the grid the start lands on the line before the press, the end where it let go", 0.6, 1.63, 0.5, n(0.5, 1.13)],
  ["a press with no drag is the default length, from the grid line", 0.6, 0.6, 0.5, n(0.5, 0.25)],
  ["a press with no drag, free, starts at the press", 2.11, 2.11, null, n(2.11, 0.25)],
  ["a drag past the window's end stops at it", 7.6, 12, 0.5, n(7.5, 0.5)],
] as const)("the pencil: %s", (_, a, b, snap, note) => {
  const d = drawNote(a, b, 60, snap, 8, 0.25);
  expect(d).toEqual(note);
  expect(sanitizeNotes([d], 8)).toEqual([d]);
});

test.each([
  // [what, note, start, end, moved, the note after]
  ["the start goes earlier than it was, the end stays", n(1, 1), 0.4, 2, "start", n(0.4, 1.6)],
  ["the end goes later, the start stays", n(1, 1), 1, 3.25, "end", n(1, 2.25)],
  ["the start dragged past the end stops just before it", n(1, 1), 5, 2, "start", n(2 - MIN_LEN, MIN_LEN)],
  ["the end dragged before the start stops just after it", n(1, 1), 1, 0.2, "end", n(1, MIN_LEN)],
  ["the start stops at the window's left edge", n(1, 1), -3, 2, "start", n(0, 2)],
  ["the end stops at the window's right edge", n(1, 1), 1, 20, "end", n(1, 7)],
  ["a note already before a zoomed window may stay there", n(-0.75, 2), -0.75, 2, "end", n(-0.75, 2.75)],
] as const)("trimming: %s", (_, note, start, end, moved, after) => {
  const t = trimNote(note, start, end, 8, moved);
  expect(t.s).toBeCloseTo(after.s, 6);
  expect(t.l).toBeCloseTo(after.l, 6);
  expect(t.l).toBeGreaterThanOrEqual(MIN_LEN - 1e-9);
});

test("the hand moves a note off the grid and keeps its length; snap puts a moved start on a line", () => {
  expect(moveNote(n(1, 0.5), 0.133, 2, null, 8)).toEqual(n(1.133, 0.5, 62));
  expect(moveNote(n(1.133, 0.5), 0.2, 0, 0.25, 8)).toEqual(n(1.25, 0.5));
  expect(moveNote(n(1, 0.5), -5, -200, null, 8)).toEqual(n(0, 0.5, 0));
  expect(moveNote(n(1, 0.5), 50, 0, null, 8).s).toBeLessThan(8);
  // a note that starts before a zoomed window keeps its place when only its pitch moves
  expect(moveNote(n(-0.75, 2), 0, 1, null, 4)).toEqual(n(-0.75, 2, 61));
});

test("an edit swaps or takes off one note in place, and a note is found again after the list changed", () => {
  const list = [n(0, 1), n(1, 1, 62), n(2, 1)];
  expect(editNotes(list, 1, [])).toEqual([n(0, 1), n(2, 1)]);
  expect(editNotes(list, 1, [n(1, 2, 62)])).toEqual([n(0, 1), n(1, 2, 62), n(2, 1)]);
  expect(editNotes(list, 9, [])).toEqual(list);
  expect(findNote(list, n(1, 1, 62))).toBe(1);
  expect(findNote(list, n(1, 1, 63))).toBe(-1);
});
