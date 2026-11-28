// The Stage Builder on /rooms.html (#6053): the Event Planner as a level builder. + offers New (a three step picker:
// arena, stage, sound) or Old (the orders you locked in). Then one isometric view over the builder's own 3D
// (build-view.ts, its canvas borrowed while this is up): what is set draws solid, what you are placing is a glowing
// green outline that snaps to 0.5 m and turns in 15° steps. Test it lays the coverage map on the floor and plays the
// walk-through's test set as heard from where you tap; History rolls back to any save; Lock in freezes the build as an
// order, which opens as The Event. The model and what is kept are stage-build.ts; every change goes through the
// builder's edits (builder.ts). `window.qstage` is the harness: state() and screen(x, z).
import "./stage.css";
import { esc } from "@rustybuns/util";
import { floorStats, gear, stackRows, SYSTEMS, type Row } from "@rustybuns/gear";
import * as THREE from "three";
import { Edit, edit } from "./builder.ts";
import type { BuildView } from "./build-view.ts";
import { floorMap, heatCanvas, mapAt, type FloorMap } from "./coverage.ts";
import { paStack } from "./open-air.ts";
import { arrivalSpread, PaRoom, roomRig } from "./pa-room.ts";
import { deckHeight, floorAt, inStage, STAGE_SIZE, type StagePiece, type StudioDef } from "./room.ts";
import { ARENA, ARENAS, arenaWords, BUILDS, crowdZone, inZone, keep, latest, lockIn, MAX_HIGH, newArena, openBuild, readStore, rollBack, snap, STACK_BOXES, stacksOf, stackStart, STAGES, stageFits, stageStart, startBuild, stepBack, TURN, type Arena, type Order, type Store } from "./stage-build.ts";
import { stageModel } from "./stage-model.ts";
import { playWalkSet } from "./walk-set.ts";

export type StageDeps = {
  /** The builder's 3D view and its canvas (null with no WebGL). */
  view(): BuildView | null;
  canvas: HTMLCanvasElement;
  /** Open `def` as The Event in a new tab: its link, or why not. */
  event(def: StudioDef): { link: string } | { why: string };
  /** The Stage Builder is closing: put the room builder's view back. */
  closed(): void;
  /** Before the Stage Builder opens (the room builder lets go of the open party). */
  opening(): void;
};

/** Lucide's icons, drawn from their paths. */
const icon = (d: string) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  plus: icon(`<path d="M5 12h14"/><path d="M12 5v14"/>`),
  undo: icon(`<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>`),
  history: icon(`<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>`),
  test: icon(`<path d="M11 4.7 6.9 8.4H4a1 1 0 0 0-1 1v5.2a1 1 0 0 0 1 1h2.9l4.1 3.7z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.4 5.6a10 10 0 0 1 0 12.8"/>`),
  lock: icon(`<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>`),
  x: icon(`<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`),
  left: icon(`<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>`),
  right: icon(`<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>`),
  trash: icon(`<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>`),
  zoomIn: icon(`<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/>`),
  zoomOut: icon(`<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6"/>`),
};
const button = (act: string, words: string, glyph = "", cls = "", off = false) =>
  `<button type="button" class="sb-btn ${cls}" data-act="${act}" aria-label="${esc(words)}" title="${esc(words)}"${off ? " disabled" : ""}>${glyph}<span>${esc(words)}</span></button>`;
const boxName = (id: string) => { const w = gear(id).what; return w[0]!.toUpperCase() + w.slice(1); };
const when = (at: number) => new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const rowsOf = (def: StudioDef, i = 0): Row[] => { const st = stacksOf(def)[i]; return st ? stackRows(roomRig(def), st).map((r) => ({ ...r })) : []; };
const orderWords = (o: Order) => `${arenaWords(o.def)}${o.def.stage ? ` · stage ${o.def.stage.w} × ${o.def.stage.d}` : ""} · ${stacksOf(o.def).length} stack${stacksOf(o.def).length === 1 ? "" : "s"}`;
/** A box as an isometric drawing, for the picker's tiles. */
function isoBox(w: number, h: number, d: number): string {
  // one scale for every tile (the largest stage fills it), so a pub corner looks small beside an arena
  const C = Math.cos(Math.PI / 6), k = Math.min(110 / ((STAGE_SIZE.w[1] + STAGE_SIZE.d[1]) * C), 44 / (1.8 + (STAGE_SIZE.w[1] + STAGE_SIZE.d[1]) / 2));
  const p = (x: number, y: number, z: number) => `${(70 + (x - z - (w - d) / 2) * C * k).toFixed(1)},${(50 + ((x + z - w - d) / 2 - y) * k).toFixed(1)}`;
  const face = (...pts: string[]) => `<polygon points="${pts.join(" ")}"/>`;
  return `<svg viewBox="0 0 140 56" aria-hidden="true">${face(p(0, h, 0), p(w, h, 0), p(w, h, d), p(0, h, d))}${face(p(0, 0, d), p(w, 0, d), p(w, h, d), p(0, h, d))}${face(p(w, 0, 0), p(w, 0, d), p(w, h, d), p(w, h, 0))}</svg>`;
}

