// The first-time tutorial's steps (@rustybuns/util/tutorial): push, turn, ollie, flip, grind. Each step reads a flag
// that `learn` sets from the sim after every step and never clears, so a step done early is skipped past.
import type { TutorialStep } from "@rustybuns/util/tutorial";
import type { Input, State } from "./sim.ts";
import { showFront } from "./front/menu.ts";
import { touring } from "./levels/index.ts";

export type Learned = { pushed: boolean; turned: boolean; ollied: boolean; flipped: boolean; ground: boolean };
export const unlearned = (): Learned => ({ pushed: false, turned: false, ollied: false, flipped: false, ground: false });

const ROLLING = 2; // m/s along the board: moving, not just leaning on the throttle

/** After one sim step with input `inp`: what the rider has now done at least once. */
export function learn(l: Learned, sim: State, inp: Input) {
  if (inp.throttle > 0 && sim.speed > ROLLING) l.pushed = true;
  if (inp.steer !== 0 && Math.abs(sim.speed) > ROLLING) l.turned = true;
  if (sim.air && sim.popT >= 0) l.ollied = true;
  if (sim.tricks.length) l.flipped = true;
  if (sim.grind >= 0) l.ground = true;
}

export const steps = (l: Learned): TutorialStep[] => [
  { title: "Push", keys: ["W", "↑"], say: "Or the stick: roll forward and pick up some speed.", done: () => l.pushed },
  { title: "Turn", keys: ["A", "D"], say: "Carve left and right while you roll.", done: () => l.turned },
  { title: "Ollie", keys: ["Space"], say: "Snap the tail and pop the board into the air.", done: () => l.ollied },
  { title: "Flip it", keys: ["F"], say: "In the air: a kickflip. Land it to score.", done: () => l.flipped },
  { title: "Grind", say: "Ollie onto a rail or a ledge and ride along it.", done: () => l.ground },
];

/**
 * Whether this address is real play: a park picked from the title screen or a room. Not the title screen, the tour,
 * the showroom, or a check's jump link (a named spawn, a spot, a weak machine, the frame readout, no opening shot).
 */
export const realRide = (search: string) => {
  const q = new URLSearchParams(search);
  return !showFront(search) && !touring(search) && !["showroom", "spawn", "weak", "fps", "nosweep"].some((k) => q.has(k));
};
