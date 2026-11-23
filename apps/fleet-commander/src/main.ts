// The page: the bridge. It runs the sim at a fixed tick, draws it (view/scene.ts), and turns clicks and keys into
// orders: pick wings or ships, mark a Compact ship, call a play, set stance and formation, order the flagship to
// broadside or rake. `window.fleetCommander` is the harness (scripts/probe.ts HANDLES): state() says what is on the
// table, and its moves play the game without a mouse.
import { createElement, Crosshair, Eye, Sparkles, Megaphone, PenLine, LogOut, Layers, Shield, Swords, Scale, Triangle, Rows3, Shuffle, Flame, Magnet, Anchor, Target, Split, Hammer, Rocket, Undo2, Radar, Ghost, Telescope, RadioTower, Thermometer, Map as MapIcon, type IconNode } from "lucide";
import { addCommands, howToPlay } from "@rustybuns/util/commands";
import { mountPalette } from "@rustybuns/util/palette";
import { esc } from "@rustybuns/util";
import { accountChip, finishSignIn } from "./eqosys.ts";
import { CRAFT_NAME, POWER_NAME, SHIP_NAME, type Role } from "./names.ts";
import { COMMS_LAG, DT, FOCUS, HULL, alive, flagship, ship, step, usePower, wing, type Formation, type Power, type Ship, type Stance, type Wing, type WingOrder, type World } from "./sim/world.ts";
import { PLAYS, landsAt, playById, send, wingsOf, type PlayId } from "./sim/plays.ts";
import { autoCommander, brains } from "./sim/ai.ts";
import { armada, battle, quick, type Fleet } from "./sim/scenarios.ts";
import { BUY, PING, eyes, ping, requisition, theater, theaterBrains, type Buy } from "./sim/theater.ts";
import { Bridge, shipAt as anyShipAt, type Look, type Overlay } from "./view/scene.ts";
import { Minimap } from "./view/minimap.ts";
import { LANES, SYSTEMS, jump, neighbours, newSector, refit, refitCost, settle, sys, threatAt, type Sector } from "./sector.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const icon = (n: IconNode, size = 18) => { const e = createElement(n); e.setAttribute("width", String(size)); e.setAttribute("height", String(size)); return e.outerHTML; };
const params = new URLSearchParams(location.search);

const canvas = $<HTMLCanvasElement>("stage");
const bridge = new Bridge(canvas, 7);
const minimap = new Minimap($<HTMLCanvasElement>("minimap"));

/** The brains a battle runs: the theater adds its sensors, mines and strongpoints in front of the usual ones. */
const brainsOf = (w: World) => (w.field ? theaterBrains : brains);
/** In the theater you only see (and so only click) the Compact ships your sensors have. */
const visible = (w: World, side: "navy" | "rim", id: number) => side === "navy" || !w.field || w.field.sees.navy.has(id);
const shipAt = (w: World, x: number, z: number, slop: number) => {
  const s = anyShipAt(w, x, z, slop);
  return s && visible(w, s.side, s.id) ? s : undefined;
};

type Screen = "menu" | "battle" | "sector" | "report";
const ui = {
  screen: "menu" as Screen,
  w: null as World | null,
  kind: "quick" as "quick" | "armada" | "campaign" | "theater",
  seed: 1,
  sel: new Set<number>(),
  target: 0,
  /** Only the harness pauses (probe shots); a player can't (taste call T2: real-time, no pause). */
  paused: false,
  /** The camera rides the flagship (T8): where it sits from the ship. Panning moves the offset, F resets it. */
  ride: { dx: 700, dz: 100, on: true },
  /** Drawing a play on the table: the pen (P) and the stroke being drawn, and the group the last stroke joined. */
  pen: false,
  stroke: null as { x: number; z: number }[] | null,
  drawGroup: 0,
  /** The last drawn attack: on a phone (no Shift), a route onto the same ship within 10 s is another arm of it. */
  lastDraw: { t: -99, target: 0 },
  speed: 1,
  acc: 0,
  banner: { text: "", until: 0 },
  sector: null as Sector | null,
  hudAt: 0,
  fogAt: 0,
};

// ---------------------------------------------------------------- battles

function startBattle(w: World, kind: typeof ui.kind) {
  ui.w = w; ui.kind = kind; ui.sel.clear(); ui.target = 0; ui.paused = false; ui.acc = 0;
  bridge.reset();
  const fl = flagship(w)!;
  // A tall screen sees less across: pull back and keep the flagship in frame.
  const tall = innerHeight > innerWidth;
  ui.ride = { dx: tall ? 350 : 700, dz: 100, on: true }; ui.stroke = null; ui.drawGroup = 0; ui.lastDraw = { t: -99, target: 0 };
  bridge.view.x = fl.x + ui.ride.dx; bridge.view.z = fl.z + ui.ride.dz; bridge.view.dist = (w.mode === "armada" ? 3600 : 2600) * (tall ? 1.5 : 1);
  bridge.view.tilt = 0.95;
  document.body.classList.toggle("theater", !!w.field);
  // The theater is a top-down RTS table: a free camera over the whole system, not one riding the flagship.
  if (w.field) { ui.ride.on = false; bridge.view.tilt = 1.15; bridge.view.x = fl.x + (tall ? 700 : 1600); bridge.view.z = fl.z; bridge.view.dist = 5200 * (tall ? 1.4 : 1); }
  show("battle");
  // Your wings start selected, so a first play works at once.
  if (w.mode === "flagship") for (const g of wingsOf(w, fl.id)) ui.sel.add(g.id);
  else for (const s of w.ships) if (s.side === "navy" && s.auto) ui.sel.add(s.id);
  const first = w.ships.find((s) => s.side === "rim" && s.kind === "carrier" && visible(w, s.side, s.id)) ?? w.ships.find((s) => s.side === "rim" && visible(w, s.side, s.id));
  if (first) ui.target = first.id;
  buildPlays();
  flash(w.field ? (touchMode ? "The board is dark. Tap the scouts card (3), then tap the black to send them." : "The board is dark. Send the scouts (key 3) into the black, drag a box to pick ships, right-click to move.") : w.mode === "armada" ? "You hold the Sovereign. Your captains wait for orders." : `Over ${w.planet.name}. Wings selected, the Compact carrier marked: call a play.`);
}

function startTheater(seed = ui.seed) { ui.seed = seed; startBattle(theater(seed), "theater"); }

function startQuick(seed = ui.seed) { ui.seed = seed; startBattle(quick(seed), "quick"); }
function startArmada(seed = ui.seed) { ui.seed = seed; startBattle(armada(seed), "armada"); }

function show(s: Screen) {
  ui.screen = s;
  if (s !== "battle") document.body.classList.remove("theater");
  $("hud").hidden = s !== "battle";
  $("menu").hidden = s !== "menu";
  $("sector").hidden = s !== "sector";
  $("report").hidden = s !== "report";
  if (s === "sector") drawSector();
}

function flash(text: string) { ui.banner = { text, until: performance.now() + 4500 }; $("banner").textContent = text; $("banner").classList.add("on"); }

/** The fleet as it leaves a battle: the flagship's hull and its wings' living craft. */
function fleetAfter(w: World): Fleet {
  const fl = w.ships.find((s) => s.id === w.flagship)!;
  return { hull: Math.max(0.2, fl.hull / fl.hullMax), reserve: fl.reserve, wings: wingsOf(w, fl.id).map((g) => ({ role: g.role, craft: alive(g).length })) };
}

