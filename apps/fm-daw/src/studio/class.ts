// A teacher's view of the class (#6087, PATHWAYS.md path 1): everyone in the jam room, the setup lesson each is in and
// the steps they've done, live. A class is the people in one sesh's jam room: the teacher opens a room and sends its
// link, as for any jam, and nothing else is made or signed in to. Each page says its own lesson on the live line (a
// `lesson` event, `lessonLine` below) when it changes and when someone new comes in; every page keeps what it heard on
// its Jam (`Other.lesson`), and `classOf` reads that back as a list. Pure: no DOM.
import type { Live } from "../project.ts";
import type { Jam } from "./jam.ts";
import { LESSONS, type Lessons } from "./lessons.ts";

export type LessonLine = Extract<Live, { t: "lesson" }>;

/** What goes on the live line about your lesson: the one you're in as it stands (or none), and the ones you've finished. */
export function lessonLine(now: ReturnType<Lessons["state"]>, finished: Iterable<string>): LessonLine {
  const why = now && now.next >= 0 ? now.steps[now.next].why : null;
  return {
    t: "lesson", id: now?.id ?? null,
    steps: (now?.steps ?? []).map((s) => ({ job: s.job.slice(0, 200), done: s.done })),
    ...(why ? { why: why.slice(0, 300) } : {}),
    finished: [...finished],
  };
}

/** One person on the class card: who, the lesson they're in (null: none) and how far, what's in their way, what they've finished. */
export type Pupil = { who: "me" | number; name: string; lesson: string | null; done: number; of: number; next: string | null; why: string | null; finished: string[] };

const titleOf = (id: string) => LESSONS.find((l) => l.id === id)?.title ?? id;

function pupil(who: "me" | number, name: string, l: LessonLine | null): Pupil {
  const steps = l?.steps ?? [], next = steps.find((s) => !s.done);
  return {
    who, name: name || "Someone", lesson: l?.id ? titleOf(l.id) : null,
    done: steps.filter((s) => s.done).length, of: steps.length,
    next: l?.id && next ? next.job : null, why: l?.why ?? null,
    finished: (l?.finished ?? []).map(titleOf),
  };
}

/**
 * The class as this page has heard it: everyone else in the room, then you. Those in a lesson come first, the ones
 * with something in their way first of all (that's who a teacher walks over to), then by how far they've got.
 */
export function classOf(j: Jam, mine: LessonLine): Pupil[] {
  const all = [...[...j.others].filter(([, o]) => o.name || o.avatar || o.lesson).map(([peer, o]) => pupil(peer, o.name, o.lesson)), pupil("me", "You", mine)];
  const rank = (p: Pupil) => (p.lesson ? (p.why ? 0 : 1) : 2);
  return all.sort((a, b) => rank(a) - rank(b) || (a.of ? a.done / a.of : 0) - (b.of ? b.done / b.of : 0));
}
