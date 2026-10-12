// The pen: a token-cheap drawing language for text-model fighters (#985). One command a line,
// shapes named so a later line can point at them ("head.top") instead of doing the sums. The code
// here turns pen text into draw ops against the fighter's current scene. Every line runs through
// applyOps as it's read, so an anchor sees where a shape actually landed after clamping, and a bad
// line is skipped with a reason instead of sinking the turn. No I/O.

import { COLORS } from "./brain.ts";
import { DEFAULT_LIMITS, applyOps, bboxOf } from "./ops.ts";
import { isLinear, type Bounds, type Op, type Scene, type SkeletonEl } from "./types.ts";

/** Drawing lines a turn. `look` and `done` don't count. */
export const PEN_LINES = 8;

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const NAME = /^[A-Za-z_][\w-]*$/;
const ANCHOR = /^([A-Za-z_][\w-]*)\.(top|bottom|left|right|c)(?:([+-]\d*\.?\d+)(?:,([+-]?\d*\.?\d+))?)?$/;
const SHAPES = new Set(["o", "b", "d", "p", "l", "t"]);
const EDITS = new Set(["mv", "sz", "fill", "rm", "up"]);
const OUTLINE = "#1e1e1e";
const NAME_OF = Object.fromEntries(Object.entries(COLORS).map(([k, v]) => [v, k]));
// Colours models reach for that aren't on the card. Cheaper to take them than to skip the line.
const MORE_COLORS: Record<string, string> = { pink: "#f783ac", brown: "#8b5a2b", grey: "#868e96", gray: "#868e96" };
const BARE = /^-?\d*\.?\d+$/;

/** The tool card: the whole of what a fighter is told about the pen, about 200 tokens. */
export function penCard(region: Pick<Bounds, "w" | "h">, canLook: boolean): string {
  return `EXCALIDRAW PEN · canvas ${region.w}×${region.h}, x right, y down · one command per line · later lines draw on top
Shapes, named so you can refer back to them (X Y is the centre):
  o NAME X Y W H COLOR      ellipse
  b NAME X Y W H COLOR      box
  d NAME X Y W H COLOR      diamond
  p NAME COLOR X,Y X,Y …    filled polygon (ears, hats, beaks, roofs)
  l NAME COLOR X,Y X,Y …    stroke (tails, arms, smiles, hair)
  t NAME X Y SIZE words…    text
Anywhere a point goes you can anchor to a shape instead: NAME.top .bottom .left .right .c
  with an optional nudge: head.top-30,10 = 30 left and 10 down from the top of head
Edit: mv NAME DX DY · sz NAME W H · fill NAME COLOR · rm NAME · up NAME (to front) · a name drawn again is redrawn
Colours: black red green blue orange purple yellow white, or #hex. Outlines are black.
${canLook ? "look → see your canvas before your next turn · " : ""}done → you're finished
Up to ${PEN_LINES} lines a turn. Shapes stay from turn to turn, as many as you like.`;
}

export interface PenSkip {
  line: string;
  reason: string;
}

export interface PenResult {
  scene: Scene;
  /** The ops that applied, in order. */
  ops: Op[];
  skipped: PenSkip[];
  /** Drawing lines that applied, and how many of those were edits or redraws of an existing shape. */
  lines: number;
  edits: number;
  look: boolean;
  done: boolean;
}

/**
 * Draw one turn of pen text. `prefix` keeps each fighter's ids apart on a shared scene; pen
 * coordinates are the fighter's own, from the top-left of `region`.
 */
