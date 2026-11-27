// Qollab Studio as one place: your character on eqosys, the lobby, the jam room, and the rooms off it (the gear room,
// Q Amp, the speaker plans, the FM DAW desk, the remote). Each page draws the same row of doors (`mountWay`), and a door carries the room you came from
// (?room, ?studio, ?name), so the jam room's door brings you back into the same sesh. Pure up to `mountWay`.
import { EQOSYS } from "./account.ts";
import { DOOR, DOOR_OPEN, iconSvg } from "./paths.ts";
import { THEMES, followTheme, loadTheme, saveTheme, type Theme } from "./ui/theme.ts";

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
  desk: { page: "/desk", label: "Desk", title: "Qollab Studio: the FM DAW desk" },
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

/** One pill in the top-right corner (under a phone's notch): the place you're in, which drops the other rooms down
 * under it. Kept small so it sits clear of each page's own header. */
const WAY_CSS = `#qs-way{--w-bg:rgba(21,23,27,.82);--w-list:rgba(21,23,27,.96);--w-ink:#f4f1ea;--w-line:rgba(244,241,234,.14);--w-hover:#2a2d33;--w-on:#0f766e;--w-on-ink:#f4f1ea;position:fixed;top:calc(8px + env(safe-area-inset-top,0px));right:calc(8px + env(safe-area-inset-right,0px));z-index:50;font:600 13px/1 system-ui,sans-serif}
:root[data-theme="light"] #qs-way{--w-bg:rgba(240,241,243,.9);--w-list:rgba(246,247,248,.98);--w-ink:#17191c;--w-line:rgba(23,25,28,.16);--w-hover:#dcdfe2;--w-on:#0f766e;--w-on-ink:#fff}
#qs-way>button{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;padding:8px 12px;border-radius:999px;border:1px solid var(--w-line);background:var(--w-bg);color:var(--w-ink);font:inherit;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.35)}
#qs-way>button:hover,#qs-way>button:focus-visible{background:var(--w-on);color:var(--w-on-ink);outline:none}
#qs-way>button svg{transition:transform .15s}
#qs-way.open>button{background:var(--w-on);color:var(--w-on-ink)}
#qs-way.open>button svg{transform:rotate(180deg)}
#qs-way>div{position:absolute;top:calc(100% + 6px);right:0;display:none;flex-direction:column;min-width:170px;max-height:calc(100vh - 70px);overflow-y:auto;padding:4px;border-radius:12px;border:1px solid var(--w-line);background:var(--w-list);box-shadow:0 8px 24px rgba(0,0,0,.45)}
#qs-way.open>div{display:flex}
#qs-way>div>a{white-space:nowrap;padding:9px 12px;border-radius:8px;text-decoration:none;color:var(--w-ink)}
#qs-way>div>a:hover,#qs-way>div>a:focus-visible{background:var(--w-hover);outline:none}
#qs-way .look{display:flex;margin:4px 4px 2px;padding-top:6px;border-top:1px solid var(--w-line);gap:2px}
#qs-way .look button{flex:1;display:grid;place-items:center;height:32px;border:0;border-radius:8px;background:none;color:var(--w-ink);cursor:pointer;opacity:.7}
#qs-way .look button:hover,#qs-way .look button:focus-visible{background:var(--w-hover);opacity:1;outline:none}
#qs-way .look button[aria-checked="true"]{background:var(--w-on);color:var(--w-on-ink);opacity:1}`;
/** The round door button's light look (mountBack); the pill's is in WAY_CSS. */
const BACK_CSS = `:root[data-theme="light"] #qs-back{--w-bg:rgba(240,241,243,.9);--w-ink:#17191c}`;
// lucide's monitor, sun and moon (ISC)
const LOOK_ICONS: Record<Theme, string> = {
  system: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2m-7.07-17.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  dark: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
};
const LOOK_WORDS: Record<Theme, string> = { system: "System look", light: "Light", dark: "Dark" };