function endBattle(w: World) {
  const o = w.outcome!;
  $("report-title").textContent = o === "win" ? "Victory" : o === "loss" ? "Defeat" : "No decision";
  $("report-why").textContent = w.why;
  const d = w.stats.dealt.navy, r = w.stats.dealt.rim;
  const rows: [string, string][] = [
    ["Time", clock(w.t)],
    ["Fighters lost", `${w.stats.navyCraftLost} of ours, ${w.stats.rimCraftLost} of theirs`],
    ["Ships lost", `${w.stats.shipsLost.navy} of ours, ${w.stats.shipsLost.rim} of theirs`],
    ["Our damage", `guns ${k(d.guns)}, torpedoes ${k(d.torps)}, fighters ${k(d.craft)}, on the land ${k(d.rake)}`],
    ["Their damage", `guns ${k(r.guns)}, torpedoes ${k(r.torps)}, fighters ${k(r.craft)}, mines ${k(r.mines)}`],
    ["Torpedoes", `${w.stats.torpsHit} hit, ${w.stats.torpsShot} shot down`],
    ["Shields split", String(w.stats.splits)],
  ];
  $("report-stats").innerHTML = rows.map(([a, b]) => `<dt>${a}</dt><dd>${esc(b)}</dd>`).join("");
  $("again").textContent = ui.kind === "campaign" ? "Back to the sector" : "Again";
  if (ui.kind === "campaign" && ui.sector) settle(ui.sector, o, fleetAfter(w));
  show("report");
}

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

// ---------------------------------------------------------------- selection and orders

const selWings = (w: World) => [...ui.sel].map((id) => wing(w, id)).filter((g): g is Wing => !!g && g.side === "navy");
const selShips = (w: World) => [...ui.sel].map((id) => ship(w, id)).filter((s): s is Ship => !!s && s.side === "navy");

function callPlay(id: PlayId) {
  const w = ui.w; if (!w) return;
  const p = playById(id);
  if (p.needsTarget && !ship(w, ui.target)) return flash(`${p.name}: mark a Compact ship first (click it).`);
  const ships = w.mode === "armada" ? selShips(w).filter((s) => s.auto) : [];
  const t = ship(w, ui.target);
  send(w, { at: landsAt(w), k: "play", id, wings: orderWings(w).map((g) => g.id), ships: ships.map((s) => s.id), target: p.needsTarget && t ? t.id : 0, fleet: ships.length > 0 });
  bark(`${p.name}${p.needsTarget && t ? ` on the ${t.name}` : ""}.`);
}

/** The wings an order goes to: the selected ones, or the flagship's when none is picked. */
const orderWings = (w: World) => { const ws = selWings(w); return ws.length ? ws : wingsOf(w, w.flagship); };

/** You say it on the bridge; the wings hear it when the radio gets it there (at once under Command Voice). */
function bark(line: string) {
  const w = ui.w; if (!w) return;
  const lag = w.t >= w.voiceUntil;
  flash(lag ? `${line} Radio: ${COMMS_LAG} s.` : line);
  w.comms.push({ t: w.t, side: "navy", who: "You", say: line });
}

/** What an order at a point means: attack the Compact ship or wing there, guard ours, or patrol the spot. */
function orderFor(w: World, x: number, z: number): WingOrder {
  const slop = bridge.unitsPerPixel(canvas.clientHeight) * 14;
  const s = shipAt(w, x, z, slop);
  const foeWing = w.wings.find((g) => g.side === "rim" && g.state === "out" && visible(w, g.side, g.id) && alive(g).some((c) => Math.hypot(c.x - x, c.z - z) < slop * 2));
  if (s && s.side === "rim") return { k: "attack", target: s.id, targetIs: "ship" };
  if (foeWing) return { k: "attack", target: foeWing.id, targetIs: "wing" };
  if (s && s.side === "navy") return { k: "escort", target: s.id, targetIs: "ship" };
  return { k: "patrol", x, z };
}

/** A play you drew: the stroke's points are the route; where it ends is the order (as a right-click there).
 *  `join` (Shift) makes it another arm of the last one: an attack's arms wait for each other at their routes' ends. */
function drawnPlay(stroke: { x: number; z: number }[], join: boolean) {
  const w = ui.w; if (!w || stroke.length < 2) return;
  // Picked ships fly a drawn route too (round a well, to slingshot); with only ships picked, the wings stay put.
  const ships = selShips(w).filter((s) => HULL[s.kind].speed > 0);
  const ws = ships.length && !selWings(w).length ? [] : orderWings(w);
  const end = stroke[stroke.length - 1];
  if (ships.length) {
    const via: { x: number; z: number }[] = [];
    let run = 0;
    for (let i = 1; i < stroke.length - 1; i++) { run += Math.hypot(stroke[i].x - stroke[i - 1].x, stroke[i].z - stroke[i - 1].z); if (run >= 300) { via.push(stroke[i]); run = 0; } }
    ships.forEach((s, i) => { const off = (i - (ships.length - 1) / 2) * 260; s.order = { k: "move", x: end.x + off, z: end.z, via: via.map((p) => ({ x: p.x + off, z: p.z })) }; });
    if (!ws.length) return flash(`${ships.length > 1 ? `${ships.length} ships` : ships[0].name}: by your route. A route round a well is faster than the straight line.`);
  }
  if (!ws.length) return flash("No wings to fly it.");
  const o = orderFor(w, end.x, end.z);
  // Every 220 units of the stroke is a point to pass. An attack drops the end (the target itself).
  const pts: { x: number; z: number }[] = [stroke[0]];
  let acc = 0;
  for (let i = 1; i < stroke.length; i++) {
    acc += Math.hypot(stroke[i].x - stroke[i - 1].x, stroke[i].z - stroke[i - 1].z);
    if (acc >= 220) { pts.push(stroke[i]); acc = 0; }
  }
  if (o.k === "attack" && o.targetIs === "ship") { const t = ship(w, o.target)!; while (pts.length > 1 && Math.hypot(pts[pts.length - 1].x - t.x, pts[pts.length - 1].z - t.z) < 260) pts.pop(); ui.target = t.id; }
  else pts.push(end);
  const onShip = o.k === "attack" && o.targetIs === "ship" ? o.target : 0;
  if (touchMode && onShip && ui.lastDraw.target === onShip && w.t - ui.lastDraw.t < 10) join = true;
  ui.lastDraw = { t: w.t, target: onShip };
  const group = join && ui.drawGroup ? ui.drawGroup : ++w.groupN;
  ui.drawGroup = group;
  send(w, { at: landsAt(w), k: "route", wings: ws.map((g) => g.id), route: pts, end: o, group });
  const what = o.k === "attack" ? (o.targetIs === "ship" ? `on the ${ship(w, o.target)?.name}` : `on ${wing(w, o.target)?.name}`) : o.k === "escort" ? `to the ${ship(w, o.target)?.name}` : "to that point";
  bark(`${ws.length > 1 ? `${ws.length} wings` : ws[0].name} by your route ${what}${join ? ", a second arm" : ""}.`);
}

function setStance(st: Stance) {
  const w = ui.w; if (!w) return;
  const doctrine = st === "attack" ? "press" : st === "defend" ? "shield" : "steady";
  for (const g of selWings(w)) g.stance = st;
  for (const s of selShips(w)) if (s.auto) s.doctrine = doctrine;
}
function setFormation(f: Formation) { const w = ui.w; if (w) for (const g of selWings(w)) g.formation = f; }

function flagshipOrder(k: "broadside" | "rake" | "hold") {
  const w = ui.w; if (!w) return;
  const fl = flagship(w); if (!fl) return;
  if (k === "broadside") {
    const t = ship(w, ui.target);
    if (!t) return flash("Broadside: mark a Compact ship first.");
    fl.order = { k: "engage", target: t.id, broadside: true };
    flash(`${fl.name}: coming about, broadside to the ${t.name}.`);
  } else if (k === "rake") {
    fl.order = { k: "rake" };
    flash(`${fl.name}: to low orbit. Batteries on the base.`);
  } else { fl.order = { k: "hold" }; flash(`${fl.name}: all stop.`); }
}

function laneOrder() {
  const w = ui.w; if (!w) return;
  const fr = w.ships.find((s) => s.side === "navy" && s.kind === "frigate" && !s.dead);
  if (!fr) return;
  fr.order = { k: "lane" };
  flash(`${fr.name}: to the lane. Well projectors warming.`);
}

