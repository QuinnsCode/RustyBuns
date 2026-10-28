// Keyboard and mouse. Click the view to capture the mouse (Esc lets go).
//   WASD / arrows  move        Shift  run         C  crouch (hold: go prone)
//   X  hold to climb a tree
//   mouse          look        V      first/third person
//   F  flashlight (rangers)    Q  call out (rangers)   M  map / radio

/** How long crouch is held before it becomes prone. */
export const PRONE_HOLD_MS = 450;

export class Controls {
  yaw = 0;
  pitch = 0;
  private keys = new Set<string>();
  locked = false;
  /** In a round: only then do keys count, and only then is Tab kept from moving focus. */
  private _active = false;
  get active() { return this._active; }
  set active(v: boolean) { this._active = v; if (this.pad) this.pad.style.display = v ? "block" : "none"; }
  /** Phones: left thumb stick, drag the right to look, buttons for the keys. */
  touch = false;
  private pad?: HTMLElement;
  private stick = { x: 0, y: 0 };
  private runBtn = false;
  crouchToggle = false;
  /** When the crouch key or button went down, while it's still down (hold it to go prone). */
  private crouchDownAt = 0;
  private climbBtn = false;
  /** One-shot presses, read and cleared by the game loop. */
  private pressed = new Set<string>();
  sensitivity = 0.0022;
  /** The cog's look speeds (1 as shipped): mouse X/Y, touch drag, and Y flipped. */
  look = { lookX: 1, lookY: 1, touch: 1, invertY: false };
  private ySign() { return this.look.invertY ? -1 : 1; }

