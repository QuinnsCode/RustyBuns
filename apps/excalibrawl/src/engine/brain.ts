// The fighter's brain: Clef, Cloudflare's decision model. It never writes JSON or text.
// Each turn it looks at its own canvas and answers a handful of typed questions (what to
// do, to which shape, what shape, what colour, where on a grid, how big), and the code
// here turns those answers into one draw op. Clef bills input tokens only, and a turn is a
// ~75-token picture plus the questions, ~1,000 tokens in all, so a whole fight is about two cents.

import { PALETTE } from "./ops.ts";
import { isLinear, type Bounds, type BoxEl, type LinearEl, type Op, type SkeletonEl } from "./types.ts";

export const ACTIONS = {
  add: "Add a new shape",
  move: "Move one shape somewhere better",
  recolor: "Recolour one shape",
  resize: "Resize or reshape one shape",
  delete: "Delete one shape that hurts the drawing",
  restart: "Scrap the whole drawing and start over (only worth it if it's going badly)",
} as const;
export type Action = keyof typeof ACTIONS;

export const SHAPES = {
  ellipse: "Ellipse: heads, bodies, wheels, clouds",
  rectangle: "Rectangle: buildings, boxes, screens, limbs",
  diamond: "Diamond: gems, kites, signs",
  triangle: "Triangle: ears, hats, roofs, spikes, beaks",
  stroke: "Curved stroke: arms, tails, smiles, hair",
  dot: "Small solid dot: eyes, buttons, spots",
} as const;
export type ShapeKind = keyof typeof SHAPES;

const COLORS: Record<string, string> = {
  black: "#1e1e1e",
  red: "#e03131",
  green: "#2f9e44",
  blue: "#1971c2",
  orange: "#f08c00",
  purple: "#9c36b5",
  yellow: "#ffec99",
  white: "#ffffff",
};
const COLOR_HEX = Object.fromEntries(Object.entries(COLORS).map(([k, v]) => [v, k]));
if (Object.keys(COLORS).length !== PALETTE.length) throw new Error("palette drifted");

const SIZES = ["tiny detail", "small", "medium", "large", "fills most of the canvas"];
/** Each size level as a fraction of the region's short side. */
const SIZE_FRACTION = [0.05, 0.12, 0.25, 0.45, 0.75];
const ASPECTS = { tall: "Taller than wide", square: "About as wide as tall", wide: "Wider than tall" } as const;
type Aspect = keyof typeof ASPECTS;

/** Turns in the first part of a fight, when starting over is still on the table. */
export const RESTART_UNTIL = 0.35;

export interface Grid {
  cols: number;
  rows: number;
}

/** About 12 cells along the long side, square cells. */
export function gridFor(region: Bounds): Grid {
  const cell = Math.max(region.w, region.h) / 12;
  return { cols: Math.max(2, Math.round(region.w / cell)), rows: Math.max(2, Math.round(region.h / cell)) };
}

/** What the fighter decided, after sampling Clef's probabilities. Logged with every op. */
export interface Decision {
  action: Action;
  target?: string;
  shape: ShapeKind;
  color: string;
  col: number;
  row: number;
  /** 0 (tiny) to 4 (huge), can land between levels. */
  size: number;
  aspect: Aspect;
}

export interface TurnInput {
  prompt: string;
  turn: number;
  turns: number;
  scene: SkeletonEl[];
  region: Bounds;
  /** The fighter's canvas as a PNG data URL (see raster.ts). */
  image: string;
  persona?: string;
}

const where = (el: SkeletonEl, region: Bounds, g: Grid) => {
  const [cx, cy] = center(el);
  const col = Math.floor(((cx - region.x) / region.w) * g.cols) + 1, row = Math.floor(((cy - region.y) / region.h) * g.rows) + 1;
  return `col ${clampInt(col, 1, g.cols)} row ${clampInt(row, 1, g.rows)}`;
};

