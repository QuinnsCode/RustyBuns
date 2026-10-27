// The game, with no page in it: a chart of calls, a runner who stands in one of four lanes, and a
// wall on each call's due beat with one door in it. Time is in beats, so the same chart plays at any tempo.
//
// The rule that names the game: a call rings in lane L at beat b, and `delay` beats later a wall
// arrives with its door in lane L. Be standing in L when it arrives and you run through; be anywhere
// else and you bounce. While you wait, more calls ring, so you carry a queue of doors in your head
// (the polyphony). A long door is a hold: stay in its lane until it ends.
import { mulberry32 } from "@rustybuns/util";

export type Lane = 0 | 1 | 2 | 3;
export const LANES: readonly Lane[] = [0, 1, 2, 3];

export type Call = {
  id: number;
  lane: Lane;
  beat: number;      // when the keyboard calls it
  due: number;       // when its wall arrives: beat + chart.delay, pulled in by the speed when the call rings
  hold: number;      // 0 for a tap; a long door wants you in its lane until due + hold
  state: "pending" | "held" | "hit" | "missed";
  rung?: true;       // the call has rung and its due beat is fixed
  grade?: Grade;
};

export type Grade = "perfect" | "good";

export type Chart = {
  level: number;
  bpm: number;
  delay: number;     // beats between a call and its answer
  hint: number;      // how loud the call's own echo plays on the due beat (0: you carry the timing yourself)
  bars: number;      // length of the song, in bars of 4 beats
  calls: Call[];     // sorted by beat
};

// Hit windows either side of the due beat. A beat at 140 bpm is 430 ms, so these are about
// 43 ms and 107 ms: forgiving on the phone, where the pad's own latency eats some of it.
export const PERFECT = 0.1;
export const GOOD = 0.25;
export const LIVES = 8;

// Speed: how fast the world looks and sounds, and how soon the next answer is due: a call that rings
// while you're fast has its wall pulled in (see `ring`), so the boost makes the run harder as well as faster.
// Through a door on time boosts it, a bounce off a wall cuts it back, and each
// beat it decays toward the floor on its own, so only a run that keeps answering stays fast.
export const SPEED_FLOOR = 1;
export const SPEED_CEILING = 2.5;
const BOOST = { perfect: 0.3, good: 0.12 } as const;
const FENCE_KEEPS = 0.25;  // the share of the boost above the floor a bounce off a wall leaves you
const DECAY = 0.96;        // the share of the boost above the floor that survives a beat
const PULL = 0.4;          // the share of its delay a call loses when it rings at the speed ceiling

export const LEVELS = [
  // Dub tempos: the drums are half-time, so 140 feels like 70. A bar of delay is the natural first
  // one (the answer sits where the call sat, one bar on). `hint` is the call echoing on its due beat,
  // loud at first so the music tells you when, gone by level five so you carry it yourself.
  { bpm: 120, delay: 4, bars: 16, density: 0.5, holds: 0.0, hint: 0.6 },
  { bpm: 128, delay: 4, bars: 20, density: 0.6, holds: 0.15, hint: 0.45 },
  { bpm: 136, delay: 4, bars: 24, density: 0.8, holds: 0.2, hint: 0.3 },
  { bpm: 140, delay: 8, bars: 24, density: 0.8, holds: 0.25, hint: 0.2 },
  { bpm: 144, delay: 8, bars: 32, density: 1.0, holds: 0.3, hint: 0 },
  { bpm: 148, delay: 6, bars: 32, density: 1.2, holds: 0.35, hint: 0 },
] as const;

