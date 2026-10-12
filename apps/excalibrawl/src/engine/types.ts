// The shapes everything else shares: the Worker, the Durable Object, the viewer and the
// office broadcaster. No I/O here.

export type ElementType = "rectangle" | "ellipse" | "diamond" | "line" | "arrow" | "text";
export type FillStyle = "solid" | "hachure" | "cross-hatch";

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface BaseEl {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: FillStyle;
  strokeWidth?: number;
  roughness?: number;
}

export interface BoxEl extends BaseEl {
  type: "rectangle" | "ellipse" | "diamond";
  width: number;
  height: number;
}

export interface LinearEl extends BaseEl {
  type: "line" | "arrow";
  points: [number, number][];
}

export interface TextEl extends BaseEl {
  type: "text";
  text: string;
  fontSize?: number;
}

/** An Excalidraw skeleton element: the subset fighters draw with. */
export type SkeletonEl = BoxEl | LinearEl | TextEl;

export type Scene = Map<string, SkeletonEl>;

export type Op =
  | { op: "add"; element: SkeletonEl }
  | { op: "update"; id: string; patch: Partial<SkeletonEl> }
  | { op: "delete"; id: string };

export interface OpLimits {
  maxOpsPerTurn: number;
  maxElements: number;
  maxTextLen: number;
}

export interface Rejection {
  op: Op;
  reason: string;
}

export interface ApplyResult {
  scene: Scene;
  applied: Op[];
  rejected: Rejection[];
}

export const isLinear = (el: SkeletonEl): el is LinearEl => el.type === "line" || el.type === "arrow";
