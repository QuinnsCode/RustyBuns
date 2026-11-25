// The setup lesson you are in (lessons.ts), as a card at the top left of the jam room: its steps ticked off as the
// gear says so, the next one to do, and, when something is in the way, what and why. Leave any time: nothing is
// undone. Done, it says the rig is yours, and the room plays on. Redrawn only when what it says changes.
import { icon } from "../amp/icons.ts";
import type { Lessons } from "./lessons.ts";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export function mountLessonCard(parent: HTMLElement, lessons: Lessons) {
  const box = el("aside");
  box.id = "lesson"; box.hidden = true;
  box.setAttribute("aria-live", "polite");
  parent.append(box);
  let said = "";

  return {
    /** Each frame: the card for the lesson as it stands, or hidden with none on. */
    frame() {
      const s = lessons.state(), key = JSON.stringify(s);
      if (key === said) return;
      said = key;
      box.hidden = !s;
      if (!s) return box.replaceChildren();
      const head = el("header"), x = el("button", "lesson-x");
      x.type = "button"; x.title = "Leave the lesson: what you built stays"; x.setAttribute("aria-label", "Leave the lesson");
      x.append(icon("x"));
      x.addEventListener("click", () => lessons.leave());
      head.append(icon("graduation-cap"), el("b", undefined, s.title), x);
      const ol = el("ol");
      s.steps.forEach((st, i) => {
        const li = el("li", st.done ? "done" : i === s.next ? "next" : undefined);
        li.append(icon(st.done ? "circle-check" : "circle", 16), el("span", undefined, st.job));
        ol.append(li);
      });
      const why = s.next >= 0 ? s.steps[s.next].why : null;
      const foot = s.done
        ? el("p", "lesson-done", "Done. This rig is yours now: keep playing, or take another lesson from ?")
        : why ? (() => { const p = el("p", "lesson-why"); p.append(icon("circle-alert", 16), el("span", undefined, why)); return p; })() : null;
      box.replaceChildren(head, ol, ...(foot ? [foot] : []));
    },
  };
}
