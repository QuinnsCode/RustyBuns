// @rustybuns/render (spike): write React, let an engine paint it, no migration.
//
// host() puts a recording `document` and `window` on globalThis with a #root
// container, so an app's own entry (`createRoot(document.getElementById("root"))
// .render(<App />)`) runs unchanged. Each change react-dom makes becomes an Op;
// frame() hands over what changed since the last frame, and send() feeds the
// engine's input (a click, typed text) back as real DOM events, so the app's
// handlers and React's state run exactly as in a browser.

import { RecDocument, RecElement, RecEvent, RecInput } from "./dom.ts";
import type { Input, Op } from "./ops.ts";

export { Mirror, type MirrorNode } from "./mirror.ts";
export { RecDocument, RecElement, RecEvent } from "./dom.ts";
export { ROOT, type Input, type Op } from "./ops.ts";

export interface Host {
  document: RecDocument;
  root: RecElement;
  /** The ops since the last frame, after React has flushed its work. */
  frame(): Promise<Op[]>;
  /** The engine's input, dispatched as the DOM event a browser would fire. */
  send(input: Input): void;
  /** Takes the globals back off. */
  close(): void;
}

const GLOBALS = ["window", "document", "HTMLElement", "HTMLIFrameElement", "Node", "Event"] as const;

export function host(): Host {
  const document = new RecDocument();
  const root = document.createRoot();
  root.setAttribute("id", "root");
  document.take();
  const window = {
    document, event: undefined as RecEvent | undefined, navigator: { userAgent: "rustybuns-render" },
    addEventListener() {}, removeEventListener() {}, getComputedStyle: () => ({}),
    HTMLIFrameElement: class {}, location: { href: "about:blank" },
  };
  document.defaultView = window;
  const g: Record<string, unknown> = globalThis as unknown as Record<string, unknown>;
  const saved = new Map(GLOBALS.map((k) => [k, Object.getOwnPropertyDescriptor(g, k)]));
  Object.assign(g, { window, document, HTMLElement: RecElement, HTMLIFrameElement: window.HTMLIFrameElement, Node: RecElement, Event: RecEvent });

  const fire = (id: number, type: string) => {
    const node = document.node(id);
    if (!node) return;
    const e = new RecEvent(type);
    window.event = e;
    try { node.dispatchEvent(e); } finally { window.event = undefined; }
  };

  return {
    document, root,
    async frame() {
      // React flushes discrete updates in a microtask and the rest on a macrotask.
      await new Promise((r) => setTimeout(r, 0));
      return document.take();
    },
    send(input) {
      if (input[0] === "click") return fire(input[1], "click");
      const field = document.node(input[1]);
      if (!(field instanceof RecInput)) return;
      // Typing changes the value without the property setter, so react-dom's tracker sees it as new.
      Object.getOwnPropertyDescriptor(RecInput.prototype, "value")?.set?.call(field, input[2]);
      fire(input[1], "input");
    },
    close() {
      for (const [k, d] of saved) { if (d) Object.defineProperty(g, k, d); else delete g[k]; }
    },
  };
}
