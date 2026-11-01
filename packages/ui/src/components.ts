// Small DOM factories. Icons are passed in (a lucide element), never emojis; an icon button carries its word as a title.
import { installUi } from "./css.ts";

const el = <E extends HTMLElement>(node: E, className: string, props: Partial<E> = {}): E => Object.assign(node, { className }, props);

export interface ButtonOpts { label?: string; icon?: Element; primary?: boolean; onClick?: () => void }
/** A fat rounded button. Icon plus label: the label becomes the title and aria-label, so nothing wraps. */
export function button(o: ButtonOpts): HTMLButtonElement {
  installUi();
  const b = el(document.createElement("button"), `ui-btn${o.primary ? " primary" : ""}${o.icon ? " icon" : ""}`, { type: "button" });
  if (o.icon) { b.append(o.icon); if (o.label) { b.title = o.label; b.ariaLabel = o.label; } }
  else if (o.label) b.textContent = o.label;
  if (o.onClick) b.addEventListener("click", o.onClick);
  return b;
}

/** A pill that flips on and off. */
export function chip(label: string, on: (pressed: boolean) => void, pressed = false): HTMLButtonElement {
  installUi();
  const c = el(document.createElement("button"), "ui-chip", { type: "button", textContent: label });
  c.setAttribute("aria-pressed", String(pressed));
  c.addEventListener("click", () => { const p = c.getAttribute("aria-pressed") !== "true"; c.setAttribute("aria-pressed", String(p)); on(p); });
  return c;
}

export function toggle(checked: boolean, on: (v: boolean) => void): HTMLInputElement {
  installUi();
  const t = el(document.createElement("input"), "ui-toggle", { type: "checkbox", checked });
  t.addEventListener("change", () => on(t.checked));
  return t;
}

export function slider(o: { min: number; max: number; step: number; value: number }, on: (v: number) => void): HTMLInputElement {
  installUi();
  const s = el(document.createElement("input"), "ui-slider", { type: "range", min: String(o.min), max: String(o.max), step: String(o.step), value: String(o.value) });
  s.addEventListener("input", () => on(Number(s.value)));
  return s;
}

/** Tab buttons; the first starts selected. `on` gets the id of the tab picked. */
export function tabs(items: [id: string, label: string][], on: (id: string) => void): HTMLElement {
  installUi();
  const nav = el(document.createElement("div"), "ui-tabs", { role: "tablist" });
  const pick = (id: string) => { for (const b of nav.children) b.setAttribute("aria-selected", String(b.getAttribute("data-tab") === id)); on(id); };
  for (const [id, label] of items) {
    const b = el(document.createElement("button"), "ui-tab", { type: "button", role: "tab", textContent: label });
    b.setAttribute("data-tab", id);
    b.addEventListener("click", () => pick(id));
    nav.append(b);
  }
  nav.firstElementChild?.setAttribute("aria-selected", "true");
  return nav;
}

export function panel(...children: Node[]): HTMLElement {
  installUi();
  const p = el(document.createElement("div"), "ui-panel");
  p.append(...children);
  return p;
}

/** A dialog on the body: a card in the middle on a wide screen, a bottom sheet on a narrow one. Escape or a tap outside closes it. */
export function dialog(title: string, ...body: Node[]) {
  installUi();
  const scrim = el(document.createElement("div"), "ui ui-scrim", { hidden: true });
  const card = el(document.createElement("div"), "ui-panel ui-dialog", { role: "dialog" });
  card.ariaLabel = title;
  card.append(el(document.createElement("h2"), "", { textContent: title }), ...body);
  scrim.append(card);
  const show = (open: boolean) => { scrim.hidden = !open; };
  scrim.addEventListener("pointerdown", (e) => { if (e.target === scrim) show(false); });
  scrim.addEventListener("keydown", (e) => { if (e.code === "Escape") show(false); });
  document.body.append(scrim);
  return { el: scrim, open: () => show(true), close: () => show(false), isOpen: () => !scrim.hidden, destroy: () => scrim.remove() };
}

/** A short message at the bottom of the screen that goes away on its own. */
export function toast(text: string, ms = 2400): HTMLElement {
  installUi();
  let host = document.querySelector<HTMLElement>(".ui-toasts");
  if (!host) { host = el(document.createElement("div"), "ui ui-toasts"); document.body.append(host); }
  const t = el(document.createElement("div"), "ui-toast", { textContent: text });
  host.append(t);
  setTimeout(() => t.remove(), ms);
  return t;
}