/** Right-click (or a tap with something picked): the selection does the obvious thing with what is under the pointer. */
function orderAt(x: number, z: number) {
  const w = ui.w; if (!w) return;
  const slop = bridge.unitsPerPixel(canvas.clientHeight) * 14;
  const s = shipAt(w, x, z, slop);
  const ws = selWings(w);
  if (ws.length) { send(w, { at: landsAt(w), k: "route", wings: ws.map((g) => g.id), route: [], end: orderFor(w, x, z), group: 0 }); if (w.t >= w.voiceUntil) flash(`Radio: ${COMMS_LAG} s.`); }
  for (const sh of selShips(w)) {
    if (s && s.side === "rim") { sh.order = { k: "engage", target: s.id, broadside: false }; sh.focus = s.id; }
    else if (sh.kind === "frigate" && Math.hypot(x - w.lane.x, z - w.lane.z) < 350) sh.order = { k: "lane" };
    else if (s && s.side === "navy" && s.id !== sh.id) sh.order = { k: "guard", target: s.id };
    else sh.order = { k: "move", x, z };
  }
  if (s && s.side === "rim") ui.target = s.id;
}

/** Left-click: pick your own (shift adds), or mark a Compact ship. */
function clickAt(x: number, z: number, add: boolean) {
  const w = ui.w; if (!w) return;
  const slop = bridge.unitsPerPixel(canvas.clientHeight) * 14;
  const s = shipAt(w, x, z, slop);
  if (s?.side === "rim") { ui.target = s.id; flash(`Marked: the ${s.name}.`); return; }
  const g = w.wings.find((g) => g.side === "navy" && g.state === "out" && alive(g).some((c) => Math.hypot(c.x - x, c.z - z) < slop * 2));
  const pick = g?.id ?? s?.id;
  if (!pick) { if (!add && touchMode && ui.sel.size) orderAt(x, z); else if (!add) ui.sel.clear(); return; }
  if (!add) ui.sel.clear();
  if (ui.sel.has(pick) && add) ui.sel.delete(pick); else ui.sel.add(pick);
}

function selectIndex(i: number, add: boolean) {
  const w = ui.w; if (!w) return;
  const list = rosterList(w);
  const it = list[i]; if (!it) return;
  if (!add) ui.sel.clear();
  ui.sel.add(it.id);
}

/** The roster's order: in a quick battle the flagship, the interdictor and the wings; in the Armada, the destroyers first. */
function rosterList(w: World): { id: number; kind: "ship" | "wing" }[] {
  const fl = flagship(w);
  const ships = w.ships.filter((s) => s.side === "navy").sort((a, b) => Number(b.auto) - Number(a.auto) || a.id - b.id);
  const wings = fl ? wingsOf(w, fl.id) : [];
  if (w.mode === "armada") return [...ships.filter((s) => s.auto).map((s) => ({ id: s.id, kind: "ship" as const })), ...wings.map((g) => ({ id: g.id, kind: "wing" as const }))];
  // The theater: your other hulls (the second destroyer, the sensor ship) come first, then the wings.
  if (w.field) return [...ships.filter((s) => s.id !== w.flagship && s.kind !== "frigate").map((s) => ({ id: s.id, kind: "ship" as const })), ...wings.map((g) => ({ id: g.id, kind: "wing" as const }))];
  return wings.map((g) => ({ id: g.id, kind: "wing" as const }));
}

/** Pick everything of yours inside a box on screen (a left-drag in the theater). Ships and wings both. */
function boxSelect(x1: number, y1: number, x2: number, y2: number, add: boolean) {
  const w = ui.w; if (!w) return;
  const r = canvas.getBoundingClientRect();
  const [ax, bx, ay, by] = [Math.min(x1, x2), Math.max(x1, x2), Math.min(y1, y2), Math.max(y1, y2)];
  const inside = (x: number, z: number) => { const p = bridge.toScreen(x, z, r.width, r.height); return p.on && p.x >= ax && p.x <= bx && p.y >= ay && p.y <= by; };
  const got = [
    ...w.ships.filter((s) => s.side === "navy" && !s.dead && inside(s.x, s.z)).map((s) => s.id),
    ...w.wings.filter((g) => g.side === "navy" && g.state === "out" && alive(g).some((c) => inside(c.x, c.z))).map((g) => g.id),
  ];
  if (!add) ui.sel.clear();
  for (const id of got) ui.sel.add(id);
  if (got.length) flash(`${got.length} picked. Right-click to move or attack; right-drag a route round a well to slingshot.`);
}

function doPing() {
  const w = ui.w; if (!w) return;
  const why = ping(w);
  flash(why || `Ping: everything within ${PING.reach / 1000}k shows for ${PING.lasts} s. The Compact heard it too.`);
}

function buy(what: Buy) {
  const w = ui.w; if (!w) return;
  const why = requisition(w, "navy", what);
  flash(why || (what === "sensors" ? "Thermal sensors fitted." : `A ${CRAFT_NAME.navy[what as Role]} wing is on the deck.`));
}

// ---------------------------------------------------------------- input

let touchMode = matchMedia("(pointer: coarse)").matches;
const drag = { on: false, moved: false, x: 0, y: 0, button: 0, pinch: 0, box: false, x0: 0, y0: 0 };
/** Where the mouse is over the table, for edge scrolling in the theater. */
const mouse = { x: 0, y: 0, over: false };
canvas.addEventListener("pointerenter", () => { mouse.over = true; });
canvas.addEventListener("pointerleave", () => { mouse.over = false; });
const touches = new Map<number, { x: number; y: number }>();

canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("pointerdown", (e) => {
  touchMode = e.pointerType === "touch";
  try { canvas.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer (the harness) has none */ }
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 2) { const [a, b] = [...touches.values()]; drag.pinch = Math.hypot(a.x - b.x, a.y - b.y); }
  Object.assign(drag, { on: true, moved: false, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, button: e.button });
  // In the theater a mouse's left-drag is a selection box (the middle button, the arrows and the edges pan).
  drag.box = !!ui.w?.field && ui.screen === "battle" && e.pointerType === "mouse" && e.button === 0 && !ui.pen;
  ui.stroke = null;
  if (ui.screen === "battle" && touches.size === 1 && (e.button === 2 || (ui.pen && e.button === 0))) { const p = pickAt(e); if (p) ui.stroke = [p]; }
});
const pickAt = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); return bridge.pick(e.clientX - r.left, e.clientY - r.top, r.width, r.height); };
canvas.addEventListener("pointermove", (e) => {
  const t = touches.get(e.pointerId);
  if (t) { t.x = e.clientX; t.y = e.clientY; }
  mouse.x = e.clientX; mouse.y = e.clientY;
  if (touches.size === 2) {
    const [a, b] = [...touches.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
    if (drag.pinch) bridge.view.dist = clampDist(bridge.view.dist * (drag.pinch / d));
    drag.pinch = d; drag.moved = true; ui.stroke = null; return;
  }
  if (!drag.on) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
  if (ui.stroke) {
    const p = pickAt(e), q = ui.stroke[ui.stroke.length - 1];
    if (p && Math.hypot(p.x - q.x, p.z - q.z) > 30) ui.stroke.push(p);
    return;
  }
  if (drag.box) {
    const b = $("box");
    b.hidden = !drag.moved;
    Object.assign(b.style, { left: `${Math.min(drag.x0, e.clientX)}px`, top: `${Math.min(drag.y0, e.clientY)}px`, width: `${Math.abs(e.clientX - drag.x0)}px`, height: `${Math.abs(e.clientY - drag.y0)}px` });
    return;
  }
  if (drag.moved && drag.button !== 2) {
    const u = bridge.unitsPerPixel(canvas.clientHeight);
    pan(-dx * u, -dy * u / Math.sin(bridge.view.tilt));
    drag.x = e.clientX; drag.y = e.clientY;
  }
});
canvas.addEventListener("pointerup", (e) => {
  touches.delete(e.pointerId);
  if (touches.size) return;
  drag.pinch = 0;
  if (!drag.on) return;
  drag.on = false;
  const stroke = ui.stroke; ui.stroke = null;
  if (drag.box) {
    $("box").hidden = true; drag.box = false;
    if (drag.moved) { const r = canvas.getBoundingClientRect(); boxSelect(drag.x0 - r.left, drag.y0 - r.top, e.clientX - r.left, e.clientY - r.top, e.shiftKey); return; }
  }
  if (stroke && drag.moved) { drawnPlay(stroke, e.shiftKey); return; }
  if (drag.moved) return;
  const p = pickAt(e);
  if (!p || ui.screen !== "battle") return;
  if (e.button === 2) orderAt(p.x, p.z); else clickAt(p.x, p.z, e.shiftKey);
});
const clampDist = (d: number) => Math.max(500, Math.min(ui.w?.field ? 14000 : 9000, d));
/** Pan the table: with the camera riding the flagship, this moves where it sits from the ship. */
function pan(dx: number, dz: number) { if (ui.ride.on && ui.screen === "battle") { ui.ride.dx += dx; ui.ride.dz += dz; } bridge.view.x += dx; bridge.view.z += dz; }
canvas.addEventListener("wheel", (e) => { e.preventDefault(); bridge.view.dist = clampDist(bridge.view.dist * Math.exp(e.deltaY * 0.001)); }, { passive: false });

const held = new Set<string>();
document.addEventListener("keyup", (e) => held.delete(e.key));
document.addEventListener("keydown", (e) => {
  if (ui.screen !== "battle" || (e.target as HTMLElement)?.tagName === "INPUT") return;
  if (e.metaKey || e.ctrlKey) return;
  held.add(e.key);
  const key = e.key.toLowerCase();
  const n = Number(e.key);
  if (n >= 1 && n <= 9) { selectIndex(n - 1, e.shiftKey); return; }
  const play = PLAYS.find((p) => p.key.toLowerCase() === key);
  if (play && key !== "x") { callPlay(play.id); return; }
  switch (key) {
    case "h": callPlay("recall"); break;
    case "a": setStance("attack"); break;
    case "s": setStance("neutral"); break;
    case "d": setStance("defend"); break;
    case "z": setFormation("tight"); break;
    case "x": setFormation("screen"); break;
    case "c": setFormation("loose"); break;
    case "b": flagshipOrder("broadside"); break;
    case "v": flagshipOrder("rake"); break;
    case "g": { const w = ui.w; const fr = w?.ships.find((s) => s.side === "navy" && s.kind === "frigate" && !s.dead); if (fr) { ui.sel.clear(); ui.sel.add(fr.id); if (e.shiftKey) laneOrder(); } break; }
    case "f": { const w = ui.w; if (w) { ui.sel.clear(); ui.sel.add(w.flagship); ui.ride = { dx: innerHeight > innerWidth ? 350 : 700, dz: 100, on: true }; } break; }
    case " ": e.preventDefault(); power("foresight"); break;
    case "m": power("trance"); break;
    case "n": power("voice"); break;
    case "p": togglePen(); break;
    case "k": doPing(); break;
    case "l": toggleLook(); break;
    case ".": cycleSpeed(); break;
    case "tab": e.preventDefault(); { const w = ui.w; if (w) { const rim = w.ships.filter((s) => s.side === "rim" && !s.dead); const i = rim.findIndex((s) => s.id === ui.target); if (rim.length) ui.target = rim[(i + 1) % rim.length].id; } } break;
  }
});

function power(p: Power) {
  const w = ui.w; if (!w) return;
  if (!usePower(w, p)) flash(`${POWER_NAME[p]} needs ${FOCUS[p]} focus.`);
  else flash(p === "foresight" ? `${POWER_NAME.foresight}: you see their next move, and the weak arcs of their shields.` : p === "trance" ? `${POWER_NAME.trance}: every pilot of yours flies better, theirs worse.` : `${POWER_NAME.voice}: for ${FOCUS.voiceS} s your wings act on every order the moment you give it.`);
}
function togglePen() { ui.pen = !ui.pen; ui.stroke = null; $("pen").classList.toggle("on", ui.pen); flash(ui.pen ? (touchMode ? "Pen: drag a route for the picked wings, ending on a ship. A second route onto that ship within 10 s strikes with the first." : "Pen: drag a route for the picked wings, ending on a ship. Shift adds an arm that strikes with the last.") : "Pen away: dragging pans again."); }
function toggleLook() { const l: Look = bridge.look === "cinema" ? "holo" : "cinema"; bridge.setLook(l); localStorage.setItem("fleet-commander.look", l); }
function cycleSpeed() { ui.speed = ui.speed === 1 ? 2 : ui.speed === 2 ? 4 : 1; $("speed").textContent = `${ui.speed}x`; }

// ---------------------------------------------------------------- the HUD

const ROLE_ICON: Record<Role, IconNode> = { interceptor: Rocket, bomber: Target, escort: Shield, scout: Telescope };
const STANCE_ICON: Record<Stance, IconNode> = { attack: Swords, neutral: Scale, defend: Shield };
const FORM_ICON: Record<Formation, IconNode> = { tight: Triangle, screen: Rows3, loose: Shuffle };
const PLAY_ICON: Record<PlayId, IconNode> = { "torpedo-run": Crosshair, pincer: Split, "hammer-anvil": Hammer, screen: Shield, hunt: Radar, feint: Ghost, recall: Undo2 };
const STANCE_WORD: Record<Stance, string> = { attack: "Attack", neutral: "Steady", defend: "Defend" };
const FORM_WORD: Record<Formation, string> = { tight: "Tight", screen: "Screen", loose: "Loose" };

function buildPlays() {
  const w = ui.w;
  const fleet = w?.mode === "armada";
  $("plays").innerHTML = PLAYS.map((p) => `<button type="button" class="play" data-play="${p.id}" title="${esc(`${p.name} (${p.id === "recall" ? "H" : p.key}): ${p.steps}`)}">${icon(PLAY_ICON[p.id], 20)}<span>${p.name}</span><kbd>${p.id === "recall" ? "H" : p.key}</kbd></button>`).join("");
  const stance = (["attack", "neutral", "defend"] as Stance[]).map((s, i) => `<button type="button" class="ord" data-stance="${s}" title="${fleet ? ["Press", "Steady", "Shield"][i] + " doctrine" : STANCE_WORD[s] + " stance"} (${"ASD"[i]})" aria-label="${STANCE_WORD[s]}">${icon(STANCE_ICON[s])}</button>`).join("");
  const form = (["tight", "screen", "loose"] as Formation[]).map((f, i) => `<button type="button" class="ord" data-form="${f}" title="${FORM_WORD[f]} formation (${"ZXC"[i]})" aria-label="${FORM_WORD[f]}">${icon(FORM_ICON[f])}</button>`).join("");
  const shipOrders = `<button type="button" class="ord" data-ship="broadside" title="Flagship: broadside the marked ship (B)" aria-label="Broadside">${icon(Anchor)}</button><button type="button" class="ord" data-ship="rake" title="Flagship: rake the world's base from low orbit (V). Guns on the land are not on ships." aria-label="Rake">${icon(Flame)}</button><button type="button" class="ord" data-ship="lane" title="Interdictor: sit on the hyperspace lane (Shift+G). Reinforcements are dragged out on top of it, shields down." aria-label="Hold the lane">${icon(Magnet)}</button>`;
  const pen = `<button type="button" class="ord${ui.pen ? " on" : ""}" id="pen" title="Draw a play (P, or right-drag): drag a route for the picked wings, end it on a ship to attack. Shift adds an arm that strikes with the last." aria-label="Draw a play">${icon(PenLine)}</button>`;
  const buys = (["scout", "interceptor", "bomber", "escort"] as const).map((r) => `<button type="button" class="ord buy" data-buy="${r}" title="Requisition a ${CRAFT_NAME.navy[r]} ${r} wing from the flagship's hangar: ${BUY[r]} supply" aria-label="Requisition a ${r} wing">${icon(ROLE_ICON[r])}<small class="num">${BUY[r]}</small></button>`).join("");
  const field = w?.field ? `<div class="grp"><button type="button" class="ord" data-act="ping" title="Sensor ship: ping (K). Everything within ${PING.reach / 1000}k shows for ${PING.lasts} s, rifts, heat shear and mines too; the Compact hears it for ${PING.loud} s. Every ${PING.every} s." aria-label="Ping">${icon(RadioTower)}</button><button type="button" class="ord buy" data-buy="sensors" title="Thermal sensors: every ship sees into the rifts, and scouts into the star's heat shear. ${BUY.sensors} supply" aria-label="Thermal sensors">${icon(Thermometer)}<small class="num">${BUY.sensors}</small></button></div><div class="grp">${buys}</div>` : "";
  $("orders").innerHTML = `<div class="grp">${pen}</div><div class="grp">${stance}</div><div class="grp">${form}</div><div class="grp">${shipOrders}</div>${field}`;
  $("foresight").innerHTML = `${icon(Eye)}<span>${POWER_NAME.foresight}</span><kbd>Space</kbd>`;
  $("foresight").title = `${POWER_NAME.foresight} (${FOCUS.foresight} focus): see the Compact admiral's next move for ${FOCUS.foresightS} s, and hit their shields' weak arcs harder.`;
  $("trance").innerHTML = `${icon(Sparkles)}<span>${POWER_NAME.trance}</span><kbd>M</kbd>`;
  $("trance").title = `${POWER_NAME.trance} (${FOCUS.trance} focus): for ${FOCUS.tranceS} s your pilots hit a third harder and theirs fly worse.`;
  $("voice").innerHTML = `${icon(Megaphone)}<span>${POWER_NAME.voice}</span><kbd>N</kbd>`;
  $("voice").title = `${POWER_NAME.voice} (${FOCUS.voice} focus): for ${FOCUS.voiceS} s your orders reach the wings at once, not ${COMMS_LAG} s later.`;
}

document.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("button");
  if (!b) return;
  if (b.dataset.play) callPlay(b.dataset.play as PlayId);
  if (b.dataset.stance) setStance(b.dataset.stance as Stance);
  if (b.dataset.form) setFormation(b.dataset.form as Formation);
  if (b.dataset.ship === "lane") laneOrder();
  else if (b.dataset.ship) flagshipOrder(b.dataset.ship as "broadside" | "rake");
  if (b.id === "pen") togglePen();
  if (b.dataset.act === "ping") doPing();
  if (b.dataset.buy) buy(b.dataset.buy as Buy);
  if (b.dataset.pick) { const id = Number(b.dataset.pick); if (!(e as MouseEvent).shiftKey) ui.sel.clear(); ui.sel.add(id); }
  if (b.dataset.sys && ui.sector) goSystem(b.dataset.sys);
});

