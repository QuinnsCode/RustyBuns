// Qollab Studio's front door (/door.html), a landing page (#6019): the live field at dusk (src/front-hero.ts) fills the
// screen behind everything, crowded up under the title, LEARN, BUILD and PLAY as lanes down the grass. Scroll and the
// lane buttons slide up into the tabs along the top, and each lane's shelf follows one after another: its paths as
// things swinging in the dark (src/front-shelf.ts), each card opening on its sector's first step and sliding in as it
// comes onto the screen, the lane you are reading lit on the field behind. The night's air hides behind one small
// button in the corner. After the shelves, the pedal-to-show chain, what works today, and a word for crews and for
// classes. `qdoor` is the harness for probes and the journey tests (test/front-door.test.ts).
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import "./door-fonts.css";
import { clamp } from "@rustybuns/util";
import { mountHero } from "./front-hero.ts";
import { mountShelf, type ShelfItem } from "./front-shelf.ts";
import { eqosys } from "@rustybuns/util/eqosys";
import { APP, EQOSYS, SIGN_IN_FROM } from "./account.ts";
import { SKIN } from "./guest-list.ts";
import { CHAIN, ICON, iconSvg, LIVE, PATHS, pathOf, PITCHES, SECTORS, type PathId, type SectorId } from "./paths.ts";

const TONES: Record<SectorId, string> = { learn: "#2dd4bf", build: "#fb923c", play: "#818cf8" };
/** Each lane's thematic face (door-fonts.css), as the field paints its word on the grass. */
const FACES: Record<SectorId, string> = { learn: '400 100px "Caveat Brush", cursive', build: '800 100px "Doto", monospace', play: '400 100px "Special Elite", monospace' };
/** The thing each path stands as on its lane's shelf. */
const ITEMS: Record<PathId, ShelfItem> = { learn: "guitar", planner: "stack", daw: "screen", instruments: "turntable", amps: "amp", builder: "board", playground: "mic", event: "wedge" };
const isSector = (v: string): v is SectorId => SECTORS.some((s) => s.id === v);

const shelf = mountShelf();
const list = document.getElementById("paths")!;
for (const s of SECTORS) {
  const section = document.createElement("section");
  section.className = "sector";
  section.dataset.sector = s.id;
  section.style.setProperty("--tone", TONES[s.id]);
  section.innerHTML = `<h2></h2><p class="line"></p><div class="cards"></div>`;
  section.querySelector("h2")!.textContent = s.word;
  section.querySelector(".line")!.textContent = s.line;
  const cards = section.querySelector(".cards")!;
  for (const p of PATHS.filter((p) => p.sector === s.id)) {
    const a = document.createElement("a");
    a.className = "path";
    a.href = p.href;
    a.dataset.path = p.id;
    a.title = `${p.name}: opens on ${p.first}`;
    a.innerHTML = `<span class="item"><canvas aria-hidden="true"></canvas></span><span class="text"><span class="icon">${iconSvg(p.icon, 20)}</span><b></b><span class="does"></span><span class="open">Open ${iconSvg(ICON.arrow, 16)}</span></span>`;
    a.querySelector("b")!.textContent = p.name;
    a.querySelector(".does")!.textContent = p.does;
    if (p.signIn) a.querySelector(".does")!.insertAdjacentHTML("afterend", '<span class="tag">Sign in with eqosys</span>');
    shelf.add(a.querySelector("canvas")!, ITEMS[p.id], TONES[s.id]);
    cards.append(a);
  }
  list.append(section);
}

// each card slides up into place as it comes onto the screen, and stays
const rise = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { e.target.classList.add("in"); rise.unobserve(e.target); } }, { rootMargin: "0px 0px -8% 0px" });
for (const a of list.querySelectorAll(".path")) rise.observe(a);

// the field is the menu, and scrolling reads it: under the field each lane's shelf stands one after another. Scrolling
// off the field slides the lane buttons up into the tabs, and the lane you are reading lights on the field behind, the
// camera flown over it. A lane button, its strip of grass or a tab scrolls to its shelf; #build lands on it from a link.
const tabs = document.getElementById("tabs")!, tabFor = new Map<SectorId, HTMLButtonElement>();
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
const shelfOf = (id: string) => list.querySelector<HTMLElement>(`.sector[data-sector="${id}"]`);
const go = (id: string | null, now = still) => {
  const el = id ? shelfOf(id) : null, behavior: ScrollBehavior = now ? "auto" : "smooth";
  if (el) el.scrollIntoView({ behavior, block: "start" }); else scrollTo({ top: 0, behavior });
};
for (const s of SECTORS) {
  const b = document.createElement("button");
  b.type = "button"; b.role = "tab"; b.dataset.tab = s.id; b.textContent = s.word; b.style.setProperty("--tone", TONES[s.id]);
  b.addEventListener("click", () => go(s.id));
  tabs.querySelector(".tablist")!.append(b); tabFor.set(s.id, b);
}
const hero = mountHero(document.getElementById("hero")!, SECTORS.map((s) => ({ id: s.id, word: s.word, tone: TONES[s.id], face: FACES[s.id] })), go);
for (const b of document.querySelectorAll<HTMLButtonElement>(".lane")) {
  const n = PATHS.filter((p) => p.sector === b.dataset.lane).length;
  b.querySelector("span")!.textContent = n === 1 ? "1 way in" : `${n} ways in`;
}
document.getElementById("field-back")!.addEventListener("click", () => go(null));

