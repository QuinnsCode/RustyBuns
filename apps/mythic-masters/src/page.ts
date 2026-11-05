// One page of the tome, shared by every menu screen: the title, the Bog Witch's sheet, the journal, the versus
// picker and its bestiary, a fight's result and the Settings card. Changing screen turns a leaf over: the page you
// were on swings away on its spine and the next one is under it. The journal's chapters turn through the same leaf.
// With reduced motion the screens just swap.

import { thumbAt } from "./demand.ts";

export const stillPages = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** What soaks in when a page is shown: every block of a page (a ledger's rows one by one, so an edit rewrites one
 * line), a scroll (but its title, which is printed on the cover and carries the scroll's roll), a sheet, a note, a
 * menu, the versus book's two leaves, and each block of a folio's inner parts (`.inks`). */
const INKS = ".page > :not(.lineup, .resting, .pages), .lineup > li, .resting > li, .pages > li, .inks > *, .scroll > :not(h1), .sheet > *, .note > *, .menu > *, .picks > div > *";
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
  (root as HTMLElement).style.setProperty("--step", `${Math.min(95, 2400 / Math.max(1, wet.length)).toFixed(0)}ms`);
  wet.forEach((el, i) => {
    if (el.classList.contains("ink")) { el.classList.remove("ink"); void el.offsetWidth; }
    el.style.setProperty("--i", String(i));
    el.classList.add("ink");
  });
  written.set(root, lines);
}

const TURN = { duration: 640, easing: "cubic-bezier(.45,.05,.3,1)" };
const tilt = (deg: number) => `perspective(2400px) rotateY(${deg}deg)`;

/** Swing a sheet over on its spine, `from` to `to` degrees, darkening as it stands on edge; it goes when it lands. */
export function swing(sheet: HTMLElement, from: number, to: number, origin: "left" | "right", remove = true): Promise<void> {
  sheet.style.transformOrigin = `${origin} center`;
  const fade = remove ? { opacity: 0.3 } : {};
  return sheet.animate([{ transform: tilt(from) }, { filter: "brightness(0.7)", offset: 0.5 }, { transform: tilt(to), ...fade }], TURN)
    .finished.then(() => undefined, () => undefined).finally(() => { if (remove) sheet.remove(); });
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

/** Turn a leaf over a box on screen with `face` printed on its front: forward from the right edge, back from the left.
 * A single page (a phone) always turns from its left edge, coming back over for back. */
export function turnLeaf(host: Element, box: DOMRect, face: Node | null, forward: boolean, spread: boolean) {
  if (stillPages()) return;
  const fromRight = forward || !spread, w = spread ? box.width / 2 : box.width;
  const top = Math.max(box.top, 0), h = Math.min(box.bottom, innerHeight) - top;
  if (h <= 0) return;
  const sheet = document.createElement("div");
  sheet.className = "turning";
  sheet.setAttribute("aria-hidden", "true");
  Object.assign(sheet.style, { left: `${fromRight ? box.right - w : box.left}px`, top: `${top}px`, width: `${w}px`, height: `${h}px` });
  if (face) { const f = document.createElement("div"); f.className = "face"; f.style.marginTop = `${box.top - top}px`; f.append(...face.cloneNode(true).childNodes); sheet.append(f); }
  host.append(sheet);
  const [from, to] = !spread && !forward ? [-180, 0] : [0, forward ? -180 : 180];
  void swing(sheet, from, to, fromRight ? "left" : "right");
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
  if (opening) { void swing(card, -110, 0, "left", false).then(() => { card.style.transformOrigin = ""; }); return; }
  const sheet = sheetOf(dialog), leaf = sheet.querySelector<HTMLElement>(".gc-card");
  if (!leaf) return;
  Object.assign(sheet.style, { background: "transparent", zIndex: "1001" });
  dialog.after(sheet);
  void swing(leaf, 0, -180, "left", false).then(() => sheet.remove());
}
