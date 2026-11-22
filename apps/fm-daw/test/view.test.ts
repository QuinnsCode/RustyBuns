// The editors' view window (src/ui/view.ts): zoom and scroll stay in the loop,
// the grid thins as you zoom out, and an edit in the window never loses or
// moves a note outside it.
import { describe, expect, test } from "bun:test";
import { clampView, fit, gridFor, rulerMarks, scrollBy, snapView, windowNotes, zoomAbout } from "../src/ui/view.ts";
import type { Note } from "../src/project.ts";

const L = 64 * 4; // a 64-bar song

describe("zoom and scroll", () => {
  test("zooming keeps the beat under the pointer still and stays in the loop", () => {
    const v = { from: 32, span: 32 };
    const z = zoomAbout(v, L, 0.5, 40);
    expect(z.span).toBe(16);
    // beat 40 was a quarter in; it still is
    expect((40 - z.from) / z.span).toBeCloseTo((40 - v.from) / v.span, 9);
    expect(zoomAbout(v, L, 1000, 40)).toEqual(fit(L));
    expect(zoomAbout(v, L, 1e-6, 40).span).toBe(1);
    // zoomed out near the end, it lands against the end, not past it
    expect(zoomAbout({ from: 240, span: 16 }, L, 4, 250)).toEqual({ from: L - 64, span: 64 });
  });

  test.each([
    [{ from: 10, span: 8 }, -20, { from: 0, span: 8 }],
    [{ from: 10, span: 8 }, 1.5, { from: 11.5, span: 8 }],
    [{ from: 240, span: 8 }, 100, { from: L - 8, span: 8 }],
  ])("scrolling %o by %d", (v, by, want) => expect(scrollBy(v, L, by)).toEqual(want));

  test("a view from a longer song fits a shorter loop", () => {
    expect(clampView({ from: 100, span: 64 }, 16)).toEqual({ from: 0, span: 16 });
    expect(clampView({ from: Number.NaN, span: Number.NaN }, 16)).toEqual({ from: 0, span: 16 });
  });
});

describe("the grid follows the zoom", () => {
  test.each([
    [8, 800, 0.25, 0.25], // two bars across a desktop: 16ths
    [L, 800, 0.25, 4], // the whole song: bars
    [L, 300, 0.25, 16], // the whole song on a phone: four-bar cells
    [4, 800, 0.125, 0.125], // zoomed right in: down to the Grid choice
  ])("span %d at %dpx, finest %d -> %d", (span, px, finest, want) => expect(gridFor(span, px, finest, L)).toBe(want));

  test("the window widens to whole cells and stays in the loop", () => {
    expect(snapView({ from: 5.3, span: 10 }, 4, L)).toEqual({ from: 4, span: 12 });
    expect(snapView({ from: 250.1, span: 5.9 }, 1, L)).toEqual({ from: 250, span: 6 });
  });

  test("the ruler numbers bars when zoomed out and beats when zoomed in", () => {
    const out = rulerMarks({ from: 0, span: L }, 800, 4);
    expect(out.length).toBeLessThan(20);
    expect(out.every((m) => m.major)).toBe(true);
    expect(rulerMarks({ from: 4, span: 8 }, 800, 4).map((m) => m.label).slice(0, 5)).toEqual(["2", "2.2", "2.3", "2.4", "3"]);
  });
});

describe("editing in the window", () => {
  const n = (s: number, l: number, m = 60): Note => ({ s, l, m, v: 0.8 });
  // a pad held from bar 1 into the window, notes in it, notes after it
  const notes = [n(0.1, 9.7), n(8.3, 0.25, 62), n(12, 1, 64), n(40.05, 0.5, 67)];

  test("a note that reaches in shows, clipped by the editor; ones outside don't", () => {
    const w = windowNotes(notes, { from: 8, span: 8 });
    expect(w.notes.map((x) => x.m)).toEqual([60, 62, 64]);
    expect(w.notes[0].s).toBeCloseTo(-7.9, 9);
    expect(w.notes[2].s).toBe(4);
  });

  test("handing the window back untouched gives the track back exactly", () => {
    const w = windowNotes(notes, { from: 8.7, span: 7.3 });
    expect(sorted(w.back(w.notes))).toEqual(sorted(notes));
  });

  test("adding and deleting in the window leaves everything outside alone", () => {
    const w = windowNotes(notes, { from: 8, span: 8 });
    const edited = [...w.notes.filter((x) => x.m !== 64), n(2.5, 0.25, 70)];
    const back = sorted(w.back(edited));
    expect(back).toEqual(sorted([notes[0], notes[1], notes[3], n(10.5, 0.25, 70)]));
  });
});

const sorted = (ns: Note[]) => [...ns].sort((a, b) => a.s - b.s || a.m - b.m);
