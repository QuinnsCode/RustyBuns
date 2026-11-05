// One page of the tome, shared by every menu screen: the title, the Bog Witch's sheet, the journal, the versus
// picker and its bestiary, a fight's result and the Settings card. Changing screen turns a leaf over: the page you
// were on swings away on its spine and the next one is under it. The journal's chapters turn through the same leaf.
// With reduced motion the screens just swap.

import { thumbAt } from "./demand.ts";

export const stillPages = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** What soaks in when a page is shown: every block of a page (a ledger's rows one by one, so an edit rewrites one
 * line), a scroll (but its title, which is printed on the cover and carries the scroll's roll), a sheet, a note, a
 * menu, the versus book's two leaves, and each block of a folio's inner parts (`.inks`). */
const INKS = ".page > :not(.lineup, .resting, .pages, .menu), .lineup > li, .resting > li, .pages > li, .inks > *, .sheet > *, .note > :not(.seal, .tear, .leaf-head), .menu > *, .picks > div > *, .gc-card > *";
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
  // a page still swinging open is foreshortened, so its lines can't be measured yet: the pen waits for it to land
  const settle = landing(wet);
  (root as HTMLElement).style.setProperty("--after", `${settle.toFixed(0)}ms`);
  wet.forEach((el, i) => {
    if (el.classList.contains("ink")) { el.classList.remove("ink"); void el.offsetWidth; }
    el.style.setProperty("--i", String(i));
    // where the drop fell: anywhere along the block (a heading's near its start, where the pen is), a little high or
    // low, never the same twice running
    const heading = /^H[1-4]$/.test(el.tagName);
    el.style.setProperty("--ox", `${heading ? 4 + ((i * 37) % 14) : 8 + ((i * 37) % 61)}%`);
    el.style.setProperty("--oy", `${30 + ((i * 53) % 41)}%`);
    // how far the drop must run to soak the whole block: its core ends at 66% of the drop's height, from a point
    // as far as 70% down it, so a tall block (a Settings pane) is not left half-masked at its far end
    el.style.setProperty("--reach", `${Math.ceil(Math.max(900, (el.offsetHeight * 0.75 + 40) / 0.6, (el.offsetWidth * 0.95) / (0.6 * 1.6)))}px`);
    if (settle) hold(el); else write(el);
    el.classList.add("ink");
  });
  if (settle) setTimeout(() => later(wet), settle + 20);
  written.set(root, lines);
}

/** How long until whatever carries these blocks stops moving (a page swinging open over them), in ms; 0 when still. */
function landing(blocks: readonly Element[]) {
  let ms = 0;
  for (const a of document.getAnimations()) {
    const fx = a.effect;
    if (!(fx instanceof KeyframeEffect) || !fx.target || fx.pseudoElement || a.playState !== "running") continue;
    const t = fx.target;
    if (!blocks.some((b) => t.contains(b)) || !fx.getKeyframes().some((k) => k.transform)) continue;
    const end = Number(fx.getComputedTiming().endTime), now = Number(a.currentTime ?? 0);
    if (Number.isFinite(end)) ms = Math.max(ms, end - now);
  }
  return Math.min(ms, 1500);
}

/** Write the held blocks once their page lies flat, trying a few frames more if it is still settling; one that
 * never does comes in under the drop. */
function later(blocks: readonly HTMLElement[], tries = 12) {
  const left: HTMLElement[] = [];
  for (const el of blocks) {
    if (!el.isConnected || !el.classList.contains("pen")) continue;
    if (!write(el, tries > 0)) { left.push(el); continue; }
    // its ink starts over from now (keyframes keep the path they started with), in its turn down the page
    el.classList.remove("ink"); void el.offsetWidth;
    el.style.setProperty("--after", "0ms");
    el.classList.add("ink");
  }
  if (left.length) requestAnimationFrame(() => later(left, tries - 1));
}

/** A block waiting for its page to land: written in the pen's hand, but with nothing measured yet, so nothing shows. */
function hold(el: HTMLElement) {
  for (const [k, v] of [["--lines", "linear-gradient(transparent, transparent)"], ["--lpos", "0 0"], ["--lsize", "1px 1px"], ["--path", "1"], ["--write", "0.4s"]]) el.style.setProperty(k!, v!);
  el.classList.add("pen");
}

/** How fast the pen runs along a line, in px a second; a long block is written faster so none takes over `PEN_MAX_S`. */
const PEN_SPEED = 900, PEN_MAX_S = 1.5;
/** Words are written, not wiped (#3671, gap 3): a block is masked line by line, each line's own letters in turn, left
 * to right, behind a pen whose wet front fades over a few letters; a picture in it is drawn where it falls in that
 * order, and last the pen runs once along the whole block, ruling its lines and borders. The drop spreading from a
 * point (the `.ink` default) clipped letters in half along an ellipse; a button or a field still comes in under it. */
