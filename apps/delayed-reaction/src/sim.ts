// The game, with no page in it: a chart of calls, a run that judges the player's presses against
// each call's due beat, and nothing else. Time is in beats, so the same chart plays at any tempo.
//
// The rule that names the game: a key on the keyboard calls at beat b, and you answer it `delay`
// beats later, on the same lane. While you wait, more keys call, so you carry a queue in your head
// (the polyphony). A long key is a hold: press on its due beat, let go when it ends.
import { mulberry32 } from "@rustybuns/util";

export type Lane = 0 | 1 | 2 | 3;
export const LANES: readonly Lane[] = [0, 1, 2, 3];

export type Call = {
  id: number;
  lane: Lane;
  beat: number;      // when the keyboard calls it
  due: number;       // when you answer: beat + chart.delay
  hold: number;      // 0 for a tap; a hold wants a release at due + hold
  state: "pending" | "held" | "hit" | "missed";
  grade?: Grade;
};

export type Grade = "perfect" | "good";

export type Chart = {
  level: number;
  bpm: number;
  delay: number;     // beats between a call and its answer
  bars: number;      // length of the song, in bars of 4 beats
  calls: Call[];     // sorted by beat
};

// Hit windows either side of the due beat. Half a beat at 120 bpm is 250 ms, so these are
// 40 ms and 100 ms: forgiving on the phone, where the pad's own latency eats some of it.
export const PERFECT = 0.08;
export const GOOD = 0.2;
export const LIVES = 8;

export const LEVELS = [
  { bpm: 104, delay: 2, bars: 16, density: 0.7, holds: 0.0 },
  { bpm: 112, delay: 4, bars: 20, density: 0.6, holds: 0.15 },
  { bpm: 120, delay: 4, bars: 24, density: 0.8, holds: 0.2 },
  { bpm: 126, delay: 8, bars: 24, density: 0.8, holds: 0.25 },
  { bpm: 132, delay: 8, bars: 32, density: 1.0, holds: 0.3 },
  { bpm: 138, delay: 6, bars: 32, density: 1.2, holds: 0.35 },
] as const;

/** A chart for a level: seeded, so the same level is the same song every time you retry it. */
export function makeChart(level: number, seed = level * 7919): Chart {
  const spec = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, level - 1))]!;
  const rng = mulberry32(seed);
  const calls: Call[] = [];
  let id = 0, lastLane: Lane = 1;
  // The first bar is a count-in, the last `delay` beats need no calls (nothing could be answered).
  for (let bar = 1; bar < spec.bars; bar++) {
    const barBeat = bar * 4;
    // A phrase repeats every two bars with a twist, which is what makes it learnable by ear.
    const slots = [0, 1, 2, 3, 0.5, 1.5, 2.5, 3.5];
    for (const slot of slots) {
      const onBeat = slot === Math.floor(slot);
      const chance = (onBeat ? 0.55 : 0.2) * spec.density;
      if (rng() > chance) continue;
      // Nearby lanes more often than jumps: it plays like a melody, not static.
      const step = rng() < 0.6 ? (rng() < 0.5 ? -1 : 1) : Math.floor(rng() * 4) - 1;
      const lane = Math.max(0, Math.min(3, lastLane + step)) as Lane;
      lastLane = lane;
      const beat = barBeat + slot;
      const hold = onBeat && rng() < spec.holds ? 1 + Math.floor(rng() * 2) : 0;
      if (beat + spec.delay + hold > spec.bars * 4 - 1) continue;
      // No two calls on one lane closer than a beat: a thumb can't do that.
      const prev = calls.filter((c) => c.lane === lane).at(-1);
      if (prev && beat - (prev.beat + prev.hold) < 1) continue;
      calls.push({ id: id++, lane, beat, due: beat + spec.delay, hold, state: "pending" });
      if (hold) break; // a hold ends the bar's phrase
    }
  }
  calls.sort((a, b) => a.beat - b.beat);
  return { level, bpm: spec.bpm, delay: spec.delay, bars: spec.bars, calls };
}

export type Run = {
  chart: Chart;
  beat: number;
  score: number;
  combo: number;
  maxCombo: number;
  lives: number;
  hits: number;
  perfects: number;
  misses: number;
  over: "won" | "lost" | null;
};

