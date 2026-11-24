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
import { boothMiddle, Edit, edit, type Surface, yours, YOURS } from "./builder.ts";
import { footprint, gearPlace } from "./gear-wall.ts";
import type { Side, StudioDef } from "./room.ts";
import { ROOM_LIST } from "./rooms/index.ts";
import { acoustics, BANDS, impulse, MATERIALS, type Material, PLAIN, wallMaterial } from "./sound.ts";

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
  room = out.def;
  if (out.ok) save();
  render();
  return out.ok;
}

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
  const { w, d } = room.size, pad = Math.max(w, d) * 0.06 + 0.3;
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
  // Inside walls, with their doorways left open.
  for (const wl of room.walls) {
    const [x0, z0] = wl.from, [x1, z1] = wl.to, len = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / len, uz = (z1 - z0) / len;
    const gaps = [...(wl.gaps ?? [])].sort((a, b) => a[0] - b[0]);
    const runs: [number, number][] = [];
    let from = 0;
    for (const [a, b] of gaps) { if (a > from) runs.push([from, a]); from = Math.max(from, b); }
    if (from < len) runs.push([from, len]);
    const g = el("g", wl.booth ? { "data-booth": wl.booth } : {});
    for (const [a, b] of runs) g.append(el("line", { class: `wall${wl.booth ? " movable" : ""}`, x1: x0 + ux * a, y1: z0 + uz * a, x2: x0 + ux * b, y2: z0 + uz * b, stroke: tint(wallMaterial(wl)), "stroke-width": 0.14 * scale }));
    plan.append(g);
  }
  // the gear wall's corner: the rack along its long side, dragged like a booth
  const gear = footprint(room), g = el("g", { "data-gear": "gear" });
  g.append(el("polygon", { class: "gear movable", points: gear.map((p) => p.join(",")).join(" "), "stroke-width": 0.06 * scale }));
  g.append(el("line", { class: "rack", x1: gear[0][0], y1: gear[0][1], x2: gear[1][0], y2: gear[1][1], "stroke-width": 0.16 * scale }));
  g.append(el("text", { x: gear.reduce((t, p) => t + p[0], 0) / 4, y: gear.reduce((t, p) => t + p[1], 0) / 4, "font-size": 0.32 * scale }, "gear"));
  plan.append(g);
  const [dx, dz] = room.door.at;
  plan.append(el("path", { class: "door", d: `M ${dx - 0.3 * scale} ${dz + 0.25 * scale} L ${dx} ${dz - 0.25 * scale} L ${dx + 0.3 * scale} ${dz + 0.25 * scale}`, "stroke-width": 0.06 * scale }));
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
}

// ---- dragging a seat, or a booth by one of its walls ----

let drag: { kind: "spot" | "booth" | "gear"; id: string; from: number[]; at: number[]; g: SVGElement[]; start: number[] } | null = null;
function toRoom(e: PointerEvent): number[] {
  const m = plan.getScreenCTM(), p = new DOMPoint(e.clientX, e.clientY), q = m ? p.matrixTransform(m.inverse()) : p;
  return [q.x, q.y];
}
const tenth = (v: number) => Math.round(v * 10) / 10;
plan.addEventListener("pointerdown", (e) => {
  const g = e.target instanceof Element ? e.target.closest("[data-spot], [data-booth], [data-gear]") : null;
  if (!g) return;
  const spot = g.getAttribute("data-spot"), booth = g.getAttribute("data-booth"), gear = g.getAttribute("data-gear");
  if (spot) { picked = spot; render(); }
  const id = spot ?? booth ?? gear;
  const from = !id ? null : spot ? room.spots.find((x) => x.id === id)?.at : gear ? gearPlace(room).at : boothMiddle(room, id);
  if (!id || !from) return;
  const moving = [...plan.querySelectorAll<SVGElement>(spot ? `[data-spot="${CSS.escape(id)}"]` : gear ? "[data-gear]" : `[data-booth="${CSS.escape(id)}"]`)];
  drag = { kind: spot ? "spot" : gear ? "gear" : "booth", id, from: [...from], at: [...from], g: moving, start: toRoom(e) };
  plan.setPointerCapture(e.pointerId);
});
plan.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const p = toRoom(e);
  drag.at = [tenth(drag.from[0] + p[0] - drag.start[0]), tenth(drag.from[1] + p[1] - drag.start[1])];
  for (const g of drag.g) g.setAttribute("transform", `translate(${drag.at[0] - drag.from[0]} ${drag.at[1] - drag.from[1]})`);
});
plan.addEventListener("pointerup", () => {
  if (!drag) return;
  const d = drag; drag = null;
  if (d.at[0] === d.from[0] && d.at[1] === d.from[1]) return render();
  apply(d.kind === "spot" ? { t: "move", id: d.id, at: d.at } : d.kind === "gear" ? { t: "moveGear", at: d.at } : { t: "moveBooth", id: d.id, at: d.at });
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
    <p class="hint">Drag a seat, a booth by its walls, or the gear wall on the plan to move it.</p>`;
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
  pick: (id: string) => { picked = id; render(); },
};
window.qrooms = harness;
render();
