// The first-time tutorial's steps (the coach is @rustybuns/util/tutorial): slide, chomp, land a barrel, bellow, see the
// round out. Pure like achievements.ts: `learn` reads the frames the game already draws and sets flags that stay set,
// so doing two things at once moves the card on past both.
import type { TutorialStep } from "@rustybuns/util/tutorial";
import type { Frame } from "./driver.ts";

export interface Learnt {
  /** How far this machine's hippos have slid along the rail, summed (the rail is -1..1). */
  slid: number;
  chomped: boolean;
  ate: boolean;
  bellowed: boolean;
  finished: boolean;
}
export const newLearnt = (): Learnt => ({ slid: 0, chomped: false, ate: false, bellowed: false, finished: false });

/** Fold one frame into `l`. */
export function learn(l: Learnt, f: Frame) {
  for (const s of f.mine) l.slid += Math.abs((f.cur.hippos[s]?.slide ?? 0) - (f.prev.hippos[s]?.slide ?? 0));
  for (const e of f.events) {
    if (!("seat" in e) || !f.mine.includes(e.seat)) continue;
    if (e.t === "gulp") l.chomped = true;
    else if (e.t === "eat") l.ate = true;
    else if (e.t === "bellow") l.bellowed = true;
  }
  if (f.phase === "podium" && l.chomped) l.finished = true;
}

export const lessons = (l: Learnt): TutorialStep[] => [
  { title: "Slide along the bank", keys: ["A", "D"], say: "A stick or the D-pad works too. On a phone, drag.", done: () => l.slid > 0.6 },
  { title: "Chomp", keys: ["W", "Space"], say: "Your jaws shoot out over the basin. On a phone, tap.", done: () => l.chomped },
  { title: "Chomp a drop of oil", say: "Line up under a falling drop and bite. Gold is worth the most.", done: () => l.ate },
  { title: "Bellow at the others", keys: ["Q"], say: "Let the other barons know whose oil it is.", done: () => l.bellowed },
  { title: "See the round out", say: "Keep chomping. Most oil in the bank when the clock stops wins.", done: () => l.finished },
];
