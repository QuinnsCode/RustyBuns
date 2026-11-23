// The drum grid on a free hit: a hit recorded with Quantize input off shows where it was played inside its
// step, an accent leaves it there, and only Snap puts it on the step.
import { expect, test } from "bun:test";
import { apply, sanitize } from "../src/project.ts";
import { demoProject } from "../src/presets.ts";
import { cellsFor, toggle } from "../src/steps.ts";

test("a hit played off the grid stays off its step until Snap is asked for", () => {
  const p0 = demoProject();
  const d = p0.tracks.findIndex((t) => t.kind === "drum");
  const drum = { ...p0.tracks[d], notes: [] };
  // recorded with Quantize input off: the hit lands where it was played (App's "rec" path)
  const hit = { s: 1.13, l: 0.25, m: drum.root, v: 0.8 };
  const p = sanitize(JSON.parse(JSON.stringify(apply({ ...p0, tracks: p0.tracks.map((t, i) => (i === d ? drum : t)) }, { t: "notes", track: d, notes: [hit] }))))!;
  const t = p.tracks[d];
  expect(t.notes[0].s).toBe(1.13);

  // 16ths: step 5 (beat 1) holds it, marked a little over half way in and striped
  const cells = cellsFor(t.notes, 16, 0.25);
  expect(cells[4]).toEqual({ v: 0.8, offGrid: true, at: [expect.closeTo(0.52, 6)] });
  expect(cells.filter(Boolean)).toHaveLength(1);
  // zoomed out to beats, the same hit sits a little past its beat
  expect(cellsFor(t.notes, 4, 1)[1]!.at[0]).toBeCloseTo(0.13, 6);
  // a hit on the step has no offset to show
  expect(cellsFor([{ ...hit, s: 1 }], 16, 0.25)[4]).toEqual({ v: 0.8, offGrid: false, at: [0] });

  // shift-click accents it where it is; a plain click with Snap off clears it
  expect(toggle(t, 4, 0.25, { accent: true })).toEqual([{ ...hit, v: 1 }]);
  expect(toggle(t, 4, 0.25)).toEqual([]);
  // with Snap on the click puts it on the step, and the next one clears it
  const snapped = toggle(t, 4, 0.25, { snap: true });
  expect(snapped).toEqual([{ ...hit, s: 1 }]);
  expect(toggle({ ...t, notes: snapped }, 4, 0.25, { snap: true })).toEqual([]);
  // an empty step gets a hit on it
  expect(toggle(t, 0, 0.25)).toEqual([hit, { s: 0, l: 0.25, m: t.root, v: 0.8 }]);
});
