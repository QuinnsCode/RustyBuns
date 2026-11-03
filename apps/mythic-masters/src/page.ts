// One page of the tome, shared by every menu screen: the title, the Bog Witch's sheet, the journal, the versus
// picker and its bestiary, a fight's result and the Settings card. Changing screen turns a leaf over: the page you
// were on swings away on its spine and the next one is under it. The journal's chapters turn through the same leaf.
// With reduced motion the screens just swap.

export const stillPages = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  return {
    open,
    show(next: HTMLElement | null) {
      const was = open();
      for (const p of pages) p.hidden = p !== next;
      if (was === next || stillPages()) return;
      if (!was) { const paper = next?.querySelector<HTMLElement>(".paper"); if (paper) void swing(paper, -110, 0, "left", false); return; }
      const forward = !next || pages.indexOf(next) > pages.indexOf(was);
      const sheet = sheetOf(was);
      was.after(sheet);
      void swing(sheet, 0, forward ? -180 : 180, forward ? "left" : "right");
    },
  };
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
