// The wire between the page's DOM and an engine that paints it.
// Ops go out (DOM changed), input comes back (the user did something to node n).
// Node 0 is the root container; every other id is handed out once and never reused.

export type Op =
  | readonly ["el", id: number, tag: string]
  | readonly ["text", id: number, value: string]
  | readonly ["insert", parent: number, child: number, before: number | null]
  | readonly ["remove", parent: number, child: number]
  | readonly ["attr", id: number, name: string, value: string | null]
  | readonly ["style", id: number, prop: string, value: string | null]
  | readonly ["prop", id: number, name: "value" | "checked", value: string | boolean]
  | readonly ["setText", id: number, value: string];

export type Input =
  | readonly ["click", id: number]
  | readonly ["input", id: number, value: string];

export const ROOT = 0;