export type Judgement =
  | { kind: "hit"; call: Call; grade: Grade; offset: number }
  | { kind: "miss"; call: Call }
  | { kind: "early"; lane: Lane }   // a press with nothing due on that lane: a small penalty, breaks the combo
  | { kind: "release"; call: Call; grade: Grade | "dropped" };

export function createRun(chart: Chart): Run {
  for (const c of chart.calls) { c.state = "pending"; delete c.grade; }
  return { chart, beat: 0, score: 0, combo: 0, maxCombo: 0, lives: LIVES, hits: 0, perfects: 0, misses: 0, over: null };
}

const gradeOf = (offset: number): Grade | null =>
  Math.abs(offset) <= PERFECT ? "perfect" : Math.abs(offset) <= GOOD ? "good" : null;

function miss(run: Run, call: Call): Judgement {
  call.state = "missed";
  run.misses++;
  run.combo = 0;
  run.lives--;
  if (run.lives <= 0) run.over = "lost";
  return { kind: "miss", call };
}

function reward(run: Run, grade: Grade) {
  run.combo++;
  run.maxCombo = Math.max(run.maxCombo, run.combo);
  run.hits++;
  if (grade === "perfect") run.perfects++;
  // A combo multiplies, capped so a long song isn't decided by one slip at the end.
  run.score += (grade === "perfect" ? 100 : 60) * Math.min(4, 1 + Math.floor(run.combo / 10));
}

/** Move the clock to `beat`: calls whose window closed unanswered are misses, and the run ends when the song does. */
export function advance(run: Run, beat: number): Judgement[] {
  run.beat = beat;
  const out: Judgement[] = [];
  if (run.over) return out;
  for (const c of run.chart.calls) {
    if (c.state === "pending" && beat > c.due + GOOD) out.push(miss(run, c));
    else if (c.state === "held" && beat > c.due + c.hold + GOOD) {
      // Held past the end without letting go: counts as a good release. A thumb that stays down is a thumb that stayed down.
      c.state = "hit";
      reward(run, "good");
      out.push({ kind: "release", call: c, grade: "good" });
    }
    if (run.over) break;
  }
  if (!run.over && beat >= run.chart.bars * 4 && run.chart.calls.every((c) => c.state === "hit" || c.state === "missed")) run.over = "won";
  return out;
}

/** A pad goes down at `beat`: answers the nearest due call on that lane, or counts as an early press. */
export function press(run: Run, lane: Lane, beat: number): Judgement {
  run.beat = Math.max(run.beat, beat);
  if (run.over) return { kind: "early", lane };
  let best: Call | null = null;
  for (const c of run.chart.calls) {
    if (c.lane !== lane || c.state !== "pending") continue;
    if (Math.abs(beat - c.due) > GOOD) continue;
    if (!best || Math.abs(beat - c.due) < Math.abs(beat - best.due)) best = c;
  }
  if (!best) {
    run.combo = 0;
    run.score = Math.max(0, run.score - 20);
    return { kind: "early", lane };
  }
  const offset = beat - best.due;
  const grade = gradeOf(offset)!;
  best.grade = grade;
  if (best.hold) {
    best.state = "held";
  } else {
    best.state = "hit";
    reward(run, grade);
  }
  return { kind: "hit", call: best, grade, offset };
}

/** The pad comes up at `beat`: ends a hold. Early is a drop (a miss); on time grades like a tap. */
export function release(run: Run, lane: Lane, beat: number): Judgement | null {
  run.beat = Math.max(run.beat, beat);
  const c = run.chart.calls.find((c) => c.lane === lane && c.state === "held");
  if (!c) return null;
  const grade = gradeOf(beat - (c.due + c.hold));
  if (!grade && beat < c.due + c.hold) {
    miss(run, c);
    return { kind: "release", call: c, grade: "dropped" };
  }
  c.state = "hit";
  const g = grade ?? "good";
  reward(run, c.grade === "perfect" && g === "perfect" ? "perfect" : "good");
  return { kind: "release", call: c, grade: g };
}

/** Calls in flight at `beat`: called, not yet answered. The queue the player is carrying. */
export const inFlight = (run: Run, beat = run.beat) =>
  run.chart.calls.filter((c) => c.beat <= beat && (c.state === "pending" || c.state === "held"));

/** Plain words for a delay, for the menu and the HUD. */
export const delayWords = (beats: number) =>
  beats === 4 ? "a bar later" : beats === 8 ? "two bars later" : beats % 4 === 0 ? `${beats / 4} bars later` : `${beats} beats later`;
