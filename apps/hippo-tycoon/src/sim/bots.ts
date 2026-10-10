// Bots are drivers: they read the state and produce the same Input a human
// does. They never touch a hippo. Memory and randomness are the caller's, so
// the same seed gives the same bots, and the spawn stream is never disturbed.
// native/crates/hippo_sim/src/bots.rs is the Rust twin, op for op.
import { A_REST, DROP_R, GOLD, GULP_OUT, LUNGE, NAIL, OIL, POINTS, RAIL_HALF, SCOOP_R, SLIDE_SPEED, SLUDGE, SORE_FACTOR, WALL_R, WATER, type Personality } from "./rules.ts";
import { hippoPoint, toFrame } from "./geom.ts";
import { next, type Rng } from "./rng.ts";
import { len } from "./trig.ts";
import type { Input, State } from "./types.ts";

export interface BotMem {
  /** Drop id being chased, 0 = none. */
  target: number;
  /** Aim error (slide units) rolled when the target was picked. */
  err: number;
  /** Tick of the next time the bot may pick a new target. */
  nextPlan: number;
  /** Bad drops this bot has "noticed" (by id): cautious bots remember. */
  known: Set<number>;
}
export const newBotMem = (): BotMem => ({ target: 0, err: 0, nextPlan: 0, known: new Set() });

const A_PEAK = A_REST - LUNGE;
const HORIZON = 40;
const FIRST_K = GULP_OUT + 1;   // press now -> the chomp lands after this many physics steps
const BAND = SCOOP_R * 0.6;

/** Best arrival for one drop: the step k whose position is closest to the jaws' reach, with its aim. */
function intercept(s: State, seat: number, id: number, slide: number, speed: number) {
  const d = s.drops.find((x) => x.id === id);
  if (!d) return null;
  let best: { k: number; aim: number; off: number } | null = null;
  for (let k = FIRST_K; k <= HORIZON; k++) {
    const x = d.x + d.vx * k, y = d.y + d.vy * k;
    if (len(x, y) > WALL_R - DROP_R) break;       // it would bounce; do not trust the line past here
    const { axial, lateral } = toFrame(seat, x, y);
    const aim = lateral / RAIL_HALF;
    if (Math.abs(aim) > 1) continue;
    if (Math.abs(aim - slide) / speed > k) continue;      // cannot get there in time
    const off = Math.abs(axial - A_PEAK);
    if (!best || off < best.off) best = { k, aim, off };
  }
  return best;
}

const isBad = (kind: number) => kind === SLUDGE || kind === NAIL || kind === WATER;

/** Does this bot see through a bad drop? Rolled once per drop, then remembered. */
function knows(d: { id: number; kind: number }, p: Personality, mem: BotMem, rng: Rng): boolean {
  if (!isBad(d.kind)) return false;
  if (!mem.known.has(d.id) && next(rng) < p.caution) mem.known.add(d.id);
  return mem.known.has(d.id);
}

/** What the bite would be worth, counting everything that would land in the jaws, as this bot sees it. */
function biteValue(s: State, seat: number, slide: number, k: number, p: Personality, mem: BotMem, rng: Rng): number {
  const j = hippoPoint(seat, slide, 1);
  let v = 0;
  for (const d of s.drops) {
    const dx = d.x + d.vx * k - j.x, dy = d.y + d.vy * k - j.y;
    if (dx * dx + dy * dy > SCOOP_R * SCOOP_R) continue;
    v += knows(d, p, mem, rng) ? Math.min(POINTS[d.kind]!, -0.5) : d.kind === GOLD ? 1 + 2 * p.greed : 1;
  }
  return v;
}

export function bot(s: State, seat: number, p: Personality, mem: BotMem, rng: Rng): Input {
  const h = s.hippos[seat]!;
  const speed = SLIDE_SPEED * (h.sore > 0 ? SORE_FACTOR : 1);
  const idle: Input = { move: 0, gulp: false, bellow: false };

  // pick a target every `reaction` ticks, or when the current one is gone
  if (mem.target && !s.drops.some((d) => d.id === mem.target)) mem.target = 0;
  if (!mem.target && s.tick >= mem.nextPlan) {
    mem.nextPlan = s.tick + p.reaction;
    let bestId = 0, bestV = 0, bestK = 1e9;
    for (const d of s.drops) {
      if (knows(d, p, mem, rng)) continue;
      const v = d.kind === GOLD ? 1 + 2 * p.greed : 1;
      const ic = intercept(s, seat, d.id, h.slide, speed);
      if (!ic || ic.off > BAND * 2) continue;
      if (v > bestV || (v === bestV && ic.k < bestK)) { bestId = d.id; bestV = v; bestK = ic.k; }
    }
    if (bestId) { mem.target = bestId; mem.err = (next(rng) * 2 - 1) * p.aimError; }
  }
  if (!mem.target) return idle;

  const ic = intercept(s, seat, mem.target, h.slide, speed);
  if (!ic || (ic.k === FIRST_K && ic.off > BAND)) { mem.target = 0; return idle; }
  const aim = Math.max(-1, Math.min(1, ic.aim + mem.err));
  const move = Math.max(-1, Math.min(1, (aim - h.slide) / speed));
  const ready = h.cooldown === 0 && h.gulp < 0 && h.sputter === 0;
  let fire = ready && ic.k === FIRST_K && ic.off <= BAND;
  // a bite takes everything in the jaws: hold off if it would cost more than it earns
  if (fire && biteValue(s, seat, h.slide, FIRST_K, p, mem, rng) <= 0) { fire = false; mem.target = 0; }
  if (fire) mem.target = 0;
  return { move, gulp: fire, bellow: false };
}