/** The light / dark pick for the whole app, under the doors: System, Light or Dark, an icon each with its word as the tooltip. */
function lookPick(): HTMLElement {
  const row = document.createElement("div");
  row.className = "look"; row.setAttribute("role", "radiogroup"); row.setAttribute("aria-label", "Light or dark");
  const mark = () => { const now = loadTheme(); for (const b of row.querySelectorAll("button")) b.setAttribute("aria-checked", String(b.dataset.theme === now)); };
  for (const t of THEMES) {
    const b = document.createElement("button");
    b.type = "button"; b.dataset.theme = t; b.title = LOOK_WORDS[t]; b.setAttribute("aria-label", LOOK_WORDS[t]); b.setAttribute("role", "radio");
    b.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${LOOK_ICONS[t]}</svg>`;
    b.addEventListener("click", (e) => { e.stopPropagation(); saveTheme(t); mark(); });
    row.append(b);
  }
  mark();
  addEventListener("storage", mark);
  return row;
}
const CHEVRON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;

/** Draws the way to the other rooms, once: one pill naming the place you're in, which opens a list of the others
 * (Paths first). With `character`, the Character door opens it over the page (the jam room's dialog, #5819) rather
 * than leaving for eqosys. `fold(true)` closes the list (the jam room does once you play). */
export function mountWay(here: Here, o: { character?: () => void; right?: number; into?: string } = {}): { fold: (on: boolean) => void } {
  const found = document.getElementById("qs-way");
  const show = (on: boolean) => { const n = document.getElementById("qs-way"); n?.classList.toggle("open", on); n?.querySelector("button")?.setAttribute("aria-expanded", String(on)); };
  const fold = (on: boolean) => { if (on) show(false); };
  followTheme();
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
  current.setAttribute("aria-expanded", "false");
  current.addEventListener("click", (e) => { e.stopPropagation(); show(!nav.classList.contains("open")); });
  const list = document.createElement("div");
  for (const d of doors(here, location.search)) {
    const a = document.createElement("a");
    a.href = d.href; a.textContent = d.label; a.title = d.title; a.dataset.to = d.to;
    const open = o.character;
    if (d.to === "character" && open) { a.title = "Your character"; a.addEventListener("click", (e) => { e.preventDefault(); show(false); open(); }); }
    list.append(a);
  }
  list.append(lookPick());
  nav.append(current, list);
  // a click anywhere else, or Esc, closes it
  document.addEventListener("click", (e) => { if (!nav.contains(e.target instanceof Node ? e.target : null)) show(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") show(false); });
  // clear of a page's own corner button (the jam room's and gear room's cog), or inside its header bar (Q Amp's)
  if (o.right) nav.style.right = `calc(${o.right}px + env(safe-area-inset-right,0px))`;
  document.body.append(nav);
  const sel = o.into;
  if (sel) {
    const settle = () => {
      const host = document.querySelector(sel);
      if (!host) return false;
      nav.style.cssText = "position:relative;top:auto;right:auto;margin-left:auto";
      host.append(nav);
      return true;
    };
    if (!settle()) { const watch = new MutationObserver(() => { if (settle()) watch.disconnect(); }); watch.observe(document.body, { childList: true, subtree: true }); }
  }
  return { fold };
}

/** The way back to the front door alone, for a page with no row of doors (the decks, the studio builder): a round
 * door button in a corner, out of the way of the page's own header (`corner`: bottom-left, or top-left while the
 * decks' start button is all there is). Given `into`, it moves to the front of that element once the page draws it
 * (the decks' header), so it never sits over a control. */
export function mountBack(o: { corner?: "top" | "bottom"; into?: string } = {}) {
  followTheme();
  if (document.getElementById("qs-back")) return;
  const style = document.createElement("style");
  style.textContent = BACK_CSS;
  document.head.append(style);
  const a = document.createElement("a");
  a.id = "qs-back"; a.href = DOOR; a.title = PLACES.paths.title; a.setAttribute("aria-label", PLACES.paths.title);
  a.innerHTML = iconSvg(DOOR_OPEN, 18);
  const look = "display:grid;place-items:center;flex:none;width:36px;height:36px;border-radius:999px;background:var(--w-bg,rgba(21,23,27,.82));color:var(--w-ink,#f4f1ea);";
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
