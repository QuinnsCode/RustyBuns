// The jam room's "What you can do here" card and the key strip by the hint (#5395), both drawn from actions.ts.
// The card opens with ?, from the menu, and by itself the first time you walk in; the strip changes with where you are.
import "./help.css";
import { icon } from "../amp/icons.ts";
import { NOT_YET, card, strip, type Action } from "./actions.ts";
import type { SpotKind } from "./room.ts";

const SEEN = "qs-help-seen";
const ISSUES = "https://github.com/QuinnsCode/RustyBuns/issues/";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const kbd = (k: string) => el("kbd", undefined, k);

export type Help = ReturnType<typeof mountHelp>;

/** Mounts the card (closed) and the strip; `seat` says where you sit now (null: walking), `onToggle` hears it open or close. */
export function mountHelp(o: { parent: HTMLElement; hint: HTMLElement; seat: () => SpotKind | null; onToggle?: (open: boolean) => void }) {
  const box = el("section"), panel = el("div", "help-card"), bar = el("div");
  box.id = "help"; box.hidden = true;
  box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "What you can do here");
  bar.id = "keystrip";
  box.append(panel);
  document.body.append(box); // over the see-through keys and the lane, which hang on the body too
  o.parent.append(bar);
  box.addEventListener("click", (e) => { if (e.target === box) close(); });

  let drawnFor: string | null = null, stripFor: string | null = null;

  function draw(seat: SpotKind | null) {
    const head = el("header"), h = el("h2", undefined, "What you can do here"), x = el("button", "help-x");
    x.type = "button"; x.title = "Close (Esc or ?)"; x.setAttribute("aria-label", "Close"); x.append(icon("x"));
    x.addEventListener("click", () => close());
    head.append(h, x);
    const groups = el("div", "help-groups");
    for (const g of card(seat)) {
      const sec = el("section", g.here ? "here" : undefined), t = el("h3", undefined, g.title);
      if (g.here) t.append(el("small", undefined, "you are here"));
      const ul = el("ul");
      for (const a of g.actions) ul.append(line(a));
      sec.append(t, ul);
      groups.append(sec);
    }
    const later = el("section", "help-later"), lt = el("h3", undefined, "Not in this room yet"), ul = el("ul");
    for (const n of NOT_YET) {
      const li = el("li"), a = el("a", undefined, `#${n.issue}`);
      a.href = ISSUES + n.issue; a.target = "_blank"; a.rel = "noopener";
      const words = el("span");
      words.append(el("b", undefined, n.what), document.createTextNode(`: ${n.today}. `), a);
      li.append(icon("clock"), words);
      ul.append(li);
    }
    later.append(lt, ul);
    const ok = el("button", "help-ok", "Got it");
    ok.type = "button"; ok.addEventListener("click", () => close());
    panel.replaceChildren(head, groups, later, ok);
    drawnFor = String(seat);
  }
  function line(a: Action) {
    const li = el("li");
    li.append(icon(a.icon), kbd(a.key), el("span", undefined, a.does));
    return li;
  }

  function open() {
    draw(o.seat());
    box.hidden = false;
    try { localStorage.setItem(SEEN, "1"); } catch {}
    o.onToggle?.(true);
  }
  function close() {
    if (box.hidden) return;
    box.hidden = true;
    o.onToggle?.(false);
  }
  document.addEventListener("keydown", (e) => { if (!box.hidden && e.code === "Escape") close(); });

  // the strip sits just above the hint, however many lines the hint takes, and the see-through keys above the strip
  const place = () => {
    const at = 40 + o.hint.offsetHeight + 8;
    bar.style.bottom = `${at}px`;
    document.documentElement.style.setProperty("--qs-above-strip", `${Math.max(86, at + (bar.hidden ? 0 : bar.offsetHeight) + 8)}px`);
  };
  const watch = new ResizeObserver(place);
  watch.observe(o.hint); watch.observe(bar);
  place();

  return {
    open, close,
    toggle: () => (box.hidden ? open() : close()),
    isOpen: () => !box.hidden,
    /** Never opened in this browser: the first walk in shows it. */
    firstTime: () => { try { return !localStorage.getItem(SEEN); } catch { return false; } },
    /** Each frame: the strip for where you are (hidden off the play phase), and the open card redrawn if you moved seat. */
    frame(playing: boolean) {
      bar.hidden = !playing;
      const seat = o.seat(), key = String(seat);
      if (playing && key !== stripFor) {
        bar.replaceChildren(...strip(seat).map((a) => { const s = el("span"); s.append(kbd(a.key), document.createTextNode(` ${a.short}`)); s.title = a.does; return s; }));
        stripFor = key;
      }
      if (!box.hidden && key !== drawnFor) draw(seat);
    },
    /** What a probe reads: open or not, and the card's groups and strip as text. */
    state: () => ({ open: !box.hidden, strip: strip(o.seat()).map((a) => `${a.key} ${a.short}`), card: card(o.seat()).map((g) => ({ title: g.title, here: g.here, actions: g.actions.map((a) => `${a.key}: ${a.does}`) })) }),
  };
}
