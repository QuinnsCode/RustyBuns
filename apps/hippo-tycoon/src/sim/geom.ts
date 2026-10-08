import { A_REST, GULP_BACK, GULP_OUT, LUNGE, RAIL_HALF, SEATS, seatAngle } from "./rules.ts";

/** Seat frame: `a` points out from the centre, `t` is the driver's right. */
export interface Axis { ax: number; ay: number; tx: number; ty: number }

export const AXES: readonly Axis[] = Array.from({ length: SEATS }, (_, i) => {
  const a = seatAngle(i);
  return { ax: Math.cos(a), ay: Math.sin(a), tx: -Math.sin(a), ty: Math.cos(a) };
});

/** 0 = resting, 1 = jaws at full reach. */
export function lungeAt(gulp: number): number {
  if (gulp < 0) return 0;
  if (gulp <= GULP_OUT) return gulp / GULP_OUT;
  return Math.max(0, 1 - (gulp - GULP_OUT) / GULP_BACK);
}

/** Where a seat's hippo (jaws) is for a given slide and lunge. */
export function hippoPoint(seat: number, slide: number, lunge: number): { x: number; y: number } {
  const k = AXES[seat]!;
  const axial = A_REST - LUNGE * lunge, lateral = slide * RAIL_HALF;
  return { x: k.ax * axial + k.tx * lateral, y: k.ay * axial + k.ty * lateral };
}

/** Axis and lateral coordinates of a point in a seat's frame. */
export function toFrame(seat: number, x: number, y: number): { axial: number; lateral: number } {
  const k = AXES[seat]!;
  return { axial: x * k.ax + y * k.ay, lateral: x * k.tx + y * k.ty };
}
