// The flick pad's grip tape: a board drawn on the touch screen's flick half, nose up, with the profile's strokes
// printed on it like footprint grip tape: a pad where each finger goes and a dotted path for each stroke out of it,
// named at its tip. The stroke a press just matched lights up. It never takes a touch (the canvas under it does);
// the layout is picked in the Controls cog (controls-extras.ts).
import type { Profile, Stroke } from "./flick.ts";
import type { Flick } from "./tricks.ts";

const W = 100, H = 300; // the board picture, in its own units: nose at the top
const SHORT: Record<Flick, string> = {
  kickflip: "kick", heelflip: "heel", "shove-it": "shuv", varial: "varial", "varial heel": "v heel",
  hardflip: "hard", "inward heel": "inward", "tre flip": "tre", "laser flip": "laser",
  "frontside shove-it": "fs shuv", "360 shove-it": "360 shuv", "double kickflip": "2x kick", "double heelflip": "2x heel",
};
const NS = "http://www.w3.org/2000/svg";

/** What a stroke is called on the tape: its trick, else its pop. A path that pops is drawn orange, so "kick" in orange off the nose is a nollie kickflip. */
export const strokeLabel = (s: Stroke) => (s.flick ? SHORT[s.flick] : s.pop ?? "");

/** Where a stroke's path starts on the picture: on the nose pad, the tail pad, or mid-deck. */
const origin = (p: Profile, from: Stroke["from"]): [number, number] =>
  from === "nose" ? [W / 2, (p.nose * H) / 2] : from === "tail" ? [W / 2, H - (p.tail * H) / 2] : [W / 2, H / 2];

export type Grip = { along: (x: number, y: number) => number | null; show: (p: Profile) => void; hit: (s: Stroke | null) => void };

export function mountGrip(parent: HTMLElement): Grip {
  const root = Object.assign(document.createElement("div"), { className: "grip" });
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const name = Object.assign(document.createElement("div"), { className: "grip-name" });
  let shown: Profile | null = null, nameT = 0;
  const paths = new Map<Stroke, SVGGElement>();
  const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, into: Element = svg) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    into.append(e);
    return e;
  };

  const show = (p: Profile) => {
    shown = p;
    svg.replaceChildren();
    paths.clear();
    root.dataset.side = p.side;
    document.body.dataset.pad = p.side; // the stick and hold buttons move to the other side
    el("rect", { class: "deck", x: 4, y: 2, width: W - 8, height: H - 4, rx: (W - 8) / 2 });
    el("rect", { class: "zone", x: 4, y: 2, width: W - 8, height: p.nose * H, rx: (W - 8) / 2 });
    el("rect", { class: "zone", x: 4, y: H - 2 - p.tail * H, width: W - 8, height: p.tail * H, rx: (W - 8) / 2 });
    for (const z of ["nose", "tail"] as const) { const [x, y] = origin(p, z); el("ellipse", { class: "pad", cx: x, cy: y, rx: 15, ry: 19 }); }
    // Strokes from the same spot that point the same way (short and long) fan their labels out along the path.
    const seen = new Map<string, number>();
    for (const s of p.strokes) {
      const g = el("g", { class: `path ${s.pop ?? "flick"}` });
      paths.set(s, g);
      const [ox, oy] = origin(p, s.from);
      const label = strokeLabel(s);
      if (s.dir === "tap") {
        el("circle", { class: "tap-ring", cx: ox, cy: oy, r: 24 }, g);
        el("text", { x: ox, y: s.from === "tail" ? oy + 36 : oy - 30 }, g).textContent = `tap ${label}`; // outside the ring, off the deck's end
        continue;
      }
      if (s.from === "mid" && p.strokes.some((o) => o !== s && o.dir === s.dir && o.pop === s.pop && o.flick === s.flick)) continue; // the tail's path already shows it
      const key = `${s.from}:${Math.round(s.dir)}`, n = seen.get(key) ?? 0;
      seen.set(key, n + 1);
      const len = (s.min ?? p.minDrag) >= 2 * p.minDrag ? 78 : s.from === "nose" || s.from === "tail" ? 46 : 34, dx = Math.cos((s.dir * Math.PI) / 180), dy = -Math.sin((s.dir * Math.PI) / 180);
      const ex = ox + dx * len, ey = oy + dy * len;
      el("line", { x1: ox + dx * 12, y1: oy + dy * 12, x2: ex, y2: ey }, g);
      el("path", { class: "head", d: `M${ex + dx * 7} ${ey + dy * 7} L${ex - dy * 5} ${ey + dx * 5} L${ex + dy * 5} ${ey - dx * 5}Z` }, g);
      const beside = Math.abs(dx) < 0.3; // up or down the deck: name it beside the line, clear of the other end's paths
      const t = el("text", beside ? { x: (ox + ex) / 2 + 8, y: (oy + ey) / 2 + 4 + n * 11, class: "beside" } : { x: ex + dx * 16, y: ey + dy * 16 + 4 + n * 11 }, g);
      t.textContent = label;
    }
    name.textContent = p.name;
    name.dataset.on = "1";
    clearTimeout(nameT);
    root.dataset.hint = "1"; // the labels show for a few seconds, then leave the park clear
    nameT = window.setTimeout(() => { delete name.dataset.on; delete root.dataset.hint; }, 4000);
  };

  root.append(svg, name);
  parent.append(root);

  return {
    show,
    /** Where a press lands along the drawn board, 0 at the nose and 1 at the tail; null off it (a little slack either side). */
    along(x, y) {
      const r = svg.getBoundingClientRect();
      if (!r.height || x < r.left - r.width / 2 || x > r.right + r.width / 2 || y < r.top || y > r.bottom) return null;
      return (y - r.top) / r.height;
    },
    hit(s) {
      if (!shown || !s) return;
      const g = paths.get(s);
      if (!g) return;
      g.classList.remove("hit");
      void g.getBoundingClientRect(); // restart the flash when the same stroke lands twice
      g.classList.add("hit");
    },
  };
}
