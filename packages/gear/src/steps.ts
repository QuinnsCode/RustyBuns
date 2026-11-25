// A job list read from the state as it stands: each step says what to do, whether it is done, and, when it isn't, what
// is in the way in plain words and why it matters. Sound Guy Simulator's first-minute hints and its first gig's jobs,
// and Qollab Studio's setup lessons, all run on it, so a step is checked one way everywhere. Pure: no DOM.

/** One step: what to do (worded from the state when it names a thing), whether it's done, and what is wrong if it isn't. */
export type Step<S> = {
  job: string | ((s: S) => string);
  done: (s: S) => boolean;
  /** Not done: what is in the way and why, in plain words (null or left out: nothing wrong, just not done yet). */
  why?: (s: S) => string | null;
  /** The thing the step is about (an item's id), for a marker over it. */
  key?: (s: S) => string | undefined;
};

/** A step as checked: its words, done or not, and what is wrong. */
export type Checked = { job: string; done: boolean; why: string | null; key?: string };

/** Every step checked against `s`, in order. */
export function checkSteps<S>(list: readonly Step<S>[], s: S): Checked[] {
  return list.map((st) => {
    const done = st.done(s), key = st.key?.(s);
    return { job: typeof st.job === "string" ? st.job : st.job(s), done, why: done ? null : st.why?.(s) ?? null, ...(key ? { key } : {}) };
  });
}

/** The first step not done yet, checked, or null when every one is. Later steps aren't worded: cheap enough per frame. */
export function nextOf<S>(list: readonly Step<S>[], s: S): Checked | null {
  const st = list.find((x) => !x.done(s));
  return st ? checkSteps([st], s)[0] : null;
}
