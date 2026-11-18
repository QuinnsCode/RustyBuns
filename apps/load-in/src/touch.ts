// Touch play for phones and tablets: a thumb stick on the left half of the screen walks, a drag on the right half
// looks, and two pads of buttons press the same keys a keyboard does (the hands pad everywhere, the venue's own pad
// at each venue), so touch, keys and the gamepad share one path. Shown only where the pointer is a finger
// (`pointer: coarse`). main.ts mounts it once, reads `move()`, `look()` and `crouch` into `step()` each frame, and
// calls `venue(level)` on each new level.

export type Button = { code: string; glyph: string; what: string };

/** Every key a touch button can press: its glyph and what it does. */
const LABEL: Record<string, [glyph: string, what: string]> = {
  KeyF: ["Grab", "Pick up, put down, plug in, unplug"],
  Space: ["Bowl", "Wind up to bowl the roll you carry; press again to let go"],
  KeyQ: ["↶", "Turn left (coiling: over)"],
  KeyE: ["↷", "Turn right (coiling: under)"],
  KeyC: ["⤓", "Crouch"],
  KeyP: ["⏻", "Switch it on or off"],
  KeyL: ["⤴", "Strike and load out (at the desk on band night: line check)"],
  KeyT: ["▣", "Shut the truck"],
  KeyR: ["↑", "Tilt (angle) up"],
  KeyV: ["↓", "Tilt (angle) down / 48 V at the desk"],
  KeyZ: ["−", "Lower the stand"],
  KeyX: ["+", "Raise the stand"],
  BracketLeft: ["−dB", "Fader down"],
  BracketRight: ["+dB", "Fader up"],
  KeyH: ["▦", "Heat map"],
  KeyB: ["B", "Bass map / reset the breakers"],
  Enter: ["→|", "Open the doors"],
  KeyG: ["G", "Hang it on the point / tape the joints"],
  KeyK: ["K", "Send the crew / pin the point / the DI's ground lift"],
  KeyI: ["I", "Check / sub polarity"],
  KeyO: ["O", "Run the motor"],
  KeyU: ["U", "Fly / trim up"],
  KeyJ: ["J", "Trim down / finder down"],
  KeyN: ["N", "Notch the finder's band"],
  Comma: [",", "Delay or trim down"],
  Period: [".", "Delay or trim up"],
  Semicolon: ["−W", "Wedge send down"],
  Quote: ["+W", "Wedge send up"],
};
for (let n = 1; n <= 7; n++) LABEL[`Digit${n}`] = [String(n), `Select ${n}`];

/** The hands pad, on every level: grab, bowl, turn, crouch, switch, strike and the truck. The cable jobs ride on F, Space, Q and E. */
export const HANDS = ["KeyF", "Space", "KeyQ", "KeyE", "KeyC", "KeyP", "KeyL", "KeyT"];

/** Each venue's own keys, the ones its card lists. The garage has none. */
const VENUE: Record<string, string[]> = {
  "dive-bar": ["KeyR", "KeyV", "KeyZ", "KeyX", "KeyH", "BracketLeft", "BracketRight", "Enter"],
  park: ["KeyR", "KeyV", "KeyZ", "KeyX", "KeyH", "BracketLeft", "BracketRight", "Enter"],
  desert: ["KeyR", "KeyV", "KeyG", "KeyH", "KeyB", "BracketLeft", "BracketRight", "Enter"],
  "bigger-bar": ["KeyB", "Enter"],
  "band-night": ["KeyV", "KeyK", "Enter"],
  amphitheatre: ["KeyU", "KeyJ", "KeyK", "KeyI", "KeyO", "Comma", "Period", "KeyN", "KeyB", "KeyG", "KeyV", "KeyH", "BracketLeft", "BracketRight", "Enter"],
  "small-arena": ["KeyG", "KeyK", "KeyI", "KeyO", "KeyU", "KeyJ", "KeyH", "BracketLeft", "BracketRight", "Enter"],
  arena: ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "KeyK", "KeyU", "KeyR", "KeyV", "Comma", "Period", "KeyI", "KeyH", "Enter"],
  show: ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "BracketLeft", "BracketRight", "Semicolon", "Quote", "Comma", "Period", "KeyJ", "KeyK", "KeyN", "Enter"],
};

export const buttons = (codes: string[]): Button[] => codes.map((code) => ({ code, glyph: LABEL[code]![0], what: LABEL[code]![1] }));
/** The venue pad for a level by name. */
export const venuePad = (level: string): Button[] => buttons(VENUE[level] ?? []);

