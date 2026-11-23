// The apps' clips (public/trailers, cut by scripts/trailers.ts): a tile starts its first clip after the pointer rests on it a
// moment, the way a streaming service starts a show's preview, and stops when it leaves; an app's page plays its clips one
// after another, and its strip picks one. Asked for less motion or to save data, nothing starts by itself.

const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches || (navigator as { connection?: { saveData?: boolean } }).connection?.saveData === true;

/** A muted clip that fills its box over the still, shown once it has a frame to show. */
function clip(src: string, loop: boolean): HTMLVideoElement {
  const v = document.createElement("video");
  Object.assign(v, { src, muted: true, loop, playsInline: true, preload: "auto", disablePictureInPicture: true });
  v.setAttribute("muted", "");
  v.className = "clip";
  v.addEventListener("playing", () => v.classList.add("on"), { once: true });
  return v;
}

/** Every tile and the feature with a `data-clip`: hover (or focus) starts it after 450 ms. Returns how many it watches. */
export function mountTiles(doc: Document): number {
  const boxes = [...doc.querySelectorAll<HTMLElement>("[data-clip]")];
  for (const box of boxes) {
    const card = box.closest<HTMLElement>(".game, .feature") ?? box;
    let wait = 0, v: HTMLVideoElement | null = null;
    const start = () => {
      if (calm() || v) return;
      wait = window.setTimeout(() => { v = clip(box.dataset.clip!, true); box.append(v); void v.play().catch(() => {}); }, 450);
    };
    const stop = () => { clearTimeout(wait); v?.remove(); v = null; };
    card.addEventListener("pointerenter", start);
    card.addEventListener("pointerleave", stop);
    card.addEventListener("focusin", start);
    card.addEventListener("focusout", stop);
  }
  return boxes.length;
}

/** An app's page: its clips in a row, the first playing at once in the big picture and each rolling into the next. */
export function mountReel(doc: Document): { state(): { playing: string | null; clips: number } } | null {
  const box = doc.querySelector<HTMLElement>("[data-reel]");
  if (!box) return null;
  const picks = [...doc.querySelectorAll<HTMLButtonElement>("[data-pick]")];
  const srcs = picks.map((b) => b.dataset.pick!);
  let at = 0, v: HTMLVideoElement | null = null;
  const show = (i: number, play: boolean) => {
    at = (i + srcs.length) % srcs.length;
    v?.remove();
    v = clip(srcs[at]!, srcs.length === 1);
    v.addEventListener("ended", () => show(at + 1, true));
    box.append(v);
    picks.forEach((b, j) => b.setAttribute("aria-pressed", String(j === at)));
    if (play) void v.play().catch(() => {});
  };
  picks.forEach((b, i) => b.addEventListener("click", () => show(i, true)));
  if (srcs.length) show(0, !calm());
  return { state: () => ({ playing: v && !v.paused ? srcs[at]! : null, clips: srcs.length }) };
}
