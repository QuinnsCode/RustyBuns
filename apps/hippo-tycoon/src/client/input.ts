// Keyboard, gamepad and touch -> one control per seat. Sampled once per frame:
// move is a level, gulp and bellow are edges (a press since the last sample).

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

export const CTL_LABEL: Record<Ctl, string> = {
  bot: "Bot", kb1: "A / D  W  Q", kb2: "← / →  ↑  /", kbAll: "Keyboard", pad0: "Gamepad 1", pad1: "Gamepad 2", pad2: "Gamepad 3", pad3: "Gamepad 4", touch: "Touch",
};

export class Controls {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private padPrev: boolean[][] = [];
  private padEdge: { gulp: boolean; bellow: boolean }[] = [];
  private touchMove = 0;
  private touchGulp = false;
  private off: (() => void)[] = [];

  attach(target: Window = window) {
    const kd = (e: KeyboardEvent) => {
      if (ALL_CODES.has(e.code) && !(e.target instanceof HTMLInputElement)) e.preventDefault();
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
      this.touchMove = Math.abs(dx) < 10 ? 0 : Math.max(-1, Math.min(1, dx / 60));
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
    const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < 4; i++) {
      const p = pads[i];
      const now = p ? p.buttons.map((b) => b.pressed) : [];
      const prev = this.padPrev[i] ?? [];
      this.padEdge[i] = { gulp: !!now[0] && !prev[0], bellow: !!now[1] && !prev[1] };
      this.padPrev[i] = now;
    }
  }

  padsConnected(): boolean[] {
    const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
    return [0, 1, 2, 3].map((i) => !!pads[i]);
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
        const i = Number(c.slice(3)), p = navigator.getGamepads?.()[i];
        if (!p) continue;
        let m = p.axes[0] ?? 0;
        if (Math.abs(m) < DEADZONE) m = 0;
        if (p.buttons[14]?.pressed) m = -1;
        if (p.buttons[15]?.pressed) m = 1;
        merge(m, !!this.padEdge[i]?.gulp, !!this.padEdge[i]?.bellow);
      }
    }
    return { move, gulp, bellow };
  }

  endFrame() { this.pressed.clear(); this.touchGulp = false; }
}