function describe(el: SkeletonEl, region: Bounds, g: Grid): string {
  const color = COLOR_HEX[el.backgroundColor ?? ""] ?? COLOR_HEX[el.strokeColor ?? ""] ?? "outlined";
  const kind = el.type === "line" ? (el.points.length > 3 ? "triangle" : "stroke") : el.type;
  const [w, h] = sizeOf(el);
  const big = Math.max(w, h) / Math.min(region.w, region.h);
  const size = big < 0.08 ? "tiny" : big < 0.2 ? "small" : big < 0.35 ? "medium" : big < 0.6 ? "large" : "huge";
  return `${size} ${color} ${kind} at ${where(el, region, g)}`;
}

/** Which actions make sense now: nothing to edit on an empty canvas, no starting over late. */
export function actionsFor(t: Pick<TurnInput, "scene" | "turn" | "turns">): Action[] {
  if (!t.scene.length) return ["add"];
  const out: Action[] = ["add", "move", "recolor", "resize", "delete"];
  if (t.scene.length >= 3 && t.turn / t.turns <= RESTART_UNTIL) out.push("restart");
  return out;
}

/** The Workers AI input for one turn. */
export function clefRequest(model: "clef" | "clef-flash", t: TurnInput) {
  const g = gridFor(t.region);
  const actions = actionsFor(t);
  const scene = t.scene.map((el) => `${el.id}: ${describe(el, t.region, g)}`).join("; ");
  const state = [
    `You are an artist in EXCALIBRAWL, a live drawing fight. Draw "${t.prompt}" on the canvas in the image, one move per turn.`,
    t.persona && `Your style: ${t.persona}.`,
    `Turn ${t.turn} of ${t.turns}.`,
    `How to draw well: big body shapes first, then details on top. Bold colour fills, a clear silhouette someone can name, black dots for eyes. A few confident shapes beat many timid ones.`,
    `The canvas is a grid of ${g.cols} columns (1 = left) by ${g.rows} rows (1 = top). Shapes so far, bottom first: ${scene || "none, it's blank"}.`,
  ].filter(Boolean).join("\n");

  const questions: Record<string, unknown> = {
    shape: { type: "choice", instructions: "If you add a shape, which kind?", criteria: SHAPES },
    color: { type: "choice", instructions: "Which colour for the new or changed shape?", criteria: Object.fromEntries(Object.keys(COLORS).map((c) => [c, null])) },
    col: { type: "choice", instructions: "Which column should its centre be in?", criteria: Object.fromEntries(Array.from({ length: g.cols }, (_, i) => [`c${i + 1}`, `column ${i + 1}`])) },
    row: { type: "choice", instructions: "Which row should its centre be in?", criteria: Object.fromEntries(Array.from({ length: g.rows }, (_, i) => [`r${i + 1}`, `row ${i + 1}`])) },
    size: { type: "score", instructions: "How big should it be?", criteria: SIZES },
    aspect: { type: "choice", instructions: "What proportions? For a stroke: tall is up-down, wide is side to side, square is diagonal.", criteria: ASPECTS },
  };
  if (actions.length > 1) questions.action = { type: "choice", instructions: "What is the best move for the drawing right now?", criteria: Object.fromEntries(actions.map((a) => [a, ACTIONS[a]])) };
  if (t.scene.length) questions.target = { type: "choice", instructions: "If you move, recolour, resize or delete, which shape?", criteria: Object.fromEntries(t.scene.map((el) => [el.id, describe(el, t.region, g)]).concat([["none", "No existing shape"]])) };

  return { model, state, images: [t.image], questions };
}

// --- answers -----------------------------------------------------------------

type Answer = { choice?: unknown; score?: unknown; probabilities?: Record<string, number> };

