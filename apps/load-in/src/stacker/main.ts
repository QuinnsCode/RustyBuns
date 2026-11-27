// The stack builder (stack.html): pick what to stack and how high, then set the stacks out round the stage.
// Stack view: drag a box from the list onto the front view and it drops onto whatever is under it (plan.ts `settle`);
// drag one off the view to take it away. Stage view: the site from above, each stack a footprint you drag, aimed by
// its orange dot, the floor shaded by its level. "Just do it" builds the chosen rig sized for the floor, one stack a
// side. `window.stacker` drives it without a mouse (`bun run probe load-in /stack.html --js "stacker.state()"`).
import { PREMADES, gear, premade } from "@rustybuns/gear";
import {
  EVEN, PALETTE, RIGS, TARGET, aimAt, cover, justDoIt, planFor, readDesign, rig, role, settle, sizeFor, stats, usePremade, wallFor,
  type Box, type Cover, type Design, type Role,
} from "./plan.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const KEY = "stacker:v1";
const ROLE_NAME: Record<Role, string> = { sub: "Bass", mid: "Mid-bass", top: "Tops" };

// ---- state -----------------------------------------------------------------------------------------------------
let design: Design = load() ?? justDoIt();
let current = 0;
let view: "stack" | "stage" = "stack";
let band: "high" | "low" = "high";
let picked: number | null = null; // the placed stack selected on the stage
let heat: Cover = cover(design);
const undo: string[] = [];

function load(): Design | null {
  try { return readDesign(JSON.parse(localStorage.getItem(KEY) ?? "null")); } catch { return null; }
}
/** Every change goes through here: keeps an undo step (unless a drag already took one), settles the stacks, saves
 *  and redraws. */
function change(fn: () => void, step = true) {
  if (step) undo.push(JSON.stringify(design));
  if (undo.length > 80) undo.shift();
  fn();
  design.stacks.forEach((s) => (s.boxes = settle(s.boxes)));
  current = Math.min(current, design.stacks.length - 1);
  heat = cover(design);
  try { localStorage.setItem(KEY, JSON.stringify(design)); } catch { /* private mode: it just won't keep */ }
  draw();
}
const stack = () => design.stacks[current]!;
const depth = () => design.plan.floor.d;

// ---- drawing a box's face ---------------------------------------------------------------------------------------
const BODY = "#1d1d23", EDGE = "#3b3b45", MOUTH = "#08080b", VANE = "#2b2b34", GOLD = "#e0a92e";
type R = { x: number; y: number; w: number; h: number };
const inset = (r: R, f: number): R => ({ x: r.x + r.w * f, y: r.y + r.h * f, w: r.w * (1 - 2 * f), h: r.h * (1 - 2 * f) });
const part = (r: R, x: number, y: number, w: number, h: number): R => ({ x: r.x + r.w * x, y: r.y + r.h * y, w: r.w * w, h: r.h * h });

function fill(c: CanvasRenderingContext2D, r: R, col: string) { c.fillStyle = col; c.fillRect(r.x, r.y, r.w, r.h); }
function cone(c: CanvasRenderingContext2D, cx: number, cy: number, rad: number) {
  c.fillStyle = "#26262d"; c.beginPath(); c.arc(cx, cy, rad, 0, Math.PI * 2); c.fill();
  c.strokeStyle = "#4a4a55"; c.lineWidth = Math.max(1, rad * 0.08); c.stroke();
  c.fillStyle = "#111115"; c.beginPath(); c.arc(cx, cy, rad * 0.35, 0, Math.PI * 2); c.fill();
}
/** A horn: the mouth, lines from its corners to the throat, and the throat (gold for a compression driver). */
function flare(c: CanvasRenderingContext2D, r: R, t: R, throat: string) {
  fill(c, r, MOUTH);
  c.strokeStyle = VANE; c.lineWidth = 1.2; c.beginPath();
  for (const [ax, ay, bx, by] of [[r.x, r.y, t.x, t.y], [r.x + r.w, r.y, t.x + t.w, t.y], [r.x, r.y + r.h, t.x, t.y + t.h], [r.x + r.w, r.y + r.h, t.x + t.w, t.y + t.h]] as const) {
    c.moveTo(ax, ay); c.lineTo(bx, by);
  }
  c.stroke();
  fill(c, t, throat);
}
function cells(c: CanvasRenderingContext2D, r: R, cols: number, rows: number) {
  fill(c, r, MOUTH);
  c.fillStyle = VANE;
  const v = Math.max(2, r.w * 0.035);
  for (let i = 1; i < cols; i++) c.fillRect(r.x + (r.w * i) / cols - v / 2, r.y, v, r.h);
  for (let j = 1; j < rows; j++) c.fillRect(r.x, r.y + (r.h * j) / rows - v / 2, r.w, v);
}