/** A chart for a level: seeded, so the same level is the same song every time you retry it. */
export function makeChart(level: number, seed = level * 7919): Chart {
  const spec = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, level - 1))]!;
  const rng = mulberry32(seed);
  const calls: Call[] = [];
  let id = 0, lastLane: Lane = 1, holdEnd = 0;
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
      // The runner is in one place: nothing else can be due while a long door is still open.
      if (beat < holdEnd) continue;
      // No two calls on one lane closer than a beat: a thumb can't do that.
      const prev = calls.filter((c) => c.lane === lane).at(-1);
      if (prev && beat - (prev.beat + prev.hold) < 1) continue;
      calls.push({ id: id++, lane, beat, due: beat + spec.delay, hold, state: "pending" });
      if (hold) { holdEnd = beat + hold; break; } // a hold ends the bar's phrase
    }
  }
  calls.sort((a, b) => a.beat - b.beat);
  return { level, bpm: spec.bpm, delay: spec.delay, hint: spec.hint, bars: spec.bars, calls };
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
  speed: number;     // SPEED_FLOOR..SPEED_CEILING, read by the renderer and the music
  lane: Lane;        // where the runner stands across the floor
  over: "won" | "lost" | null;
  step: { from: number; at: number };  // the sidestep under way: where it started (lane units) and when
  bouncedAt: number;                   // the beat of the last bounce off a wall
};

export type Judgement =
  | { kind: "hit"; call: Call; grade: Grade; offset: number }   // through the door
  | { kind: "miss"; call: Call }                                // bounced off its wall
  | { kind: "move"; lane: Lane }                                // a sidestep: free, nothing judged
  | { kind: "release"; call: Call; grade: Grade | "dropped" };  // the end of a long door, or leaving it early

// The four places across the floor, in lane units either side of the middle.
const laneX = (lane: Lane) => lane - 1.5;
const STEP = 0.15;      // beats a sidestep takes
const KNOCK = 1;        // beats a knock-back takes to settle

export function createRun(chart: Chart): Run {
  for (const c of chart.calls) { c.state = "pending"; c.due = c.beat + chart.delay; delete c.grade; delete c.rung; }
  return {
    chart, beat: 0, score: 0, combo: 0, maxCombo: 0, lives: LIVES, hits: 0, perfects: 0, misses: 0,
    speed: SPEED_FLOOR, lane: 1, over: null, step: { from: laneX(1), at: -Infinity }, bouncedAt: -Infinity,
  };
}

/** Where to draw the runner at `beat`, -1.5 (far left) to 1.5 (far right), eased over the sidestep. */
export function runnerX(run: Run, beat: number): number {
  const t = Math.max(0, Math.min(1, (beat - run.step.at) / STEP));
  return run.step.from + (laneX(run.lane) - run.step.from) * (1 - (1 - t) ** 3);
}

/** How hard the runner is being thrown back at `beat`: 1 right after a bounce, 0 a beat later. */
export function knockback(run: Run, beat: number): number {
  const t = (beat - run.bouncedAt) / KNOCK;
  return t < 0 || t >= 1 ? 0 : (1 - t) ** 2;
}

// Move the run's clock forward, letting the speed fall back toward the floor for the beats that passed.
function tick(run: Run, beat: number) {
  if (beat > run.beat) run.speed = SPEED_FLOOR + (run.speed - SPEED_FLOOR) * DECAY ** (beat - run.beat);
  run.beat = Math.max(run.beat, beat);
}

// A call rings: fix when its wall arrives. The faster you're running, the sooner, in half beats so the
// echo hint still lands on the music's grid. Never closer than the chart's own spacing to the walls
// before it, so a boost can't stack two walls on one beat or put one inside a long door.
function ring(run: Run, c: Call) {
  c.rung = true;
  const t = (run.speed - SPEED_FLOOR) / (SPEED_CEILING - SPEED_FLOOR);
  let due = c.beat + run.chart.delay - Math.round(run.chart.delay * PULL * t * 2) / 2;
  for (const o of run.chart.calls) {
    if (o !== c && o.rung && o.beat <= c.beat) due = Math.max(due, o.due + o.hold + (o.lane === c.lane ? 1 : 0.5));
  }
  c.due = Math.min(due, c.beat + run.chart.delay);
}

const gradeOf = (offset: number): Grade | null =>
  Math.abs(offset) <= PERFECT ? "perfect" : Math.abs(offset) <= GOOD ? "good" : null;

// The wall: a life, the combo, most of the speed, and a knock-back.
function miss(run: Run, call: Call): Judgement {
  call.state = "missed";
  run.misses++;
  run.combo = 0;
  run.speed = SPEED_FLOOR + (run.speed - SPEED_FLOOR) * FENCE_KEEPS;
  run.bouncedAt = run.beat;
  run.lives--;
  if (run.lives <= 0) run.over = "lost";
  return { kind: "miss", call };
}

