// The lesson you are in, as a card at the top left: its steps ticked off as the gear says so, the next one to do, and,
// when something is in the way, what and why. Leave any time: nothing is undone. Done, it says what you made is yours.
// The jam room's setup lessons (lessons.ts) start from its ? card; a BUILD sector's page (page-lesson.ts) offers its
// own with a round cap button while none is on. Redrawn only when what it says changes.
import "./help.css";
import "./lesson-card.css";
import { icon } from "../amp/icons.ts";
import type { LessonView } from "./page-lesson.ts";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** What the card shows: any lesson that answers its state and can be left. */
export type LessonHost = { state(): LessonView | null; leave(): void };
export type CardOptions = {
  /** What the card says once every step is done. */
  done?: string;
  /** A page's own lesson, offered by a cap button while no lesson is on. */
  offer?: { title: string; start(): void };
  /** Pinned to the window's corner (a page with no HUD of its own) rather than inside `parent`. */
  float?: boolean;
};

export function mountLessonCard(parent: HTMLElement, lessons: LessonHost, o: CardOptions = {}) {
  const box = el("aside", o.float ? "lesson-float" : undefined);
  box.id = "lesson"; box.hidden = true;
  box.setAttribute("aria-live", "polite");
  const ask = o.offer ? el("button", `lesson-ask${o.float ? " lesson-float" : ""}`) : null;
  if (ask && o.offer) {
    ask.type = "button"; ask.title = `Lesson: ${o.offer.title}`; ask.setAttribute("aria-label", ask.title);
    ask.append(icon("graduation-cap"));
    ask.addEventListener("click", () => { o.offer!.start(); card.frame(); });
  }
  parent.append(box, ...(ask ? [ask] : []));
  let said = "";

  const card = {
    /** The card for the lesson as it stands, or hidden with none on (each frame, or after each change). */
    frame() {
      const s = lessons.state(), key = JSON.stringify(s);
      if (key === said) return;
      said = key;
      box.hidden = !s;
      if (ask) ask.hidden = !!s;
      if (!s) return box.replaceChildren();
      const head = el("header"), x = el("button", "lesson-x");
      x.type = "button"; x.title = "Leave the lesson: what you made stays"; x.setAttribute("aria-label", "Leave the lesson");
      x.append(icon("x"));
      x.addEventListener("click", () => { lessons.leave(); card.frame(); });
      head.append(icon("graduation-cap"), el("b", undefined, s.title), x);
      const ol = el("ol");
      s.steps.forEach((st, i) => {
        const li = el("li", st.done ? "done" : i === s.next ? "next" : undefined);
        li.append(icon(st.done ? "circle-check" : "circle", 16), el("span", undefined, st.job));
        ol.append(li);
      });
      const why = s.next >= 0 ? s.steps[s.next].why : null;
      const foot = s.done
        ? el("p", "lesson-done", o.done ?? "Done. This rig is yours now: keep playing, or take another lesson from ?")
        : why ? (() => { const p = el("p", "lesson-why"); p.append(icon("circle-alert", 16), el("span", undefined, why)); return p; })() : null;
      box.replaceChildren(head, ol, ...(foot ? [foot] : []));
    },
  };
  card.frame();
  return card;
}
