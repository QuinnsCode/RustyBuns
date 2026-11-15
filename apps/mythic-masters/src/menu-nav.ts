// Walking a menu page without a mouse: the arrows (or WASD), a d-pad or a stick move the focus from button to button
// by where they sit on the screen (stepTo, the same step the compendium's quill takes), and Enter, Space or A press
// the one that has it. The title, the Book's five, the result note, the versus book: any page the book shows.
import { stepTo, type Dir } from "./compendium.ts";

/** The buttons on `page` someone can press now: shown, not disabled, not inside a closed popover. */
export function pressable(page: HTMLElement): HTMLElement[] {
  return [...page.querySelectorAll<HTMLElement>("button, a[href], [tabindex]:not([tabindex='-1'])")].filter((el) => {
    if (el.matches(":disabled") || el.closest("[hidden], [popover]:not(:popover-open)")) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}

/** One step `dir` across `page`: the focus moves to the nearest button that way (the first one when none has it yet).
 * Returns the button now focused, or null when there is nothing that way. */
export function menuStep(page: HTMLElement, dir: Dir, visible = true): HTMLElement | null {
  const els = pressable(page);
  if (!els.length) return null;
  const at = els.indexOf(document.activeElement as HTMLElement);
  const spots = els.map((el, i) => { const r = el.getBoundingClientRect(); return { id: String(i), x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const to = at < 0 ? String(firstOf(els)) : stepTo(spots, String(at), dir);
  const el = to === null ? null : els[Number(to)] ?? null;
  // a focus moved by a pad shows its ring too (a key press shows it anyway)
  el?.focus({ preventScroll: false, focusVisible: visible } as FocusOptions);
  el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  return el;
}

/** Where the focus starts on a page: its main call (`.go`, the big red one) when it can be pressed, else the first
 * card to pick (the Book's five), else the first button (never the little ? in a heading when there is more). */
function firstOf(els: HTMLElement[]): number {
  for (const sel of [".go", ".card", ":not(.info)"]) { const i = els.findIndex((el) => el.matches(sel)); if (i >= 0) return i; }
  return 0;
}

/** A key as a menu step: the arrows and WASD. */
export function menuDir(code: string): Dir | null {
  return code === "ArrowUp" || code === "KeyW" ? "up" : code === "ArrowDown" || code === "KeyS" ? "down"
    : code === "ArrowLeft" || code === "KeyA" ? "left" : code === "ArrowRight" || code === "KeyD" ? "right" : null;
}
