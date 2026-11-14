// The eqosys surfaces' small motion (./skin.ts): transform and opacity only, through the Web Animations API, so the
// compositor draws it and nothing runs once it ends. The DOM changes at once and the motion plays over the new state, so
// no click waits on it. None at all under prefers-reduced-motion. (Clock-driven scene motion is ./motion.ts.)

/** Soft out: quick off the mark, a long settle. */
export const EASE = "cubic-bezier(.2,.7,.2,1)";

const still = (el: HTMLElement) =>
  typeof el.animate !== "function" || typeof matchMedia !== "function" || matchMedia("(prefers-reduced-motion: reduce)").matches;

const parts = (box: HTMLElement) => [...box.querySelectorAll<HTMLElement>(":scope > [data-part]")];
const middle = (r: DOMRect) => r.left + r.width / 2;

/**
 * Swap `box`'s children with `change`, then let its parts (children with `data-part`) fold into place like a transformer:
 * a part in both states glides from where it stood, a new one unfolds out of the `home` part, and one that went folds back
 * into it as it fades. `swapped` hears a part whose element changed under the same name (Sign in turning into Sign out).
 * `box` needs to be a containing block (`position:relative` or more) for the parts that go.
 */
export function morph(box: HTMLElement, change: () => void, o: { home?: string; swapped?: (el: HTMLElement) => void } = {}): void {
  const was = new Map(parts(box).map((el) => [el.dataset.part!, { el, r: el.getBoundingClientRect() }]));
  if (still(box) || !box.isConnected || !was.size) return change();
  change();
  const frame = box.getBoundingClientRect(), now = parts(box);
  const home = now.find((el) => el.dataset.part === o.home)?.getBoundingClientRect();
  let i = 0;
  for (const el of now) {
    const r = el.getBoundingClientRect(), old = was.get(el.dataset.part!);
    was.delete(el.dataset.part!);
    if (old) {
      const dx = old.r.left - r.left, dy = old.r.top - r.top;
      if (Math.abs(dx) + Math.abs(dy) > 0.5) el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: "none" }], { duration: 260, easing: EASE });
      if (old.el !== el) o.swapped?.(el);
    } else {
      const dx = home ? (middle(home) - middle(r)) * 0.6 : -6;
      el.animate([{ transform: `translateX(${dx}px) scale(.6)`, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 280, delay: 40 * i++, easing: EASE, fill: "backwards" });
    }
  }
  // What went: a stand-in where it stood, folding into home as it fades, then gone.
  for (const { el, r } of was.values()) {
    const ghost = el.cloneNode(true) as HTMLElement;
    ghost.removeAttribute("data-part");
    ghost.setAttribute("aria-hidden", "true");
    ghost.inert = true;
    Object.assign(ghost.style, { position: "absolute", left: `${r.left - frame.left - box.clientLeft}px`, top: `${r.top - frame.top - box.clientTop}px`, width: `${r.width}px`, height: `${r.height}px`, margin: "0", pointerEvents: "none" });
    box.append(ghost);
    const dx = home ? middle(home) - middle(r) : -8;
    const a = ghost.animate([{ transform: "none", opacity: 1 }, { transform: `translateX(${dx}px) scale(.5)`, opacity: 0 }], { duration: 200, easing: EASE, fill: "forwards" });
    a.onfinish = a.oncancel = () => ghost.remove();
  }
}

/** A small press of life on `el`: a quick swell and settle, over whatever it already shows. */
export function pop(el: HTMLElement, from = 0.86): void {
  if (still(el)) return;
  el.animate([{ transform: `scale(${from})` }, { transform: "scale(1.06)", offset: 0.6 }, { transform: "none" }], { duration: 300, easing: EASE });
}