const bar = (v: number, cls: string) => `<span class="meter ${cls}"><i style="width:${Math.round(Math.max(0, Math.min(1, v)) * 100)}%"></i></span>`;

function orderWord(w: World, g: Wing): string {
  if (g.state === "launching") return w.t < g.launchAt ? "in the hangar" : "launching";
  if (g.state === "returning") return "heading home";
  if (w.pending.some((p) => p.wings.includes(g.id))) return "orders on the radio";
  if (g.later) return `waiting ${Math.ceil(g.later.at - w.t)} s`;
  if (g.route.length) return "flying your route";
  if (g.waypoint) return "to its flank";
  const o = g.order;
  if (o.k === "attack") return o.targetIs === "ship" ? `attacking ${ship(w, o.target)?.name ?? "?"}` : `hunting ${wing(w, o.target)?.name ?? "?"}`;
  if (o.k === "escort") return o.targetIs === "ship" ? `guarding ${ship(w, o.target)?.name ?? "?"}` : `escorting ${wing(w, o.target)?.name ?? "?"}`;
  if (o.k === "patrol") return "patrolling";
  return "returning";
}

function shipOrderWord(w: World, s: Ship): string {
  const o = s.order;
  if (o.k === "engage") return `${o.broadside ? "broadside" : "engaging"} ${ship(w, o.target)?.name ?? ""}`;
  if (o.k === "flank") return o.reached ? `flank attack on ${ship(w, o.target)?.name ?? ""}` : "swinging to the flank";
  if (o.k === "rake") return "raking the world";
  if (o.k === "lane") return "holding the lane";
  if (o.k === "guard") return o.target === -1 ? "shielding the world" : `shielding ${ship(w, o.target)?.name ?? ""}`;
  if (o.k === "move") return "moving";
  return "holding";
}

function shipCard(w: World, s: Ship, key: string) {
  const sel = ui.sel.has(s.id) ? " sel" : "";
  const doc = s.auto ? ` · ${s.doctrine}` : "";
  return `<button type="button" class="card ship${sel}${s.dead ? " dead" : ""}" data-pick="${s.id}"><kbd>${key}</kbd><b>${esc(s.name)}</b><small>${esc(SHIP_NAME[s.kind])}${doc}</small>${bar(s.shield / s.shieldMax, "sh")}${bar(s.hull / s.hullMax, "hl")}<em>${s.dead ? "lost" : esc(shipOrderWord(w, s))}</em></button>`;
}

function wingCard(w: World, g: Wing, key: string) {
  const live = alive(g).length, n = g.craft.length || g.size;
  const pips = Array.from({ length: n }, (_, i) => `<i class="${i < (g.craft.length ? live : n) ? "on" : ""}"></i>`).join("");
  const sel = ui.sel.has(g.id) ? " sel" : "";
  return `<button type="button" class="card wing ${g.role}${sel}${g.craft.length && !live ? " dead" : ""}" data-pick="${g.id}" title="${esc(`${g.name}: ${CRAFT_NAME.navy[g.role]} ${g.role}s, ${STANCE_WORD[g.stance]}, ${FORM_WORD[g.formation]}`)}"><kbd>${key}</kbd><span class="ri">${icon(ROLE_ICON[g.role], 16)}</span><b>${esc(g.name)}</b><span class="pips">${pips}</span><span class="tags">${icon(STANCE_ICON[g.stance], 13)}${icon(FORM_ICON[g.formation], 13)}</span><em>${g.craft.length && !live ? "lost" : esc(orderWord(w, g))}</em></button>`;
}