/** One box's front, filling rectangle `b` (pixels). */
export function face(c: CanvasRenderingContext2D, id: string, b: R) {
  c.save();
  c.fillStyle = BODY; c.strokeStyle = EDGE; c.lineWidth = 1.5;
  if (!id.startsWith("sculpted-3way")) { c.beginPath(); c.roundRect(b.x, b.y, b.w, b.h, Math.min(b.w, b.h) * 0.04); c.fill(); c.stroke(); }
  const m = inset(b, 0.07);
  switch (id) {
    case "horn-sub-21": cells(c, m, 2, 2); break;
    case "triple-21-sub": cells(c, m, 3, 1); break;
    case "arc-sub-18": cells(c, part(b, 0.06, 0.2, 0.88, 0.6), 2, 1); break;
    case "tapped-horn-18": cells(c, part(b, 0.07, 0.06, 0.86, 0.22), 1, 1); fill(c, part(b, 0.07, 0.34, 0.86, 0.6), "#17171c"); break;
    case "tri-amp-bass": cells(c, m, 2, 1); cone(c, m.x + m.w * 0.25, m.y + m.h * 0.5, m.w * 0.15); cone(c, m.x + m.w * 0.75, m.y + m.h * 0.5, m.w * 0.15); break;
    case "sub-18": fill(c, m, "#141418"); cone(c, b.x + b.w / 2, b.y + b.h / 2, Math.min(m.w, m.h) * 0.45); break;
    case "stack-mid-bass": { const t = part(b, 0.38, 0.38, 0.24, 0.24); flare(c, m, t, "#1a1a1f"); cone(c, t.x + t.w / 2, t.y + t.h / 2, t.w * 0.5); break; }
    case "stack-mid-high": flare(c, part(b, 0.07, 0.08, 0.86, 0.58), part(b, 0.42, 0.3, 0.16, 0.12), GOLD); cells(c, part(b, 0.07, 0.72, 0.86, 0.2), 2, 1); break;
    case "synergy-horn": flare(c, m, part(b, 0.44, 0.44, 0.12, 0.12), GOLD); break;
    case "tri-amp-top": {
      const l = part(b, 0.07, 0.4, 0.4, 0.52), r = part(b, 0.53, 0.4, 0.4, 0.52);
      flare(c, l, inset(l, 0.3), "#1a1a1f"); flare(c, r, inset(r, 0.3), "#1a1a1f");
      flare(c, part(b, 0.07, 0.07, 0.86, 0.28), part(b, 0.44, 0.17, 0.12, 0.08), GOLD); break;
    }
    case "line-array-10": case "line-array-box":
      fill(c, m, "#141418"); cone(c, b.x + b.w * 0.2, b.y + b.h / 2, b.h * 0.3); cone(c, b.x + b.w * 0.8, b.y + b.h / 2, b.h * 0.3);
      flare(c, part(b, 0.36, 0.12, 0.28, 0.76), part(b, 0.46, 0.4, 0.08, 0.2), GOLD); break;
    case "sculpted-3way": case "sculpted-3way-lh": // three round horns, no box: the LF left, the MF right, the HF above between them (its drawing); the left-handed one mirrored
      for (const [u, y, s, col] of [[0.314, 0.599, 0.314, "#1a1a1f"], [0.823, 0.599, 0.175, "#1a1a1f"], [0.683, 0.194, 0.153, GOLD]] as const) {
        const x = id === "sculpted-3way-lh" ? 1 - u : u;
        c.fillStyle = BODY; c.beginPath(); c.arc(b.x + b.w * x, b.y + b.h * y, b.w * s, 0, Math.PI * 2); c.fill(); c.stroke();
        c.fillStyle = MOUTH; c.beginPath(); c.arc(b.x + b.w * x, b.y + b.h * y, b.w * s * 0.9, 0, Math.PI * 2); c.fill();
        c.fillStyle = col; c.beginPath(); c.arc(b.x + b.w * x, b.y + b.h * y, b.w * s * 0.3, 0, Math.PI * 2); c.fill();
      }
      break;
    default: // a two-way box: a cone below a little horn
      flare(c, part(b, 0.18, 0.06, 0.64, 0.24), part(b, 0.44, 0.14, 0.12, 0.08), GOLD);
      cone(c, b.x + b.w / 2, b.y + b.h * 0.64, Math.min(b.w, b.h) * 0.36);
  }
  c.restore();
}

