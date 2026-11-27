// The jam room by touch, on a phone or a tablet (#6425): a left-thumb stick to walk, a drag on the room to look about,
// a tap on the room (main.ts sits you at the instrument tapped), Stand to get up, and seated at the keys or the bass a
// keyboard along the bottom that plays its notes, a finger sliding from key to key as it would on a real one.
// It knows nothing of the room: main.ts reads the stick and the look each frame and says what to show. On a touch
// screen the Decks and Mixer buttons move to the right edge, off the stick and the wheels, and the strip of keyboard
// keys to press doesn't show.
import type { Cap } from "./overlay.ts";

/** A touch screen: a phone or a tablet, where the mouse and the keys aren't. */
export const touchScreen = () => matchMedia("(pointer: coarse)").matches;

export interface TouchHooks {
  /** A short tap on the room, where it landed on the screen. */
  tap(x: number, y: number): void;
  stand(): void;
  /** A key of the touch keyboard (its computer key's code, as the note keys go), down or up. */
  note(code: string, down: boolean): void;
  /** The octave buttons: -1 down, 1 up. */
  octave(dir: number): void;
}

/** What to show this frame: in the room or not, seated or not, and the keys to play (null: none here). */
export interface TouchFrame { play: boolean; seated: boolean; caps: Cap[] | null; held: Iterable<string> }

/** How far (px) a finger may move and how long (ms) it may stay down for its touch to be a tap, not a look. Timed by
 *  the events' own stamps, not by when a handler got to run: a slow frame between the two must not turn a tap into a look. */
const TAP_PX = 12, TAP_MS = 350;
/** The stick's reach from its middle, px. */
const REACH = 46;

const CSS = `
.qt{position:fixed;inset:0;pointer-events:none;z-index:6;font:600 14px 'Barlow Condensed',sans-serif;color:#f4f1ea;user-select:none;-webkit-user-select:none}
.qt [hidden]{display:none!important}
.qt-stick{position:absolute;left:calc(22px + env(safe-area-inset-left));bottom:calc(28px + env(safe-area-inset-bottom));width:124px;height:124px;border-radius:50%;background:rgba(21,23,27,.3);border:1px solid rgba(244,241,234,.3);pointer-events:auto;touch-action:none}
.qt-stick i{pointer-events:none;position:absolute;left:50%;top:50%;width:52px;height:52px;margin:-26px 0 0 -26px;border-radius:50%;background:rgba(244,241,234,.55)}
.qt-bar{position:absolute;right:calc(14px + env(safe-area-inset-right));bottom:calc(132px + env(safe-area-inset-bottom));display:flex;gap:8px;pointer-events:auto}
.qt-bar button{min-width:48px;height:44px;padding:0 14px;border-radius:12px;border:1px solid rgba(244,241,234,.4);background:rgba(21,23,27,.55);color:inherit;font:inherit;touch-action:manipulation}
.qt-keys{position:absolute;left:0;right:0;bottom:env(safe-area-inset-bottom);height:108px;padding:0 6px 6px;display:flex;pointer-events:auto;touch-action:none}
.qt-key{touch-action:none;flex:1;margin:0 1px;border-radius:0 0 7px 7px;background:rgba(244,241,234,.86);color:#15171b;display:flex;align-items:flex-end;justify-content:center;padding-bottom:6px;font-size:11px}
.qt-key.black{position:absolute;top:0;height:62%;margin:0;background:rgba(14,14,16,.92);color:#f4f1ea;z-index:1}
.qt-key.on{background:#0a9fe0;color:#fff}
#keystrip{display:none!important}
#jl-host{--jl-btn-bottom:calc(290px + env(safe-area-inset-bottom))}
body.qt-playing .qo{inset:auto auto calc(122px + env(safe-area-inset-bottom)) 16px!important}
body.qt-playing #hint,body.qt-playing #heard{display:none}
#decks-open,#desk-open{left:auto!important;right:calc(12px + env(safe-area-inset-right))}
#decks-open{bottom:calc(240px + env(safe-area-inset-bottom))!important}
#desk-open{bottom:calc(190px + env(safe-area-inset-bottom))!important}
`;