let reading: SectorId | null = null, frame = 0;
function read() {
  frame = 0;
  // 0 on the field, 1 once you have scrolled half a screen off it: the buttons are in the tabs and the field has dimmed
  const p = clamp(scrollY / (innerHeight * 0.55), 0, 1);
  document.body.style.setProperty("--p", p.toFixed(3));
  document.body.classList.toggle("scrolled", p >= 1);
  hero.morph(p, new Map([...tabFor].map(([k, b]) => [k, b.getBoundingClientRect()])));
  // the lane whose shelf crosses the upper third of the screen; none above the first shelf or past the last
  const line = innerHeight * 0.35;
  let now: SectorId | null = null;
  for (const s of SECTORS) { const r = shelfOf(s.id)!.getBoundingClientRect(); if (r.top <= line && r.bottom > line) now = s.id; }
  if (now === reading) return;
  reading = now; hero.lane(now);
  for (const [k, b] of tabFor) b.setAttribute("aria-selected", String(k === now));
  history.replaceState(null, "", now ? `#${now}` : location.pathname + location.search);
}
const soon = () => { frame ||= requestAnimationFrame(read); };
addEventListener("scroll", soon, { passive: true });
addEventListener("resize", soon);

// the night's air: an easter egg behind one small button in the corner of the field
const air = document.getElementById("air")!, egg = document.getElementById("air-egg")!;
egg.innerHTML = iconSvg(ICON.thermometer, 15);
const showAir = (open: boolean) => { air.hidden = !open; egg.setAttribute("aria-expanded", String(open)); };
egg.addEventListener("click", () => showAir(air.hidden !== false));
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!air.hidden) showAir(false); else if (reading) go(null);
});
showAir(false);
const asked = location.hash.slice(1);
if (isSector(asked)) go(asked, true);
read();
const chain = document.getElementById("chain")!;
CHAIN.forEach((c, i) => {
  const p = pathOf(c.path), li = document.createElement("li");
  li.innerHTML = `<a href="${p.href}" data-step="${i + 1}"><span class="head">${iconSvg(p.icon, 20)}<b></b></span><span></span></a>`;
  li.querySelector("b")!.textContent = c.step;
  li.querySelector("a > span:last-child")!.textContent = c.does;
  chain.append(li);
});
const live = document.getElementById("live")!;
for (const l of LIVE) {
  const li = document.createElement("li");
  li.innerHTML = `${iconSvg(ICON.check, 18)}<span><b></b> </span>`;
  li.querySelector("b")!.textContent = pathOf(l.path).name;
  li.querySelector("span")!.append(l.line);
  live.append(li);
}
const pitches = document.getElementById("pitches")!;
for (const w of PITCHES) {
  const p = pathOf(w.path), a = document.createElement("a");
  a.href = p.href;
  a.innerHTML = `<span class="icon">${iconSvg(p.icon, 26)}</span><span><b></b><p></p></span>`;
  a.querySelector("b")!.textContent = w.who;
  a.querySelector("p")!.textContent = w.line;
  pitches.append(a);
}

// sign in with eqosys, top right on the field and at the end of the tabs: the jam room's own client (studio/page.ts), so
// one sign-in here is the same session there. Sign in opens eqosys beside the page; both chips redraw on the way back.
const eq = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "qollab-studio", skin: SKIN });
const chips = [...document.querySelectorAll<HTMLElement>(".account")];
const drawChips = (note?: string) => { for (const c of chips) eq.accountChip(c, { ...(note ? { note } : {}), onSignIn: () => drawChips(), onSignOut: () => drawChips() }); };
drawChips();
void eq.finishSignIn().then((back) => { if (back) drawChips(back.error); }); // back from eqosys with ?code=&state=

declare global { interface Window { qdoor: typeof harness } }
const harness = {
  /** Each card as drawn: its path, the word it sits under, its name, where it goes, whether its name sits on one line, and the page's overflow. */
  state: () => ({
    paths: [...list.querySelectorAll<HTMLAnchorElement>("a.path")].map((a) => {
      const b = a.querySelector("b")!, line = parseFloat(getComputedStyle(b).lineHeight);
      const sector = a.closest<HTMLElement>(".sector")?.dataset.sector;
      const shown = a.getClientRects().length > 0;
      return { id: a.dataset.path, sector, name: b.textContent, href: a.getAttribute("href"), shown, oneLine: shown && b.getBoundingClientRect().height <= line * 1.2 && b.scrollWidth <= b.clientWidth };
    }),
    /** The lane that is open on the field, or null. */
    lane: hero.state().lane,
    overflowX: document.documentElement.scrollWidth > innerWidth,
    /** The account chips, where each sits (field or tabs), whether it is on the screen, its words, and its box. */
    account: chips.map((c) => {
      const r = c.getBoundingClientRect();
      return { at: c.dataset.at, shown: c.getClientRects().length > 0 && r.width > 0, text: c.textContent?.trim() ?? "", left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top) };
    }),
  }),
  /** Scrolls to a lane's shelf (learn, build or play), or back up to the field with null, as its button or tab does. */
  lane: (id: SectorId | null) => go(id),
  /** Walks through a path's door, as a click on its card. */
  open: (id: PathId) => list.querySelector<HTMLAnchorElement>(`a[data-path="${id}"]`)?.click(),
  /** The open lane's shelf: each thing, whether it is on the screen, picked (nearest the middle) and drawn. */
  shelf: () => shelf.state(),
  /** The live field: `hero.state()` as drawn, `hero.set({ tempC, humidity, bank })` as the sliders and the mountain button. */
  hero,
};
window.qdoor = harness;
