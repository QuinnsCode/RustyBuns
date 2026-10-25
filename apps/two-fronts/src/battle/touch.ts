// On-screen controls for a phone or tablet: a stick on the left, buttons on the right, and a drag
// anywhere else to look (ground) or steer (space). Both battle views feed their keyboard and mouse
// state from the same handlers, so touch plays the same battle. Mounted only on a coarse pointer.
import { icon } from "../ui/icons.ts";

// `?touch=1` forces them on, for trying it from a desktop browser.
export const isTouch = () => matchMedia("(pointer: coarse)").matches || new URLSearchParams(location.search).get("touch") === "1";

export type TouchButton = { id: string; icon: string; label: string; hold?: boolean; row?: boolean; on(down: boolean): void };
export type TouchOptions = {
  stick?(forward: number, right: number): void;          // -1..1 on each axis, 0 when let go
  drag?(dx: number, dy: number, x: number, y: number): void; // a finger moving on the field: pixels moved, and where it is now
  buttons: TouchButton[];
};

export function mountTouch(host: HTMLElement, canvas: HTMLElement, opts: TouchOptions): () => void {
  const root = document.createElement("div");
  root.className = "touch";
  root.innerHTML = `${opts.stick ? `<div class="touch-stick" aria-label="Move"><i></i></div>` : ""}${[false, true].map((row) => `<div class="${row ? "touch-row" : "touch-btns"}">${opts.buttons.filter((b) => !!b.row === row)
    .map((b) => `<button type="button" class="touch-btn" data-id="${b.id}" aria-label="${b.label}" title="${b.label}">${icon(b.icon, 22)}</button>`).join("")}</div>`).join("")}`;
  host.appendChild(root);
  document.body.classList.add("touch");

  const off: Array<() => void> = [];
  const on = <T extends Event>(el: EventTarget, type: string, fn: (e: T) => void) => { el.addEventListener(type, fn as EventListener); off.push(() => el.removeEventListener(type, fn as EventListener)); };

  // The stick: the thumb's offset from where it landed, as far as the ring allows.
  const stickEl = root.querySelector<HTMLElement>(".touch-stick");
  if (stickEl && opts.stick) {
    const knob = stickEl.querySelector<HTMLElement>("i")!, R = 48;
    let id = -1, ox = 0, oy = 0;
    const set = (e: PointerEvent) => {
      let dx = e.clientX - ox, dy = e.clientY - oy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      opts.stick!(-dy / R, dx / R);
    };
    on<PointerEvent>(stickEl, "pointerdown", (e) => { id = e.pointerId; stickEl.setPointerCapture(id); const r = stickEl.getBoundingClientRect(); ox = r.left + r.width / 2; oy = r.top + r.height / 2; set(e); e.preventDefault(); });
    on<PointerEvent>(stickEl, "pointermove", (e) => { if (e.pointerId === id) set(e); });
    const end = (e: PointerEvent) => { if (e.pointerId !== id) return; id = -1; knob.style.transform = ""; opts.stick!(0, 0); };
    on<PointerEvent>(stickEl, "pointerup", end); on<PointerEvent>(stickEl, "pointercancel", end);
  }

  for (const b of opts.buttons) {
    const el = root.querySelector<HTMLElement>(`[data-id="${b.id}"]`)!;
    on<PointerEvent>(el, "pointerdown", (e) => { el.setPointerCapture(e.pointerId); el.classList.add("down"); b.on(true); e.preventDefault(); });
    const up = () => { if (!el.classList.contains("down")) return; el.classList.remove("down"); if (b.hold) b.on(false); };
    on(el, "pointerup", up); on(el, "pointercancel", up);
  }

  // A finger on the field itself looks or steers. Fingers on the controls never reach it.
  if (opts.drag) {
    let id = -1, x = 0, y = 0;
    on<PointerEvent>(canvas, "pointerdown", (e) => { if (e.pointerType === "mouse" || id >= 0) return; id = e.pointerId; x = e.clientX; y = e.clientY; opts.drag!(0, 0, x, y); });
    on<PointerEvent>(canvas, "pointermove", (e) => { if (e.pointerId !== id) return; opts.drag!(e.clientX - x, e.clientY - y, e.clientX, e.clientY); x = e.clientX; y = e.clientY; });
    const end = (e: PointerEvent) => { if (e.pointerId === id) id = -1; };
    on<PointerEvent>(canvas, "pointerup", end); on<PointerEvent>(canvas, "pointercancel", end);
  }
  return () => { off.forEach((f) => f()); root.remove(); document.body.classList.remove("touch"); };
}