// ---- canvases ---------------------------------------------------------------------------------------------------
function sized(cv: HTMLCanvasElement) {
  const dpr = Math.min(devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const c = cv.getContext("2d")!;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { c, w, h };
}

// ---- the stack, from the front ----------------------------------------------------------------------------------
const front = $<HTMLCanvasElement>("front");
type Drag = { gear: string; px: number; py: number; from: "list" | "stack"; moved: boolean };
let drag: Drag | null = null;
let frontView = { cx: 0, gy: 0, s: 100 };

/** Where on the ground and how big a metre is: the stack and a person fit, with room to drop a box on top. */
function frame(w: number, h: number, boxes: readonly Box[]) {
  const top = Math.max(2.2, ...boxes.map((b) => b.y + gear(b.gear).size.h)) + 0.7;
  const half = Math.max(1.6, ...boxes.map((b) => Math.abs(b.x) + gear(b.gear).size.w / 2)) + 1;
  const s = Math.min((w - 20) / (half * 2), (h - 110) / top);
  return { cx: w / 2, gy: h - 46, s };
}
const toWorld = (px: number, py: number) => ({ x: (px - frontView.cx) / frontView.s, y: (frontView.gy - py) / frontView.s });
const snap = (v: number, by = 0.05) => Math.round(Math.round(v / by) * by * 100) / 100;

/** Where the dragged box would land if let go now, or null off the view. */
function landing(): { boxes: Box[]; at: number } | null {
  if (!drag) return null;
  const r = front.getBoundingClientRect();
  const px = drag.px - r.left, py = drag.py - r.top;
  if (px < 0 || py < 0 || px > r.width || py > r.height) return null;
  const g = gear(drag.gear), p = toWorld(px, py);
  const ghost = { gear: drag.gear, x: snap(p.x), y: Math.max(0, p.y - g.size.h / 2) };
  const boxes = settle([...stack().boxes, ghost]);
  return { boxes, at: boxes.findIndex((b) => b.gear === ghost.gear && b.x === ghost.x && !stack().boxes.some((o) => o.gear === b.gear && o.x === b.x && o.y === b.y)) };
}

function person(c: CanvasRenderingContext2D, x: number, gy: number, s: number) {
  c.save(); c.fillStyle = "rgba(247,243,234,.16)";
  const hh = 1.8 * s;
  c.beginPath(); c.arc(x, gy - hh + 0.11 * s, 0.11 * s, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.roundRect(x - 0.2 * s, gy - hh + 0.25 * s, 0.4 * s, 0.7 * s, 0.08 * s); c.fill();
  c.fillRect(x - 0.17 * s, gy - hh + 0.9 * s, 0.14 * s, 0.9 * s); c.fillRect(x + 0.03 * s, gy - hh + 0.9 * s, 0.14 * s, 0.9 * s);
  c.font = "700 11px Courier Prime, monospace"; c.textAlign = "center"; c.fillText("1.8 m", x, gy - hh - 6);
  c.restore();
}

function drawFront() {
  const { c, w, h } = sized(front);
  const land = landing();
  const boxes = land?.boxes ?? stack().boxes;
  frontView = frame(w, h, boxes);
  const { cx, gy, s } = frontView;
  c.clearRect(0, 0, w, h);
  // the ground and a metre scale up the side
  c.fillStyle = "#1a1816"; c.fillRect(0, gy, w, h - gy);
  c.strokeStyle = "rgba(247,243,234,.08)"; c.lineWidth = 1; c.font = "700 11px Courier Prime, monospace"; c.fillStyle = "rgba(247,243,234,.4)";
  for (let m = 1; gy - m * s > 0; m++) { c.beginPath(); c.moveTo(0, gy - m * s); c.lineTo(w, gy - m * s); c.stroke(); c.fillText(`${m} m`, 6, gy - m * s - 3); }
  person(c, cx + (Math.max(1.2, ...boxes.map((b) => b.x + gear(b.gear).size.w / 2)) + 0.6) * s, gy, s);
  const warned = new Set(stats({ name: "", boxes }).warnings.map((x) => x.box));
  boxes.forEach((b, i) => {
    const g = gear(b.gear), r = { x: cx + (b.x - g.size.w / 2) * s, y: gy - (b.y + g.size.h) * s, w: g.size.w * s, h: g.size.h * s };
    c.globalAlpha = land && i === land.at ? 0.55 : 1;
    face(c, b.gear, r);
    c.globalAlpha = 1;
    if (warned.has(i)) { c.strokeStyle = "#ff5b1a"; c.lineWidth = 3; c.setLineDash([6, 4]); c.strokeRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4); c.setLineDash([]); }
  });
  if (drag && !land) { // off the view: the box under the pointer, about to be taken away
    const r = front.getBoundingClientRect(), g = gear(drag.gear);
    c.globalAlpha = 0.4; face(c, drag.gear, { x: drag.px - r.left - (g.size.w * s) / 2, y: drag.py - r.top - (g.size.h * s) / 2, w: g.size.w * s, h: g.size.h * s }); c.globalAlpha = 1;
  }
  const st = stats({ name: "", boxes });
  if (boxes.length) {
    // the height, up the stack's left side (the person stands on its right)
    const x0 = Math.min(...boxes.map((b) => b.x - gear(b.gear).size.w / 2));
    c.fillStyle = "#f7f3ea"; c.font = "400 15px Permanent Marker, cursive"; c.textAlign = "right";
    c.fillText(`${st.height} m`, cx + x0 * s - 8, gy - st.height * s + 6);
    c.strokeStyle = "#f7f3ea"; c.beginPath(); c.moveTo(cx + x0 * s - 4, gy - st.height * s); c.lineTo(cx + x0 * s - 4, gy); c.stroke();
  } else {
    c.fillStyle = "rgba(247,243,234,.5)"; c.font = "400 20px Permanent Marker, cursive"; c.textAlign = "center";
    c.fillText("Empty stack: drag a bass bin here first", cx, gy - 1.2 * s);
  }
}

function startDrag(e: PointerEvent, id: string, from: Drag["from"]) {
  e.preventDefault();
  drag = { gear: id, px: e.clientX, py: e.clientY, from, moved: false };
  const move = (ev: PointerEvent) => {
    if (!drag) return;
    drag.moved ||= Math.hypot(ev.clientX - drag.px, ev.clientY - drag.py) > 6;
    if (drag.moved) { drag.px = ev.clientX; drag.py = ev.clientY; draw(); }
  };
  const up = () => {
    removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up);
    const land = landing(), d = drag;
    drag = null;
    // A box lifted off the stack took its undo step when it was picked up; let go off the view, it is gone.
    if (d && d.from === "list" && !d.moved) change(() => stack().boxes.push({ gear: d.gear, x: 0, y: 99 })); // a tap: on top
    else if (land && d) change(() => (stack().boxes = land.boxes), d.from === "list");
    else if (d?.from === "stack") change(() => {}, false);
    else draw();
  };
  addEventListener("pointermove", move); addEventListener("pointerup", up); addEventListener("pointercancel", up);
  draw();
}