/** A thumb's drag from where it landed to a stick reading: x right, y forward, each -1..1, inside a unit circle,
 * nothing inside the dead zone, full tilt at `radius` pixels and beyond. */
export function stick(dx: number, dy: number, radius = 60, dead = 0.15): { x: number; y: number } {
  const len = Math.hypot(dx, dy) / radius;
  if (len <= dead) return { x: 0, y: 0 };
  const k = Math.min(1, (len - dead) / (1 - dead)) / len / radius;
  return { x: dx * k, y: -dy * k };
}

export type TouchPlay = {
  /** The stick now: x right, y forward. */
  move(): { x: number; y: number };
  /** Pixels the look finger moved since the last call. */
  look(): { dx: number; dy: number };
  /** The crouch button is a toggle: a thumb can't hold it and walk. */
  crouch: boolean;
  /** The venue pad for this level. */
  venue(level: string): void;
  /** Shown while playing, hidden on the menu. */
  show(on: boolean): void;
};

export function touchPlay(canvas: HTMLElement, host: HTMLElement, press: (code: string) => void): TouchPlay {
  const root = document.createElement("div");
  root.className = "touch";
  const ring = document.createElement("div"), knob = document.createElement("div");
  ring.className = "stick";
  knob.className = "knob";
  ring.append(knob);
  ring.hidden = true;
  const venuePadEl = document.createElement("div"), hands = document.createElement("div");
  venuePadEl.className = "touch-pad venue";
  hands.className = "touch-pad hands";
  root.append(ring, venuePadEl, hands);
  host.append(root);

  const fill = (el: HTMLElement, list: Button[]) => {
    el.replaceChildren(...list.map((b) => {
      const btn = document.createElement("button");
      Object.assign(btn, { type: "button", textContent: b.glyph, title: b.what });
      btn.setAttribute("aria-label", b.what);
      // pointerdown, not click: a finger shouldn't wait for the lift, and preventDefault keeps the tap from zooming.
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (b.code !== "KeyC") return press(b.code);
        play.crouch = !play.crouch;
        btn.setAttribute("aria-pressed", String(play.crouch));
      });
      return btn;
    }));
    el.hidden = !list.length;
  };
  fill(hands, buttons(HANDS));

  let walk: { id: number; x: number; y: number; dx: number; dy: number } | null = null;
  let eye: { id: number; x: number; y: number } | null = null;
  let moved = { dx: 0, dy: 0 };
  const finger = (e: PointerEvent) => e.pointerType === "touch" || e.pointerType === "pen";
  canvas.addEventListener("pointerdown", (e) => {
    if (!finger(e)) return;
    e.preventDefault();
    const left = e.clientX < canvas.clientWidth / 2;
    if (left && !walk) {
      walk = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
      Object.assign(ring.style, { left: `${e.clientX}px`, top: `${e.clientY}px` });
      knob.style.transform = "";
      ring.hidden = false;
    } else if (!left && !eye) eye = { id: e.pointerId, x: e.clientX, y: e.clientY };
    else return;
    // Capture keeps the finger ours when it slides over a button; a pointer the browser no longer tracks just skips it.
    try { canvas.setPointerCapture(e.pointerId); } catch {}
  });
  canvas.addEventListener("pointermove", (e) => {
    if (walk?.id === e.pointerId) {
      walk.dx = e.clientX - walk.x;
      walk.dy = e.clientY - walk.y;
      const s = stick(walk.dx, walk.dy);
      knob.style.transform = `translate(${s.x * 40}px, ${-s.y * 40}px)`;
    } else if (eye?.id === e.pointerId) {
      moved = { dx: moved.dx + e.clientX - eye.x, dy: moved.dy + e.clientY - eye.y };
      eye.x = e.clientX;
      eye.y = e.clientY;
    }
  });
  const lift = (e: PointerEvent) => {
    if (walk?.id === e.pointerId) { walk = null; ring.hidden = true; }
    if (eye?.id === e.pointerId) eye = null;
  };
  canvas.addEventListener("pointerup", lift);
  canvas.addEventListener("pointercancel", lift);

  const play: TouchPlay = {
    move: () => (walk ? stick(walk.dx, walk.dy) : { x: 0, y: 0 }),
    look() { const m = moved; moved = { dx: 0, dy: 0 }; return m; },
    crouch: false,
    venue: (level) => fill(venuePadEl, venuePad(level)),
    show(on) {
      root.hidden = !on;
      if (!on) { walk = eye = null; ring.hidden = true; moved = { dx: 0, dy: 0 }; }
    },
  };
  return play;
}
