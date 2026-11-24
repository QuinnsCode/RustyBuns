// The studio builder (/rooms.html): start from one of the rooms, then size it, change what its floor, ceiling and
// walls are made of, hang panels on its walls, put up booths and drag seats and booths around on the plan. The side
// shows how long the space at the picked seat rings, Clap plays a clap through that seat's impulse response, and
// Walk in opens the room in /jam.html. Every change goes through the builder's edits (builder.ts), so the room is
// never left half built. Your room is kept in this browser. `window.qrooms` is the harness: state(), load(id), edit(e), pick(id).
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import "./rooms.css";
import { esc } from "@rustybuns/util";
import { check, oneOf } from "@rustybuns/util/guard";
import { boothMiddle, DECOR, DECOR_KINDS, type DecorKind, Edit, edit, furnish, newSpot, type Surface, yours, YOURS } from "./builder.ts";
import { BuildView, type Hit, type WallsMode } from "./build-view.ts";
import { footprint, gearPlace } from "./gear-wall.ts";
import type { Side, SpotKind, StudioDef } from "./room.ts";
import { ROOM_LIST } from "./rooms/index.ts";
import { acoustics, BANDS, impulse, MATERIAL_IDS, MATERIALS, type Material, PLAIN, wallMaterial } from "./sound.ts";
import { surface, wallSurface } from "./look.ts";

const $ = (id: string) => { const el = document.getElementById(id); if (!el) throw new Error(`#${id} missing`); return el; };
const plan = document.querySelector<SVGSVGElement>("#plan")!;
const SVG = "http://www.w3.org/2000/svg";
const SIDES: Side[] = ["front", "back", "left", "right"];
const KINDS = ["keys", "drums", "bass", "desk", "booth", "couch"] as const;

let room: StudioDef = yours() ?? structuredClone(ROOM_LIST[0]);
let picked: string | undefined = room.spots[0]?.id;
let why = "";

function save() { try { localStorage.setItem(YOURS, JSON.stringify(room)); } catch { /* private window: the room lives until reload */ } }
const preset = () => ROOM_LIST.find((r) => r.id === room.id && JSON.stringify(r) === JSON.stringify(room));

/** Do an edit (from the page's controls or the harness, so it is checked first); false and `why` if it can't be done. */
function apply(raw: unknown): boolean {
  const e = check(Edit, raw);
  if (!e) { why = "that isn't something the builder can do"; render(); return false; }
  const out = edit(room, e);
  why = out.ok ? "" : out.why;
  if (out.ok) { undos.push(room); if (undos.length > UNDOS) undos.shift(); redos.length = 0; }
  room = out.def;
  if (out.ok) save();
  render();
  return out.ok;
}

// ---- undo and redo: every edit that went through, as the room was before it (this page's session only) ----
const UNDOS = 100, undos: StudioDef[] = [], redos: StudioDef[] = [];
function undo(back = true) {
  const from = back ? undos : redos, to = back ? redos : undos, prev = from.pop();
  if (!prev) return false;
  to.push(room); room = prev; why = "";
  if (picked && !room.spots.some((s) => s.id === picked)) picked = room.spots[0]?.id;
  save(); render();
  return true;
}
window.addEventListener("keydown", (e: KeyboardEvent) => {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z" || e.target instanceof HTMLInputElement) return;
  e.preventDefault();
  undo(!e.shiftKey);
});

// ---- the plan, from above: +z (the front wall) is at the bottom ----

function el(tag: string, attrs: Record<string, string | number>, text?: string) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text !== undefined) n.textContent = text;
  return n;
}
// On the dark plan, the pale and the dark walls both need to show.
const tint = (m: Material) => m === "drywall" ? "#e8e2d4" : m === "foam" ? "#858a94" : m === "ceilingTile" ? "#9aa0a8" : MATERIALS[m].color;