  constructor(private el: HTMLElement) {
    // Chrome refuses a new lock for a moment after Esc; the next click tries again.
    el.addEventListener("click", () => { if (!this.locked) el.requestPointerLock?.()?.catch?.(() => {}); });
    document.addEventListener("pointerlockchange", () => { this.locked = document.pointerLockElement === el; });
    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.yaw += e.movementX * this.sensitivity * this.look.lookX;
      this.pitch = Math.max(-1.3, Math.min(1.2, this.pitch - e.movementY * this.sensitivity * this.look.lookY * this.ySign()));
    });
    window.addEventListener("keydown", (e) => {
      if (!this.active || (e.target as HTMLElement).closest?.("input, textarea, select")) return;
      const k = e.code;
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      // Not Ctrl: Ctrl+W, pressed to crouch and walk, closes the tab.
      if (k === "KeyC" && !e.repeat) { this.crouchToggle = !this.crouchToggle; this.crouchDownAt = performance.now(); }
      if (["Space", "ArrowUp", "ArrowDown", "Tab"].includes(k)) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => { this.keys.delete(e.code); if (e.code === "KeyC") this.crouchDownAt = 0; });
    window.addEventListener("blur", () => { this.keys.clear(); this.crouchDownAt = 0; });
    if (matchMedia("(pointer: coarse)").matches) this.touchControls(el);
  }

  private touchControls(view: HTMLElement) {
    this.touch = true;
    this.locked = true; // no click-to-capture on a phone
    view.style.touchAction = "none";
    const pad = this.pad = document.createElement("div");
    pad.style.cssText = "position:fixed;inset:0;pointer-events:none;display:none;z-index:20;touch-action:none;user-select:none;-webkit-user-select:none";
    document.body.append(pad);
    const css = "position:absolute;pointer-events:auto;touch-action:none;display:flex;align-items:center;justify-content:center;color:#fff;font:600 13px system-ui;background:rgba(20,24,30,.55);border:2px solid rgba(255,255,255,.45);border-radius:50%;";
    const zone = document.createElement("div");
    zone.style.cssText = css + "left:max(18px,env(safe-area-inset-left));bottom:max(24px,env(safe-area-inset-bottom));width:140px;height:140px";
    const knob = document.createElement("div");
    knob.style.cssText = "width:60px;height:60px;border-radius:50%;background:rgba(255,255,255,.7);pointer-events:none";
    zone.append(knob); pad.append(zone);
    let sid = -1, ox = 0, oy = 0;
    const setStick = (t: Touch) => {
      const dx = t.clientX - ox, dy = t.clientY - oy, m = Math.min(1, Math.hypot(dx, dy) / 60), a = Math.atan2(dy, dx);
      this.stick = { x: Math.cos(a) * m, y: Math.sin(a) * m };
      knob.style.transform = `translate(${this.stick.x * 40}px,${this.stick.y * 40}px)`;
    };
    zone.addEventListener("touchstart", (e) => {
      e.preventDefault();
      const t = e.changedTouches[0]!; sid = t.identifier;
      const r = zone.getBoundingClientRect(); ox = r.left + r.width / 2; oy = r.top + r.height / 2;
      setStick(t);
    }, { passive: false });
    zone.addEventListener("touchmove", (e) => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === sid) setStick(t); }, { passive: false });
    const end = (e: TouchEvent) => { for (const t of e.changedTouches) if (t.identifier === sid) { sid = -1; this.stick = { x: 0, y: 0 }; knob.style.transform = ""; } };
    zone.addEventListener("touchend", end); zone.addEventListener("touchcancel", end);

    const btn = (label: string, right: number, bottom: number, size: number, on: (el: HTMLElement) => void) => {
      const b = document.createElement("div");
      b.textContent = label;
      b.style.cssText = css + `right:calc(${right}px + env(safe-area-inset-right));bottom:calc(${bottom}px + env(safe-area-inset-bottom));width:${size}px;height:${size}px`;
      b.addEventListener("touchstart", (e) => { e.preventDefault(); on(b); }, { passive: false });
      pad.append(b); return b;
    };
    btn("Run", 18, 24, 64, (b) => { this.runBtn = !this.runBtn; b.style.background = this.runBtn ? "rgba(120,200,90,.8)" : "rgba(20,24,30,.55)"; });
    const crouchBtn = btn("Crouch", 92, 24, 64, (b) => { this.crouchToggle = !this.crouchToggle; this.crouchDownAt = performance.now(); b.style.background = this.crouchToggle ? "rgba(120,200,90,.8)" : "rgba(20,24,30,.55)"; });
    const crouchUp = () => { this.crouchDownAt = 0; };
    crouchBtn.addEventListener("touchend", crouchUp); crouchBtn.addEventListener("touchcancel", crouchUp);
    const climb = btn("Climb", 150, 24, 64, () => { this.climbBtn = true; climb.style.background = "rgba(120,200,90,.8)"; });
    const climbUp = () => { this.climbBtn = false; climb.style.background = "rgba(20,24,30,.55)"; };
    climb.addEventListener("touchend", climbUp); climb.addEventListener("touchcancel", climbUp);
    btn("Map", 18, 98, 56, () => this.pressed.add("KeyM"));
    btn("Cam", 84, 98, 56, () => this.pressed.add("KeyV"));
    btn("Light", 18, 164, 56, () => this.pressed.add("KeyF"));
    btn("Call", 84, 164, 56, () => this.pressed.add("KeyQ"));
    btn("Hide", 150, 98, 56, () => this.pressed.add("KeyE"));

    // Drag anywhere else on the view to look.
    let lid = -1, lx = 0, ly = 0;
    view.addEventListener("touchstart", (e) => { if (lid < 0) { const t = e.changedTouches[0]!; lid = t.identifier; lx = t.clientX; ly = t.clientY; } }, { passive: true });
    view.addEventListener("touchmove", (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === lid) {
        this.yaw += (t.clientX - lx) * this.sensitivity * 1.6 * this.look.touch * this.look.lookX;
        this.pitch = Math.max(-1.3, Math.min(1.2, this.pitch - (t.clientY - ly) * this.sensitivity * 1.6 * this.look.touch * this.look.lookY * this.ySign()));
        lx = t.clientX; ly = t.clientY;
      }
    }, { passive: false });
    const lend = (e: TouchEvent) => { for (const t of e.changedTouches) if (t.identifier === lid) lid = -1; };
    view.addEventListener("touchend", lend); view.addEventListener("touchcancel", lend);
  }

  held(...codes: string[]) { return codes.some((c) => this.keys.has(c)); }
  /** True once per key press. */
  take(code: string) { const had = this.pressed.has(code); this.pressed.delete(code); return had; }
  clearPresses() { this.pressed.clear(); }

  move() {
    let fwd = (this.held("KeyW", "ArrowUp") ? 1 : 0) - (this.held("KeyS", "ArrowDown") ? 1 : 0);
    let right = (this.held("KeyD", "ArrowRight") ? 1 : 0) - (this.held("KeyA", "ArrowLeft") ? 1 : 0);
    if (this.stick.x || this.stick.y) { fwd = -this.stick.y; right = this.stick.x; }
    // Holding crouch for a moment lies you flat; let go and you're back to a crouch.
    const prone = this.crouchDownAt > 0 && performance.now() - this.crouchDownAt > PRONE_HOLD_MS;
    if (prone) this.crouchToggle = true;
    return { fwd, right, run: this.held("ShiftLeft", "ShiftRight") || this.runBtn, crouch: this.crouchToggle, prone, climb: this.held("KeyX") || this.climbBtn };
  }

  release() { if (this.locked) document.exitPointerLock(); }
}