front.addEventListener("pointerdown", (e) => {
  const r = front.getBoundingClientRect(), p = toWorld(e.clientX - r.left, e.clientY - r.top);
  const boxes = stack().boxes;
  // the topmost box under the pointer (later boxes sit higher)
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i]!, g = gear(b.gear);
    if (Math.abs(p.x - b.x) <= g.size.w / 2 && p.y >= b.y && p.y <= b.y + g.size.h) {
      undo.push(JSON.stringify(design));
      boxes.splice(i, 1);
      startDrag(e, b.gear, "stack");
      return;
    }
  }
});

// ---- the stage, from above --------------------------------------------------------------------------------------
const planCv = $<HTMLCanvasElement>("plan");
let planView = { x0: 0, z0: 0, s: 10, ox: 0, oy: 0 };
type PlanDrag = { i: number; mode: "move" | "aim"; dx: number; dz: number };
let pdrag: PlanDrag | null = null;

const P = (x: number, z: number) => ({ px: planView.ox + (x - planView.x0) * planView.s, py: planView.oy + (z - planView.z0) * planView.s });
const W = (px: number, py: number) => ({ x: planView.x0 + (px - planView.ox) / planView.s, z: planView.z0 + (py - planView.oy) / planView.s });

const RAMP: [number, string][] = [[-9, "#2b4cc4"], [-6, "#2a8f9a"], [-3, "#3e9b4f"], [0, "#e0c53a"], [3, "#ff8a1a"], [6, "#d8262e"]];
const shade = (d: number) => (RAMP.find(([lim]) => d <= lim + 1.5) ?? RAMP[RAMP.length - 1]!)[1];

function footprint(i: number) {
  const p = design.plan.placed[i]!, st = stats(design.stacks[p.stack]!);
  return { p, w: Math.max(0.6, st.width), d: Math.max(0.5, st.depth), yaw: (p.yaw * Math.PI) / 180 };
}
const handleAt = (i: number) => { const { p, yaw } = footprint(i); return { x: p.x + Math.sin(yaw) * 3, z: p.z + Math.cos(yaw) * 3 }; };

