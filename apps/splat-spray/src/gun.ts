// The gun's cadence, kept separate so it can be tested.
//
// A timer is the wrong tool: when a frame stalls, a timer queues its missed
// callbacks and then dumps them all at once (245 rounds in one second during
// testing). Rounds are due by the clock instead, at most `maxPerFrame` per
// frame, and a longer stall drops the backlog rather than emptying the magazine.

export interface Gun {
  ratePerSecond: number;
  /** cone of a single round, in degrees */
  spreadDeg: number;
  /** extra spread per second while the trigger is held */
  climbPerSecond: number;
  maxSpreadDeg: number;
  maxPerFrame: number;
}

export const DEFAULT_GUN: Gun = {
  ratePerSecond: 9,
  spreadDeg: 1.6,
  climbPerSecond: 1.1,
  maxSpreadDeg: 5,
  maxPerFrame: 2,
};

export interface Trigger { x: number; y: number; since: number; next: number }

export function pull(gun: Gun, x: number, y: number, now: number): Trigger {
  return { x, y, since: now, next: now + 1000 / gun.ratePerSecond };
}

/** Spread of the next round: wider the longer the trigger is held. */
export function spreadOf(gun: Gun, trigger: Trigger, now: number): number {
  return Math.min(gun.maxSpreadDeg, gun.spreadDeg + ((now - trigger.since) / 1000) * gun.climbPerSecond);
}

/** How many rounds are due now, advancing the trigger. Call once per frame. */
export function due(gun: Gun, trigger: Trigger, now: number): number {
  const interval = 1000 / gun.ratePerSecond;
  let rounds = 0;
  while (now >= trigger.next && rounds < gun.maxPerFrame) {
    trigger.next += interval;
    rounds++;
  }
  if (now >= trigger.next) trigger.next = now + interval;   // stalled: drop the backlog
  return rounds;
}
