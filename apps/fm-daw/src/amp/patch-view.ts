// Q Amp's patch, in 2D: a box per piece of gear with its jacks, and the cables
// hanging between them. Drag from a jack to another to run a cable (it is the kind
// the jack you started from takes); grab a plugged jack to pull that end out and
// carry it somewhere else, or drop it on nothing to unplug the cable.
// What it means (chains, problems) is `compile` in src/circuit/patch.ts.
import { GEAR, type Cable, type CableKind, type End, type Patch, type Problem } from "../circuit/patch.ts";

const NS = "http://www.w3.org/2000/svg";
const same = (a: End, b: End) => a[0] === b[0] && a[1] === b[1];
const COLOR: Record<CableKind, string> = { instrument: "#ffb000", speaker: "#6bc8ff", xlr: "#c08bff", power: "#9aa1ab" };

export interface PatchView {
  el: HTMLElement;
  /** Draw the cables and mark the jacks and gear the problems name. */
  show(patch: Patch, problems: Problem[]): void;
}

/** `change` gets the new cable list each time one is plugged or pulled. */
export function patchView(placed: Patch["placed"], change: (cables: Cable[]) => void): PatchView {
  const el = document.createElement("section");
  el.className = "patch";
  el.setAttribute("aria-label", "Patch: cables between the gear");
  const row = document.createElement("div");
  row.className = "patch-row";
  const svg = document.createElementNS(NS, "svg");
  svg.classList.add("patch-cables");
  const list = document.createElement("ul");
  list.className = "patch-problems";
  el.append(row, svg, list);

  const jacks = new Map<string, HTMLButtonElement>();
  const boxes = new Map<string, HTMLElement>();
  for (const p of placed) {
    const g = GEAR[p.gear];
    if (!g) continue;
    const box = document.createElement("div");
    box.className = `patch-gear gear-${g.kind}`;
    const name = document.createElement("span");
    name.className = "patch-name";
    name.textContent = g.name;
    box.append(name);
    // Inputs to the left of the name, in the order the gear lists them; outputs to the right.
    for (const j of g.jacks) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `jack ${j.kind} ${j.dir}`;
      b.dataset.item = p.id; b.dataset.jack = j.id;
      b.title = `${g.name} ${j.label ?? (j.dir === "in" ? "input" : "output")} (${j.kind})`;
      if (j.label) b.dataset.label = j.label;
      b.setAttribute("aria-label", b.title);
      if (j.dir === "in") name.before(b); else box.append(b);
      jacks.set(`${p.id}:${j.id}`, b);
    }
    boxes.set(p.id, box);
    row.append(box);
  }

  let cables: Cable[] = [];
  let shown: { patch: Patch; problems: Problem[] } = { patch: { placed, cables: [] }, problems: [] };
  /** A cable end in the hand: the end still plugged, the cable's kind, and where the pointer is. */
  let held: { anchor: End; kind: CableKind; x: number; y: number } | null = null;

  const centre = (end: End) => {
    const b = jacks.get(`${end[0]}:${end[1]}`), r = b?.getBoundingClientRect(), o = el.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2 - o.left, y: r.top + r.height / 2 - o.top } : null;
  };
  /** A cable hangs: the further apart its ends, the more it sags. */
  const curve = (a: { x: number; y: number }, b: { x: number; y: number }, color: string, cls = "") => {
    const path = document.createElementNS(NS, "path"), sag = 20 + Math.abs(b.x - a.x) * 0.25;
    path.setAttribute("d", `M${a.x},${a.y} C${a.x},${a.y + sag} ${b.x},${b.y + sag} ${b.x},${b.y}`);
    path.setAttribute("stroke", color);
    if (cls) path.setAttribute("class", cls);
    return path;
  };
  const draw = () => {
    const o = el.getBoundingClientRect();
    svg.setAttribute("viewBox", `0 0 ${o.width} ${o.height}`);
    const bad = new Set(shown.problems.filter((p) => p.kind === "wrong-cable").flatMap((p) => p.items));
    const paths = cables.flatMap((c) => {
      const a = centre(c.from), b = centre(c.to);
      const kind = c.kind ?? "instrument";
      return a && b ? [curve(a, b, COLOR[kind], bad.has(c.from[0]) && bad.has(c.to[0]) ? "bad" : "")] : [];
    });
    const a = held && centre(held.anchor);
    if (held && a) paths.push(curve(a, held, COLOR[held.kind], "held"));
    svg.replaceChildren(...paths);
  };

  const jackAt = (x: number, y: number): End | null => {
    const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>(".jack");
    return hit?.dataset.item && hit.dataset.jack ? [hit.dataset.item, hit.dataset.jack] : null;
  };
  const dirOf = (end: End) => GEAR[placed.find((p) => p.id === end[0])?.gear ?? ""]?.jacks.find((j) => j.id === end[1]);

  row.addEventListener("pointerdown", (e) => {
    const end = jackAt(e.clientX, e.clientY), jack = end && dirOf(end);
    if (!end || !jack) return;
    e.preventDefault();
    const o = el.getBoundingClientRect(), at = { x: e.clientX - o.left, y: e.clientY - o.top };
    const plugged = cables.find((c) => same(c.from, end) || same(c.to, end));
    if (plugged) {
      // Pull this end out: the cable stays in the other jack, its free end in the hand.
      cables = cables.filter((c) => c !== plugged);
      held = { anchor: same(plugged.from, end) ? plugged.to : plugged.from, kind: plugged.kind ?? jack.kind, ...at };
      change(cables);
    } else held = { anchor: end, kind: jack.kind, ...at };
    draw();
  });
  window.addEventListener("pointermove", (e) => {
    if (!held) return;
    const o = el.getBoundingClientRect();
    held.x = e.clientX - o.left; held.y = e.clientY - o.top;
    draw();
  });
  const letGo = (e: PointerEvent) => {
    if (!held) return;
    const end = jackAt(e.clientX, e.clientY), from = held.anchor, kind = held.kind;
    held = null;
    const a = dirOf(from), b = end && dirOf(end);
    const free = end && !cables.some((c) => same(c.from, end) || same(c.to, end));
    // Plugs in only on a free jack facing the other way; anywhere else the cable is unplugged.
    if (end && b && a && free && a.dir !== b.dir) {
      cables = [...cables, a.dir === "out" ? { from, to: end, kind } : { from: end, to: from, kind }];
      change(cables);
    }
    draw();
  };
  window.addEventListener("pointerup", letGo);
  window.addEventListener("pointercancel", () => { if (held) { held = null; draw(); } });
  new ResizeObserver(draw).observe(el);

  return {
    el,
    show(patch, problems) {
      cables = [...patch.cables];
      shown = { patch, problems };
      const named = new Set(problems.flatMap((p) => p.jack ? p.items.map((i) => `${i}:${p.jack}`) : []));
      for (const [key, b] of jacks) {
        const used = cables.some((c) => `${c.from[0]}:${c.from[1]}` === key || `${c.to[0]}:${c.to[1]}` === key);
        b.classList.toggle("plugged", used);
        b.classList.toggle("bad", named.has(key));
      }
      for (const [id, box] of boxes) box.classList.toggle("bad", problems.some((p) => p.items.includes(id)));
      list.replaceChildren(...problems.map((p) => {
        const li = document.createElement("li");
        li.className = p.kind;
        li.textContent = p.message;
        return li;
      }));
      draw();
    },
  };
}
