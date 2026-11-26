// The studio builder (/rooms.html): start from one of the rooms, then size it, change what its floor, ceiling and
// walls are made of, hang panels on its walls, put up booths and drag seats and booths around on the plan. The side
// shows how long the space at the picked seat rings, Clap plays a clap through that seat's impulse response, and
// Walk in opens the room in /jam.html. Indoors or out the PA tool puts the rig's stacks down; Move drags them, Turn aims
// them, and the PA panel turns, splays and pins the picked one, shows the coverage map over the floor (coverage.ts: the
// boxes the jam room plays from) on the blueprint or the 3D floor, and the delay view where the far stacks land late
// (pa-room.ts arrivals: a delay tower's place), checks the amps, breakers and generator (@rustybuns/gear powerPlan) and
// hands out the gear list and the plan drawing. Every change goes through the builder's edits (builder.ts), so the room is never left
// half built. Your room is kept in this browser. The Party panel (Qevent, party.ts) makes a party, gives each performer
// a scene (the builder edits the one on stage, each scene with its own undo), saves versions that stay, and puts one
// party live. `window.qrooms` is the harness: state(), load(id), edit(e), pick(id), pa(), level(x, z), delay(x, z),
// download("list" | "plan"), undo(), redo(), party.{state, make, open, live, addScene, scene, everyone, save, restore}.
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import "./rooms.css";
import { esc } from "@rustybuns/util";
import { check, oneOf } from "@rustybuns/util/guard";
import { boothMiddle, builtLink, DECOR, DECOR_KINDS, OUTDOOR_DECOR, type DecorKind, Edit, edit, furnish, newSpot, type Surface, venueSrc, yours, YOURS } from "./builder.ts";
import { BuildView, type Hit, type WallsMode } from "./build-view.ts";
import { footprint, gearPlace } from "./gear-wall.ts";
import type { Side, SpotKind, StudioDef } from "./room.ts";
import { ROOM_LIST } from "./rooms/index.ts";
import { acoustics, BANDS, impulse, MATERIAL_IDS, MATERIALS, type Material, PLAIN, wallMaterial } from "./sound.ts";
import { surface, wallSurface } from "./look.ts";
import { POLY_KINDS } from "@rustybuns/models/polysynth";
import { airAbsorption, GENERATOR_IDS, GROUNDS, gear as sheet, gearList, gearListText, powerPlan, speedOfSound, stackWidth, SYSTEM_IDS, SYSTEMS, type Ground } from "@rustybuns/gear";
import { arrivals, paSpeakers, rigPlan, rigStacks, roomField, roomPa, roomRig } from "./pa-room.ts";
import { delayCanvas, delayMap, floorMap, heatCanvas, mapAt, type DelayMap, type FloorMap } from "./coverage.ts";
import { addScene, dropParty, dropScene, everyone, goLive, keepStudio, liveStudio, makeParty, open, openParty, openScene, PARTIES, partyRoom, reschedule, restore, saveVersion, setVenue, stored, switchScene, whenWords, type Done } from "./party.ts";
import { partySync } from "./party-sync.ts";
import { eqosys } from "@rustybuns/util/eqosys";
import { APP, EQOSYS, SIGN_IN_FROM } from "../account.ts";
import { SKIN } from "../guest-list.ts";

const $ = (id: string) => { const el = document.getElementById(id); if (!el) throw new Error(`#${id} missing`); return el; };
const plan = document.querySelector<SVGSVGElement>("#plan")!;
const SVG = "http://www.w3.org/2000/svg";
const SIDES: Side[] = ["front", "back", "left", "right"];
const KINDS = ["keys", "drums", "bass", "desk", "booth", "couch"] as const;

/** Your parties (party.ts): with one open, the builder edits the scene on its stage. */
let parties = stored((() => { try { return localStorage.getItem(PARTIES); } catch { return null; } })());
let room: StudioDef = openScene(parties)?.studio ?? yours() ?? structuredClone(ROOM_LIST[0]);
// Signed in with eqosys (on the front door), your parties are on your account (#5932): `owner` names you in join links
// once the account answers; until then, and signed out, they are this browser's alone.
const eq = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "qollab-studio", skin: SKIN });
const sync = partySync(location.origin, () => { const l = eq.login(); return l && eq.fresh(l, 5_000) ? l.token : null; });
let owner: string | null = null;
let picked: string | undefined = room.spots[0]?.id;
let why = "";
/** The PA stack picked on the plan (an index into the room's stacks), and whether the coverage map and the delay view show. */
let stackPicked: number | null = null, showMap = false, showDelay = false;

/** Keep the room: in the open party's scene, and as the room /jam.html walks into (the live party's stage while one is live). */
function save() {
  if (openParty(parties)) parties = keepStudio(parties, room).store;
  if (owner) sync.push(parties);
  try {
    localStorage.setItem(PARTIES, JSON.stringify(parties));
    localStorage.setItem(YOURS, JSON.stringify(liveStudio(parties) ?? room));
  } catch { /* private window: the room lives until reload */ }
}
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