function drawHud(w: World) {
  const fl = flagship(w) ?? w.ships.find((s) => s.id === w.flagship)!;
  $("clock").textContent = `${clock(w.t)} / ${clock(w.limit)}`;
  $<HTMLElement>("focus-fill").style.width = `${w.focus}%`;
  $<HTMLButtonElement>("foresight").disabled = w.focus < FOCUS.foresight;
  $<HTMLButtonElement>("trance").disabled = w.focus < FOCUS.trance;
  $<HTMLButtonElement>("voice").disabled = w.focus < FOCUS.voice;
  $("voice").classList.toggle("live", w.t < w.voiceUntil);
  $("foresight").classList.toggle("live", w.t < w.foresightUntil);
  $("trance").classList.toggle("live", w.t < w.tranceUntil);
  const list = rosterList(w);
  let html = shipCard(w, fl, "F");
  const fr = w.ships.find((s) => s.side === "navy" && s.kind === "frigate");
  if (fr) html += shipCard(w, fr, "G");
  html += list.map((it, i) => (it.kind === "ship" ? shipCard(w, w.ships.find((s) => s.id === it.id)!, String(i + 1)) : wingCard(w, w.wings.find((g) => g.id === it.id)!, String(i + 1)))).join("");
  // The planet's base, and the marked target.
  const f = w.field;
  $("supply").hidden = !f;
  if (f) {
    $("supply").textContent = `Supply ${Math.floor(f.supply.navy)}`;
    for (const b of document.querySelectorAll<HTMLButtonElement>("#orders [data-buy]")) b.disabled = f.supply.navy < BUY[b.dataset.buy as Buy] || (b.dataset.buy === "sensors" && f.tier.navy > 0);
    const pb = document.querySelector<HTMLButtonElement>('#orders [data-act="ping"]');
    if (pb) pb.disabled = w.t < f.ping.ready || !w.ships.some((s) => !s.dead && s.side === "navy" && s.kind === "sensor");
    html += `<div class="card points"><b>Strongpoints</b>${f.points.map((p) => `<span class="pt ${p.owner ?? "none"}" title="${esc(p.name)}: ${p.owner === "navy" ? "ours" : p.owner === "rim" ? "the Compact's" : "nobody's"}">${esc(p.name)}${bar((p.hold + 1) / 2, "hold")}</span>`).join("")}${f.heldSince ? `<small>All held: ${Math.max(0, Math.ceil(60 - (w.t - f.heldSince)))} s to win</small>` : ""}</div>`;
  }
  const p = w.planet, t = ship(w, ui.target);
  html += `<div class="card world"><b>${esc(p.name)} base</b>${bar(p.base / p.baseMax, "hl")}<small>${w.ships.some((s) => s.kind === "station" && !s.dead && s.side === "rim") ? "under the bastion's shield" : "open to the sky"}</small></div>`;
  if (t && visible(w, t.side, t.id)) html += `<div class="card target"><span class="ri">${icon(Target, 16)}</span><b>${esc(t.name)}</b><small>${esc(SHIP_NAME[t.kind])}</small>${bar(t.shield / t.shieldMax, "sh")}${bar(t.hull / t.hullMax, "hl")}</div>`;
  $("roster").innerHTML = html;
  $("comms").innerHTML = w.comms.slice(-9).map((c) => `<p class="${c.side}"><b>${esc(c.who)}</b> ${esc(c.say)}</p>`).join("");
  const seeing = w.t < w.foresightUntil;
  $("intent").hidden = !seeing;
  if (seeing) $("intent").innerHTML = `${icon(Eye, 16)} <b>${esc(w.rimTemper)}</b> ${esc(w.rimIntent)}`;
  for (const b of document.querySelectorAll<HTMLButtonElement>("#orders [data-stance], #orders [data-form]")) {
    const sw = selWings(w), ss = selShips(w).filter((s) => s.auto);
    const on = b.dataset.stance ? sw.some((g) => g.stance === b.dataset.stance) || ss.some((s) => ({ attack: "press", neutral: "steady", defend: "shield" } as const)[b.dataset.stance as Stance] === s.doctrine) : sw.some((g) => g.formation === b.dataset.form);
    b.classList.toggle("on", on);
  }
  if (performance.now() > ui.banner.until) $("banner").classList.remove("on");
}

function overlay(w: World): Overlay {
  const o: Overlay = { selected: ui.sel, target: visible(w, "rim", ui.target) ? ui.target : 0, lines: [], rings: [], sees: w.field?.sees.navy };
  const stanceC: Record<Stance, number> = { attack: 0xff6a4a, neutral: 0x9fd8ff, defend: 0x7dffb0 };
  const lineFor = (g: Wing, color: number) => {
    const live = alive(g); if (!live.length || g.state === "launching") return;
    let from: { x: number; z: number } = g;
    for (const p of g.route) { o.lines.push({ x1: from.x, z1: from.z, x2: p.x, z2: p.z, color }); from = p; }
    const to = g.waypoint ?? (g.order.k === "patrol" ? g.order : g.order.k === "return" ? ship(w, g.home) : g.order.targetIs === "ship" ? ship(w, g.order.target) : wing(w, g.order.target));
    if (to) o.lines.push({ x1: from.x, z1: from.z, x2: to.x, z2: to.z, color });
    if (g.waypoint && g.order.k === "attack") { const t = ship(w, g.order.target); if (t) o.lines.push({ x1: g.waypoint.x, z1: g.waypoint.z, x2: t.x, z2: t.z, color: 0x445566 }); }
  };
  for (const id of ui.sel) {
    const g = wing(w, id);
    if (g) { lineFor(g, stanceC[g.stance]); o.rings.push({ x: g.x, z: g.z, r: 70, color: 0x9fd8ff }); continue; }
    const s = ship(w, id);
    if (s) {
      o.rings.push({ x: s.x, z: s.z, r: HULL[s.kind].r * 1.3, color: 0x9fd8ff });
      o.rings.push({ x: s.x, z: s.z, r: HULL[s.kind].range, color: 0x1f3f55 });
      const t = s.order.k === "engage" || s.order.k === "flank" ? ship(w, s.order.target) : null;
      if (t) o.lines.push({ x1: s.x, z1: s.z, x2: t.x, z2: t.z, color: 0xffb070 });
      if (s.order.k === "flank" && !s.order.reached) o.lines.push({ x1: s.x, z1: s.z, x2: s.order.wx, z2: s.order.wz, color: 0x9fd8ff });
      if (s.order.k === "move") { let from: { x: number; z: number } = s; for (const p of [...(s.order.via ?? []), s.order]) { o.lines.push({ x1: from.x, z1: from.z, x2: p.x, z2: p.z, color: 0x9fd8ff }); from = p; } }
      if (s.auto) for (const g of wingsOf(w, s.id)) lineFor(g, stanceC[g.stance]);
    }
  }
  // Foresight: the Compact's wings show where they are going.
  if (w.t < w.foresightUntil) for (const g of w.wings) if (g.side === "rim" && visible(w, g.side, g.id)) lineFor(g, 0xff9a3d);
  // The stroke being drawn, and drawn routes still on the radio.
  const path = (pts: { x: number; z: number }[], color: number) => { for (let i = 1; i < pts.length; i++) o.lines.push({ x1: pts[i - 1].x, z1: pts[i - 1].z, x2: pts[i].x, z2: pts[i].z, color }); };
  if (ui.stroke) path(ui.stroke, 0xf2f6ff);
  for (const p of w.pending) if (p.k === "route") path(p.route, 0x5f7890);
  // The theater: where Compact hulls were last seen, a dim ring that stays after your sensors lose them.
  if (w.field) for (const [id, g] of w.field.known.navy) {
    if (w.field.sees.navy.has(id)) continue;
    const s = w.ships.find((s) => s.id === id), r = s ? HULL[s.kind].r : 60;
    o.rings.push({ x: g.x, z: g.z, r: r * 1.4, color: 0x7a4a24 }); o.lines.push({ x1: g.x - r, z1: g.z, x2: g.x + r, z2: g.z, color: 0x7a4a24 });
  }
  // The lane's mouth, always.
  o.rings.push({ x: w.lane.x, z: w.lane.z, r: 320, color: 0x6a5acd });
  // A ping going out: the ring of its reach.
  if (w.field && w.t < w.field.ping.until) o.rings.push({ x: w.field.ping.x, z: w.field.ping.z, r: PING.reach * Math.min(1, (w.t - (w.field.ping.until - PING.lasts)) / 1.5), color: 0x7dffb0 });
  return o;
}

// ---------------------------------------------------------------- the sector

