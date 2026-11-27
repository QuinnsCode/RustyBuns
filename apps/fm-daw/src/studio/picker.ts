// A studio from above (Settings shows the picked one, #6420), and a list that scrolls sideways under a mouse wheel or drag
// (the lobby's rooms and invites, the entry panel's friends).
import { thingBox, type StudioDef } from "./room.ts";

const SVG = "http://www.w3.org/2000/svg";
const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};

/** A studio from above: the floor in its colour, its walls (glass ones light), and each seat's instrument as a block. */
export function shot(def: StudioDef): SVGSVGElement {
  const { w, d } = def.size, pad = 0.4;
  const svg = el("svg", { viewBox: `${-w / 2 - pad} ${-d / 2 - pad} ${w + pad * 2} ${d + pad * 2}`, "aria-hidden": "true" });
  svg.append(el("rect", { x: -w / 2, y: -d / 2, width: w, height: d, fill: def.colors.floor, stroke: def.colors.walls, "stroke-width": 0.24 }));
  for (const wall of def.walls) {
    svg.append(el("line", { x1: wall.from[0], y1: wall.from[1], x2: wall.to[0], y2: wall.to[1], stroke: wall.glass ? "#9fc6d8" : def.colors.walls, "stroke-width": 0.16, "stroke-linecap": "round" }));
  }
  for (const s of def.spots) {
    const b = thingBox(s);
    svg.append(el("rect", { x: -b.hw, y: -b.hd, width: b.hw * 2, height: b.hd * 2, rx: 0.06, fill: s.thing.color, stroke: "#15171b", "stroke-width": 0.04,
      transform: `translate(${b.cx} ${b.cz}) rotate(${(-b.turn * 180) / Math.PI})` }));
  }
  const [dx, dz] = def.door.at;
  svg.append(el("circle", { cx: dx, cy: dz, r: 0.22, fill: "#ff6b4a" }));
  return svg;
}

const wired = new WeakSet<HTMLElement>();
/**
 * A row of cards scrolls sideways: a mouse wheel turns it, and a mouse drags it (touch already pans it); a drag is never
 * a click. The menu's lists (rooms, invites, friends) are rows like this.
 */
export function sideways(host: HTMLElement) {
  if (wired.has(host)) return;
  wired.add(host);
  host.addEventListener("wheel", (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    host.scrollBy({ left: e.deltaY });
  }, { passive: false });
  let drag: { x: number; left: number; moved: boolean } | null = null;
  host.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button === 0) drag = { x: e.clientX, left: host.scrollLeft, moved: false };
  });
  host.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) > 5) { drag.moved = true; host.classList.add("dragging"); }
    if (drag.moved) host.scrollLeft = drag.left - dx;
  });
  const stop = () => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    host.classList.remove("dragging");
    // the click that ends a drag lands on a card: swallow it
    if (moved) host.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); }, { capture: true, once: true });
  };
  host.addEventListener("pointerup", stop);
  host.addEventListener("pointerleave", stop);
}