function render() {
  const { w, d } = room.size, pad = Math.max(w, d) * 0.1 + 0.6;
  const scale = Math.max(1, Math.max(w, d) / 9);
  plan.setAttribute("viewBox", `${-w / 2 - pad} ${-d / 2 - pad} ${w + 2 * pad} ${d + 2 * pad}`);
  plan.replaceChildren();
  plan.append(el("rect", { class: "room", x: -w / 2, y: -d / 2, width: w, height: d, "stroke-width": 0.08 * scale }));
  // Panels, side by side along their outside wall.
  const used: Record<Side, number> = { front: 0, back: 0, left: 0, right: 0 }, next = { ...used };
  const span = (s: Side) => s === "left" || s === "right" ? d : w;
  for (const p of room.panels ?? []) used[p.wall] += p.m2 / room.size.h;
  for (const p of room.panels ?? []) {
    const len = p.m2 / room.size.h, a = -Math.min(used[p.wall], span(p.wall)) / 2 + next[p.wall], b = Math.min(a + len, span(p.wall) / 2);
    next[p.wall] += len;
    const [x1, z1, x2, z2] = p.wall === "front" ? [a, d / 2, b, d / 2] : p.wall === "back" ? [a, -d / 2, b, -d / 2] : p.wall === "left" ? [-w / 2, a, -w / 2, b] : [w / 2, a, w / 2, b];
    plan.append(el("line", { class: "panel", x1, y1: z1, x2, y2: z2, stroke: tint(p.material), "stroke-width": 0.22 * scale }));
  }
  // the floor's half-metre grid, as the 3D view has it
  for (let x = -Math.floor(w / 2 / 0.5) * 0.5; x <= w / 2 + 1e-6; x += 0.5) plan.append(el("line", { class: "grid", x1: x, y1: -d / 2, x2: x, y2: d / 2, "stroke-width": 0.02 * scale }));
  for (let z = -Math.floor(d / 2 / 0.5) * 0.5; z <= d / 2 + 1e-6; z += 0.5) plan.append(el("line", { class: "grid", x1: -w / 2, y1: z, x2: w / 2, y2: z, "stroke-width": 0.02 * scale }));
  // Inside walls, with their doorways left open.
  for (const [i, wl] of room.walls.entries()) {
    const [x0, z0] = wl.from, [x1, z1] = wl.to, len = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / len, uz = (z1 - z0) / len;
    const gaps = [...(wl.gaps ?? [])].sort((a, b) => a[0] - b[0]);
    const runs: [number, number][] = [];
    let from = 0;
    for (const [a, b] of gaps) { if (a > from) runs.push([from, a]); from = Math.max(from, b); }
    if (from < len) runs.push([from, len]);
    const g = el("g", wl.booth ? { "data-booth": wl.booth } : { "data-wall": i });
    for (const [a, b] of runs) g.append(el("line", { class: `wall${wl.booth ? " movable" : ""}`, x1: x0 + ux * a, y1: z0 + uz * a, x2: x0 + ux * b, y2: z0 + uz * b, stroke: tint(wallMaterial(wl)), "stroke-width": 0.14 * scale }));
    plan.append(g);
  }
  // the set dressing, as outlines you can drag
  (room.props ?? []).forEach((p, i) => {
    // the outer group slides while dragged, the inner one keeps the turn
    const g = el("g", { "data-prop": i }), turned = el("g", { transform: `rotate(${(-p.yaw * 180) / Math.PI} ${p.at[0]} ${p.at[1]})` });
    turned.append(el("rect", { class: "prop", x: p.at[0] - p.w / 2, y: p.at[1] - p.d / 2, width: p.w, height: p.d, "stroke-width": 0.03 * scale }));
    g.append(turned); plan.append(g);
  });
  // the gear wall's corner: the rack along its long side, dragged like a booth
  const gear = footprint(room), g = el("g", { "data-gear": "gear" });
  g.append(el("polygon", { class: "gear movable", points: gear.map((p) => p.join(",")).join(" "), "stroke-width": 0.06 * scale }));
  g.append(el("line", { class: "rack", x1: gear[0][0], y1: gear[0][1], x2: gear[1][0], y2: gear[1][1], "stroke-width": 0.16 * scale }));
  g.append(el("text", { x: gear.reduce((t, p) => t + p[0], 0) / 4, y: gear.reduce((t, p) => t + p[1], 0) / 4, "font-size": 0.32 * scale }, "gear"));
  plan.append(g);
  // the blueprint's dimensions: the width along the top, the depth down the left side, with ticks at the ends
  const off = 0.32 * scale + 0.2;
  plan.append(el("line", { class: "dim", x1: -w / 2, y1: -d / 2 - off, x2: w / 2, y2: -d / 2 - off, "stroke-width": 0.02 * scale }));
  plan.append(el("line", { class: "dim", x1: -w / 2 - off, y1: -d / 2, x2: -w / 2 - off, y2: d / 2, "stroke-width": 0.02 * scale }));
  for (const [x1, y1, x2, y2] of [[-w / 2, -d / 2 - off - 0.1, -w / 2, -d / 2 - off + 0.1], [w / 2, -d / 2 - off - 0.1, w / 2, -d / 2 - off + 0.1], [-w / 2 - off - 0.1, -d / 2, -w / 2 - off + 0.1, -d / 2], [-w / 2 - off - 0.1, d / 2, -w / 2 - off + 0.1, d / 2]] as const)
    plan.append(el("line", { class: "dim", x1, y1, x2, y2, "stroke-width": 0.02 * scale }));
  plan.append(el("text", { class: "dim-text", x: 0, y: -d / 2 - off - 0.12 * scale, "font-size": 0.28 * scale }, `${w.toFixed(1)} m`));
  const side = el("text", { class: "dim-text", x: -w / 2 - off - 0.12 * scale, y: 0, "font-size": 0.28 * scale, transform: `rotate(-90 ${-w / 2 - off - 0.12 * scale} 0)` }, `${d.toFixed(1)} m`);
  plan.append(side);
  const [dx, dz] = room.door.at;
  plan.append(el("path", { "data-door": 1, class: "door", d: `M ${dx - 0.3 * scale} ${dz + 0.25 * scale} L ${dx} ${dz - 0.25 * scale} L ${dx + 0.3 * scale} ${dz + 0.25 * scale}`, "stroke-width": 0.06 * scale }));
  for (const sp of room.spots) {
    const g = el("g", { "data-spot": sp.id });
    g.append(el("circle", { class: `spot${sp.id === picked ? " on" : ""}`, cx: sp.at[0], cy: sp.at[1], r: 0.32 * scale, "stroke-width": 0.06 * scale }));
    g.append(el("text", { x: sp.at[0], y: sp.at[1] + 0.68 * scale, "font-size": 0.32 * scale }, sp.id));
    plan.append(g);
  }
  $("why").textContent = why;
  $("about").textContent = room.about ?? "";
  select.value = preset()?.id ?? "";
  renderSound();
  renderEdit();
  renderTools();
  if (view === "3d") build?.show(room, picked, walls);
}