export class TouchControls {
  /** The walk stick, -1..1 each way, y negative pushed up (as a gamepad's). */
  readonly stick = { x: 0, y: 0 };
  private readonly look = { x: 0, y: 0 };
  private readonly root = document.createElement("div");
  private readonly stickEl = document.createElement("div");
  private readonly knob = document.createElement("i");
  private readonly bar = document.createElement("div");
  private readonly keysEl = document.createElement("div");
  private readonly keyEls = new Map<string, HTMLElement>();
  private shown = "";
  /** Fingers on the room: where each came down, when, and how far it has gone. */
  private readonly fingers = new Map<number, { x: number; y: number; lastX: number; lastY: number; at: number; far: number }>();
  /** Fingers on the keyboard: the key each is on. */
  private readonly onKey = new Map<number, string>();

  constructor(canvas: HTMLElement, private readonly hooks: TouchHooks) {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.append(style);
    this.root.className = "qt";
    this.root.hidden = true;
    canvas.style.touchAction = "none";

    // the room: a drag looks about, a tap is the room's
    canvas.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch") return;
      e.preventDefault(); // no mousedown after it (that would ask for the pointer lock)
      this.fingers.set(e.pointerId, { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, at: e.timeStamp, far: 0 });
    });
    canvas.addEventListener("pointermove", (e) => {
      const f = this.fingers.get(e.pointerId);
      if (!f) return;
      this.look.x += e.clientX - f.lastX; this.look.y += e.clientY - f.lastY;
      f.lastX = e.clientX; f.lastY = e.clientY;
      f.far = Math.max(f.far, Math.hypot(e.clientX - f.x, e.clientY - f.y));
    });
    const lift = (e: PointerEvent) => {
      const f = this.fingers.get(e.pointerId);
      if (!f) return;
      this.fingers.delete(e.pointerId);
      if (e.type === "pointerup" && f.far < TAP_PX && e.timeStamp - f.at < TAP_MS) hooks.tap(e.clientX, e.clientY);
    };
    canvas.addEventListener("pointerup", lift);
    canvas.addEventListener("pointercancel", lift);

    // the stick
    this.stickEl.className = "qt-stick";
    this.stickEl.append(this.knob);
    const aim = (e: PointerEvent) => {
      const r = this.stickEl.getBoundingClientRect();
      let x = (e.clientX - (r.left + r.width / 2)) / REACH, y = (e.clientY - (r.top + r.height / 2)) / REACH;
      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
      this.stick.x = x; this.stick.y = y;
      this.knob.style.transform = `translate(${x * REACH}px, ${y * REACH}px)`;
    };
    const centre = () => { this.stick.x = 0; this.stick.y = 0; this.knob.style.transform = ""; };
    this.stickEl.addEventListener("pointerdown", (e) => { e.preventDefault(); this.stickEl.setPointerCapture(e.pointerId); aim(e); });
    this.stickEl.addEventListener("pointermove", (e) => { if (this.stickEl.hasPointerCapture(e.pointerId)) aim(e); });
    for (const end of ["pointerup", "pointercancel"]) this.stickEl.addEventListener(end, centre);

    // Stand, and the octave down and up while there are keys
    this.bar.className = "qt-bar";
    const button = (text: string, label: string, act: () => void) => {
      const b = document.createElement("button");
      b.textContent = text; b.title = label; b.setAttribute("aria-label", label);
      b.addEventListener("click", act);
      this.bar.append(b);
      return b;
    };
    button("-", "Octave down", () => hooks.octave(-1)).className = "qt-oct";
    button("+", "Octave up", () => hooks.octave(1)).className = "qt-oct";
    button("Stand", "Stand up", () => hooks.stand()).className = "qt-stand";

    // the keyboard: whichever key a finger is over plays, so a slide goes from note to note
    this.keysEl.className = "qt-keys";
    const keyAt = (e: PointerEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      return el instanceof HTMLElement && this.keysEl.contains(el) ? el.dataset.code ?? null : null;
    };
    const press = (e: PointerEvent) => {
      const was = this.onKey.get(e.pointerId) ?? null, now = keyAt(e);
      if (was === now) return;
      if (was) hooks.note(was, false);
      if (now) { hooks.note(now, true); this.onKey.set(e.pointerId, now); } else this.onKey.delete(e.pointerId);
    };
    this.keysEl.addEventListener("pointerdown", (e) => { e.preventDefault(); this.keysEl.setPointerCapture(e.pointerId); press(e); });
    this.keysEl.addEventListener("pointermove", (e) => { if (this.onKey.has(e.pointerId) || this.keysEl.hasPointerCapture(e.pointerId)) press(e); });
    const unkey = (e: PointerEvent) => {
      const was = this.onKey.get(e.pointerId);
      this.onKey.delete(e.pointerId);
      if (was) hooks.note(was, false);
    };
    this.keysEl.addEventListener("pointerup", unkey);
    this.keysEl.addEventListener("pointercancel", unkey);

    this.root.append(this.stickEl, this.bar, this.keysEl);
    document.body.append(this.root);
  }

  /** The look drag since the last call, in px, and none after it. */
  takeLook() {
    const l = { x: this.look.x, y: this.look.y };
    this.look.x = 0; this.look.y = 0;
    return l;
  }

  /** Every frame: shows the stick standing, Stand and the keys seated, and lights the keys held. */
  frame(f: TouchFrame) {
    this.root.hidden = !f.play;
    if (!f.play) { this.fingers.clear(); this.look.x = 0; this.look.y = 0; }
    this.stickEl.hidden = f.seated;
    if (f.seated && (this.stick.x || this.stick.y)) { this.stick.x = 0; this.stick.y = 0; this.knob.style.transform = ""; }
    this.bar.hidden = !f.seated;
    for (const b of this.bar.querySelectorAll<HTMLElement>(".qt-oct")) b.hidden = !f.caps;
    this.keysEl.hidden = !f.seated || !f.caps;
    // the keyboard covers the bottom of the screen: the words that sit there (keys to press, who's heard) step aside
    document.body.classList.toggle("qt-playing", f.play && !this.keysEl.hidden);
    const caps = f.seated ? f.caps : null;
    const key = caps ? JSON.stringify(caps.map((c) => [c.code, c.midi])) : "";
    if (key !== this.shown) { this.shown = key; this.draw(caps ?? []); }
    const held = new Set([...f.held].filter((by) => by.startsWith("touch:")).map((by) => by.slice(6)));
    for (const [code, el] of this.keyEls) el.classList.toggle("on", held.has(code));
  }

  /** The keys in pitch order: the white ones side by side, each black one over the gap after the white before it. */
  private draw(caps: Cap[]) {
    this.keyEls.clear();
    const sorted = [...caps].sort((a, b) => a.midi - b.midi), whites = sorted.filter((c) => !c.black).length;
    const els: HTMLElement[] = [];
    let seen = 0;
    for (const c of sorted) {
      const el = document.createElement("div");
      el.className = `qt-key${c.black ? " black" : ""}`;
      el.dataset.code = c.code;
      el.textContent = c.note;
      if (c.black) {
        const w = 100 / Math.max(1, whites);
        el.style.left = `calc(6px + (100% - 12px) * ${(seen * w - w * 0.3) / 100})`;
        el.style.width = `calc((100% - 12px) * ${(w * 0.6) / 100})`;
      } else seen++;
      this.keyEls.set(c.code, el);
      els.push(el);
    }
    this.keysEl.replaceChildren(...els);
  }

  /** For the harness: what shows, the stick, and the keys on the keyboard. */
  state() {
    const shows = (el: HTMLElement) => !this.root.hidden && !el.hidden;
    return { shown: !this.root.hidden, stick: shows(this.stickEl) ? { ...this.stick } : null, stand: shows(this.bar), keys: shows(this.keysEl) ? [...this.keyEls.keys()] : [] };
  }
}
