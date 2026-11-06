// The wire between the page's DOM and an engine that paints it.
// Ops go out (the DOM changed), input comes back (the user did something to node n).
// Node 0 is the document; every other id is handed out once and never reused.
// Inline style travels as the "style" attribute; a stylesheet as its <style> or <link> node.

export type Op =
  | readonly ["el", id: number, tag: string]
  | readonly ["text", id: number, value: string]
  | readonly ["comment", id: number] // hydration markers: keep for order, never paint
  | readonly ["insert", parent: number, child: number, before: number | null]
  | readonly ["remove", parent: number, child: number]
  | readonly ["attr", id: number, name: string, value: string | null]
  | readonly ["prop", id: number, name: "value" | "checked", value: string | boolean]
  | readonly ["setText", id: number, value: string];

export type Input =
  | readonly ["click", id: number]
  | readonly ["input", id: number, value: string];

export const ROOT = 0;