/** Sample an option from Clef's probabilities, sharpened by `temperature` (0 = always the top pick). */
export function sample(a: Answer | undefined, options: string[], temperature: number, rand: () => number): string | undefined {
  const p = a?.probabilities;
  if (!p || temperature <= 0) return typeof a?.choice === "string" && options.includes(a.choice) ? a.choice : undefined;
  const w = options.map((o) => Math.pow(Math.max(0, p[o] ?? 0), 1 / temperature));
  const total = w.reduce((x, y) => x + y, 0);
  if (!(total > 0)) return typeof a?.choice === "string" && options.includes(a.choice) ? a.choice : undefined;
  let r = rand() * total;
  for (let i = 0; i < options.length; i++) if ((r -= w[i]!) <= 0) return options[i];
  return options[options.length - 1];
}

/** Clef's answers as a decision. Throws when they don't fit what we asked. */
export function decide(res: unknown, t: TurnInput, temperature = 0.7, rand: () => number = Math.random): Decision {
  const answers = (res as { answers?: Record<string, Answer> })?.answers;
  if (!answers) throw new Error("no answers");
  const g = gridFor(t.region);
  const actions = actionsFor(t);
  const pick = (q: string, options: string[]) => sample(answers[q], options, temperature, rand);

  const action = (actions.length > 1 ? pick("action", actions) : "add") as Action | undefined;
  const target = t.scene.length ? pick("target", t.scene.map((e) => e.id).concat("none")) : undefined;
  const shape = pick("shape", Object.keys(SHAPES)) as ShapeKind | undefined;
  const color = pick("color", Object.keys(COLORS));
  const col = pick("col", Array.from({ length: g.cols }, (_, i) => `c${i + 1}`));
  const row = pick("row", Array.from({ length: g.rows }, (_, i) => `r${i + 1}`));
  const aspect = pick("aspect", Object.keys(ASPECTS)) as Aspect | undefined;
  const size = typeof answers.size?.score === "number" ? answers.size.score : NaN;
  if (!action || !shape || !color || !col || !row || !aspect || !Number.isFinite(size)) throw new Error("answers don't fit the questions");
  return { action, target: target === "none" ? undefined : target, shape, color, col: +col.slice(1), row: +row.slice(1), size: Math.max(0, Math.min(4, size)), aspect };
}

// --- decision -> ops -----------------------------------------------------------

const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function sizeOf(el: SkeletonEl): [number, number] {
  if (isLinear(el)) {
    const xs = el.points.map((p) => p[0]), ys = el.points.map((p) => p[1]);
    return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  }
  if (el.type === "text") return [el.text.length * (el.fontSize ?? 20) * 0.6, el.fontSize ?? 20];
  return [el.width, el.height];
}

function center(el: SkeletonEl): [number, number] {
  if (isLinear(el)) {
    const xs = el.points.map((p) => p[0]), ys = el.points.map((p) => p[1]);
    return [el.x + (Math.max(...xs) + Math.min(...xs)) / 2, el.y + (Math.max(...ys) + Math.min(...ys)) / 2];
  }
  const [w, h] = sizeOf(el);
  return [el.x + w / 2, el.y + h / 2];
}

/** The decision's spot and size in canvas units. */
function placement(d: Decision, region: Bounds) {
  const g = gridFor(region);
  const cx = region.x + ((d.col - 0.5) / g.cols) * region.w;
  const cy = region.y + ((d.row - 0.5) / g.rows) * region.h;
  const lo = Math.floor(d.size), hi = Math.min(4, lo + 1);
  const f = SIZE_FRACTION[lo]! + (SIZE_FRACTION[hi]! - SIZE_FRACTION[lo]!) * (d.size - lo);
  const s = f * Math.min(region.w, region.h);
  const [w, h] = d.aspect === "tall" ? [s * 0.6, s] : d.aspect === "wide" ? [s, s * 0.6] : [s, s];
  return { cx, cy, w, h };
}

