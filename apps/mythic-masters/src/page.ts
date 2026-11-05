// One page of the tome, shared by every menu screen: the title, the Bog Witch's sheet, the journal, the versus
// picker and its bestiary, a fight's result and the Settings card. Changing screen turns a leaf over: the page you
// were on swings away on its spine and the next one is under it. The journal's chapters turn through the same leaf.
// With reduced motion the screens just swap.

import { thumbAt } from "./demand.ts";

export const stillPages = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** What soaks in when a page is shown: every block of a page (a ledger's rows one by one, so an edit rewrites one
 * line), a scroll (but its title, which is printed on the cover and carries the scroll's roll), a sheet, a note, a
 * menu, the versus book's two leaves, and each block of a folio's inner parts (`.inks`). */
const INKS = ".page > :not(.lineup, .resting, .pages), .lineup > li, .resting > li, .pages > li, .inks > *, .scroll > :not(h1), .sheet > *, .note > *, .menu > *, .picks > div > *, .gc-card > *";
/** Who hears the pen: told how many lines are about to soak in and the beat between them (src/quill.ts). */
let pen: ((lines: number, stepMs: number) => void) | null = null;
export const penSound = (fn: typeof pen) => { pen = fn; };
/** What was last written on each root, block by block, so an edit rewrites only the lines that changed. */
const written = new WeakMap<Element, string[]>();
const lineOf = (el: Element) => el.outerHTML.replace(/ style="--i:[^"]*"/g, "").replace(/\bink\b ?/g, "");
/** Ink soaking into the page (#3523): every block on `root` comes in as a wet blot that settles into its words, one
 * after another down the page (`--i` is its turn; `--step` on the root is the beat between them, shorter on a long page). An `edit`
 * (the page redrawn while you read it) rewrites only the blocks whose words changed; the rest stay dry. Reduced
 * motion: nothing moves. */
export function soak(root: Element, edit = false) {
  if (stillPages()) return;
  const blocks = [...root.querySelectorAll<HTMLElement>(INKS)], lines = blocks.map(lineOf), was = written.get(root);
  const same = edit && was && was.length === lines.length;
  const wet = blocks.filter((_, k) => !(same && was[k] === lines[k]));
  // a beat between blocks, shorter on a long page so the last line is written inside about two and a half seconds
  const step = Math.min(95, 2400 / Math.max(1, wet.length));
  (root as HTMLElement).style.setProperty("--step", `${step.toFixed(0)}ms`);
  if (wet.length) pen?.(wet.length, step);
  wet.forEach((el, i) => {
    if (el.classList.contains("ink")) { el.classList.remove("ink"); void el.offsetWidth; }
    el.style.setProperty("--i", String(i));
    el.classList.add("ink");
  });
  written.set(root, lines);
}

const TURN = { duration: 640, easing: "cubic-bezier(.45,.05,.3,1)" };
const PERSPECTIVE = 2400;
const tilt = (deg: number) => `perspective(${PERSPECTIVE}px) rotateY(${deg}deg)`;

/** Swing a sheet over on its spine, `from` to `to` degrees, darkening as it stands on edge; it goes when it lands. */
export function swing(sheet: HTMLElement, from: number, to: number, origin: "left" | "right", remove = true): Promise<void> {
  sheet.style.transformOrigin = `${origin} center`;
  const fade = remove ? { opacity: 0.3 } : {};
  const solid = remove ? [{ opacity: 1, offset: 0.85 }] : []; // paper is opaque: it only fades as it lands
  return sheet.animate([{ transform: tilt(from) }, { filter: "brightness(0.7)", offset: 0.5 }, ...solid, { transform: tilt(to), ...fade }], TURN)
    .finished.then(() => undefined, () => undefined).finally(() => { if (remove) sheet.remove(); });
}

/** A picture lifting off one page and landing on the next (a bestiary plate growing into its folio's top left, and
 * shrinking back when the folio turns away): a copy of `src` flies from `from` to `to` over the turning leaf, and
 * `land` runs when it is down (at once with reduced motion, or when either end is not on screen). */
export function fly(src: string, from: DOMRect | undefined, to: DOMRect | undefined, land: () => void) {
  if (stillPages() || !from?.width || !to?.width) { land(); return; }
  const img = document.createElement("img");
  img.src = src; img.className = "flying"; img.setAttribute("aria-hidden", "true");
  const box = (r: DOMRect) => ({ left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  Object.assign(img.style, box(from));
  document.body.append(img);
  img.animate([box(from), box(to)], { duration: TURN.duration, easing: TURN.easing, fill: "forwards" }).finished.catch(() => undefined).finally(() => { img.remove(); land(); });
}

/** A copy of what is on a page now, with no ids (the live page keeps those), to swing away while the next one shows. */
export function sheetOf(page: Element): HTMLElement {
  const sheet = page.cloneNode(true) as HTMLElement;
  sheet.removeAttribute("id");
  sheet.hidden = false;
  sheet.inert = true;
  for (const el of sheet.querySelectorAll("[id]")) el.removeAttribute("id");
  sheet.classList.add("turning-page");
  sheet.setAttribute("aria-hidden", "true");
  return sheet;
}

/** Turn a leaf of the book over `box` (the whole tome on screen, its header too): forward from the right edge, back
 * from the left; a single page (a phone) always turns on its left edge, coming back over for back. `was` is the page
 * as it was (a copy taken before it was redrawn) and `now` the page as it is: the leaf carries the half of `was` it
 * lifts off and, on its back, the half of `now` it lands on (#3604 rounds 10 and 11).
 *
 * The leaf bends instead of swinging as a card: it is cut into strips (`STRIPS`, from the spine out) hinged one to the
 * next, the free edge leading, lifted first and laid down last (`leafFrames`). Each strip is shaded by its own angle
 * to the lamp, the free edge is deckled, the spine side curls out of the gutter, and a shadow follows the free edge. */
export function turnLeaf(host: Element, box: DOMRect, was: Node | null, now: Node | null, forward: boolean, spread: boolean) {
  if (stillPages()) return;
  const fromRight = forward || !spread, w = spread ? box.width / 2 : box.width, side: 1 | -1 = fromRight ? 1 : -1;
  const top = Math.max(box.top, 0), h = Math.min(box.bottom, innerHeight) - top;
  if (h <= 0) return;
  const [from, to] = !spread && !forward ? [-180, 0] : [0, forward ? -180 : 180];
  // its front is the half it lifts off (or, coming back over a phone's page, the page it lands on); its back, the
  // half of the new page it lands on
  const live = now instanceof Element ? pressed(now) : now; // the page under the leaf, off-screen parts emptied
  const front = !spread && !forward ? live : was, back = spread ? live : null;
  const at = (lifted: boolean) => (fromRight === lifted ? -(box.width - w) : 0); // where the tome sits under the leaf
  const left = fromRight ? box.right - w : box.left, frames = leafFrames(from, to, w), n = frames.length - 1;
  const strip = (i: number) => {
    const seg = document.createElement("div");
    seg.className = `turning ${fromRight ? "spine-left" : "spine-right"}`;
    seg.setAttribute("aria-hidden", "true");
    const lo = STRIPS[i]! * w - (i ? 1 : 0), hi = STRIPS[i + 1]! * w + 1; // from the spine, a pixel of overlap
    const [l, r] = fromRight ? [lo, w - hi] : [w - hi, lo];
    Object.assign(seg.style, { left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${h}px`, clipPath: `inset(0 ${Math.max(0, r)}px 0 ${Math.max(0, l)}px)`, transformOrigin: `${fromRight ? "left" : "right"} center` });
    const f = front ? print(seg, front, at(true), box.top - top, box.width, "face", front === was) : null;
    const b = back ? print(seg, back, at(false), box.top - top, box.width, "face back", false) : null;
    seg.animate(frames.map((fr, k) => {
      // the strips before this one, each turned on its hinge: the spine strip's angle, then each bend in turn
      let t = lean(side * -fr.angles[0]!);
      for (let j = 1; j <= i; j++) t += ` translateX(${side * STRIPS[j]! * w}px) rotateY(${side * -(fr.angles[j]! - fr.angles[j - 1]!)}deg) translateX(${-side * STRIPS[j]! * w}px)`;
      return { transform: t, filter: `brightness(${lamp(fr.angles[i]!).toFixed(3)})`, opacity: k / n > 0.85 ? 1 - ((k / n - 0.85) / 0.15) * 0.7 : 1 }; // paper is opaque: it only fades as it lands
    }), { ...TURN, fill: "forwards" });
    // which side you see: the front until the strip stands past upright, then its back, the far side's ink showing
    // through faintly as on real paper (the clip and the filter flatten the strip, so this is switched by hand)
    const shows = (k: number, frontSide: boolean) => ((Math.abs(frames[k]!.angles[i]!) < 90) === frontSide ? 1 : SHOW_THROUGH);
    f?.animate(frames.map((_, k) => ({ opacity: shows(k, true) })), { ...TURN, fill: "forwards" });
    b?.animate(frames.map((_, k) => ({ opacity: shows(k, false) })), { ...TURN, fill: "forwards" });
    return seg;
  };
  const shade = castShadow(box, top, h, (fromRight ? left : left + w) - box.left, side, frames);
  const strips = STRIPS.slice(0, -1).map((_, i) => strip(i));
  host.append(shade, ...strips);
  void strips[0]!.getAnimations()[0]?.finished.catch(() => undefined).finally(() => { for (const s of strips) s.remove(); shade.remove(); });
}

/** Where the leaf's strips meet, as fractions of its width from the spine (narrower toward the free edge, where it
 * bends most), and how much of the bend each strip has taken. */
const STRIP_COUNT = 7;
const STRIPS = Array.from({ length: STRIP_COUNT + 1 }, (_, i) => 1 - (1 - i / STRIP_COUNT) ** 0.7);
const BENT = Array.from({ length: STRIP_COUNT }, (_, i) => ((STRIPS[i]! + STRIPS[i + 1]!) / 2) ** 1.6);
const BEND = 46, SHOW_THROUGH = 0.07, STEPS = 24;
/** The leaf is seen from further off than a whole screen turning, so lifting toward you it stays over the book. */
const LEAF_DEPTH = 4200;
const lean = (deg: number) => `perspective(${LEAF_DEPTH}px) rotateY(${deg}deg)`;
/** A strip's light: full facing you, darkest edge-on (the lamp is in front of the book). */
const lamp = (deg: number) => 0.62 + 0.4 * Math.abs(Math.cos((deg * Math.PI) / 180));

/** The leaf through its turn: each strip's angle off the page (0 flat where it started, 180 flat over the spine),
 * `STEPS + 1` keyframes linear in the eased progress so the strips, their faces and the shadow keep in step. The free
 * edge leads by `BEND` at mid-turn and not at all at either end, the spine strip lagging a little. `edge` is where
 * the free edge is seen across the page from the spine, through the same perspective as the leaf; `lift` how far
 * off the page the leaf stands. */
export function leafFrames(from: number, to: number, w: number) {
  return Array.from({ length: STEPS + 1 }, (_, k) => {
    const p = k / STEPS, base = Math.abs(from + (to - from) * p), lead = BEND * Math.sin(Math.PI * p) * Math.sign(Math.abs(to) - Math.abs(from));
    const angles = BENT.map((b) => base + lead * (b - 0.35));
    let x = 0, z = 0;
    angles.forEach((a, i) => { const len = (STRIPS[i + 1]! - STRIPS[i]!) * w, r = (a * Math.PI) / 180; x += len * Math.cos(r); z += len * Math.sin(r); });
    return { angles, edge: x / (1 - z / LEAF_DEPTH), lift: Math.max(0, ...angles.map((a) => Math.sin((a * Math.PI) / 180))) };
  });
}

/** A copy of `live` for a leaf to carry, light enough to print on every strip: whatever lies off the screen (a long
 * bestiary's entries, a ledger's rows) is emptied down to the box it took, so the copy lays out the same but holds
 * only what can be seen. Take it while `live` is laid out (before a redraw, for the page you were reading). */
export function pressed(live: Element): Node {
  const copy = live.cloneNode(true);
  if (!(copy instanceof Element)) return copy;
  const BLOCKS = ".entry, li, section, figure, p, .page > *";
  const was = [...live.querySelectorAll(BLOCKS)], now = [...copy.querySelectorAll<HTMLElement>(BLOCKS)];
  let skip: Element | null = null;
  was.forEach((el, i) => {
    if (skip?.contains(el)) return;
    const r = el.getBoundingClientRect(), twin = now[i];
    if (!twin || (r.bottom > -40 && r.top < innerHeight + 40)) return;
    skip = el;
    twin.replaceChildren();
    Object.assign(twin.style, { height: `${r.height}px`, width: `${r.width}px`, boxSizing: "border-box" });
  });
  return copy;
}

/** A copy of the tome laid under a leaf: as wide as the tome, shifted so the part under the leaf shows, its ids
 * dropped (the live page keeps those); dry when it is the page you were reading, soaking in step with the live page
 * when it is the next. A back is printed mirrored (src/tome.css), so it reads once the leaf is over. */
function print(seg: HTMLElement, tome: Node, x: number, y: number, width: number, cls: string, dry: boolean) {
  const holder = document.createElement("div"), copy = tome.cloneNode(true);
  holder.className = cls;
  seg.append(holder);
  if (!(copy instanceof HTMLElement)) return holder;
  copy.removeAttribute("id");
  for (const el of copy.querySelectorAll("[id]")) el.removeAttribute("id");
  if (dry) for (const wet of copy.querySelectorAll(".ink")) wet.classList.remove("ink");
  Object.assign(copy.style, { left: `${x}px`, top: `${y}px`, width: `${width}px` });
  holder.append(copy);
  return holder;
}

/** The shadow a turning leaf casts on the page under it (#3604 round 10): a soft band just past its free edge as you
 * see it (`leafFrames`' `edge`), facing away from the spine, deepest while the leaf stands and gone when it lies flat.
 * `side` is where the free edge starts (1 right of the spine, -1 left). */
function castShadow(box: DOMRect, top: number, h: number, spine: number, side: 1 | -1, frames: ReturnType<typeof leafFrames>) {
  const shade = document.createElement("div"), band = document.createElement("i");
  shade.className = "turn-shade";
  shade.setAttribute("aria-hidden", "true");
  Object.assign(shade.style, { left: `${box.left}px`, top: `${top}px`, width: `${box.width}px`, height: `${h}px` });
  band.style.width = `${Math.min(box.width * 0.22, 260)}px`;
  shade.append(band);
  band.animate(frames.map((fr) => ({
    transform: `translateX(${(spine + side * fr.edge).toFixed(1)}px) scaleX(${(side * (fr.edge >= 0 ? 1 : -1) * (0.3 + 0.7 * fr.lift)).toFixed(3)})`,
    opacity: (0.6 * fr.lift).toFixed(3),
  })), { ...TURN, fill: "forwards" });
  return shade;
}

/** The book's screens, in reading order: showing one hides the rest, and the page that was open turns away over it
 * (forward when the next screen comes later in the book, back when it comes earlier). `null` closes the book
 * (the world, a fight): the last page still turns away over the scene. Opened over the scene (a fight's result),
 * the next page's paper is laid down instead, swinging in from the right. */
export function book(pages: readonly HTMLElement[]) {
  const open = () => pages.find((p) => !p.hidden) ?? null;
  let opened = 0;
  return {
    open,
    show(next: HTMLElement | null) {
      const was = open();
      for (const p of pages) p.hidden = p !== next;
      if (next && was !== next) { thumb(next, opened++); soak(next); }
      if (was === next || stillPages()) return;
      if (!was) { const paper = next?.querySelector<HTMLElement>(".paper"); if (paper) void swing(paper, -110, 0, "left", false); return; }
      const forward = !next || pages.indexOf(next) > pages.indexOf(was);
      const sheet = sheetOf(was);
      was.after(sheet);
      void swing(sheet, 0, forward ? -180 : 180, forward ? "left" : "right");
    },
  };
}

/** The book's one recurring stain (src/demand.ts): a rust-brown thumbprint pressed on the page, somewhere new each
 * time it is opened. It sits on the page's paper (the versus spread's: one of its two leaves) and never catches a click. */
export function thumb(page: HTMLElement, n: number) {
  const leaves = page.matches(".paper") ? [page] : [...page.querySelectorAll<HTMLElement>(".paper, .picks > div")];
  for (const old of page.querySelectorAll(".thumb")) old.remove();
  const leaf = leaves[n % Math.max(1, leaves.length)];
  if (!leaf) return;
  const t = thumbAt(n), i = document.createElement("i");
  i.className = "thumb";
  i.setAttribute("aria-hidden", "true");
  Object.assign(i.style, { left: `${t.x}%`, top: `${t.y}%`, width: `${t.size}px`, transform: `translate(-50%, -50%) rotate(${t.turn}deg)` });
  leaf.append(i);
}

/** A dialog's card laid onto the book (Settings): it swings down from the right when it opens, and turns away when
 * it shuts (a copy of the dialog, its scrim clear, so the card keeps its look while it goes). */
export function cardTurn(dialog: HTMLElement, opening: boolean) {
  const card = dialog.querySelector<HTMLElement>(".gc-card");
  if (!card || stillPages()) return;
  if (opening) { soak(dialog); void swing(card, -110, 0, "left", false).then(() => { card.style.transformOrigin = ""; }); return; }
  const sheet = sheetOf(dialog), leaf = sheet.querySelector<HTMLElement>(".gc-card");
  if (!leaf) return;
  Object.assign(sheet.style, { background: "transparent", zIndex: "1001" });
  dialog.after(sheet);
  void swing(leaf, 0, -180, "left", false).then(() => sheet.remove());
}
