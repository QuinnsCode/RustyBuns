// Touch controls: a thumb stick (steer, throttle) and hold buttons for boost and manual. The other half of the
// screen is the flick pad (gesture.ts, with its grip tape from griptape.ts); the flick profile says which half. Shown only once a finger touches the page.
import { createElement, Gauge, MoveUp } from "lucide";
import { stickAxes as axes } from "@rustybuns/util";

export const STICK_RADIUS = 56; // pixels of thumb travel for a full push
const DEAD = 0.18; // fraction of the radius that reads as centred

/** A thumb offset from the stick's centre (screen pixels, y down) as sim axes: throttle up is +1, steer left is +1. */
export function stickAxes(dx: number, dy: number, dead = DEAD): { steer: number; throttle: number } {
  const a = axes(dx, dy, STICK_RADIUS, dead);
  return { steer: -a.x || 0, throttle: -a.y || 0 };
}

export interface Touch { steer: number; throttle: number; boost: boolean; manual: boolean; claims: (id: number) => boolean; root: HTMLElement; invertX: boolean; invertY: boolean; dead: number }

export function mountTouch(): Touch {
  const owned = new Set<number>(); // pointers that belong to a control, not to the flick pad
  const root = document.createElement("div");
  const t: Touch = { steer: 0, throttle: 0, boost: false, manual: false, claims: (id) => owned.has(id), root, invertX: false, invertY: false, dead: DEAD };
  root.className = "touch";
  root.hidden = true;
  const base = document.createElement("div"), nub = document.createElement("div");
  base.className = "stick";
  nub.className = "nub";
  base.append(nub);
  const hold = (cls: string, label: string, glyph: Parameters<typeof createElement>[0], on: (down: boolean) => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `hold ${cls}`;
    b.title = label;
    b.setAttribute("aria-label", label);
    b.append(createElement(glyph, { width: 26, height: 26 }));
    b.addEventListener("pointerdown", (e) => { owned.add(e.pointerId); b.setPointerCapture(e.pointerId); b.dataset.on = "1"; on(true); });
    const off = (e: PointerEvent) => { owned.delete(e.pointerId); delete b.dataset.on; on(false); };
    b.addEventListener("pointerup", off);
    b.addEventListener("pointercancel", off);
    return b;
  };
  root.append(
    base,
    hold("boost", "Boost", Gauge, (d) => { t.boost = d; }),
    hold("manual", "Manual", MoveUp, (d) => { t.manual = d; }),
  );
  document.body.append(root);

  let pad = -1, ox = 0, oy = 0;
  const aim = (e: PointerEvent) => {
    const r = base.getBoundingClientRect();
    ox = r.left + r.width / 2; oy = r.top + r.height / 2;
    drag(e);
  };
  const drag = (e: PointerEvent) => {
    const a = stickAxes(e.clientX - ox, e.clientY - oy, t.dead);
    t.steer = t.invertX ? -a.steer || 0 : a.steer; t.throttle = t.invertY ? -a.throttle || 0 : a.throttle;
    const k = Math.min(1, STICK_RADIUS / Math.max(1, Math.hypot(e.clientX - ox, e.clientY - oy)));
    nub.style.transform = `translate(${(e.clientX - ox) * k}px, ${(e.clientY - oy) * k}px)`;
  };
  const release = (e: PointerEvent) => {
    if (e.pointerId !== pad) return;
    owned.delete(pad); pad = -1; t.steer = t.throttle = 0;
    nub.style.transform = "";
  };
  base.addEventListener("pointerdown", (e) => { pad = e.pointerId; owned.add(pad); base.setPointerCapture(pad); aim(e); });
  base.addEventListener("pointermove", (e) => { if (e.pointerId === pad) drag(e); });
  base.addEventListener("pointerup", release);
  base.addEventListener("pointercancel", release);
  window.addEventListener("touchstart", () => { root.hidden = false; }, { once: true, passive: true });
  if (matchMedia("(pointer: coarse)").matches) root.hidden = false;
  return t;
}
