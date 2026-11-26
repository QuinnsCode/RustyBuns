// One lesson on a BUILD sector's own page (#6085, PATHWAYS.md): the Event Planner's on /rooms.html, Q Amps' and Q
// Builder's on /amp.html. The same @rustybuns/gear step checker the gear room's lessons (lessons.ts) and Sound Guy
// Simulator run on, read from the page's own state as it stands: a step is done when the page's real model says so, and
// the next one not done says what to do and, when something is in the way, what and why. Nothing is locked: leave
// whenever you like, and what you made stays. Pure: no DOM (the card is lesson-card.ts).
import { type Checked, type Step, checkSteps } from "@rustybuns/gear";

/** A lesson as the card draws it: its title, its steps as they stand, the next one to do, whether it's all done, and
 *  (done) the lesson's own last line. */
export type LessonView = { id: string; title: string; steps: Checked[]; next: number; done: boolean; end?: string };

/** What a sector's lesson is: its id (the page's `?lesson=`), its title, a line on what you do, its steps, and what the
 *  card says once they are all done, worded from the state (left out: the card's own line). */
export type PageLessonDef<S> = { id: string; title: string; blurb: string; steps: readonly Step<S>[]; end?: (s: S) => string };

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
    const at = this.read(), steps = checkSteps(this.def.steps, at), next = steps.findIndex((s) => !s.done), done = next < 0;
    if (done) this.finished = true;
    const end = done ? this.def.end?.(at) : undefined;
    return { id: this.def.id, title: this.def.title, steps, next, done, ...(end ? { end } : {}) };
  }
}

/** The lesson a page's address asks for (`?lesson=plan`), if it is this page's. */
export const askedFor = (search: string, id: string) => new URLSearchParams(search).get("lesson") === id;

/** A lesson as a page holds it, whatever state it reads. */
export type HeldLesson = { readonly def: { id: string; title: string }; readonly on: boolean; start(): void; leave(): void; state(): LessonView | null };

/** A page with more than one lesson (Q Amp holds Q Amps' and Q Builder's): one on at a time, the card drawing that one. */
export function oneAtATime(list: readonly HeldLesson[]) {
  return {
    list,
    state: () => list.find((l) => l.on)?.state() ?? null,
    leave: () => { for (const l of list) l.leave(); },
    /** Starts the lesson with this id, leaving any other; false when the page has none by that id. */
    start(id: string): boolean {
      const l = list.find((x) => x.def.id === id);
      if (!l) return false;
      for (const x of list) x.leave();
      l.start();
      return true;
    },
    /** The lesson the page's address asks for, if it has one by that id. */
    asked: (search: string) => list.find((l) => askedFor(search, l.def.id))?.def.id ?? null,
  };
}
