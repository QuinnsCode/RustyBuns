// Where the hands go. A hand frame is the wrist's position and the hand's three axes (skeleton.ts: fingers down -z,
// palm -y, thumb -x on the right hand) in some parent space. Held up in view (rest, a cable end, a plug, a roll, a
// handle) that space is the camera's; on a carried cabinet it is the world, palms flat on its two sides. Weight
// shows: the heavier it is, the lower the wrist and the steeper the forearm, and the hands bob with your steps.
// The forearm runs from the wrist to an elbow low and outside the view. Plain numbers, no three.js.
import type { What } from "./grip.ts";
import { FOREARM, PALM, type V3 } from "./skeleton.ts";

export type Frame = { o: V3; x: V3; y: V3; z: V3 };
/** A carried box: its base centre, its turn about y, its size (metres). */
export type Box = { x: number; y: number; z: number; rot: number; w: number; h: number; d: number };
export type Side = -1 | 1;

const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v: V3): V3 => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/** A right-handed frame from where the forearm runs (z, wrist to elbow) and roughly where the thumb points (-x). */
function frame(o: V3, z: V3, thumb: V3): Frame {
  const zz = unit(z), t = unit(add(thumb, zz, -dot(thumb, zz))), x: V3 = [-t[0], -t[1], -t[2]];
  return { o, x, y: cross(zz, x), z: zz };
}

/** The same frame seen in a mirror across x = 0: the left hand's pose from the right's. */
export function mirror(f: Frame): Frame {
  const s = (v: V3): V3 => [-v[0], v[1], v[2]];
  return { o: s(f.o), x: s(f.x).map((c) => -c) as V3, y: s(f.y), z: s(f.z) };
}

/** A point given in the hand frame (on the right hand's skeleton; the left's is mirrored in x), in the parent space. */
export function inFrame(f: Frame, p: V3, side: Side = 1): V3 {
  return add(add(add(f.o, f.x, p[0] * side), f.y, p[1]), f.z, p[2]);
}

/** How far a hold sinks under its weight: metres the wrist drops (to 0.11 m) and radians the fingers tip down. */
export const sag = (kg: number) => { const k = Math.min(1, Math.max(0, kg) / 30); return { drop: 0.11 * k, tip: 0.5 * k }; };

/** The bob of your steps: up and down twice a stride, side to side once; still when you stand. */
export function sway(t: number, speed: number, side: Side): V3 {
  const a = Math.min(1, speed / 1.4), w = t * Math.PI * 2 * 1.8;
  // plus a breath's worth of drift standing still
  return [Math.cos(w / 2) * 0.006 * a, Math.sin(w + (side > 0 ? 0 : Math.PI)) * 0.009 * a + Math.sin(t * 1.7 + side) * 0.0015, 0];
}

/** Looking at your arms (hold Y): both forearms raised across the view, backs up, so the ink on them shows. */
export function showFrame(t: number, side: Side = 1): Frame {
  const f = frame([0.13, -0.1 + Math.sin(t * 1.3) * 0.004, -0.36], [0.42, -0.5, 0.75], [-0.75, 0.55, -0.3]);
  return side > 0 ? f : mirror(f);
}

/** The right hand held up in view (camera space): low and relaxed at rest, raised for a cable end or a plug, lower for a
 *  roll or a handle's weight. The left is `mirror` of the same for rest. */
export function viewFrame(what: What["kind"], kg: number, t: number, speed: number, side: Side = 1): Frame {
  const { drop, tip } = sag(kg), b = sway(t, speed, side);
  let f: Frame;
  switch (what) {
    // A fist up in view, the cable across it front to back: the plug end out of the thumb side, the lead out the bottom.
    case "cable": case "plug":
      f = frame([0.15, -0.2 - drop, -0.4], [0.35, -0.5 - tip, 0.8], [-0.45, 0.8, -0.35]);
      break;
    // A coil hanging off the fingers, palm up and toward you.
    // A coil hangs a forearm's length below the fist, so the fist rides higher and further out than for a handle:
    // you see most of the coil, not only its top.
    case "roll":
      f = frame([0.23, -0.13 - drop, -0.5], [0.2, -0.6 - tip, 0.78], [1, 0.2 + tip, 0]);
      break;
    case "handle":
      f = frame([0.2, -0.27 - drop, -0.34], [0.25, -0.55 - tip, 0.8], [1, 0.2 + tip, 0]);
      break;
    default:
      f = frame([0.23, -0.27, -0.34], [0.3, -0.45, 0.85], [-0.4, 0.6, -0.5]);
  }
  f.o = add(f.o, b);
  return side > 0 ? f : mirror(f);
}

/** The palm's centre on its front face, in the hand frame (right hand). */
export const PALM_FACE: V3 = [0.004, PALM.front, -0.05];

/** Both hands flat on a carried box's sides (world space): back of the hand out, thumbs up, fingers pointing away from
 *  you, the palms on the upper back half, lower the heavier it is. */
export function carryFrames(box: Box, kg: number): { right: Frame; left: Frame } {
  const c = Math.cos(box.rot), s = Math.sin(box.rot);
  const toWorld = (v: V3): V3 => [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
  const y = box.h * (0.78 - Math.min(0.25, kg / 200)), z = box.d * 0.12;
  // In the box's own frame: hand y (back) = +x, z (to the elbow) = +z toward you, x = y cross z = -y (thumb up).
  const local: Frame = { o: [0, 0, 0], x: [0, -1, 0], y: [1, 0, 0], z: [0, 0, 1] };
  const side = (f: Frame, sx: Side): Frame => {
    const palm: V3 = [sx * box.w / 2, y, z];
    const o = add(add(add(palm, f.x, -PALM_FACE[0] * sx), f.y, -PALM_FACE[1]), f.z, -PALM_FACE[2]);
    return { o: add(toWorld(o), [box.x, box.y, box.z]), x: toWorld(f.x), y: toWorld(f.y), z: toWorld(f.z) };
  };
  return { right: side(local, 1), left: side(mirror(local), -1) };
}

/** Where the elbow is: a forearm's length from the wrist, mostly along the hand's own z and pulled toward a point low
 *  and outside the view (lower under weight), so the forearm comes in from the bottom corner. `cam` maps a camera-space
 *  point to the frame's space (identity in view). */
export function elbow(f: Frame, side: Side, kg: number, cam: (p: V3) => V3 = (p) => p): V3 {
  const anchor = cam([side * 0.36, -0.7 - sag(kg).drop * 1.5, 0.15]);
  const to = unit(add(anchor, f.o, -1)), dir = unit(add(f.z, to, 0.9));
  return add(f.o, dir, FOREARM.length);
}
