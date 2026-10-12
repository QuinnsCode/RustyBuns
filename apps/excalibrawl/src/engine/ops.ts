// Pure: skeleton element schema + op validation + region clamping, from excalibrawl.com.
// No I/O, no Cloudflare, no Excalidraw import.
import type {
  SkeletonEl, Scene, Op, OpLimits, Rejection, ApplyResult,
  Bounds, BoxEl, LinearEl, ElementType, FillStyle,
} from "./types.ts";

type BaseEl = Omit<BoxEl, "width" | "height" | "type"> & { type: ElementType };

export const DEFAULT_LIMITS: OpLimits = {
  maxOpsPerTurn: 6,
  maxElements: 60,
  maxTextLen: 80,
};

// Fixed palette. Without this, every model defaults to near-black and the
// duel is monochrome. Models may also pass raw hex; both are accepted.
export const PALETTE = [
  "#1e1e1e",
  "#e03131",
  "#2f9e44",
  "#1971c2",
  "#f08c00",
  "#9c36b5",
  "#ffec99",
  "#ffffff",
] as const;

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FILL_STYLES: FillStyle[] = ["solid", "hachure", "cross-hatch"];
const TYPES: ElementType[] = [
  "rectangle",
  "ellipse",
  "diamond",
  "line",
  "arrow",
  "text",
];

const num = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

// --- region geometry ---------------------------------------------------------

// Split the canvas by slot. total=1 → full canvas, 2 → vertical halves,
// 4 → quadrants. Never hardcode "left"/"right" anywhere; call this.
export function regionFor(
  slot: number,
  total: number,
  canvas: Bounds,
): Bounds {
  if (total <= 1) return { ...canvas };
  if (total === 2) {
    const w = canvas.w / 2;
    return { x: canvas.x + slot * w, y: canvas.y, w, h: canvas.h };
  }
  const cols = Math.ceil(Math.sqrt(total));
  const rows = Math.ceil(total / cols);
  const w = canvas.w / cols;
  const h = canvas.h / rows;
  const col = slot % cols;
  const row = Math.floor(slot / cols);
  return { x: canvas.x + col * w, y: canvas.y + row * h, w, h };
}

// --- style sanitation --------------------------------------------------------

function color(v: unknown): string | undefined {
  return typeof v === "string" && HEX.test(v) ? v : undefined;
}

function sanitizeStyle<T extends Partial<BaseEl>>(el: T): T {
  const out = { ...el };
  const sc = color(out.strokeColor);
  const bc = color(out.backgroundColor);
  if (sc) out.strokeColor = sc;
  else delete out.strokeColor;
  if (bc) out.backgroundColor = bc;
  else delete out.backgroundColor;
  if (out.fillStyle && !FILL_STYLES.includes(out.fillStyle))
    delete out.fillStyle;
  if (num(out.strokeWidth)) out.strokeWidth = clamp(out.strokeWidth, 0.5, 8);
  else delete out.strokeWidth;
  if (num(out.roughness)) out.roughness = clamp(out.roughness, 0, 3);
  else delete out.roughness;
  return out;
}

// --- bounding boxes ----------------------------------------------------------

