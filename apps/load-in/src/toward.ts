// The arrow at the edge of the screen when the piece the Next line names is out of view: which way to turn for it.
// Plain maths, no DOM: takes the marker's position in normalised device coordinates (x, y in -1..1 on screen, `behind`
// when it is at your back) and gives the point on the screen's edge toward it, in 0..1 of the width and height, and the
// arrow's angle in degrees (0 points right, 90 down). Null while the marker is on screen and you can see it yourself.

export type Toward = { x: number; y: number; deg: number };

/** How far in from the edge the arrow sits, as a fraction of the half-screen. A marker out past it, in the screen's
 * outer rim, counts as out of view too: it is easy to miss there, and often behind a door frame or a wall. */
const INSET = 0.82;

export function toward(ndc: { x: number; y: number }, behind: boolean): Toward | null {
  let { x, y } = ndc;
  if (!behind && Math.abs(x) <= INSET && Math.abs(y) <= INSET) return null;
  // Behind you the projection flips; a piece at your back wants a turn, so its arrow sits on the side edge, halfway up.
  if (behind) { x = -x || 1; y = 0; }
  const s = INSET / Math.max(Math.abs(x), Math.abs(y), 1e-6);
  const ex = x * s, ey = y * s;
  return { x: (ex + 1) / 2, y: (1 - ey) / 2, deg: (Math.atan2(-ey, ex) * 180) / Math.PI };
}
