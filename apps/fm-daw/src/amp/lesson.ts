// Q Amps' lesson (#6085, PATHWAYS.md section 6), on /amp.html: a clean amp, a drive in front, an echo in the loop. Turn
// the amp's Gain down so it plays clean, switch Q Drive on at a low Drive to push it, then switch Q Tape on in the amp's
// effects loop, after the preamp, where its repeats stay clean. Every step reads the page's own state: the amp's knobs,
// the pedals switched on, the board's order (pedalboard.ts) and what the cables let the speakers hear (circuit/patch.ts
// heard), so a pedal cabled out of the chain doesn't count. Pure: no DOM.
import type { Step } from "@rustybuns/gear";
import { AMP_SLOT } from "./pedalboard.ts";
import type { PageLessonDef } from "../studio/page-lesson.ts";

/** What a step reads: the amp's Gain (0 to 10), the pedals switched on and their Drive, the tape echo's switch, the
 *  board's tiles in chain order (the amp one of them), and whether the cables put Q Drive in the sound. */
export type AmpAt = { gain: number; lit: readonly string[]; drive: Readonly<Record<string, number>>; tape: boolean; order: readonly string[]; driveHeard: boolean };

/** Clean is the amp's Gain at this or under; a push is Q Drive's Drive at this or under. */
export const CLEAN_GAIN = 3, PUSH_DRIVE = 4;

const inLoop = ({ order }: AmpAt, id: string) => order.indexOf(id) > order.indexOf(AMP_SLOT);
const driveOf = (s: AmpAt) => s.drive.drive ?? 5;

const STEPS: Step<AmpAt>[] = [
  {
    job: `Clean the amp up: its Gain knob to ${CLEAN_GAIN} or under`,
    done: (s) => s.gain <= CLEAN_GAIN + 1e-6,
    why: (s) => `Gain at ${Math.round(s.gain * 10) / 10}: the preamp's first tube clips on every note, so the amp is dirty before any pedal reaches it. Turn Gain down to ${CLEAN_GAIN} or under for a clean amp to push`,
  },
  {
    job: `Switch Q Drive on, its Drive at ${PUSH_DRIVE} or under: a pedal in front of the amp`,
    done: (s) => s.lit.includes("drive") && driveOf(s) <= PUSH_DRIVE + 1e-6 && s.driveHeard && !inLoop(s, "drive"),
    why: (s) => {
      if (!s.lit.includes("drive")) return null;
      if (!s.driveHeard) return "Q Drive isn't cabled between the guitar and the amp, so it is out of the sound: a cable from the guitar (or the pedal before it) into Q Drive's In, and one from its Out on toward the amp's In";
      if (inLoop(s, "drive")) return "Q Drive sits in the amp's loop, after the preamp: it clips the amp's own sound, harsh and fizzy. Drag it in front of the amp";
      if (driveOf(s) > PUSH_DRIVE) return `Q Drive at ${Math.round(driveOf(s) * 10) / 10} is a distortion of its own. At ${PUSH_DRIVE} or under it pushes the amp's mids and tightens the lows, and the amp does the rest`;
      return null;
    },
  },
  {
    job: "Switch Q Tape on, in the amp's loop: after the amp on the board",
    done: (s) => s.tape && inLoop(s, "tape"),
    why: (s) => (s.tape && !inLoop(s, "tape") ? "Q Tape sits in front of the amp: each echo goes through Q Drive and the preamp, clips, and smears into the next one. In the loop, after the preamp, the repeats stay clean. Drag it after the amp" : null),
  },
];

export const AMP_LESSON: PageLessonDef<AmpAt> = {
  id: "amp", title: "A clean amp, a drive, an echo", blurb: "Gain down for a clean amp, Q Drive in front to push it, Q Tape in the loop so its repeats stay clean", steps: STEPS,
  end: () => "Done. That's your rig now: play it, or try the other amps under the same pedals",
};
