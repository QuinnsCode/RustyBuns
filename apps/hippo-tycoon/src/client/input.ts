// Keyboard, gamepad and touch -> one control per seat. Sampled once per frame:
// move is a level, gulp and bellow are edges (a press since the last sample).

import { createPad, createPadBindings } from "@rustybuns/game-controls";

export type Ctl = "bot" | "kb1" | "kb2" | "kbAll" | "pad0" | "pad1" | "pad2" | "pad3" | "touch";
export interface Control { move: number; gulp: boolean; bellow: boolean }
export const NO_CONTROL: Control = { move: 0, gulp: false, bellow: false };

const KEYS = {
  kb1: { left: ["KeyA"], right: ["KeyD"], gulp: ["KeyW", "Space"], bellow: ["KeyQ"] },
  kb2: { left: ["ArrowLeft"], right: ["ArrowRight"], gulp: ["ArrowUp", "Enter"], bellow: ["Slash"] },
} as const;
const SCHEMES = {
  kb1: [KEYS.kb1], kb2: [KEYS.kb2], kbAll: [KEYS.kb1, KEYS.kb2],
} as const;
const ALL_CODES = new Set<string>([...Object.values(KEYS).flatMap((k) => [...k.left, ...k.right, ...k.gulp, ...k.bellow])]);
const DEADZONE = 0.25;
const PAD_ACTIONS = [{ id: "gulp", label: "Gulp", button: 0 }, { id: "bellow", label: "Bellow", button: 1 }];
/** The keys a focused button answers to. */
const UI_CODES = new Set(["Space", "Enter", "NumpadEnter"]);

/** Whether a key event is aimed at a focusable control (a button, link, select, text box). */
export const onControl = (t: EventTarget | null): boolean =>
  !!t && typeof (t as Element).closest === "function" && !!(t as Element).closest("button, a[href], select, textarea, input, [role=button]");

/** Sensitivities from the Controls cog (1 as shipped): the stick's slide speed and the touch drag's. */
export const tuning = { pad: 1, touch: 1 };

export interface AttachOpts {
  /** True when Space/Enter should go to the focused control instead of the game (a podium, a lobby, an open dialog). */
  uiKeys?: (e: KeyboardEvent) => boolean;
}

export const CTL_LABEL: Record<Ctl, string> = {
  bot: "Bot", kb1: "A / D  W  Q", kb2: "← / →  ↑  /", kbAll: "Keyboard", pad0: "Gamepad 1", pad1: "Gamepad 2", pad2: "Gamepad 3", pad3: "Gamepad 4", touch: "Touch",
};

export class Controls {
  private down = new Set<string>();
  private pressed = new Set<string>();
  /** One pad per couch seat, by slot. No dead zone here: `sample` applies its own to the one axis it reads. */
  private pads = [0, 1, 2, 3].map((i) => createPad(createPadBindings(PAD_ACTIONS), 0, undefined, i));
  private padEdge: { gulp: boolean; bellow: boolean }[] = [];
  private padMove: number[] = [];
  private padDpad: number[] = [];
  private touchMove = 0;
  private touchGulp = false;
  private off: (() => void)[] = [];

  attach(target: Window = window, opts: AttachOpts = {}) {
    const kd = (e: KeyboardEvent) => {
      if (UI_CODES.has(e.code) && opts.uiKeys?.(e)) return;                  // let the focused button have it
      if (ALL_CODES.has(e.code) && !(typeof HTMLInputElement !== "undefined" && e.target instanceof HTMLInputElement)) e.preventDefault();
      if (e.repeat) return;
      this.down.add(e.code); this.pressed.add(e.code);
    };
    const ku = (e: KeyboardEvent) => { this.down.delete(e.code); };
    const blur = () => { this.down.clear(); };
    target.addEventListener("keydown", kd); target.addEventListener("keyup", ku); target.addEventListener("blur", blur);
    this.off.push(() => { target.removeEventListener("keydown", kd); target.removeEventListener("keyup", ku); target.removeEventListener("blur", blur); });
  }