// ---- undo and redo: every edit that went through, as the room was before it (this page's session only), one
// history per scene, so switching performers and back keeps each one's ----
const UNDOS = 100, histories = new Map<string, [StudioDef[], StudioDef[]]>();
let undos: StudioDef[] = [], redos: StudioDef[] = [];
histories.set(`${parties.open ?? ""}/${openParty(parties)?.scene ?? ""}`, [undos, redos]);
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
  // the PA's coverage over the floor, under the grid, and a ring at the floor's middle it's coloured against
  const map = paMap();
  if (showMap && map) {
    plan.append(el("image", { class: "heat", href: paHeat()!.toDataURL(), x: -w / 2, y: -d / 2, width: w, height: d, preserveAspectRatio: "none", opacity: 0.85 }));
    plan.append(el("circle", { class: "mid", cx: map.middle[0], cy: map.middle[1], r: 0.4 * scale, "stroke-width": 0.05 * scale }));
  }
  // the delay view: where the far stacks land late (amber a smear, red an echo), and the ms written every few metres
  const late = showDelay ? paDelay() : null;
  if (late) {
    plan.append(el("image", { class: "delay", href: delayCanvas(late).toDataURL(), x: -w / 2, y: -d / 2, width: w, height: d, preserveAspectRatio: "none" }));
    const step = Math.max(2, Math.round(Math.max(w, d) / 8));
    for (let z = -d / 2 + step / 2; z < d / 2; z += step) for (let x = -w / 2 + step / 2; x < w / 2; x += step) {
      const ix = Math.min(late.nx - 1, Math.floor(((x + w / 2) / w) * late.nx)), iz = Math.min(late.nz - 1, Math.floor(((z + d / 2) / d) * late.nz)), ms = late.ms[iz * late.nx + ix]!;
      if (ms >= 1) plan.append(el("text", { class: "delay-ms", x, y: z, "font-size": 0.3 * scale }, `${Math.round(ms)} ms`));
    }
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
  // the field's banks: each its foot turned its way, its crest dashed along it
  for (const [i, b] of (room.outdoor?.banks ?? []).entries()) {
    const g = el("g", { "data-bank": i }), turned = el("g", { transform: `rotate(${(-b.yaw * 180) / Math.PI} ${b.at[0]} ${b.at[1]})` }), wide = Math.max(2, 4 * b.h);
    turned.append(el("rect", { class: "bank", x: b.at[0] - b.len / 2 - wide / 2, y: b.at[1] - wide / 2, width: b.len + wide, height: wide, rx: wide / 2, "stroke-width": 0.03 * scale }));
    turned.append(el("line", { class: "crest", x1: b.at[0] - b.len / 2, y1: b.at[1], x2: b.at[0] + b.len / 2, y2: b.at[1], "stroke-width": 0.05 * scale }));
    g.append(turned);
    plan.append(g);
  }
  // the rig's stacks, each its footprint turned its way, and a line out along where its tops aim
  if (roomPa(room)) {
    const rig = roomRig(room), sw = stackWidth(rig), sd = Math.max(...rig.stack.map((b) => sheet(b).size.d));
    rigStacks(room).forEach((st, i) => {
      const g = el("g", { "data-stack": i }), turned = el("g", { transform: `rotate(${(-st.yaw * 180) / Math.PI} ${st.at[0]} ${st.at[1]})` });
      turned.append(el("rect", { class: `stack${i === stackPicked ? " on" : ""}`, x: st.at[0] - sw / 2, y: st.at[1] - sd / 2, width: sw, height: sd, "stroke-width": 0.06 * scale }));
      g.append(turned);
      const a = st.yaw + (st.splay ?? 0);
      g.append(el("line", { class: "aim", x1: st.at[0], y1: st.at[1], x2: st.at[0] + Math.sin(a) * 1.6 * scale, y2: st.at[1] + Math.cos(a) * 1.6 * scale, "stroke-width": 0.06 * scale }));
      plan.append(g);
    });
  }
  for (const sp of room.spots) {
    const g = el("g", { "data-spot": sp.id });
    g.append(el("circle", { class: `spot${sp.id === picked ? " on" : ""}`, cx: sp.at[0], cy: sp.at[1], r: 0.32 * scale, "stroke-width": 0.06 * scale }));
    g.append(el("text", { x: sp.at[0], y: sp.at[1] + 0.68 * scale, "font-size": 0.32 * scale }, sp.id));
    plan.append(g);
  }
  $("why").textContent = why;
  $("about").textContent = room.about ?? "";
  select.value = preset()?.id ?? "";
  renderParty();
  renderSound();
  renderPa();
  renderEdit();
  renderTools();
  if (view === "3d") build?.show(room, picked, walls, showMap ? paHeat() : null);
}

// ---- build mode: one set of tools, on the blueprint and in the 3D view alike ----

type Tool = "move" | "wall" | "door" | "window" | "booth" | "place" | "decor" | "paint" | "pa" | "turn" | "remove";
const TOOLS: { id: Tool; name: string; icon: string }[] = [
  { id: "move", name: "Move: drag a seat, a booth, a piece of furniture, the gear wall, the way in, a stack or a bank (on the blueprint)", icon: `<path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/>` },
  { id: "wall", name: "Wall: drag across the floor to put one up", icon: `<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 9v6"/><path d="M16 15v6"/><path d="M16 3v6"/><path d="M3 15h18"/><path d="M3 9h18"/><path d="M8 15v6"/><path d="M8 3v6"/>` },
  { id: "door", name: "Doorway: click a wall to knock one through, again to brick it up", icon: `<path d="M11 20H2"/><path d="M11 4.562v16.157a1 1 0 0 0 1.242.97L19 20V5.562a2 2 0 0 0-1.515-1.94l-4-1A2 2 0 0 0 11 4.561z"/><path d="M11 4H8a2 2 0 0 0-2 2v14"/><path d="M14 12h.01"/><path d="M22 20h-3"/>` },
  { id: "window", name: "Window: click an outside wall to put a window in it", icon: `<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/><path d="M3 12h18"/>` },
  { id: "booth", name: "Booth: click the floor to put up a vocal booth", icon: `<path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/>` },
  { id: "place", name: "Place: pick from the catalog, click the floor", icon: `<path d="M5 12h14"/><path d="M12 5v14"/>` },
  { id: "decor", name: "Decorate: pick a piece from the catalog, click the floor", icon: `<path d="M8 2h8l4 10H4L8 2Z"/><path d="M12 12v6"/><path d="M8 22v-2c0-1.1.9-2 2-2h4a2 2 0 0 1 2 2v2H8Z"/>` },
  { id: "paint", name: "Paint: pick a material, click the floor or a wall", icon: `<rect width="16" height="6" x="2" y="2" rx="2"/><path d="M10 16v-2a2 2 0 0 1 2-2h8a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect width="4" height="6" x="8" y="16" rx="1"/>` },
  { id: "pa", name: "PA: click the ground to stand a stack of the rig there, facing the floor's middle", icon: `<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M12 6h.01"/><circle cx="12" cy="14" r="4"/><path d="M12 14h.01"/>` },
  { id: "turn", name: "Turn: click a seat or a piece to turn it an eighth, a stack or a bank a twelfth (Shift: back)", icon: `<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>` },
  { id: "remove", name: "Remove: click a seat, a piece, a wall, a booth, a stack or a bank", icon: `<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>` },
];
const icon = (paths: string) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const NAMES: Record<SpotKind, string> = { keys: "keys", drums: "kit", bass: "bass synth", desk: "desk", booth: "mic", couch: "couch", dj: "decks" };
let painting: Material = "carpet", decorating: DecorKind = "plant";
let tool: Tool = "move", placing: SpotKind = "keys", view: "3d" | "plan" = "3d", walls: WallsMode = "cutaway";
const canvas = $("view") as HTMLCanvasElement;
let build: BuildView | null = null;
try { build = new BuildView(canvas); } catch { view = "plan"; /* no WebGL: the blueprint only */ }
if (build) build.venue.onChange = (s) => { if (s.state === "drawn" || s.state === "failed") renderParty(); };
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
  const g = e.target instanceof Element ? e.target.closest("[data-spot], [data-booth], [data-gear], [data-wall], [data-prop], [data-door], [data-stack], [data-bank]") : null;
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
  if (g.hasAttribute("data-stack")) return { stack: Number(g.getAttribute("data-stack")) };
  if (g.hasAttribute("data-bank")) return { bank: Number(g.getAttribute("data-bank")) };
  return spot ? { spot } : booth ? { booth } : wall !== null ? { wall: Number(wall) } : piece !== null ? { prop: Number(piece) } : { gear: true };
}

