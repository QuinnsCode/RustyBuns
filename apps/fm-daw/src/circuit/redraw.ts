// A changed circuit's schematic (#6445). The circuit JSON carries no layout, so this edits the board's stock drawing
// (`circuits/<board>.schematic.svg`, our own file, in the shape `circuit-to-svg` writes it): everything left alone stays
// where it was; a removed part goes, with the wire that reached only it; an added part is drawn in clear space and wired to
// its nets; a moved end is wired to its new net. New wires carry the net's connectivity key, so a click scopes it.
// Pure: SVG text in, SVG text out.
import { bool, check, num, obj, oneOf, opt, str } from "@rustybuns/util/guard";
import { BOARDS, farads, ohms, type BoardId } from "./circuits.ts";
import { editedJson, type Edit } from "./builder.ts";

const Component = obj({ type: oneOf(["source_component"]), source_component_id: str(200), name: str(80), ftype: str(80), resistance: opt(num(0, 1e13)), capacitance: opt(num(0, 10)) });
const Port = obj({ type: oneOf(["source_port"]), source_port_id: str(200), source_component_id: str(200), name: str(80), subcircuit_connectivity_map_key: opt(str(400)) });
const Net = obj({ type: oneOf(["source_net"]), is_ground: opt(bool()), subcircuit_connectivity_map_key: opt(str(400)) });

interface Pt { x: number; y: number }
type Seg = [Pt, Pt];
interface Box { x0: number; y0: number; x1: number; y1: number }

// Sizes are in the units of a drawing at the usual scale: pins two steps apart, a two-pin part six long. Each board's
// drawing is scaled to fit its page, so what is added is scaled by the same `u`.
const STEP = 5.7748;
const LONG = 6 * STEP;
const RED = "rgb(132, 0, 0)", GREEN = "rgb(0, 150, 0)";

