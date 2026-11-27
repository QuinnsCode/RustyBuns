// QDAW's lesson (#6171), walked as a beginner does it on the desk's own project: the demo groove, emptied by the
// lesson's start, then each hit clicked onto the drum grid (steps.ts toggle, the grid's own click) and landed through
// apply(), the same edit the page commits. One mistake the grid lets you make (the snare on 1 and 3), its why, put
// right, then the transport on and the lesson done. (A file of its own, beside sector-lessons.test.ts from #6175.)
import { expect, test } from "bun:test";
import { BEAT_LESSON, beatAt, beatRows, rowOf, type BeatAt } from "../src/beat-lesson.ts";
import { demoProject } from "../src/presets.ts";
import { apply, type Project } from "../src/project.ts";
import { FINE, toggle } from "../src/steps.ts";
import { PageLesson } from "../src/studio/page-lesson.ts";

test("Make a beat: kick on every beat, the snare first on 1 and 3, moved to 2 and 4, hats on the ands, then play", () => {
  let p: Project = demoProject(), playing = false;
  const lesson = new PageLesson<BeatAt>(BEAT_LESSON, () => beatAt(p, playing), () => {
    for (const track of beatRows(beatAt(p, false))) p = apply(p, { t: "notes", track, notes: [] });
  });
  const at = () => beatAt(p, playing);
  /** A click on the grid's 16th `s` in a row. */
  const click = (row: "kick" | "snare" | "hat", s: number) => {
    const track = rowOf(at(), row);
    p = apply(p, { t: "notes", track, notes: toggle(p.tracks[track], s, FINE) });
  };
  const bars = p.bars, sixteenths = bars * 16;

  // the demo groove already has a beat: starting the lesson empties those three rows, nothing else
  const bassOf = () => p.tracks.find((t) => t.name === "Bass")!.notes, bass = bassOf().length;
  expect(bass).toBeGreaterThan(0);
  lesson.start();
  const now = () => lesson.state()!;
  expect(now()).toMatchObject({ id: "beat", next: 0, done: false });
  expect(beatRows(at()).every((i) => p.tracks[i].notes.length === 0)).toBe(true);
  expect(bassOf()).toHaveLength(bass);

  // a kick on bar 1's beats only: the card names where the gaps are
  for (const s of [0, 4, 8, 12]) click("kick", s);
  expect(now().steps[0].why).toMatch(/^No kick on bar 2's beat 1, bar 2's beat 2, bar 2's beat 3 and 1 more/);
  for (let s = 16; s < sixteenths; s += 4) click("kick", s);
  expect(now()).toMatchObject({ next: 1 });

  // the snare on 1 and 3, with the kick: stiff, and the card says why
  for (let s = 0; s < sixteenths; s += 8) click("snare", s);
  expect(now().steps[1].why).toMatch(/^The snare lands on bar 1's beat 1, bar 1's beat 3, bar 2's beat 1 and 1 more, on top of the kick/);
  // moved to 2 and 4: each click off 1 and 3 clears it, each on 2 and 4 puts one there
  for (let s = 0; s < sixteenths; s += 8) { click("snare", s); click("snare", s + 4); }
  expect(now()).toMatchObject({ next: 2 });

  // hats on the beats: under the kick, nothing between
  for (let s = 0; s < sixteenths; s += 4) click("hat", s);
  expect(now().steps[2].why).toMatch(/^The hats sit on the beats/);
  for (let s = 2; s < sixteenths; s += 4) click("hat", s);
  expect(now()).toMatchObject({ next: 3 });

  // Space: playing the whole beat ends it
  playing = true;
  expect(now()).toMatchObject({ done: true });
  expect(lesson.finished).toBe(true);
});