function bboxOf(el: SkeletonEl): Bounds {
  if (el.type === "line" || el.type === "arrow") {
    const pts = el.points.length ? el.points : [[0, 0] as [number, number]];
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const [px, py] of pts) {
      minX = Math.min(minX, el.x + px);
      minY = Math.min(minY, el.y + py);
      maxX = Math.max(maxX, el.x + px);
      maxY = Math.max(maxY, el.y + py);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  if (el.type === "text") {
    const fs = el.fontSize ?? 20;
    const w = Math.max(1, (el.text?.length ?? 1) * fs * 0.6);
    return { x: el.x, y: el.y, w, h: fs * 1.25 };
  }
  const box = el as BoxEl;
  return { x: box.x, y: box.y, w: box.width, h: box.height };
}

// Force an element fully inside its region. Shift first; if still too large,
// shrink boxes / clamp linear points. Deterministic — a model that drifts out
// of bounds gets pulled back the same way every time.
export function clampToRegion(el: SkeletonEl, r: Bounds): SkeletonEl {
  const b = bboxOf(el);
  const maxOriginX =
    b.w <= r.w ? r.x + r.w - b.w : r.x; // can't fit → pin to left edge
  const maxOriginY = b.h <= r.h ? r.y + r.h - b.h : r.y;
  const dx = clamp(el.x, r.x + (el.x - b.x), maxOriginX + (el.x - b.x)) - el.x;
  const dy = clamp(el.y, r.y + (el.y - b.y), maxOriginY + (el.y - b.y)) - el.y;

  const moved = { ...el, x: el.x + dx, y: el.y + dy } as SkeletonEl;

  if (
    moved.type === "rectangle" ||
    moved.type === "ellipse" ||
    moved.type === "diamond"
  ) {
    const box: BoxEl = moved;
    box.width = clamp(box.width, 1, r.x + r.w - box.x);
    box.height = clamp(box.height, 1, r.y + r.h - box.y);
    return box;
  }
  if (moved.type === "line" || moved.type === "arrow") {
    const lin: LinearEl = moved;
    lin.points = lin.points.map(([px, py]) => [
      clamp(lin.x + px, r.x, r.x + r.w) - lin.x,
      clamp(lin.y + py, r.y, r.y + r.h) - lin.y,
    ]);
    return lin;
  }
  return moved;
}

// --- op validation + application --------------------------------------------


function validElementShape(e: unknown): e is SkeletonEl {
  if (!e || typeof e !== "object") return false;
  const el = e as Record<string, unknown>;
  if (typeof el.id !== "string" || !el.id) return false;
  if (typeof el.type !== "string" || !TYPES.includes(el.type as ElementType))
    return false;
  if (!num(el.x) || !num(el.y)) return false;
  if (el.type === "text") return typeof el.text === "string";
  if (el.type === "line" || el.type === "arrow")
    return (
      Array.isArray(el.points) &&
      el.points.length >= 2 &&
      el.points.every(
        (p) => Array.isArray(p) && p.length === 2 && num(p[0]) && num(p[1]),
      )
    );
  return num(el.width) && num(el.height); // box
}

function normalizeAdd(el: SkeletonEl, r: Bounds, lim: OpLimits): SkeletonEl {
  let e = sanitizeStyle(el);
  if (e.type === "text") e.text = e.text.slice(0, lim.maxTextLen);
  return clampToRegion(e, r);
}

// Validate, clamp, and apply a turn's worth of ops against a scene copy.
// `region` is the fighter's own slot; ids are assumed already prefixed by slot
// upstream so they never collide across fighters on a merged scene.
export function applyOps(
  prev: Scene,
  ops: Op[],
  region: Bounds,
  limits: OpLimits = DEFAULT_LIMITS,
): ApplyResult {
  const scene: Scene = new Map(prev);
  const applied: Op[] = [];
  const rejected: Rejection[] = [];

  for (const op of ops.slice(0, limits.maxOpsPerTurn)) {
    if (op.op === "add") {
      if (!validElementShape(op.element)) {
        rejected.push({ op, reason: "invalid element shape" });
        continue;
      }
      if (scene.has(op.element.id)) {
        rejected.push({ op, reason: "id already exists" });
        continue;
      }
      if (scene.size >= limits.maxElements) {
        rejected.push({ op, reason: "element cap reached" });
        continue;
      }
      const el = normalizeAdd(op.element, region, limits);
      scene.set(el.id, el);
      applied.push({ op: "add", element: el });
    } else if (op.op === "update") {
      const cur = scene.get(op.id);
      if (!cur) {
        rejected.push({ op, reason: "unknown id" });
        continue;
      }
      // patch cannot change type or id; merge then re-clamp
      const { id: _i, type: _t, ...safe } = op.patch as Record<string, unknown>;
      let next = sanitizeStyle({ ...cur, ...safe } as SkeletonEl);
      if (next.type === "text" && typeof next.text === "string")
        next.text = next.text.slice(0, limits.maxTextLen);
      next = clampToRegion(next, region);
      scene.set(op.id, next);
      applied.push({ op: "update", id: op.id, patch: safe });
    } else if (op.op === "delete") {
      if (!scene.has(op.id)) {
        rejected.push({ op, reason: "unknown id" });
        continue;
      }
      scene.delete(op.id);
      applied.push(op);
    } else {
      rejected.push({ op, reason: "unknown op" });
    }
  }

  const overflow = ops.slice(limits.maxOpsPerTurn);
  for (const op of overflow)
    rejected.push({ op, reason: "over per-turn op budget" });

  return { scene, applied, rejected };
}

// Convenience for renderers/tests.
export const sceneToArray = (s: Scene): SkeletonEl[] => [...s.values()];