function makeShape(id: string, d: Decision, region: Bounds): SkeletonEl {
  const { cx, cy, w, h } = placement(d, region);
  const hex = COLORS[d.color]!;
  const style = { strokeColor: "#1e1e1e", backgroundColor: hex, fillStyle: "solid" as const };
  switch (d.shape) {
    case "dot": {
      const r = Math.max(6, Math.min(w, h) * 0.25);
      return { id, type: "ellipse", x: cx - r / 2, y: cy - r / 2, width: r, height: r, ...style, strokeColor: hex };
    }
    case "triangle":
      return { id, type: "line", x: cx, y: cy - h / 2, points: [[0, 0], [w / 2, h], [-w / 2, h], [0, 0]], ...style };
    case "stroke": {
      // A gentle curve through the centre, in the aspect's direction.
      const [dx, dy] = d.aspect === "tall" ? [0, h] : d.aspect === "wide" ? [w, 0] : [w, h];
      const bend = 0.15 * Math.max(w, h);
      return { id, type: "line", x: cx - dx / 2, y: cy - dy / 2, points: [[0, 0], [dx / 2 + (dy ? bend : 0), dy / 2 - (dx ? bend : 0)], [dx, dy]], strokeColor: hex, strokeWidth: 4 };
    }
    default:
      return { id, type: d.shape, x: cx - w / 2, y: cy - h / 2, width: w, height: h, ...style };
  }
}

/**
 * The ops one decision makes. `nextId` names a new shape. A move, recolour, resize or
 * delete without a usable target falls back to adding, so a turn is never wasted.
 */
export function toOps(d: Decision, scene: SkeletonEl[], region: Bounds, nextId: () => string): Op[] {
  if (d.action === "restart") return scene.map((el) => ({ op: "delete", id: el.id }));
  const el = d.target ? scene.find((e) => e.id === d.target) : undefined;
  if (d.action === "add" || !el) return [{ op: "add", element: makeShape(nextId(), d, region) }];
  if (d.action === "delete") return [{ op: "delete", id: el.id }];
  if (d.action === "recolor") {
    const hex = COLORS[d.color]!;
    return [{ op: "update", id: el.id, patch: el.type === "line" && !el.backgroundColor ? { strokeColor: hex } : { backgroundColor: hex } }];
  }
  const { cx, cy, w, h } = placement(d, region);
  if (d.action === "move") {
    const [ox, oy] = center(el);
    return [{ op: "update", id: el.id, patch: { x: el.x + cx - ox, y: el.y + cy - oy } }];
  }
  // resize: keep the centre, take the new size
  const [ox, oy] = center(el);
  if (isLinear(el)) {
    const [ew, eh] = sizeOf(el);
    const sx = ew ? w / ew : 1, sy = eh ? h / eh : 1;
    const points = (el as LinearEl).points.map(([px, py]) => [px * sx, py * sy] as [number, number]);
    const moved = { ...el, points } as LinearEl;
    const [nx, ny] = center(moved);
    return [{ op: "update", id: el.id, patch: { points, x: el.x + ox - nx, y: el.y + oy - ny } }];
  }
  if (el.type === "text") return [{ op: "update", id: el.id, patch: { x: ox - w / 2, y: oy - h / 2 } }];
  return [{ op: "update", id: el.id, patch: { x: ox - w / 2, y: oy - h / 2, width: w, height: h } as Partial<BoxEl> }];
}

/** Clef-shaped answers picked at random, for practice fights where there's no Workers AI (local dev, tests). Free. */
export function practiceAnswers(input: unknown, rand: () => number = Math.random) {
  const questions = (input as { questions?: Record<string, { type: string; criteria: unknown }> }).questions ?? {};
  const answers: Record<string, unknown> = {};
  for (const [id, q] of Object.entries(questions)) {
    if (q.type === "score") {
      const levels = (q.criteria as unknown[]).length;
      answers[id] = { type: "score", score: rand() * rand() * (levels - 1) }; // leans small, like a careful artist
      continue;
    }
    const options = Object.keys(q.criteria as object);
    const w = options.map(() => rand());
    const total = w.reduce((a, b) => a + b, 0);
    const probabilities = Object.fromEntries(options.map((o, i) => [o, w[i]! / total]));
    answers[id] = { type: "choice", choice: options[w.indexOf(Math.max(...w))], probabilities };
  }
  return { answers };
}