type Placing = { at: [number, number]; yaw: number; moving?: boolean } & ({ kind: "stage"; w: number; d: number } | { kind: "stack"; rows: Row[]; index?: number });
type Picker = { step: 0 | 1 | 2; arena: Arena; stage: { w: number; d: number }; boxes: string[] };

export function mountStage(deps: StageDeps) {
  const root = document.createElement("div");
  root.id = "stagebuild"; root.hidden = true;
  root.innerHTML = `<div class="sb-bar"></div><div class="sb-view"><div class="sb-place" hidden></div><div class="sb-test" hidden></div><div class="sb-zoom">${button("zoom-in", "Zoom in", ICON.zoomIn, "sb-icon")}${button("zoom-out", "Zoom out", ICON.zoomOut, "sb-icon")}${button("spin", "Turn the view", ICON.right, "sb-icon")}</div></div><div class="sb-status"><span class="sb-saved"></span><span class="sb-why" role="status"></span><span class="sb-counts"></span></div>`;
  const menu = document.createElement("div");
  menu.id = "sb-menu"; menu.hidden = true;
  const dialog = document.createElement("dialog");
  dialog.id = "sb-dialog";
  document.body.append(root, menu, dialog);
  const q = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T & HTMLElement>(sel)!;
  const host = q(".sb-view");

  const stored = () => { try { return localStorage.getItem(BUILDS); } catch { return null; } };
  let store: Store = readStore(stored());
  let on = false, why = "";
  let def: StudioDef | null = null;
  let placing: Placing | null = null;
  /** Where the stacks go once the stage is down (the picker's Sound step). */
  let next: Row[] | null = null;
  let redo: StudioDef[] = [];
  let picker: Picker | null = null;
  let test: { map: FloorMap; heat: HTMLCanvasElement; spot: [number, number] | null } | null = null;
  let sound: { ctx: AudioContext; pa: PaRoom; stop(): void } | null = null;
  /** What the outline in the view is of. */
  let outlined = "";
  /** Where the canvas goes back to. */
  let home: { parent: Node; after: Node | null; hidden: boolean } | null = null;

  function persist() {
    try { localStorage.setItem(BUILDS, JSON.stringify(store)); } catch { why = "this browser won't keep it: the build lasts until you reload"; }
  }

  // ---- the view ----

  function show(fresh = false) {
    const view = deps.view();
    if (!on || !def || !view) return;
    if (fresh) { view.isometric(true); outlined = ""; }
    view.crowdZone(crowdZone(def));
    // a stack or the stage picked up isn't drawn where it was
    let drawn = def;
    if (placing?.moving && placing.kind === "stage") { const { stage: _, ...rest } = def; drawn = { ...rest, spots: def.spots.filter((s) => s.id !== "dj") }; }
    if (placing?.kind === "stack" && placing.index !== undefined) {
      drawn = structuredClone(def);
      stacksOf(drawn).splice(placing.index, 1);
    }
    view.show(drawn, undefined, "cutaway", test?.heat ?? null);
    ghost();
  }

  /** The edit that sets what is being placed down where its outline is. */
  function setting(p: Placing): Edit {
    if (p.kind === "stage") return { t: "stage", at: p.at, yaw: p.yaw, w: p.w, d: p.d };
    return p.index === undefined ? { t: "stack", at: p.at, yaw: p.yaw, rows: p.rows } : { t: "moveStack", index: p.index, at: p.at, yaw: p.yaw };
  }

  function ghost() {
    const view = deps.view();
    if (!view || !def) return;
    // the outline is built when what is in hand changes, and only moved after
    const key = !placing ? "" : placing.kind === "stage" ? `stage ${placing.w} ${placing.d}` : `stack ${roomRig(def).id} ${JSON.stringify(placing.rows)}`;
    if (placing) {
      if (key !== outlined) view.ghost(placing.kind === "stage" ? stageModel({ at: [0, 0], yaw: 0, w: placing.w, d: placing.d }) : paStack({ at: [0, 0], yaw: 0, rows: placing.rows }, undefined, SYSTEMS[roomRig(def).id].stack));
      view.ghostAt(...placing.at, placing.yaw);
    } else if (test?.spot) {
      // where you're listening from: a head on a pole
      const [x, z] = test.spot, y = floorAt(def, x, z), r = Math.max(0.25, Math.max(def.size.w, def.size.d) / 120);
      const g = new THREE.Group(), head = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8)), pole = new THREE.Mesh(new THREE.CylinderGeometry(r / 5, r / 5, 1.6, 6));
      head.position.set(x, y + 1.6 + r, z); pole.position.set(x, y + 0.8, z); g.add(head, pole);
      view.ghost(g);
    } else view.ghost(null);
    outlined = key;
    bars();
  }

  // ---- the bars ----

  function bars() {
    if (!on || !def) return;
    const b = openBuild(store)!, stacks = stacksOf(def).length, crowd = crowdZone(def);
    const ready = !!def.stage && stacks > 0;
    q(".sb-bar").innerHTML = `${button("menu", "New or old", ICON.plus, "sb-plus")}<strong>${esc(arenaWords(def).replace(/^./, (c) => c.toUpperCase()))}</strong><span class="sb-gap"></span>
      ${button("undo", "Undo", ICON.undo, "", b.saves.length < 2)}${button("history", "History", ICON.history)}${button("test", "Test it", ICON.test, test ? "sb-on" : "", !ready)}${button("lock", "Lock in", ICON.lock, "sb-go", !ready)}${button("close", "Close", ICON.x, "sb-icon")}`;
    const place = q(".sb-place");
    place.hidden = !placing;
    if (placing) {
      const tried = edit(def, setting(placing)), what = placing.kind === "stage" ? "stage" : "stack";
      place.innerHTML = `<span class="${tried.ok ? "" : "sb-bad"}">${tried.ok ? `Placing the ${what} · snap 0.5 m · ${Math.round((placing.yaw * 180) / Math.PI)}°` : `Not there: ${esc(tried.why)}`}</span>
        ${button("turn-left", "Turn left", ICON.left, "sb-icon")}${button("turn-right", "Turn right", ICON.right, "sb-icon")}${button("set", "Set it", "", "sb-go", !tried.ok)}
        ${placing.kind === "stack" && placing.index !== undefined ? button("remove", "Remove", ICON.trash, "sb-icon") : ""}${def.stage ? button("done", placing.moving ? "Leave it" : "Done") : ""}`;
    }
    const panel = q(".sb-test");
    panel.hidden = !test || !!placing;
    if (test) {
      const stats = floorStats(test.map.grid, (x, z) => !crowd || inZone(crowd.points, x, z));
      const spot = test.spot;
      panel.innerHTML = `<b>Across the ${crowd ? "crowd" : "floor"}</b><span>${stats.mean.toFixed(0)} dB average, ${stats.min.toFixed(0)} to ${stats.max.toFixed(0)} dB</span>
        ${spot ? `<b>Where you stand</b><span>${mapAt(test.map, ...spot).toFixed(0)} dB, the stacks landing ${arrivalSpread(def, ...spot).toFixed(0)} ms apart</span>${sound ? button("quiet", "Stop listening") : button("listen", "Listen here")}` : `<span>Tap the floor to listen from there.</span>`}`;
    }
    q(".sb-why").textContent = why;
    q(".sb-counts").textContent = `${stacks} stack${stacks === 1 ? "" : "s"}${crowd ? ` · crowd ${crowd.m2} m² · cap ${crowd.cap}` : ""}`;
    saved();
  }
  function saved() {
    const b = openBuild(store);
    if (!on || !b) return;
    const s = Math.max(0, Math.round((Date.now() - b.saves[b.saves.length - 1]!.at) / 1000));
    q(".sb-saved").textContent = `Saved ${s < 5 ? "just now" : s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : when(b.saves[b.saves.length - 1]!.at)}`;
  }
  setInterval(saved, 5_000);

  // ---- changes ----

  /** Anything that changes the build ends the test: its map and its sound were of the build as it was. */
  function endTest() { quiet(); test = null; }

  function change(e: Edit, note: string): boolean {
    if (!def) return false;
    const out = edit(def, e);
    why = out.ok ? "" : out.why;
    if (out.ok) { endTest(); def = out.def; redo = []; store = keep(store, def, note, Date.now()); persist(); }
    return out.ok;
  }

  /** Set the outline down; then on to the next thing: the stacks after the stage, another stack after a stack. */
  function set() {
    const p = placing;
    if (!p) return;
    const n = p.kind === "stack" ? (p.index ?? stacksOf(def!).length) + 1 : 0;
    const note = p.kind === "stage" ? (p.moving ? "stage moved" : "stage placed") : p.index === undefined ? `stack ${n} placed` : `stack ${n} moved`;
    if (!change(setting(p), note)) return bars();
    if (p.moving) placing = null;
    else if (p.kind === "stage") placing = next && !stacksOf(def!).length ? { kind: "stack", rows: next, ...facing(stackStart(def!)) } : null;
    else placing = { kind: "stack", rows: p.rows, ...facing(stackStart(def!)) };
    show();
  }
  /** Where a new stack starts, facing the way the stage does. */
  const facing = (at: [number, number]) => ({ at, yaw: def?.stage?.yaw ?? 0 });

  function undo(back = true) {
    const b = openBuild(store);
    if (!b) return;
    if (back) {
      if (b.saves.length < 2) return;
      redo.push(latest(b));
      store = stepBack(store);
    } else {
      const again = redo.pop();
      if (!again) return;
      store = keep(store, again, "redone", Date.now());
    }
    endTest(); placing = null; why = ""; def = latest(openBuild(store)!); needStage(); persist(); show();
  }

  // ---- in and out ----

  /** An arena with no stage yet (a reload, or Undo back to the start) goes on placing one: there is nothing else to do there. */
  function needStage() {
    if (!def || def.stage || placing) return;
    const a = { outdoor: !!def.outdoor, w: def.size.w, d: def.size.d };
    const { w, d } = [...STAGES].reverse().find((s) => s.w <= 10 && stageFits(a, s)) ?? STAGES[0];
    placing = { kind: "stage", w, d, at: stageStart(def, d), yaw: 0 };
  }

  function enter() {
    const b = openBuild(store);
    if (!b) return;
    const view = deps.view();
    if (!view) { alert3d(); return; }
    endTest();
    if (!on) {
      deps.opening();
      home = { parent: deps.canvas.parentNode!, after: deps.canvas.nextSibling, hidden: deps.canvas.hidden };
      host.prepend(deps.canvas); deps.canvas.hidden = false;
      root.hidden = false; on = true;
      document.body.classList.add("sb-open");
    }
    def = latest(b); why = ""; redo = []; placing = null; next = null;
    needStage();
    persist(); show(true);
  }
  function alert3d() { open(`<h2>Stage Builder</h2><p>This browser can't draw the 3D view the builder needs.</p>`); }

  function close() {
    if (!on) return;
    endTest(); placing = null; on = false; root.hidden = true;
    document.body.classList.remove("sb-open");
    const view = deps.view();
    view?.isometric(false);
    if (home) { home.parent.insertBefore(deps.canvas, home.after); deps.canvas.hidden = home.hidden; }
    const { open: _, ...rest } = store; store = rest; persist();
    deps.closed();
  }

  // ---- the + menu and the dialogs ----

  function plus(at: HTMLElement) {
    if (!menu.hidden) { menu.hidden = true; return; }
    const last = !on ? store.builds[0] : undefined;
    const item = (act: string, name: string, about: string) => `<button type="button" data-act="${act}"><b>${esc(name)}</b><span>${esc(about)}</span></button>`;
    menu.innerHTML = item("new", "New", "Start a build: arena, stage, sound") + item("old", "Old", "A past order to reuse or change")
      + (on && def?.stage ? item("another", stacksOf(def).length ? "Another stack" : "A stack", stacksOf(def).length ? "One more, like the last" : "Put one down") : "")
      + (last ? item("carry-on", "Carry on", last.name) : "");
    menu.hidden = false;
    const r = at.getBoundingClientRect();
    menu.style.top = `${r.bottom + 6}px`;
    menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8))}px`;
  }

  function open(html: string, cls = "") {
    menu.hidden = true;
    dialog.className = cls;
    dialog.innerHTML = `${button("shut", "Close", ICON.x, "sb-icon sb-shut")}${html}`;
    if (!dialog.open) dialog.showModal();
  }
  const shut = () => { picker = null; if (dialog.open) dialog.close(); };
  dialog.addEventListener("close", () => { picker = null; });

  const slider = (key: string, name: string, v: number, lo: number, hi: number) =>
    `<label class="sb-slider"><span>${esc(name)} · <output>${v}</output> m</span><input type="range" data-slider="${key}" min="${lo}" max="${hi}" step="1" value="${v}"><small>${lo} m</small><small>${hi} m</small></label>`;

  function pick() {
    const p = picker!;
    const steps = ["Arena", "Stage", "Sound"].map((s, i) => `<span class="${i === p.step ? "sb-on" : ""}">${s}</span>`).join("");
    const tile = (attr: string, name: string, about: string, picked: boolean, art = "", off = false) =>
      `<button type="button" class="sb-tile${picked ? " sb-on" : ""}" ${attr} aria-pressed="${picked}"${off ? " disabled" : ""}>${art}<b>${esc(name)}</b><span>${esc(about)}</span></button>`;
    let body: string;
    if (p.step === 0) {
      body = `<div class="sb-tiles">${tile(`data-outdoor="0"`, "Room", "Walls and a ceiling", !p.arena.outdoor)}${tile(`data-outdoor="1"`, "Open ground", "A field under the sky", p.arena.outdoor)}</div>
        <div class="sb-chips">${ARENAS.map((a, i) => `<button type="button" data-arena="${i}">${esc(a.name)} ${a.w} × ${a.d}</button>`).join("")}</div>
        ${slider("aw", "Arena width", p.arena.w, ARENA.w[0], ARENA.w[1])}${slider("ad", "Arena depth", p.arena.d, ARENA.d[0], ARENA.d[1])}`;
    } else if (p.step === 1) {
      body = `<div class="sb-tiles">${STAGES.map((s, i) => tile(`data-stage="${i}"`, s.name, `${s.w} × ${s.d} m`, s.w === p.stage.w && s.d === p.stage.d, isoBox(s.w, deckHeight(s), s.d), !stageFits(p.arena, s))).join("")}</div>
        ${slider("sw", "Stage width", p.stage.w, STAGE_SIZE.w[0], Math.min(STAGE_SIZE.w[1], p.arena.w - 1))}${slider("sd", "Stage depth", p.stage.d, STAGE_SIZE.d[0], Math.min(STAGE_SIZE.d[1], p.arena.d - 2))}`;
    } else {
      const full = p.boxes.length >= MAX_HIGH;
      body = `<p>Build one stack from the ground up, ${MAX_HIGH} boxes at most. You place as many of it as you like.</p>
        <ol class="sb-stack">${p.boxes.length ? p.boxes.map((id) => `<li>${esc(boxName(id))}</li>`).join("") : `<li class="sb-empty">No boxes yet</li>`}</ol>
        <div class="sb-row"><span>${p.boxes.length} of ${MAX_HIGH}</span>${button("unbox", "Take the top box off", "", "", !p.boxes.length)}</div>
        <div class="sb-tiles">${STACK_BOXES.map((id) => tile(`data-box="${id}"`, boxName(id), `${gear(id).size.h.toFixed(2)} m high`, false, "", full)).join("")}</div>`;
    }
    const keepScroll = dialog.querySelector(".sb-body")?.scrollTop ?? 0;
    open(`<div class="sb-steps">${steps}</div><div class="sb-body">${body}</div>
      <div class="sb-foot">${button("back", "Back", "", "", p.step === 0)}${p.step < 2 ? button("next", "Next", "", "sb-go") : button("place", "Place it", "", "sb-go", !p.boxes.length)}</div>`, "sb-full");
    dialog.querySelector(".sb-body")!.scrollTop = keepScroll;
  }

  /** The stage kept inside what the arena holds. */
  function fitStage(p: Picker) {
    p.stage = { w: Math.max(STAGE_SIZE.w[0], Math.min(p.stage.w, p.arena.w - 1)), d: Math.max(STAGE_SIZE.d[0], Math.min(p.stage.d, p.arena.d - 2)) };
  }

  function old() {
    const orders = store.orders;
    open(`<h2>Old: past orders</h2>${orders.length ? `<ul class="sb-list">${orders.map((o, i) => `<li><div><b>${esc(o.name)}</b><span>${esc(orderWords(o))}</span></div>
      <div class="sb-row" data-order="${i}">${button("whole", "Whole")}${button("just-stage", "Stage", "", "", !o.def.stage)}${button("just-stack", "Stack", "", "", !stacksOf(o.def).length)}${button("event", "The Event")}${button("drop", "Throw away", ICON.trash, "sb-icon")}</div></li>`).join("")}</ul>` : `<p>Nothing locked in yet. Build one with New, then Lock in.</p>`}`);
  }

  /** An order dropped back in: all of it, or its stage or stack as the outline to place (in the build you have up, else a new one on its arena). */
  function drop(o: Order, what: "whole" | "stage" | "stack") {
    shut();
    if (what === "whole") { store = startBuild(store, structuredClone(o.def), Date.now(), `from ${o.name}`.slice(0, 80)); enter(); return; }
    if (!on) { store = startBuild(store, newArena({ outdoor: !!o.def.outdoor, w: o.def.size.w, d: o.def.size.d }), Date.now()); enter(); }
    if (!def) return;
    endTest();
    why = "";
    if (what === "stage" && o.def.stage) {
      const { w, d } = o.def.stage;
      next = stacksOf(def).length ? null : rowsOf(o.def);
      placing = { kind: "stage", w, d, at: def.stage?.at ?? stageStart(def, d), yaw: def.stage?.yaw ?? 0, moving: !!def.stage };
    } else if (def.stage) placing = { kind: "stack", rows: rowsOf(o.def), ...facing(stackStart(def)) };
    // a stack alone, onto a bare arena: the stage first, then it
    else next = rowsOf(o.def);
    show();
  }

  function history() {
    const saves = openBuild(store)!.saves;
    open(`<h2>History</h2><ul class="sb-list">${saves.map((s, i) => [s, i] as const).reverse().map(([s, i]) => `<li><div><b>${esc(s.note)}</b><span>${esc(when(s.at))}</span></div>${i === saves.length - 1 ? `<span class="sb-now">now</span>` : `<button type="button" class="sb-btn" data-roll="${i}">Back to this</button>`}</li>`).join("")}</ul>`);
  }

  function event(of: StudioDef) {
    const out = deps.event(of);
    open("link" in out ? `<h2>The Event is open</h2><p>It plays live through this PA. If no new tab came up, <a href="${esc(out.link)}" target="_blank" rel="noopener">open it here</a>.</p>` : `<h2>The Event</h2><p>${esc(out.why)}</p>`);
  }

  // ---- presses ----

  function act(what: string, el: HTMLElement) {
    const order = store.orders[Number(el.closest<HTMLElement>("[data-order]")?.dataset.order ?? -1)];
    switch (what) {
      case "menu": plus(el); return;
      case "new": picker = { step: 0, arena: { outdoor: true, w: 60, d: 40 }, stage: { w: 10, d: 7 }, boxes: [] }; pick(); return;
      case "old": old(); return;
      case "carry-on": menu.hidden = true; store = { ...store, open: store.builds[0]!.id }; enter(); return;
      case "another": menu.hidden = true; endTest(); placing = { kind: "stack", rows: stacksOf(def!).length ? rowsOf(def!, stacksOf(def!).length - 1) : next ?? [{ box: STACK_BOXES[0]!, across: 1 }], ...facing(stackStart(def!)) }; show(); return;
      case "shut": shut(); return;
      case "back": if (picker && picker.step > 0) { picker.step--; pick(); } return;
      case "next": if (picker && picker.step < 2) { picker.step++; fitStage(picker); pick(); } return;
      case "unbox": picker?.boxes.pop(); pick(); return;
      case "place": {
        const p = picker!;
        shut();
        store = startBuild(store, newArena(p.arena), Date.now());
        enter();
        if (!def) return;
        next = p.boxes.map((box) => ({ box, across: 1 }));
        placing = { kind: "stage", ...p.stage, at: stageStart(def, p.stage.d), yaw: 0 };
        show();
        return;
      }
      case "whole": if (order) drop(order, "whole"); return;
      case "just-stage": if (order) drop(order, "stage"); return;
      case "just-stack": if (order) drop(order, "stack"); return;
      case "event": if (order) event(order.def); else event(store.orders[0]!.def); return;
      case "drop": if (order) { store = { ...store, orders: store.orders.filter((o) => o !== order) }; persist(); old(); } return;
      case "undo": undo(); return;
      case "history": history(); return;
      case "test": {
        if (test) { endTest(); show(); return; }
        const map = floorMap(def!);
        if (!map) return;
        placing = null; test = { map, heat: heatCanvas(map.grid, map.ref), spot: null };
        show();
        return;
      }
      case "listen": if (test?.spot) listen(test.spot); return;
      case "quiet": quiet(); bars(); return;
      case "lock": open(`<h2>Lock in</h2><p>This freezes the build as it stands as an order, kept under Old.</p><label class="sb-name">Call it<input maxlength="60" value="${esc(openBuild(store)!.name)}"></label><div class="sb-foot">${button("locked", "Lock it in", ICON.lock, "sb-go")}</div>`); return;
      case "locked": {
        store = lockIn(store, dialog.querySelector("input")?.value ?? "", Date.now()); persist();
        open(`<h2>Locked in</h2><p><b>${esc(store.orders[0]!.name)}</b> is under Old. Keep changing this build, or open the order to play it live.</p><div class="sb-foot">${button("shut", "Keep changing")}${button("event", "Open as The Event", "", "sb-go")}</div>`);
        bars();
        return;
      }
      case "close": close(); return;
      case "turn-left": case "turn-right": turn(what === "turn-left" ? 1 : -1); return;
      case "set": set(); return;
      case "done": placing = null; why = ""; show(); return;
      case "remove": if (placing?.kind === "stack" && placing.index !== undefined && change({ t: "unstack", index: placing.index }, `stack ${placing.index + 1} removed`)) { placing = null; } show(); return;
      case "zoom-in": deps.view()?.orbit(0, 0, 0.8); return;
      case "zoom-out": deps.view()?.orbit(0, 0, 1.25); return;
      case "spin": deps.view()?.orbit(Math.PI / 2); return;
    }
  }
  function turn(by: number) {
    if (!placing) return;
    const a = placing.yaw + by * TURN;
    placing.yaw = Math.atan2(Math.sin(a), Math.cos(a));
    ghost();
  }

  for (const el of [root, menu, dialog]) el.addEventListener("click", (e) => {
    const t = e.target instanceof Element ? e.target.closest<HTMLElement>("button") : null;
    if (!t || (t as HTMLButtonElement).disabled) return;
    const d = t.dataset;
    if (d.act) act(d.act, t);
    else if (d.roll !== undefined) { shut(); endTest(); placing = null; redo = []; store = rollBack(store, Number(d.roll), Date.now()); def = latest(openBuild(store)!); needStage(); persist(); show(); }
    else if (picker) {
      if (d.outdoor !== undefined) picker.arena.outdoor = d.outdoor === "1";
      else if (d.arena !== undefined) { const { name: _, ...a } = ARENAS[Number(d.arena)]!; picker.arena = a; }
      else if (d.stage !== undefined) { const s = STAGES[Number(d.stage)]!; picker.stage = { w: s.w, d: s.d }; }
      else if (d.box && picker.boxes.length < MAX_HIGH) picker.boxes.push(d.box);
      pick();
    }
  });
  dialog.addEventListener("input", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || !t.dataset.slider || !picker) return;
    const v = Number(t.value), k = t.dataset.slider;
    if (k === "aw") picker.arena.w = v; else if (k === "ad") picker.arena.d = v; else if (k === "sw") picker.stage.w = v; else picker.stage.d = v;
    t.closest("label")!.querySelector("output")!.textContent = t.value;
    // the tiles follow without redrawing the slider under the finger
    for (const b of dialog.querySelectorAll<HTMLElement>("[data-stage]")) { const s = STAGES[Number(b.dataset.stage)]!; b.classList.toggle("sb-on", s.w === picker.stage.w && s.d === picker.stage.d); }
  });
  addEventListener("pointerdown", (e) => { if (!menu.hidden && e.target instanceof Node && !menu.contains(e.target) && !(e.target instanceof Element && e.target.closest(`[data-act="menu"], #stage-plus`))) menu.hidden = true; });

  // ---- the pointer on the floor ----

  const fingers = new Map<number, { x: number; y: number }>();
  let press: { x: number; y: number; moved: boolean } | null = null, apart = 0;
  const spread = () => { const [a, b] = [...fingers.values()]; return Math.hypot(a!.x - b!.x, a!.y - b!.y); };

  function follow(e: PointerEvent) {
    const at = deps.view()?.toRoom(e);
    if (!placing || !at || !def) return;
    const x = snap(Math.max(-def.size.w / 2, Math.min(def.size.w / 2, at[0]))), z = snap(Math.max(-def.size.d / 2, Math.min(def.size.d / 2, at[1])));
    if (x === placing.at[0] && z === placing.at[1]) return;
    placing.at = [x, z]; why = "";
    ghost();
  }

  deps.canvas.addEventListener("pointerdown", (e) => {
    if (!on || (e.pointerType === "mouse" && e.button !== 0)) return;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    deps.canvas.setPointerCapture(e.pointerId);
    // a second finger makes it a pinch, not a press
    if (fingers.size > 1) { press = null; apart = spread(); return; }
    press = { x: e.clientX, y: e.clientY, moved: false };
    follow(e);
  });
  deps.canvas.addEventListener("pointermove", (e) => {
    if (!on) return;
    if (fingers.has(e.pointerId)) fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.size > 1) { const now = spread(); if (apart && now) deps.view()?.orbit(0, 0, apart / now); apart = now; return; }
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6) press.moved = true;
    // a mouse's outline follows it; a finger's follows while it's down
    if (e.pointerType === "mouse" || press) follow(e);
  });
  const lift = (e: PointerEvent) => {
    if (!on) return;
    fingers.delete(e.pointerId);
    const was = press; press = null;
    if (!was || e.type === "pointercancel" || !def) return;
    if (placing) { follow(e); set(); return; }
    if (was.moved) return;
    const view = deps.view()!, at = view.toRoom(e);
    if (test) {
      if (!at || Math.abs(at[0]) > def.size.w / 2 || Math.abs(at[1]) > def.size.d / 2) return;
      test.spot = [snap(at[0]), snap(at[1])];
      listen(test.spot);
      ghost();
      return;
    }
    // pick up what you press: a stack, or the stage
    const hit = view.hit(e);
    if (hit && "stack" in hit) {
      const st = stacksOf(def)[hit.stack]!;
      placing = { kind: "stack", index: hit.stack, rows: rowsOf(def, hit.stack), at: [...st.at], yaw: st.yaw, moving: true };
    } else if (def.stage && (hit && ("stage" in hit || ("spot" in hit && hit.spot === "dj")) || (at && inStage(def.stage, ...at)))) {
      const { at: from, yaw, w, d } = def.stage satisfies StagePiece;
      placing = { kind: "stage", w, d, at: [...from], yaw, moving: true };
    } else return;
    why = "";
    show();
  };
  deps.canvas.addEventListener("pointerup", lift);
  deps.canvas.addEventListener("pointercancel", lift);
  deps.canvas.addEventListener("wheel", (e) => { if (!on) return; e.preventDefault(); deps.view()?.zoomAt(Math.exp(e.deltaY * 0.001), deps.view()!.toRoom(e)); }, { passive: false });
  window.addEventListener("keydown", (e: KeyboardEvent) => {
    if (!on || dialog.open || e.target instanceof HTMLInputElement) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(!e.shiftKey); }
    else if (e.key.toLowerCase() === "r" && !e.metaKey && !e.ctrlKey) turn(e.shiftKey ? 1 : -1);
    else if (e.key === "Escape") { if (placing && def?.stage) { placing = null; why = ""; show(); } }
  });

  // ---- listening ----

  /** The test set through the build's own PA, as heard at `spot` facing the stage. */
  function listen(spot: [number, number]) {
    if (!def) return;
    if (!sound) {
      const ctx = new AudioContext(), pa = new PaRoom(ctx, def, ctx.destination), set = playWalkSet(ctx, pa.input);
      sound = { ctx, pa, stop: () => { set.stop(); void ctx.close(); } };
    }
    void sound.ctx.resume();
    const [sx, sz] = def.stage?.at ?? [0, -def.size.d / 2];
    sound.pa.listen(spot[0], spot[1], Math.atan2(spot[0] - sx, spot[1] - sz));
    bars();
  }
  function quiet() { sound?.stop(); sound = null; }

  // a build left up comes back up
  if (store.open) queueMicrotask(enter);

  return {
    on: () => on,
    /** The + in the room builder's header. */
    plus,
    harness: {
      state: () => {
        const b = on ? openBuild(store) : undefined;
        return {
          on, why,
          placing: placing ? { kind: placing.kind, at: placing.at, yaw: placing.yaw } : null,
          build: b ? { name: b.name, saves: b.saves.map((s) => s.note), size: def!.size, outdoor: !!def!.outdoor, stage: def!.stage ?? null, stacks: stacksOf(def!).map((s) => ({ at: s.at, yaw: s.yaw, rows: s.rows })) } : null,
          crowd: def && on ? crowdZone(def) : null,
          test: test ? { ref: +test.map.ref.toFixed(1), spot: test.spot, listening: !!sound, heard: sound?.pa.state() ?? null } : null,
          orders: store.orders.map((o) => ({ name: o.name, stacks: stacksOf(o.def).length })),
        };
      },
      /** Where on the page the floor point (x, z) is, for a press there. */
      screen: (x: number, z: number): [number, number] => {
        const r = deps.canvas.getBoundingClientRect(), [px, py] = deps.view()!.toScreen(x, 0, z);
        return [r.left + px, r.top + py];
      },
    },
  };
}
