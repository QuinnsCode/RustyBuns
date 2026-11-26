// The class card (L, class.ts, #6087): everyone in the room, the setup lesson each is in, a dot per step (filled: done),
// the step they're on, and what's in their way, so a teacher sees who to walk over to. Redrawn only when it changes.
import { icon } from "../amp/icons.ts";
import type { Pupil } from "./class.ts";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export function mountClassCard(parent: HTMLElement, read: () => Pupil[]) {
  const box = el("aside");
  box.id = "class"; box.hidden = true;
  box.setAttribute("aria-label", "Your class");
  parent.append(box);
  let said = "";

  function row(p: Pupil) {
    const li = el("li", p.why ? "stuck" : p.lesson && p.done === p.of ? "done" : undefined);
    const top = el("div", "class-who");
    top.append(el("b", undefined, p.name), el("span", undefined, p.lesson ?? "Not in a lesson"));
    li.append(top);
    if (p.lesson) {
      const dots = el("div", "class-dots");
      dots.title = `${p.done} of ${p.of} steps done`;
      for (let i = 0; i < p.of; i++) dots.append(el("i", i < p.done ? "on" : undefined));
      dots.append(el("small", undefined, `${p.done}/${p.of}`));
      li.append(dots);
      if (p.next) li.append(el("p", "class-next", p.next));
      if (p.why) { const w = el("p", "class-why"); w.append(icon("circle-alert", 14), el("span", undefined, p.why)); li.append(w); }
    }
    if (p.finished.length) {
      const f = el("p", "class-finished");
      f.title = p.finished.join(", ");
      f.append(icon("graduation-cap", 14), el("span", undefined, `${p.finished.length} finished`));
      li.append(f);
    }
    return li;
  }

  return {
    get open() { return !box.hidden; },
    toggle(on = box.hidden) { box.hidden = !on; said = ""; this.frame(); },
    /** A few times a second while open: the class as this page has heard it. */
    frame() {
      if (box.hidden) return;
      const ps = read(), key = JSON.stringify(ps);
      if (key === said) return;
      said = key;
      const head = el("header"), x = el("button", "lesson-x");
      x.type = "button"; x.title = "Close (L)"; x.setAttribute("aria-label", "Close");
      x.append(icon("x"));
      x.addEventListener("click", () => this.toggle(false));
      const inLesson = ps.filter((p) => p.lesson).length;
      head.append(icon("users"), el("b", undefined, `Your class: ${inLesson} of ${ps.length} in a lesson`), x);
      const ol = el("ol");
      for (const p of ps) ol.append(row(p));
      box.replaceChildren(head, ol, el("p", "class-hint", "Send the room's link to bring the class in. Each person starts a lesson from ?"));
    },
  };
}
