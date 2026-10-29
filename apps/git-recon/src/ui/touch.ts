// Touch controls: a left-thumb stick to move, a drag anywhere else to aim, and buttons on the right to
// fire (hold), jump, dive-roll, crouch, reload, swap guns and step the rebase scope. The soldier is otherwise driven by the mouse
// and keys (main.ts); this fills the same Input. Shown on a coarse pointer, or once a finger touches the page.
import { ArrowBigUp, ArrowRightLeft, ChevronsDown, createElement, Crosshair, Focus, LogOut, RefreshCw, RotateCw } from "lucide";
import { stickAxes } from "@rustybuns/util";

export const STICK_RADIUS = 52; // pixels of thumb travel for a full push
const LOOK = 0.0055; // radians per pixel of drag

/** Keeps a pointer's moves coming to `el` once it's left it; a pointer already gone (or a synthetic one) just isn't held. */
const capture = (el: Element, id: number) => { try { el.setPointerCapture(id); } catch {} };

/** One-shot actions a tap sets; the frame that reads them clears them. */
export type Tap = "jump" | "roll" | "reload" | "next" | "scope" | "leave";

export interface Touch {
  /** Whether the page is being driven by touch at all: the controls are on screen. */
  on: boolean;
  forward: number;
  right: number;
  fire: boolean;
  /** Jump held: thrusters in the roadster, climb in the helicopter. */
  up: boolean;
  /** The crouch button toggles. */
  crouch: boolean;
  tap: Set<Tap>;
  /** The aim's drag since last asked, in radians of yaw and pitch (and zeroed). */
  look: () => { yaw: number; pitch: number };
  /** Whether a pointer is on a control (so the page doesn't treat it as a click on the view). */
  claims: (id: number) => boolean;
}

/** `view` is where a drag aims; the controls go in `hud`, so they come and go with it. */
export function mountTouch(view: HTMLElement, hud: HTMLElement): Touch {
  const owned = new Set<number>();
  let dx = 0, dy = 0;
  const t: Touch = {
    on: false, forward: 0, right: 0, fire: false, up: false, crouch: false, tap: new Set(),
    look: () => {
      const r = { yaw: -dx * LOOK, pitch: -dy * LOOK };
      dx = dy = 0;
      return r;
    },
    claims: (id) => owned.has(id),
  };
  const root = document.createElement("div");
  root.className = "touch";
  root.hidden = true;
  const base = document.createElement("div"), nub = document.createElement("div");
  base.className = "stick";
  nub.className = "nub";
  base.append(nub);

  const button = (cls: string, label: string, glyph: Parameters<typeof createElement>[0], down: (e: PointerEvent) => void, up?: (e: PointerEvent) => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `tb ${cls}`;
    b.title = label;
    b.setAttribute("aria-label", label);
    b.append(createElement(glyph, { width: 26, height: 26 }));
    b.addEventListener("pointerdown", (e) => { owned.add(e.pointerId); b.dataset.on = "1"; down(e); capture(b, e.pointerId); });
    const off = (e: PointerEvent) => { owned.delete(e.pointerId); delete b.dataset.on; up?.(e); };
    b.addEventListener("pointerup", off);
    b.addEventListener("pointercancel", off);
    return b;
  };
  const once = (what: Tap) => () => t.tap.add(what);
  const crouch = button("crouch", "Crouch", ChevronsDown, () => { t.crouch = !t.crouch; crouch.setAttribute("aria-pressed", String(t.crouch)); });
  root.append(
    base,
    button("fire", "Fire", Crosshair, () => { t.fire = true; }, () => { t.fire = false; }),
    button("jump", "Jump (hold for thrusters, or to climb)", ArrowBigUp, () => { t.up = true; t.tap.add("jump"); }, () => { t.up = false; }),
    button("roll", "Dive-roll", RotateCw, once("roll")),
    crouch,
    button("reload", "Reload", RefreshCw, once("reload")),
    button("next", "Next gun", ArrowRightLeft, once("next")),
    button("scope", "Scope (rebase): tap to step in, again further, again out", Focus, once("scope")),
    button("leave", "Back to the menu", LogOut, once("leave")),
  );
  hud.append(root);

  // The stick: the thumb's offset from its centre is the push.
  let pad = -1, ox = 0, oy = 0;
  const drag = (e: PointerEvent) => {
    const a = stickAxes(e.clientX - ox, e.clientY - oy, STICK_RADIUS);
    t.right = a.x, t.forward = -a.y;
    const k = Math.min(1, STICK_RADIUS / Math.max(1, Math.hypot(e.clientX - ox, e.clientY - oy)));
    nub.style.transform = `translate(${(e.clientX - ox) * k}px, ${(e.clientY - oy) * k}px)`;
  };
  const release = (e: PointerEvent) => {
    if (e.pointerId !== pad) return;
    owned.delete(pad), pad = -1, t.forward = t.right = 0;
    nub.style.transform = "";
  };
  base.addEventListener("pointerdown", (e) => {
    const r = base.getBoundingClientRect();
    ox = r.left + r.width / 2, oy = r.top + r.height / 2;
    pad = e.pointerId, owned.add(pad), drag(e), capture(base, pad);
  });
  base.addEventListener("pointermove", (e) => e.pointerId === pad && drag(e));
  base.addEventListener("pointerup", release);
  base.addEventListener("pointercancel", release);

  // Aim: a finger anywhere else on the view drags the camera. One at a time; the first wins.
  let aim = -1, ax = 0, ay = 0;
  view.addEventListener("pointerdown", (e) => {
    if (!t.on || aim >= 0 || owned.has(e.pointerId)) return;
    aim = e.pointerId, ax = e.clientX, ay = e.clientY, owned.add(aim);
    capture(view, aim);
  });
  view.addEventListener("pointermove", (e) => {
    if (e.pointerId !== aim) return;
    dx += e.clientX - ax, dy += e.clientY - ay, ax = e.clientX, ay = e.clientY;
  });
  const drop = (e: PointerEvent) => {
    if (e.pointerId !== aim) return;
    owned.delete(aim), aim = -1;
  };
  view.addEventListener("pointerup", drop);
  view.addEventListener("pointercancel", drop);

  const show = () => { t.on = true, root.hidden = false, document.documentElement.classList.add("touch"); };

  window.addEventListener("touchstart", show, { once: true, passive: true });
  if (matchMedia("(pointer: coarse)").matches) show();
  return t;
}