function drawPlan() {
  const { c, w, h } = sized(planCv);
  const { stage, floor } = design.plan;
  const x0 = -floor.w / 2 - 3, x1 = floor.w / 2 + 3, z0 = -stage.d - 1.5, z1 = floor.d + 1;
  const s = Math.min((w - 20) / (x1 - x0), (h - 60) / (z1 - z0));
  planView = { x0, z0, s, ox: (w - (x1 - x0) * s) / 2, oy: 12 };
  c.clearRect(0, 0, w, h);
  // the floor, shaded by level against its middle
  const g = band === "high" ? heat.high : heat.low, mid = band === "high" ? heat.tops.mean : heat.bass;
  const cw = floor.w / heat.nx, cd = (floor.d - 0.5) / heat.nz;
  for (let iz = 0; iz < heat.nz; iz++) for (let ix = 0; ix < heat.nx; ix++) {
    const a = P(-floor.w / 2 + ix * cw, 0.5 + iz * cd);
    c.fillStyle = shade(g[iz * heat.nx + ix]! - mid); c.globalAlpha = 0.55;
    c.fillRect(a.px, a.py, cw * s + 0.5, cd * s + 0.5);
  }
  c.globalAlpha = 1;
  const f0 = P(-floor.w / 2, 0), st0 = P(-stage.w / 2, -stage.d);
  c.strokeStyle = "rgba(247,243,234,.5)"; c.setLineDash([5, 5]); c.strokeRect(f0.px, f0.py, floor.w * s, floor.d * s); c.setLineDash([]);
  c.fillStyle = "#2b2622"; c.fillRect(st0.px, st0.py, stage.w * s, stage.d * s);
  c.strokeStyle = "#f7f3ea"; c.lineWidth = 2; c.strokeRect(st0.px, st0.py, stage.w * s, stage.d * s);
  const booth = P(-1.2, -1.6);
  c.fillStyle = "#3a332c"; c.fillRect(booth.px, booth.py, 2.4 * s, 0.8 * s);
  c.fillStyle = "#f7f3ea"; c.font = "400 15px Permanent Marker, cursive"; c.textAlign = "center";
  c.fillText("STAGE", P(0, -stage.d / 2 - 0.4).px, P(0, -stage.d / 2 - 0.4).py);
  c.font = "700 11px Courier Prime, monospace"; c.fillText("booth", P(0, -1.2).px, P(0, -1.2).py);
  c.fillText(`dance floor ${floor.w} x ${floor.d} m`, P(0, floor.d - 0.6).px, P(0, floor.d - 0.6).py);

  design.plan.placed.forEach((_, i) => {
    const { p, w: fw, d: fd, yaw } = footprint(i), at = P(p.x, p.z), stk = design.stacks[p.stack]!;
    const topBox = settle(stk.boxes).filter((b) => role(b.gear) === "top").at(-1);
    const cov = topBox ? (gear(topBox.gear).speaker!.coverage.h * Math.PI) / 360 : 0;
    c.save(); c.translate(at.px, at.py); c.rotate(-yaw);
    if (cov) { // the top's pattern, out to 8 m
      c.fillStyle = "rgba(255,91,26,.12)"; c.beginPath(); c.moveTo(0, 0);
      c.arc(0, 0, 8 * s, Math.PI / 2 - cov, Math.PI / 2 + cov); c.closePath(); c.fill();
    }
    c.fillStyle = "#1d1d23"; c.strokeStyle = i === picked ? "#ff5b1a" : "#f7f3ea"; c.lineWidth = i === picked ? 3 : 1.5;
    c.fillRect(-(fw * s) / 2, -(fd * s) / 2, fw * s, fd * s); c.strokeRect(-(fw * s) / 2, -(fd * s) / 2, fw * s, fd * s);
    c.fillStyle = "#e0a92e"; c.fillRect(-(fw * s) / 2, (fd * s) / 2 - 3, fw * s, 3); // its front
    c.restore();
    const hd = P(handleAt(i).x, handleAt(i).z);
    c.strokeStyle = "rgba(255,91,26,.8)"; c.lineWidth = 1.5; c.beginPath(); c.moveTo(at.px, at.py); c.lineTo(hd.px, hd.py); c.stroke();
    c.fillStyle = "#ff5b1a"; c.beginPath(); c.arc(hd.px, hd.py, 8, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#f7f3ea"; c.font = "700 12px Courier Prime, monospace"; c.fillText(stk.name.slice(0, 14), at.px, at.py - (fd * s) / 2 - 18);
  });
}

function hitPlan(px: number, py: number): PlanDrag | null {
  for (let i = design.plan.placed.length - 1; i >= 0; i--) {
    const hd = P(handleAt(i).x, handleAt(i).z);
    if (Math.hypot(px - hd.px, py - hd.py) < 16) return { i, mode: "aim", dx: 0, dz: 0 };
  }
  const w = W(px, py);
  for (let i = design.plan.placed.length - 1; i >= 0; i--) {
    const { p, w: fw, d: fd, yaw } = footprint(i), dx = w.x - p.x, dz = w.z - p.z;
    const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw), lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    if (Math.abs(lx) <= fw / 2 + 0.3 && Math.abs(lz) <= fd / 2 + 0.3) return { i, mode: "move", dx, dz };
  }
  return null;
}

