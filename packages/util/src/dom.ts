/** A tag with its properties and children: `el("button", { type: "button", title: "Go" }, icon, "Go")`.
 * The return is annotated: left to inference it is `HTMLElementTagNameMap[K] & Partial<...>`, and reading a
 * property of that hit TS2590 under Bun 1.4.4 (#3838). */
export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e: HTMLElementTagNameMap[K] = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};