// ---- build mode: one set of tools, on the blueprint and in the 3D view alike ----

type Tool = "move" | "wall" | "door" | "window" | "booth" | "place" | "decor" | "paint" | "turn" | "remove";
const TOOLS: { id: Tool; name: string; icon: string }[] = [
  { id: "move", name: "Move: drag a seat, a booth, a piece of furniture, the gear wall or the way in", icon: `<path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/>` },
  { id: "wall", name: "Wall: drag across the floor to put one up", icon: `<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 9v6"/><path d="M16 15v6"/><path d="M16 3v6"/><path d="M3 15h18"/><path d="M3 9h18"/><path d="M8 15v6"/><path d="M8 3v6"/>` },
  { id: "door", name: "Doorway: click a wall to knock one through, again to brick it up", icon: `<path d="M11 20H2"/><path d="M11 4.562v16.157a1 1 0 0 0 1.242.97L19 20V5.562a2 2 0 0 0-1.515-1.94l-4-1A2 2 0 0 0 11 4.561z"/><path d="M11 4H8a2 2 0 0 0-2 2v14"/><path d="M14 12h.01"/><path d="M22 20h-3"/>` },
  { id: "window", name: "Window: click an outside wall to put a window in it", icon: `<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/><path d="M3 12h18"/>` },
  { id: "booth", name: "Booth: click the floor to put up a vocal booth", icon: `<path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/>` },
  { id: "place", name: "Place: pick from the catalog, click the floor", icon: `<path d="M5 12h14"/><path d="M12 5v14"/>` },
  { id: "decor", name: "Decorate: pick a piece from the catalog, click the floor", icon: `<path d="M8 2h8l4 10H4L8 2Z"/><path d="M12 12v6"/><path d="M8 22v-2c0-1.1.9-2 2-2h4a2 2 0 0 1 2 2v2H8Z"/>` },
  { id: "paint", name: "Paint: pick a material, click the floor or a wall", icon: `<rect width="16" height="6" x="2" y="2" rx="2"/><path d="M10 16v-2a2 2 0 0 1 2-2h8a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect width="4" height="6" x="8" y="16" rx="1"/>` },
  { id: "turn", name: "Turn: click a seat or a piece to turn it an eighth (Shift: back)", icon: `<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>` },
  { id: "remove", name: "Remove: click a seat, a piece, a wall or a booth", icon: `<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>` },
];
const icon = (paths: string) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const NAMES: Record<SpotKind, string> = { keys: "keys", drums: "kit", bass: "bass synth", desk: "desk", booth: "mic", couch: "couch", dj: "decks" };
let painting: Material = "carpet", decorating: DecorKind = "plant";
let tool: Tool = "move", placing: SpotKind = "keys", view: "3d" | "plan" = "3d", walls: WallsMode = "cutaway";
const canvas = $("view") as HTMLCanvasElement;
let build: BuildView | null = null;
try { build = new BuildView(canvas); } catch { view = "plan"; /* no WebGL: the blueprint only */ }
/** Walls snap to a 25 cm grid, seats and booths to 10 cm. */
const quarter = (v: number) => Math.round(v * 4) / 4;
const tenth = (v: number) => Math.round(v * 10) / 10;

function toRoom(e: PointerEvent): number[] {
  const m = plan.getScreenCTM(), p = new DOMPoint(e.clientX, e.clientY), q = m ? p.matrixTransform(m.inverse()) : p;
  return [q.x, q.y];
}
const pointAt = (e: PointerEvent): number[] | null => (view === "3d" ? build?.toRoom(e) ?? null : toRoom(e));
function hitAt(e: PointerEvent): Hit {
  if (view === "3d") return build?.hit(e) ?? null;
  const g = e.target instanceof Element ? e.target.closest("[data-spot], [data-booth], [data-gear], [data-wall], [data-prop], [data-door]") : null;
  if (!g) {
    // on the blueprint the floor is the room's rectangle, and an outside wall its edge (within 30 cm of it)
    const [x, z] = toRoom(e), { w, d } = room.size;
    if (Math.abs(x) > w / 2 + 0.3 || Math.abs(z) > d / 2 + 0.3) return null;
    const near: [Side, number][] = [["front", Math.abs(z - d / 2)], ["back", Math.abs(z + d / 2)], ["left", Math.abs(x + w / 2)], ["right", Math.abs(x - w / 2)]];
    const [side, gap] = near.sort((a, b) => a[1] - b[1])[0]!;
    return gap < 0.3 ? { side } : { floor: true };
  }
  const spot = g.getAttribute("data-spot"), booth = g.getAttribute("data-booth"), wall = g.getAttribute("data-wall"), piece = g.getAttribute("data-prop");
  if (g.hasAttribute("data-door")) return { door: true };
  return spot ? { spot } : booth ? { booth } : wall !== null ? { wall: Number(wall) } : piece !== null ? { prop: Number(piece) } : { gear: true };
}