function write(el: HTMLElement, wait = false): boolean {
  const box = el.getBoundingClientRect();
  // measured flat or not at all: under a page still swinging the boxes are foreshortened (`wait`: try again later)
  const tilted = Math.abs(box.width - el.offsetWidth) > 2 || Math.abs(box.height - el.offsetHeight) > 2;
  if (tilted && wait) return false;
  el.classList.remove("pen");
  if (el.matches("button, .row, .menu, .menu > *") || el.querySelector("button, input, select, textarea")) return true;
  if (!box.width || !box.height || tilted) return true;
  const { words, pictures } = marks(el);
  const path = penLines(words, pictures, box);
  if (!path?.length || path.length > 40) return true;
  path.push({ x: 0, y: 0, w: box.width, h: box.height }); // the rules, borders and flourishes, last
  const mask = penMask(path);
  const s = Math.min(PEN_MAX_S, mask.length / PEN_SPEED);
  el.style.setProperty("--lines", mask.images);
  el.style.setProperty("--lpos", mask.positions);
  el.style.setProperty("--lsize", mask.sizes);
  el.style.setProperty("--path", String(mask.length));
  el.style.setProperty("--write", `${s.toFixed(3)}s`);
  el.classList.add("pen");
  return true;
}

const PICTURES = "img, svg, canvas, picture, video";
/** What a pen puts down in `el`: each run of text's boxes (one a line it wraps onto), and each picture (an image, an
 * engraving, or an element with a size and no words, such as a drawn rule or a plate). */
function marks(el: HTMLElement) {
  const words: DOMRect[] = [], pictures: DOMRect[] = [], range = document.createRange();
  for (const pic of el.querySelectorAll(PICTURES)) if (!pic.parentElement?.closest("svg, picture")) pictures.push(pic.getBoundingClientRect());
  for (const blank of el.querySelectorAll(":not(svg *)")) if (!blank.textContent?.trim() && blank.childElementCount === 0 && !blank.matches(`${PICTURES}, br`)) pictures.push(blank.getBoundingClientRect());
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => n instanceof Element && n.matches(PICTURES) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (n.nodeType !== Node.TEXT_NODE || !n.textContent?.trim()) continue;
    range.selectNodeContents(n);
    words.push(...range.getClientRects());
  }
  return { words, pictures };
}

type Box = { left: number; top: number; width: number; height: number };
export type Line = { x: number; y: number; w: number; h: number };
/** The strokes a pen makes in a block, relative to `box`, in reading order (top to bottom by their middles, then left
 * to right): the words' boxes (a Range's client rects) gathered into lines, each from its first letter to its last,
 * and each picture a stroke of its own (merged with the words beside it, a tall plate would turn its lines into one
 * wipe). Null when something lies well outside the block: it was measured before it was laid out. */
export function penLines(words: readonly Box[], pictures: readonly Box[], box: Box): Line[] | null {
  const seen = (r: Box) => r.width > 0.5 && r.height > 0.5;
  const at = (r: Box): Line => ({ x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height });
  const all = [...words, ...pictures].filter(seen).map(at);
  if (all.some((l) => l.x < -40 || l.y < -40 || l.x + l.w > box.width + 40 || l.y + l.h > box.height + 40)) return null;
  const lines: Line[] = [];
  for (const w of words.filter(seen).map(at).sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2) || a.x - b.x)) {
    const mid = w.y + w.h / 2, on = lines.find((l) => Math.abs(l.y + l.h / 2 - mid) < Math.min(l.h, w.h) / 2);
    if (!on) { lines.push({ ...w }); continue; }
    const right = Math.max(on.x + on.w, w.x + w.w), bottom = Math.max(on.y + on.h, w.y + w.h);
    on.x = Math.min(on.x, w.x); on.y = Math.min(on.y, w.y); on.w = right - on.x; on.h = bottom - on.y;
  }
  return [...lines, ...pictures.filter(seen).map(at)].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2) || a.x - b.x);
}

/** The mask that writes `lines`: one gradient a line, sized to it (a little over, for swashes and descenders), its
 * wet front at `--pen` px along the whole path less the lines before it. */
