// Q Builder's lesson (#6173, PATHWAYS.md section 6), on /amp.html with the board view open (B): swap one part and hear
// why. Switch Q Drive on and open its board, swap its clipping diodes (D1 and D2, silicon from the factory) for
// germanium or LEDs, then the other end. Every step reads the page's own state (the playing pedal, the board view, Q
// Drive's swaps) and what the solved circuit puts out with those parts in (bench.ts tryPlay, the run the bench makes
// before a swap may play), so the card says in volts what a swap changed. Pure: no DOM.
import type { Step } from "@rustybuns/gear";
import { PEDALS } from "../circuit/amps.ts";
import { tryPlay } from "../circuit/bench.ts";
import { sockets, type Swaps } from "../circuit/circuits.ts";
import type { PageLessonDef } from "../studio/page-lesson.ts";

/** What a step reads: the playing pedal, the pedals switched on, the board view, Q Drive's knob and swaps, and each
 *  part D1 and D2 have held while the lesson is on (the page collects them). */
export type BuildAt = { pedal: string | null; lit: readonly string[]; board: boolean; drive: number; swaps: Swaps; tried: readonly string[] };

const DRIVE = PEDALS.find((p) => p.id === "drive")!;
const ENDS = ["germanium", "led"] as const;
const clipperOf = (swaps: Swaps) => swaps.D1 ?? "silicon";
const nameOf = (c: string) => (c === "led" ? "LEDs" : c === "germanium" ? "germanium" : c === "mosfet" ? "a MOSFET" : c === "none" ? "nothing" : "silicon");

const solved = new Map<string, number>();
/** Q Drive's peak volts out with these parts in at this Drive, from the solved circuit (a hot 220 Hz note, 50 ms). */
export function peakOf(drive: number, swaps: Swaps): number {
  const key = JSON.stringify([drive, swaps]);
  let v = solved.get(key);
  if (v === undefined) {
    const out = tryPlay(DRIVE.net(drive, swaps));
    v = typeof out === "number" ? out : NaN;
    solved.set(key, v);
  }
  return v;
}
const volts = (v: number) => `${v.toFixed(2)} V`;
const vsSilicon = (s: BuildAt) => {
  const now = peakOf(s.drive, s.swaps), stock = peakOf(s.drive, { ...s.swaps, D1: "silicon" });
  return `the solved circuit peaks at ${volts(now)} out of Q Drive, where silicon gave ${volts(stock)}`;
};

/** What a socket that isn't the clipping pair changes, in a line. */
function otherPart(id: string): string {
  if (id === "R2" || id === "C2") return `${id} is half of the leg (R2 and C2) that sets where the gain starts, about 720 Hz: it moves the mid push, a tone change, and the wave still rounds off at the same diodes`;
  const s = sockets("drive").find((x) => x.id === id);
  return s?.kind === "cap" ? `${id} is a capacitor: it moves where the tone turns, not where the wave is clipped` : `${id} is a resistor: it sets a level or a corner, not where the wave is clipped`;
}

const STEPS: Step<BuildAt>[] = [
  {
    job: "Switch Q Drive on and open its board: B, or the board button",
    done: (s) => s.pedal === "drive" && s.lit.includes("drive") && s.board,
    why: (s) => {
      if (s.board && s.pedal !== "drive") return `The board shows the circuit you're playing${s.pedal ? "" : ", the amp's first tube"}: switch Q Drive on, and its board comes up`;
      return null;
    },
  },
  {
    job: "Swap its clipping diodes, D1 and D2: silicon for germanium or LEDs",
    done: (s) => ENDS.some((c) => c === clipperOf(s.swaps)),
    why: (s) => {
      const c = clipperOf(s.swaps);
      if (c === "mosfet") return `A MOSFET opens at about 1.2 V, between silicon and LEDs: a change, but a small one. For the plainest difference take an end: germanium (about 0.3 V) or LEDs (about 1.7 V)`;
      if (c === "none") return `With D1 and D2 out, nothing holds the op-amp back until its own rails: ${vsSilicon(s)}, loud and hard. A sound too, but this lesson is the diodes: put germanium or LEDs in`;
      const other = Object.keys(s.swaps).find((k) => k !== "D1");
      if (other) return `${otherPart(other)}. The clipping diodes are D1 and D2, the pair in the op-amp's feedback, drawn pointing both ways`;
      return null;
    },
  },
  {
    job: (s) => `Now the other end: ${s.tried.includes("germanium") ? "LEDs" : "germanium"} in D1 and D2`,
    done: (s) => ENDS.every((c) => s.tried.includes(c)),
    why: (s) => {
      const c = clipperOf(s.swaps);
      if (c === "germanium") return `Germanium: ${vsSilicon(s)}. It opens at about 0.3 V, so the wave rounds off sooner and softer: quieter, browner, more squashed. Put LEDs in to hear the other end`;
      if (c === "led") return `LEDs: ${vsSilicon(s)}. They open at about 1.7 V, so the wave swings further before it rounds off: louder and more open. Put germanium in to hear the other end`;
      return null;
    },
  },
];

export const BUILD_LESSON: PageLessonDef<BuildAt> = {
  id: "build", title: "Swap one part and hear why", blurb: "Open Q Drive's board, swap its clipping diodes for germanium, then LEDs, and read what each one does", steps: STEPS,
  end: (s) => {
    const at = (c: string) => volts(peakOf(s.drive, { ...s.swaps, D1: c }));
    return `Done. Germanium peaks at ${at("germanium")}, silicon at ${at("silicon")}, LEDs at ${at("led")}: the higher a diode's drop, the later it clips, louder and more open. Your board keeps ${nameOf(clipperOf(s.swaps))} in D1 and D2; Reset puts the stock silicon back`;
  },
};

/** The clipping part D1 and D2 hold now, for the page's `tried` list. */
export const clipperNow = clipperOf;