let drag: { kind: "spot" | "booth" | "gear" | "prop" | "door"; id: string; from: number[]; at: number[]; g: SVGElement[]; start: number[] } | null = null;
let drawing: { from: [number, number]; to: [number, number] } | null = null;
let orbiting: { x: number; y: number } | null = null;

// two fingers on the 3D view: pinch to move in and out, slide sideways to turn round the room (a phone's right-drag)
const touches = new Map<number, { x: number; y: number }>();
let pinch: { dist: number; x: number } | null = null;
const spread = () => { const [a, b] = [...touches.values()]; return a && b ? { dist: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2 } : null; };

function down(e: PointerEvent) {
  if (view === "3d" && e.pointerType === "touch") {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) { pinch = spread(); drag = null; drawing = null; build?.drawing(null); return; }
    if (touches.size > 2) return;
  }
  if (view === "3d" && (e.button === 2 || e.button === 1)) { orbiting = { x: e.clientX, y: e.clientY }; try { canvas.setPointerCapture(e.pointerId); } catch { /* gone */ } return; }
  if (e.button !== 0) return;
  const p = pointAt(e), h = hitAt(e), at = (p ? [tenth(p[0]), tenth(p[1])] : null) as [number, number] | null;
  why = "";
  if (tool === "move") {
    if (!h || !("spot" in h || "booth" in h || "gear" in h || "prop" in h || "door" in h)) return;
    if ("door" in h) {
      if (!p) return;
      drag = { kind: "door", id: "door", from: [...room.door.at], at: [...room.door.at], g: [...plan.querySelectorAll<SVGElement>("[data-door]")], start: p };
      return;
    }
    const id = "spot" in h ? h.spot : "booth" in h ? h.booth : "prop" in h ? String(h.prop) : "gear";
    if ("spot" in h) { picked = h.spot; render(); }
    const from = "spot" in h ? room.spots.find((x) => x.id === id)?.at : "gear" in h ? gearPlace(room).at : "prop" in h ? room.props?.[h.prop]?.at : boothMiddle(room, id);
    if (!from || !p) return;
    const sel = "spot" in h ? `[data-spot="${CSS.escape(id)}"]` : "gear" in h ? "[data-gear]" : "prop" in h ? `[data-prop="${id}"]` : `[data-booth="${CSS.escape(id)}"]`;
    drag = { kind: "spot" in h ? "spot" : "gear" in h ? "gear" : "prop" in h ? "prop" : "booth", id, from: [...from], at: [...from], g: [...plan.querySelectorAll<SVGElement>(sel)], start: p };
  } else if (tool === "wall") {
    if (p) { const a: [number, number] = [quarter(p[0]), quarter(p[1])]; drawing = { from: a, to: a }; }
  } else if (tool === "door") {
    if (h && "wall" in h) apply({ t: "door", index: h.wall }); else { why = "Click an inside wall to put a doorway in it"; render(); }
  } else if (tool === "window") {
    const on = h && "side" in h ? h.at ?? p : null;
    if (h && "side" in h && on) apply({ t: "window", side: h.side, along: tenth(h.side === "front" || h.side === "back" ? on[0] : on[1]) });
    else { why = "Click an outside wall to put a window in it"; render(); }
  } else if (tool === "booth") {
    if (at) apply({ t: "booth", id: free("booth", (x) => room.walls.some((wl) => wl.booth === x)), at, w: 2.4, d: 2.4 });
  } else if (tool === "place") {
    if (!at) return;
    const id = free(placing, (x) => room.spots.some((s) => s.id === x));
    if (apply({ t: "spot", id, kind: placing, at })) { picked = id; render(); }
  } else if (tool === "decor") {
    if (at) apply({ t: "addProp", kind: decorating, at });
  } else if (tool === "paint") {
    if (h && "floor" in h) apply({ t: "surface", surface: "floor", material: painting });
    else if (h && "side" in h) apply({ t: "surface", surface: h.side, material: painting });
    else if (h && "wall" in h) apply({ t: "wall", index: h.wall, material: painting });
    else { why = "Click the floor or a wall to paint it"; render(); }
  } else if (tool === "turn") {
    if (h && "spot" in h) { picked = h.spot; apply({ t: "turn", id: h.spot, by: e.shiftKey ? -1 : 1 }); }
    else if (h && "prop" in h) apply({ t: "turnProp", index: h.prop, by: e.shiftKey ? -1 : 1 });
  } else if (tool === "remove") {
    if (h && "spot" in h) { if (apply({ t: "unspot", id: h.spot }) && picked === h.spot) { picked = room.spots[0]?.id; render(); } }
    else if (h && "booth" in h) apply({ t: "unbooth", id: h.booth });
    else if (h && "wall" in h) apply({ t: "unwall", index: h.wall });
    else if (h && "prop" in h) apply({ t: "unprop", index: h.prop });
  }
  try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* a pointer that already left */ }
}
function move(e: PointerEvent) {
  if (touches.has(e.pointerId)) {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const now = spread();
    if (pinch && now && build) { build.orbit(-(now.x - pinch.x) * 0.008, 0, pinch.dist / Math.max(now.dist, 1)); pinch = now; return; }
  }
  if (orbiting && build) { build.orbit(-(e.clientX - orbiting.x) * 0.008, (e.clientY - orbiting.y) * 0.006); orbiting = { x: e.clientX, y: e.clientY }; return; }
  // nothing in hand: outline what's under the pointer in 3D, so you know what a click will take
  if (!drag && !drawing && view === "3d" && build) {
    const h = build.hit(e), over = h && !("floor" in h) && !("side" in h);
    build.hover(over ? h : null);
    canvas.style.cursor = over && tool === "move" ? "grab" : "";
  }
  const p = pointAt(e);
  if (!p) return;
  if (drag) {
    drag.at = [tenth(drag.from[0] + p[0] - drag.start[0]), tenth(drag.from[1] + p[1] - drag.start[1])];
    const dx = drag.at[0] - drag.from[0], dz = drag.at[1] - drag.from[1];
    if (view === "3d") build?.nudge(drag.kind === "gear" || drag.kind === "door" ? drag.kind : `${drag.kind}:${drag.id}`, dx, dz);
    else for (const g of drag.g) g.setAttribute("transform", `translate(${dx} ${dz})`);
  } else if (drawing) {
    // square to the room when it's nearly square: a wall a few degrees off is never what's meant
    let to: [number, number] = [quarter(p[0]), quarter(p[1])];
    const dx = to[0] - drawing.from[0], dz = to[1] - drawing.from[1];
    if (Math.abs(dx) < Math.abs(dz) * 0.2) to = [drawing.from[0], to[1]]; else if (Math.abs(dz) < Math.abs(dx) * 0.2) to = [to[0], drawing.from[1]];
    drawing.to = to;
    // the wall's length by the pointer, as a builder reads it off the tape
    const meas = $("measure"), box = $("stage").getBoundingClientRect();
    meas.hidden = false; meas.textContent = `${Math.hypot(to[0] - drawing.from[0], to[1] - drawing.from[1]).toFixed(2)} m`;
    meas.style.left = `${e.clientX - box.left}px`; meas.style.top = `${e.clientY - box.top}px`;
    if (view === "3d") build?.drawing(drawing.from, to);
    else { plan.querySelector(".drawing")?.remove(); plan.append(el("line", { class: "drawing", x1: drawing.from[0], y1: drawing.from[1], x2: to[0], y2: to[1], "stroke-width": 0.14 })); }
  }
}
function up(e?: PointerEvent) {
  if (e) touches.delete(e.pointerId);
  if (pinch) { if (touches.size < 2) pinch = null; return; }
  orbiting = null;
  if (drag) {
    const d = drag; drag = null;
    if (d.at[0] === d.from[0] && d.at[1] === d.from[1]) return render();
    apply(d.kind === "spot" ? { t: "move", id: d.id, at: d.at } : d.kind === "gear" ? { t: "moveGear", at: d.at } : d.kind === "prop" ? { t: "moveProp", index: Number(d.id), at: d.at } : d.kind === "door" ? { t: "moveDoor", at: d.at } : { t: "moveBooth", id: d.id, at: d.at });
  } else if (drawing) {
    const w = drawing; drawing = null;
    $("measure").hidden = true;
    build?.drawing(null);
    if (w.from[0] !== w.to[0] || w.from[1] !== w.to[1]) apply({ t: "addWall", from: w.from, to: w.to }); else render();
  }
}
for (const surface of [plan, canvas] as Element[]) {
  surface.addEventListener("pointerdown", (e) => down(e as PointerEvent));
  surface.addEventListener("pointermove", (e) => move(e as PointerEvent));
  surface.addEventListener("pointerup", (e) => up(e as PointerEvent));
  surface.addEventListener("pointercancel", (e) => up(e as PointerEvent));
}
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("wheel", (e) => { e.preventDefault(); build?.orbit(0, 0, Math.exp(e.deltaY * 0.0012)); }, { passive: false });

