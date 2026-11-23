// The few DOM helpers the decks' faces share (panel.ts and mixer-panel.ts).

/** A tag with attributes and inner HTML. */
export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, html = ""): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html) e.innerHTML = html;
  return e;
};
/** A button: an icon (or a short word), its title the tooltip and the label. */
export const button = (icon: string, title: string, cls = "") => el("button", { type: "button", title, "aria-label": title, class: cls }, icon);
/** A range input. */
export const slider = (label: string, min: number, max: number, step: number, value: number, cls = "") =>
  el("input", { type: "range", min: String(min), max: String(max), step: String(step), value: String(value), "aria-label": label, title: label, class: cls });
/** A lucide-style icon (ISC) from its path markup. */
export const svg = (body: string) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