planCv.addEventListener("pointerdown", (e) => {
  const r = planCv.getBoundingClientRect(), hit = hitPlan(e.clientX - r.left, e.clientY - r.top);
  picked = hit?.i ?? null;
  if (!hit) return draw();
  e.preventDefault();
  undo.push(JSON.stringify(design));
  pdrag = hit;
  planCv.setPointerCapture(e.pointerId);
  draw();
});
planCv.addEventListener("pointermove", (e) => {
  if (!pdrag) return;
  const r = planCv.getBoundingClientRect(), w = W(e.clientX - r.left, e.clientY - r.top), p = design.plan.placed[pdrag.i]!;
  if (pdrag.mode === "aim") p.yaw = aimAt(p.x, p.z, w.x, w.z);
  else { p.x = snap(w.x - pdrag.dx, 0.1); p.z = snap(w.z - pdrag.dz, 0.1); }
  p.x = Math.round(p.x * 10) / 10; p.z = Math.round(p.z * 10) / 10;
  drawPlan();
});
const endPlan = () => {
  if (!pdrag) return;
  pdrag = null;
  change(() => {}, false); // the step was taken when the drag began
};
planCv.addEventListener("pointerup", endPlan);
planCv.addEventListener("pointercancel", endPlan);

// ---- the box list, tabs and card --------------------------------------------------------------------------------
function chips() {
  const box = $("boxes");
  box.replaceChildren();
  let last: Role | null = null;
  for (const id of PALETTE) {
    const r = role(id), g = gear(id);
    if (r !== last) { const h = document.createElement("h3"); h.textContent = ROLE_NAME[r]; box.append(h); last = r; }
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.title = `Drag the ${g.what} onto the stack, or tap to put it on top`;
    const cv = document.createElement("canvas");
    cv.width = 108; cv.height = 80;
    const c = cv.getContext("2d")!, k = Math.min(96 / g.size.w, 70 / g.size.h);
    face(c, id, { x: (108 - g.size.w * k) / 2, y: (80 - g.size.h * k) / 2, w: g.size.w * k, h: g.size.h * k });
    const t = document.createElement("span");
    t.innerHTML = `<b></b><small></small>`;
    t.querySelector("b")!.textContent = g.what;
    t.querySelector("small")!.textContent = `${g.kg} kg · ${Math.round(g.size.h * 100)} cm`;
    b.append(cv, t);
    b.addEventListener("pointerdown", (e) => startDrag(e, id, "list"));
    b.addEventListener("pointercancel", () => { drag = null; draw(); }); // the strip scrolled instead (phones)
    box.append(b);
  }
}

function tabs() {
  const t = $("tabs");
  t.replaceChildren(...design.stacks.map((s, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = s.name || `Stack ${i + 1}`; b.className = i === current ? "on" : "";
    b.onclick = () => { current = i; draw(); };
    return b;
  }));
  const add = document.createElement("button");
  add.type = "button"; add.textContent = "+ Stack"; add.title = "A new, empty stack";
  add.onclick = () => change(() => { design.stacks.push({ name: `Stack ${design.stacks.length + 1}`, boxes: [] }); current = design.stacks.length - 1; });
  t.append(add);
}

const fmt = (v: number | null, unit = "dB") => (v === null ? "none" : `${v} ${unit}`);
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", cls = "") {
  const e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; return e;
}
function dl(rows: [string, string, string?][]) {
  const d = el("dl");
  for (const [k, v, cls] of rows) d.append(el("dt", k), el("dd", v, `num ${cls ?? ""}`));
  return d;
}

function stackCard() {
  const card = $("card"), s = stack(), st = stats(s, depth()), r = rig(($<HTMLSelectElement>("rig")).value), want = sizeFor(r, depth());
  const name = el("input");
  name.value = s.name; name.setAttribute("aria-label", "Stack name"); name.maxLength = 40;
  name.onchange = () => change(() => (s.name = name.value.trim() || "Stack"));
  const ul = el("ul");
  for (const w of st.warnings) ul.append(el("li", w.text, "warn"));
  if (!st.warnings.length && st.boxes) ul.append(el("li", "Stands up straight, tops on top.", "pass"));
  const build = el("button", `Build ${r.name.toLowerCase()} for ${depth()} m`);
  build.onclick = () => change(() => (design.stacks[current] = { ...wallFor(r, depth()), name: s.name }));
  const row = el("div"); row.className = "row"; row.append(build);
  if (design.stacks.length > 1) {
    const del = el("button", "Delete stack");
    del.onclick = () => change(() => {
      design.stacks.splice(current, 1);
      design.plan.placed = design.plan.placed.filter((p) => p.stack !== current).map((p) => ({ ...p, stack: p.stack > current ? p.stack - 1 : p.stack }));
    });
    row.append(del);
  }
  card.replaceChildren(
    name,
    dl([
      ["Layers", `${st.layers}`], ["Bass, mid, top", `${st.count.sub}, ${st.count.mid}, ${st.count.top}`],
      ["Size", `${st.width} x ${st.height} m`], ["Weight", `${st.kg} kg`], ["Amp channels", `${st.channels}`],
      ["Bass at 1 m", fmt(st.low1m)], ["Tops at 1 m", fmt(st.high1m)],
      [`Bass at ${depth()} m`, fmt(st.back.low), st.back.lowOk ? "pass" : "warn"], [`Tops at ${depth()} m`, fmt(st.back.high), st.back.highOk ? "pass" : "warn"],
      ["Goes down to", fmt(st.lowCut, "Hz")], ["Pattern", st.pattern ? `${st.pattern.h} x ${st.pattern.v} deg` : "none"],
    ]),
    ul,
    el("p", `A ${depth()} m floor wants ${TARGET.low} dB of bass and ${TARGET.high} dB of tops at the back: the ${r.name.toLowerCase()} gets there with ${want.subs} ${want.subs === 1 ? "bin" : "bins"} and ${want.tops} ${want.tops === 1 ? "top" : "tops"} a side.`),
    row,
  );
}

