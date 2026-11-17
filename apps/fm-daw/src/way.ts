// Qollab Studio as one place: your character on eqosys, the lobby, the jam room, and the rooms off it (the gear room,
// Q Amp, the FM DAW desk). Each page draws the same row of doors (`mountWay`), and a door carries the room you came from
// (?room, ?studio, ?name), so the jam room's door brings you back into the same sesh. Pure up to `mountWay`.
import { EQOSYS } from "./account.ts";

export type Here = "character" | "jam" | "gear" | "amp" | "desk";
/** Each place, its page and the word on its door. The lobby and the jam room are one page (jam.html): no ?room is the lobby. */
export const PLACES: Record<Here, { page: string; label: string; title: string }> = {
  character: { page: `${EQOSYS}/?tab=account`, label: "Character", title: "Your character, on eqosys" },
  jam: { page: "/jam.html", label: "Jam room", title: "Qollab Studio: the jam room (the lobby when you're not in a room)" },
  gear: { page: "/studio.html", label: "Gear room", title: "Qollab Studio: the gear room, amps and pedals to cable" },
  amp: { page: "/amp.html", label: "Q Amp", title: "Qollab Studio: Q Amp, the amp as circuits" },
  desk: { page: "/", label: "Desk", title: "Qollab Studio: the FM DAW desk" },
};
const ORDER: Here[] = ["character", "jam", "gear", "amp", "desk"];
const KEEP = ["room", "studio", "name"];

/** The doors from `here`: every other place, carrying the room in `search` along (never to eqosys, which needs none). */
export function doors(here: Here, search: string): { to: Here; href: string; label: string; title: string }[] {
  const q = new URLSearchParams(search), keep = new URLSearchParams();
  for (const k of KEEP) { const v = q.get(k); if (v) keep.set(k, v); }
  const tail = keep.size ? `?${keep}` : "";
  return ORDER.filter((p) => p !== here).map((to) => ({ to, href: to === "character" ? PLACES[to].page : PLACES[to].page + tail, label: PLACES[to].label, title: PLACES[to].title }));
}

/** Draws the row of doors along the top of the page, once. */
export function mountWay(here: Here) {
  if (document.getElementById("qs-way")) return;
  const nav = document.createElement("nav");
  nav.id = "qs-way";
  nav.setAttribute("aria-label", "Qollab Studio");
  nav.style.cssText =
    "position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:50;display:flex;gap:4px;max-width:calc(100vw - 16px);overflow-x:auto;padding:4px;border-radius:999px;background:rgba(21,23,27,.78);font:600 13px/1 system-ui,sans-serif";
  const current = document.createElement("span");
  current.textContent = PLACES[here].label;
  current.setAttribute("aria-current", "page");
  for (const d of [{ el: current, at: ORDER.indexOf(here) }, ...doors(here, location.search).map((d) => {
    const a = document.createElement("a");
    a.href = d.href; a.textContent = d.label; a.title = d.title; a.dataset.to = d.to;
    return { el: a, at: ORDER.indexOf(d.to) };
  })].sort((a, b) => a.at - b.at)) {
    d.el.style.cssText = `white-space:nowrap;padding:7px 12px;border-radius:999px;text-decoration:none;color:#f4f1ea;${d.el === current ? "background:#0f766e" : ""}`;
    nav.append(d.el);
  }
  document.body.append(nav);
}