function reward(run: Run, grade: Grade) {
  run.combo++;
  run.maxCombo = Math.max(run.maxCombo, run.combo);
  run.hits++;
  if (grade === "perfect") run.perfects++;
  run.speed = Math.min(SPEED_CEILING, run.speed + BOOST[grade]);
  // A combo multiplies, capped so a long song isn't decided by one slip at the end.
  run.score += (grade === "perfect" ? 100 : 60) * Math.min(4, 1 + Math.floor(run.combo / 10));
}

// In the door: a tap is through it, a long door is entered and still has to be stayed in.
function through(run: Run, c: Call, grade: Grade, offset: number): Judgement {
  c.grade = grade;
  if (c.hold) c.state = "held";
  else { c.state = "hit"; reward(run, grade); }
  return { kind: "hit", call: c, grade, offset };
}

// A long door that ran its length: graded on how you came in.
function finishHold(run: Run, c: Call): Judgement {
  c.state = "hit";
  const grade = c.grade ?? "good";
  reward(run, grade);
  return { kind: "release", call: c, grade };
}

/** Move the clock to `beat`. Each wall that arrives lets the runner through if they're standing in its door,
 *  and bounces them if they still aren't once its window closes. The run ends when the song does. */
export function advance(run: Run, beat: number): Judgement[] {
  tick(run, beat);
  run.beat = beat;
  const out: Judgement[] = [];
  if (run.over) return out;
  for (const c of run.chart.calls) if (!c.rung && beat >= c.beat) ring(run, c);
  for (const c of run.chart.calls) {
    // Already standing in the door when the wall arrives: through, a good.
    if (c.state === "pending" && beat >= c.due && run.lane === c.lane) out.push(through(run, c, "good", 0));
    else if (c.state === "pending" && beat > c.due + GOOD) out.push(miss(run, c));
    else if (c.state === "held" && beat >= c.due + c.hold) out.push(finishHold(run, c));
    if (run.over) break;
  }
  if (!run.over && beat >= run.chart.bars * 4 && run.chart.calls.every((c) => c.state === "hit" || c.state === "missed")) run.over = "won";
  return out;
}

/** A pad goes down at `beat`: the runner sidesteps to that lane. Moving is free; arriving in a door inside its
 *  window is graded on how close to the due beat you got there, and leaving a long door early drops it. */
export function press(run: Run, lane: Lane, beat: number): Judgement[] {
  const out = advance(run, beat);
  if (run.over) return out;
  if (lane !== run.lane) {
    for (const c of run.chart.calls) {
      if (c.state !== "held") continue;
      if (beat < c.due + c.hold - GOOD) { miss(run, c); out.push({ kind: "release", call: c, grade: "dropped" }); }
      else out.push(finishHold(run, c));
    }
    run.step = { from: runnerX(run, beat), at: beat };
    run.lane = lane;
    out.push({ kind: "move", lane });
  }
  // Into the door (or a tap on the beat where you already stand): graded by the offset.
  let best: Call | null = null;
  for (const c of run.chart.calls) {
    if (c.lane !== lane || c.state !== "pending" || Math.abs(beat - c.due) > GOOD) continue;
    if (!best || Math.abs(beat - c.due) < Math.abs(beat - best.due)) best = c;
  }
  if (best && !run.over) out.push(through(run, best, gradeOf(beat - best.due)!, beat - best.due));
  return out;
}

/** The lanes with a pending call inside its window at `beat`: the pads to light up as "now". */
export const dueLanes = (run: Run, beat = run.beat): Set<Lane> =>
  new Set(run.chart.calls.filter((c) => c.state === "pending" && Math.abs(beat - c.due) <= GOOD).map((c) => c.lane));

/** Calls in flight at `beat`: called, not yet answered. The queue the player is carrying. */
export const inFlight = (run: Run, beat = run.beat) =>
  run.chart.calls.filter((c) => c.beat <= beat && (c.state === "pending" || c.state === "held"));

/** Plain words for a delay, for the menu and the HUD. */
export const delayWords = (beats: number) =>
  beats === 4 ? "a bar later" : beats === 8 ? "two bars later" : beats % 4 === 0 ? `${beats / 4} bars later` : `${beats} beats later`;