let drag: { kind: "spot" | "booth" | "gear" | "prop" | "door" | "stack" | "bank"; id: string; from: number[]; at: number[]; g: SVGElement[]; start: number[] } | null = null;
let drawing: { from: [number, number]; to: [number, number] } | null = null;
let orbiting: { x: number; y: number } | null = null;

// two fingers on the 3D view: pinch to move in and out, slide sideways to turn round the room (a phone's right-drag)
const touches = new Map<number, { x: number; y: number }>();
let pinch: { dist: number; x: number; y: number } | null = null;
/** A one-click tool's touch, held until the finger lifts (null once a second finger makes it a pinch). */
let tap: PointerEvent | null = null;
const spread = () => { const [a, b] = [...touches.values()]; return a && b ? { dist: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null; };

function down(e: PointerEvent) {
  if (view === "3d" && e.pointerType === "touch") {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) { pinch = spread(); tap = null; drag = null; drawing = null; build?.drawing(null); $("measure").hidden = true; return; }
    if (touches.size > 2) return;
  }
  if (view === "3d" && (e.button === 2 || e.button === 1)) { orbiting = { x: e.clientX, y: e.clientY }; try { canvas.setPointerCapture(e.pointerId); } catch { /* gone */ } return; }
  if (e.button !== 0) return;
  // a finger's tap on a one-click tool waits until it lifts: it may be the first of a pinch
  if (e.pointerType === "touch" && tool !== "move" && tool !== "wall") { tap = e; return; }
  act(e);
}
/** The tool's work for a press at `e`. */
function act(e: PointerEvent) {
  const p = pointAt(e), h = hitAt(e), at = (p ? [tenth(p[0]), tenth(p[1])] : null) as [number, number] | null;
  why = "";
  if (tool === "move") {
    if (!h || !("spot" in h || "booth" in h || "gear" in h || "prop" in h || "door" in h || "stack" in h || "bank" in h)) return;
    if ("bank" in h) {
      const b = room.outdoor?.banks?.[h.bank];
      if (!b || !p) return;
      drag = { kind: "bank", id: String(h.bank), from: [...b.at], at: [...b.at], g: [...plan.querySelectorAll<SVGElement>(`[data-bank="${h.bank}"]`)], start: p };
      return;
    }
    if ("stack" in h) {
      const st = rigStacks(room)[h.stack];
      stackPicked = h.stack; render();
      if (!st || !p) return;
      drag = { kind: "stack", id: String(h.stack), from: [...st.at], at: [...st.at], g: [...plan.querySelectorAll<SVGElement>(`[data-stack="${h.stack}"]`)], start: p };
      return;
    }
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
  } else if (tool === "pa") {
    if (at && apply({ t: "stack", at })) { stackPicked = (roomPa(room)?.stacks.length ?? 1) - 1; render(); }
  } else if (tool === "turn") {
    if (h && "stack" in h) { const st = roomPa(room)?.stacks[h.stack]; stackPicked = h.stack; if (st) apply({ t: "aimStack", index: h.stack, yaw: st.yaw + (e.shiftKey ? -1 : 1) * Math.PI / 12 }); }
    else if (h && "bank" in h) { const b = room.outdoor?.banks?.[h.bank]; if (b) apply({ t: "turnBank", index: h.bank, yaw: b.yaw + (e.shiftKey ? -1 : 1) * Math.PI / 12 }); }
    else if (h && "spot" in h) { picked = h.spot; apply({ t: "turn", id: h.spot, by: e.shiftKey ? -1 : 1 }); }
    else if (h && "prop" in h) apply({ t: "turnProp", index: h.prop, by: e.shiftKey ? -1 : 1 });
  } else if (tool === "remove") {
    if (h && "spot" in h) { if (apply({ t: "unspot", id: h.spot }) && picked === h.spot) { picked = room.spots[0]?.id; render(); } }
    else if (h && "booth" in h) apply({ t: "unbooth", id: h.booth });
    else if (h && "wall" in h) apply({ t: "unwall", index: h.wall });
    else if (h && "prop" in h) apply({ t: "unprop", index: h.prop });
    else if (h && "bank" in h) apply({ t: "unbank", index: h.bank });
    else if (h && "stack" in h && apply({ t: "unstack", index: h.stack })) { stackPicked = null; render(); }
  }
  try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* a pointer that already left */ }
}
function move(e: PointerEvent) {
  if (touches.has(e.pointerId)) {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const now = spread();
    if (pinch && now && build) {
      // the spread zooms toward the floor between the fingers; sliding them sideways turns
      build.orbit(-(now.x - pinch.x) * 0.008);
      build.zoomAt(pinch.dist / Math.max(now.dist, 1), build.toRoom({ clientX: now.x, clientY: now.y }));
      pinch = now; return;
    }
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
  if (tap && e && tap.pointerId === e.pointerId && !pinch) { const t = tap; tap = null; act(t); return; }
  if (pinch) { if (touches.size < 2) pinch = null; return; }
  orbiting = null;
  if (drag) {
    const d = drag; drag = null;
    if (d.at[0] === d.from[0] && d.at[1] === d.from[1]) return render();
    // a stack moves by what it was dragged: where the room stood it, not where its block drew it
    const stored = d.kind === "stack" ? roomPa(room)?.stacks[Number(d.id)]?.at : undefined;
    if (stored) return void apply({ t: "moveStack", index: Number(d.id), at: [tenth(stored[0] + d.at[0] - d.from[0]), tenth(stored[1] + d.at[1] - d.from[1])] });
    if (d.kind === "bank") return void apply({ t: "moveBank", index: Number(d.id), at: [d.at[0], d.at[1]] });
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
canvas.addEventListener("wheel", (e) => { e.preventDefault(); build?.zoomAt(Math.exp(e.deltaY * 0.0012), build.toRoom(e)); }, { passive: false });

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
const WAVES = `<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>`;
const TIMER = `<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>`;
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
    + (view === "3d" ? b(`data-walls`, `${WALL_WORDS[walls]} (click for the next)`, LAYERS) : "")
    + (paSpeakers(room).length ? b(`data-map="1"`, "Coverage: how loud the PA is over the floor", WAVES, showMap) : "")
    + (paSpeakers(room).length > 1 ? b(`data-delay="1"`, "Delay: how late the far stacks land, on the blueprint (a delay tower's place)", TIMER, showDelay) : "");
  $("orbit").innerHTML = view === "3d" ? b(`data-orbit="1"`, "Turn the view left", CCW) + b(`data-orbit="-1"`, "Turn the view right", CW) : "";
  const cat = $("catalog");
  cat.hidden = tool !== "place" && tool !== "paint" && tool !== "decor";
  if (tool === "decor") {
    if (build && !Object.keys(decorThumbs).length) decorThumbs = Object.fromEntries(DECOR_KINDS.map((k) => [k, build!.thumb({ kind: k, at: [0, 0], yaw: 0, ...DECOR[k]!, seed: 13 })]));
    cat.innerHTML = DECOR_KINDS.filter((k) => room.outdoor || !OUTDOOR_DECOR.includes(k)).map((k) => `<button type="button" data-decor="${k}" aria-pressed="${k === decorating}" title="${esc(DECOR_NAMES[k])}">${decorThumbs[k] ? `<img src="${decorThumbs[k]}" alt="">` : ""}<span>${esc(DECOR_NAMES[k])}</span></button>`).join("");
  }
  if (tool === "paint") cat.innerHTML = MATERIAL_IDS.map((m) => `<button type="button" data-paint="${m}" aria-pressed="${m === painting}" title="${esc(MATERIALS[m].name)}">${swatch(m)}<span>${esc(MATERIALS[m].name)}</span></button>`).join("");
  if (tool === "place") {
    if (build && !Object.keys(thumbs).length) thumbs = Object.fromEntries(KINDS_ALL.map((k) => [k, build!.thumb(newSpot(`thumb-${k}`, k, [0, 0]))]));
    cat.innerHTML = KINDS_ALL.map((k) => `<button type="button" data-kind="${k}" aria-pressed="${k === placing}" title="${esc(NAMES[k])}">${thumbs[k] ? `<img src="${thumbs[k]}" alt="">` : ""}${esc(NAMES[k])}</button>`).join("");
  }
  canvas.hidden = view !== "3d"; plan.toggleAttribute("hidden", view !== "plan");
}
const KEYS_NAMES: Record<(typeof POLY_KINDS)[number], string> = { "wood-poly": "Analog poly", "fm-slab": "FM slab", drawbar: "Drawbar organ", "tine-ep": "Tine piano", combo: "Combo organ", strings: "String machine" };
const KINDS_ALL: SpotKind[] = ["keys", "drums", "bass", "dj", "desk", "booth", "couch"];
const DECOR_NAMES: Record<DecorKind, string> = { shelf: "shelf", lamp: "lamp", plant: "plant", rug: "rug", rack: "rack", piano: "grand piano", micStand: "mic stand", table: "table", cabinet: "cabinet", books: "books", drumMachine: "drum machine", modular: "modular", monitor: "monitor", wedge: "floor wedge", riser: "stage riser", van: "camper van", firePit: "fire pit" };
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
  if (t.dataset.map) showMap = !showMap;
  if (t.dataset.delay) { showDelay = !showDelay; if (showDelay) view = "plan"; }
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

// ---- the PA: the picked stack's aim, the coverage, the power, and what to take away ----

/** The coverage map of the room as it stands, kept until the room changes. */
let mapFor: { room: StudioDef; map: FloorMap | null; heat?: HTMLCanvasElement | null; late?: DelayMap | null } | null = null;
function paMap(): FloorMap | null {
  if (mapFor?.room !== room) mapFor = { room, map: floorMap(room) };
  return mapFor.map;
}
/** The coverage map as a picture (the blueprint's and the 3D floor's), and the delay view: kept until the room changes. */
function paHeat(): HTMLCanvasElement | null {
  const map = paMap();
  return mapFor!.heat ??= map ? heatCanvas(map.grid, map.ref) : null;
}
function paDelay(): DelayMap | null {
  paMap();
  if (mapFor!.late === undefined) mapFor!.late = delayMap(room);
  return mapFor!.late;
}
const deg = (r: number) => Math.round((r * 180) / Math.PI), rad = (d: number) => (d * Math.PI) / 180;
const GROUND_NAMES: Record<Ground, string> = { grass: "Grass", soil: "Trodden soil", tarmac: "Tarmac", water: "Water" };
/** Lucide's mountain: a bank on the field. */
const MOUNTAIN = `<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>`;
/** A bank the panel stands: across the picked stack's throw (the first stack's, none picked), 6 m out, 10 m long, 2.5 m high
 *  (over the horns' line to the ears behind it: a lower one hides nothing). */
function bankAhead(): { t: "bank"; at: [number, number]; yaw: number; len: number; h: number } | null {
  const stacks = roomPa(room)?.stacks ?? [], st = stacks[stackPicked ?? 0];
  if (!st) return null;
  return { t: "bank", at: [st.at[0] + Math.sin(st.yaw) * 6, st.at[1] + Math.cos(st.yaw) * 6], yaw: st.yaw, len: 10, h: 2.5 };
}

/** The outdoor panel: the night's air and what the crowd stands on, the banks on the field (pa-room.ts roomField). */
function fieldPanel(): string {
  const f = roomField(room);
  if (!f) return "";
  const loss = (hz: number) => (airAbsorption(hz, f.tempC, f.humidity) * 100).toFixed(1);
  const x = (attrs: string, name: string) => `<button type="button" class="x" ${attrs} aria-label="${esc(name)}" title="${esc(name)}">${icon(X)}</button>`;
  const list = room.outdoor?.banks ?? [];
  return `<h2>Air and ground</h2>
    <div class="row"><label>Air ${f.tempC.toFixed(0)} °C<input type="range" min="-10" max="40" step="1" data-field="tempC" value="${f.tempC}"></label>
      <label>Humidity ${f.humidity.toFixed(0)} %<input type="range" min="10" max="100" step="5" data-field="humidity" value="${f.humidity}"></label></div>
    <div class="row"><label>Ground<select id="ground">${GROUNDS.map((g) => `<option value="${g}"${g === f.ground ? " selected" : ""}>${GROUND_NAMES[g]}</option>`).join("")}</select></label></div>
    <p class="hint">Sound at ${speedOfSound(f.tempC).toFixed(1)} m/s. Over 100 m this air takes ${loss(1000)} dB off 1 kHz, ${loss(4000)} off 4 kHz, ${loss(8000)} off 8 kHz.</p>
    ${list.length ? `<ul class="why">${list.map((b, i) => `<li><span>Bank ${i + 1}, ${b.h.toFixed(1)} m high, ${b.len.toFixed(0)} m long</span>${x(`data-unbank="${i}"`, `Take bank ${i + 1} away`)}</li>`).join("")}</ul>` : `<p class="hint">Flat ground. A bank between a stack and you cuts its highs behind it.</p>`}
    <div class="row"><button type="button" class="tool" id="bank" aria-label="Bank across the stack's throw" title="Bank: a 2.5 m bank across the picked stack's throw, 6 m out"${bankAhead() ? "" : " disabled"}>${icon(MOUNTAIN)}</button></div>`;
}
const kw = (w: number) => `${(w / 1000).toFixed(1)} kW`;

function renderPa() {
  const host = $("pa"), map = paMap();
  if (!map) { host.innerHTML = ""; return; }
  const rp = rigPlan(room), power = rp ? powerPlan(rp) : null, stacks = roomPa(room)?.stacks ?? [];
  if (stackPicked !== null && !stacks[stackPicked]) stackPicked = null;
  const st = stackPicked !== null ? stacks[stackPicked] : undefined, line = roomRig(room).stack.filter((b) => b.startsWith("line-array")).length;
  const pins = st?.pins ?? [0.14, 0.07, 0.02];
  host.innerHTML = `<h2>PA</h2>
    <div class="big">${map.stats.mean.toFixed(0)} dB <small>over the floor, ${map.stats.even.toFixed(1)} dB from its quiet tenth to its loud</small></div>
    <p class="hint">Quietest ${map.stats.min.toFixed(0)} dB, loudest ${map.stats.max.toFixed(0)} dB at ear height, mids and highs. ${showMap ? "The map is against the ring on the floor: gold louder, orange within 3 dB, teal 9 down, blue past 15." : "Coverage (the waves over the view) draws it on the floor."}</p>
    ${rp ? `${st ? `<h2>Stack ${stackPicked! + 1}</h2>
      <div class="row"><label>Aim, degrees<input type="range" min="-180" max="180" step="1" data-aim="yaw" value="${deg(st.yaw)}"></label></div>
      <div class="row"><label>Splay of its tops, degrees<input type="range" min="-30" max="30" step="1" data-aim="splay" value="${deg(st.splay ?? 0)}"></label></div>
      ${line ? `<div class="row">${Array.from({ length: line }, (_, k) => `<label>Pin ${k + 1}, down<input type="number" min="0" max="17" step="0.5" data-pin="${k}" value="${deg(pins[k] ?? 0)}"></label>`).join("")}</div>` : ""}
      <div class="row"><button type="button" id="unstack">Take stack ${stackPicked! + 1} away</button></div>` : `<p class="hint">Pick a stack on the plan to aim it; the PA tool stands a new one.</p>`}
    ${fieldPanel()}
    <h2>Power</h2>
    ${room.outdoor ? "" : `<p class="hint">Indoors, what a generator would have to give to run it: the house supply's limit is the venue's to say.</p>`}
    <div class="row"${room.outdoor ? "" : " hidden"}><label>Generator<select id="gen-set"><option value="auto"${power?.auto ? " selected" : ""}>The smallest that holds</option>${GENERATOR_IDS.map((g) => `<option value="${g}"${!power?.auto && power?.generator === g ? " selected" : ""}>${esc(sheet(g).what)}</option>`).join("")}</select></label></div>
    ${power ? `<p class="${power.ok ? "hint" : "bad"}">${power.ok ? "Holds" : "Fails"}: ${power.channels} amp channels on ${power.racks} rack${power.racks === 1 ? "" : "s"}, ${kw(power.feed.watts)} of the ${esc(sheet(power.generator).what)}'s ${kw(power.feed.limit)} at show level.</p>
      ${power.why.length || power.warn.length ? `<ul class="why">${power.why.map((w) => `<li class="bad">${esc(w)}</li>`).join("")}${power.warn.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}` : ""}
    <h2>Take it away</h2>
    <div class="row"><button type="button" id="dl-list">Gear list</button><button type="button" id="dl-plan">Plan drawing</button></div>` : `<p class="hint">With none of its own, the PA is a stack either side of the decks: the PA tool stands your own.</p>`}`;
  const q = <T extends Element>(sel: string) => [...host.querySelectorAll<T>(sel)];
  for (const i of q<HTMLInputElement>("[data-aim]")) i.addEventListener("change", () => { if (stackPicked !== null) apply({ t: "aimStack", index: stackPicked, [i.dataset.aim!]: rad(Number(i.value)) }); });
  for (const i of q<HTMLInputElement>("[data-pin]")) i.addEventListener("change", () => {
    if (stackPicked === null) return;
    const next = [...pins]; next[Number(i.dataset.pin)] = rad(Math.max(0, Math.min(17, Number(i.value))));
    apply({ t: "aimStack", index: stackPicked, pins: next.slice(0, line) });
  });
  document.getElementById("unstack")?.addEventListener("click", () => { if (stackPicked !== null && apply({ t: "unstack", index: stackPicked })) { stackPicked = null; render(); } });
  for (const i of q<HTMLInputElement>("[data-field]")) i.addEventListener("change", () => apply({ t: "field", [i.dataset.field!]: Number(i.value) }));
  document.getElementById("ground")?.addEventListener("change", (e) => apply({ t: "field", ground: (e.target as HTMLSelectElement).value }));
  for (const b of q<HTMLButtonElement>("[data-unbank]")) b.addEventListener("click", () => apply({ t: "unbank", index: Number(b.dataset.unbank) }));
  document.getElementById("bank")?.addEventListener("click", () => { const b = bankAhead(); if (b) apply(b); });
  document.getElementById("gen-set")?.addEventListener("change", (e) => apply({ t: "generator", set: (e.target as HTMLSelectElement).value }));
  document.getElementById("dl-list")?.addEventListener("click", () => download("list"));
  document.getElementById("dl-plan")?.addEventListener("click", () => download("plan"));
}

/** The plan as a drawing that stands on its own: the blueprint with its styles written in, the coverage map on it. */
function planSvg(): string {
  const was = showMap;
  showMap = true; render();
  const css = getComputedStyle(plan), v = (n: string) => css.getPropertyValue(n).trim();
  const rules = [...document.styleSheets].flatMap((sh) => { try { return [...sh.cssRules]; } catch { return []; } })
    .map((r) => r.cssText).filter((t) => t.startsWith("#plan ")).map((t) => t.replace(/^#plan /, "").replace(/var\((--[\w-]+)\)/g, (_, n: string) => v(n)));
  const out = plan.cloneNode(true) as SVGSVGElement;
  out.removeAttribute("hidden"); out.setAttribute("xmlns", SVG);
  const style = document.createElementNS(SVG, "style");
  style.textContent = `svg { background: ${v("--card")}; font-family: sans-serif; }\n${rules.join("\n")}`;
  out.prepend(style);
  showMap = was; render();
  return new XMLSerializer().serializeToString(out);
}

/** The gear list (with the power plan) or the plan drawing, saved as a file; what was saved, for the harness. */
function download(what: "list" | "plan"): { name: string; text: string } | null {
  const rp = rigPlan(room);
  if (!rp) return null;
  const name = `${room.id}-${what === "list" ? "gear-list.txt" : "plan.svg"}`, text = what === "list" ? gearListText(gearList(rp), room.name) : planSvg();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: what === "list" ? "text/plain" : "image/svg+xml" }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return { name, text };
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
    <h2>Instruments</h2>
    <div class="row"><label>Keys<select id="keys-kind">${POLY_KINDS.map((k) => `<option value="${k}"${k === room.keys ? " selected" : ""}>${esc(KEYS_NAMES[k])}</option>`).join("")}</select></label>
      <label>Bass<select id="bass-kind"><option value="mono"${room.bass !== "box" ? " selected" : ""}>Big analog mono</option><option value="box"${room.bass === "box" ? " selected" : ""}>Bass-line box</option></select></label>
      ${roomPa(room) ? `<label>Rig<select id="rig-kind">${SYSTEM_IDS.map((id) => `<option value="${id}"${id === (roomPa(room)?.rig ?? "dance-stack") ? " selected" : ""}>${esc(SYSTEMS[id].name)}</option>`).join("")}</select></label>` : ""}</div>
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
  $("keys-kind").addEventListener("change", (e) => apply({ t: "instruments", keys: (e.target as HTMLSelectElement).value }));
  $("bass-kind").addEventListener("change", (e) => apply({ t: "instruments", bass: (e.target as HTMLSelectElement).value }));
  document.getElementById("rig-kind")?.addEventListener("change", (e) => apply({ t: "instruments", rig: (e.target as HTMLSelectElement).value }));
  $("add-booth").addEventListener("click", () => {
    const id = free("booth", (x) => room.walls.some((wl) => wl.booth === x));
    const at = grid().find((p) => edit(room, { t: "booth", id, at: p, w: 2.4, d: 2.4 }).ok);
    if (!at) { why = "no room left for a booth"; return render(); }
    apply({ t: "booth", id, at, w: 2.4, d: 2.4 });
  });
}

// ---- the party (Qevent, #5915): a party's scenes, one per performer, its saved versions, and the one live party ----

/** Do a party change (party.ts); the builder then shows the open party's scene on stage, with that scene's undo history. */
function partyDo(d: Done): boolean {
  why = d.ok ? "" : d.why;
  if (d.ok) {
    parties = d.store;
    const scene = openScene(parties), key = `${parties.open ?? ""}/${openParty(parties)?.scene ?? ""}`;
    let h = histories.get(key);
    if (!h) histories.set(key, (h = [[], []]));
    [undos, redos] = h;
    if (scene) room = scene.studio;
    if (picked && !room.spots.some((s) => s.id === picked)) picked = room.spots[0]?.id;
    stackPicked = null;
    save();
  }
  render();
  return d.ok;
}
/** The open party's venue (#5933): a ShareSplat capture of the real place, round every scene, and how it sits. */
function venueRows(): string {
  const v = room.venue, drawn = build?.venue.state;
  const note = !v ? "Put the place online with ShareSplat (a walk round it, every wall), paste its link here, and every scene is laid out inside it."
    : drawn?.state === "failed" ? `The capture would not load: ${drawn.why}` : drawn?.state === "loading" ? "Loading the capture" : "Every scene stands in this venue. Size, height and turn line it up with the seats.";
  return `<h2>Venue</h2>
      <div class="row"><label>ShareSplat link<input id="venue-link" value="${esc(v?.src ?? "")}" placeholder="https://sharesplat.notryanquinn.workers.dev/p/..."></label></div>
      <div class="row"><label>Size<input id="venue-scale" type="number" step="0.1" min="0.05" max="100" value="${v?.scale ?? 1}"></label><label>Height (m)<input id="venue-y" type="number" step="0.1" min="-50" max="50" value="${v?.at[1] ?? 0}"></label><label>Turn (deg)<input id="venue-yaw" type="number" step="15" value="${Math.round(((v?.yaw ?? 0) * 180) / Math.PI)}"></label></div>
      <div class="row"><button type="button" id="venue-set">${v ? "Update venue" : "Use venue"}</button>${v ? `<button type="button" id="venue-drop">No venue</button>` : ""}</div>
      <p class="hint">${esc(note)}</p>`;
}
/** The live party's join link, for anyone on any device: its own room, carrying the scene on stage; null signed out. */
function joinLink(): string | null {
  const p = parties.parties.find((q) => q.id === parties.live), on = liveStudio(parties);
  if (!owner || !p || !on) return null;
  const u = new URL(builtLink(location.origin, on, partyRoom(owner, p.id)));
  u.searchParams.set("name", p.name);
  // the jam page asks the owner's store what's on stage, so a scene switch reaches everyone in the room (#5963)
  u.searchParams.set("party", owner);
  return u.href;
}
/** A <input type="datetime-local"> value and back: empty is open now. */
const toLocal = (ms: number | null) => ms === null ? "" : new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const fromLocal = (v: string) => { const ms = v ? new Date(v).getTime() : NaN; return Number.isFinite(ms) ? ms : null; };

function renderParty() {
  const host = $("party"), p = openParty(parties), x = (attrs: string, name: string) => `<button type="button" class="x" ${attrs} aria-label="${esc(name)}" title="${esc(name)}">${icon(X)}</button>`;
  if (!p) {
    host.innerHTML = `<h2>Party</h2>
      ${parties.parties.length ? `<ul class="parties">${parties.parties.map((q) => `<li><button type="button" data-party-open="${q.id}">${esc(q.name)}</button><span class="hint">${esc(whenWords(q.when))}${q.id === parties.live ? " · live" : ""}</span>${x(`data-party-drop="${q.id}"`, `Take ${q.name} away, with every version`)}</li>`).join("")}</ul>` : ""}
      <div class="row"><label>Name<input id="party-name" maxlength="60" placeholder="Saturday night"></label><label>Starts (empty: open now)<input id="party-when" type="datetime-local"></label></div>
      <div class="row"><button type="button" class="go" id="party-make">Make a party</button></div>
      <p class="hint">Its first scene is the room you have now. Each performer gets a scene of their own.</p>`;
  } else {
    const live = parties.live === p.id, join = joinLink();
    host.innerHTML = `<h2>Party</h2>
      <div class="row"><label>Name<input id="party-rename" maxlength="60" value="${esc(p.name)}"></label><label>Starts (empty: open now)<input id="party-when" type="datetime-local" value="${toLocal(p.when)}"></label></div>
      <div class="row"><button type="button" id="party-live" class="${live ? "go" : ""}" aria-pressed="${live}">${live ? "Live" : "Go live"}</button><button type="button" id="party-close">All parties</button></div>
      <p class="hint">${live ? "The room people join: Enter walks its scene on stage." : parties.live ? "Another party is live; only one is at a time." : "Not live yet: you can change it before or during the event."}</p>
      ${live ? join ? `<div class="row"><a class="button" id="party-join" href="${esc(join)}" target="_blank" rel="noopener">Join link</a><button type="button" id="party-copy">Copy link</button></div>` : `<p class="hint">Sign in with eqosys on the front door to give it a join link for any device.</p>` : ""}
      <h2>Scenes</h2>
      <ul class="scenes">${p.scenes.map((s) => `<li><button type="button" data-scene="${s.id}" aria-pressed="${s.id === p.scene}">${esc(s.performer)}</button><span class="hint">${s.studio.spots.length} seat${s.studio.spots.length === 1 ? "" : "s"}</span>${p.scenes.length > 1 ? x(`data-scene-drop="${s.id}"`, `Take ${s.performer}'s scene out`) : ""}</li>`).join("")}</ul>
      <div class="row"><label>Next performer<input id="scene-name" maxlength="40"></label><button type="button" id="scene-add">Add scene</button></div>
      ${p.scenes.length > 1 ? `<div class="row"><button type="button" id="scene-all">Everyone at once</button></div>` : ""}
      ${venueRows()}
      <h2>Versions</h2>
      <div class="row"><label>What changed<input id="version-note" maxlength="80"></label><button type="button" id="version-save">Save version</button></div>
      ${p.versions.length ? `<ul class="versions">${[...p.versions].reverse().map((v) => `<li><span>v${v.n}${v.note ? ` ${esc(v.note)}` : ""} <small class="hint">${esc(whenWords(v.at))}</small></span><button type="button" data-restore="${v.n}">Bring back</button></li>`).join("")}</ul>` : `<p class="hint">No versions saved yet. Every one you save stays.</p>`}`;
  }
  const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";
  document.getElementById("party-make")?.addEventListener("click", () => partyDo(makeParty(parties, val("party-name"), fromLocal(val("party-when")), room)));
  document.getElementById("party-rename")?.addEventListener("change", () => partyDo(reschedule(parties, { name: val("party-rename") })));
  if (p) document.getElementById("party-when")?.addEventListener("change", () => partyDo(reschedule(parties, { when: fromLocal(val("party-when")) })));
  document.getElementById("party-live")?.addEventListener("click", () => partyDo(goLive(parties, parties.live === p?.id ? null : p?.id ?? null)));
  document.getElementById("party-close")?.addEventListener("click", () => partyDo(open(parties, undefined)));
  document.getElementById("party-copy")?.addEventListener("click", (e) => {
    const b = e.currentTarget, link = joinLink();
    if (!(b instanceof HTMLButtonElement) || !link) return;
    void navigator.clipboard?.writeText(link).then(() => { b.textContent = "Copied"; setTimeout(() => { b.textContent = "Copy link"; }, 1600); }, () => {});
  });
  document.getElementById("scene-add")?.addEventListener("click", () => partyDo(addScene(parties, val("scene-name"), room)));
  document.getElementById("scene-all")?.addEventListener("click", () => partyDo(everyone(parties)));
  document.getElementById("version-save")?.addEventListener("click", () => partyDo(saveVersion(parties, val("version-note"), Date.now())));
  document.getElementById("venue-set")?.addEventListener("click", () => {
    const src = venueSrc(val("venue-link")), num = (id: string, d: number) => Number.isFinite(parseFloat(val(id))) ? parseFloat(val(id)) : d;
    partyDo(src ? setVenue(parties, { src, scale: num("venue-scale", 1), at: [room.venue?.at[0] ?? 0, num("venue-y", 0), room.venue?.at[2] ?? 0], yaw: (num("venue-yaw", 0) * Math.PI) / 180 })
      : { ok: false, store: parties, why: "That isn't a ShareSplat link: paste the link it gave you when you put the capture online" });
  });
  document.getElementById("venue-drop")?.addEventListener("click", () => partyDo(setVenue(parties, null)));
}
$("party").addEventListener("click", (e) => {
  const t = e.target instanceof Element ? e.target.closest<HTMLElement>("button") : null, d = t?.dataset;
  if (!d) return;
  if (d.partyOpen) partyDo(open(parties, d.partyOpen));
  else if (d.partyDrop) partyDo(dropParty(parties, d.partyDrop));
  else if (d.scene) partyDo(switchScene(parties, d.scene));
  else if (d.sceneDrop) partyDo(dropScene(parties, d.sceneDrop));
  else if (d.restore) partyDo(restore(parties, Number(d.restore)));
});

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
  /** The PA: its stacks where they stand, the coverage over the floor, the power plan, the picked stack. */
  pa: () => {
    const map = paMap(), rp = rigPlan(room), field = roomField(room);
    return {
      stacks: rigStacks(room), picked: stackPicked, map: showMap,
      coverage: map ? { ref: +map.ref.toFixed(1), middle: map.middle, mean: +map.stats.mean.toFixed(1), min: +map.stats.min.toFixed(1), max: +map.stats.max.toFixed(1), even: +map.stats.even.toFixed(1) } : null,
      power: rp ? powerPlan(rp) : null,
      field: field ? { tempC: field.tempC, humidity: field.humidity, ground: field.ground, speed: +speedOfSound(field.tempC).toFixed(1), banks: room.outdoor?.banks ?? [] } : null,
    };
  },
  /** The coverage map's level at (x, z) on the floor, dB. */
  level: (x: number, z: number) => { const m = paMap(); return m ? +mapAt(m, x, z).toFixed(1) : null; },
  /** Each speaker's sound at (x, z) on the floor, in paSpeakers' order: how much later than the first it lands (ms) and
   *  how far under the loudest it is (dB). */
  delay: (x: number, z: number) => paSpeakers(room).length ? arrivals(room, x, z).map((a) => ({ ms: +a.ms.toFixed(1), down: +a.down.toFixed(1) })) : [],
  pickStack: (i: number | null) => { stackPicked = i; render(); },
  /** Show the coverage map (on the blueprint, or the 3D view's floor), or not. */
  showMap: (on = true) => { showMap = on; render(); },
  /** Show the delay view on the blueprint, or not; the cells drawn amber or red, for the harness. */
  showDelay: (on = true) => {
    showDelay = on; if (on) view = "plan"; render();
    const late = paDelay();
    return late ? { smear: late.ms.filter((v) => v >= 10 && v < 30).length, echo: late.ms.filter((v) => v >= 30).length } : null;
  },
  /** Which view shows, and whether the 3D floor wears the coverage map. */
  view: (v?: "3d" | "plan") => { if (v) { view = v === "3d" && build ? "3d" : "plan"; render(); } return { view, heatOnFloor: view === "3d" && showMap && !!paHeat() }; },
  download: (what: "list" | "plan") => download(what),
  undo: () => undo(true),
  redo: () => undo(false),
  /** The party (Qevent): every change answers { ok, why } as `edit` does. */
  party: {
    state: () => {
      const p = openParty(parties);
      return {
        open: p ? { id: p.id, name: p.name, when: p.when, scene: p.scene, scenes: p.scenes.map((s) => ({ id: s.id, performer: s.performer, seats: s.studio.spots.length })), versions: p.versions.map((v) => ({ n: v.n, note: v.note })), venue: room.venue ?? null, drawn: build?.venue.state ?? null } : null,
        live: parties.live ?? null, parties: parties.parties.map((q) => q.id),
        /** Your owner key once your eqosys account answered (null: this browser's parties alone), and the live party's join link. */
        owner, join: joinLink(),
      };
    },
    make: (name: string, when: number | null = null) => ({ ok: partyDo(makeParty(parties, name, when, room)), why }),
    /** Lay every scene out in a captured venue (any ShareSplat link), or none. */
    venue: (link: string | null, place: { scale?: number; at?: [number, number, number]; yaw?: number } = {}) => {
      const src = link === null ? null : venueSrc(link);
      if (link !== null && !src) return { ok: false, why: "not a ShareSplat link" };
      return { ok: partyDo(setVenue(parties, src ? { src, scale: place.scale ?? 1, at: place.at ?? [0, 0, 0], yaw: place.yaw ?? 0 } : null)), why };
    },
    open: (id?: string) => ({ ok: partyDo(open(parties, id)), why }),
    drop: (id: string) => ({ ok: partyDo(dropParty(parties, id)), why }),
    live: (on = true) => ({ ok: partyDo(goLive(parties, on ? parties.open ?? null : null)), why }),
    when: (when: number | null) => ({ ok: partyDo(reschedule(parties, { when })), why }),
    addScene: (performer: string) => ({ ok: partyDo(addScene(parties, performer, room)), why }),
    scene: (id: string) => ({ ok: partyDo(switchScene(parties, id)), why }),
    dropScene: (id: string) => ({ ok: partyDo(dropScene(parties, id)), why }),
    everyone: () => ({ ok: partyDo(everyone(parties)), why }),
    save: (note = "") => ({ ok: partyDo(saveVersion(parties, note, Date.now())), why }),
    restore: (n: number) => ({ ok: partyDo(restore(parties, n)), why }),
  },
  pick: (id: string) => { picked = id; render(); },
  /** The link into /jam.html (in sesh `sesh`) that carries this room (builder.ts builtLink), for a probe whose browser has none of this page's storage. */
  enter: (sesh?: string) => builtLink(location.origin, room, sesh),
};
window.qrooms = harness;
render();
// your account's parties: what it keeps opens here (another device's work); an account with none takes this browser's
void eq.ready.then(() => sync.pull()).then((got) => {
  if (!got) return;
  owner = got.owner;
  if (got.store.parties.length) partyDo({ ok: true, store: got.store });
  else { sync.push(parties); render(); }
});
