// One lesson on a BUILD sector's own page (#6085, PATHWAYS.md): the Event Planner's on /rooms.html, Q Amps' on
// /amp.html. The same @rustybuns/gear step checker the gear room's lessons (lessons.ts) and Sound Guy Simulator run on,
// read from the page's own state as it stands: a step is done when the page's real model says so, and the next one not
// done says what to do and, when something is in the way, what and why. Nothing is locked: leave whenever you like,
// and what you made stays. Pure: no DOM (the card is lesson-card.ts).
import { type Checked, type Step, checkSteps } from "@rustybuns/gear";

/** A lesson as the card draws it: its title, its steps as they stand, the next one to do, and whether it's all done. */
export type LessonView = { id: string; title: string; steps: Checked[]; next: number; done: boolean };

/** What a sector's lesson is: its id (the page's `?lesson=`), its title, a line on what you do, and its steps. */
export type PageLessonDef<S> = { id: string; title: string; blurb: string; steps: readonly Step<S>[] };

export class PageLesson<S> {
  on = false;
  /** Finished once on this page: what you made stays yours. */
  finished = false;

  /** `read` is the page's state now; `begin` sets the lesson's starting point up (as the page's own edits do). */
  constructor(readonly def: PageLessonDef<S>, private read: () => S, private begin?: () => void) {}

  get title() { return this.def.title; }
  start() { this.begin?.(); this.on = true; }
  leave() { this.on = false; }

  state(): LessonView | null {
    if (!this.on) return null;
    const steps = checkSteps(this.def.steps, this.read()), next = steps.findIndex((s) => !s.done), done = next < 0;
    if (done) this.finished = true;
    return { id: this.def.id, title: this.def.title, steps, next, done };
  }
}

/** The lesson a page's address asks for (`?lesson=plan`), if it is this page's. */
export const askedFor = (search: string, id: string) => new URLSearchParams(search).get("lesson") === id;
