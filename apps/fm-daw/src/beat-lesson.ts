// QDAW's lesson (#6171, PATHWAYS.md's LEARN section), on / (the desk): make a beat. A kick on every beat, a snare
// on 2 and 4, hats on the "and"s between, then play it. Every step reads the project's own drum rows as the grid
// draws them (any hit that starts near the step counts, as a free-played one does), so the card ticks a step off when
// the pattern says so, and says why when (say) the snare lands on 1 and 3. Pure: no DOM (the card is lesson-card.ts).
import type { Step } from "@rustybuns/gear";
import { BEATS_PER_BAR, type Note, type Project } from "./project.ts";
import { FINE } from "./steps.ts";
import type { PageLessonDef } from "./studio/page-lesson.ts";

/** What a step reads: the loop's bars, each track's name, kind and notes, and whether the transport is playing. */
export type BeatAt = { bars: number; tracks: readonly { name: string; kind: "drum" | "synth"; notes: readonly Note[] }[]; playing: boolean };

export const beatAt = (p: Project, playing: boolean): BeatAt => ({ bars: p.bars, tracks: p.tracks, playing });

/** The three rows the lesson is about, by name, as every kit names them. */
const ROWS = { kick: /kick/i, snare: /snare/i, hat: /hat/i } as const;
type Row = keyof typeof ROWS;

/** The drum track a row is, or -1 when the groove has none. */
export const rowOf = (s: Pick<BeatAt, "tracks">, row: Row) => s.tracks.findIndex((t) => t.kind === "drum" && ROWS[row].test(t.name));
/** The tracks the lesson empties when it starts: the kick, snare and hat rows the groove has. */
export const beatRows = (s: Pick<BeatAt, "tracks">) => (Object.keys(ROWS) as Row[]).map((r) => rowOf(s, r)).filter((i) => i >= 0);

const notesOf = (s: BeatAt, row: Row) => s.tracks[rowOf(s, row)]?.notes ?? [];
/** A hit counts on a beat when it starts within half a 16th of it, the cell the drum grid lights. */
const hitAt = (notes: readonly Note[], b: number) => notes.some((n) => Math.abs(n.s - b) < FINE / 2);
const loop = (s: BeatAt) => s.bars * BEATS_PER_BAR;
const beats = (s: BeatAt, every: (b: number) => boolean) => Array.from({ length: loop(s) }, (_, b) => b).filter(every);
/** "bar 2's beat 3", the way a drummer counts it (1 to 4). */
const name = (b: number) => `bar ${Math.floor(b / BEATS_PER_BAR) + 1}'s beat ${(b % BEATS_PER_BAR) + 1}`;
const few = (bs: number[], say: (b: number) => string) => bs.slice(0, 3).map(say).join(", ") + (bs.length > 3 ? ` and ${bs.length - 3} more` : "");
const backbeat = (b: number) => b % 2 === 1;
const noRow = (row: string) => `This groove has no ${row} row. Pick a drum kit that has one (FM classic or Liquid)`;

const kickMissing = (s: BeatAt) => beats(s, () => true).filter((b) => !hitAt(notesOf(s, "kick"), b));
const snareMissing = (s: BeatAt) => beats(s, backbeat).filter((b) => !hitAt(notesOf(s, "snare"), b));
const snareOnKick = (s: BeatAt) => beats(s, (b) => !backbeat(b)).filter((b) => hitAt(notesOf(s, "snare"), b));
const hatMissing = (s: BeatAt) => beats(s, () => true).filter((b) => !hitAt(notesOf(s, "hat"), b + 0.5));
const beatDone = (s: BeatAt) => !kickMissing(s).length && !snareMissing(s).length && !snareOnKick(s).length && !hatMissing(s).length;

const STEPS: Step<BeatAt>[] = [
  {
    job: "A kick on every beat: 1, 2, 3 and 4 of every bar",
    done: (s) => rowOf(s, "kick") >= 0 && !kickMissing(s).length,
    why: (s) => {
      if (rowOf(s, "kick") < 0) return noRow("Kick");
      const gap = kickMissing(s);
      return notesOf(s, "kick").length ? `No kick on ${few(gap, name)}. The kick is the floor the beat stands on: one on every beat, so a foot knows where to land` : null;
    },
  },
  {
    job: "A snare on 2 and 4 of every bar",
    done: (s) => rowOf(s, "snare") >= 0 && !snareMissing(s).length && !snareOnKick(s).length,
    why: (s) => {
      if (rowOf(s, "snare") < 0) return noRow("Snare");
      const on = snareOnKick(s), gap = snareMissing(s);
      if (on.length) return `The snare lands on ${few(on, name)}, on top of the kick: the two hit as one and the beat goes stiff, like a march. On 2 and 4 it answers the kick instead, the backbeat a groove leans on. Move it to 2 and 4`;
      return notesOf(s, "snare").length ? `No snare on ${few(gap, name)}: the backbeat drops out there` : null;
    },
  },
  {
    job: "Hats between the beats: one on every \"and\" (1 and 2 and 3 and 4 and)",
    done: (s) => rowOf(s, "hat") >= 0 && !hatMissing(s).length,
    why: (s) => {
      if (rowOf(s, "hat") < 0) return noRow("Hat");
      const hats = notesOf(s, "hat");
      if (!hats.length) return null;
      if (!hats.some((n) => Math.abs(n.s - Math.round(n.s) - 0.5) < FINE / 2)) return "The hats sit on the beats, under the kick, so nothing moves between them. Put them halfway between, on the \"and\"s: the hat keeps time while the kick and snare rest";
      return `No hat on the "and" after ${few(hatMissing(s), name)}: the time stumbles there`;
    },
  },
  {
    job: "Play it: Space, or Play",
    // playing a half-made beat doesn't tick it: it's the whole beat you play
    done: (s) => s.playing && beatDone(s),
  },
];

export const BEAT_LESSON: PageLessonDef<BeatAt> = {
  id: "beat", title: "Make a beat", blurb: "A kick on every beat, a snare on 2 and 4, hats between, then play it", steps: STEPS,
};
