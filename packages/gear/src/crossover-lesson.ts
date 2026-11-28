// Set a tri-amp stack's crossover, then line the sub up with the tops (#6473): one lesson, run by Qollab Studio's gear
// room (apps/fm-daw lessons.ts) and Sound Guy Simulator's desert (apps/load-in). The amps' DSP arrives set wrong, one
// kind of wrong at each split (a gap, an overlap, a horn fed lows), and the sub stands in front of the tops. Each step
// is read from the bands as they are set, on this package's step checker. The splits are the Flashlight preset's
// (crossover.ts); where the sub stands is the lesson's own. Pure: no DOM (the plot and sliders are crossover-panel.ts).
import { alignMs, heardDb, placed, rigCrossover, sweep, wayWarnings, type ChannelDsp } from "./crossover.ts";
import type { Step } from "./steps.ts";

/** The rig the lesson is on. */
export const LESSON_RIG = "tri-amp";
/** How far the sub stands in front of the tops in the lesson, metres (ours, not a sheet's). */
export const SUB_AHEAD_M = 1.5;
/** A split within this share of the sheet's is on it (a slider lands that close). */
const NEAR = 0.05;
/** The sub's delay within this of the distance's, ms. */
const NEAR_MS = 0.4;

const preset = (): ChannelDsp[] => rigCrossover(LESSON_RIG).map((b) => b.dsp);
const hz = (v: number) => (v >= 1000 ? `${+(v / 1000).toFixed(2)} kHz` : `${Math.round(v)} Hz`);

/** The amps as the lesson finds them: a gap above the sub, the two mids overlapping, the 1" fed far too low. */
export function lessonStart(): ChannelDsp[] {
  const at: [number | null, number | null][] = [[null, 100], [220, 1300], [1100, 8000], [2500, null]];
  return preset().map((b, i) => {
    const [hp, lp] = at[i]!;
    return { ...b, ...(hp && b.hp ? { hp: { ...b.hp, hz: hp } } : {}), ...(lp && b.lp ? { lp: { ...b.lp, hz: lp } } : {}) };
  });
}

/** What the steps read: the bands as set, and how far the sub stands in front. */
export type CrossoverAt = { bands: readonly ChannelDsp[]; subAheadM: number };

const on = (v: number | undefined, want: number) => v !== undefined && Math.abs(v - want) <= want * NEAR;
/** The deepest hole (or with `top`, the highest bump) from half to twice a split, dB against the preset. */
function around(s: CrossoverAt, split: number, top = false): { db: number; hz: number } {
  const now = placed(s.bands, s.subAheadM), want = preset();
  let worst = { db: 0, hz: split };
  for (const f of sweep(split / 2, split * 2, 48)) {
    const db = heardDb(now, want, f);
    if (top ? db > worst.db : db < worst.db) worst = { db, hz: f };
  }
  return worst;
}

/** The split between band `i` and the one above it. */
function split(i: number, lower: string, upper: string): Step<CrossoverAt> {
  const want = preset()[i]!.lp!.hz;
  return {
    job: `Split the ${lower} from the ${upper} at ${hz(want)}: the ${lower}'s low-pass and the ${upper}'s high-pass`,
    done: ({ bands }) => on(bands[i]?.lp?.hz, want) && on(bands[i + 1]?.hp?.hz, want),
    why: (s) => {
      const lp = s.bands[i]?.lp?.hz, hp = s.bands[i + 1]?.hp?.hz;
      if (lp === undefined || hp === undefined) return "Both sides of the split need a filter: without one, a driver plays what it can't";
      const way = rigCrossover(LESSON_RIG)[i + 1]!, blows = wayWarnings(way.range, s.bands[i + 1]!).find((w) => w.includes("blow"));
      if (blows) return `Blown driver warning: ${blows}`;
      if (hp > lp * (1 + NEAR)) { const d = around(s, want); return `A gap: nothing carries ${hz(lp)} to ${hz(hp)}, and the sum is ${Math.abs(d.db).toFixed(0)} dB down at ${hz(d.hz)}`; }
      if (lp > hp * (1 + NEAR)) { const d = around(s, want, true); return `An overlap: both play ${hz(hp)} to ${hz(lp)}, and the sum is ${d.db.toFixed(0)} dB up at ${hz(d.hz)}`; }
      return `The two meet at ${hz(Math.sqrt(lp * hp))}: the sheet splits them at ${hz(want)}`;
    },
  };
}

export const CROSSOVER_STEPS: readonly Step<CrossoverAt>[] = [
  split(0, '21" sub', '12"'),
  split(1, '12"', '6.5"'),
  split(2, '6.5"', '1"'),
  {
    job: `Line the sub up with the tops: it stands ${SUB_AHEAD_M} m in front of them, and sound takes 2.9 ms a metre. Delay the sub, polarity normal`,
    done: ({ bands, subAheadM }) => !!bands[0] && bands[0].polarity === 1 && Math.abs(bands[0].delayMs - alignMs(subAheadM)) <= NEAR_MS,
    why: (s) => {
      const sub = s.bands[0]!, early = alignMs(s.subAheadM) - sub.delayMs, d = around(s, preset()[0]!.lp!.hz);
      if (sub.polarity !== 1) return "The sub's polarity is flipped: that hides some of the hole at one frequency and keeps the sub out of time. Set it back and use delay";
      return `The sub arrives ${Math.abs(early).toFixed(1)} ms ${early > 0 ? "before" : "after"} the tops${d.db < -1 ? `, a ${Math.abs(d.db).toFixed(0)} dB hole at ${hz(d.hz)}` : ""}: ${early > 0 ? "more" : "less"} delay on the sub`;
    },
  },
];
