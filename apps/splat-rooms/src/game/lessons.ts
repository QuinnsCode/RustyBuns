// The first-time tutorial's steps (the coach is @rustybuns/util/tutorial): splat, spray, pick mode, the find. The hunt
// tells `learn` what the player just did; the flags stay set, so doing two at once moves the card on past both.
import type { TutorialStep } from "@rustybuns/util/tutorial";

export type Did = "shot" | "spray" | "pick" | "found";
export interface Learnt { shots: number; sprayed: boolean; picked: boolean; found: boolean }
export const newLearnt = (): Learnt => ({ shots: 0, sprayed: false, picked: false, found: false });

export function learn(l: Learnt, did: Did) {
  if (did === "shot") l.shots++;
  else if (did === "spray") l.sprayed = true;
  else if (did === "pick") l.picked = true;
  else l.found = true;
}

export const lessons = (l: Learnt): TutorialStep[] => [
  { title: "Splat the room", keys: ["Space"], say: "Each splat lights a patch of the dark room. Drag to look round.", done: () => l.shots >= 3 },
  { title: "Spray", keys: ["Shift", "Space"], say: "Twenty at once, for six charge. Charge comes back on its own.", done: () => l.sprayed },
  { title: "Switch to pick mode", keys: ["P"], say: "Once you think you can see the objective.", done: () => l.picked },
  { title: "Pick the objective", say: "Click it. A wrong pick costs four charge.", done: () => l.found },
];