const SOFA_ICON = `<path d="M20 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v3"/><path d="M2 16a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0z"/><path d="M4 18v2"/><path d="M20 18v2"/><path d="M12 4v9"/>`;
/** Furnish the room in one go (builder.ts furnish), one step to undo. */
function furnishRoom(): number {
  const f = furnish(room);
  if (!f.done.length) { why = "There's no room left to furnish"; render(); return 0; }
  undos.push(room); redos.length = 0; room = f.def; why = ""; save(); render();
  return f.done.length;
}
const UNDO_ICON = `<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>`;
const REDO_ICON = `<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>`;
const VIEW_3D = `<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>`;
const BLUEPRINT = `<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>`;
const LAYERS = `<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>`;
const CCW = `<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>`;
const CW = `<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>`;
const WALL_WORDS: Record<WallsMode, string> = { cutaway: "Walls cut away on your side", down: "Walls down", up: "Walls up" };
let thumbs: Partial<Record<SpotKind, string>> = {};

/** The tool bar, the catalog under it when placing, and which view shows. */
function renderTools() {
  const b = (attrs: string, name: string, paths: string, on = false) => `<button type="button" class="tool" ${attrs} aria-label="${esc(name)}" title="${esc(name)}" aria-pressed="${on}">${icon(paths)}</button>`;
  $("tools").innerHTML = TOOLS.map((t) => b(`data-tool="${t.id}"`, t.name, t.icon, t.id === tool)).join("")
    + b(`data-furnish="1"`, "Furnish: dress the room as a working studio (a rug under the kit, lamps, plants, a shelf, a rack, absorbers)", SOFA_ICON)
    + b(`data-undo="1"${undos.length ? "" : " disabled"}`, "Undo (Ctrl+Z)", UNDO_ICON) + b(`data-undo="0"${redos.length ? "" : " disabled"}`, "Redo (Ctrl+Shift+Z)", REDO_ICON)
    + `<span class="sep"></span>`
    + (build ? b(`data-view="3d"`, "3D: your studio cut away, from above", VIEW_3D, view === "3d") : "")
    + b(`data-view="plan"`, "Blueprint: the plan from straight above", BLUEPRINT, view === "plan")
    + (view === "3d" ? b(`data-walls`, `${WALL_WORDS[walls]} (click for the next)`, LAYERS) : "");
  $("orbit").innerHTML = view === "3d" ? b(`data-orbit="1"`, "Turn the view left", CCW) + b(`data-orbit="-1"`, "Turn the view right", CW) : "";
  const cat = $("catalog");
  cat.hidden = tool !== "place" && tool !== "paint" && tool !== "decor";
  if (tool === "decor") {
    if (build && !Object.keys(decorThumbs).length) decorThumbs = Object.fromEntries(DECOR_KINDS.map((k) => [k, build!.thumb({ kind: k, at: [0, 0], yaw: 0, ...DECOR[k]!, seed: 13 })]));
    cat.innerHTML = DECOR_KINDS.map((k) => `<button type="button" data-decor="${k}" aria-pressed="${k === decorating}" title="${esc(DECOR_NAMES[k])}">${decorThumbs[k] ? `<img src="${decorThumbs[k]}" alt="">` : ""}<span>${esc(DECOR_NAMES[k])}</span></button>`).join("");
  }
  if (tool === "paint") cat.innerHTML = MATERIAL_IDS.map((m) => `<button type="button" data-paint="${m}" aria-pressed="${m === painting}" title="${esc(MATERIALS[m].name)}">${swatch(m)}<span>${esc(MATERIALS[m].name)}</span></button>`).join("");
  if (tool === "place") {
    if (build && !Object.keys(thumbs).length) thumbs = Object.fromEntries(KINDS_ALL.map((k) => [k, build!.thumb(newSpot(`thumb-${k}`, k, [0, 0]))]));
    cat.innerHTML = KINDS_ALL.map((k) => `<button type="button" data-kind="${k}" aria-pressed="${k === placing}" title="${esc(NAMES[k])}">${thumbs[k] ? `<img src="${thumbs[k]}" alt="">` : ""}${esc(NAMES[k])}</button>`).join("");
  }
  canvas.hidden = view !== "3d"; plan.toggleAttribute("hidden", view !== "plan");
}
const KINDS_ALL: SpotKind[] = ["keys", "drums", "bass", "dj", "desk", "booth", "couch"];
const DECOR_NAMES: Record<DecorKind, string> = { shelf: "shelf", lamp: "lamp", plant: "plant", rug: "rug", rack: "rack", piano: "grand piano", micStand: "mic stand", table: "table", cabinet: "cabinet", books: "books", drumMachine: "drum machine", modular: "modular" };
let decorThumbs: Partial<Record<DecorKind, string>> = {};
const swatches = new Map<Material, string>();
/** A material's swatch for the paint catalog: a square of its own painted texture (look.ts), or its colour. */
function swatch(m: Material): string {
  let url = swatches.get(m);
  if (!url) {
    const img = surface(wallSurface(m), m === "drywall" || m === "plaster" ? "#d9d3c6" : undefined).map?.image, c = document.createElement("canvas");
    c.width = c.height = 72;
    const g = c.getContext("2d")!;
    g.fillStyle = MATERIALS[m].color; g.fillRect(0, 0, 72, 72);
    if (img instanceof HTMLCanvasElement) g.drawImage(img, 0, 0, img.width / 3, img.height / 3, 0, 0, 72, 72);
    url = c.toDataURL(); swatches.set(m, url);
  }
  return `<img src="${url}" alt="">`;
}
$("tools").addEventListener("click", (e) => {
  const t = e.target instanceof Element ? e.target.closest("button") : null;
  if (!t) return;
  if (t.dataset.undo) return void undo(t.dataset.undo === "1");
  if (t.dataset.furnish) return void furnishRoom();
  if (t.dataset.tool) tool = t.dataset.tool as Tool;
  if (t.dataset.view) view = t.dataset.view === "3d" && build ? "3d" : "plan";
  if (t.hasAttribute("data-walls")) walls = walls === "cutaway" ? "down" : walls === "down" ? "up" : "cutaway";
  render();
});
$("catalog").addEventListener("click", (e) => {
  const k = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-kind]")?.dataset.kind : undefined;
  const kind = check(oneOf(KINDS_ALL), k);
  if (kind) { placing = kind; renderTools(); }
  const m = check(oneOf(MATERIAL_IDS), e.target instanceof Element ? e.target.closest<HTMLElement>("[data-paint]")?.dataset.paint : undefined);
  if (m) { painting = m; renderTools(); }
  const dk = check(oneOf(DECOR_KINDS), e.target instanceof Element ? e.target.closest<HTMLElement>("[data-decor]")?.dataset.decor : undefined);
  if (dk) { decorating = dk; renderTools(); }
});
$("orbit").addEventListener("click", (e) => {
  const t = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-orbit]") : null;
  if (t && build) build.orbit(Number(t.dataset.orbit) * Math.PI / 2);
});

