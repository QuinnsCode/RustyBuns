// Keyboard and mouse. Click the view to capture the mouse (Esc lets go).
//   WASD / arrows  move        Shift  run         C / Ctrl  crouch
//   mouse          look        V      first/third person
//   F  flashlight (rangers)    Q  call out (rangers)   M  map / radio

export class Controls {
  yaw = 0;
  pitch = 0;
  private keys = new Set<string>();
  locked = false;
  crouchToggle = false;
  /** One-shot presses, read and cleared by the game loop. */
  private pressed = new Set<string>();
  sensitivity = 0.0022;

  constructor(private el: HTMLElement) {
    el.addEventListener("click", () => { if (!this.locked) void el.requestPointerLock?.(); });
    document.addEventListener("pointerlockchange", () => { this.locked = document.pointerLockElement === el; });
    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.yaw += e.movementX * this.sensitivity;
      this.pitch = Math.max(-1.3, Math.min(1.2, this.pitch - e.movementY * this.sensitivity));
    });
    window.addEventListener("keydown", (e) => {
      if ((e.target as HTMLElement).closest?.("input, textarea, select")) return;
      const k = e.code;
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      if (k === "KeyC" || k === "ControlLeft") this.crouchToggle = !this.crouchToggle;
      if (["Space", "ArrowUp", "ArrowDown", "Tab"].includes(k)) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
  }

  held(...codes: string[]) { return codes.some((c) => this.keys.has(c)); }
  /** True once per key press. */
  take(code: string) { const had = this.pressed.has(code); this.pressed.delete(code); return had; }
  clearPresses() { this.pressed.clear(); }

  move() {
    const fwd = (this.held("KeyW", "ArrowUp") ? 1 : 0) - (this.held("KeyS", "ArrowDown") ? 1 : 0);
    const right = (this.held("KeyD", "ArrowRight") ? 1 : 0) - (this.held("KeyA", "ArrowLeft") ? 1 : 0);
    return { fwd, right, run: this.held("ShiftLeft", "ShiftRight"), crouch: this.crouchToggle };
  }

  release() { if (this.locked) document.exitPointerLock(); }
}