function drawSector() {
  const s = ui.sector; if (!s) return;
  const svg = $("sector-map");
  const lanes = LANES.map(([a, b]) => { const p = sys(a), q = sys(b); const live = (a === s.at && true) || b === s.at; return `<line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" class="lane${live ? " live" : ""}"/>`; }).join("");
  const near = neighbours(s.at);
  const worlds = SYSTEMS.map((w) => {
    const base = s.bases[w.id], forming = s.forming[w.id], held = s.held.includes(w.id);
    const cls = [w.kind, held ? "held" : "", base ? "base" : "", forming !== undefined ? "forming" : "", w.id === s.at ? "here" : "", near.includes(w.id) ? "near" : ""].join(" ");
    const tag = base ? `base ${"I".repeat(base)}` : forming !== undefined ? `building, ${forming} turns` : held ? "ours" : w.kind === "resource" ? "unclaimed mine" : "";
    return `<g class="sys ${cls}" data-sys="${w.id}" transform="translate(${w.x} ${w.y})"><circle r="${w.kind === "core" ? 3.4 : 2.6}"/>${w.id === s.at ? `<circle class="fleet" r="5"/>` : ""}<text y="-4.4">${esc(w.name)}</text><text class="tag" y="6.6">${esc(tag)}</text></g>`;
  }).join("");
  svg.innerHTML = lanes + worlds;
  const here = sys(s.at), rc = refitCost(s);
  const canRefit = s.held.includes(s.at) && rc.cost > 0;
  $("sector-stats").textContent = `Turn ${s.turn} · Supply ${s.supply} · Hull ${Math.round(s.fleet.hull * 100)}% · Craft ${s.fleet.wings.reduce((a, g) => a + g.craft, 0)}/32 + ${s.fleet.reserve} spare · Bases ${Object.keys(s.bases).length}`;
  const moves = near.map((id) => { const t = threatAt(s, id); const what = t ? (t.kind === "assault" ? `assault a base (strength ${t.strength})` : t.kind === "strike" ? "strike before the base is done" : "seize the mine from its picket") : "a quiet jump"; return `<button type="button" class="jump" data-sys="${id}"><b>${esc(sys(id).name)}</b><small>${esc(what)}</small></button>`; }).join("");
  $("sector-here").innerHTML = s.outcome
    ? `<h3>${s.outcome === "won" ? "The sector is yours" : "The sector is lost"}</h3><p>${s.outcome === "won" ? "Command gives you the Sovereign: try the Armada." : "Start again from the menu."}</p>`
    : `<h3>${esc(here.name)}</h3><p>${esc(here.blurb)}</p><div class="jumps">${moves}</div>${canRefit ? `<button type="button" id="refit" class="primary">Refit (${rc.craft} craft, ${rc.hull * 5}% hull): ${rc.cost} supply</button>` : ""}`;
  $("sector-log").innerHTML = s.log.slice(0, 12).map((l) => `<li>${esc(l)}</li>`).join("");
  $("refit")?.addEventListener("click", () => { refit(s); drawSector(); });
}

function goSystem(id: string) {
  const s = ui.sector; if (!s || s.outcome) return;
  if (!neighbours(s.at).includes(id)) return;
  const spec = jump(s, id);
  if (!spec) return drawSector();
  startBattle(battle(spec), "campaign");
}

function startCampaign() { ui.sector = newSector(Date.now() >>> 0); ui.kind = "campaign"; show("sector"); }

// ---------------------------------------------------------------- the loop

let last = performance.now();
function frame(now: number) {
  const real = Math.min(0.1, (now - last) / 1000);
  last = now;
  const w = ui.w;
  if (w && ui.screen === "battle") {
    if (!ui.paused) {
      ui.acc += real * ui.speed;
      while (ui.acc >= DT && !w.outcome) { step(w, brainsOf(w)); ui.acc -= DT; }
    }
    // The theater: the mouse at a screen edge pans, and the fog and the minimap redraw a few times a second.
    if (w.field && mouse.over && !touchMode && !drag.on) {
      const e = 14, u = bridge.unitsPerPixel(canvas.clientHeight) * 900 * real;
      if (mouse.x < e) pan(-u, 0); else if (mouse.x > innerWidth - e) pan(u, 0);
      if (mouse.y < e) pan(0, -u); else if (mouse.y > innerHeight - e) pan(0, u);
    }
    if (w.field && now - ui.fogAt > 100) {
      ui.fogAt = now;
      const es = eyes(w, "navy");
      if (w.t < w.field.ping.until) es.push({ x: w.field.ping.x, z: w.field.ping.z, r: PING.reach, tier: 9 });
      bridge.fog?.update(es, w.field, now / 1000);
      minimap.draw(w, bridge.fog, ui.sel, ui.target, viewBox(), w.field.known.navy);
    }
    // Arrow keys pan.
    const u = bridge.unitsPerPixel(canvas.clientHeight) * 600 * real;
    if (held.has("ArrowLeft")) pan(-u, 0);
    if (held.has("ArrowRight")) pan(u, 0);
    if (held.has("ArrowUp")) pan(0, -u);
    if (held.has("ArrowDown")) pan(0, u);
    // The camera rides the flagship (T8), easing after it so the table doesn't jitter.
    const fl = flagship(w);
    if (ui.ride.on && fl) { const k = Math.min(1, real * 3); bridge.view.x += (fl.x + ui.ride.dx - bridge.view.x) * k; bridge.view.z += (fl.z + ui.ride.dz - bridge.view.z) * k; }
    if (now - ui.hudAt > 120) { ui.hudAt = now; drawHud(w); }
    if (w.outcome && !ui.paused) { ui.paused = true; setTimeout(() => w.outcome && ui.screen === "battle" && endBattle(w), 2500); }
  }
  // Behind the menu, a battle plays itself under a slow drifting camera.
  if (w && ui.screen === "menu") {
    ui.acc += real;
    while (ui.acc >= DT) { if (w.outcome || w.field) { ui.w = quick((Math.random() * 1e9) >>> 0); for (let i = 0; i < 300; i++) { autoCommander(ui.w); step(ui.w, brains); } bridge.reset(); } autoCommander(ui.w!); step(ui.w!, brains); ui.acc -= DT; }
    bridge.view.yaw = Math.sin(now / 20000) * 0.4; bridge.view.x = 250 + Math.sin(now / 13000) * 300;
  } else bridge.view.yaw = 0;
  if (w) bridge.draw(w, 0, w ? overlay(w) : { selected: ui.sel, target: 0, lines: [], rings: [] }, real);
  requestAnimationFrame(frame);
}

function fit() { bridge.resize(innerWidth, innerHeight); }

/** The patch of the table the camera sees, as four sim points (for the minimap). */
function viewBox() {
  const W = canvas.clientWidth, H = canvas.clientHeight;
  const pts = [[0, 0], [W, 0], [W, H], [0, H]].map(([x, y]) => bridge.pick(x, y, W, H));
  return pts.every((p) => p) ? (pts as { x: number; z: number }[]) : null;
}

// The minimap: left-click or drag moves the view there, right-click orders the selection there.
const mm = $<HTMLCanvasElement>("minimap");
let mmDrag = false;
const mmAt = (e: PointerEvent) => { const r = mm.getBoundingClientRect(); return ui.w?.field ? minimap.toSim(ui.w, e.clientX - r.left, e.clientY - r.top) : null; };
const lookAt = (p: { x: number; z: number }) => { bridge.view.x = p.x; bridge.view.z = p.z; };
mm.addEventListener("contextmenu", (e) => e.preventDefault());
mm.addEventListener("pointerdown", (e) => {
  const p = mmAt(e); if (!p) return;
  e.preventDefault();
  if (e.button === 2) { orderAt(p.x, p.z); return; }
  mmDrag = true; try { mm.setPointerCapture(e.pointerId); } catch { /* none for a synthetic pointer */ }
  lookAt(p);
});
mm.addEventListener("pointermove", (e) => { if (!mmDrag) return; const p = mmAt(e); if (p) lookAt(p); });
mm.addEventListener("pointerup", () => { mmDrag = false; });
window.addEventListener("resize", fit);

// ---------------------------------------------------------------- the harness

