import { between, intBetween, next, pick } from "./rng.ts";
import {
  BURST_EXTRA, BURST_GAP, GOLD, MAX_DROPS, OVERFLOW_FACTOR, OVERFLOW_TICKS, SPAWN_END, SPAWN_START,
  SPEED, TICK_HZ, WEIGHTS, WEIGHTS_OVERFLOW,
} from "./rules.ts";
import type { Event, State } from "./types.ts";

export const inOverflow = (s: State) => s.tick >= s.roundTicks - OVERFLOW_TICKS;

/** Ticks between drips: ramps over the round, halved in overflow. */
export function spawnInterval(s: State): number {
  const p = Math.min(1, s.tick / s.roundTicks);
  const base = SPAWN_START + (SPAWN_END - SPAWN_START) * p;
  return Math.max(2, Math.round(inOverflow(s) ? base * OVERFLOW_FACTOR : base));
}

function drip(s: State, kind: number, out: Event[]) {
  const ang = next(s) * Math.PI * 2;
  const [lo, hi] = SPEED[kind]!;
  const v = between(s, lo, hi) / TICK_HZ;
  s.drops.push({ id: s.nextId++, kind, x: Math.cos(ang) * 0.3, y: Math.sin(ang) * 0.3, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, age: 0 });
  out.push({ t: "spawn", kind });
}

export function spawn(s: State, out: Event[]) {
  if (--s.spawnCd > 0) return;
  if (s.drops.length >= MAX_DROPS) { s.spawnCd = 3; return; }
  if (s.burst > 0) {
    s.burst--;
    drip(s, GOLD, out);
    s.spawnCd = s.burst > 0 ? BURST_GAP : spawnInterval(s);
    return;
  }
  const kind = pick(s, inOverflow(s) ? WEIGHTS_OVERFLOW : WEIGHTS);
  drip(s, kind, out);
  if (kind === GOLD) s.burst = intBetween(s, BURST_EXTRA[0], BURST_EXTRA[1]);
  s.spawnCd = s.burst > 0 ? BURST_GAP : spawnInterval(s);
}
