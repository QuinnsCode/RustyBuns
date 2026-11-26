// Qollab Studio as one place: your character on eqosys, the lobby, the jam room, and the rooms off it (the gear room,
// Q Amp, the speaker plans, the FM DAW desk, the remote). Each page draws the same row of doors (`mountWay`), and a door carries the room you came from
// (?room, ?studio, ?name), so the jam room's door brings you back into the same sesh. Pure up to `mountWay`.
import { EQOSYS } from "./account.ts";
import { DOOR, DOOR_OPEN, iconSvg } from "./paths.ts";

export type Here = "paths" | "character" | "jam" | "gear" | "amp" | "builder" | "speakers" | "desk" | "remote";
/** Each place, its page and the word on its door. The lobby and the jam room are one page (jam.html): no ?room is the lobby. */
export const PLACES: Record<Here, { page: string; label: string; title: string }> = {
  paths: { page: DOOR, label: "Paths", title: "Qollab Studio's front door: learn, build, play" },
  character: { page: `${EQOSYS}/?tab=account`, label: "Character", title: "Your character, on eqosys" },
  jam: { page: "/jam.html", label: "Jam room", title: "Qollab Studio: the jam room (the lobby when you're not in a room)" },
  gear: { page: "/studio.html", label: "Gear room", title: "Qollab Studio: the gear room, amps and pedals to cable" },
  amp: { page: "/amp.html", label: "Q Amp", title: "Qollab Studio: Q Amp, the amp as circuits" },
  builder: { page: "/builder.html", label: "Q Builder", title: "Qollab Studio: Q Builder, a pedal's board to change, scope and remake" },
  speakers: { page: "/speakers.html", label: "Speakers", title: "Qollab Studio: speaker boxes from their build plans, the walls and the sound" },
  desk: { page: "/", label: "Desk", title: "Qollab Studio: the FM DAW desk" },
  remote: { page: "/remote.html", label: "Remote", title: "Qollab Studio: the remote, one screen for a phone (master faders and the instrument you're at)" },
};
const ORDER: Here[] = ["paths", "character", "jam", "gear", "amp", "builder", "speakers", "desk", "remote"];
const KEEP = ["room", "studio", "name"];

/** The doors from `here`: every other place, carrying the room in `search` along (never to eqosys or the front door, which need none). */
export function doors(here: Here, search: string): { to: Here; href: string; label: string; title: string }[] {
  const q = new URLSearchParams(search), keep = new URLSearchParams();
  for (const k of KEEP) { const v = q.get(k); if (v) keep.set(k, v); }
  const tail = keep.size ? `?${keep}` : "";
  return ORDER.filter((p) => p !== here).map((to) => ({ to, href: to === "character" || to === "paths" ? PLACES[to].page : PLACES[to].page + tail, label: PLACES[to].label, title: PLACES[to].title }));
}

/** The row's look: under a phone's notch (the safe area), and folded down to the place you're in. */
const WAY_CSS = `#qs-way{position:fixed;top:calc(8px + env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);z-index:50;display:flex;gap:4px;max-width:calc(100vw - 16px - env(safe-area-inset-left,0px) - env(safe-area-inset-right,0px));overflow-x:auto;scrollbar-width:none;padding:4px;border-radius:999px;background:rgba(21,23,27,.78);font:600 13px/1 system-ui,sans-serif}
#qs-way>*{white-space:nowrap;padding:7px 12px;border-radius:999px;text-decoration:none;color:#f4f1ea;border:0;background:none;font:inherit;cursor:pointer}
#qs-way>[aria-current]{background:#0f766e;display:inline-flex;align-items:center;gap:6px}
#qs-way>[aria-current] svg{display:none}
#qs-way.folded>:not([aria-current]){display:none}
#qs-way.folded>[aria-current] svg{display:block}`;
const CHEVRON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;

/** Draws the row of doors along the top of the page, once. With `character`, the Character door opens it over the page
 * (the jam room's dialog, #5819) rather than leaving for eqosys. `fold(true)` shrinks it to the place you're in (the
 * jam room does while you play); pressing that opens the row again. */
export function mountWay(here: Here, o: { character?: () => void } = {}): { fold: (on: boolean) => void } {
  const found = document.getElementById("qs-way");
  const fold = (on: boolean) => { const n = document.getElementById("qs-way"); n?.classList.toggle("folded", on); n?.querySelector("[aria-current]")?.setAttribute("aria-expanded", String(!on)); };
  if (found) return { fold };
  const style = document.createElement("style");
  style.textContent = WAY_CSS;
  document.head.append(style);
  const nav = document.createElement("nav");
  nav.id = "qs-way";
  nav.setAttribute("aria-label", "Qollab Studio");
  const current = document.createElement("button");
  current.type = "button";
  current.innerHTML = CHEVRON;
  current.prepend(PLACES[here].label);
  current.title = "The other rooms";
  current.setAttribute("aria-current", "page");
  current.addEventListener("click", () => { if (nav.classList.contains("folded")) fold(false); });
  for (const d of [{ el: current, at: ORDER.indexOf(here) }, ...doors(here, location.search).map((d) => {
    const a = document.createElement("a");
    a.href = d.href; a.textContent = d.label; a.title = d.title; a.dataset.to = d.to;
    const open = o.character;
    if (d.to === "character" && open) { a.title = "Your character"; a.addEventListener("click", (e) => { e.preventDefault(); open(); }); }
    return { el: a, at: ORDER.indexOf(d.to) };
  })].sort((a, b) => a.at - b.at)) {
    nav.append(d.el);
  }
  document.body.append(nav);
  return { fold };
}

/** The way back to the front door alone, for a page with no row of doors (the decks, the studio builder): a round
 * door button in a corner, out of the way of the page's own header (`corner`: bottom-left, or top-left while the
 * decks' start button is all there is). Given `into`, it moves to the front of that element once the page draws it
 * (the decks' header), so it never sits over a control. */
export function mountBack(o: { corner?: "top" | "bottom"; into?: string } = {}) {
  if (document.getElementById("qs-back")) return;
  const a = document.createElement("a");
  a.id = "qs-back"; a.href = DOOR; a.title = PLACES.paths.title; a.setAttribute("aria-label", PLACES.paths.title);
  a.innerHTML = iconSvg(DOOR_OPEN, 18);
  const look = "display:grid;place-items:center;flex:none;width:36px;height:36px;border-radius:999px;background:rgba(21,23,27,.82);color:#f4f1ea;";
  const y = o.corner === "top" ? "top:calc(10px + env(safe-area-inset-top))" : "bottom:calc(10px + env(safe-area-inset-bottom))";
  a.style.cssText = `position:fixed;left:calc(10px + env(safe-area-inset-left));${y};z-index:60;box-shadow:0 2px 8px rgba(0,0,0,.35);${look}`;
  document.body.append(a);
  const sel = o.into;
  if (!sel) return;
  const settle = () => {
    const host = document.querySelector(sel);
    if (!host) return false;
    a.style.cssText = look;
    host.prepend(a);
    return true;
  };
  if (settle()) return;
  const watch = new MutationObserver(() => { if (settle()) watch.disconnect(); });
  watch.observe(document.body, { childList: true, subtree: true });
}
