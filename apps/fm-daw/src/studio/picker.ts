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

/**
 * Draw the cards into `host`: `current` marked, and a click on another calls `pick` (left out: read-only, every card
 * shown but none pressable).
 */
export function studioCards(host: HTMLElement, list: Studio[], current: string, pick?: (id: string) => void) {
  host.replaceChildren();
  host.setAttribute("role", "radiogroup");
  for (const s of list) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "studio-card";
    b.dataset.studio = s.id;
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(s.id === current));
    b.disabled = !pick;
    const name = document.createElement("b"), about = document.createElement("small");
    name.textContent = s.name;
    about.textContent = s.about;
    b.title = s.about;
    b.append(shot(s.def), name, about);
    if (pick) b.addEventListener("click", () => { if (s.id !== current) pick(s.id); });
    host.append(b);
  }
}