export function penTurn(text: string, prev: Scene, region: Bounds, prefix: string): PenResult {
  const r: PenResult = { scene: prev, ops: [], skipped: [], lines: 0, edits: 0, look: false, done: false };
  let tried = 0;
  for (const raw of text.split("\n")) {
    if (raw.trim().startsWith("```")) continue;
    const line = raw.trim().replace(/^[-*>]\s+/, "").replace(/^`|`$/g, "").trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const words = line.split(/\s+/);
    const cmd = words[0]!.toLowerCase();
    if (cmd === "look" && words.length === 1) { r.look = true; continue; }
    if (cmd === "done" && words.length === 1) { r.done = true; continue; }
    if (!SHAPES.has(cmd) && !EDITS.has(cmd)) {
      r.skipped.push({ line, reason: `unknown command "${words[0]}"` });
      continue;
    }
    if (++tried > PEN_LINES) {
      r.skipped.push({ line, reason: `over the ${PEN_LINES}-line cap` });
      continue;
    }
    try {
      const { ops, edit } = lineOps(cmd, words.slice(1), r.scene, region, prefix);
      const out = applyOps(r.scene, ops, region, { ...DEFAULT_LIMITS, maxOpsPerTurn: ops.length });
      if (out.rejected.length) throw new Error(out.rejected[0]!.reason);
      r.scene = out.scene;
      r.ops.push(...out.applied);
      r.lines++;
      if (edit) r.edits++;
    } catch (e) {
      r.skipped.push({ line, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return r;
}

function lineOps(cmd: string, args: string[], scene: Scene, region: Bounds, prefix: string): { ops: Op[]; edit: boolean } {
  const name = args[0] ?? "";
  if (!NAME.test(name)) throw new Error(name ? `bad name "${name}"` : "missing name");
  const id = prefix + name;
  const cur = scene.get(id);
  if (EDITS.has(cmd)) {
    if (!cur) throw new Error(`no shape named ${name}`);
    return { ops: editOps(cmd, args.slice(1), cur), edit: true };
  }
  const el = shapeOf(cmd, id, args.slice(1), scene, region, prefix);
  // A name drawn again is redrawn: the old one goes and the new one lands on top.
  return { ops: cur ? [{ op: "delete", id }, { op: "add", element: el }] : [{ op: "add", element: el }], edit: !!cur };
}

function shapeOf(cmd: string, id: string, args: string[], scene: Scene, region: Bounds, prefix: string): SkeletonEl {
  const pt = (s: string) => point(s, scene, region, prefix);
  if (cmd === "p" || cmd === "l") {
    const fill = colour(args[0]);
    const pts = points(args.slice(1), pt);
    if (pts.length < (cmd === "p" ? 3 : 2)) throw new Error(cmd === "p" ? "a polygon needs 3 points" : "a stroke needs 2 points");
    const [x, y] = pts[0]!;
    const rel = pts.map(([px, py]) => [px - x, py - y] as [number, number]);
    return cmd === "p"
      ? { id, type: "line", x, y, points: [...rel, [0, 0]], strokeColor: OUTLINE, backgroundColor: fill, fillStyle: "solid" }
      : { id, type: "line", x, y, points: rel, strokeColor: fill, strokeWidth: 4 };
  }
  const [cx, cy, rest] = position(args, scene, region, prefix);
  if (cmd === "t") {
    const size = Math.min(96, Math.max(8, number(rest[0])));
    const text = rest.slice(1).join(" ");
    if (!text) throw new Error("no words");
    const box = bboxOf({ id, type: "text", x: 0, y: 0, text, fontSize: size });
    return { id, type: "text", x: cx - box.w / 2, y: cy - box.h / 2, text, fontSize: size, strokeColor: OUTLINE };
  }
  // W H, or W,H as one word.
  const size = rest[0]?.includes(",") ? [...rest[0].split(","), ...rest.slice(1)] : rest;
  const w = Math.abs(number(size[0])), h = Math.abs(number(size[1]));
  if (!w || !h) throw new Error("W and H must be more than 0");
  const fill = colour(size[2]);
  const type = cmd === "o" ? "ellipse" : cmd === "b" ? "rectangle" : "diamond";
  return { id, type, x: cx - w / 2, y: cy - h / 2, width: w, height: h, strokeColor: OUTLINE, backgroundColor: fill, fillStyle: "solid" };
}

function editOps(cmd: string, args: string[], el: SkeletonEl): Op[] {
  const id = el.id;
  switch (cmd) {
    case "mv":
      return [{ op: "update", id, patch: { x: el.x + number(args[0]), y: el.y + number(args[1]) } }];
    case "sz": {
      const w = Math.abs(number(args[0])), h = Math.abs(number(args[1]));
      if (!w || !h) throw new Error("W and H must be more than 0");
      const b = bboxOf(el);
      const [cx, cy] = [b.x + b.w / 2, b.y + b.h / 2];
      if (el.type === "text") return [{ op: "update", id, patch: { fontSize: Math.min(96, Math.max(8, h)) } }];
      if (isLinear(el)) {
        // Scale the points about the shape's centre; a flat side stays flat.
        const sx = b.w ? w / b.w : 1, sy = b.h ? h / b.h : 1;
        const abs = el.points.map(([px, py]) => [cx + (el.x + px - cx) * sx, cy + (el.y + py - cy) * sy] as [number, number]);
        const [x, y] = abs[0]!;
        return [{ op: "update", id, patch: { x, y, points: abs.map(([px, py]) => [px - x, py - y] as [number, number]) } }];
      }
      return [{ op: "update", id, patch: { x: cx - w / 2, y: cy - h / 2, width: w, height: h } }];
    }
    case "fill": {
      const hex = colour(args[0]);
      // A stroke (no fill) and text are their stroke colour; everything else keeps its black outline.
      const patch = el.type === "text" || (isLinear(el) && !el.backgroundColor) ? { strokeColor: hex } : { backgroundColor: hex };
      return [{ op: "update", id, patch }];
    }
    case "rm":
      return [{ op: "delete", id }];
    default: // up: to the front, which is the end of the scene
      return [{ op: "delete", id }, { op: "add", element: el }];
  }
}

/** X Y as two numbers, or one point token (X,Y or an anchor). Returns the absolute point and the words left. */
function position(args: string[], scene: Scene, region: Bounds, prefix: string): [number, number, string[]] {
  const first = args[0] ?? "";
  if ((first.includes(".") && /[A-Za-z]/.test(first)) || first.includes(",")) {
    const [x, y] = point(first, scene, region, prefix);
    return [x, y, args.slice(1)];
  }
  return [region.x + number(args[0]), region.y + number(args[1]), args.slice(2)];
}

/** Point words: X,Y or an anchor each, or X Y as two bare numbers. */
function points(words: string[], pt: (s: string) => [number, number]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (BARE.test(w)) {
      const y = words[++i];
      if (y === undefined || !BARE.test(y)) throw new Error(`bad point "${w}"`);
      out.push(pt(`${w},${y}`));
    } else out.push(pt(w));
  }
  return out;
}

function point(s: string, scene: Scene, region: Bounds, prefix: string): [number, number] {
  const a = ANCHOR.exec(s);
  if (a) {
    const el = scene.get(prefix + a[1]);
    if (!el) throw new Error(`no shape named ${a[1]}`);
    const b = bboxOf(el);
    const [x, y] =
      a[2] === "top" ? [b.x + b.w / 2, b.y]
      : a[2] === "bottom" ? [b.x + b.w / 2, b.y + b.h]
      : a[2] === "left" ? [b.x, b.y + b.h / 2]
      : a[2] === "right" ? [b.x + b.w, b.y + b.h / 2]
      : [b.x + b.w / 2, b.y + b.h / 2];
    return [x + Number(a[3] ?? 0), y + Number(a[4] ?? 0)];
  }
  const m = /^(-?\d*\.?\d+),(-?\d*\.?\d+)$/.exec(s);
  if (!m) throw new Error(`bad point "${s}"`);
  return [region.x + Number(m[1]), region.y + Number(m[2])];
}

function number(s: string | undefined): number {
  const n = Number(s);
  if (s === undefined || s === "" || !Number.isFinite(n)) throw new Error(s === undefined ? "missing a number" : `bad number "${s}"`);
  return n;
}

function colour(s: string | undefined): string {
  if (!s) throw new Error("missing colour");
  const hex = COLORS[s.toLowerCase()] ?? MORE_COLORS[s.toLowerCase()] ?? (HEX.test(s) ? s : undefined);
  if (!hex) throw new Error(`unknown colour "${s}"`);
  return hex;
}

/** A fighter's shapes written back as pen lines, so it can see its names and where things are. */
export function penScene(scene: Scene, region: Bounds, prefix: string): string {
  const r = (n: number) => Math.round(n);
  const col = (hex?: string) => (hex ? NAME_OF[hex] ?? hex : "black");
  const out: string[] = [];
  for (const el of scene.values()) {
    if (!el.id.startsWith(prefix)) continue;
    const name = el.id.slice(prefix.length);
    const at = (x: number, y: number) => `${r(x - region.x)},${r(y - region.y)}`;
    if (isLinear(el)) {
      const filled = !!el.backgroundColor;
      const pts = filled && el.points.length > 3 ? el.points.slice(0, -1) : el.points;
      out.push(`${filled ? "p" : "l"} ${name} ${col(filled ? el.backgroundColor : el.strokeColor)} ${pts.map(([px, py]) => at(el.x + px, el.y + py)).join(" ")}`);
    } else {
      const b = bboxOf(el);
      const [cx, cy] = [r(b.x + b.w / 2 - region.x), r(b.y + b.h / 2 - region.y)];
      if (el.type === "text") out.push(`t ${name} ${cx} ${cy} ${el.fontSize ?? 20} ${el.text}`);
      else out.push(`${el.type === "ellipse" ? "o" : el.type === "rectangle" ? "b" : "d"} ${name} ${cx} ${cy} ${r(b.w)} ${r(b.h)} ${col(el.backgroundColor)}`);
    }
  }
  return out.join("\n");
}
