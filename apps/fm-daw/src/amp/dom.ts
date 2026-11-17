// The amp page's two element helpers, shared by the page and its bench slot.
import { icon } from "./icons.ts";

export const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", ...kids: (Node | string)[]) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  el.append(...kids);
  return el;
};

export const iconButton = (name: string, title: string, onClick: () => void) => {
  const b = h("button", "icon-btn", icon(name));
  b.title = title; b.setAttribute("aria-label", title); b.type = "button";
  b.addEventListener("click", onClick);
  return b;
};
