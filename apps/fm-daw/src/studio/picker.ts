// The studio cards: every studio a room can be in, each with its name, a line on what it is and a shot of it from above
// (its floor, walls and what stands at each seat). The front door picks the studio a new room starts in; inside a room
// the leader picks one and the whole sesh walks into it, and everyone else sees the cards read-only.
import { thingBox, type StudioDef } from "./room.ts";
import type { Studio } from "./door.ts";

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

/** How many times the cards repeat on each side of the real list, so the row feels endless without wrapping round. */
export const COPIES = 7;

/**
 * The cards in their row, the way a phone's alarm wheel cheats: the list `copies` times, then the real one (copy 0),
 * then `copies` more, and the index to start on: the current studio in the real copy (its first studio when none is).
 */
export function wheel<T extends { id: string }>(list: T[], current: string, copies = COPIES): { cards: { s: T; copy: number }[]; start: number } {
  const cards: { s: T; copy: number }[] = [];
  for (let copy = -copies; copy <= copies; copy++) for (const s of list) cards.push({ s, copy });
  return { cards, start: copies * list.length + Math.max(0, list.findIndex((s) => s.id === current)) };
}

const wired = new WeakSet<HTMLElement>();
/** The row scrolls sideways: a mouse wheel turns it, and a mouse drags it (touch already pans it); a drag is never a click. */
function wire(host: HTMLElement) {
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

/** Put `card` in the middle of the row, now if the row is showing, else the first time it shows. */
function centre(host: HTMLElement, card: HTMLElement) {
  const go = () => { host.scrollLeft = card.offsetLeft - (host.clientWidth - card.offsetWidth) / 2; };
  if (host.clientWidth > 0) return go();
  const seen = new ResizeObserver(() => { if (host.clientWidth > 0 && card.isConnected) { seen.disconnect(); go(); } });
  seen.observe(host);
}

/**
 * Draw the cards into `host` as one sideways row (`wheel`), scrolled to the current studio: it is marked in every copy,
 * and a click on another card in any copy calls `pick` (left out: read-only, every card shown but none pressable). Only
 * the real copy is in the tab order and read out; the others are for the eye.
 */
export function studioCards(host: HTMLElement, list: Studio[], current: string, pick?: (id: string) => void) {
  host.replaceChildren();
  host.setAttribute("role", "radiogroup");
  wire(host);
  const shots = new Map(list.map((s) => [s.id, shot(s.def)]));
  const { cards, start } = wheel(list, current);
  const made = cards.map(({ s, copy }) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "studio-card";
    b.dataset.studio = s.id;
    b.dataset.copy = String(copy);
    if (copy === 0) {
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(s.id === current));
    } else {
      b.tabIndex = -1;
      b.setAttribute("aria-hidden", "true");
      if (s.id === current) b.dataset.current = "";
    }
    b.disabled = !pick;
    const name = document.createElement("b");
    name.textContent = s.name;
    b.title = s.about;
    const pic = shots.get(s.id);
    b.append(copy === 0 || !pic ? (pic ?? shot(s.def)) : pic.cloneNode(true), name);
    if (pick) b.addEventListener("click", () => { if (s.id !== current) pick(s.id); });
    return b;
  });
  host.append(...made);
  centre(host, made[start]);
}