  /** Drag to slide, tap to gulp. */
  attachTouch(el: HTMLElement) {
    let startX = 0, startT = 0, moved = 0, active = -1;
    const pd = (e: PointerEvent) => { if (e.pointerType === "mouse") return; active = e.pointerId; startX = e.clientX; startT = e.timeStamp; moved = 0; };
    const pm = (e: PointerEvent) => {
      if (e.pointerId !== active) return;
      const dx = e.clientX - startX; moved = Math.max(moved, Math.abs(dx));
      this.touchMove = Math.abs(dx) < 10 ? 0 : Math.max(-1, Math.min(1, (dx / 60) * tuning.touch));
    };
    const pu = (e: PointerEvent) => {
      if (e.pointerId !== active) return;
      if (moved < 12 && e.timeStamp - startT < 280) this.touchGulp = true;
      this.touchMove = 0; active = -1;
    };
    el.addEventListener("pointerdown", pd); el.addEventListener("pointermove", pm);
    el.addEventListener("pointerup", pu); el.addEventListener("pointercancel", pu);
    this.off.push(() => { el.removeEventListener("pointerdown", pd); el.removeEventListener("pointermove", pm); el.removeEventListener("pointerup", pu); el.removeEventListener("pointercancel", pu); });
  }

  detach() { for (const f of this.off.splice(0)) f(); this.down.clear(); this.pressed.clear(); }

  /** Read gamepads once per frame (their edges are computed here). */
  beginFrame() {
    this.pads.forEach((pad, i) => {
      const st = pad.poll(), down = st.connected ? pad.down() : [];
      this.padEdge[i] = { gulp: st.pressed.has("gulp"), bellow: st.pressed.has("bellow") };
      this.padMove[i] = st.left.x;
      this.padDpad[i] = down.includes(15) ? 1 : down.includes(14) ? -1 : 0;
    });
  }

  padsConnected(): boolean[] {
    return this.pads.map((p) => p.connected());
  }

  sample(ctls: readonly Ctl[]): Control {
    let move = 0, gulp = false, bellow = false;
    const merge = (m: number, g: boolean, b: boolean) => { if (Math.abs(m) > Math.abs(move)) move = m; gulp ||= g; bellow ||= b; };
    for (const c of ctls) {
      if (c === "kb1" || c === "kb2" || c === "kbAll") {
        for (const k of SCHEMES[c]) {
          const l = k.left.some((x) => this.down.has(x)), r = k.right.some((x) => this.down.has(x));
          merge((r ? 1 : 0) - (l ? 1 : 0), k.gulp.some((x) => this.pressed.has(x)), k.bellow.some((x) => this.pressed.has(x)));
        }
      } else if (c === "touch") merge(this.touchMove, this.touchGulp, false);
      else if (c.startsWith("pad")) {
        const i = Number(c.slice(3));
        if (!this.pads[i]?.connected()) continue;
        let m = this.padMove[i] ?? 0;
        if (Math.abs(m) < DEADZONE) m = 0;
        m = Math.max(-1, Math.min(1, m * tuning.pad));
        if (this.padDpad[i]) m = this.padDpad[i]!;
        merge(m, !!this.padEdge[i]?.gulp, !!this.padEdge[i]?.bellow);
      }
    }
    return { move, gulp, bellow };
  }

  endFrame() { this.pressed.clear(); this.touchGulp = false; }
}

/**
 * The controls a seat this machine plays answers to. Couch seats have their own; a
 * networked player has one seat, wherever the server put them, played with the
 * first entry (keyboard and touch).
 */
export function controlsFor(ctls: readonly (readonly Ctl[])[], seat: number): readonly Ctl[] {
  const own = ctls[seat];
  return own && own.length ? own : ctls.find((c) => c.length) ?? ["kbAll", "touch"];
}