// ---- what it sounds like ----

function renderSound() {
  const spot = room.spots.find((s) => s.id === picked);
  const ac = acoustics(room, spot);
  const where = `${spot ? esc(spot.label) : "the middle"}, ${ac.space.closed ? `in a ${ac.space.floor.toFixed(0)} m² space walled off from the room` : "in the room"}`;
  const top = Math.max(0.3, ...ac.rt60);
  $("sound").innerHTML = `<h2>What it sounds like</h2>
    <div class="big">${esc(ac.word)} <small>${ac.mid.toFixed(2)} s to fade, at ${where}</small></div>
    <div class="bars" title="Seconds to fade 60 dB, per band">${ac.rt60.map((t) => `<div style="height:${(t / top * 100).toFixed(0)}%" title="${t.toFixed(2)} s"></div>`).join("")}</div>
    <div class="bands">${BANDS.map((b) => `<span>${b < 1000 ? b : `${b / 1000}k`}</span>`).join("")}</div>
    <p class="hint">${ac.space.volume.toFixed(0)} m³ of air.</p>
    <div class="row"><button class="go" id="clap" type="button">Clap at ${esc(spot?.id ?? "the middle")}</button>
      <a class="button" id="walk" href="/jam.html?studio=${preset() ? encodeURIComponent(room.id) : "yours"}">Enter</a></div>`;
  $("clap").addEventListener("click", () => clap());
}