declare global { interface Window { fleetCommander: typeof harness } }
const shipState = (w: World, s: Ship) => ({ id: s.id, side: s.side, kind: s.kind, name: s.name, x: Math.round(s.x), z: Math.round(s.z), hull: Math.round(s.hull), shield: Math.round(s.shield), order: shipOrderWord(w, s), doctrine: s.auto ? s.doctrine : null, dead: s.dead });
const wingState = (w: World, g: Wing) => ({ id: g.id, side: g.side, role: g.role, name: g.name, craft: alive(g).length, of: g.size, state: g.state, stance: g.stance, formation: g.formation, order: orderWord(w, g) });
/** The harness (scripts/probe.ts HANDLES): what is on the table, and moves that play without a mouse. */
const harness = {
  state: () => {
    const w = ui.w;
    return {
      screen: ui.screen, kind: ui.kind, look: bridge.look, paused: ui.paused, speed: ui.speed, pen: ui.pen,
      battle: w ? {
        t: w.t, mode: w.mode, outcome: w.outcome, why: w.why, focus: Math.round(w.focus), foresight: w.t < w.foresightUntil, trance: w.t < w.tranceUntil, voice: w.t < w.voiceUntil, radio: w.pending.length,
        planet: { name: w.planet.name, base: Math.round(w.planet.base), of: Math.round(w.planet.baseMax) },
        rim: { temper: w.rimTemper, doctrine: w.rimDoctrine, intent: w.rimIntent },
        selected: [...ui.sel], target: ui.target,
        ships: w.ships.map((s) => shipState(w, s)), wings: w.wings.map((g) => wingState(w, g)),
        torps: w.torps.length, stats: w.stats, comms: w.comms.slice(-5),
        field: w.field ? {
          supply: Math.floor(w.field.supply.navy), sensors: w.field.tier.navy, pingReady: Math.max(0, Math.ceil(w.field.ping.ready - w.t)), heldSince: w.field.heldSince,
          points: w.field.points.map((p) => ({ name: p.name, owner: p.owner, hold: Math.round(p.hold * 100) / 100 })),
          sees: [...w.field.sees.navy], known: [...w.field.known.navy.keys()], mines: { all: w.field.mines.length, seen: w.field.mines.filter((m) => w.field!.sees.navy.has(m.id)).length },
        } : null,
      } : null,
      sector: ui.sector ? { turn: ui.sector.turn, at: ui.sector.at, supply: ui.sector.supply, held: ui.sector.held, bases: ui.sector.bases, forming: ui.sector.forming, fleet: ui.sector.fleet, outcome: ui.sector.outcome, moves: neighbours(ui.sector.at) } : null,
    };
  },
  quick: (seed = 1) => { startQuick(seed); return harness.state(); },
  armada: (seed = 1) => { startArmada(seed); return harness.state(); },
  /** The theater: the whole Pyre system in the fog. */
  theater: (seed = 1) => { startTheater(seed); return harness.state(); },
  /** The sensor ship's ping (K). Answers why not, or "". */
  ping: () => { const w = ui.w; return w ? ping(w) : "no battle"; },
  /** Spend supply: a wing (scout | interceptor | bomber | escort) or thermal sensors. Answers why not, or "". */
  buy: (what: Buy) => { const w = ui.w; return w ? requisition(w, "navy", what) : "no battle"; },
  /** Pick what a drag box over these screen pixels would. */
  box: (x1: number, y1: number, x2: number, y2: number) => { boxSelect(x1, y1, x2, y2, false); return [...ui.sel]; },
  campaign: () => { startCampaign(); return harness.state().sector; },
  /** Jump the campaign fleet to a neighbouring world (a battle starts if one waits there). */
  go: (id: string) => { goSystem(id); return harness.state().sector; },
  refit: () => { if (ui.sector) refit(ui.sector); drawSector(); return harness.state().sector; },
  /** Pick wings or ships by id (state().battle.wings / ships). */
  select: (...ids: number[]) => { ui.sel = new Set(ids); return [...ui.sel]; },
  mark: (id: number) => { ui.target = id; },
  play: (id: PlayId, target?: number) => { if (target) ui.target = target; callPlay(id); return ui.banner.text; },
  stance: (s: Stance) => setStance(s),
  formation: (f: Formation) => setFormation(f),
  flagship: (o: "broadside" | "rake" | "hold") => flagshipOrder(o),
  lane: () => laneOrder(),
  /** Order the selection at a sim point (what a right-click does). */
  orderAt: (x: number, z: number) => orderAt(x, z),
  power: (p: Power) => power(p),
  /** Draw a play through sim points [x, z][] for the picked wings (what a right-drag does); `join` adds an arm. */
  draw: (pts: [number, number][], join = false) => { drawnPlay(pts.map(([x, z]) => ({ x, z })), join); return ui.banner.text; },
  /** Run the battle `seconds` ahead at once (paused or not). */
  run: (seconds: number) => { const w = ui.w; if (!w) return null; for (let i = 0; i < seconds / DT && !w.outcome; i++) step(w, brainsOf(w)); drawHud(w); return harness.state().battle; },
  look: (l: Look) => bridge.setLook(l),
  pause: (on = true) => { ui.paused = on; },
  /** Point the camera at a sim point, `dist` out. */
  camera: (x: number, z: number, dist?: number) => { ui.ride.on = false; bridge.view.x = x; bridge.view.z = z; if (dist) bridge.view.dist = dist; },
};
window.fleetCommander = harness;

const PREFIX = "fleet_commander";
const words = (id: string) => $(id).textContent?.trim() ?? "";
addCommands([
  howToPlay(PREFIX, () => ({ goal: words("goal"), desktop: words("desktop"), phone: words("phone"), first: "Press Quick battle." })),
  { name: `${PREFIX}_start`, title: "Start a quick battle", group: "Play", description: "Start the quick battle (one destroyer, six wings, a Compact base). Answers with the state.", execute: () => harness.quick(1) },
  { name: `${PREFIX}_state`, title: "Look at the battle", group: "Play", description: "The battle now: time, outcome, focus, the planet's base, every ship and wing with its order, the Compact admiral's temper and doctrine, and the campaign sector.", annotations: { readOnlyHint: true }, execute: () => harness.state() },
]);
mountPalette();

async function boot() {
  const back = await finishSignIn();
  if (back?.error) $("note").textContent = back.error;
  accountChip($("account"), {});
  $("play").addEventListener("click", () => startQuick(Date.now() >>> 0));
  $("armada").addEventListener("click", () => startArmada(Date.now() >>> 0));
  $("theater").addEventListener("click", () => startTheater(Date.now() >>> 0));
  $("campaign").addEventListener("click", startCampaign);
  $("again").addEventListener("click", () => (ui.kind === "campaign" ? show("sector") : ui.kind === "armada" ? startArmada(ui.seed + 1) : ui.kind === "theater" ? startTheater(ui.seed + 1) : startQuick(ui.seed + 1)));
  $("to-menu").addEventListener("click", () => show("menu"));
  $("quit").addEventListener("click", () => { if (ui.kind === "campaign" && ui.w && ui.sector) { ui.w.outcome = "loss"; ui.w.why = "You ordered the retreat."; endBattle(ui.w); } else show("menu"); });
  $("sector-quit").addEventListener("click", () => show("menu"));
  $("speed").addEventListener("click", cycleSpeed);
  $("look").addEventListener("click", toggleLook);
  $("foresight").addEventListener("click", () => power("foresight"));
  $("trance").addEventListener("click", () => power("trance"));
  $("voice").addEventListener("click", () => power("voice"));
  $("look").innerHTML = icon(Layers);
  $("quit").innerHTML = icon(LogOut);
  $("sector-quit").innerHTML = icon(MapIcon);
  const look = (params.get("look") ?? localStorage.getItem("fleet-commander.look")) as Look | null;
  if (look === "holo" || look === "cinema") bridge.setLook(look);
  fit();
  // A menu backdrop: the quick battle, already under way.
  ui.w = quick(3);
  for (let i = 0; i < 300; i++) { autoCommander(ui.w); step(ui.w, brains); }
  bridge.view = { ...bridge.view, x: 200, z: 100, dist: 2200 };
  const go = params.get("battle") ?? params.get("mode");
  if (go === "quick" || go === "1") startQuick(Number(params.get("seed") ?? 1));
  else if (go === "armada") startArmada(Number(params.get("seed") ?? 1));
  else if (go === "theater") startTheater(Number(params.get("seed") ?? 1));
  else if (go === "campaign") startCampaign();
  requestAnimationFrame(frame);
}

void boot();