export function penMask(lines: readonly Line[]) {
  const PAD_X = 6, PAD_Y = 4, FRONT = 22;
  let at = 0;
  const parts = lines.map((l) => {
    const start = at;
    at += l.w + PAD_X * 2;
    const front = `calc(var(--pen) * 1px - ${start.toFixed(0)}px)`;
    return {
      image: `linear-gradient(90deg, #000 calc(var(--pen) * 1px - ${(start + FRONT).toFixed(0)}px), rgba(0, 0, 0, 0.4) calc(var(--pen) * 1px - ${(start + FRONT / 4).toFixed(0)}px), transparent ${front})`,
      position: `${(l.x - PAD_X).toFixed(0)}px ${(l.y - PAD_Y).toFixed(0)}px`,
      size: `${(l.w + PAD_X * 2).toFixed(0)}px ${(l.h + PAD_Y * 2).toFixed(0)}px`,
    };
  });
  return { images: parts.map((p) => p.image).join(", "), positions: parts.map((p) => p.position).join(", "), sizes: parts.map((p) => p.size).join(", "), length: Math.ceil(at + FRONT) };
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
      // and at each hinge the free part lifts a little (`CURL`, most at mid-turn): the corner trails, so the leaf's
      // head and foot bow instead of running straight
      const curl = -side * CURL * Math.sin((Math.PI * k) / n);
      for (let j = 1; j <= i; j++) t += ` translateX(${side * STRIPS[j]! * w}px) rotateY(${side * -(fr.angles[j]! - fr.angles[j - 1]!)}deg) skewY(${curl.toFixed(3)}deg) translateX(${-side * STRIPS[j]! * w}px)`;
      return { transform: t, filter: `brightness(${hinges(fr.angles, i).top.toFixed(3)})`, opacity: k / n > 0.85 ? 1 - ((k / n - 0.85) / 0.15) * 0.7 : 1 }; // paper is opaque: it only fades as it lands
    }), { ...TURN, fill: "forwards" });
    // which side you see: the front until the strip stands past upright, then its back, the far side's ink showing
    // through faintly as on real paper (the clip and the filter flatten the strip, so this is switched by hand)
    const shows = (k: number, frontSide: boolean) => ((Math.abs(frames[k]!.angles[i]!) < 90) === frontSide ? 1 : SHOW_THROUGH);
    f?.animate(frames.map((_, k) => ({ opacity: shows(k, true) })), { ...TURN, fill: "forwards" });
    // the light runs smoothly across the strip from one hinge to the next, so the leaf reads as one curve, not facets:
    // the strip is lit as its brighter hinge, and a shade over it darkens toward the dimmer one
    const bend = (towardSpine: boolean) => {
      const g = document.createElement("i");
      g.className = "bend";
      Object.assign(g.style, { left: `${fromRight ? lo : w - hi}px`, width: `${hi - lo}px`, background: `linear-gradient(to ${fromRight === towardSpine ? "right" : "left"}, #1c0e04, transparent)` });
      seg.append(g);
      g.animate(frames.map((fr) => { const hg = hinges(fr.angles, i); return { opacity: (1 - (towardSpine ? hg.spine : hg.edge) / hg.top).toFixed(3) }; }), { ...TURN, fill: "forwards" });
    };
    bend(true); bend(false);
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
/** How far the leaf's free part lifts at each hinge at mid-turn, in degrees of shear (the corner trailing). */
const CURL = 1.6;
/** The leaf is seen from further off than a whole screen turning, so lifting toward you it stays over the book. */
const LEAF_DEPTH = 4200;
const lean = (deg: number) => `perspective(${LEAF_DEPTH}px) rotateY(${deg}deg)`;
/** A strip's light: full facing you, darkest edge-on (the lamp is in front of the book). */
const lamp = (deg: number) => 0.62 + 0.4 * Math.abs(Math.cos((deg * Math.PI) / 180));
/** The light at strip `i`'s two hinges (where it meets the strips either side, so neighbours agree at the crease)
 * and the brighter of the two. */
export function hinges(angles: readonly number[], i: number) {
  const a = (j: number) => angles[Math.max(0, Math.min(angles.length - 1, j))]!;
  const spine = lamp(i ? (a(i - 1) + a(i)) / 2 : a(i)), edge = lamp(i < angles.length - 1 ? (a(i) + a(i + 1)) / 2 : a(i));
  return { spine, edge, top: Math.max(spine, edge) };
}

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
 * dropped (the live page keeps those). Ink on a leaf keeps still (src/tome.css), so it shows dry words; the page you
 * were reading also loses its wet marks, so one redrawn mid-soak isn't left half-written. A back is printed mirrored,
 * so it reads once the leaf is over. */
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
  // a thumb is left on some openings, not every one, and pressed harder or lighter each time (#3671 round 103): the
  // same print on every screen read as a sticker
  if ((n * 7 + 3) % 5 >= 2) return;
  const i = document.createElement("i");
  i.className = "thumb";
  i.style.opacity = (0.28 + ((n * 37) % 30) / 100).toFixed(2);
  i.setAttribute("aria-hidden", "true");
  const place = (k: number) => { const t = thumbAt(k); Object.assign(i.style, { left: `${t.x}%`, top: `${t.y}%`, width: `${t.size}px`, transform: `translate(-50%, -50%) rotate(${t.turn}deg)` }); };
  place(n);
  leaf.append(i);
  // a thumb is pressed on bare paper, never on a button, a plate or a heading (#3671 round 87): if it lands on one, the next spots are tried
  const controls = [...leaf.querySelectorAll("button, a, input, select, figure, h1, h2, .keys, .terms")].map((el) => el.getBoundingClientRect()).filter((r) => r.width);
  const hits = () => { const r = i.getBoundingClientRect(); return controls.some((c) => r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top); };
  for (let k = 1; k <= 6 && hits(); k++) place(n + k * 101);
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