let ctx: AudioContext | null = null;
function clap() {
  ctx ??= new AudioContext();
  void ctx.resume();
  const ir = impulse(room, picked, ctx.sampleRate);
  const buf = ctx.createBuffer(2, ir.l.length, ir.rate);
  buf.copyToChannel(ir.l, 0); buf.copyToChannel(ir.r, 1);
  const conv = ctx.createConvolver(); conv.normalize = false; conv.buffer = buf;
  // A clap: a few milliseconds of noise falling fast.
  const n = Math.round(ctx.sampleRate * 0.03), hit = ctx.createBuffer(1, n, ctx.sampleRate), d = hit.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.004));
  const src = ctx.createBufferSource(); src.buffer = hit;
  const out = ctx.createGain(); out.gain.value = 0.5;
  src.connect(conv).connect(out).connect(ctx.destination);
  src.start();
}

// ---- the edit panel ----

const OPTIONS = (on: Material) => (Object.keys(MATERIALS) as Material[]).map((m) => `<option value="${m}"${m === on ? " selected" : ""}>${esc(MATERIALS[m].name)}</option>`).join("");
/** Lucide's "x". */
const X = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
const SURFACES: Surface[] = ["floor", "ceiling", "front", "back", "left", "right"];
const free = (id: string, taken: (id: string) => boolean) => { let n = 1; while (taken(n === 1 ? id : `${id}-${n}`)) n++; return n === 1 ? id : `${id}-${n}`; };

function grid(): [number, number][] {
  const { w, d } = room.size, out: [number, number][] = [];
  for (let x = -w / 2; x <= w / 2; x += 0.5) for (let z = -d / 2; z <= d / 2; z += 0.5) out.push([tenth(x), tenth(z)]);
  return out.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
}