function stageCard() {
  const card = $("card"), { plan } = design;
  const num = (label: string, v: number, set: (n: number) => void, lo: number, hi: number) => {
    const l = el("label", `${label} `), i = el("input");
    i.type = "number"; i.min = `${lo}`; i.max = `${hi}`; i.value = `${v}`;
    i.style.cssText = "font:600 15px var(--pen);width:4.5em;border-bottom:1.5px dashed var(--ink-soft)";
    i.onchange = () => { const n = Number(i.value); if (n >= lo && n <= hi) change(() => set(n)); };
    l.append(i, " m"); return l;
  };
  const seg = el("div"); seg.className = "row";
  for (const [b, label] of [["high", "Tops"], ["low", "Bass 63 Hz"]] as const) {
    const btn = el("button", label); if (band === b) btn.style.outline = "3px solid var(--spot)";
    btn.onclick = () => { band = b; draw(); }; seg.append(btn);
  }
  const legend = el("div"); legend.className = "legend";
  for (const [d, col] of RAMP) { const sp = el("span", `${d > 0 ? "+" : ""}${d}`); sp.style.background = col; legend.append(sp); }
  const list = el("ul");
  plan.placed.forEach((p, i) => {
    const li = el("li"), sel = el("select");
    sel.style.cssText = "background:transparent;color:var(--ink);border:0;font:600 14px var(--pen);min-height:32px";
    design.stacks.forEach((s, k) => { const o = el("option", s.name); o.value = `${k}`; o.selected = k === p.stack; sel.append(o); });
    sel.onchange = () => change(() => (p.stack = Number(sel.value)));
    const rm = el("button", "Take off"); rm.style.minHeight = "32px";
    rm.onclick = () => change(() => { plan.placed.splice(i, 1); picked = null; });
    li.append(sel, ` at ${p.x}, ${p.z} m, ${p.yaw} deg `, rm);
    if (i === picked) li.style.fontWeight = "800";
    list.append(li);
  });
  const add = el("button", `Add ${stack().name}`);
  add.onclick = () => change(() => { plan.placed.push({ stack: current, x: 0, z: 1.5, yaw: 0 }); picked = plan.placed.length - 1; });
  const aim = el("button", "Aim all at the floor");
  aim.onclick = () => change(() => plan.placed.forEach((p) => (p.yaw = aimAt(p.x, p.z, 0, plan.floor.d / 2))));
  const row = el("div"); row.className = "row"; row.append(add, aim);
  card.replaceChildren(
    el("h2", "On the floor"),
    dl([
      ["Tops, average", `${heat.tops.mean} dB`], ["Tops spread", `${heat.tops.even} dB`, heat.tops.even <= EVEN.tops ? "pass" : "warn"],
      ["Bass spread", `${heat.lows.even} dB`, heat.lows.even <= EVEN.lows ? "pass" : "warn"],
      ["Back row tops", `${heat.back} dB`, heat.back >= TARGET.high - 3 ? "pass" : "warn"], ["Back row bass", `${heat.bass} dB`, heat.bass >= TARGET.low ? "pass" : "warn"],
    ]),
    seg, legend,
    el("p", band === "high" ? "Shade: tops against the floor's average level." : "Shade: bass at 63 Hz. Two stacks far apart make a loud alley down the middle and holes beside it."),
    num("Floor wide", plan.floor.w, (n) => (plan.floor.w = n), 4, 300), num("Stage wide", plan.stage.w, (n) => (plan.stage.w = n), 2, 80),
    el("h2", "Stacks"), list, row,
  );
}

