// Qollab Studio's front door (/door.html), a landing page (#6019): the live field at dusk (src/front-hero.ts) fills the
// screen, with Start learning and Start building over the sky and LEARN, BUILD and PLAY as lanes down the grass. Open one
// and the lanes become tabs along the top, the field stays lit behind, and the lane's paths stand down the page as things
// turning in the dark (src/front-shelf.ts), each card opening on its sector's first step and sliding in as you scroll.
// The night's air hides behind one small button in the corner. Under the field, the pedal-to-show chain, what works
// today, and a word for crews and for classes. `qdoor` is the harness for probes and the journey tests
// (test/front-door.test.ts).
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import { mountHero } from "./front-hero.ts";
import { mountShelf, type ShelfItem } from "./front-shelf.ts";
import { CHAIN, ICON, iconSvg, LIVE, PATHS, pathOf, PITCHES, SECTORS, type PathId, type SectorId } from "./paths.ts";

const TONES: Record<SectorId, string> = { learn: "#2dd4bf", build: "#fb923c", play: "#818cf8" };
/** The thing each path stands as on its lane's shelf. */
const ITEMS: Record<PathId, ShelfItem> = { learn: "guitar", planner: "stack", daw: "screen", instruments: "turntable", amps: "amp", builder: "board", event: "mic" };
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

// the field is the menu: opening a lane turns the lanes into tabs up top and shows its shelf; #build opens it from a link
const tabs = document.getElementById("tabs")!;
for (const s of SECTORS) {
  const b = document.createElement("button");
  b.type = "button"; b.role = "tab"; b.dataset.tab = s.id; b.textContent = s.word; b.style.setProperty("--tone", TONES[s.id]);
  b.addEventListener("click", () => hero.lane(s.id));
  tabs.querySelector(".tablist")!.append(b);
}
const showLane = (id: string | null) => {
  document.body.classList.toggle("lane-open", !!id);
  document.getElementById("lane-view")!.hidden = !id;
  for (const s of list.querySelectorAll<HTMLElement>(".sector")) s.hidden = s.dataset.sector !== id;
  for (const b of tabs.querySelectorAll<HTMLButtonElement>("[data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === id));
  history.replaceState(null, "", id ? `#${id}` : location.pathname + location.search);
  scrollTo({ top: 0 });
};
const hero = mountHero(document.getElementById("hero")!, SECTORS.map((s) => ({ id: s.id, word: s.word, tone: TONES[s.id] })), showLane);
for (const b of document.querySelectorAll<HTMLButtonElement>(".lane")) {
  const n = PATHS.filter((p) => p.sector === b.dataset.lane).length;
  b.querySelector("span")!.textContent = n === 1 ? "1 way in" : `${n} ways in`;
}
document.getElementById("field-back")!.addEventListener("click", () => hero.lane(null));

// the night's air: an easter egg behind one small button in the corner of the field
const air = document.getElementById("air")!, egg = document.getElementById("air-egg")!;
egg.innerHTML = iconSvg(ICON.thermometer, 15);
const showAir = (open: boolean) => { air.hidden = !open; egg.setAttribute("aria-expanded", String(open)); };
egg.addEventListener("click", () => showAir(air.hidden !== false));
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!air.hidden) showAir(false); else if (hero.state().lane) hero.lane(null);
});
showAir(false);
const asked = location.hash.slice(1);
showLane(null);
if (isSector(asked)) hero.lane(asked);
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
  }),
  /** Opens a lane on the field (learn, build or play), or closes it with null, as a click on its strip of grass. */
  lane: (id: SectorId | null) => hero.lane(id),
  /** Walks through a path's door, as a click on its card. */
  open: (id: PathId) => list.querySelector<HTMLAnchorElement>(`a[data-path="${id}"]`)?.click(),
  /** The open lane's shelf: each thing, whether it is on the screen, picked (nearest the middle) and drawn. */
  shelf: () => shelf.state(),
  /** The live field: `hero.state()` as drawn, `hero.set({ tempC, humidity, bank })` as the sliders and the mountain button. */
  hero,
};
window.qdoor = harness;