function renderEdit() {
  const s = room.size, mats = room.materials ?? PLAIN;
  const surf = (f: Surface) => f === "floor" || f === "ceiling" ? mats[f] : mats.walls[f];
  const booths = [...new Set(room.walls.map((x) => x.booth).filter((x) => x !== undefined))];
  $("edit").innerHTML = `<h2>Size</h2>
    <div class="row">${(["w", "d", "h"] as const).map((k) => `<label>${{ w: "Width", d: "Depth", h: "Height" }[k]}, m<input type="number" step="0.1" data-size="${k}" value="${s[k]}"></label>`).join("")}</div>
    <h2>Made of</h2>
    ${SURFACES.map((f) => `<div class="row"><label>${f === "floor" || f === "ceiling" ? f : `${f} wall`}<select data-surface="${f}">${OPTIONS(surf(f))}</select></label></div>`).join("")}
    <h2>Panels</h2>
    <ul>${(room.panels ?? []).map((p, i) => `<li><span>${esc(MATERIALS[p.material].name)}, ${p.m2} m² on the ${p.wall} wall</span><button type="button" class="x" data-unpanel="${i}" aria-label="Take off" title="Take off">${X}</button></li>`).join("")}</ul>
    <div class="row"><label>Wall<select id="pw">${SIDES.map((w) => `<option>${w}</option>`).join("")}</select></label>
      <label>Of<select id="pm">${OPTIONS("foam")}</select></label><label>m²<input id="pa" type="number" step="0.5" value="4"></label></div>
    <div class="row"><button type="button" id="add-panel">Hang panel</button></div>
    <h2>Inside walls</h2>
    <ul>${room.walls.map((wl, i) => `<li><span>${wl.booth ? esc(wl.booth) : "wall"} ${i + 1}</span><select data-wall="${i}" aria-label="Wall ${i + 1} is made of">${OPTIONS(wallMaterial(wl))}</select></li>`).join("")}</ul>
    <h2>Booths</h2>
    <ul>${booths.map((b) => `<li><span>${esc(b)}</span><button type="button" class="x" data-unbooth="${esc(b)}" aria-label="Take down" title="Take down">${X}</button></li>`).join("")}</ul>
    <div class="row"><button type="button" id="add-booth">Put up a booth</button></div>
    <h2>Gear wall</h2>
    <div class="row"><button type="button" id="turn-gear">Turn it a quarter</button></div>
    <h2>Seats</h2>
    <div class="row"><label>Kind<select id="sk">${KINDS.map((k) => `<option>${k}</option>`).join("")}</select></label><button type="button" id="add-spot">Add seat</button>
      ${picked ? `<button type="button" id="del-spot">Take out ${esc(picked)}</button>` : ""}</div>
    <p class="hint">Build with the tools over the view: move, draw walls on the grid, knock doorways through, put up booths, place seats from the catalog, turn and remove them. Right-drag (or the arrows) turns the 3D view, the wheel zooms.</p>`;
  const q = <T extends Element>(sel: string) => [...$("edit").querySelectorAll<T>(sel)];
  for (const i of q<HTMLInputElement>("[data-size]")) i.addEventListener("change", () => {
    const v = (k: string) => Number(q<HTMLInputElement>(`[data-size="${k}"]`)[0].value);
    apply({ t: "size", w: v("w"), d: v("d"), h: v("h") });
  });
  for (const sel of q<HTMLSelectElement>("[data-surface]")) sel.addEventListener("change", () => apply({ t: "surface", surface: sel.dataset.surface, material: sel.value }));
  for (const sel of q<HTMLSelectElement>("[data-wall]")) sel.addEventListener("change", () => apply({ t: "wall", index: Number(sel.dataset.wall), material: sel.value }));
  for (const b of q<HTMLButtonElement>("[data-unpanel]")) b.addEventListener("click", () => apply({ t: "unpanel", index: Number(b.dataset.unpanel) }));
  for (const b of q<HTMLButtonElement>("[data-unbooth]")) b.addEventListener("click", () => apply({ t: "unbooth", id: b.dataset.unbooth }));
  $("add-panel").addEventListener("click", () => apply({ t: "panel", wall: ($("pw") as HTMLSelectElement).value, material: ($("pm") as HTMLSelectElement).value, m2: Number(($("pa") as HTMLInputElement).value) }));
  $("add-spot").addEventListener("click", () => {
    const kind = check(oneOf(KINDS), ($("sk") as HTMLSelectElement).value) ?? "keys";
    const id = free(kind, (x) => room.spots.some((s) => s.id === x));
    // The first free place on a half-metre grid from the middle outward.
    const at = grid().find((p) => edit(room, { t: "spot", id, kind, at: p }).ok);
    if (!at) { why = "no room left for another seat"; return render(); }
    picked = id;
    apply({ t: "spot", id, kind, at });
  });
  document.getElementById("del-spot")?.addEventListener("click", () => { if (picked && apply({ t: "unspot", id: picked })) { picked = room.spots[0]?.id; render(); } });
  $("turn-gear").addEventListener("click", () => apply({ t: "moveGear", at: gearPlace(room).at, turns: 1 }));
  $("add-booth").addEventListener("click", () => {
    const id = free("booth", (x) => room.walls.some((wl) => wl.booth === x));
    const at = grid().find((p) => edit(room, { t: "booth", id, at: p, w: 2.4, d: 2.4 }).ok);
    if (!at) { why = "no room left for a booth"; return render(); }
    apply({ t: "booth", id, at, w: 2.4, d: 2.4 });
  });
}

const select = $("preset") as HTMLSelectElement;
select.innerHTML = `<option value="">Yours</option>${ROOM_LIST.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join("")}`;
function load(id: string) {
  const r = ROOM_LIST.find((x) => x.id === id);
  if (!r) return false;
  undos.push(room); redos.length = 0;
  room = structuredClone(r); picked = room.spots[0]?.id; why = ""; save(); render();
  return true;
}
select.addEventListener("change", () => load(select.value));

declare global { interface Window { qrooms: typeof harness } }
const harness = {
  state: () => ({
    room: room.id, name: room.name, preset: preset()?.id ?? null, picked, why,
    sound: Object.fromEntries([undefined, ...room.spots].map((s) => { const a = acoustics(room, s); return [s?.id ?? "middle", { word: a.word, mid: +a.mid.toFixed(2), closed: a.space.closed }]; })),
    def: room,
  }),
  load,
  edit: (e: unknown) => ({ ok: apply(e), why }),
  /** What the 3D view has under (x, y), pixels from its top left corner, and where that is on the floor. */
  hit: (x: number, y: number) => { const r = canvas.getBoundingClientRect(), e = { clientX: r.left + x, clientY: r.top + y }; return { hit: build?.hit(e) ?? null, floor: build?.toRoom(e) ?? null }; },
  furnish: () => furnishRoom(),
  undo: () => undo(true),
  redo: () => undo(false),
  pick: (id: string) => { picked = id; render(); },
};
window.qrooms = harness;
render();
