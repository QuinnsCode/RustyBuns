// The game itself, as plain data and one step function: no DOM, so a test (and a server, later) runs it as it is.
// Stars fall; move the basket under them. A caught star scores, a missed one costs a life, three lives a round.
// Make it yours: this file is the one to rewrite first.
import { clamp, mulberry32 } from "@rustybuns/util";

export const W = 400, H = 600, BASKET = 70, LIVES = 3;

export interface Star { x: number; y: number; vy: number }
export interface World {
  phase: "menu" | "play" | "over";
  /** The basket's centre, 0..W. */
  x: number;
  stars: Star[];
  score: number;
  lives: number;
  /** Seconds into the round. */
  t: number;
  /** Seconds until the next star. */
  next: number;
  rand: () => number;
}

export function newWorld(seed = 1): World {
  return { phase: "menu", x: W / 2, stars: [], score: 0, lives: LIVES, t: 0, next: 0, rand: mulberry32(seed) };
}

/** A fresh round on the same world. */
export function start(w: World): void {
  Object.assign(w, { phase: "play", x: W / 2, stars: [], score: 0, lives: LIVES, t: 0, next: 0.5 });
}

/** Moves the world on by `dt` seconds, with the basket heading for `aim` (0..W). */
export function step(w: World, dt: number, aim: number): void {
  if (w.phase !== "play") return;
  w.t += dt;
  w.x = clamp(w.x + clamp(aim - w.x, -600 * dt, 600 * dt), BASKET / 2, W - BASKET / 2);
  w.next -= dt;
  if (w.next <= 0) {
    w.stars.push({ x: 20 + w.rand() * (W - 40), y: -10, vy: 120 + w.t * 4 + w.rand() * 60 });
    w.next = Math.max(0.25, 0.9 - w.t / 60);
  }
  for (const s of w.stars) s.y += s.vy * dt;
  const kept: Star[] = [];
  for (const s of w.stars) {
    if (s.y >= H - 40 && s.y <= H - 20 && Math.abs(s.x - w.x) <= BASKET / 2) w.score++;
    else if (s.y > H) w.lives--;
    else kept.push(s);
  }
  w.stars = kept;
  if (w.lives <= 0) w.phase = "over";
}
