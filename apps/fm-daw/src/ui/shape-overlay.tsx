// The full Shape editor (Shape.tsx) over a page that isn't FM DAW's React app: the gear room's desk (src/room/main.ts)
// and the jam room's (src/studio/desk-panel.ts) open a strip's Shape here. One editor at a time, in a dialog; it
// reads the Shape from the page each time the page says it changed, so someone else's move shows too.
import { useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { EqDoc } from "../engine/eq.ts";
import { Shape } from "./Shape.tsx";
import "./shape-overlay.css";

export interface ShapeOverlay {
  /** Its name in the bar ("Return 1: Space", a player's name, "Master"). */
  title: string;
  /** The Shape as it is now. */
  doc(): EqDoc;
  onChange(doc: EqDoc): void;
  sampleRate: number;
  /** That channel's own sound, for the spectrum under the curve; without one the curve stands alone and says so. */
  analyser?: AnalyserNode | null;
  /** Read only: you can look, not move (the jam room's leader hasn't let you mix). */
  readOnly?(): boolean;
}

// lucide's x (ISC)
const X = <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>;

let open: { root: Root; host: HTMLElement; o: ShapeOverlay; version: number; listeners: Set<() => void>; off: () => void } | null = null;

function Panel({ o }: { o: ShapeOverlay }) {
  useSyncExternalStore((f) => { open?.listeners.add(f); return () => open?.listeners.delete(f); }, () => open?.version ?? 0);
  const ro = o.readOnly?.() ?? false;
  const head = (
    <span className="shape-overlay-head">
      <span className="silk">Shape · {o.title}</span>
      {!o.analyser && <span className="dim shape-overlay-note" title="The spectrum shows a channel's own sound only where FM DAW can hear it alone">no spectrum here</span>}
      <button type="button" className="ghost shape-overlay-close" title="Close" aria-label="Close Shape" onClick={closeShape}>{X}</button>
    </span>
  );
  return (
    <div className={ro ? "shape-overlay-ro" : ""}>
      <Shape key={o.title} head={head} doc={o.doc()} sampleRate={o.sampleRate} analyser={o.analyser ?? null} onChange={(d) => { if (!o.readOnly?.()) o.onChange(d); }} />
    </div>
  );
}

/** Open the editor on one Shape (closing any other). */
export function openShape(o: ShapeOverlay) {
  closeShape();
  const host = document.createElement("div");
  host.className = "shape-overlay";
  host.setAttribute("role", "dialog");
  host.setAttribute("aria-label", `Shape on ${o.title}`);
  // keys stay in the editor: the rooms walk on WASD and open things on Tab
  const keys = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); closeShape(); } e.stopPropagation(); };
  host.addEventListener("keydown", keys);
  document.body.append(host);
  const root = createRoot(host);
  open = { root, host, o, version: 0, listeners: new Set(), off: () => host.removeEventListener("keydown", keys) };
  root.render(<Panel o={o} />);
}

/** The page's Shapes may have moved: draw the open one again. */
export function refreshShape() {
  if (!open) return;
  open.version++;
  for (const f of open.listeners) f();
}

export function closeShape() {
  if (!open) return;
  const { root, host, off } = open;
  open = null;
  off();
  root.unmount();
  host.remove();
}

export const shapeOpen = () => open !== null;