const n2 = (v: number) => Math.round(v * 100) / 100;
const near = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;
/** The point on `s` closest to `p`. */
function onto(p: Pt, [a, b]: Seg): Pt {
  const dx = b.x - a.x, dy = b.y - a.y, d = dx * dx + dy * dy;
  const t = d ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / d)) : 0;
  return { x: a.x + t * dx, y: a.y + t * dy };
}
const dist = (a: Pt, b: Pt) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const inside = (p: Pt, b: Box, pad = 0) => p.x > b.x0 - pad && p.x < b.x1 + pad && p.y > b.y0 - pad && p.y < b.y1 + pad;
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
function boxOf(pts: Pt[]): Box | null {
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

const attr = (el: string, name: string) => new RegExp(` ${name}="([^"]*)"`).exec(el)?.[1];

/** The drawing's top-level elements, each as its own text. */
function elements(svg: string): { head: string; els: string[] } {
  const tags = /<(\/?)[a-zA-Z][^>]*?(\/?)>/g, els: string[] = [];
  let depth = 0, from = 0, head = "";
  for (let m = tags.exec(svg); m; m = tags.exec(svg)) {
    const [all, close, self] = m;
    if (close) { if (--depth === 1) els.push(svg.slice(from, tags.lastIndex)); continue; }
    if (depth === 0) head = all;
    if (depth === 1) from = m.index;
    if (!self) depth++;
    else if (depth === 1) els.push(all);
  }
  return { head, els };
}

/** The points an element draws through: its paths', rects' and lines' corners, and roughly its text. */
function points(el: string, u: number): Pt[] {
  const out: Pt[] = [];
  for (const [tag, text] of el.matchAll(/<(?:path|rect|line|text)\b[^>]*>([^<]*<\/text>)?/g)) {
    const at = (x: string, y: string) => { const p = { x: Number(attr(tag, x)), y: Number(attr(tag, y)) }; if (Number.isFinite(p.x + p.y)) out.push(p); return p; };
    if (tag.startsWith("<path")) {
      const ns = (attr(tag, "d")?.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
      for (let i = 0; i + 1 < ns.length; i += 2) out.push({ x: ns[i], y: ns[i + 1] });
    } else if (tag.startsWith("<line")) { at("x1", "y1"); at("x2", "y2"); }
    else if (tag.startsWith("<rect")) { const p = at("x", "y"); out.push({ x: p.x + Number(attr(tag, "width")), y: p.y + Number(attr(tag, "height")) }); }
    else if (text && text !== "</text>" && !attr(tag, "transform")?.startsWith("rotate(-90")) {
      const p = at("x", "y"), w = (text.length - "</text>".length) * 6 * u, anchor = attr(tag, "text-anchor");
      const x0 = anchor === "middle" ? p.x - w / 2 : anchor === "end" ? p.x - w : p.x;
      out.push({ x: x0, y: p.y - 6 * u }, { x: x0 + w, y: p.y + 6 * u });
    }
  }
  return out;
}

/** A trace's segments. A gap in its path is where it hops another wire: still one wire. */
function segments(el: string): Seg[] {
  const d = /class="sch-trace-path" d="([^"]*)"/.exec(el)?.[1] ?? "";
  const pts = [...d.matchAll(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
  return pts.slice(1).map((p, i): Seg => [pts[i], p]).filter(([a, b]) => !near(a, b));
}

/** One net's wires as a graph: segments cut wherever another's end or a pin sits on them, each stretch once. */
function wireGraph(segs: Seg[], pins: Pt[]): Seg[] {
  const marks = [...segs.flat(), ...pins], nodes: Pt[] = [], out: Seg[] = [], seen = new Set<string>();
  const node = (p: Pt) => { let i = nodes.findIndex((q) => near(p, q)); if (i < 0) i = nodes.push(p) - 1; return i; };
  for (const s of segs) {
    const cuts = [s[0], s[1], ...marks.filter((m) => near(onto(m, s), m))].sort((a, b) => dist(s[0], a) - dist(s[0], b));
    for (let i = 1; i < cuts.length; i++) {
      const a = node(cuts[i - 1]), b = node(cuts[i]), key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (a !== b && !seen.has(key)) { seen.add(key); out.push([nodes[a], nodes[b]]); }
    }
  }
  return out;
}

const degree = (segs: Seg[], p: Pt) => segs.filter(([a, b]) => near(a, p) || near(b, p)).length;

/**
 * Takes the dead wire off `segs`: from each pin in `gone`, back to the first junction, pin that stays, or net label
 * (`stops`: a pin still on the wire may be joined to the rest of its net by that label).
 */
function prune(segs: Seg[], gone: Pt[], kept: Pt[], stops: (p: Pt) => boolean): { segs: Seg[]; dead: Pt[]; off: Seg[] } {
  let left = segs;
  const dead = [...gone], off: Seg[] = [];
  for (const start of gone) {
    let at = start;
    while (!kept.some((k) => near(k, at)) && (near(at, start) || !stops(at)) && degree(left, at) === 1) {
      const s = left.find(([a, b]) => near(a, at) || near(b, at))!;
      left = left.filter((x) => x !== s);
      off.push(s);
      at = near(s[0], at) ? s[1] : s[0];
      dead.push(at);
    }
  }
  return { segs: left, off, dead: dead.filter((p) => degree(left, p) === 0 && !kept.some((k) => near(k, p))) };
}

const pathOf = (segs: Seg[]) => segs.map(([a, b]) => `M ${n2(a.x)} ${n2(a.y)} L ${n2(b.x)} ${n2(b.y)}`).join(" ");
const dot = (p: Pt, u: number) => `<circle cx="${n2(p.x)}" cy="${n2(p.y)}" r="${n2(1.73 * u)}" class="trace-junction sch-trace-junction" fill="${GREEN}"/>`;
/** A wire as the drawing writes one: a wide unseen path to click, the wire, and its junction dots. */
function trace(key: string, segs: Seg[], dots: Pt[], u: number): string {
  const d = pathOf(segs);
  return `<g class="trace sch-trace" data-subcircuit-connectivity-map-key="${key}">`
    + `<path d="${d}" class="trace-invisible-hover-outline sch-trace-hitbox" stroke="${GREEN}" fill="none" stroke-width="${n2(9.24 * u)}" stroke-linecap="round" opacity="0"/>`
    + `<path class="sch-trace-path" d="${d}" stroke="${GREEN}" fill="none" stroke-width="${n2(1.15 * u)}" stroke-linecap="round" stroke-linejoin="round"/>${dots.map((p) => dot(p, u)).join("")}</g>`;
}

const line = (cls: string, d: string) => `<path class="${cls}" d="${d}" stroke="${RED}" fill="none" stroke-width="1.15" stroke-linecap="round"/>`;
const label = (cls: string, x: number, y: number, text: string, anchor = "start") =>
  `<text class="${cls}" x="${n2(x)}" y="${n2(y)}" fill="rgb(15, 15, 15)" font-family="sans-serif" text-anchor="${anchor}" dominant-baseline="middle" font-size="10.4px">${text}</text>`;

/** `body`, drawn at the origin, put at `p` at the drawing's scale. */
const place = (p: Pt, u: number, body: string) => `<g transform="translate(${n2(p.x)} ${n2(p.y)}) scale(${u.toFixed(3)})">${body}</g>`;

/** A ground symbol hung from `p`. */
function ground(p: Pt, u: number): string {
  const y = 2 * STEP;
  return `<g>${place(p, u, line("sch-net-label-symbol-path", `M 0 0 L 0 ${n2(y)} M -7 ${n2(y)} L 7 ${n2(y)}`)
    + label("sch-net-label-symbol-text", 0, y + 8, "GND", "middle"))}</g>`;
}

/** A two-pin part standing from `top`, pin1 uppermost unless `flip`. */
function part(name: string, ftype: string, value: string, top: Pt, flip: boolean, u: number): string {
  const x = 0, y = 0, mid = y + LONG / 2, f = (a: number, b: number) => `${n2(a)} ${n2(b)}`;
  const half = ftype === "simple_capacitor" ? 3.5 : ftype === "simple_resistor" ? 11 : 6;
  const leads = `M ${f(x, y)} L ${f(x, mid - half)} M ${f(x, mid + half)} L ${f(x, y + LONG)}`;
  const tip = flip ? mid - half : mid + half, base = flip ? mid + half : mid - half;
  const body = ftype === "simple_capacitor"
    ? `M ${f(x - 9, mid - half)} L ${f(x + 9, mid - half)} M ${f(x - 9, mid + half)} L ${f(x + 9, mid + half)}`
    : ftype === "simple_resistor" ? `M ${f(x - 5, mid - half)} L ${f(x + 5, mid - half)} L ${f(x + 5, mid + half)} L ${f(x - 5, mid + half)} Z`
    : `M ${f(x - 7, base)} L ${f(x + 7, base)} L ${f(x, tip)} Z M ${f(x - 7, tip)} L ${f(x + 7, tip)}`;
  return `<g class="sch-component added" data-part="${name}">` + place(top, u,
    `<rect class="component-overlay sch-component-overlay" x="${n2(x - 10)}" y="${n2(y)}" width="20" height="${n2(LONG)}" fill="transparent"/>`
    + line("sch-component-symbol-path", `${leads} ${body}`)
    + label("sch-component-name sch-component-text", x + 12, mid - 6, name)
    + (value ? label("sch-component-text", x + 12, mid + 7, value) : "")) + `</g>`;
}

/**
 * A right-angled way from `from` (first stepping `out`) to the nearest of `to`, round the parts in `solid` and not
 * along another net's wires (crossing one is fine). A short last jog lands exactly on the target.
 */
function route(from: Pt, out: Pt, to: Seg[], solid: Box[], others: Seg[], area: Box, step: number): Seg[] {
  const start = { x: from.x + out.x * 2 * step, y: from.y + out.y * 2 * step };
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  type Node = { i: number; j: number; dir: number; cost: number; back: Node | null };
  const at = (n: { i: number; j: number }) => ({ x: start.x + n.i * step, y: start.y + n.j * step });
  // The target and the other wires by step-square cell, so each step looks only at what is beside it.
  const index = (segs: Seg[]) => {
    const cells = new Map<string, Seg[]>();
    for (const s of segs) {
      const b = boxOf(s)!;
      for (let i = Math.floor(b.x0 / step) - 1; i <= Math.floor(b.x1 / step) + 1; i++) {
        for (let j = Math.floor(b.y0 / step) - 1; j <= Math.floor(b.y1 / step) + 1; j++) { const k = `${i},${j}`; const c = cells.get(k); if (c) c.push(s); else cells.set(k, [s]); }
      }
    }
    return (p: Pt) => cells.get(`${Math.floor(p.x / step)},${Math.floor(p.y / step)}`) ?? [];
  };
  const targets = index(to), foreign = index(others);
  const buckets: Node[][] = [[{ i: 0, j: 0, dir: DIRS.findIndex(([x, y]) => x === out.x && y === out.y), cost: 0, back: null }]];
  const seen = new Set<string>();
  for (let c = 0; c < buckets.length; c++) {
    for (let k = 0; k < (buckets[c]?.length ?? 0); k++) {
      const n = buckets[c][k], p = at(n), id = `${n.i},${n.j},${n.dir}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const hit = targets(p).map((s) => onto(p, s)).find((q) => Math.abs(q.x - p.x) <= step / 2 + 0.1 && Math.abs(q.y - p.y) <= step / 2 + 0.1);
      if (hit) {
        const path: Pt[] = [];
        for (let q: Node | null = n; q; q = q.back) path.unshift(at(q));
        const [dx] = DIRS[n.dir] ?? [0];
        const corner = dx ? { x: hit.x, y: p.y } : { x: p.x, y: hit.y };
        return straighten([from, ...path, corner, hit]);
      }
      DIRS.forEach(([dx, dy], dir) => {
        if ((dir + 2) % 4 === n.dir) return;
        const next = { i: n.i + dx, j: n.j + dy }, q = at(next);
        if (!inside(q, area) || solid.some((b) => inside(q, b, step / 3))) return;
        const along = foreign(q).some((s) => (s[0].x === s[1].x) === (dx === 0) && dist(onto(q, s), q) < step / 2);
        const cost = n.cost + 1 + (dir === n.dir ? 0 : 3) + (along ? 12 : 0);
        (buckets[cost] ??= []).push({ ...next, dir, cost, back: n });
      });
    }
  }
  // Walled in: a plain L to the nearest target.
  const hit = to.map((s) => onto(from, s)).sort((a, b) => dist(from, a) - dist(from, b))[0];
  return straighten([from, { x: from.x, y: hit.y }, hit]);
}

/** A walk's corners only, as segments. */
function straighten(path: Pt[]): Seg[] {
  const pts = path.filter((p, i) => !i || !near(p, path[i - 1]));
  const corners = pts.filter((p, i) => {
    const a = pts[i - 1], b = pts[i + 1];
    return !a || !b || !((Math.abs(a.x - p.x) < 0.01 && Math.abs(p.x - b.x) < 0.01) || (Math.abs(a.y - p.y) < 0.01 && Math.abs(p.y - b.y) < 0.01));
  });
  return corners.slice(1).map((p, i): Seg => [corners[i], p]);
}

/** `board`'s stock schematic `svg` redrawn for `edits`. With none (or no drawing), `svg` as it came. */
export function redraw(svg: string, board: BoardId, edits: readonly Edit[]): string {
  if (!edits.length || !svg) return svg;
  const stock: unknown[] = Array.isArray(BOARDS[board]) ? BOARDS[board] : [], now = editedJson(board, edits);
  const ports = (els: unknown[]) => els.map((e) => check(Port, e)).filter((p) => p !== null);
  const comps = (els: unknown[]) => els.map((e) => check(Component, e)).filter((c) => c !== null);
  const grounds = new Set(now.flatMap((e) => { const n = check(Net, e); return n?.is_ground ? [n.subcircuit_connectivity_map_key] : []; }));
  const before = ports(stock), after = ports(now), keyNow = new Map(after.map((p) => [p.source_port_id, p.subcircuit_connectivity_map_key]));

  const { head, els } = elements(svg);
  // circuit-to-svg writes its scale on the page: matrix(pixels per unit, ...).
  const step = Number(/data-real-to-screen-transform="matrix\(([\d.]+)/.exec(head)?.[1] ?? 10 * STEP) / 10, u = step / STEP, long = 6 * step;
  const pin = new Map<string, Pt>();
  for (const el of els) {
    const id = el.startsWith("<g class=\"schematic-port-hover") ? attr(el, "data-schematic-port-id") : undefined;
    if (id) pin.set(id, { x: Number(attr(el, "cx")), y: Number(attr(el, "cy")) });
  }
  const traceKey = (el: string) => (el.startsWith("<g class=\"trace") ? attr(el, "data-subcircuit-connectivity-map-key") : undefined);
  const wires = new Map<string, Seg[]>();
  for (const el of els) { const k = traceKey(el); if (k && el.startsWith("<g class=\"trace sch-trace\"")) wires.set(k, [...(wires.get(k) ?? []), ...segments(el)]); }
  for (const [k, segs] of wires) wires.set(k, wireGraph(segs, before.filter((p) => p.subcircuit_connectivity_map_key === k).flatMap((p) => pin.get(p.source_port_id) ?? [])));

  // Which stock pins left their net, and which parts have to be drawn afresh: the added ones, and one whose moved pin
  // a wire runs through (left where it is, it would still look joined to the old net).
  const moved = before.filter((p) => keyNow.has(p.source_port_id) && keyNow.get(p.source_port_id) !== p.subcircuit_connectivity_map_key);
  const stockIds = new Set(comps(stock).map((c) => c.source_component_id));
  const replaced = new Set(moved.filter((p) => degree(wires.get(p.subcircuit_connectivity_map_key ?? "") ?? [], pin.get(p.source_port_id)!) > 1).map((p) => p.source_component_id));
  const fresh = comps(now).filter((c) => !stockIds.has(c.source_component_id) || replaced.has(c.source_component_id));
  const nowIds = new Set(comps(now).map((c) => c.source_component_id));
  const erased = new Set(comps(stock).filter((c) => !nowIds.has(c.source_component_id) || replaced.has(c.source_component_id)).map((c) => c.name));

  const left = before.filter((p) => !nowIds.has(p.source_component_id) || replaced.has(p.source_component_id) || keyNow.get(p.source_port_id) !== p.subcircuit_connectivity_map_key);
  const stays = before.filter((p) => !left.includes(p));
  const keptPins = stays.flatMap((p) => pin.get(p.source_port_id) ?? []);
  const labelId = (el: string) => attr(el.slice(0, el.indexOf(">") + 1), "data-schematic-net-label-id");
  const labels = new Map<string, Pt[]>();
  for (const el of els) { const id = labelId(el); if (id) labels.set(id, [...(labels.get(id) ?? []), ...points(el, u)]); }
  const boxes = [...labels].flatMap(([id, pts]) => { const b = boxOf(pts); return b ? [{ id, ...b }] : []; });
  const labelled = (p: Pt) => boxes.some((b) => inside(p, b, 1));
  const dead: Pt[] = [], off: Seg[] = [], rewritten = new Set<string>();
  for (const k of new Set(left.map((p) => p.subcircuit_connectivity_map_key ?? ""))) {
    const gone = left.filter((p) => p.subcircuit_connectivity_map_key === k).flatMap((p) => pin.get(p.source_port_id) ?? []);
    const cut = prune(wires.get(k) ?? [], gone, stays.filter((p) => p.subcircuit_connectivity_map_key === k).flatMap((p) => pin.get(p.source_port_id) ?? []), labelled);
    off.push(...cut.off);
    if (cut.segs.length !== (wires.get(k)?.length ?? 0)) { wires.set(k, cut.segs); rewritten.add(k); }
    dead.push(...cut.dead);
  }

  // A net label or ground symbol that sat only on wire now gone goes with it, and so does a pin's name beside it.
  const live = [...wires.values()].flat(), alive = [...keptPins, ...live.flat()];
  const orphaned = new Set(boxes.filter((b) => dead.some((p) => inside(p, b, 1)) && !alive.some((p) => inside(p, b, 1))).map((b) => b.id));
  const beside = (p: Pt, segs: Seg[]) => segs.some((x) => dist(p, onto(p, x)) < 2 * step);
  const unnamed = (el: string) => {
    if (!el.startsWith("<text class=\"sch-text\"") || attr(el, "fill") !== RED) return false;
    const p = { x: Number(attr(el, "x")), y: Number(attr(el, "y")) };
    return beside(p, off) && !beside(p, live);
  };

  const gonePorts = new Set(before.filter((p) => !nowIds.has(p.source_component_id) || replaced.has(p.source_component_id)).map((p) => p.source_port_id));
  const kept = els.filter((el) => {
    const k = traceKey(el), part = el.startsWith("<g class=\"sch-component\"") ? attr(el.slice(0, el.indexOf(">") + 1), "data-part") : undefined;
    const port = el.startsWith("<g class=\"schematic-port-hover") ? attr(el, "data-schematic-port-id") : undefined;
    if (unnamed(el)) return false;
    return !(k && rewritten.has(k)) && !(part && erased.has(part)) && !(port && gonePorts.has(port)) && !orphaned.has(labelId(el) ?? "");
  });
  const added: string[] = [...rewritten].filter((k) => wires.get(k)!.length).map((k) => {
    const segs = wires.get(k)!;
    return trace(k, segs, segs.flat().filter((p, i, all) => all.findIndex((q) => near(p, q)) === i && degree(segs, p) > 2), u);
  });

  // What is in the way, and where each net can be joined: its wires and its pins that are still on it.
  const solid: Box[] = kept.filter((el) => !traceKey(el) && !el.startsWith("<rect class=\"boundary\"") && !el.startsWith("<g class=\"schematic-port-hover"))
    .flatMap((el) => boxOf(points(el, u)) ?? []);
  const reach = new Map<string, Seg[]>();
  const join = (k: string, segs: Seg[]) => reach.set(k, [...(reach.get(k) ?? []), ...segs]);
  for (const [k, segs] of wires) join(k, segs);
  for (const p of stays) { const at = pin.get(p.source_port_id); if (at) join(p.subcircuit_connectivity_map_key ?? "", [[at, at]]); }
  const allSegs = () => [...reach.values()].flat().filter(([a, b]) => !near(a, b));
  const extent = () => boxOf([...solid.flatMap((b) => [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y1 }]), ...allSegs().flat()]) ?? { x0: 0, y0: 0, x1: 0, y1: 0 };

  const wire = (from: Pt, out: Pt, key: string) => {
    const to = reach.get(key);
    if (!to?.length) { join(key, [[from, from]]); return; } // nothing drawn on that net yet: the next end comes here
    const e = extent(), room = 20 * step;
    const foreign = [...reach].filter(([k]) => k !== key).flatMap(([, s]) => s).filter(([a, b]) => !near(a, b));
    const segs = route(from, out, to, solid, foreign, { x0: e.x0 - room, y0: e.y0 - room, x1: e.x1 + room, y1: e.y1 + room }, step);
    if (!segs.length) return;
    const end = segs[segs.length - 1][1];
    added.push(trace(key, segs, to.some(([a, b]) => !near(a, b) && near(onto(end, [a, b]), end)) ? [end] : [], u));
    join(key, segs);
  };

  for (const c of fresh) {
    const [one, two] = ["pin1", "pin2"].map((name) => after.find((p) => p.source_component_id === c.source_component_id && p.name === name));
    if (!one || !two) continue;
    const gnd = (p: typeof one) => grounds.has(p.subcircuit_connectivity_map_key);
    // Ground goes underneath, as it's drawn everywhere; so a part with pin1 on ground stands upside down.
    const flip = gnd(one) && !gnd(two);
    const ends = flip ? [two, one] : [one, two];
    // The clear spot nearest what it joins: room for the part, its words, and a stub at each end.
    const e = extent(), busy = allSegs().map((s) => boxOf(s)!), near2 = (p: Pt, port: typeof one) =>
      gnd(port) ? 0 : Math.min(...(reach.get(port.subcircuit_connectivity_map_key ?? "") ?? []).map((s) => dist(p, onto(p, s))), 1e4);
    let best: Pt | null = null, cost = Infinity;
    for (let x = e.x0 - 8 * step; x <= e.x1 + 8 * step; x += 2 * step) {
      for (let y = e.y0 - 10 * step; y <= e.y1 + 10 * step; y += 2 * step) {
        const room = { x0: x - 3 * step, y0: y - 3 * step, x1: x + 9 * step, y1: y + long + 5 * step };
        if (solid.some((b) => overlaps(room, b)) || busy.some((b) => overlaps(room, b))) continue;
        const d = near2({ x, y }, ends[0]) + near2({ x, y: y + long }, ends[1]);
        if (d < cost) { cost = d; best = { x, y }; }
      }
    }
    const top = best ?? { x: e.x1 + 6 * step, y: e.y0 };
    const value = c.resistance !== undefined ? `${ohms(c.resistance)}Ω` : c.capacitance !== undefined ? farads(c.capacitance) : "";
    added.push(part(c.name, c.ftype, value, top, flip, u));
    solid.push({ x0: top.x - 10 * u, y0: top.y + 2 * u, x1: top.x + (12 + Math.max(c.name.length, value.length) * 6) * u, y1: top.y + long - 2 * u });
    const bottom = { x: top.x, y: top.y + long };
    wire(top, { x: 0, y: -1 }, ends[0].subcircuit_connectivity_map_key ?? "");
    if (gnd(ends[1])) { added.push(ground(bottom, u)); solid.push({ x0: top.x - 7 * u, y0: bottom.y + 2 * u, x1: top.x + 16 * u, y1: bottom.y + 4 * step }); }
    else wire(bottom, { x: 0, y: 1 }, ends[1].subcircuit_connectivity_map_key ?? "");
  }

  // A moved end on a part that stayed put: out of the pin, away from the part's other end.
  for (const p of moved) {
    const at = pin.get(p.source_port_id), other = before.find((q) => q.source_component_id === p.source_component_id && q !== p);
    const from = other && pin.get(other.source_port_id);
    if (replaced.has(p.source_component_id) || !at || !from) continue;
    const dx = at.x - from.x, dy = at.y - from.y;
    wire(at, Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) || 1 }, keyNow.get(p.source_port_id) ?? "");
  }

  return `${head}${kept.join("")}${added.join("")}</svg>\n`;
}