// ---- header ----------------------------------------------------------------------------------------------------
const rigSel = $<HTMLSelectElement>("rig"), depthIn = $<HTMLInputElement>("depth");
for (const r of RIGS) { const o = el("option", r.name); o.value = r.id; o.title = r.about; rigSel.append(o); }
const premadeSel = $<HTMLSelectElement>("premade");
for (const p of PREMADES) { const o = el("option", p.name); o.value = p.id; o.title = p.about; premadeSel.append(o); }
premadeSel.onchange = () => { if (premadeSel.value) dropPremade(premadeSel.value); };
depthIn.value = `${depth()}`;
rigSel.onchange = () => draw();
depthIn.onchange = () => { const n = Number(depthIn.value); if (n >= 5 && n <= 120) change(() => (design.plan.floor.d = n)); };
$("go").onclick = () => doIt();
$("undo").onclick = () => {
  const prev = undo.pop();
  const d = prev && readDesign(JSON.parse(prev));
  if (!d) return;
  design = d; picked = null; heat = cover(design);
  try { localStorage.setItem(KEY, JSON.stringify(design)); } catch { /* no storage */ }
  draw();
};
$("v-stack").onclick = () => setView("stack");
$("v-stage").onclick = () => setView("stage");

function doIt(id = rigSel.value) {
  rigSel.value = rig(id).id;
  change(() => { design = justDoIt(rigSel.value, { w: design.plan.floor.w, d: depth() }); current = 0; picked = null; });
}
/** Drop premade `id` in whole, a stack each side on the floor it fills: the Stack pick and `stacker.premade` both. */
function dropPremade(id: string) {
  const p = premade(id);
  premadeSel.value = p.id; rigSel.value = rig(p.rig ?? p.id).id;
  change(() => { design = usePremade(p.id, design.plan.floor.w); current = 0; picked = null; });
}
function setView(v: typeof view) {
  view = v;
  $("v-stack").classList.toggle("on", v === "stack"); $("v-stage").classList.toggle("on", v === "stage");
  $("stackView").hidden = v !== "stack"; $("boxes").hidden = v !== "stack"; $("stageView").hidden = v !== "stage";
  $("main").className = v;
  draw();
}

let queued = false;
function draw() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    depthIn.value = `${depth()}`;
    if (view === "stack") { tabs(); drawFront(); stackCard(); } else { drawPlan(); stageCard(); }
  });
}
new ResizeObserver(() => draw()).observe(document.body);
chips();
setView("stack");

// ---- window.stacker ------------------------------------------------------------------------------------------
const api = {
  state: () => ({
    view, band, current, rig: rigSel.value, premade: premadeSel.value || null,
    stacks: design.stacks.map((s) => ({ name: s.name, boxes: s.boxes, stats: stats(s, depth()) })),
    plan: design.plan,
    floor: { mean: heat.tops.mean, even: heat.tops.even, bassMean: heat.lows.mean, bassEven: heat.lows.even, back: heat.back, bass: heat.bass },
  }),
  justDoIt: (id?: string) => { doIt(id); return api.state(); },
  /** The premade stacks to start from (gear's PREMADES), and one dropped in whole. */
  premades: () => PREMADES.map((p) => ({ id: p.id, name: p.name, about: p.about })),
  premade: (id: string) => { dropPremade(id); return api.state(); },
  build: (id: string) => { rigSel.value = rig(id).id; change(() => (design.stacks[current] = wallFor(rig(id), depth()))); return api.state(); },
  add: (id: string, x = 0, y = 99) => { gear(id); change(() => stack().boxes.push({ gear: id, x, y })); return api.state(); },
  remove: (i: number) => { change(() => stack().boxes.splice(i, 1)); return api.state(); },
  pick: (i: number) => { current = Math.max(0, Math.min(design.stacks.length - 1, i)); draw(); return api.state(); },
  newStack: (name = `Stack ${design.stacks.length + 1}`) => { change(() => { design.stacks.push({ name, boxes: [] }); current = design.stacks.length - 1; }); return api.state(); },
  place: (stackIndex: number, x: number, z: number, yaw?: number) => {
    change(() => design.plan.placed.push({ stack: stackIndex, x, z, yaw: yaw ?? aimAt(x, z, 0, depth() / 2) })); return api.state();
  },
  move: (i: number, x: number, z: number, yaw?: number) => {
    change(() => { const p = design.plan.placed[i]!; p.x = x; p.z = z; if (yaw !== undefined) p.yaw = yaw; }); return api.state();
  },
  unplace: (i: number) => { change(() => design.plan.placed.splice(i, 1)); return api.state(); },
  floor: (w: number, d: number) => { change(() => (design.plan.floor = { w, d })); return api.state(); },
  pair: () => { change(() => (design.plan = planFor([current, current], design.plan.stage, design.plan.floor))); return api.state(); },
  view: (v: typeof view, b?: typeof band) => { if (b) band = b; setView(v); return api.state(); },
  undo: () => { $("undo").click(); return api.state(); },
};
Object.assign(window, { stacker: api });
