import type { PadAction } from "@rustybuns/game-controls";
// Keys, touch and gamepad, all turned into the same thing: the action ids held (binds.ts), a move stick and, from a
// gamepad, a right stick. main.ts builds the one sim Input from them. No DOM here, so the mapping is testable.

/** A stick: `fx` pushes away from the camera (up), `sx` to its right; length ≤ 1. */
export interface Stick { fx: number; sx: number }
export const NO_STICK: Stick = { fx: 0, sx: 0 };
export const PAD_ZONE = 0.18;
const DEAD = PAD_ZONE;

/** A raw stick (x right, y down, any length) with a radial dead zone, rescaled so it still reaches 1. */
export function stick(x: number, y: number): Stick {
  const n = Math.hypot(x, y);
  if (n < DEAD) return NO_STICK;
  const k = Math.min(1, (n - DEAD) / (1 - DEAD)) / n;
  return { fx: -y * k, sx: x * k };
}

/** A finger dragged `dx, dy` pixels from where it landed, on a stick `radius` pixels across. */
export const touchStick = (dx: number, dy: number, radius: number): Stick => stick(dx / radius, dy / radius);

// A standard-mapping gamepad, laid out like a platform fighter's: A attack, B special, X jump, Y strong, RT guard
// (in the air: drop), RB dash, LT charge, LB ultimate, L3 bind (a worn-down wild one). The right stick is the strong
// attack too, aimed: pushed up it is the launcher, pulled down while flying the dive. Start opens and closes the
// journal (fixed); the left stick or the d-pad moves. In the open world the right stick turns the camera and RB runs.
// The action buttons can be moved in the Controls dialog (a swap when one is taken).
/** Each gamepad action (by id) and the standard-mapping button it ships on. */
export const PAD_DEFAULT: Record<string, number> = { light: 0, special: 1, jump: 2, heavy: 3, ultimate: 4, dash: 5, charge: 6, guard: 7, bind: 10 };
/** Start opens the journal; it is no action, so it can't be moved. */
export const PAD_START = 9;
const DPAD: Record<number, string> = { 12: "forward", 13: "back", 14: "left", 15: "right" };

/** The pad actions the Controls dialog lists, with the button each ships on (the labels are the dialog's rows). */
export const PAD_ACTIONS: PadAction[] = [["light", "Attack"], ["special", "Special"], ["jump", "Jump / fly up"], ["heavy", "Strong (the right stick too)"], ["guard", "Guard (in the air: drop)"], ["dash", "Dash (world: run)"], ["ultimate", "Ultimate"], ["charge", "Charge"], ["bind", "Bind a wild one"]]
  .map(([id, label]) => ({ id: id!, label: label!, button: PAD_DEFAULT[id!]! }));

/** One frame of the gamepad: the action ids held (the d-pad walks), the left stick, and the right stick (`aim`, which in the world turns the camera). */
export function readPad(held: ReadonlySet<string>, left: { x: number; y: number }, right: { x: number; y: number }, down: readonly number[] = []): { keys: string[]; stick: Stick; aim: Stick } {
  const keys = [...held, ...down.flatMap((i) => (DPAD[i] ? [DPAD[i]!] : []))];
  const st = (v: { x: number; y: number }): Stick => (v.x || v.y ? { fx: -v.y, sx: v.x } : NO_STICK);
  return { keys, stick: st(left), aim: st(right) };
}

/** Where the keys and a stick push together, camera-relative and no longer than 1: forward (or stick up) is `fx`, right is `sx`. */
export function push(keys: ReadonlySet<string>, s: Stick): Stick {
  const on = (k: string) => keys.has(k) ? 1 : 0;
  let fx = on("forward") - on("back") + s.fx, sx = on("right") - on("left") + s.sx;
  const n = Math.hypot(fx, sx);
  if (n > 1) { fx /= n; sx /= n; }
  return { fx, sx };
}

/** How far a right stick must go to count as a strong attack. */
const FLICK = 0.6;
/** The buttons of the sim's Input from the actions held and a right stick: pushed past FLICK it is the strong attack,
 * up (away from you) with jump held for the launcher, down with guard held for the dive or a drop. */
export function buttons(keys: ReadonlySet<string>, aim: Stick = NO_STICK) {
  const on = (k: string) => keys.has(k);
  const flick = Math.hypot(aim.fx, aim.sx) > FLICK, up = flick && aim.fx > Math.abs(aim.sx), down = flick && -aim.fx > Math.abs(aim.sx);
  return {
    up: on("jump") || up, down: down, light: on("light"), heavy: on("heavy") || flick, special: on("special"), ultimate: on("ultimate"),
    guard: on("guard"), dash: on("dash"), charge: on("charge"),
  };
}

/** The on-screen buttons. `size` is how big it sits under the right thumb; `icon` names one in icons.ts. */
export const TOUCH_BUTTONS = [
  { id: "light", label: "Attack", icon: "circle-small", size: "xl" },
  { id: "special", label: "Special (moving at them: beam)", icon: "sparkle", size: "big" },
  { id: "heavy", label: "Strong (with jump: launcher; flying, with guard: dive)", icon: "circle", size: "big" },
  { id: "jump", label: "Jump / fly up (tap: short hop)", icon: "chevrons-up", size: "big" },
  { id: "guard", label: "Guard (in the air: drop)", icon: "shield", size: "mid" },
  { id: "dash", label: "Dash (in the world: run)", icon: "wind", size: "mid" },
  { id: "ultimate", label: "Ultimate", icon: "star", size: "small" },
  { id: "charge", label: "Charge energy (hold)", icon: "zap", size: "small" },
  { id: "bind", label: "Bind (a worn-down wild one, in a world fight)", icon: "link", size: "small" },
] as const;
