// Q Amp's pedalboard on the page: every tile's place in the chain (the amp is a tile too: what comes after it
// is in its effects loop), and the grip that moves a tile, dragged or with the arrow keys. The audio thread
// gets the chain as `AmpSettings.chain` (live.ts).
import { PEDALS } from "../circuit/amps.ts";
import { icon } from "./icons.ts";
import { h } from "./dom.ts";

/** The amp's own tile. */
export const AMP_SLOT = "amp";
/** The effects loop's machines, as tiles. */
export const MACHINES = ["bbd", "tape", "spring"] as const;
export type MachineId = (typeof MACHINES)[number];
export const isMachine = (id: string): id is MachineId => (MACHINES as readonly string[]).includes(id);

/** A fresh board: every pedal and the bench in front, the amp, then the loop's machines in a real loop's order (modulation, echo, reverb). */
export const freshOrder = (): string[] => [...PEDALS.map((p) => p.id), "bench", AMP_SLOT, ...MACHINES];

/** `order` with every tile once: unknown ids and repeats dropped, missing ones put back after what comes before them on a fresh board. */
export function tidyOrder(order: readonly string[]): string[] {
  const fresh = freshOrder(), known = new Set(fresh), out: string[] = [];
  for (const id of order) if (known.has(id) && !out.includes(id)) out.push(id);
  fresh.forEach((id, i) => {
    if (out.includes(id)) return;
    const before = fresh.slice(0, i).reverse().find((b) => out.includes(b));
    out.splice(before ? out.indexOf(before) + 1 : 0, 0, id);
  });
  return out;
}

/** `order` with `id` moved to place `to` (clamped). */
export function moveTo(order: readonly string[], id: string, to: number): string[] {
  const out = order.filter((x) => x !== id);
  if (out.length === order.length) return [...order];
  out.splice(Math.max(0, Math.min(out.length, Math.round(to))), 0, id);
  return out;
}

/**
 * A grip for the tile `id` on `floor`: drag it over another tile to take that tile's place, or focus it and
 * press the left or right arrow. `move` gets the new place.
 */
export function grip(id: string, name: string, floor: HTMLElement, order: () => string[], move: (to: number) => void): HTMLButtonElement {
  const b = h("button", "grip", icon("grip-vertical", 16));
  b.type = "button";
  b.title = `Move ${name} along the board (drag, or the arrow keys)`;
  b.setAttribute("aria-label", `Move ${name}`);
  b.addEventListener("keydown", (e) => {
    const step = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : 0;
    if (!step) return;
    e.preventDefault();
    move(order().indexOf(id) + step);
    b.focus();
  });
  b.addEventListener("pointerdown", (e) => {
    b.setPointerCapture(e.pointerId);
    floor.classList.add("sorting");
    const over = (ev: PointerEvent) => {
      // The tile nearest the pointer: its place is where this one goes.
      let best = -1, dist = Infinity;
      for (const el of floor.querySelectorAll<HTMLElement>("[data-slot]")) {
        const r = el.getBoundingClientRect(), d = Math.hypot(ev.clientX - (r.left + r.width / 2), ev.clientY - (r.top + r.height / 2));
        if (d < dist) { dist = d; best = order().indexOf(el.dataset.slot ?? ""); }
      }
      if (best >= 0 && best !== order().indexOf(id)) move(best);
    };
    const up = () => { floor.classList.remove("sorting"); b.removeEventListener("pointermove", over); b.removeEventListener("pointerup", up); b.removeEventListener("pointercancel", up); };
    b.addEventListener("pointermove", over);
    b.addEventListener("pointerup", up);
    b.addEventListener("pointercancel", up);
  });
  return b;
}

/** A tile's load readout: its share of the audio thread. */
export const loadChip = (): HTMLSpanElement => {
  const el = h("span", "slot-load", "--");
  el.title = "This slot's share of the audio thread";
  return el;
};
