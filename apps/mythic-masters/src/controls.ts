// Touch and gamepad, turned into what the keyboard already gives main.ts: key codes held, plus an
// analog stick. main.ts builds the one Input from all of them. No DOM here, so the mapping is testable.

/** A move stick: `fx` pushes away from the camera, `sx` to its right; length ≤ 1. */
export interface Stick { fx: number; sx: number }
export const NO_STICK: Stick = { fx: 0, sx: 0 };
const DEAD = 0.18;

/** A raw stick (x right, y down, any length) with a radial dead zone, rescaled so it still reaches 1. */
export function stick(x: number, y: number): Stick {
  const n = Math.hypot(x, y);
  if (n < DEAD) return NO_STICK;
  const k = Math.min(1, (n - DEAD) / (1 - DEAD)) / n;
  return { fx: -y * k, sx: x * k };
}

/** A finger dragged `dx, dy` pixels from where it landed, on a stick `radius` pixels across. */
export const touchStick = (dx: number, dy: number, radius: number): Stick => stick(dx / radius, dy / radius);

// A standard-mapping gamepad. As shipped: A jump, X light, Y heavy, B special, LB guard, RB dash, LT fly down,
// RT charge, Back ultimate; the left stick or the d-pad moves. In the open world the right stick turns the
// camera and RB runs. The nine action buttons can be moved in the Controls dialog (a swap when one is taken).
/** Each gamepad action (by the key code it feeds) and the standard-mapping button it ships on. */
export const PAD_DEFAULT: Record<string, number> = { Space: 0, KeyJ: 2, KeyK: 3, KeyL: 1, KeyQ: 4, ShiftLeft: 5, KeyC: 6, KeyE: 7, KeyU: 8 };
export const PAD_NAMES = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "Back", "Start", "L3", "R3", "D-pad up", "D-pad down", "D-pad left", "D-pad right"];
const DPAD: Record<number, string> = { 12: "KeyW", 13: "KeyS", 14: "KeyA", 15: "KeyD" };

/** What was saved (unknown) down to action -> button, every button at most once; anything off falls back to the shipped one. */
export function parsePad(raw: unknown): Record<string, number> {
  const o: Record<string, unknown> = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? Object.fromEntries(Object.entries(raw)) : {};
  const out = { ...PAD_DEFAULT }, seen = new Set<number>();
  for (const code of Object.keys(PAD_DEFAULT)) {
    const v = o[code];
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 12 && !seen.has(v)) out[code] = v;
    seen.add(out[code]!);
  }
  return new Set(Object.values(out)).size === Object.keys(out).length ? out : { ...PAD_DEFAULT };
}

/** Put `code`'s action on `button`; the action that had that button gets the one `code` leaves. */
export function bindPad(map: Record<string, number>, code: string, button: number): Record<string, number> {
  const out = { ...map }, was = out[code];
  const other = Object.keys(out).find((c) => c !== code && out[c] === button);
  out[code] = button;
  if (other && was !== undefined) out[other] = was;
  return out;
}

/** One gamepad's buttons and axes as the key codes it holds, its left stick, and its right stick's sideways push (-1 left, 1 right). */
export function readPad(buttons: readonly { pressed: boolean }[], axes: readonly number[], map: Record<string, number> = PAD_DEFAULT): { keys: string[]; stick: Stick; turn: number } {
  const by: Record<number, string> = { ...DPAD };
  for (const [code, i] of Object.entries(map)) by[i] = code;
  if (map.KeyU === PAD_DEFAULT.KeyU) by[11] = "KeyU"; // the right-stick click is a second ultimate while it's on Back
  const keys = buttons.flatMap((b, i) => (b.pressed && by[i] ? [by[i]] : []));
  return { keys, stick: stick(axes[0] ?? 0, axes[1] ?? 0), turn: stick(axes[2] ?? 0, 0).sx };
}

/** Where the keys and a stick push together, camera-relative and no longer than 1: W / up (or stick up) is `fx`, D is `sx`. */
export function push(keys: ReadonlySet<string>, s: Stick, arrows = false): Stick {
  const on = (k: string) => keys.has(k) ? 1 : 0;
  let fx = on("KeyW") - on("KeyS") + (arrows ? on("ArrowUp") - on("ArrowDown") : 0) + s.fx, sx = on("KeyD") - on("KeyA") + s.sx;
  const n = Math.hypot(fx, sx);
  if (n > 1) { fx /= n; sx /= n; }
  return { fx, sx };
}

/** The on-screen buttons: the five a fight needs big, the rest small. `icon` names one in icons.ts. */
export const TOUCH_BUTTONS = [
  { code: "KeyJ", label: "Light", icon: "circle-small", big: true },
  { code: "KeyK", label: "Heavy (hold jump: launcher; flying, hold down: dive)", icon: "circle", big: true },
  { code: "KeyL", label: "Special (moving at them: beam)", icon: "sparkle", big: true },
  { code: "ShiftLeft", label: "Dash (in the world: run)", icon: "wind", big: true },
  { code: "Space", label: "Jump / fly up", icon: "chevrons-up", big: true },
  { code: "KeyC", label: "Fly down", icon: "chevrons-down", big: false },
  { code: "KeyQ", label: "Guard", icon: "shield", big: false },
  { code: "KeyE", label: "Charge", icon: "zap", big: false },
  { code: "KeyU", label: "Ultimate", icon: "star", big: false },
  { code: "KeyB", label: "Bind (a worn-down wild one, in a world fight)", icon: "link", big: false },
] as const;
